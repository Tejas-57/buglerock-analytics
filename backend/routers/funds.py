# routers/funds.py
from fastapi import APIRouter, Query, UploadFile
from datetime import date as date_type, timedelta
from services.db_service import (
    get_asset_classes, get_categories, get_funds_for_dropdown,
    has_data_for_date, get_latest_data_date
)
from services.gmail_watcher import fetch_and_store, get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD
from utils.trading_calendar import resolve_user_date

router = APIRouter()


def resolve_date(date_str: str = None) -> date_type:
    if date_str:
        d = date_type.fromisoformat(date_str)
    else:
        d = date_type.today()
    return resolve_user_date(d)


def ensure_todays_data(d: date_type):
    """
    Fetch today's email if we don't have data for yesterday yet.
    Email arrives today containing data as of yesterday.
    Only attempts for today — no historical fetching.
    """
    from datetime import timedelta
    yesterday = d - timedelta(days=1)
    if not has_data_for_date(yesterday):
        fetch_and_store()


@router.get("/asset-classes")
def asset_classes(date: str = Query(None)):
    d = resolve_date(date)
    ensure_todays_data(d)
    return {"asset_classes": get_asset_classes(d), "date": str(d)}


@router.get("/categories")
def categories(asset_class: str, date: str = Query(None)):
    d = resolve_date(date)
    return {"categories": get_categories(d, asset_class), "date": str(d)}


@router.get("/list")
def fund_list(asset_class: str, category: str, date: str = Query(None), all: bool = Query(False)):
    d = resolve_date(date)
    if all:
        from services.db_service import get_all_funds_for_dropdown
        funds = get_all_funds_for_dropdown(d, asset_class, category)
    else:
        funds = get_funds_for_dropdown(d, asset_class, category)
    return {"funds": funds, "date": str(d)}


@router.get("/search")
def search_funds(q: str, date: str = Query(None)):
    """Global fund search across all categories."""
    if not q or len(q.strip()) < 2:
        return {"funds": []}
    from services.db_service import search_funds_global
    d = resolve_date(date)
    funds = search_funds_global(q.strip(), d)
    return {"funds": funds, "date": str(d)}


@router.get("/fetch")
def manual_fetch(date: str = Query(...)):
    """Manually trigger fetch for a specific date — for testing/recovery only."""
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
    email_date = d + __import__('datetime').timedelta(days=1)

    try:
        service = get_gmail_service()
        after  = email_date.strftime("%Y/%m/%d")
        before = (email_date + __import__('datetime').timedelta(days=1)).strftime("%Y/%m/%d")
        query  = f"from:{GMAIL_SENDER} subject:{SUBJECT_KEYWORD} has:attachment after:{after} before:{before}"
        result = service.users().messages().list(userId="me", q=query).execute()
        messages = result.get("messages", [])

        broad = service.users().messages().list(
            userId="me", q=f"from:{GMAIL_SENDER} has:attachment", maxResults=5
        ).execute()
        recent = []
        for m in broad.get("messages", [])[:5]:
            msg = service.users().messages().get(
                userId="me", id=m["id"], format="metadata",
                metadataHeaders=["subject", "date"]
            ).execute()
            headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
            recent.append({"subject": headers.get("subject",""), "date": headers.get("date","")})

        return {
            "data_date": str(d),
            "email_date_searched": str(email_date),
            "query_used": query,
            "exact_match_count": len(messages),
            "recent_emails": recent,
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/upload")
async def upload_file(file: "UploadFile", date: str = Query(...)):
    """
    Directly upload an Excel file to load data — bypasses Gmail.
    e.g. POST /api/funds/upload?date=2026-05-12
    """
    import tempfile, os
    from services.parser import parse_excel_file
    from services.db_service import save_parsed_data
    from datetime import date as date_type

    d = resolve_date(date)
    contents = await file.read()

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    try:
        tmp.write(contents)
        tmp_path = tmp.name
    finally:
        tmp.close()

    try:
        parsed = parse_excel_file(
            file_path=tmp_path,
            data_date=str(d),
            email_date=str(d),
            file_name=file.filename,
        )
        save_parsed_data(parsed)
        return {
            "success": True,
            "date": str(d),
            "funds": len(parsed["funds"]),
            "benchmarks": len(parsed["benchmarks"]),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass