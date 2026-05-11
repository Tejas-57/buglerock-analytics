"""
gmail_watcher.py
Watches tejas.s@buglerock.asia inbox via Gmail API push notifications.
Applies X+1 date offset and NSE holiday logic to fetch the correct file.
"""

import os
import asyncio
import logging
import tempfile
from datetime import date, timedelta
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import base64

from services.db_service import (
    has_data_for_date,
    save_parsed_data,
    log_email_fetch,
)
from services.parser import parse_excel_file
from utils.trading_calendar import get_email_date_for, is_trading_day

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
GMAIL_USER       = os.getenv("GMAIL_USER", "tejas.s@buglerock.asia")
GMAIL_SENDER     = os.getenv("GMAIL_SENDER", "sujaya.l@alerts-morningstar.com")
SUBJECT_KEYWORD  = os.getenv("GMAIL_SUBJECT_KEYWORD", "Singlesheet_Daily_Fund_Metrics")
CREDENTIALS_PATH = os.getenv("GMAIL_CREDENTIALS_PATH", "credentials/gmail_credentials.json")
TOKEN_PATH       = os.getenv("GMAIL_TOKEN_PATH", "credentials/gmail_token.json")

# Poll interval when push is not available (fallback)
POLL_INTERVAL_SECONDS = 300  # 5 minutes


def get_gmail_service():
    """Authenticate and return Gmail API service."""
    creds = None

    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        Path(TOKEN_PATH).parent.mkdir(parents=True, exist_ok=True)
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return build("gmail", "v1", credentials=creds)


def search_emails_for_date(service, target_email_date: date):
    """
    Search Gmail for the target email sent on target_email_date.
    Returns list of matching message IDs.
    """
    after  = target_email_date.strftime("%Y/%m/%d")
    before = (target_email_date + timedelta(days=1)).strftime("%Y/%m/%d")

    # Use a partial subject keyword — the actual subject is:
    # "Morningstar Performance Reporting batch [Singlesheet_Daily_Fund_Metrics] has finished."
    # We search without the full subject to avoid bracket/punctuation matching issues
    query = (
        f"from:{GMAIL_SENDER} "
        f"subject:Singlesheet_Daily_Fund_Metrics "
        f"has:attachment "
        f"after:{after} "
        f"before:{before}"
    )

    result = service.users().messages().list(userId="me", q=query).execute()
    return result.get("messages", [])


def download_xlsx_attachment(service, message_id: str) -> tuple:
    """
    Download the .xlsx attachment from the email.
    Returns (file_bytes, filename) or (None, None).
    """
    msg = service.users().messages().get(userId="me", id=message_id).execute()

    for part in msg.get("payload", {}).get("parts", []):
        fname = part.get("filename", "")
        if fname.endswith(".xlsx") and SUBJECT_KEYWORD in fname:
            body = part.get("body", {})
            att_id = body.get("attachmentId")
            if att_id:
                att = service.users().messages().attachments().get(
                    userId="me", messageId=message_id, id=att_id
                ).execute()
                data = base64.urlsafe_b64decode(att["data"])
                return data, fname

    return None, None


def fetch_and_store(data_date: date):
    """
    Main logic: given a data_date (what the user wants),
    calculate the correct email date, search Gmail, download,
    parse and store.
    """
    if has_data_for_date(data_date):
        logger.info(f"Data for {data_date} already in DB — skipping fetch")
        return True

    # Calculate email date (data_date + 1, skipping non-trading days)
    email_date = get_email_date_for(data_date)
    logger.info(f"Fetching email for data_date={data_date}, email_date={email_date}")

    try:
        service = get_gmail_service()
        messages = search_emails_for_date(service, email_date)

        if not messages:
            logger.warning(f"No email found for email_date={email_date}")
            log_email_fetch(email_date, data_date, None, "failed", "No matching email found")
            return False

        # Take first matching email
        msg_id = messages[0]["id"]
        file_bytes, file_name = download_xlsx_attachment(service, msg_id)

        if not file_bytes:
            logger.warning(f"No .xlsx attachment found in email {msg_id}")
            log_email_fetch(email_date, data_date, None, "failed", "No xlsx attachment")
            return False

        # Save to temp file and parse
        # Use delete=False and manual cleanup — required on Windows (WinError 32)
        tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        try:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        finally:
            tmp.close()  # Must close before parsing on Windows

        try:
            parsed = parse_excel_file(
                file_path=tmp_path,
                data_date=str(data_date),
                email_date=str(email_date),
                file_name=file_name,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass  # Best effort cleanup

        save_parsed_data(parsed)
        log_email_fetch(email_date, data_date, file_name, "success", f"Parsed {len(parsed['funds'])} funds")
        logger.info(f"Successfully stored data for {data_date} from {file_name}")
        return True

    except Exception as e:
        logger.error(f"Error fetching email for {data_date}: {e}", exc_info=True)
        log_email_fetch(email_date, data_date, None, "failed", str(e))
        return False


async def start_gmail_watcher():
    """
    Background task: poll for today's email every POLL_INTERVAL_SECONDS.
    Runs indefinitely — reacts to new emails as they arrive.
    """
    logger.info("Gmail watcher started — polling every 5 minutes")

    while True:
        try:
            today = date.today()
            # Only fetch if today is a trading day
            if is_trading_day(today):
                if not has_data_for_date(today):
                    logger.info(f"Checking for today's data ({today})...")
                    fetch_and_store(today)
                else:
                    logger.debug(f"Today's data ({today}) already stored")
        except Exception as e:
            logger.error(f"Gmail watcher error: {e}", exc_info=True)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)