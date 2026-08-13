"""
benchmark_sheet_service.py
Reads and writes benchmark NAV data to/from Google Sheets via Service Account.

Three modes of use:
  - APPEND (daily, fast) — new email → append one/few rows to sheet + DB
  - TAIL READ (5-min poll, fast) — read last N rows from a tab → upsert to DB
                                   (used for Nifty Indices which is written by Apps Script)
  - HISTORICAL LOAD (one-time, slow) — read entire sheet → populate DB

The daily/append operations only touch column A (existing dates) — fast.
The tail read pulls the whole tab in one API call, then slices client-side — fine
because the sheet is small (~500 rows × 11 cols).
The historical load is a manual endpoint that runs in background, not on startup.
"""

import os
import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SHEET_ID              = os.getenv("BENCHMARK_SHEET_ID", "")
SHEET_NIFTY_INDICES   = "Nifty Indices"
SHEET_NIFTY_MA        = "Nifty Multi Asset"
SHEET_CRISIL          = "CRISIL Composite"

INDEX_NAME_MAP = {
    "Nifty Multi Asset - Equity : Arbitrage : REITs/InvITs (50:40:10)":        "Nifty Multi Asset 50:40:10",
    "Nifty Multi Asset - Equity : Arbitrage : REITs/InvITs (50:40:10) Index":  "Nifty Multi Asset 50:40:10",
    "CRISIL Composite Bond Index":                                             "CRISIL Composite Bond Index",
}


def _get_service_account_creds():
    import google.oauth2.service_account as sa
    json_str = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if json_str:
        try:
            return sa.Credentials.from_service_account_info(
                json.loads(json_str),
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
        except Exception as e:
            logger.error(f"Service account from env failed: {e}")
    for p in ["/etc/secrets/sheets_credentials.json", "credentials/sheets_credentials.json"]:
        if Path(p).exists():
            return sa.Credentials.from_service_account_file(
                p, scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
    raise RuntimeError("No service account credentials found.")


def _get_sheets_client():
    import gspread
    return gspread.authorize(_get_service_account_creds())


def _parse_date(val) -> Optional[date]:
    if val is None or val == "": return None
    if isinstance(val, datetime): return val.date()
    if isinstance(val, date) and not isinstance(val, datetime): return val
    s = str(val).strip()
    for fmt in ["%d-%b-%Y", "%d-%b-%y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y"]:
        try: return datetime.strptime(s, fmt).date()
        except ValueError: continue
    return None


def _get_existing_dates(ws) -> set:
    """Read only column A to get existing dates — fast, minimal API usage."""
    col_a = ws.col_values(1)[1:]  # skip header
    dates = set()
    for v in col_a:
        d = _parse_date(v)
        if d:
            dates.add(d)
    return dates


# ── APPEND (daily, fast) ─────────────────────────────────────────────────────

def append_nifty_ma_row(nav_date: date, value: float) -> bool:
    if not SHEET_ID:
        logger.warning("BENCHMARK_SHEET_ID not set")
        return False
    try:
        gc = _get_sheets_client()
        ws = gc.open_by_key(SHEET_ID).worksheet(SHEET_NIFTY_MA)
        if nav_date in _get_existing_dates(ws):
            logger.info(f"Nifty Multi Asset: {nav_date} already in sheet")
            return True
        ws.append_row(
            [nav_date.strftime("%d-%b-%Y"), round(value, 4)],
            value_input_option="USER_ENTERED",
        )
        logger.info(f"Nifty Multi Asset: appended {nav_date} = {value}")
        return True
    except Exception as e:
        logger.error(f"append_nifty_ma_row failed: {e}")
        return False


def append_crisil_rows(rows: list[tuple[date, float]]) -> int:
    if not SHEET_ID or not rows:
        return 0
    try:
        gc = _get_sheets_client()
        ws = gc.open_by_key(SHEET_ID).worksheet(SHEET_CRISIL)
        existing = _get_existing_dates(ws)
        new_rows = [
            [d.strftime("%d-%b-%Y"), round(v, 4)]
            for d, v in sorted(rows, key=lambda r: r[0])
            if d not in existing
        ]
        if not new_rows:
            logger.info("CRISIL Composite: no new rows to add")
            return 0
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")
        logger.info(f"CRISIL Composite: added {len(new_rows)} new rows")
        return len(new_rows)
    except Exception as e:
        logger.error(f"append_crisil_rows failed: {e}")
        return 0


# ── TAIL READ (5-min poll, for Apps-Script-populated tabs) ───────────────────

def read_nifty_indices_tail(n_rows: int = 20) -> list[dict]:
    """
    Read the last n_rows of data from the 'Nifty Indices' tab and return
    records as [{date, index_name, value}, ...].

    Called from the 5-min benchmark poll. Apps Script (Yahoo Finance) writes
    to this tab throughout the day via 5 daily triggers; this function keeps
    the benchmark_nav table in sync without needing a separate daily cron.

    Uses a single get_all_values() API call — sheet is small (~500 rows × 11
    cols ≈ 50KB payload). Client-side slice of the tail.

    Returns [] on error or empty sheet — never raises.
    """
    if not SHEET_ID:
        return []
    try:
        gc = _get_sheets_client()
        ws = gc.open_by_key(SHEET_ID).worksheet(SHEET_NIFTY_INDICES)
        all_rows = ws.get_all_values()
    except Exception as e:
        logger.error(f"read_nifty_indices_tail: sheet read failed: {e}")
        return []

    if not all_rows or len(all_rows) < 2:
        return []

    header = all_rows[0]
    index_names = [INDEX_NAME_MAP.get(h.strip(), h.strip()) for h in header[1:]]

    # Take the last n_rows data rows (skip header)
    data_rows = all_rows[1:]
    tail = data_rows[-n_rows:] if len(data_rows) > n_rows else data_rows

    records = []
    for row in tail:
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
    logger.info(
        f"read_nifty_indices_tail: {len(records)} records from last {len(tail)} rows "
        f"(across {len(index_names)} indices)"
    )
    return records


# ── HISTORICAL LOAD (one-time, slow, background only) ────────────────────────

def read_sheet_tab_full(tab_name: str) -> list[dict]:
    """
    Read a sheet tab entirely — used ONCE for historical load into DB.
    Returns list of {date, index_name, value} dicts.
    """
    if not SHEET_ID:
        return []
    try:
        gc = _get_sheets_client()
        ws = gc.open_by_key(SHEET_ID).worksheet(tab_name)
        rows = ws.get_all_values()
    except Exception as e:
        logger.error(f"read_sheet_tab_full '{tab_name}': {e}")
        return []

    if not rows or len(rows) < 2:
        return []

    headers = rows[0]
    index_names = [INDEX_NAME_MAP.get(h.strip(), h.strip()) for h in headers[1:]]

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
    logger.info(f"read_sheet_tab_full '{tab_name}': {len(records)} records")
    return records


def read_all_benchmarks_full() -> list[dict]:
    """Read all 3 tabs — ONLY for one-time historical load."""
    records = []
    for tab in [SHEET_NIFTY_INDICES, SHEET_NIFTY_MA, SHEET_CRISIL]:
        try:
            records.extend(read_sheet_tab_full(tab))
        except Exception as e:
            logger.error(f"Error reading tab {tab}: {e}")
    logger.info(f"read_all_benchmarks_full: {len(records)} total records")
    return records