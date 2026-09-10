"""
nav_service.py
NAV history service — DB-first with mfapi.in as gap-filler / fallback.

Priority:
  1. nav_history table in DB (fast, <50ms, from inception)
  2. If DB data is stale (latest date < yesterday), fetch missing dates from mfapi.in
  3. If DB has no data at all, fetch full history from mfapi.in
  4. mfapi.in is also the fallback if anything fails

API docs: https://www.mfapi.in/
"""

import httpx
import logging
from datetime import date, timedelta
from functools import lru_cache

logger = logging.getLogger(__name__)

MFAPI_BASE = "https://api.mfapi.in/mf"
TRADING_DAYS_PER_YEAR = 252


def _last_business_day() -> date:
    """Return yesterday, or Friday if today is Monday, skipping weekends."""
    today = date.today()
    delta = 1
    while True:
        candidate = today - timedelta(days=delta)
        if candidate.weekday() < 5:  # Mon-Fri
            return candidate
        delta += 1


def _get_isin_for_amfi(amfi_code: str) -> str | None:
    """Look up ISIN from amfi_code via DailyFundData table."""
    try:
        from models.database import SessionLocal, DailyFundData
        db = SessionLocal()
        try:
            row = db.query(DailyFundData.isin).filter(
                DailyFundData.amfi_code == amfi_code
            ).first()
            return row.isin if row else None
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"ISIN lookup failed for amfi_code={amfi_code}: {e}")
        return None


def _get_latest_nav_date(isin: str) -> date | None:
    """Lightweight query — just the latest date in nav_history for this ISIN."""
    try:
        from models.database import SessionLocal, NavHistory
        from sqlalchemy import func as sqlfunc
        db = SessionLocal()
        try:
            result = db.query(sqlfunc.max(NavHistory.date))\
                       .filter(NavHistory.isin == isin)\
                       .scalar()
            return result  # already a date object or None
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Latest date check failed for isin={isin}: {e}")
        return None


PERIOD_DAYS = {
    "1m":  30,
    "3m":  90,
    "6m":  180,
    "1y":  365,
    "3y":  3 * 365,
    "5y":  5 * 365,
    "10y": 10 * 365,
}


def _fetch_nav_from_db(isin: str, from_date: date = None) -> list:
    """
    Fetch NAV history from nav_history table.
    If from_date is given, only fetch rows >= from_date (efficient range query).
    Returns list of {"date": "YYYY-MM-DD", "nav": float} sorted ascending.
    """
    try:
        from models.database import SessionLocal, NavHistory
        db = SessionLocal()
        try:
            q = db.query(NavHistory.date, NavHistory.nav)\
                  .filter(NavHistory.isin == isin)
            if from_date:
                q = q.filter(NavHistory.date >= from_date)
            rows = q.order_by(NavHistory.date.asc()).all()
            return [{"date": r.date.isoformat(), "nav": float(r.nav)} for r in rows if r.nav is not None]
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"DB NAV fetch failed for isin={isin}: {e}")
        return []


def _store_nav_to_db(isin: str, new_rows: list) -> int:
    """
    Insert new NAV rows into nav_history, skipping duplicates.
    Returns number of rows inserted.
    """
    if not new_rows or not isin:
        return 0
    try:
        from models.database import SessionLocal, NavHistory
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from datetime import date as date_type
        db = SessionLocal()
        try:
            inserted = 0
            for row in new_rows:
                try:
                    d = date_type.fromisoformat(row["date"])
                    exists = db.query(NavHistory.id).filter(
                        NavHistory.isin == isin,
                        NavHistory.date == d
                    ).first()
                    if not exists:
                        db.add(NavHistory(isin=isin, date=d, nav=row["nav"]))
                        inserted += 1
                except Exception:
                    continue
            db.commit()
            return inserted
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"DB NAV store failed for isin={isin}: {e}")
        return 0


async def _fetch_nav_from_mfapi(amfi_code: str) -> list:
    """
    Fetch full NAV history from mfapi.in.
    Returns list of {"date": "YYYY-MM-DD", "nav": float} sorted ascending.
    """
    url = f"{MFAPI_BASE}/{amfi_code}"
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    nav_data = data.get("data", [])
    result = []
    for entry in nav_data:
        try:
            day, month, year = entry["date"].split("-")
            iso_date = f"{year}-{month}-{day}"
            nav = float(entry["nav"])
            result.append({"date": iso_date, "nav": nav})
        except Exception:
            continue

    result.sort(key=lambda x: x["date"])
    return result


async def fetch_nav_history(amfi_code: str, isin: str = None, period: str = None) -> list:
    """
    DB-first NAV history fetch with date-range query.

    1. Use isin if provided, else look up from amfi_code via DailyFundData
    2. Compute cutoff date from period (e.g. 1y → today - 365 days)
    3. Query DB with WHERE date >= cutoff (only fetch what's needed)
    4. Check staleness by querying latest date in DB
    5. If stale → fetch gap from mfapi.in and store back to DB
    6. If DB empty → full fetch from mfapi.in and store to DB
    7. Return sorted result
    """
    last_bday = _last_business_day()
    today = date.today()

    # ── Step 1: resolve ISIN ──────────────────────────────────────────
    if not isin:
        isin = _get_isin_for_amfi(amfi_code)

    # ── Step 2: compute cutoff from period ────────────────────────────
    days = PERIOD_DAYS.get(period, 0) if period else 0
    # Add 10 extra days buffer so inception warning logic works correctly
    cutoff = (today - timedelta(days=days + 10)) if days else None

    # ── Step 3: check latest date in DB (lightweight query) ───────────
    latest_db_date = _get_latest_nav_date(isin) if isin else None

    # ── Step 4: decide fetch strategy ────────────────────────────────
    if latest_db_date:
        if latest_db_date < last_bday:
            # DB is stale — fetch gap from mfapi.in first
            logger.info(f"NAV stale for amfi={amfi_code}: DB={latest_db_date}, expected={last_bday}. Fetching gap.")
            try:
                all_mfapi = await _fetch_nav_from_mfapi(amfi_code)
                gap_start = (latest_db_date + timedelta(days=1)).isoformat()
                gap_rows  = [r for r in all_mfapi if r["date"] >= gap_start]
                if gap_rows and isin:
                    stored = _store_nav_to_db(isin, gap_rows)
                    logger.info(f"Stored {stored} gap rows for isin={isin}")
            except Exception as e:
                logger.warning(f"Gap fill failed for amfi={amfi_code}: {e}")

        # ── Step 5: fetch from DB with date range ─────────────────────
        db_data = _fetch_nav_from_db(isin, from_date=cutoff)
        if db_data:
            logger.info(f"NAV served from DB for amfi={amfi_code}: {len(db_data)} rows from {db_data[0]['date']}")
            return db_data

    # ── Step 6: DB empty — full fetch from mfapi.in ──────────────────
    logger.info(f"No DB data for amfi={amfi_code}. Full fetch from mfapi.in.")
    mfapi_data = await _fetch_nav_from_mfapi(amfi_code)
    if mfapi_data and isin:
        stored = _store_nav_to_db(isin, mfapi_data)
        logger.info(f"Stored {stored} rows from mfapi.in for isin={isin}")
    # Filter to period before returning
    if cutoff and mfapi_data:
        cutoff_str = cutoff.isoformat()
        return [r for r in mfapi_data if r["date"] >= cutoff_str]
    return mfapi_data



def filter_by_period(nav_data: list, period: str) -> tuple:
    """
    Filter NAV data to a given period string (1m, 3m, 6m, 1y, 3y, 5y, 10y).
    Returns (filtered_data, warning_message_or_None).
    """
    if not nav_data:
        return [], None

    today = date.today()
    period_map = {
        "1m":  30,
        "3m":  90,
        "6m":  180,
        "1y":  365,
        "3y":  3 * 365,
        "5y":  5 * 365,
        "10y": 10 * 365,
    }

    days = period_map.get(period, 365)
    start_date = today - timedelta(days=days)

    # Find actual earliest date in data
    earliest_date = date.fromisoformat(nav_data[0]["date"])
    warning = None

    if earliest_date > start_date:
        label = period.upper()
        warning = (
            f"No {label} data available — showing data from {earliest_date.strftime('%d %b %Y')} "
            f"(fund inception)"
        )
        filtered = nav_data
    else:
        start_str = start_date.isoformat()
        filtered = [d for d in nav_data if d["date"] >= start_str]

    return filtered, warning


def filter_by_date_range(nav_data: list, start_date: str, end_date: str) -> list:
    """Filter NAV data to a custom date range."""
    return [d for d in nav_data if start_date <= d["date"] <= end_date]


def calculate_cagr(start_nav: float, end_nav: float, years: float) -> float:
    """CAGR = (end/start)^(1/years) - 1"""
    if years <= 0 or start_nav <= 0:
        return None
    return ((end_nav / start_nav) ** (1 / years) - 1) * 100


def calculate_xirr(cash_flows: list, dates: list) -> float:
    """
    Calculate XIRR given cash_flows and dates.
    cash_flows: list of floats (negative = investment, positive = redemption)
    dates: list of date objects
    Uses scipy.optimize for Newton-Raphson.
    """
    from scipy.optimize import brentq
    from datetime import date as date_type

    if len(cash_flows) != len(dates) or len(cash_flows) < 2:
        return None

    base_date = dates[0]

    def npv(rate):
        total = 0
        for cf, dt in zip(cash_flows, dates):
            days = (dt - base_date).days
            years = days / 365.0
            total += cf / ((1 + rate) ** years)
        return total

    try:
        result = brentq(npv, -0.999, 100.0, maxiter=1000)
        return round(result * 100, 4)
    except Exception:
        return None


