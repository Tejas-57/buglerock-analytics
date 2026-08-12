"""
benchmark_watcher.py
Polls Gmail for benchmark NAV emails:
  - NSE Nifty Multi Asset ZIP (from indices@nse.co.in, ~7:30 PM IST daily)
  - CRISIL Composite Bond Index Excel (from Crisil.Indices@crisil.com, variable time)

Called from gmail_poll_loop in main.py alongside the existing MF email watcher.
"""

import base64
import logging
import tempfile
import os
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

NSE_SENDER          = "indices@nse.co.in"
NSE_SUBJECT_KEYWORD = "Nifty Multi Asset"

CRISIL_SENDER          = "Crisil.Indices@crisil.com"
CRISIL_SUBJECT_KEYWORD = "CRISIL Indices"


def _search_gmail(service, sender: str, subject_kw: str, email_date: date) -> list:
    """Search Gmail for emails from sender with subject keyword on a specific date."""
    after  = email_date.strftime("%Y/%m/%d")
    before = (email_date + timedelta(days=1)).strftime("%Y/%m/%d")
    query  = f"from:{sender} subject:{subject_kw} has:attachment after:{after} before:{before}"
    result = service.users().messages().list(userId="me", q=query).execute()
    return result.get("messages", [])


def _download_attachment(service, message_id: str, ext: str) -> Optional[bytes]:
    """Download first attachment with given extension from a Gmail message."""
    msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    payload = msg.get("payload", {})

    def find_attachment(parts):
        for part in parts:
            fname = part.get("filename", "")
            if fname.lower().endswith(ext):
                body = part.get("body", {})
                att_id = body.get("attachmentId")
                data   = body.get("data")
                if att_id:
                    att  = service.users().messages().attachments().get(
                        userId="me", messageId=message_id, id=att_id
                    ).execute()
                    data = att.get("data", "")
                if data:
                    return base64.urlsafe_b64decode(data)
            # Recurse into nested parts
            sub = part.get("parts", [])
            if sub:
                result = find_attachment(sub)
                if result:
                    return result
        return None

    parts = payload.get("parts", [])
    return find_attachment(parts)


def fetch_nse_benchmark(check_days: int = 3) -> bool:
    """
    Check Gmail for NSE Nifty Multi Asset ZIP emails.
    Processes any unprocessed emails in the last check_days days.
    Returns True if any new data was processed.
    """
    from services.db_service import get_setting, set_setting
    from services.gmail_watcher import get_gmail_service
    from services.benchmark_parser import parse_nse_zip
    from services.benchmark_sheet_service import append_nifty_ma_row
    from services.benchmark_db_service import upsert_benchmark_rows

    INDEX_NAME = "Nifty Multi Asset 50:40:10"
    PROCESSED_KEY = "nse_benchmark_last_date"

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"NSE benchmark: Gmail auth failed: {e}")
        return False

    today = date.today()
    processed_any = False

    for days_back in range(0, check_days):
        email_date = today - timedelta(days=days_back)

        # Check if already processed
        last_processed = get_setting(PROCESSED_KEY)
        if last_processed == str(email_date):
            logger.info(f"NSE benchmark: {email_date} already processed")
            continue

        messages = _search_gmail(service, NSE_SENDER, NSE_SUBJECT_KEYWORD, email_date)
        if not messages:
            logger.info(f"NSE benchmark: no email found for {email_date}")
            continue

        logger.info(f"NSE benchmark: found email for {email_date}")

        # Download ZIP attachment
        zip_bytes = _download_attachment(service, messages[0]["id"], ".zip")
        if not zip_bytes:
            logger.warning(f"NSE benchmark: no ZIP attachment found for {email_date}")
            continue

        # Parse ZIP
        result = parse_nse_zip(zip_bytes)
        if not result:
            logger.warning(f"NSE benchmark: failed to parse ZIP for {email_date}")
            continue

        nav_date, value = result

        # Write to Google Sheet
        sheet_ok = append_nifty_ma_row(nav_date, value)
        if sheet_ok:
            logger.info(f"NSE benchmark: wrote {nav_date}={value} to sheet")

        # Write to DB directly too (don't depend on sheet sync)
        upsert_benchmark_rows([{"date": nav_date, "index_name": INDEX_NAME, "value": value}])
        logger.info(f"NSE benchmark: upserted {nav_date}={value} to DB")

        # Mark as processed
        set_setting(PROCESSED_KEY, str(email_date))
        processed_any = True

    return processed_any


def fetch_crisil_benchmark(check_days: int = 5) -> bool:
    """
    Check Gmail for CRISIL Composite Bond Index Excel emails.
    CRISIL email arrives at variable times — check last check_days days.
    Returns True if any new data was processed.
    """
    from services.db_service import get_setting, set_setting
    from services.gmail_watcher import get_gmail_service
    from services.benchmark_parser import parse_crisil_excel
    from services.benchmark_sheet_service import append_crisil_rows
    from services.benchmark_db_service import upsert_benchmark_rows

    INDEX_NAME   = "CRISIL Composite Bond Index"
    PROCESSED_KEY = "crisil_benchmark_last_email_date"

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"CRISIL benchmark: Gmail auth failed: {e}")
        return False

    today = date.today()
    processed_any = False

    for days_back in range(0, check_days):
        email_date = today - timedelta(days=days_back)

        # Check if already processed this email date
        last_processed = get_setting(PROCESSED_KEY)
        if last_processed == str(email_date):
            logger.info(f"CRISIL benchmark: {email_date} already processed")
            continue

        messages = _search_gmail(service, CRISIL_SENDER, CRISIL_SUBJECT_KEYWORD, email_date)
        if not messages:
            logger.info(f"CRISIL benchmark: no email found for {email_date}")
            continue

        logger.info(f"CRISIL benchmark: found email for {email_date}")

        # Download Excel attachment
        xlsx_bytes = _download_attachment(service, messages[0]["id"], ".xlsx")
        if not xlsx_bytes:
            logger.warning(f"CRISIL benchmark: no Excel attachment for {email_date}")
            continue

        # Parse Excel — returns full history
        rows = parse_crisil_excel(xlsx_bytes)
        if not rows:
            logger.warning(f"CRISIL benchmark: no data parsed from Excel for {email_date}")
            continue

        logger.info(f"CRISIL benchmark: parsed {len(rows)} rows")

        # Write to Google Sheet (only new dates)
        sheet_added = append_crisil_rows(rows)
        logger.info(f"CRISIL benchmark: added {sheet_added} new rows to sheet")

        # Write to DB
        db_rows = [{"date": d, "index_name": INDEX_NAME, "value": v} for d, v in rows]
        n = upsert_benchmark_rows(db_rows)
        logger.info(f"CRISIL benchmark: upserted {n} rows to DB")

        # Mark this email date as processed
        set_setting(PROCESSED_KEY, str(email_date))
        processed_any = True
        break  # CRISIL sends full history — no need to check older emails

    return processed_any


def fetch_all_benchmarks(check_days: int = 5) -> dict:
    """
    Run all benchmark email fetchers.
    Called from the main Gmail poll loop.
    """
    nse_result    = fetch_nse_benchmark(check_days=check_days)
    crisil_result = fetch_crisil_benchmark(check_days=check_days)
    return {"nse": nse_result, "crisil": crisil_result}