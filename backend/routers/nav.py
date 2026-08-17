# backend/routers/nav.py
"""
NAV history endpoints for portfolio analytics.
"""

from fastapi import APIRouter, Query, BackgroundTasks
from datetime import date, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/fetch/{isin}")
async def fetch_fund_nav(isin: str, background_tasks: BackgroundTasks, force: bool = False):
    """
    Trigger NAV history fetch for a fund.
    Runs in background — returns immediately.
    First call fetches full 10-year history.
    Subsequent calls fetch only missing days.
    """
    from services.nav_fetcher import fetch_nav_history, has_nav_history, get_latest_nav_date

    already_has = has_nav_history(isin)
    latest = get_latest_nav_date(isin)

    # Run fetch in background
    background_tasks.add_task(fetch_nav_history, isin, force)

    return {
        "isin": isin,
        "status": "fetching",
        "already_exists": already_has,
        "latest_date": str(latest) if latest else None,
        "message": "Full history fetch started" if not already_has or force else "Incremental fetch started"
    }


@router.post("/fetch-batch")
async def fetch_batch(background_tasks: BackgroundTasks, isins: list[str]):
    """Fetch NAV history for multiple ISINs at once."""
    from services.nav_fetcher import fetch_nav_history

    for isin in isins[:10]:  # cap at 10 per request
        background_tasks.add_task(fetch_nav_history, isin, False)

    return {"status": "fetching", "count": min(len(isins), 10)}


@router.get("/status/{isin}")
def nav_status(isin: str):
    """Check NAV history status for a fund."""
    from services.nav_fetcher import has_nav_history, get_latest_nav_date
    from models.database import SessionLocal, NavHistory

    db = SessionLocal()
    try:
        count = db.query(NavHistory).filter(NavHistory.isin == isin).count()
        latest = get_latest_nav_date(isin)
        oldest = db.query(NavHistory).filter(
            NavHistory.isin == isin
        ).order_by(NavHistory.date.asc()).first()

        return {
            "isin": isin,
            "has_data": count > 0,
            "row_count": count,
            "latest_date": str(latest) if latest else None,
            "oldest_date": str(oldest.date) if oldest else None,
            "is_stale": latest and (date.today() - latest).days > 3 if latest else True
        }
    finally:
        db.close()


@router.get("/series/{isin}")
def get_nav_series(
    isin: str,
    start: str = Query(None),
    end: str = Query(None)
):
    """
    Get NAV time series for a fund.
    Used by portfolio analytics.
    """
    from services.nav_fetcher import get_nav_series, has_nav_history

    if not has_nav_history(isin):
        return {"isin": isin, "data": [], "message": "No data — trigger /api/nav/fetch/{isin} first"}

    today = date.today()
    start_date = date.fromisoformat(start) if start else today - timedelta(days=365 * 3)
    end_date = date.fromisoformat(end) if end else today

    series = get_nav_series(isin, start_date, end_date)
    return {
        "isin": isin,
        "count": len(series),
        "start": str(start_date),
        "end": str(end_date),
        "data": [{"date": str(r['date']), "nav": r['nav'], "total_return": r['total_return']} for r in series]
    }


