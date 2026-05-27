# routers/funds.py
from fastapi import APIRouter, Query, UploadFile
from datetime import date as date_type, timedelta
from services.db_service import (
    get_asset_classes, get_categories, get_funds_for_dropdown,
    has_data_for_date, get_latest_data_date
)
from services.gmail_watcher import fetch_latest, get_gmail_service, GMAIL_SENDER, SUBJECT_KEYWORD
from utils.trading_calendar import resolve_user_date

router = APIRouter()


def resolve_date(date_str: str = None) -> date_type:
    if date_str:
        d = date_type.fromisoformat(date_str)
    else:
        d = date_type.today()
    return resolve_user_date(d)


def ensure_todays_data():
    """Fetch latest email if we don't have today's data yet."""
    fetch_latest(check_days=3)


@router.get("/asset-classes")
def asset_classes(date: str = Query(None)):
    d = resolve_date(date)
    ensure_todays_data()
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


@router.get("/fetch")
def manual_fetch():
    """Manually trigger fetch — checks today and 3 days back."""
    success = fetch_latest(check_days=3)
    return {
        "success": success,
        "message": "Data loaded successfully" if success else "No new email found"
    }


@router.get("/debug-gmail")
def debug_gmail():
    """Debug Gmail — show recent emails from Morningstar and what the search finds."""
    import datetime
    today = datetime.date.today()

    try:
        service = get_gmail_service()

        results = []
        for days_back in range(0, 4):
            email_date = today - timedelta(days=days_back)
            after  = email_date.strftime("%Y/%m/%d")
            before = (email_date + timedelta(days=1)).strftime("%Y/%m/%d")
            query  = f"from:{GMAIL_SENDER} subject:{SUBJECT_KEYWORD} has:attachment after:{after} before:{before}"
            result = service.users().messages().list(userId="me", q=query).execute()
            messages = result.get("messages", [])

            msg_details = []
            for m in messages[:3]:
                msg = service.users().messages().get(
                    userId="me", id=m["id"], format="full"
                ).execute()
                headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
                parts = msg.get("payload", {}).get("parts", [])
                attachment_names = _list_all_parts(parts)
                msg_details.append({
                    "id": m["id"],
                    "subject": headers.get("Subject", ""),
                    "date": headers.get("Date", ""),
                    "parts_found": attachment_names,
                })

            results.append({
                "email_date": str(email_date),
                "data_date": str(email_date - timedelta(days=1)),
                "match_count": len(messages),
                "messages": msg_details,
            })

        # Also show broad search
        broad = service.users().messages().list(
            userId="me", q=f"from:{GMAIL_SENDER}", maxResults=5
        ).execute()
        recent = []
        for m in broad.get("messages", [])[:5]:
            msg = service.users().messages().get(
                userId="me", id=m["id"], format="metadata",
                metadataHeaders=["Subject", "Date"]
            ).execute()
            headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
            recent.append({"subject": headers.get("Subject", ""), "date": headers.get("Date", "")})

        return {
            "today": str(today),
            "date_search_results": results,
            "recent_from_morningstar": recent,
        }
    except Exception as e:
        return {"error": str(e)}


def _list_all_parts(parts, depth=0):
    """Recursively list all MIME parts and filenames."""
    found = []
    for part in parts:
        fname = part.get("filename", "")
        mime  = part.get("mimeType", "")
        found.append(f"{'  '*depth}[{mime}] fname='{fname}'")
        nested = part.get("parts", [])
        if nested:
            found.extend(_list_all_parts(nested, depth+1))
    return found


@router.post("/upload")
async def upload_file(file: "UploadFile", date: str = Query(...)):
    """Directly upload an Excel file — bypasses Gmail."""
    import tempfile, os
    from services.parser import parse_excel_file
    from services.db_service import save_parsed_data

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