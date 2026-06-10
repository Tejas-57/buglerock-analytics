# backend/routers/nav.py
"""
NAV history endpoints for portfolio analytics.
"""

from fastapi import APIRouter, Query, BackgroundTasks
from datetime import date, timedelta
from typing import Optional

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