# routers/peer.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.db_service import get_whitelisted_peers, get_peer_avg
from services.gmail_watcher import fetch_and_store
from utils.trading_calendar import resolve_user_date

router = APIRouter()

@router.get("/comparison")
def peer_comparison(isin: str, category: str, asset_class: str, date: str = Query(None)):
    d = resolve_user_date(date_type.fromisoformat(date) if date else date_type.today())
    fetch_and_store(d)
    peers    = get_whitelisted_peers(category, d, asset_class)
    peer_avg = get_peer_avg(category, d, asset_class)
    return {"peers": peers, "peer_avg": peer_avg, "date": str(d)}
