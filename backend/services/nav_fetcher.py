# backend/services/nav_fetcher.py
"""
NAV history fetcher.
- Indian funds: mfapi.in (official AMFI data, no auth needed)
- Global funds: Morningstar public API (pure HTTP, no Selenium)
- Stores in nav_history table in Postgres
- Fetch once, append daily
"""

import logging
import requests
from datetime import date, timedelta, datetime
from typing import Optional

logger = logging.getLogger(__name__)

MFAPI_BASE = "https://api.mfapi.in/mf"
MS_NAV_URL  = "https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}


def _get_session():
    from models.database import SessionLocal
    return SessionLocal()


def has_nav_history(isin: str) -> bool:
    db = _get_session()
    try:
        from models.database import NavHistory
        return db.query(NavHistory).filter(NavHistory.isin == isin).count() > 0
    finally:
        db.close()


def get_latest_nav_date(isin: str) -> Optional[date]:
    db = _get_session()
    try:
        from models.database import NavHistory
        from sqlalchemy import func
        result = db.query(func.max(NavHistory.date)).filter(
            NavHistory.isin == isin
        ).scalar()
        return result
    finally:
        db.close()


def save_nav_rows(isin: str, rows: list) -> int:
    """Save NAV rows to nav_history using bulk upsert. Returns count added."""
    if not rows:
        return 0
    db = _get_session()
    try:
        from models.database import NavHistory
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy import text

        # Build bulk insert with ON CONFLICT DO NOTHING
        values = [
            {
                'isin': isin,
                'date': row['date'],
                'nav': row.get('nav'),
                'total_return': row.get('total_return'),
            }
            for row in rows
        ]

        stmt = pg_insert(NavHistory).values(values)
        stmt = stmt.on_conflict_do_nothing(index_elements=['isin', 'date'])
        result = db.execute(stmt)
        db.commit()
        return result.rowcount if result.rowcount >= 0 else len(values)
    except Exception as e:
        db.rollback()
        logger.error(f"Error saving NAV rows for {isin}: {e}")
        # Fallback to SQLite-compatible insert
        try:
            from models.database import NavHistory
            added = 0
            for row in rows:
                try:
                    db.add(NavHistory(
                        isin=isin,
                        date=row['date'],
                        nav=row.get('nav'),
                        total_return=row.get('total_return'),
                    ))
                    added += 1
                except Exception:
                    db.rollback()
            db.commit()
            return added
        except Exception as e2:
            db.rollback()
            logger.error(f"Fallback save also failed: {e2}")
            return 0
    finally:
        db.close()


def is_indian_isin(isin: str) -> bool:
    return isin.startswith("INF") or isin.startswith("IN")


