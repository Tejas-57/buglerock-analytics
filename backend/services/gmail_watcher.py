"""
gmail_watcher.py
Fetches the daily Morningstar email and parses the attachment.
Token is stored in PostgreSQL DB — works permanently on Render.
"""

import os
import json
import base64
import tempfile
import logging
from datetime import date, timedelta
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from services.parser import parse_excel_file
from services.db_service import save_parsed_data, log_email_fetch, get_setting, set_setting

logger = logging.getLogger(__name__)

SCOPES             = ["https://www.googleapis.com/auth/gmail.readonly"]
GMAIL_SENDER       = "sujaya.l@alerts-morningstar.com"
SUBJECT_KEYWORD    = "New Singlesheet Daily MF Report"
ATTACHMENT_KEYWORD = "New_Singlesheet_Daily_MF_Report"

# DB key for storing token
TOKEN_DB_KEY = "gmail_token"

# Fallback file paths (local dev)
CREDENTIALS_PATH = (
    "/etc/secrets/gmail_credentials.json"
    if Path("/etc/secrets/gmail_credentials.json").exists()
    else "credentials/gmail_credentials.json"
)
TOKEN_FILE_PATH = (
    "/etc/secrets/gmail_token.json"
    if Path("/etc/secrets/gmail_token.json").exists()
    else "credentials/gmail_token.json"
)


def _load_token_json() -> str | None:
    """Load token JSON string — DB first, then file fallback."""
    # Try DB first
    try:
        val = get_setting(TOKEN_DB_KEY)
        if val:
            logger.info("Gmail token loaded from DB")
            return val
    except Exception as e:
        logger.warning(f"Could not load token from DB: {e}")

    # Fall back to file
    if Path(TOKEN_FILE_PATH).exists():
        logger.info(f"Gmail token loaded from file: {TOKEN_FILE_PATH}")
        return Path(TOKEN_FILE_PATH).read_text()

    return None


def _save_token_json(token_json: str):
    """Save token JSON string to DB (and file if writable)."""
    try:
        set_setting(TOKEN_DB_KEY, token_json)
        logger.info("Gmail token saved to DB")
    except Exception as e:
        logger.error(f"Could not save token to DB: {e}")

    # Also try file (works locally, silently fails on Render)
    try:
        Path(TOKEN_FILE_PATH).write_text(token_json)
    except OSError:
        pass


def get_gmail_service():
    creds = None
    token_json = _load_token_json()

    if token_json:
        creds = Credentials.from_authorized_user_info(json.loads(token_json), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            logger.info("Refreshing Gmail token...")
            creds.refresh(Request())
            _save_token_json(creds.to_json())
        else:
            raise RuntimeError(
                "No valid Gmail token found. Run the auth flow locally first: "
                "POST /api/gmail/init-auth"
            )

    return build("gmail", "v1", credentials=creds)


def store_token_from_file(token_path: str = None):
    """
    One-time utility: read token from file and store in DB.
    Call this after doing the OAuth flow locally.
    """
    path = token_path or TOKEN_FILE_PATH
    if not Path(path).exists():
        raise FileNotFoundError(f"Token file not found: {path}")
    token_json = Path(path).read_text()
    _save_token_json(token_json)
    logger.info(f"Token from {path} stored in DB successfully")
    return True


def search_emails_for_date(service, target_date: date) -> list:
    after  = target_date.strftime("%Y/%m/%d")
    before = (target_date + timedelta(days=1)).strftime("%Y/%m/%d")
    query  = (
        f"from:{GMAIL_SENDER} "
        f"subject:{SUBJECT_KEYWORD} "
        f"has:attachment "
        f"after:{after} "
        f"before:{before}"
    )
    result = service.users().messages().list(userId="me", q=query).execute()
    return result.get("messages", [])


def download_attachment(service, message_id: str) -> tuple:
    msg = service.users().messages().get(
        userId="me", id=message_id, format="full"
    ).execute()

    parts = msg.get("payload", {}).get("parts", [])
    for part in parts:
        fname = part.get("filename", "")
        if fname.endswith(".xlsx") and ATTACHMENT_KEYWORD in fname:
            body = part.get("body", {})
            att_id = body.get("attachmentId")
            if att_id:
                att = service.users().messages().attachments().get(
                    userId="me", messageId=message_id, id=att_id
                ).execute()
                data = att.get("data", "")
                file_bytes = base64.urlsafe_b64decode(data)
                return file_bytes, fname
    return None, None


def fetch_and_store(data_date: date) -> bool:
    email_date = data_date + timedelta(days=1)

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"Gmail auth failed: {e}")
        return False

    messages = search_emails_for_date(service, email_date)
    if not messages:
        logger.info(f"No email found for email_date={email_date}")
        return False

    file_bytes, file_name = download_attachment(service, messages[0]["id"])
    if not file_bytes:
        logger.warning(f"No .xlsx attachment found in email {messages[0]['id']}")
        return False

    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    try:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    finally:
        tmp.close()

    try:
        parsed = parse_excel_file(
            file_path=tmp_path,
            data_date=str(data_date),
            email_date=str(email_date),
            file_name=file_name,
        )
        save_parsed_data(parsed)
        log_email_fetch(
            email_date=str(email_date),
            data_date=str(data_date),
            file_name=file_name,
            status="success",
            message=f"Parsed {len(parsed['funds'])} funds",
        )
        logger.info(f"Successfully loaded {len(parsed['funds'])} funds for {data_date}")
        return True
    except Exception as e:
        logger.error(f"Parse/save failed for {data_date}: {e}", exc_info=True)
        log_email_fetch(
            email_date=str(email_date),
            data_date=str(data_date),
            file_name=file_name or "",
            status="error",
            message=str(e),
        )
        return False
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass