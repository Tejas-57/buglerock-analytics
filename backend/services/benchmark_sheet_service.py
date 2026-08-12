"""
benchmark_sheet_service.py
Reads and writes benchmark NAV data to/from Google Sheets via Service Account.

Sheet structure:
  Tab "Nifty Indices"   — Date + 10 Nifty index columns (managed by Apps Script)
  Tab "Nifty Multi Asset" — Date | Nifty Multi Asset value (append daily)
  Tab "CRISIL Composite"  — Date | CRISIL Composite Bond Index (upsert full history)

All tabs: Column A = Date, remaining columns = index values.
"""

import os
import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SHEET_ID = os.getenv("BENCHMARK_SHEET_ID", "")

SHEET_NIFTY_INDICES   = "Nifty Indices"
SHEET_NIFTY_MA        = "Nifty Multi Asset"
SHEET_CRISIL          = "CRISIL Composite"

# Column B header → canonical index name used in benchmark_nav table
INDEX_NAME_MAP = {
    "Nifty Multi Asset - Equity : Arbitrage : REITs/InvITs (50:40:10)": "Nifty Multi Asset 50:40:10",
    "Nifty Multi Asset - Equity : Arbitrage : REITs/InvITs (50:40:10) Index": "Nifty Multi Asset 50:40:10",
    "CRISIL Composite Bond Index": "CRISIL Composite Bond Index",
}


def _get_service_account_creds():
    """Load service account credentials from env or file."""
    import google.oauth2.service_account as sa

    # Try env variable first (Render)
    json_str = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if json_str:
        try:
            info = json.loads(json_str)
            return sa.Credentials.from_service_account_info(
                info,
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
        except Exception as e:
            logger.error(f"Failed to load service account from env: {e}")

    # Try file (local dev)
    paths = [
        "/etc/secrets/sheets_credentials.json",
        "credentials/sheets_credentials.json",
    ]
    for p in paths:
        if Path(p).exists():
            return sa.Credentials.from_service_account_file(
                p,
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )

    raise RuntimeError("No service account credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON env var.")


def _get_sheets_client():
    """Return authenticated gspread client."""
    import gspread
    creds = _get_service_account_creds()
    return gspread.authorize(creds)


def _parse_date(val) -> Optional[date]:
    """Parse various date formats from Google Sheets."""
    if val is None or val == "":
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    s = str(val).strip()
    formats = [
        "%d-%b-%Y",   # 31-Jul-2023
        "%d-%b-%y",   # 1-Apr-10
        "%Y-%m-%d",   # 2023-07-31
        "%d/%m/%Y",   # 31/07/2023
        "%d-%m-%Y",   # 31-07-2023
        "%d %b %Y",   # 31 Jul 2023
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    logger.warning(f"Could not parse date: {val!r}")
    return None


# ── READ ──────────────────────────────────────────────────────────────────────

def read_sheet_tab(tab_name: str) -> list[dict]:
    """
    Read a sheet tab and return list of {date, index_name, value} dicts.
    Skips rows where date or value is missing.
    """
    if not SHEET_ID:
        logger.warning("BENCHMARK_SHEET_ID not set — skipping sheet read")
        return []
    try:
        gc = _get_sheets_client()
        sh = gc.open_by_key(SHEET_ID)
        ws = sh.worksheet(tab_name)
        rows = ws.get_all_values()
    except Exception as e:
        logger.error(f"Failed to read sheet tab '{tab_name}': {e}")
        return []

    if not rows or len(rows) < 2:
        return []

    headers = rows[0]  # first row = headers
    # Date is always col 0; index columns are col 1..N
    index_names = []
    for h in headers[1:]:
        canonical = INDEX_NAME_MAP.get(h.strip(), h.strip())
        index_names.append(canonical)

    records = []
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        d = _parse_date(row[0])
        if not d:
            continue
        for i, name in enumerate(index_names):
            col = i + 1
            if col >= len(row) or row[col] == "":
                continue
            try:
                val = float(str(row[col]).replace(",", ""))
                records.append({"date": d, "index_name": name, "value": val})
            except (ValueError, TypeError):
                continue

    return records


def read_nifty_indices() -> list[dict]:
    return read_sheet_tab(SHEET_NIFTY_INDICES)


def read_nifty_multi_asset() -> list[dict]:
    return read_sheet_tab(SHEET_NIFTY_MA)


def read_crisil_composite() -> list[dict]:
    return read_sheet_tab(SHEET_CRISIL)


def read_all_benchmarks() -> list[dict]:
    """Read all 3 tabs and return combined list."""
    records = []
    for tab in [SHEET_NIFTY_INDICES, SHEET_NIFTY_MA, SHEET_CRISIL]:
        try:
            records.extend(read_sheet_tab(tab))
        except Exception as e:
            logger.error(f"Error reading tab {tab}: {e}")
    logger.info(f"read_all_benchmarks: {len(records)} records across 3 tabs")
    return records


# ── WRITE ─────────────────────────────────────────────────────────────────────

def append_nifty_ma_row(nav_date: date, value: float) -> bool:
    """
    Append one row to Nifty Multi Asset tab.
    Skips if date already exists.
    """
    if not SHEET_ID:
        logger.warning("BENCHMARK_SHEET_ID not set — skipping sheet write")
        return False
    try:
        gc = _get_sheets_client()
        sh = gc.open_by_key(SHEET_ID)
        ws = sh.worksheet(SHEET_NIFTY_MA)

        # Check if date already exists
        existing = ws.col_values(1)  # all values in column A
        date_str = nav_date.strftime("%-d-%b-%Y")  # e.g. "10-Aug-2026"
        # Also check short year format
        date_str_short = nav_date.strftime("%-d-%b-%y")  # e.g. "10-Aug-26"

        for v in existing[1:]:  # skip header
            d = _parse_date(v)
            if d == nav_date:
                logger.info(f"Nifty Multi Asset: {nav_date} already exists — skipping")
                return True  # already there

        # Append new row
        ws.append_row(
            [nav_date.strftime("%d-%b-%Y"), round(value, 4)],
            value_input_option="USER_ENTERED",
        )
        logger.info(f"Nifty Multi Asset: appended {nav_date} = {value}")
        return True

    except Exception as e:
        logger.error(f"Failed to append Nifty Multi Asset row: {e}")
        return False


def upsert_crisil_rows(rows: list[tuple[date, float]]) -> int:
    """
    Upsert rows into CRISIL Composite tab.
    rows = list of (date, value) tuples.
    Returns number of new rows added.
    """
    if not SHEET_ID or not rows:
        return 0
    try:
        gc = _get_sheets_client()
        sh = gc.open_by_key(SHEET_ID)
        ws = sh.worksheet(SHEET_CRISIL)

        # Get all existing dates
        existing_raw = ws.col_values(1)[1:]  # skip header
        existing_dates = set()
        for v in existing_raw:
            d = _parse_date(v)
            if d:
                existing_dates.add(d)

        # Build list of new rows only
        new_rows = []
        for nav_date, value in rows:
            if nav_date not in existing_dates:
                new_rows.append([nav_date.strftime("%d-%b-%Y"), round(value, 4)])

        if not new_rows:
            logger.info("CRISIL Composite: no new rows to add")
            return 0

        # Sort by date and append
        new_rows.sort(key=lambda r: r[0])
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")
        logger.info(f"CRISIL Composite: added {len(new_rows)} new rows")
        return len(new_rows)

    except Exception as e:
        logger.error(f"Failed to upsert CRISIL rows: {e}")
        return 0