@router.get("/rolling-metrics")
def get_rolling_metrics(isins: str):
    """
    Compute, per ISIN, from daily NAV history:
      - 1Y rolling return, averaged over a trailing 3-year lookback (window=252d, lookback=756d)
      - 3Y rolling CAGR, averaged over a trailing 5-year lookback (window=756d, lookback=1260d)
    Both are computed as daily-step rolling windows over the most recent available NAV history.
    Funds with insufficient history return null for the metric that can't be computed.
    """
    from models.database import SessionLocal, NavHistory
    from fastapi import HTTPException

    isin_list = [i.strip() for i in isins.split(",") if i.strip()]
    if not isin_list:
        raise HTTPException(400, "At least 1 ISIN required")

    WINDOW_1Y, LOOKBACK_1Y = 252, 252 * 3   # 1Y rolling return, avg over last 3Y
    WINDOW_3Y, LOOKBACK_3Y = 252 * 3, 252 * 5  # 3Y rolling CAGR, avg over last 5Y
    WINDOW_3M, LOOKBACK_3M = 63, 252           # 3M rolling return, avg over last 1Y

    def rolling_avg(navs, window, lookback):
        """navs: oldest→newest nav floats. Returns (avg_pct, window_count, is_cagr_len)."""
        needed = window + lookback
        n = len(navs)
        if n < needed:
            return None, 0
        tail = navs[-needed:]
        rets = []
        for end in range(window, needed):
            start_v = tail[end - window]
            end_v = tail[end]
            if start_v and start_v > 0 and end_v is not None:
                rets.append(end_v / start_v)
        if not rets:
            return None, 0
        years = window / 252
        if years > 1:
            avg = sum(r ** (1 / years) - 1 for r in rets) / len(rets)
        else:
            avg = sum(r - 1 for r in rets) / len(rets)
        return avg * 100, len(rets)

    db = SessionLocal()
    try:
        results = {}
        rows = (
            db.query(NavHistory.isin, NavHistory.date, NavHistory.nav)
            .filter(NavHistory.isin.in_(isin_list), NavHistory.nav != None)
            .order_by(NavHistory.isin, NavHistory.date.asc())
            .all()
        )
        from itertools import groupby
        by_isin = {isin: list(group) for isin, group in groupby(rows, key=lambda r: r.isin)}

        for isin in isin_list:
            grp = by_isin.get(isin, [])
            navs = [r.nav for r in grp]
            n = len(navs)
            r1y_avg, r1y_n = rolling_avg(navs, WINDOW_1Y, LOOKBACK_1Y)
            r3y_avg, r3y_n = rolling_avg(navs, WINDOW_3Y, LOOKBACK_3Y)
            r3m_avg, r3m_n = rolling_avg(navs, WINDOW_3M, LOOKBACK_3M)
            results[isin] = {
                "isin": isin,
                "rolling_1y_avg_3y": r1y_avg,
                "rolling_1y_window_count": r1y_n,
                "rolling_3y_cagr_avg_5y": r3y_avg,
                "rolling_3y_window_count": r3y_n,
                "rolling_3m_avg_1y": r3m_avg,
                "rolling_3m_window_count": r3m_n,
                "days_available": n,
                "years_available": round(n / 252, 1) if n else 0,
            }
        return {"funds": results}
    finally:
        db.close()


@router.get("/rolling-debug/{isin}")
def rolling_debug(isin: str):
    """
    Diagnostic: inspect a fund's daily NAV series for anomalies that would
    distort rolling-return calculations — big moves between trading-adjacent
    rows (possible unadjusted corporate action, split, or bad data row),
    large data gaps (long stretches with no NAV rows — these are NOT treated
    as single-day anomalies, since a big % change over months/years is
    normal and not a split signal), duplicate dates, and the specific 3Y
    windows contributing the most negative CAGR. Use this to explain
    surprising rolling-metrics results.
    """
    from models.database import SessionLocal, NavHistory

    db = SessionLocal()
    try:
        rows = (
            db.query(NavHistory.date, NavHistory.nav)
            .filter(NavHistory.isin == isin, NavHistory.nav != None)
            .order_by(NavHistory.date.asc())
            .all()
        )
        if not rows:
            return {"isin": isin, "error": "No NAV history found"}

        dates = [r.date for r in rows]
        navs = [r.nav for r in rows]
        n = len(navs)

        # Duplicate date check
        seen = set()
        dupes = []
        for d in dates:
            if d in seen:
                dupes.append(str(d))
            seen.add(d)

        # Big single-day move detection (possible split/bonus/bad data) —
        # only counts if the gap between rows is a real trading-adjacent gap
        # (<=5 calendar days, i.e. allows for weekends/holidays). Bigger gaps
        # are genuine data gaps, not single-day anomalies, and are reported
        # separately so they don't get misdiagnosed as splits.
        MAX_GAP_DAYS = 5
        big_moves = []
        data_gaps = []
        for i in range(1, n):
            gap_days = (dates[i] - dates[i - 1]).days
            if navs[i - 1] and navs[i - 1] > 0:
                chg = navs[i] / navs[i - 1] - 1
                if gap_days > MAX_GAP_DAYS:
                    if abs(chg) > 0.15:
                        data_gaps.append({
                            "from_date": str(dates[i - 1]), "to_date": str(dates[i]),
                            "gap_days": gap_days, "prev_nav": navs[i - 1], "nav": navs[i],
                            "pct_change_over_gap": round(chg * 100, 2),
                        })
                    continue
                if abs(chg) > 0.15:  # >15% in one trading-adjacent gap is unusual for a NAV series
                    big_moves.append({
                        "date": str(dates[i]),
                        "prev_date": str(dates[i - 1]),
                        "gap_days": gap_days,
                        "prev_nav": navs[i - 1],
                        "nav": navs[i],
                        "pct_change": round(chg * 100, 2),
                    })

        # Worst 3Y (756d) rolling windows — which date ranges drag the CAGR down most
        WINDOW = 252 * 3
        worst_windows = []
        if n > WINDOW:
            window_results = []
            for end in range(WINDOW, n):
                start = end - WINDOW
                if navs[start] and navs[start] > 0:
                    r = navs[end] / navs[start]
                    cagr = r ** (1 / 3) - 1
                    window_results.append({
                        "start_date": str(dates[start]), "end_date": str(dates[end]),
                        "start_nav": navs[start], "end_nav": navs[end],
                        "cagr_pct": round(cagr * 100, 2),
                    })
            worst_windows = sorted(window_results, key=lambda w: w["cagr_pct"])[:5]

        return {
            "isin": isin,
            "row_count": n,
            "date_range": {"start": str(dates[0]), "end": str(dates[-1])},
            "years_available": round(n / 252, 1),
            "duplicate_dates": dupes[:10],
            "duplicate_count": len(dupes),
            "big_single_day_moves": big_moves[:20],
            "big_move_count": len(big_moves),
            "data_gaps": data_gaps[:20],
            "data_gap_count": len(data_gaps),
            "worst_3y_windows": worst_windows,
        }
    finally:
        db.close()


