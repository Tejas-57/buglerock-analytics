# routers/home.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.db_service import get_fund_snapshot, get_latest_data_date

router = APIRouter()


@router.get("/snapshot")
def fund_snapshot(isin: str, date: str = Query(None)):
    if date:
        d = date_type.fromisoformat(date)
    else:
        d = get_latest_data_date() or date_type.today()
    data = get_fund_snapshot(isin, d)
    if not data:
        raise HTTPException(status_code=404, detail=f"No data found for {isin} on {d}")
    return data