def fetch_via_mfapi(amfi_code: str, start_date: date, end_date: date) -> list:
    """Fetch NAV history from mfapi.in for Indian funds using AMFI code. Retries on timeout."""
    url = f"{MFAPI_BASE}/{amfi_code}"
    
    # Retry up to 3 times with increasing timeout
    last_error = None
    for attempt, timeout in enumerate([30, 60, 90], 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            rows = []
            for r in data.get('data', []):
                try:
                    d = datetime.strptime(r['date'], "%d-%m-%Y").date()
                    if start_date <= d <= end_date:
                        rows.append({
                            'date': d,
                            'nav': float(r['nav']),
                            'total_return': None,
                        })
                except Exception:
                    continue
            return rows
        except requests.exceptions.Timeout as e:
            last_error = e
            logger.warning(f"mfapi timeout (attempt {attempt}/3, timeout={timeout}s) for {amfi_code}")
            continue
        except Exception as e:
            raise e
    raise last_error


def search_amfi_code_by_name(fund_name: str) -> str:
    """Search mfapi by fund name to find AMFI code when not in DB."""
    try:
        import urllib.parse
        query = ' '.join(fund_name.lower().split()[:4])  # use first 4 words
        url = f"https://api.mfapi.in/mf/search?q={urllib.parse.quote(query)}"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        results = resp.json()
        if not results:
            return None
        # Find best match by name similarity
        fund_name_lower = fund_name.lower()
        for r in results[:10]:
            if r.get('schemeName', '').lower()[:20] in fund_name_lower or                fund_name_lower[:20] in r.get('schemeName', '').lower():
                return str(r['schemeCode'])
        # Fallback: return first result
        return str(results[0]['schemeCode'])
    except Exception as e:
        logger.warning(f"mfapi search failed for '{fund_name}': {e}")
        return None


def fetch_via_morningstar(isin: str, start_date: date, end_date: date) -> list:
    """
    Fetch NAV history from Morningstar public timeseries API.
    Works for global funds via ISIN.
    """
    # First get the Morningstar security ID from ISIN
    search_url = "https://www.morningstar.com/api/v2/search/securities"
    search_resp = requests.get(
        search_url,
        params={"term": isin, "limit": 1},
        headers=HEADERS,
        timeout=10
    )

    if search_resp.status_code != 200:
        raise ValueError(f"Morningstar search failed: {search_resp.status_code}")

    search_data = search_resp.json()
    results = search_data.get("results", [])
    if not results:
        raise ValueError(f"No Morningstar match for ISIN {isin}")

    sec_id = results[0].get("secId") or results[0].get("id")
    if not sec_id:
        raise ValueError(f"No secId found for {isin}")

    # Fetch timeseries
    nav_resp = requests.get(
        MS_NAV_URL,
        params={
            "id": f"{sec_id}]2]0]FFUND",
            "currencyId": "INR",
            "idtype": "Morningstar",
            "frequency": "daily",
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "outputType": "COMPACTJSON",
        },
        headers=HEADERS,
        timeout=15
    )
    nav_resp.raise_for_status()
    nav_data = nav_resp.json()

    rows = []
    series = nav_data.get("TimeSeries", {}).get("Security", [{}])[0].get("NAV", [])
    for point in series:
        try:
            d = date.fromisoformat(point["EndDate"])
            rows.append({
                'date': d,
                'nav': float(point["Value"]),
                'total_return': None,
            })
        except Exception:
            continue
    return rows


def fetch_nav_history(isin: str, force_full: bool = False) -> dict:
    """
    Main entry point. Fetches and stores NAV history for an ISIN.
    - Indian ISINs: mfapi (uses amfi_code from DB)
    - Global ISINs: Morningstar public API
    """
    try:
        latest = get_latest_nav_date(isin)
        today = date.today()

        if latest and not force_full:
            start = latest + timedelta(days=1)
            if start >= today:
                return {'isin': isin, 'rows_added': 0, 'status': 'up_to_date', 'message': 'Already up to date'}
        else:
            start = date(1970, 1, 1)  # fetch from inception

        end = today
        logger.info(f"Fetching NAV for {isin} from {start} to {end}")

        rows = []
        source = ''

        # All AMFI-registered funds (equity, debt, hybrid, global, ETF) use mfapi
        # SIF funds and funds without AMFI code are skipped
        source = 'mfapi'
        try:
            from services.db_service import get_amfi_code_for_isin
            amfi_code = get_amfi_code_for_isin(isin)
            if not amfi_code:
                logger.info(f"No AMFI code for {isin} — skipping")
                return {'isin': isin, 'rows_added': 0, 'status': 'skipped', 'message': 'No AMFI code — SIF or unsupported fund'}
            rows = fetch_via_mfapi(amfi_code, start, end)
            logger.info(f"mfapi returned {len(rows)} rows for {isin}")
        except Exception as e:
            logger.error(f"mfapi failed for {isin}: {e}")
            _log_fetch(isin, 0, 'error', str(e))
            return {'isin': isin, 'rows_added': 0, 'status': 'error', 'message': str(e)}

        # NOTE: Morningstar public API branch commented out for now
        # Uncomment below when non-AMFI global funds need to be supported
        # else:
        #     source = 'morningstar_public'
        #     try:
        #         rows = fetch_via_morningstar(isin, start, end)
        #     except Exception as e:
        #         logger.error(f"Morningstar public failed for {isin}: {e}")
        #         _log_fetch(isin, 0, 'error', str(e))
        #         return {'isin': isin, 'rows_added': 0, 'status': 'error', 'message': str(e)}

        if not rows:
            # If fund already has data in DB, it's just up to date (no new rows in range)
            if latest:
                return {'isin': isin, 'rows_added': 0, 'status': 'up_to_date', 'message': 'Already up to date'}
            _log_fetch(isin, 0, 'no_data', f"No rows from {source}")
            return {'isin': isin, 'rows_added': 0, 'status': 'no_data', 'message': 'No data returned'}

        added = save_nav_rows(isin, rows)
        _log_fetch(isin, added, 'success', f"Fetched {len(rows)} rows via {source}, added {added} new")
        return {'isin': isin, 'rows_added': added, 'status': 'success', 'message': f'{added} rows added via {source}'}

    except Exception as e:
        logger.error(f"fetch_nav_history failed for {isin}: {e}", exc_info=True)
        _log_fetch(isin, 0, 'error', str(e))
        return {'isin': isin, 'rows_added': 0, 'status': 'error', 'message': str(e)}


def _log_fetch(isin: str, rows_added: int, status: str, message: str):
    try:
        from models.database import NavFetchLog, SessionLocal
        db = SessionLocal()
        db.add(NavFetchLog(isin=isin, status=status, rows_added=rows_added, message=message))
        db.commit()
        db.close()
    except Exception:
        pass


def append_daily_nav(isins: list) -> dict:
    """Append latest NAV for all tracked ISINs. Called after Gmail poll."""
    results = {'success': 0, 'failed': 0, 'up_to_date': 0}
    for isin in isins:
        try:
            result = fetch_nav_history(isin)
            if result['status'] == 'success':
                results['success'] += 1
            elif result['status'] == 'up_to_date':
                results['up_to_date'] += 1
            else:
                results['failed'] += 1
        except Exception as e:
            logger.error(f"append_daily_nav failed for {isin}: {e}")
            results['failed'] += 1
    return results


def get_nav_series(isin: str, start_date: date, end_date: date) -> list:
    """Get NAV time series from DB for portfolio calculations."""
    db = _get_session()
    try:
        from models.database import NavHistory
        rows = db.query(NavHistory).filter(
            NavHistory.isin == isin,
            NavHistory.date >= start_date,
            NavHistory.date <= end_date
        ).order_by(NavHistory.date.asc()).all()
        return [{'date': r.date, 'nav': r.nav, 'total_return': r.total_return} for r in rows]
    finally:
        db.close()


def get_tracked_isins() -> list:
    """Get all ISINs that have NAV history in DB."""
    db = _get_session()
    try:
        from models.database import NavHistory
        from sqlalchemy import distinct
        result = db.query(distinct(NavHistory.isin)).all()
        return [r[0] for r in result]
    finally:
        db.close()