@router.get("/health")
def nav_health():
    """Check if NAV fetcher is working (tests mfapi with a known Indian fund)."""
    from datetime import date, timedelta
    from services.nav_fetcher import fetch_via_mfapi
    try:
        end = date.today()
        start = end - timedelta(days=5)
        # Nippon India Large Cap Gr — amfi_code 106235
        rows = fetch_via_mfapi("106235", start, end)
        return {
            "status": "ok",
            "source": "mfapi",
            "test_isin": "INF204K01562",
            "rows_returned": len(rows),
            "sample": {"date": str(rows[0]["date"]), "nav": rows[0]["nav"]} if rows else None
        }
    except Exception as e:
        return {"status": "error", "source": "mfapi", "error": str(e)}


@router.post("/daily-append")
async def daily_append(background_tasks: BackgroundTasks):
    """
    Append yesterday's NAV for all tracked ISINs.
    Called automatically after Gmail poll.
    """
    from services.nav_fetcher import get_tracked_isins, append_daily_nav

    isins = get_tracked_isins()
    if not isins:
        return {"status": "skipped", "message": "No tracked ISINs yet"}

    background_tasks.add_task(append_daily_nav, isins)
    return {"status": "started", "isin_count": len(isins)}


@router.post("/fetch-all")
async def fetch_all_funds(background_tasks: BackgroundTasks, force: bool = False):
    """
    One-time bulk load — fetches NAV history for all funds with AMFI code (excluding SIF).
    Runs in background. Check progress via GET /api/nav/fetch-all/status.
    """
    from services.db_service import get_all_isins_with_amfi_code
    from services.nav_fetcher import fetch_nav_history
    from models.database import SessionLocal
    from sqlalchemy import text

    isins = get_all_isins_with_amfi_code()
    if not isins:
        return {"status": "error", "message": "No ISINs found with AMFI code"}

    # Reset progress counter in app_settings
    from services.db_service import set_setting
    import json
    set_setting("nav_bulk_progress", json.dumps({
        "total": len(isins),
        "completed": 0,
        "failed": 0,
        "running": True
    }))

    def bulk_fetch():
        import json, traceback, time
        print(f"[BULK] thread started — {len(isins)} ISINs", flush=True)
        from services.db_service import set_setting
        try:
            completed = 0
            failed = 0
            skipped = 0
            for idx, isin in enumerate(isins):
                try:
                    if idx < 3 or idx % 50 == 0:
                        print(f"[BULK] processing {idx+1}/{len(isins)}: {isin}", flush=True)
                    result = fetch_nav_history(isin, force_full=force)
                    if result['status'] == 'success':
                        completed += 1
                    elif result['status'] == 'up_to_date':
                        completed += 1
                    elif result['status'] == 'skipped':
                        skipped += 1
                    else:
                        failed += 1
                except Exception as fe:
                    failed += 1
                    print(f"[BULK] fetch failed for {isin}: {fe}", flush=True)
                # Update progress every 5 funds
                if (completed + failed + skipped) % 5 == 0:
                    set_setting("nav_bulk_progress", json.dumps({
                        "total": len(isins),
                        "completed": completed,
                        "failed": failed,
                        "skipped": skipped,
                        "running": True,
                        "percent": round((completed + failed + skipped) / len(isins) * 100, 1)
                    }))
            # Final update — done
            set_setting("nav_bulk_progress", json.dumps({
                "total": len(isins),
                "completed": completed,
                "failed": failed,
                "skipped": skipped,
                "running": False,
                "percent": 100.0
            }))
            print(f"[BULK] completed — success:{completed} failed:{failed} skipped:{skipped}", flush=True)
        except Exception as e:
            print(f"[BULK] CRASHED: {e}", flush=True)
            print(traceback.format_exc(), flush=True)

    import threading
    t = threading.Thread(target=bulk_fetch, daemon=True)
    t.start()
    return {
        "status": "started",
        "total_funds": len(isins),
        "message": f"Fetching NAV history for {len(isins)} funds in background"
    }


