# backend/routers/benchmarks.py
from fastapi import APIRouter, Query, BackgroundTasks
from models.database import SessionLocal, DailyFundData
from sqlalchemy import func
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def trim_bm_name(name: str) -> str:
    for suffix in [' TR INR', ' PR INR', 'TR INR', 'PR INR']:
        name = name.replace(suffix, '').strip()
    return name


# ── Existing endpoint (fund benchmarks) ───────────────────────────────────────

@router.get("/benchmarks")
def get_benchmarks(date: str = None):
    """Return all unique Benchmark 1 entries from DailyFundData."""
    db = SessionLocal()
    try:
        if not date:
            latest = db.query(func.max(DailyFundData.data_date)).filter(
                DailyFundData.is_benchmark == 1
            ).scalar()
            if not latest:
                return {"benchmarks": [], "count": 0}
            date = str(latest)

        rows = db.query(DailyFundData).filter(
            DailyFundData.is_benchmark == 1,
            DailyFundData.benchmark_label == 'Benchmark 1',
            DailyFundData.name != None,
            DailyFundData.name != '',
            DailyFundData.data_date == date,
        ).all()

        seen = set()
        results = []
        for r in rows:
            if not r.name or r.name in seen: continue
            seen.add(r.name)
            results.append({
                "name": r.name, "display_name": trim_bm_name(r.name),
                "return_1m": r.return_1m, "return_3m": r.return_3m,
                "return_6m": r.return_6m, "return_1y": r.return_1y,
                "return_3y": r.return_3y, "return_5y": r.return_5y,
                "return_ytd": r.return_ytd,
                "return_cy2025": r.return_cy2025, "return_cy2024": r.return_cy2024,
                "return_cy2023": r.return_cy2023, "return_cy2022": r.return_cy2022,
                "return_cy2021": r.return_cy2021,
                "sharpe_ratio_3y": r.sharpe_ratio_3y, "std_dev_3y": r.std_dev_3y,
            })
        results.sort(key=lambda x: x["display_name"])
        return {"benchmarks": results, "count": len(results)}
    finally:
        db.close()


# ── Benchmark NAV time series ─────────────────────────────────────────────────

@router.get("/benchmarks/indices")
def get_benchmark_indices():
    """List all benchmark indices in the NAV history table with metadata."""
    try:
        from services.benchmark_db_service import get_available_indices
        return {"indices": get_available_indices()}
    except Exception as e:
        return {"indices": [], "error": str(e)}


@router.get("/benchmarks/nav-history")
def get_benchmark_nav_history(
    index: str = Query(...),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """Return daily NAV history for a benchmark index."""
    try:
        from services.benchmark_db_service import get_nav_history
        from datetime import date as date_type
        fd = date_type.fromisoformat(from_date) if from_date else None
        td = date_type.fromisoformat(to_date)   if to_date   else None
        rows = get_nav_history(index, fd, td)
        return {"index": index, "data": rows, "count": len(rows)}
    except Exception as e:
        return {"index": index, "data": [], "error": str(e)}


@router.get("/benchmarks/latest")
def get_benchmark_latest(index: str = Query(...)):
    try:
        from services.benchmark_db_service import get_latest_value
        return get_latest_value(index) or {"index": index, "error": "No data"}
    except Exception as e:
        return {"index": index, "error": str(e)}


@router.post("/benchmarks/sync")
async def sync_benchmarks(background_tasks: BackgroundTasks):
    """
    Poll Gmail for new NSE/CRISIL benchmark emails.
    Appends new rows to sheet and DB.
    Runs in background — returns immediately.
    """
    from services.benchmark_watcher import fetch_all_benchmarks

    def run():
        try:
            result = fetch_all_benchmarks(check_days=5)
            logger.info(f"sync_benchmarks: {result}")
        except Exception as e:
            logger.error(f"sync_benchmarks failed: {e}")

    background_tasks.add_task(run)
    return {"message": "Benchmark email check started in background"}


@router.post("/benchmarks/load-history")
async def load_historical(background_tasks: BackgroundTasks):
    """
    ONE-TIME: read entire Google Sheet → populate benchmark_nav table.
    Takes 1-3 minutes. Runs in background. Idempotent (safe to re-run).
    """
    from services.benchmark_db_service import load_historical_from_sheet

    def run():
        try:
            result = load_historical_from_sheet()
            logger.info(f"load_historical: {result}")
        except Exception as e:
            logger.error(f"load_historical failed: {e}")

    background_tasks.add_task(run)
    return {"message": "Historical load started in background — check /api/benchmarks/indices in 2-3 minutes"}


@router.get("/benchmarks/load-status")
def load_status():
    """Check if the historical load has completed."""
    try:
        from services.db_service import get_setting
        from services.benchmark_db_service import get_available_indices
        loaded = get_setting("benchmark_historical_loaded") == "yes"
        indices = get_available_indices() if loaded else []
        return {"historical_loaded": loaded, "index_count": len(indices), "indices": indices}
    except Exception as e:
        return {"error": str(e)}