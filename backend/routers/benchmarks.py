# backend/routers/benchmarks.py
from fastapi import APIRouter
from models.database import SessionLocal, DailyFundData
from sqlalchemy import func

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