@router.get("/fetch-all/status")
def fetch_all_status():
    """Check progress of bulk NAV fetch."""
    from services.db_service import get_setting
    from models.database import SessionLocal, NavHistory
    from sqlalchemy import func
    import json

    progress_raw = get_setting("nav_bulk_progress")
    progress = json.loads(progress_raw) if progress_raw else None

    db = SessionLocal()
    try:
        total_rows = db.query(func.count(NavHistory.id)).scalar()
        unique_isins = db.query(func.count(func.distinct(NavHistory.isin))).scalar()
    finally:
        db.close()

    return {
        "bulk_load": progress,
        "nav_history": {
            "total_rows": total_rows,
            "unique_funds": unique_isins,
        }
    }


@router.get("/append/status")
def append_status():
    """Check last daily NAV append time and result."""
    from services.db_service import get_setting
    from models.database import SessionLocal, NavHistory
    from sqlalchemy import func

    last_append = get_setting("nav_last_append")
    last_result = get_setting("nav_last_append_result")

    db = SessionLocal()
    try:
        unique_isins = db.query(func.count(func.distinct(NavHistory.isin))).scalar()
        total_rows = db.query(func.count(NavHistory.id)).scalar()
        latest_date = db.query(func.max(NavHistory.date)).scalar()
    finally:
        db.close()

    return {
        "last_append_at": last_append or "never",
        "last_append_result": last_result or "none",
        "nav_history": {
            "unique_funds": unique_isins,
            "total_rows": total_rows,
            "latest_nav_date": str(latest_date) if latest_date else None,
        }
    }


