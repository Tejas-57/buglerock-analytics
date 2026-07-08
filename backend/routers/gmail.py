"""
routers/gmail.py
Gmail OAuth management endpoints.
"""
from fastapi import APIRouter
from pathlib import Path

router = APIRouter()


@router.post("/store-token")
def store_token():
    """
    One-time setup: read gmail_token.json from Render secret files
    and store it in the DB for permanent use.
    Call this once after deploying to Render.
    """
    try:
        from services.gmail_watcher import store_token_from_file
        store_token_from_file()
        return {"success": True, "message": "Gmail token stored in DB successfully"}
    except FileNotFoundError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/status")
def gmail_status():
    """Check if Gmail token is present and valid."""
    try:
        from services.db_service import get_setting
        from services.gmail_watcher import TOKEN_DB_KEY, TOKEN_FILE_PATH
        import json
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        token_json = get_setting(TOKEN_DB_KEY)
        source = "database"

        if not token_json and Path(TOKEN_FILE_PATH).exists():
            token_json = Path(TOKEN_FILE_PATH).read_text()
            source = "file"

        if not token_json:
            return {"status": "no_token", "message": "No Gmail token found anywhere"}

        creds = Credentials.from_authorized_user_info(json.loads(token_json))
        return {
            "status": "ok" if creds.valid else "expired",
            "source": source,
            "valid": creds.valid,
            "expired": creds.expired,
            "has_refresh_token": bool(creds.refresh_token),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.post("/refresh-token")
def refresh_token():
    """Force a token refresh and save back to DB."""
    try:
        from services.gmail_watcher import get_gmail_service
        get_gmail_service()
        return {"success": True, "message": "Token refreshed and saved to DB"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/reparse")
def force_reparse():
    """
    Re-fetch and re-parse the latest Morningstar email from Gmail, bypassing
    the "already processed" check. Use this after a parser.py fix to
    immediately apply the updated parsing logic to the most recent data
    without needing to manually supply a file path.

    Runs synchronously — may take 30-60 seconds depending on file size.
    """
    try:
        from services.gmail_watcher import fetch_latest
        result = fetch_latest(check_days=3, force=True)
        if result:
            return {"success": True, "message": "Latest email re-parsed and saved successfully"}
        else:
            return {"success": False, "message": "No email found or re-parse did not produce new data"}
    except Exception as e:
        return {"success": False, "error": str(e)}