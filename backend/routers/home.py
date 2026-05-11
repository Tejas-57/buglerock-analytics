# routers/home.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.db_service import get_fund_snapshot
from utils.trading_calendar import resolve_user_date

router = APIRouter()


@router.get("/snapshot")
def fund_snapshot(isin: str, date: str = Query(None)):
    if date:
        d = resolve_user_date(date_type.fromisoformat(date))
    else:
        d = resolve_user_date(date_type.today())
    data = get_fund_snapshot(isin, d)
    if not data:
        raise HTTPException(status_code=404, detail=f"No data found for {isin} on {d}")
    return data