@router.post("/fetch-missing")
async def fetch_missing(background_tasks: BackgroundTasks, force: bool = False):
    """
    Fetch NAV history ONLY for funds with AMFI code that are NOT yet in nav_history.
    Much faster than fetch-all — skips already-loaded funds entirely.
    """
    from services.db_service import get_all_isins_with_amfi_code, set_setting
    from services.nav_fetcher import get_tracked_isins, fetch_nav_history
    import json

    all_isins = set(get_all_isins_with_amfi_code())
    tracked = set(get_tracked_isins())
    missing = list(all_isins - tracked)

    if not missing:
        return {"status": "complete", "message": "All funds already in nav_history", "missing": 0}

    set_setting("nav_bulk_progress", json.dumps({
        "total": len(missing),
        "completed": 0,
        "failed": 0,
        "skipped": 0,
        "running": True,
        "percent": 0.0,
        "mode": "fetch-missing"
    }))

    def bulk_fetch():
        import json, traceback
        print(f"[FETCH-MISSING] started — {len(missing)} funds to fetch", flush=True)
        from services.db_service import set_setting
        completed = 0
        failed = 0
        try:
            for idx, isin in enumerate(missing):
                try:
                    if idx < 3 or idx % 10 == 0:
                        print(f"[FETCH-MISSING] {idx+1}/{len(missing)}: {isin}", flush=True)
                    result = fetch_nav_history(isin, force_full=force)
                    if result['status'] in ('success', 'up_to_date'):
                        completed += 1
                    else:
                        failed += 1
                except Exception as fe:
                    failed += 1
                    print(f"[FETCH-MISSING] failed for {isin}: {fe}", flush=True)
                if (completed + failed) % 5 == 0:
                    set_setting("nav_bulk_progress", json.dumps({
                        "total": len(missing),
                        "completed": completed,
                        "failed": failed,
                        "skipped": 0,
                        "running": True,
                        "percent": round((completed + failed) / len(missing) * 100, 1),
                        "mode": "fetch-missing"
                    }))
            set_setting("nav_bulk_progress", json.dumps({
                "total": len(missing),
                "completed": completed,
                "failed": failed,
                "skipped": 0,
                "running": False,
                "percent": 100.0,
                "mode": "fetch-missing"
            }))
            print(f"[FETCH-MISSING] done — success:{completed} failed:{failed}", flush=True)
        except Exception as e:
            print(f"[FETCH-MISSING] CRASHED: {e}", flush=True)
            print(traceback.format_exc(), flush=True)

    import threading
    t = threading.Thread(target=bulk_fetch, daemon=True)
    t.start()

    return {
        "status": "started",
        "missing_funds": len(missing),
        "message": f"Fetching NAV for {len(missing)} missing funds only — skipping {len(tracked)} already loaded"
    }

@router.get("/correlation")
def get_correlation(isins: str, as_of_date: str = None):
    """
    Compute pairwise Pearson correlation using daily NAV returns over the last 3 years.
    Funds with less than 3 years of data are excluded and listed in the response.
    Returns: correlation matrix, included ISINs, excluded ISINs with reasons.
    """
    from models.database import SessionLocal, NavHistory
    from datetime import date as date_type, timedelta
    import numpy as np

    isin_list = [i.strip() for i in isins.split(",") if i.strip()]
    if len(isin_list) < 2:
        from fastapi import HTTPException
        raise HTTPException(400, "At least 2 ISINs required")

    db = SessionLocal()
    try:
        # Determine as-of date
        if as_of_date:
            end_date = date_type.fromisoformat(as_of_date)
        else:
            latest = db.query(NavHistory.date).order_by(NavHistory.date.desc()).first()
            end_date = latest[0] if latest else date_type.today()

        start_date = end_date - timedelta(days=3 * 365 + 60)  # 3Y + buffer
        min_days = 700  # ~3Y of trading days (~250/year), with tolerance

        # Fetch NAV history for all ISINs in one query
        rows = (
            db.query(NavHistory.isin, NavHistory.date, NavHistory.nav)
            .filter(
                NavHistory.isin.in_(isin_list),
                NavHistory.date >= start_date,
                NavHistory.date <= end_date,
                NavHistory.nav != None,
            )
            .order_by(NavHistory.isin, NavHistory.date.asc())
            .all()
        )

        # Group by ISIN and compute daily returns
        from itertools import groupby
        nav_data = {}
        for isin, group in groupby(rows, key=lambda r: r.isin):
            grp = list(group)
            dates = [r.date for r in grp]
            navs = np.array([r.nav for r in grp], dtype=float)
            returns = (navs[1:] - navs[:-1]) / navs[:-1]
            nav_data[isin] = {"dates": dates[1:], "returns": returns}

        # Separate included vs excluded funds
        included = []
        excluded = []
        for isin in isin_list:
            d = nav_data.get(isin)
            if d is None or len(d['returns']) < min_days:
                days_available = len(d["returns"]) if d else 0
                excluded.append({
                    "isin": isin,
                    "days_available": days_available,
                    "years_available": round(days_available / 365, 1),
                    "reason": f"Only {round(days_available/365, 1)}Y of data available (minimum 3Y required)"
                })
            else:
                included.append(isin)

        if len(included) < 2:
            return {
                "included": [],
                "excluded": excluded,
                "matrix": [],
                "note": "Not enough funds with 3Y+ data to compute correlation."
            }

        # Build date→return lookup per fund
        lookup = {}
        for isin in included:
            d = nav_data[isin]
            lookup[isin] = dict(zip(d["dates"], d["returns"]))

        # Compute Pearson pairwise — each pair uses only their common dates
        # (much better than global intersection which eliminates data when
        #  funds have different NAV frequencies or inception dates)
        def pearson_pair(isin_i, isin_j):
            common = sorted(set(lookup[isin_i].keys()) & set(lookup[isin_j].keys()))
            if len(common) < 60:
                return None, len(common)
            a = np.array([lookup[isin_i][d] for d in common], dtype=float)
            b = np.array([lookup[isin_j][d] for d in common], dtype=float)
            mask = np.isfinite(a) & np.isfinite(b)
            if mask.sum() < 60:
                return None, int(mask.sum())
            a, b = a[mask], b[mask]
            if a.std() == 0 or b.std() == 0:
                return None, len(a)
            return float(np.corrcoef(a, b)[0, 1]), len(a)

        matrix = []
        min_common_days = None
        max_common_days = None
        for isin_i in included:
            row = []
            for isin_j in included:
                if isin_i == isin_j:
                    row.append(1.0)
                else:
                    v, n = pearson_pair(isin_i, isin_j)
                    row.append(v)
                    if v is not None:
                        min_common_days = n if min_common_days is None else min(min_common_days, n)
                        max_common_days = n if max_common_days is None else max(max_common_days, n)
            matrix.append(row)

        # Use end_date as date range reference
        return {
            "included": included,
            "excluded": excluded,
            "matrix": [[round(v, 3) if v is not None else None for v in row] for row in matrix],
            "common_days": max_common_days,
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            },
            "note": None
        }

    finally:
        db.close()

