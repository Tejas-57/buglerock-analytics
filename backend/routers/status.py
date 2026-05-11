# routers/status.py
from fastapi import APIRouter
from services.db_service import get_latest_data_status

router = APIRouter()


@router.get("/status")
def status():
    return get_latest_data_status()
