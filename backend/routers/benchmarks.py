# backend/routers/benchmarks.py
from fastapi import APIRouter, Query
from models.database import SessionLocal, DailyFundData
from sqlalchemy import func
from typing import Optional

router = APIRouter()

def trim_bm_name(name: str) -> str:
    """Remove TR INR / PR INV suffixes for display."""
    for suffix in [' TR INR', ' PR INR', 'TR INR', 'PR INR']:
        name = name.replace(suffix, '').strip()
    return name

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
            if not r.name or r.name in seen:
                continue
            seen.add(r.name)
            results.append({
                "name":          r.name,
                "display_name":  trim_bm_name(r.name),
                "return_1m":     r.return_1m,
                "return_3m":     r.return_3m,
                "return_6m":     r.return_6m,
                "return_1y":     r.return_1y,
                "return_3y":     r.return_3y,
                "return_5y":     r.return_5y,
                "return_ytd":    r.return_ytd,
                "return_cy2025": r.return_cy2025,
                "return_cy2024": r.return_cy2024,
                "return_cy2023": r.return_cy2023,
                "return_cy2022": r.return_cy2022,
                "return_cy2021": r.return_cy2021,
                "sharpe_ratio_3y": r.sharpe_ratio_3y,
                "std_dev_3y":    r.std_dev_3y,
            })

        results.sort(key=lambda x: x["display_name"])
        return {"benchmarks": results, "count": len(results)}
    finally:
        db.close()


# ── Benchmark NAV time series endpoints ───────────────────────────────────────

@router.get("/benchmarks/indices")
def get_benchmark_indices():
    """Return list of all available benchmark indices in the NAV history table."""
    try:
        from services.benchmark_db_service import get_available_indices
        indices = get_available_indices()
        return {"indices": indices, "count": len(indices)}
    except Exception as e:
        return {"indices": [], "error": str(e)}


@router.get("/benchmarks/nav-history")
def get_benchmark_nav_history(
    index: str = Query(..., description="Index name, e.g. 'Nifty 50'"),
    from_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
):
    """
    Return daily NAV history for a benchmark index.
    Source: benchmark_nav table (synced from Google Sheet).
    """
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
    """Return the most recent NAV value for an index."""
    try:
        from services.benchmark_db_service import get_latest_value
        result = get_latest_value(index)
        return result or {"index": index, "error": "No data found"}
    except Exception as e:
        return {"index": index, "error": str(e)}


@router.post("/benchmarks/sync")
def sync_benchmarks():
    """
    Manually trigger a full sync from Google Sheet → DB.
    Also polls Gmail for any unprocessed benchmark emails.
    """
    try:
        from services.benchmark_db_service import sync_sheet_to_db
        from services.benchmark_watcher import fetch_all_benchmarks
        sheet_result = sync_sheet_to_db()
        email_result = fetch_all_benchmarks(check_days=5)
        return {"sheet_sync": sheet_result, "email_fetch": email_result}
    except Exception as e:
        return {"error": str(e)}