# ── Stress Test ────────────────────────────────────────────────────────────────

STRESS_SCENARIOS = [
    {"id": "gfc",        "name": "Global Financial Crisis",                    "label": "Jan 2008 – Oct 2008",  "start": "2008-01-01", "end": "2008-10-31"},
    {"id": "euro",       "name": "European Sovereign Debt Crisis",             "label": "Nov 2010 – Dec 2011",  "start": "2010-11-01", "end": "2011-12-31"},
    {"id": "china",      "name": "China Slowdown & Yuan Devaluation",          "label": "Mar 2015 – Feb 2016",  "start": "2015-03-01", "end": "2016-02-29"},
    {"id": "ilfs",       "name": "IL&FS / NBFC Credit Crisis",                 "label": "Aug 2018 – Oct 2018",  "start": "2018-08-01", "end": "2018-10-31"},
    {"id": "covid",      "name": "Covid-19 Crash",                             "label": "Jan 2020 – Mar 2020",  "start": "2020-01-01", "end": "2020-03-31"},
    {"id": "fiirerating","name": "FII-Driven Rerating",                        "label": "Sep 2024 – Mar 2026",  "start": "2024-09-01", "end": "2026-03-31"},
]

@router.get("/stress-test")
def get_stress_test(isins: str, weights: str):
    """
    For each historical stress scenario, compute actual portfolio return using
    weighted NAV history from the DB, and Nifty 500 return from benchmark_nav table.

    isins:   comma-separated ISINs
    weights: comma-separated weights (same order, summing to 100)
    """
    from models.database import SessionLocal, NavHistory

    isin_list = [i.strip() for i in isins.split(",") if i.strip()]
    weight_list = [float(w.strip()) / 100 for w in weights.split(",") if w.strip()]

    if len(isin_list) != len(weight_list):
        raise HTTPException(400, "ISINs and weights must have same length")

    # Fetch Nifty 500 returns from benchmark_nav (same source as blended benchmark)
    # Using benchmark_nav ensures consistency — both Nifty 500 and blended BM
    # come from the same data source and the same date conventions.
    nifty500_returns = {}
    try:
        from sqlalchemy import text
        from models.database import engine
        # Compute full date range needed
        sc_starts = [date.fromisoformat(sc["start"]) for sc in STRESS_SCENARIOS]
        sc_ends   = [date.fromisoformat(sc["end"])   for sc in STRESS_SCENARIOS]
        with engine.connect() as conn:
            # ONE query for all scenario dates
            rows = conn.execute(text("""
                SELECT nav_date, value FROM benchmark_nav
                WHERE index_name = 'Nifty 500'
                  AND nav_date >= CAST(:s AS date) - INTERVAL '10 days'
                  AND nav_date <= CAST(:e AS date) + INTERVAL '10 days'
                ORDER BY nav_date ASC
            """), {"s": min(sc_starts).isoformat(), "e": max(sc_ends).isoformat()}).fetchall()
        nifty_nav = {r[0]: float(r[1]) for r in rows}
        def nearest_nifty(target, prefer_after=True):
            candidates = [(d, v) for d, v in nifty_nav.items() if abs((d - target).days) <= 10]
            if not candidates: return None
            if prefer_after:
                after = [(d, v) for d, v in candidates if d >= target]
                return min(after, key=lambda x: x[0])[1] if after else min(candidates, key=lambda x: abs((x[0]-target).days))[1]
            else:
                before = [(d, v) for d, v in candidates if d <= target]
                return max(before, key=lambda x: x[0])[1] if before else min(candidates, key=lambda x: abs((x[0]-target).days))[1]
        for sc in STRESS_SCENARIOS:
            sv = nearest_nifty(date.fromisoformat(sc["start"]), prefer_after=True)
            ev = nearest_nifty(date.fromisoformat(sc["end"]),   prefer_after=False)
            nifty500_returns[sc["id"]] = round((ev/sv - 1)*100, 2) if sv and ev and sv > 0 else None
        logger.info(f"Nifty 500 stress returns from benchmark_nav: {nifty500_returns}")
    except Exception as e:
        logger.warning(f"Nifty 500 benchmark_nav fetch failed: {e}")
        nifty500_returns = {sc["id"]: None for sc in STRESS_SCENARIOS}

    # Compute date range needed across ALL scenarios
    all_starts = [date.fromisoformat(sc["start"]) - timedelta(days=10) for sc in STRESS_SCENARIOS]
    all_ends   = [date.fromisoformat(sc["end"])   + timedelta(days=10) for sc in STRESS_SCENARIOS]
    global_start = min(all_starts)
    global_end   = max(all_ends)

    db = SessionLocal()
    try:
        # ONE bulk query for all funds across the full date range
        all_rows = (
            db.query(NavHistory.isin, NavHistory.date, NavHistory.nav)
            .filter(
                NavHistory.isin.in_(isin_list),
                NavHistory.date >= global_start,
                NavHistory.date <= global_end,
                NavHistory.nav != None,
            )
            .order_by(NavHistory.isin, NavHistory.date)
            .all()
        )

        # Build in-memory lookup: {isin: [(date, nav), ...]} sorted by date
        from collections import defaultdict
        nav_lookup = defaultdict(list)
        for row in all_rows:
            nav_lookup[row.isin].append((row.date, row.nav))

        def nearest_nav(isin, target_date, direction='nearest'):
            """Find NAV nearest to target_date within ±10 days."""
            rows = nav_lookup.get(isin, [])
            if not rows: return None
            candidates = [(d, n) for d, n in rows if abs((d - target_date).days) <= 10]
            if not candidates: return None
            if direction == 'start':
                # Prefer dates >= target (first available on or after)
                after = [(d, n) for d, n in candidates if d >= target_date]
                return min(after, key=lambda x: x[0]) if after else min(candidates, key=lambda x: abs((x[0] - target_date).days))
            else:
                # Prefer dates <= target (last available on or before)
                before = [(d, n) for d, n in candidates if d <= target_date]
                return max(before, key=lambda x: x[0]) if before else min(candidates, key=lambda x: abs((x[0] - target_date).days))

        results = []
        for sc in STRESS_SCENARIOS:
            start = date.fromisoformat(sc["start"])
            end   = date.fromisoformat(sc["end"])

            fund_returns = {}
            has_data = False

            for isin in isin_list:
                sv = nearest_nav(isin, start, 'start')
                ev = nearest_nav(isin, end,   'end')

                if sv and ev and sv[1] and ev[1] and sv[0] != ev[0]:
                    ret = (ev[1] / sv[1] - 1) * 100
                    fund_returns[isin] = round(ret, 2)
                    has_data = True
                else:
                    fund_returns[isin] = None

            portfolio_return = None
            if has_data:
                weighted_sum = 0
                weight_used  = 0
                for isin, wt in zip(isin_list, weight_list):
                    if fund_returns.get(isin) is not None:
                        weighted_sum += fund_returns[isin] * wt
                        weight_used  += wt
                if weight_used > 0:
                    portfolio_return = round(weighted_sum / weight_used, 2)

            nifty_ret = nifty500_returns.get(sc["id"])
            cushion = round(portfolio_return - nifty_ret, 2) if portfolio_return is not None and nifty_ret is not None else None

            results.append({
                **sc,
                "portfolio_return": portfolio_return,
                "nifty500_return": nifty_ret,
                "cushion": cushion,
                "fund_returns": fund_returns,
                "has_data": has_data,
            })

        return {"scenarios": results, "isins": isin_list, "weights": weight_list}

    finally:
        db.close()


@router.get("/fetch-log")
def fetch_log(isin: str = Query(...), limit: int = 5):
    """Show recent fetch log entries for an ISIN — confirms which source was used."""
    from models.database import SessionLocal, NavFetchLog
    db = SessionLocal()
    try:
        rows = (
            db.query(NavFetchLog)
            .filter(NavFetchLog.isin == isin)
            .order_by(NavFetchLog.id.desc())
            .limit(limit)
            .all()
        )
        return {"isin": isin, "log": [
            {"status": r.status, "rows_added": r.rows_added, "message": r.message, "fetched_at": str(r.fetched_at)}
            for r in rows
        ]}
    finally:
        db.close()


def test_mstar_price(isin: str = Query(..., description="Fund ISIN e.g. INF966L01457")):
    """
    Test endpoint — verifies that Morningstar Price API returns daily NAV
    for a given ISIN using the stored accesscode.
    Fetches last 10 days only. Safe to call repeatedly.
    """
    import requests
    import xml.etree.ElementTree as ET
    from datetime import date, timedelta
    from services.morningstar_service import get_valid_accesscode

    accesscode = get_valid_accesscode()
    if not accesscode:
        return {"status": "error", "error": "No valid Morningstar accesscode in DB"}

    end = date.today()
    start = end - timedelta(days=10)

    url = f"https://api.morningstar.com/service/mf/Price/isin/{isin}"
    params = {
        "accesscode": accesscode,
        "startdate": start.isoformat(),
        "enddate": end.isoformat(),
    }

    try:
        resp = requests.get(url, params=params, timeout=20)
        raw_status = resp.status_code
        raw_text = resp.text[:2000]  # cap for safety

        if resp.status_code != 200:
            return {
                "status": "error",
                "isin": isin,
                "http_status": raw_status,
                "response_preview": raw_text,
            }

        # Try JSON first
        rows = []
        parse_method = None
        try:
            data = resp.json()
            parse_method = "json"
            # Expected shape based on screenshot: list of {Date, Value}
            items = data if isinstance(data, list) else data.get("data", data.get("Prices", []))
            for item in items:
                d = item.get("Date") or item.get("date")
                v = item.get("Value") or item.get("nav") or item.get("value")
                if d and v:
                    rows.append({"date": str(d), "nav": float(v)})
        except Exception:
            # Fall back to XML
            try:
                parse_method = "xml"
                root = ET.fromstring(resp.text)
                for p in root.findall(".//p"):
                    d = p.attrib.get("d")
                    v = p.attrib.get("v")
                    if d and v:
                        rows.append({"date": d, "nav": float(v)})
            except Exception as xml_err:
                return {
                    "status": "error",
                    "isin": isin,
                    "http_status": raw_status,
                    "parse_error": str(xml_err),
                    "response_preview": raw_text,
                }

        return {
            "status": "ok" if rows else "no_data",
            "isin": isin,
            "http_status": raw_status,
            "parse_method": parse_method,
            "date_range": f"{start} to {end}",
            "rows_returned": len(rows),
            "sample": rows[:5],
            "raw_preview": raw_text if not rows else None,
        }

    except requests.RequestException as e:
        return {"status": "error", "isin": isin, "error": str(e)}