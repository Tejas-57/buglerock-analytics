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


def fetch_latest(check_days: int = 5, force: bool = False, skip_holdings: bool = False) -> bool:
    """
    Fetch the most recent Morningstar email.
    data_date is taken directly from the nav_date in the Excel (most common nav_date).
    mail_date (email arrival date) is stored separately in AppSettings for reference.
    Returns True if new data was loaded.

    force=True: bypass both the email-level and data-level "already processed"
    checks, re-parsing and re-saving even if data exists in the DB for that
    date. Use after parser.py changes to immediately apply updated logic to
    the most recent data without needing a manual file path.
    """
    from services.db_service import has_data_for_date, has_email_for_date, set_setting
    from collections import Counter

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"Gmail auth failed: {e}")
        return False

    today = date.today()
    for days_back in range(0, check_days):
        email_date = today - timedelta(days=days_back)

        # Skip if we already successfully processed this email AND data exists in DB
        # (unless force=True, which bypasses this check entirely)
        if not force and has_email_for_date(email_date):
            # Double-check data actually exists in DB (may have been lost on DB switch)
            expected_data_date = email_date - timedelta(days=1)
            if has_data_for_date(expected_data_date):
                logger.info(f"Email already processed for {email_date}, skipping")
                continue
            else:
                logger.info(f"Email log shows processed but data missing for {expected_data_date}, re-fetching...")

        logger.info(f"Checking Gmail for email_date={email_date}")
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
            # Parse with a placeholder data_date; real date comes from nav_date in Excel
            parsed = parse_excel_file(
                file_path=tmp_path,
                data_date=str(email_date),  # temporary, will be overridden below
                email_date=str(email_date),
                file_name=file_name,
            )

            # Derive actual data_date from most common nav_date in the parsed funds
            # nav_date values from parser are already "YYYY-MM-DD" strings via safe_date()
            nav_dates = [f.get("nav_date") for f in parsed["funds"]
                        if f.get("nav_date") and f["nav_date"] not in ("-", None, "")]
            if nav_dates:
                # Filter to valid YYYY-MM-DD format dates only
                valid_dates = []
                for d in nav_dates:
                    try:
                        from datetime import date as dt
                        parsed_d = dt.fromisoformat(str(d))
                        # Sanity check: nav_date should not be in the future
                        if parsed_d < email_date:  # strictly less than email date — nav_date must be a previous day
                            valid_dates.append(str(parsed_d))
                    except Exception:
                        pass
                if valid_dates:
                    most_common_nav_date = Counter(valid_dates).most_common(1)[0][0]
                    parsed["data_date"] = most_common_nav_date
                    logger.info(f"Derived data_date={most_common_nav_date} from {len(valid_dates)} valid nav_dates in Excel")
                else:
                    parsed["data_date"] = str(email_date - timedelta(days=1))
                    logger.warning(f"No valid nav_dates found, falling back to email_date-1={parsed['data_date']}")
            else:
                # fallback to email_date - 1 if no nav_dates found
                parsed["data_date"] = str(email_date - timedelta(days=1))
                logger.warning(f"No nav_dates found, falling back to email_date-1={parsed['data_date']}")

            data_date = parsed["data_date"]

            # Update all fund and benchmark rows to use the correct data_date
            # (parse_excel_file bakes in email_date; we override here)
            for fund in parsed["funds"]:
                fund["data_date"] = data_date
            for bm in parsed["benchmarks"]:
                bm["data_date"] = data_date

            # Skip if we already have this nav_date in DB (unless force=True)
            from datetime import date as date_type
            dd = date_type.fromisoformat(data_date) if isinstance(data_date, str) else data_date
            if not force and has_data_for_date(dd):
                logger.info(f"Data already present for nav_date={data_date}, skipping")
                log_email_fetch(
                    email_date=str(email_date),
                    data_date=str(data_date),
                    file_name=file_name,
                    status="success",
                    message=f"Data already present for {data_date}",
                )
                continue

            save_parsed_data(parsed)

            # Holdings refresh — skipped when called from /reparse endpoint
            # (skip_holdings=True) to avoid blocking HTTP response for hours.
            # On normal daily automated runs, this runs in full.
            if not skip_holdings:
                try:
                    from services.morningstar_service import fetch_holdings_for_new_isins
                    new_fund_isins = [f.get("isin") for f in parsed["funds"] if f.get("isin")]
                    result = fetch_holdings_for_new_isins(new_fund_isins)
                    if result.get("new_found"):
                        logger.info(f"New-fund holdings fetch: {result}")
                except Exception as e:
                    logger.error(f"New-fund holdings fetch failed (non-fatal): {e}", exc_info=True)

                try:
                    from services.morningstar_service import fetch_branding_for_new_isins
                    branding_result = fetch_branding_for_new_isins(new_fund_isins)
                    if branding_result.get("updated"):
                        logger.info(f"New-fund branding fetch: {branding_result}")
                except Exception as e:
                    logger.error(f"New-fund branding fetch failed (non-fatal): {e}", exc_info=True)

                try:
                    from services.morningstar_service import refresh_stale_holdings
                    refresh_result = refresh_stale_holdings()
                    if not refresh_result.get("skipped") and refresh_result.get("stale_found", 0) > 0:
                        logger.info(f"Holdings freshness check: {refresh_result}")
                except Exception as e:
                    logger.error(f"Holdings freshness check failed (non-fatal): {e}", exc_info=True)

            # Store mail_date in AppSettings for reference
            set_setting("mail_date", str(email_date))

            log_email_fetch(
                email_date=str(email_date),
                data_date=str(data_date),
                file_name=file_name,
                status="success",
                message=f"Parsed {len(parsed['funds'])} funds for nav_date={data_date}",
            )
            logger.info(f"Loaded {len(parsed['funds'])} funds for nav_date={data_date} from email_date={email_date}")
            return True
        except Exception as e:
            logger.error(f"Parse/save failed: {e}", exc_info=True)
            log_email_fetch(
                email_date=str(email_date),
                data_date=str(email_date),
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