def build_chart_data(nav_data: list, period: str, benchmark_nav: list = None) -> tuple:
    """
    Build chart-ready data combining fund NAV and benchmark NAV (rebased to 100).
    Returns (chart_data_list, warning).
    """
    filtered, warning = filter_by_period(nav_data, period)

    if not filtered:
        return [], warning

    chart = []
    for entry in filtered:
        row = {
            "date": entry["date"],
            "fund_nav": round(entry["nav"], 4),
        }
        chart.append(row)

    # Add benchmark if provided — rebased to fund start NAV for visual comparability
    if benchmark_nav:
        start_str = filtered[0]["date"]
        end_str   = filtered[-1]["date"]
        bm_filtered = [d for d in benchmark_nav if start_str <= d["date"] <= end_str]
        if bm_filtered:
            fund_start_nav = filtered[0]["nav"]
            bm_start_nav   = bm_filtered[0]["nav"]
            bm_lookup = {d["date"]: d["nav"] for d in bm_filtered}
            for row in chart:
                bm_val = bm_lookup.get(row["date"])
                if bm_val is not None and bm_start_nav:
                    # Rebase: bm_val / bm_start_nav * fund_start_nav
                    row["benchmark_nav"] = round((bm_val / bm_start_nav) * fund_start_nav, 4)
                else:
                    row["benchmark_nav"] = None

    # Calculate performance stats for the period
    start_nav = filtered[0]["nav"]
    end_nav   = filtered[-1]["nav"]
    start_date = date.fromisoformat(filtered[0]["date"])
    end_date   = date.fromisoformat(filtered[-1]["date"])
    years = (end_date - start_date).days / 365.0

    absolute_return = round(((end_nav - start_nav) / start_nav) * 100, 2) if start_nav else None

    cagr = None
    if years > 1:
        cagr = round(calculate_cagr(start_nav, end_nav, years), 2)

    performance = {
        "start_nav":       round(start_nav, 2),
        "end_nav":         round(end_nav, 2),
        "absolute_return": absolute_return,
        "cagr":            cagr,
        "years":           round(years, 2),
        "period_label":    period.upper(),
    }

    return chart, warning, performance


def calculate_rolling_cagr(nav_data: list, rolling_years: int) -> dict:
    """
    Calculate rolling CAGR on daily NAV data.
    rolling_years: 1, 3, or 5
    Returns dict with chart_data, stats, total_points, or error.
    """
    TRADING_DAYS = TRADING_DAYS_PER_YEAR
    window = rolling_years * TRADING_DAYS
    min_required = window * 2  # need at least 2 full periods

    if len(nav_data) < min_required:
        years_available = len(nav_data) / TRADING_DAYS
        years_required  = (min_required) / TRADING_DAYS
        return {
            "error": "insufficient_data",
            "message": (
                f"Date range has only ~{years_available:.1f} years of data. "
                f"For {rolling_years}Y rolling average, you need at least "
                f"{years_required:.0f} years ({min_required} trading days). "
                f"Please extend your date range."
            ),
        }

    cagr_series = []
    for i in range(len(nav_data) - window):
        start_nav = nav_data[i]["nav"]
        end_nav   = nav_data[i + window]["nav"]
        end_date  = nav_data[i + window]["date"]
        if start_nav > 0:
            cagr = calculate_cagr(start_nav, end_nav, rolling_years)
            if cagr is not None:
                cagr_series.append({"date": end_date, "cagr": round(cagr, 4)})

    if not cagr_series:
        return {"error": "no_data", "message": "Could not calculate rolling CAGR."}

    values = [c["cagr"] for c in cagr_series]
    positive = [v for v in values if v > 0]
    above_12 = [v for v in values if v > 12]

    import statistics
    stats = {
        "avg_cagr":     round(sum(values) / len(values), 2),
        "median_cagr":  round(statistics.median(values), 2),
        "best_cagr":    round(max(values), 2),
        "worst_cagr":   round(min(values), 2),
        "pct_positive": round(len(positive) / len(values) * 100, 1),
        "pct_above_12": round(len(above_12) / len(values) * 100, 1),
        "std_dev_cagr": round(statistics.stdev(values), 2) if len(values) > 1 else 0,
    }

    return {
        "chart_data":   cagr_series,
        "stats":        stats,
        "total_points": len(cagr_series),
    }


async def fetch_yahoo_history(ticker: str) -> list:
    """
    Fetch historical price data from Yahoo Finance for a given ticker.
    Returns list of {"date": "YYYY-MM-DD", "nav": float} sorted ascending.
    """
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval=1d&range=15y"
    )
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        async with httpx.AsyncClient(timeout=30, headers=headers, verify=False) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        result_data = data.get("chart", {}).get("result", [])
        if not result_data:
            return []

        timestamps = result_data[0].get("timestamp", [])
        closes = result_data[0].get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])

        if not timestamps or not closes:
            return []

        result = []
        for ts, close in zip(timestamps, closes):
            if close is None:
                continue
            from datetime import datetime, timezone
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            result.append({"date": dt.strftime("%Y-%m-%d"), "nav": round(float(close), 4)})

        result.sort(key=lambda x: x["date"])
        return result
    except Exception as e:
        logger.warning(f"Yahoo Finance fetch failed for {ticker}: {e}")
        return []