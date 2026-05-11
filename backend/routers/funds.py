# routers/funds.py
from fastapi import APIRouter, Query
from datetime import date as date_type, timedelta
from services.db_service import get_asset_classes, get_categories, get_funds_for_dropdown, has_data_for_date
from services.gmail_watcher import fetch_and_store, get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD
from utils.trading_calendar import resolve_user_date, get_email_date_for

router = APIRouter()


def resolve_date(date_str: str = None) -> date_type:
    if date_str:
        d = date_type.fromisoformat(date_str)
    else:
        d = date_type.today()
    return resolve_user_date(d)


def ensure_data(d: date_type):
    """Fetch from Gmail if we don't have data for this date yet. Runs synchronously."""
    if not has_data_for_date(d):
        fetch_and_store(d)


@router.get("/asset-classes")
def asset_classes(date: str = Query(None)):
    d = resolve_date(date)
    ensure_data(d)
    return {"asset_classes": get_asset_classes(d), "date": str(d)}


@router.get("/categories")
def categories(asset_class: str, date: str = Query(None)):
    d = resolve_date(date)
    ensure_data(d)
    return {"categories": get_categories(d, asset_class), "date": str(d)}


@router.get("/list")
def fund_list(asset_class: str, category: str, date: str = Query(None)):
    d = resolve_date(date)
    ensure_data(d)
    funds = get_funds_for_dropdown(d, asset_class, category)
    return {"funds": funds, "date": str(d)}


@router.get("/fetch")
def manual_fetch(date: str = Query(...)):
    """Manually trigger a Gmail fetch for a specific date."""
    d = resolve_date(date)
    success = fetch_and_store(d)
    return {
        "date": str(d),
        "success": success,
        "message": "Data loaded successfully" if success else "No email found for this date"
    }


@router.get("/debug-gmail")
def debug_gmail(date: str = Query(...)):
    """Debug Gmail search for a given date."""
    d = resolve_date(date)
    email_date = get_email_date_for(d)

    try:
        service = get_gmail_service()

        after  = email_date.strftime("%Y/%m/%d")
        before = (email_date + timedelta(days=1)).strftime("%Y/%m/%d")
        query = f"from:{GMAIL_SENDER} subject:Singlesheet_Daily_Fund_Metrics has:attachment after:{after} before:{before}"
        result = service.users().messages().list(userId="me", q=query).execute()
        messages = result.get("messages", [])

        broad_query = f"from:{GMAIL_SENDER} has:attachment"
        broad_result = service.users().messages().list(userId="me", q=broad_query, maxResults=5).execute()
        broad_messages = broad_result.get("messages", [])

        broad_subjects = []
        for m in broad_messages[:5]:
            msg = service.users().messages().get(
                userId="me", id=m["id"], format="metadata",
                metadataHeaders=["subject", "date", "from"]
            ).execute()
            headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
            broad_subjects.append({
                "subject": headers.get("subject", ""),
                "date": headers.get("date", ""),
                "from": headers.get("from", "")
            })

        return {
            "data_date": str(d),
            "email_date_searched": str(email_date),
            "query_used": query,
            "exact_match_count": len(messages),
            "recent_emails_from_sender": broad_subjects
        }
    except Exception as e:
        return {"error": str(e)}