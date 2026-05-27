"""
gmail_watcher.py
Fetches the daily Morningstar email and parses the attachment.

Email logic:
  - Email arrives on day X containing data as of day X-1
  - We search Gmail for TODAY's email
  - data_date = email_date - 1 day
  - Checks today and up to 3 days back

Token stored permanently in PostgreSQL DB.
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
ATTACHMENT_KEYWORD = "New Singlesheet Daily MF Report"
TOKEN_DB_KEY       = "gmail_token"

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
    try:
        val = get_setting(TOKEN_DB_KEY)
        if val:
            return val
    except Exception as e:
        logger.warning(f"Could not load token from DB: {e}")
    if Path(TOKEN_FILE_PATH).exists():
        return Path(TOKEN_FILE_PATH).read_text()
    return None


def _save_token_json(token_json: str):
    try:
        set_setting(TOKEN_DB_KEY, token_json)
        logger.info("Gmail token saved to DB")
    except Exception as e:
        logger.error(f"Could not save token to DB: {e}")
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
            raise RuntimeError("No valid Gmail token. Call POST /api/gmail/store-token first.")
    return build("gmail", "v1", credentials=creds)


def store_token_from_file(token_path: str = None):
    path = token_path or TOKEN_FILE_PATH
    if not Path(path).exists():
        raise FileNotFoundError(f"Token file not found: {path}")
    _save_token_json(Path(path).read_text())
    return True


def search_emails_for_date(service, email_date: date) -> list:
    after  = email_date.strftime("%Y/%m/%d")
    before = (email_date + timedelta(days=1)).strftime("%Y/%m/%d")
    query  = (
        f"from:{GMAIL_SENDER} "
        f"subject:{SUBJECT_KEYWORD} "
        f"has:attachment "
        f"after:{after} "
        f"before:{before}"
    )
    result = service.users().messages().list(userId="me", q=query).execute()
    return result.get("messages", [])


def _find_attachment_in_parts(parts, service, message_id):
    """Recursively search all MIME parts for the .xlsx attachment."""
    for part in parts:
        fname = part.get("filename", "")
        mime  = part.get("mimeType", "")

        # Found the xlsx
        if fname.endswith(".xlsx") and ATTACHMENT_KEYWORD in fname:
            body   = part.get("body", {})
            att_id = body.get("attachmentId")
            data   = body.get("data")

            if att_id:
                att = service.users().messages().attachments().get(
                    userId="me", messageId=message_id, id=att_id
                ).execute()
                data = att.get("data", "")

            if data:
                file_bytes = base64.urlsafe_b64decode(data)
                return file_bytes, fname

        # Recurse into nested parts
        nested = part.get("parts", [])
        if nested:
            result = _find_attachment_in_parts(nested, service, message_id)
            if result[0]:
                return result

    return None, None


def download_attachment(service, message_id: str) -> tuple:
    """Download .xlsx attachment — handles nested MIME structures."""
    msg = service.users().messages().get(
        userId="me", id=message_id, format="full"
    ).execute()

    payload = msg.get("payload", {})

    # Try top-level parts first
    parts = payload.get("parts", [])
    if parts:
        file_bytes, fname = _find_attachment_in_parts(parts, service, message_id)
        if file_bytes:
            return file_bytes, fname

    # Try the payload body itself (single-part message)
    body = payload.get("body", {})
    fname = payload.get("filename", "")
    if fname.endswith(".xlsx") and ATTACHMENT_KEYWORD in fname:
        att_id = body.get("attachmentId")
        data   = body.get("data")
        if att_id:
            att = service.users().messages().attachments().get(
                userId="me", messageId=message_id, id=att_id
            ).execute()
            data = att.get("data", "")
        if data:
            return base64.urlsafe_b64decode(data), fname

    logger.warning(f"No .xlsx attachment found in message {message_id}")
    return None, None


def fetch_latest(check_days: int = 3) -> bool:
    """
    Try to fetch the most recent available Morningstar email.
    Checks today and up to check_days back.
    data_date = email_date - 1 day.
    Returns True if new data was loaded.
    """
    from services.db_service import has_data_for_date

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"Gmail auth failed: {e}")
        return False

    today = date.today()
    for days_back in range(0, check_days):
        email_date = today - timedelta(days=days_back)
        data_date  = email_date - timedelta(days=1)

        if has_data_for_date(data_date):
            logger.info(f"Data already present for {data_date}, skipping")
            continue

        logger.info(f"Checking Gmail for email_date={email_date} (data_date={data_date})")
        messages = search_emails_for_date(service, email_date)
        if not messages:
            logger.info(f"No email found for {email_date}")
            continue

        file_bytes, file_name = download_attachment(service, messages[0]["id"])
        if not file_bytes:
            continue

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
            logger.info(f"Loaded {len(parsed['funds'])} funds for {data_date}")
            return True
        except Exception as e:
            logger.error(f"Parse/save failed: {e}", exc_info=True)
            log_email_fetch(
                email_date=str(email_date),
                data_date=str(data_date),
                file_name=file_name or "",
                status="error",
                message=str(e),
            )
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    return False


def fetch_and_store(data_date: date) -> bool:
    return fetch_latest(check_days=3)