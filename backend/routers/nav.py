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