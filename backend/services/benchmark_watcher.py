"""
benchmark_watcher.py
Polls Gmail for benchmark NAV emails and syncs Apps-Script-populated tabs to DB:
  - NSE Nifty Multi Asset ZIP (from indices@nse.co.in, ~7:30 PM IST daily)
  - CRISIL Composite Bond Index Excel (from Crisil.Indices@crisil.com, variable time)
  - Nifty Indices tab (Yahoo Finance via Apps Script — 5 daily triggers)

STATELESS DESIGN:
  - No settings flags tracking "already processed"
  - Every poll searches Gmail for recent emails and reads sheet tail
  - DB upsert (ON CONFLICT DO UPDATE) handles deduplication automatically
  - Sheet append checks existing dates before writing
  - Self-healing: delete any row and it re-fetches within 5 minutes
"""

import base64
import logging
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

NSE_SENDER          = "indices@nse.co.in"
NSE_SUBJECT_KEYWORD = "Nifty Multi Asset"

CRISIL_SENDER          = "Crisil.Indices@crisil.com"
CRISIL_SUBJECT_KEYWORD = "CRISIL Indices"

NSE_INDEX_NAME    = "Nifty Multi Asset 50:40:10"
CRISIL_INDEX_NAME = "CRISIL Composite Bond Index"

# How many recent rows to read from the Nifty Indices tab on each poll.
# 20 rows ≈ 4 trading weeks of safety margin — well beyond anything Apps Script
# could conceivably backfill in one shot.
NIFTY_INDICES_TAIL_ROWS = 20


def _search_gmail_range(service, sender: str, subject_kw: str, days_back: int) -> list:
    """Search Gmail for emails in last N days."""
    today = date.today()
    after  = (today - timedelta(days=days_back)).strftime("%Y/%m/%d")
    before = (today + timedelta(days=1)).strftime("%Y/%m/%d")
    query  = f"from:{sender} subject:{subject_kw} has:attachment after:{after} before:{before}"
    result = service.users().messages().list(userId="me", q=query, maxResults=10).execute()
    return result.get("messages", [])


def _download_attachment(service, message_id: str, ext: str) -> Optional[bytes]:
    msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    payload = msg.get("payload", {})

    def find(parts):
        for part in parts:
            fname = part.get("filename", "")
            if fname.lower().endswith(ext):
                body = part.get("body", {})
                att_id = body.get("attachmentId")
                data = body.get("data")
                if att_id:
                    att = service.users().messages().attachments().get(
                        userId="me", messageId=message_id, id=att_id
                    ).execute()
                    data = att.get("data", "")
                if data:
                    return base64.urlsafe_b64decode(data)
            sub = part.get("parts", [])
            if sub:
                r = find(sub)
                if r:
                    return r
        return None

    return find(payload.get("parts", []))


# ── NSE Nifty Multi Asset ─────────────────────────────────────────────────────

def fetch_nse_benchmark(check_days: int = 5) -> dict:
    """
    Search Gmail for NSE Nifty Multi Asset emails in last N days.
    Only writes to sheet if data is genuinely new (not already in DB).
    """
    from services.gmail_watcher import get_gmail_service
    from services.benchmark_parser import parse_nse_zip
    from services.benchmark_sheet_service import append_nifty_ma_row
    from services.benchmark_db_service import upsert_benchmark_rows, get_latest_value

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"NSE: Gmail auth failed: {e}")
        return {"processed": 0, "error": str(e)}

    messages = _search_gmail_range(service, NSE_SENDER, NSE_SUBJECT_KEYWORD, check_days)
    if not messages:
        logger.info(f"NSE: no emails in last {check_days} days")
        return {"processed": 0}

    processed = 0
    for msg in messages:
        try:
            zip_bytes = _download_attachment(service, msg["id"], ".zip")
            if not zip_bytes:
                continue
            result = parse_nse_zip(zip_bytes)
            if not result:
                continue
            nav_date, value = result

            # Check DB first — if already there, skip sheet write entirely
            existing = get_latest_value(NSE_INDEX_NAME)
            already_in_db = existing and existing.get("date") == str(nav_date)

            # Upsert to DB
            upsert_benchmark_rows([{"date": nav_date, "index_name": NSE_INDEX_NAME, "value": value}])

            # Only write to sheet if it was genuinely new data
            if not already_in_db:
                append_nifty_ma_row(nav_date, value)
                logger.info(f"NSE: new data {nav_date} = {value} — written to sheet + DB")
            else:
                logger.info(f"NSE: {nav_date} already in DB — skipped sheet write")

            processed += 1
        except Exception as e:
            logger.warning(f"NSE: error processing message {msg.get('id')}: {e}")

    return {"processed": processed}


# ── CRISIL Composite ──────────────────────────────────────────────────────────

def fetch_crisil_benchmark(check_days: int = 5) -> dict:
    """
    Search Gmail for CRISIL Composite Bond Index emails in last N days.
    Parse full history from Excel, upsert only new dates to DB and sheet.
    """
    from services.gmail_watcher import get_gmail_service
    from services.benchmark_parser import parse_crisil_excel
    from services.benchmark_sheet_service import append_crisil_rows
    from services.benchmark_db_service import upsert_benchmark_rows

    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"CRISIL: Gmail auth failed: {e}")
        return {"processed": 0, "error": str(e)}

    messages = _search_gmail_range(service, CRISIL_SENDER, CRISIL_SUBJECT_KEYWORD, check_days)
    if not messages:
        logger.info(f"CRISIL: no emails in last {check_days} days")
        return {"processed": 0}

    # Only need to process the most recent CRISIL email since it has full history
    latest_msg = messages[0]

    try:
        xlsx_bytes = _download_attachment(service, latest_msg["id"], ".xlsx")
        if not xlsx_bytes:
            return {"processed": 0, "error": "No Excel attachment"}

        rows = parse_crisil_excel(xlsx_bytes)
        if not rows:
            return {"processed": 0, "error": "No data in Excel"}

        # Check what's already in DB
        from services.benchmark_db_service import get_latest_value
        existing = get_latest_value(CRISIL_INDEX_NAME)
        existing_date = existing.get("date") if existing else None

        # Find truly new rows (not in DB yet)
        new_rows = [(d, v) for d, v in rows if str(d) > (existing_date or "")]

        # Upsert all rows to DB (handles dedup)
        db_rows = [{"date": d, "index_name": CRISIL_INDEX_NAME, "value": v} for d, v in rows]
        upsert_benchmark_rows(db_rows)

        # Only write to sheet if there are genuinely new rows
        sheet_added = 0
        if new_rows:
            sheet_added = append_crisil_rows(new_rows)
            logger.info(f"CRISIL: {len(new_rows)} new rows written to sheet")
        else:
            logger.info("CRISIL: no new rows — skipped sheet write")

        return {"processed": len(rows), "new_to_sheet": sheet_added}

    except Exception as e:
        logger.error(f"CRISIL: processing failed: {e}")
        return {"processed": 0, "error": str(e)}


# ── Nifty Indices (Apps-Script-populated → DB sync) ──────────────────────────

def sync_nifty_indices_from_sheet(n_rows: int = NIFTY_INDICES_TAIL_ROWS) -> dict:
    """
    Read the tail of the 'Nifty Indices' sheet tab (written by Apps Script from
    Yahoo Finance via 5 daily triggers) and upsert to the benchmark_nav table.

    Stateless: DB dedup handles the "already there" case, so this is safe to
    run every 5 minutes. Self-healing: delete a row from the DB and it comes
    back within 5 minutes as long as it's still in the recent sheet tail.

    Returns {"rows_read": N, "records_upserted": M, "new_dates": D} where D is
    the number of distinct new dates upserted (roughly).
    """
    from services.benchmark_sheet_service import read_nifty_indices_tail
    from services.benchmark_db_service import upsert_benchmark_rows, get_available_indices

    try:
        # Snapshot the latest_date per index BEFORE the read, so we can log
        # how many rows are genuinely new vs re-writes.
        try:
            pre = {r["index_name"]: r["last_date"] for r in get_available_indices()}
        except Exception:
            pre = {}

        records = read_nifty_indices_tail(n_rows=n_rows)
        if not records:
            return {"rows_read": 0, "records_upserted": 0, "new_dates": 0}

        # Count "genuinely new" records — date > known last_date for that index
        new_count = 0
        for r in records:
            last = pre.get(r["index_name"])
            if not last or str(r["date"]) > last:
                new_count += 1

        upserted = upsert_benchmark_rows(records)
        logger.info(
            f"Nifty Indices sync: read {len(records)} records from tail, "
            f"upserted {upserted}, {new_count} were newer than prior latest"
        )
        return {"rows_read": len(records), "records_upserted": upserted, "new_dates": new_count}
    except Exception as e:
        logger.error(f"sync_nifty_indices_from_sheet failed: {e}", exc_info=True)
        return {"rows_read": 0, "records_upserted": 0, "new_dates": 0, "error": str(e)}


# ── Combined ──────────────────────────────────────────────────────────────────

def fetch_all_benchmarks(check_days: int = 5) -> dict:
    """Called from main Gmail poll loop every 5 minutes."""
    nse    = fetch_nse_benchmark(check_days=check_days)
    crisil = fetch_crisil_benchmark(check_days=check_days)
    nifty  = sync_nifty_indices_from_sheet()
    return {"nse": nse, "crisil": crisil, "nifty_indices": nifty}