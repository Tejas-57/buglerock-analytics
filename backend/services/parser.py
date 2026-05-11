"""
parser.py
Parses the daily Morningstar Excel file into structured fund data.
Handles all 4 sheets, category detection, whitelist filtering,
thematic merging and Index MF exclusion.

Column mapping strategy:
- Uses openpyxl to read raw rows
- Row 1: metric group headers (merged cells like "1 Day", "1 Week" etc.)
- Row 4: sub-headers ("Return", "Peer group rank" alternating under each metric)
- We find the "Return" column index under each metric name dynamically
- This avoids any dependency on fixed column positions or pandas duplicate renaming
"""

import numpy as np
from openpyxl import load_workbook
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

WHITELIST_RANKINGS = {"R1", "R2"}

MERGE_RULES = {
    "Thematic": "Thematic Funds",
}

EXCLUDE_PREFIXES = [
    "Index MF",
]

SHEET_CONFIG = {
    "Singlesheet - Daily Equity & Hy": {"asset_class": "Equity"},
    "Singlesheet - Daily Fixed Incom": {"asset_class": "Debt"},
    "BugleRock Capital - Equity ETF":  {"asset_class": "ETF - Equity"},
    "BugleRock Capital - Fixed Incom": {"asset_class": "ETF - Debt"},
}

# Metric name → DB field mapping (case-insensitive substring match)
RETURN_METRIC_MAP = [
    ("1 day",       "return_1d"),
    ("1 week",      "return_1w"),
    ("1 month",     "return_1m"),
    ("3 month",     "return_3m"),
    ("6 month",     "return_6m"),
    ("1 year",      "return_1y"),
    ("2 year",      "return_2y"),
    ("3 year",      "return_3y"),
    ("5 year",      "return_5y"),
    ("7 year",      "return_7y"),
    ("10 year",     "return_10y"),
    ("ytd",         "return_ytd"),
    ("cy2025",      "return_cy2025"),
    ("cy2024",      "return_cy2024"),
    ("cy2023",      "return_cy2023"),
    ("cy2022",      "return_cy2022"),
    ("cy2021",      "return_cy2021"),
    ("2025",        "return_cy2025"),
    ("2024",        "return_cy2024"),
    ("2023",        "return_cy2023"),
    ("2022",        "return_cy2022"),
    ("2021",        "return_cy2021"),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def safe_float(val):
    if val is None or val == "" or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_date(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    if hasattr(val, "date"):
        return val.date().isoformat()
    try:
        from datetime import date as date_type
        if isinstance(val, date_type):
            return val.isoformat()
        from pandas import to_datetime
        return to_datetime(val).strftime("%Y-%m-%d")
    except Exception:
        return None


def get_display_category(raw_name: str) -> str:
    for prefix, merged in MERGE_RULES.items():
        if raw_name.startswith(prefix):
            return merged
    return raw_name


def should_exclude(raw_name: str) -> bool:
    for prefix in EXCLUDE_PREFIXES:
        if raw_name.startswith(prefix):
            return True
    return False


def is_category_header(isin, name: str) -> bool:
    if isin is not None and str(isin).strip() not in ("", "nan", "None"):
        return False
    if not name or str(name).strip() in ("", "nan", "None"):
        return False
    name_str = str(name).strip()
    return not (
        name_str.startswith("Benchmark") or
        name_str.startswith("Peer Group") or
        name_str == "Group/Investment"
    )


def is_benchmark_row(isin, name: str) -> bool:
    if isin is not None and str(isin).strip() not in ("", "nan", "None"):
        return False
    return str(name or "").strip().startswith("Benchmark")


def cell_str(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


# ── Column index builder ──────────────────────────────────────────────────────

def build_column_map(rows: list) -> dict:
    """
    Dynamically build column index map by reading:
    - Row with metric group names (1 Day, 1 Week, etc.) -- used for return col mapping
    - Row with ISIN, Group/Investment, Return, Peer group rank etc. -- main header row

    In this Excel format both are separate rows:
    Row 1: metric group names (merged, so forward-fill Nones)
    Row 4: actual column headers (ISIN, Return, Peer group rank, fund fields...)
    """
    metric_row_idx = None
    isin_row_idx = None

    for i, row in enumerate(rows):
        cells = [cell_str(c) for c in row]
        cells_lower = [c.lower() for c in cells]
        if any("1 day" in c for c in cells_lower):
            metric_row_idx = i
        if "isin" in cells_lower:
            isin_row_idx = i

    if isin_row_idx is None:
        return None

    isin_row = [cell_str(c) for c in rows[isin_row_idx]]

    col_map = {}

    # Map standard named columns from the ISIN header row
    for idx, h in enumerate(isin_row):
        h_lower = h.lower()
        if h_lower == "isin":
            col_map["isin"] = idx
        elif h_lower in ("group/investment", "legal name"):
            col_map.setdefault("name", idx)
        elif h_lower == "ranking":
            col_map["ranking"] = idx
        elif "nav (daily)" in h_lower:
            col_map["nav"] = idx
        elif "return date (daily)" in h_lower:
            col_map["nav_date"] = idx
        elif "fund size" in h_lower and "cr" in h_lower and "date" not in h_lower:
            col_map["fund_size"] = idx
        elif "fund size date" in h_lower:
            col_map["fund_size_date"] = idx
        elif "morningstar category" in h_lower:
            col_map["morningstar_category"] = idx
        elif "morningstar rating" in h_lower:
            col_map["morningstar_rating"] = idx
        elif "inception date" in h_lower:
            col_map["inception_date"] = idx
        elif ("net expense ratio" in h_lower or "other sources net expense" in h_lower) and "date" not in h_lower:
            col_map.setdefault("expense_ratio", idx)
        elif "amfi code" in h_lower:
            col_map["amfi_code"] = idx
        elif "rta code" in h_lower and "accumulation" in h_lower:
            col_map["rta_code"] = idx
        elif "manager name" in h_lower:
            col_map["manager_name"] = idx
        elif "exit load" in h_lower:
            col_map["exit_load"] = idx
        elif "nav 52 wk high" in h_lower and "date" not in h_lower:
            col_map["nav_52w_high"] = idx
        elif "date: nav 52 wk high" in h_lower:
            col_map["nav_52w_high_date"] = idx
        elif "p/e ratio" in h_lower and "long" in h_lower:
            col_map["pe_ratio"] = idx
        elif "p/b ratio" in h_lower and "long" in h_lower:
            col_map["pb_ratio"] = idx
        elif "india large cap" in h_lower:
            col_map["large_cap"] = idx
        elif "india mid cap" in h_lower:
            col_map["mid_cap"] = idx
        elif "india small cap" in h_lower:
            col_map["small_cap"] = idx
        elif "asset alloc equity" in h_lower:
            col_map["equity_pct"] = idx
        elif "asset alloc bond" in h_lower:
            col_map["bond_pct"] = idx
        elif "asset alloc cash" in h_lower:
            col_map["cash_pct"] = idx
        elif "asset alloc other" in h_lower:
            col_map["other_pct"] = idx
        elif "up capture" in h_lower:
            col_map["up_capture"] = idx
        elif "down capture" in h_lower:
            col_map["down_capture"] = idx
        elif "std dev" in h_lower:
            col_map["std_dev"] = idx
        elif h_lower == "alpha":
            col_map["alpha"] = idx
        elif h_lower == "beta":
            col_map["beta"] = idx
        elif "information ratio" in h_lower:
            col_map["information_ratio"] = idx
        elif "sharpe ratio" in h_lower:
            col_map["sharpe_ratio"] = idx
        elif "sortino ratio" in h_lower:
            col_map["sortino_ratio"] = idx
        elif "treynor ratio" in h_lower:
            col_map["treynor_ratio"] = idx
        elif "average maturity" in h_lower:
            col_map["avg_maturity"] = idx
        elif "modified duration" in h_lower:
            col_map["modified_duration"] = idx
        elif "ytm" in h_lower:
            col_map["ytm"] = idx
        elif "average credit quality" in h_lower:
            col_map["avg_credit_quality"] = idx
        elif "equity style box" in h_lower:
            col_map["equity_style"] = idx

    # Map return columns by cross-referencing:
    # - metric_row (row 1): group names like "1 Day", "1 Week" — forward fill across merged Nones
    # - isin_row (row 4): "Return" appears once per metric, "Peer group rank" after each (except CY years)
    if metric_row_idx is not None:
        metric_row = [cell_str(c) for c in rows[metric_row_idx]]

        # Forward-fill metric names across merged cell Nones
        metric_filled = []
        last_metric = ""
        for c in metric_row:
            if c:
                last_metric = c
            metric_filled.append(last_metric)

        # For each column in isin_row where header == "Return",
        # find which metric it belongs to via metric_filled at same col index
        for col_idx, header_val in enumerate(isin_row):
            if header_val.lower() != "return":
                continue
            metric_name = metric_filled[col_idx] if col_idx < len(metric_filled) else ""
            metric_lower = metric_name.lower()

            for keyword, db_field in RETURN_METRIC_MAP:
                if keyword in metric_lower:
                    if db_field not in col_map:  # first match wins
                        col_map[db_field] = col_idx
                    break

    return {"isin_row_idx": isin_row_idx, "col_map": col_map}


# ── Row extractor ─────────────────────────────────────────────────────────────

def extract_row(row_vals: tuple, col_map: dict) -> dict:
    """Extract a dict from raw row values using the column map."""
    def get(field):
        idx = col_map.get(field)
        if idx is None or idx >= len(row_vals):
            return None
        return row_vals[idx]

    return {field: get(field) for field in col_map}


# ── Main parser ───────────────────────────────────────────────────────────────

def parse_excel_file(file_path: str, data_date: str, email_date: str, file_name: str) -> dict:
    wb = load_workbook(file_path, read_only=True, data_only=True)
    all_funds = []
    all_benchmarks = []
    parsed_categories = {}

    for sheet_name, config in SHEET_CONFIG.items():
        actual_sheet = next(
            (s for s in wb.sheetnames if s.strip() == sheet_name.strip()), None
        )
        if not actual_sheet:
            logger.warning(f"Sheet not found: {sheet_name}")
            continue

        asset_class = config["asset_class"]
        parsed_categories[asset_class] = []

        try:
            funds, benchmarks, categories = _parse_sheet(
                wb[actual_sheet],
                asset_class=asset_class,
                sheet_name=actual_sheet,
                data_date=data_date,
                email_date=email_date,
                file_name=file_name,
                is_debt="Debt" in asset_class,
            )
            all_funds.extend(funds)
            all_benchmarks.extend(benchmarks)
            parsed_categories[asset_class] = categories
        except Exception as e:
            logger.error(f"Error parsing sheet {sheet_name}: {e}", exc_info=True)

    logger.info(f"Parsed {len(all_funds)} funds and {len(all_benchmarks)} benchmarks for {data_date}")
    return {
        "funds": all_funds,
        "benchmarks": all_benchmarks,
        "data_date": data_date,
        "parsed_categories": parsed_categories,
    }


def _parse_sheet(ws, asset_class, sheet_name, data_date, email_date, file_name, is_debt=False):
    rows = list(ws.iter_rows(values_only=True))

    mapping = build_column_map(rows)
    if not mapping:
        logger.warning(f"Could not build column map for {sheet_name}")
        return [], [], []

    isin_row_idx = mapping["isin_row_idx"]
    col_map = mapping["col_map"]

    current_raw_category = None
    current_display_category = None
    skip_current = False
    funds = []
    benchmarks = []
    categories_seen = []

    for row_vals in rows[isin_row_idx + 1:]:
        row = extract_row(row_vals, col_map)
        isin = row.get("isin")
        name = cell_str(row.get("name"))

        if not name or name in ("nan", "None"):
            continue

        # Category header
        if is_category_header(isin, name):
            raw_cat = name
            if should_exclude(raw_cat):
                skip_current = True
                current_raw_category = None
                current_display_category = None
                continue
            skip_current = False
            current_raw_category = raw_cat
            current_display_category = get_display_category(raw_cat)
            if current_display_category not in categories_seen:
                categories_seen.append(current_display_category)
            continue

        if skip_current or current_display_category is None:
            continue

        # Benchmark row
        if is_benchmark_row(isin, name):
            bm_label = name.split(":")[0].strip()
            bm_name  = name.split(":", 1)[1].strip() if ":" in name else name
            if bm_label == "Benchmark 1":
                bm_row = {
                    "data_date":       data_date,
                    "email_date":      email_date,
                    "category":        current_display_category,
                    "raw_category":    current_raw_category,
                    "asset_class":     asset_class,
                    "sheet_name":      sheet_name,
                    "benchmark_label": bm_label,
                    "benchmark_name":  bm_name,
                    "return_1d":       safe_float(row.get("return_1d")),
                    "return_1w":       safe_float(row.get("return_1w")),
                    "return_1m":       safe_float(row.get("return_1m")),
                    "return_3m":       safe_float(row.get("return_3m")),
                    "return_6m":       safe_float(row.get("return_6m")),
                    "return_1y":       safe_float(row.get("return_1y")),
                    "return_2y":       safe_float(row.get("return_2y")),
                    "return_3y":       safe_float(row.get("return_3y")),
                    "return_5y":       safe_float(row.get("return_5y")),
                    "return_7y":       safe_float(row.get("return_7y")),
                    "return_10y":      safe_float(row.get("return_10y")),
                    "return_ytd":      safe_float(row.get("return_ytd")),
                    "return_cy2025":   safe_float(row.get("return_cy2025")),
                    "return_cy2024":   safe_float(row.get("return_cy2024")),
                    "return_cy2023":   safe_float(row.get("return_cy2023")),
                    "return_cy2022":   safe_float(row.get("return_cy2022")),
                    "return_cy2021":   safe_float(row.get("return_cy2021")),
                }
                benchmarks.append(bm_row)
            continue

        # Peer group rows — skip
        if name.startswith("Peer Group"):
            continue

        # Fund row
        isin_str = cell_str(isin)
        if not isin_str or isin_str in ("nan", "None", ""):
            continue

        fund = _build_fund(row, col_map, is_debt)
        fund.update({
            "category":     current_display_category,
            "raw_category": current_raw_category,
            "asset_class":  asset_class,
            "sheet_name":   sheet_name,
            "data_date":    data_date,
            "email_date":   email_date,
            "file_name":    file_name,
        })
        funds.append(fund)

    return funds, benchmarks, categories_seen


def _build_fund(row: dict, col_map: dict, is_debt: bool) -> dict:
    """Build a fund dict from extracted row values."""
    amfi_raw = row.get("amfi_code")
    amfi_code = str(int(float(amfi_raw))) if safe_float(amfi_raw) is not None else None

    fund = {
        "isin":              cell_str(row.get("isin")) or None,
        "name":              cell_str(row.get("name")) or None,
        "ranking":           cell_str(row.get("ranking")) or None,
        "nav":               safe_float(row.get("nav")),
        "nav_date":          safe_date(row.get("nav_date")),
        "fund_size":         safe_float(row.get("fund_size")),
        "fund_size_date":    safe_date(row.get("fund_size_date")),
        "morningstar_category": cell_str(row.get("morningstar_category")) or None,
        "morningstar_rating":   safe_float(row.get("morningstar_rating")),
        "inception_date":    safe_date(row.get("inception_date")),
        "expense_ratio":     safe_float(row.get("expense_ratio")),
        "amfi_code":         amfi_code,
        "rta_code":          cell_str(row.get("rta_code")) or None,
        "manager_name":      cell_str(row.get("manager_name")) or None,
        "exit_load":         cell_str(row.get("exit_load")) or None,
        "nav_52w_high":      safe_float(row.get("nav_52w_high")),
        "nav_52w_high_date": safe_date(row.get("nav_52w_high_date")),
        # Returns
        "return_1d":         safe_float(row.get("return_1d")),
        "return_1w":         safe_float(row.get("return_1w")),
        "return_1m":         safe_float(row.get("return_1m")),
        "return_3m":         safe_float(row.get("return_3m")),
        "return_6m":         safe_float(row.get("return_6m")),
        "return_1y":         safe_float(row.get("return_1y")),
        "return_2y":         safe_float(row.get("return_2y")),
        "return_3y":         safe_float(row.get("return_3y")),
        "return_5y":         safe_float(row.get("return_5y")),
        "return_7y":         safe_float(row.get("return_7y")),
        "return_10y":        safe_float(row.get("return_10y")),
        "return_ytd":        safe_float(row.get("return_ytd")),
        "return_cy2025":     safe_float(row.get("return_cy2025")),
        "return_cy2024":     safe_float(row.get("return_cy2024")),
        "return_cy2023":     safe_float(row.get("return_cy2023")),
        "return_cy2022":     safe_float(row.get("return_cy2022")),
        "return_cy2021":     safe_float(row.get("return_cy2021")),
        # Risk
        "std_dev":           safe_float(row.get("std_dev")),
        "alpha":             safe_float(row.get("alpha")),
        "beta":              safe_float(row.get("beta")),
        "information_ratio": safe_float(row.get("information_ratio")),
        "sharpe_ratio":      safe_float(row.get("sharpe_ratio")),
        "sortino_ratio":     safe_float(row.get("sortino_ratio")),
        "treynor_ratio":     safe_float(row.get("treynor_ratio")),
        "up_capture":        safe_float(row.get("up_capture")),
        "down_capture":      safe_float(row.get("down_capture")),
        # Equity exposure
        "large_cap":         safe_float(row.get("large_cap")),
        "mid_cap":           safe_float(row.get("mid_cap")),
        "small_cap":         safe_float(row.get("small_cap")),
        "equity_pct":        safe_float(row.get("equity_pct")),
        "bond_pct":          safe_float(row.get("bond_pct")),
        "cash_pct":          safe_float(row.get("cash_pct")),
        "other_pct":         safe_float(row.get("other_pct")),
        "pe_ratio":          safe_float(row.get("pe_ratio")),
        "pb_ratio":          safe_float(row.get("pb_ratio")),
        "equity_style":      cell_str(row.get("equity_style")) or None,
    }

    if is_debt:
        fund.update({
            "avg_maturity":      safe_float(row.get("avg_maturity")),
            "modified_duration": safe_float(row.get("modified_duration")),
            "ytm":               safe_float(row.get("ytm")),
            "avg_credit_quality":cell_str(row.get("avg_credit_quality")) or None,
        })

    return fund


# ── Whitelist filter ──────────────────────────────────────────────────────────

def apply_whitelist(funds: list) -> list:
    ranked = [f for f in funds if f.get("ranking") in WHITELIST_RANKINGS]
    return ranked if ranked else funds