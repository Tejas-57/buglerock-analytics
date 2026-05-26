"""
gmail_watcher.py
Fetches the daily Morningstar email and parses the attachment.

New template:
  Sender:  sujaya.l@alerts-morningstar.com
  Subject: New Singlesheet Daily MF Report
  File:    New_Singlesheet_Daily_MF_Report_DDMMYYYY.xlsx

No historical fetching — daily only.
"""

import os
import base64
import tempfile
import logging
from datetime import date, timedelta
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from services.parser import parse_excel_file
from services.db_service import save_parsed_data, log_email_fetch

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Check Render secret files first, fall back to local credentials folder
CREDENTIALS_PATH = (
    "/etc/secrets/gmail_credentials.json"
    if Path("/etc/secrets/gmail_credentials.json").exists()
    else "credentials/gmail_credentials.json"
)
TOKEN_PATH = (
    "/etc/secrets/gmail_token.json"
    if Path("/etc/secrets/gmail_token.json").exists()
    else "credentials/gmail_token.json"
)

GMAIL_SENDER       = "sujaya.l@alerts-morningstar.com"
SUBJECT_KEYWORD    = "New Singlesheet Daily MF Report"
ATTACHMENT_KEYWORD = "New_Singlesheet_Daily_MF_Report"


def get_gmail_service():
    creds = None
    if Path(TOKEN_PATH).exists():
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        # Only write token if path is writable (won't work on Render /etc/secrets)
        try:
            with open(TOKEN_PATH, "w") as f:
                f.write(creds.to_json())
        except OSError:
            logger.warning(f"Could not write token to {TOKEN_PATH} — read-only path")
    return build("gmail", "v1", credentials=creds)


def search_emails_for_date(service, target_date: date) -> list:
    """Search Gmail for the daily report email sent on target_date."""
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
    """
    Download the .xlsx attachment from a Gmail message.
    Returns (file_bytes, file_name) or (None, None).
    """
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
    """
    Fetch today's email and store parsed data.
    Email date = data_date + 1 calendar day (Morningstar sends next day).
    Returns True if data was successfully loaded, False otherwise.
    """
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