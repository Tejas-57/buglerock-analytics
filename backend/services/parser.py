"""
parser.py
Parses the new Morningstar daily Excel template into structured fund data.

Sheet config (new template):
  Equity                        → asset_class: Equity
  Equity Index & FoF            → asset_class: Equity Index
  Equity ETF                    → asset_class: ETF - Equity
  Hybrid                        → asset_class: Hybrid
  SIF                           → asset_class: SIF
  International                 → asset_class: International
  Fixed Income                  → asset_class: Debt
  BugleRock Capital - Fixed Incom → asset_class: ETF - Debt

Category detection rules:
  A row is a category header if col B starts with:
    "India Fund", "India OE", "Cat:", "India ETF"

Thematic merge:
  Any category starting with "Cat: Thematic" → merged as "Thematic Funds"

Exclusions (Equity sheet only):
  Any category containing "Cat: Index MF" → excluded

Empty category rule:
  If a category has zero funds (any ranking) before its Benchmark row → skip entirely

Return column mapping:
  Done by cross-referencing metric header row (row 1) with column sub-header row
  (the row containing ISIN). Plural "Years" normalised → matched as "Year".

Risk metrics:
  Three timeframes stored: 1Y, 3Y, 5Y for all 8 risk ratios.
"""

import numpy as np
from openpyxl import load_workbook
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# ── Sheet configuration ──────────────────────────────────────────────────────

SHEET_CONFIG = {
    "Equity":                         {"asset_class": "Equity",           "has_ranking": True,  "exclude_index_mf": True},
    "Equity Index & FoF":             {"asset_class": "Equity Index",      "has_ranking": False, "exclude_index_mf": False},
    "Equity ETF":                     {"asset_class": "ETF - Equity",      "has_ranking": False, "exclude_index_mf": False},
    "Hybrid":                         {"asset_class": "Hybrid",            "has_ranking": True,  "exclude_index_mf": False},
    "SIF":                            {"asset_class": "SIF",               "has_ranking": True,  "exclude_index_mf": False},
    "International":                  {"asset_class": "International",     "has_ranking": False, "exclude_index_mf": False},
    # New sheet names (from May 2026 onwards)
    "Debt":                           {"asset_class": "Debt",              "has_ranking": True,  "exclude_index_mf": False},
    "Debt ETF":                       {"asset_class": "ETF - Debt",        "has_ranking": False, "exclude_index_mf": False},
    # Old sheet names (kept for backward compatibility)
    "Fixed Income":                   {"asset_class": "Debt",              "has_ranking": True,  "exclude_index_mf": False},
    "BugleRock Capital - Fixed Incom":{"asset_class": "ETF - Debt",        "has_ranking": False, "exclude_index_mf": False},
}

WHITELIST_RANKINGS = {"R1", "R2"}

# Category prefixes that identify a header row
CATEGORY_PREFIXES = ("India Fund", "India OE", "Cat:", "India ETF")

# Thematic merge — any category starting with "Cat: Thematic" → "Thematic Funds"
THEMATIC_PREFIX = "Cat: Thematic"
THEMATIC_DISPLAY = "Thematic Funds"

# Index MF exclusion keyword (Equity sheet only)
INDEX_MF_KEYWORD = "Cat: Index MF"

# Return metric keyword → DB field (lowercase substring matching)
RETURN_METRIC_MAP = [
    ("1 day",    "return_1d"),
    ("1 week",   "return_1w"),
    ("1 month",  "return_1m"),
    ("3 month",  "return_3m"),
    ("6 month",  "return_6m"),
    ("1 year",   "return_1y"),
    ("2 year",   "return_2y"),
    ("3 year",   "return_3y"),
    ("5 year",   "return_5y"),
    ("7 year",   "return_7y"),
    ("10 year",  "return_10y"),
    ("ytd",      "return_ytd"),
    ("cy - 2025","return_cy2025"),
    ("cy - 2024","return_cy2024"),
    ("cy - 2023","return_cy2023"),
    ("cy - 2022","return_cy2022"),
    ("cy - 2021","return_cy2021"),
    ("2025",     "return_cy2025"),
    ("2024",     "return_cy2024"),
    ("2023",     "return_cy2023"),
    ("2022",     "return_cy2022"),
    ("2021",     "return_cy2021"),
]

# Risk metric column suffix → DB field prefix
# Full column name: e.g. "Sharpe Ratio 1Y", "Sharpe Ratio 3Y", "Sharpe Ratio 5Y"
RISK_METRIC_MAP = [
    ("up capture",       "up_capture"),
    ("down capture",     "down_capture"),
    ("std dev",          "std_dev"),
    ("alpha",            "alpha"),
    ("beta",             "beta"),
    ("information ratio","information_ratio"),
    ("sharpe ratio",     "sharpe_ratio"),
    ("sortino ratio",    "sortino_ratio"),
    ("treynor ratio",    "treynor_ratio"),
]

RISK_TIMEFRAMES = ["1y", "3y", "5y"]


# ── Helpers ──────────────────────────────────────────────────────────────────

def safe_float(val):
    if val is None or val == "":
        return None
    if isinstance(val, float) and np.isnan(val):
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
    except Exception:
        pass
    return None


def cell_str(val) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    return "" if s in ("None", "nan") else s


def is_category_header(name: str) -> bool:
    """Row is a category header if name starts with a known prefix."""
    if not name:
        return False
    return any(name.startswith(p) for p in CATEGORY_PREFIXES)


def get_display_category(raw_name: str) -> str:
    """Apply thematic merge rule."""
    if raw_name.startswith(THEMATIC_PREFIX):
        return THEMATIC_DISPLAY
    return raw_name


def should_exclude_category(raw_name: str, exclude_index_mf: bool) -> bool:
    """Return True if this category should be completely skipped."""
    if exclude_index_mf and "index mf" in raw_name.lower():
        return True
    return False


# ── Column map builder ───────────────────────────────────────────────────────

def build_column_map(rows: list) -> dict:
    """
    Dynamically build a column index map by reading:
    - Metric header row (row 1): '1 Day', '1 Week', '3 Year', 'Sharpe Ratio 3Y' etc.
    - ISIN header row: 'ISIN', 'Group/Investment', 'Return', 'Peer group rank' etc.

    Returns {"isin_row_idx": int, "col_map": dict}
    """
    metric_row_idx = None
    isin_row_idx = None

    for i, row in enumerate(rows[:10]):
        cells = [cell_str(c).lower() for c in row]
        if any("1 day" in c for c in cells):
            metric_row_idx = i
        if "isin" in cells:
            isin_row_idx = i

    if isin_row_idx is None:
        return None

    isin_row = [cell_str(c) for c in rows[isin_row_idx]]
    col_map = {}

    # ── Standard named columns from ISIN header row ──
    for idx, h in enumerate(isin_row):
        hl = h.lower()

        if hl == "isin":
            col_map["isin"] = idx
        elif hl in ("group/investment", "legal name"):
            col_map.setdefault("name", idx)
        elif hl == "ranking":
            col_map["ranking"] = idx
        elif "nav (daily)" in hl:
            col_map.setdefault("nav", idx)
        elif "return date (daily)" in hl:
            col_map.setdefault("nav_date", idx)
        elif "fund size ( cr )" in hl or "fund size (cr)" in hl:
            col_map.setdefault("fund_size", idx)
        elif "fund size date" in hl:
            col_map.setdefault("fund_size_date", idx)
        elif "morningstar category" in hl:
            col_map.setdefault("morningstar_category", idx)
        elif "morningstar rating" in hl:
            col_map.setdefault("morningstar_rating", idx)
        elif "inception date" in hl:
            col_map.setdefault("inception_date", idx)
        elif ("net expense ratio" in hl or "other sources net expense" in hl) and "date" not in hl:
            col_map.setdefault("expense_ratio", idx)
        elif "rta code" in hl and "accumulation" in hl:
            col_map.setdefault("rta_code", idx)
        elif "amfi code" in hl:
            col_map.setdefault("amfi_code", idx)
        elif "manager name" in hl:
            col_map.setdefault("manager_name", idx)
        elif "exit load" in hl:
            col_map.setdefault("exit_load", idx)
        elif "nav 52 wk high" in hl and "date" not in hl:
            col_map.setdefault("nav_52w_high", idx)
        elif "date: nav 52 wk high" in hl:
            col_map.setdefault("nav_52w_high_date", idx)
        elif "nav 52 wk low" in hl:
            col_map.setdefault("nav_52w_low", idx)
        elif "nav (mo-end)" in hl:
            col_map.setdefault("nav_mo_end", idx)
        elif "p/e ratio" in hl and "long" in hl:
            col_map.setdefault("pe_ratio", idx)
        elif "p/b ratio" in hl and "long" in hl:
            col_map.setdefault("pb_ratio", idx)
        elif "india large cap" in hl:
            col_map.setdefault("large_cap", idx)
        elif "india mid cap" in hl:
            col_map.setdefault("mid_cap", idx)
        elif "india small cap" in hl:
            col_map.setdefault("small_cap", idx)
        elif "equity style box" in hl:
            col_map.setdefault("equity_style", idx)
        elif "asset alloc equity" in hl:
            col_map.setdefault("equity_pct", idx)
        elif "asset alloc bond" in hl:
            col_map.setdefault("bond_pct", idx)
        elif "asset alloc cash" in hl:
            col_map.setdefault("cash_pct", idx)
        elif "asset alloc other" in hl:
            col_map.setdefault("other_pct", idx)
        # Equity region
        elif "equity region americas" in hl:
            col_map.setdefault("region_americas", idx)
        elif "equity region greater europe" in hl:
            col_map.setdefault("region_europe", idx)
        elif "equity region greater asia" in hl:
            col_map.setdefault("region_asia", idx)
        elif "equity region emerging" in hl:
            col_map.setdefault("region_emerging", idx)
        # Factor profile
        elif "factor profile momentum" in hl:
            col_map.setdefault("factor_momentum", idx)
        elif "factor profile quality" in hl:
            col_map.setdefault("factor_quality", idx)
        elif "factor profile volatility" in hl:
            col_map.setdefault("factor_volatility", idx)
        elif "factor profile size" in hl:
            col_map.setdefault("factor_size", idx)
        elif "factor profile style" in hl:
            col_map.setdefault("factor_style", idx)
        elif "factor profile yield" in hl:
            col_map.setdefault("factor_yield", idx)
        elif "factor profile liquidity" in hl:
            col_map.setdefault("factor_liquidity", idx)
        # Debt specific
        elif "average maturity" in hl:
            col_map.setdefault("avg_maturity", idx)
        elif "modified duration" in hl:
            col_map.setdefault("modified_duration", idx)
        elif "ytm" in hl:
            col_map.setdefault("ytm", idx)
        elif "average credit quality" in hl:
            col_map.setdefault("avg_credit_quality", idx)
        # Credit quality breakdown
        elif "credit qual aaa" in hl:
            col_map.setdefault("credit_aaa", idx)
        elif "credit qual aa %" in hl:
            col_map.setdefault("credit_aa", idx)
        elif "credit qual a %" in hl:
            col_map.setdefault("credit_a", idx)
        elif "credit qual bbb" in hl:
            col_map.setdefault("credit_bbb", idx)

    # ── Return columns: cross-reference metric_row with isin_row ──
    if metric_row_idx is not None:
        metric_row = [cell_str(c) for c in rows[metric_row_idx]]

        # Forward-fill metric names (merged cells show value only in first cell)
        metric_filled = []
        last = ""
        for c in metric_row:
            if c:
                last = c
            metric_filled.append(last)

        # For each isin_row column where header == "Return",
        # match the metric name at same column index
        for col_idx, header_val in enumerate(isin_row):
            if header_val.lower() != "return":
                continue
            metric_name = metric_filled[col_idx] if col_idx < len(metric_filled) else ""
            metric_lower = metric_name.lower()

            # Check return periods first
            matched = False
            for keyword, db_field in RETURN_METRIC_MAP:
                if keyword in metric_lower:
                    col_map.setdefault(db_field, col_idx)
                    matched = True
                    break

    # ── Risk metric columns from ISIN header row ──
    # e.g. "Sharpe Ratio 1Y", "Up Capture Ratio 3Y", "Std Dev 5Y"
    # Note: Morningstar has typo "Up Capture Raio 3Y" — handle via substring match
    for col_idx, header_val in enumerate(isin_row):
        hl = header_val.lower()
        if not hl:
            continue
        for keyword, db_prefix in RISK_METRIC_MAP:
            if keyword in hl:
                for tf in RISK_TIMEFRAMES:
                    if tf in hl:
                        field = f"{db_prefix}_{tf}"
                        col_map.setdefault(field, col_idx)
                        break
                break

    return {"isin_row_idx": isin_row_idx, "col_map": col_map}


# ── Row extraction ───────────────────────────────────────────────────────────

def extract_row(row_vals: tuple, col_map: dict) -> dict:
    def get(field):
        idx = col_map.get(field)
        if idx is None or idx >= len(row_vals):
            return None
        return row_vals[idx]
    return {field: get(field) for field in col_map}


# ── Main parser ──────────────────────────────────────────────────────────────

def parse_excel_file(file_path: str, data_date: str, email_date: str, file_name: str) -> dict:
    wb = load_workbook(file_path, read_only=True, data_only=True)
    all_funds = []
    all_benchmarks = []
    parsed_categories = {}

    for sheet_name, config in SHEET_CONFIG.items():
        actual = next((s for s in wb.sheetnames if s.strip() == sheet_name.strip()), None)
        if not actual:
            logger.warning(f"Sheet not found: {sheet_name}")
            continue

        try:
            funds, benchmarks, categories = _parse_sheet(
                ws=wb[actual],
                asset_class=config["asset_class"],
                sheet_name=actual,
                data_date=data_date,
                email_date=email_date,
                file_name=file_name,
                has_ranking=config["has_ranking"],
                exclude_index_mf=config["exclude_index_mf"],
            )
            all_funds.extend(funds)
            all_benchmarks.extend(benchmarks)
            parsed_categories[config["asset_class"]] = categories
        except Exception as e:
            logger.error(f"Error parsing sheet {sheet_name}: {e}", exc_info=True)

    logger.info(f"Parsed {len(all_funds)} funds and {len(all_benchmarks)} benchmarks for {data_date}")
    return {
        "funds": all_funds,
        "benchmarks": all_benchmarks,
        "data_date": data_date,
        "parsed_categories": parsed_categories,
    }


def _parse_sheet(ws, asset_class, sheet_name, data_date, email_date,
                 file_name, has_ranking, exclude_index_mf):
    rows = list(ws.iter_rows(values_only=True))
    mapping = build_column_map(rows)
    if not mapping:
        logger.warning(f"Could not build column map for {sheet_name}")
        return [], [], []

    isin_row_idx = mapping["isin_row_idx"]
    col_map = mapping["col_map"]

    # ── Two-pass: first collect all rows per category,
    #    then decide which categories to keep ──

    # Pass 1: segment rows by category
    segments = []  # list of {raw_cat, display_cat, skip, fund_rows, bm_rows}
    current_seg = None

    for row_vals in rows[isin_row_idx + 1:]:
        row = extract_row(row_vals, col_map)
        isin = cell_str(row.get("isin"))
        name = cell_str(row.get("name"))

        if not name:
            continue

        # Category header detection
        if is_category_header(name) and not isin:
            # Determine if this category should be excluded
            skip = should_exclude_category(name, exclude_index_mf)
            display = get_display_category(name)

            # For thematic merge — check if we already have a segment for this display name
            if display == THEMATIC_DISPLAY and segments:
                existing = next((s for s in segments if s["display_cat"] == THEMATIC_DISPLAY), None)
                if existing:
                    current_seg = existing
                    continue

            current_seg = {
                "raw_cat": name,
                "display_cat": display,
                "skip": skip,
                "fund_rows": [],
                "bm_rows": [],
            }
            segments.append(current_seg)
            continue

        if current_seg is None or current_seg["skip"]:
            continue

        # Benchmark row
        if name.startswith("Benchmark"):
            bm_label = name.split(":")[0].strip()
            bm_name  = name.split(":", 1)[1].strip() if ":" in name else name
            if bm_label == "Benchmark 1":
                current_seg["bm_rows"].append((bm_label, bm_name, row))
            continue

        # Peer group — skip
        if name.startswith("Peer Group"):
            continue

        # Fund row — must have ISIN
        if isin and isin not in ("None", "nan", ""):
            current_seg["fund_rows"].append(row)

    # Pass 2: build output, applying empty category rule
    funds = []
    benchmarks = []
    categories_seen = []

    for seg in segments:
        if seg["skip"]:
            continue

        # Empty category rule: skip if zero funds of any ranking
        if len(seg["fund_rows"]) == 0:
            continue

        display_cat = seg["display_cat"]
        raw_cat     = seg["raw_cat"]

        if display_cat not in categories_seen:
            categories_seen.append(display_cat)

        # Process funds
        for row in seg["fund_rows"]:
            fund = _build_fund(row, col_map, asset_class)
            fund.update({
                "category":     display_cat,
                "raw_category": raw_cat,
                "asset_class":  asset_class,
                "sheet_name":   sheet_name,
                "data_date":    data_date,
                "email_date":   email_date,
                "file_name":    file_name,
            })
            funds.append(fund)

        # Process benchmarks
        for bm_label, bm_name, row in seg["bm_rows"]:
            bm = _build_benchmark(row, col_map, bm_label, bm_name,
                                  display_cat, raw_cat, asset_class,
                                  sheet_name, data_date, email_date)
            benchmarks.append(bm)

    return funds, benchmarks, categories_seen


def _build_fund(row: dict, col_map: dict, asset_class: str) -> dict:
    amfi_raw = row.get("amfi_code")
    amfi_code = None
    if safe_float(amfi_raw) is not None:
        try:
            amfi_code = str(int(float(amfi_raw)))
        except Exception:
            amfi_code = cell_str(amfi_raw) or None

    def r(f): return safe_float(row.get(f))
    def s(f): return cell_str(row.get(f)) or None
    def d(f): return safe_date(row.get(f))

    return {
        "isin":              s("isin"),
        "name":              s("name"),
        "ranking":           s("ranking"),
        "nav":               r("nav"),
        "nav_date":          d("nav_date"),
        "fund_size":         r("fund_size"),
        "fund_size_date":    d("fund_size_date"),
        "morningstar_category": s("morningstar_category"),
        "morningstar_rating":   r("morningstar_rating"),
        "inception_date":    d("inception_date"),
        "expense_ratio":     r("expense_ratio"),
        "amfi_code":         amfi_code,
        "rta_code":          s("rta_code"),
        "manager_name":      s("manager_name"),
        "exit_load":         s("exit_load"),
        "nav_52w_high":      r("nav_52w_high"),
        "nav_52w_high_date": d("nav_52w_high_date"),
        "nav_52w_low":       r("nav_52w_low"),
        "nav_mo_end":        r("nav_mo_end"),
        # Returns
        "return_1d":   r("return_1d"),   "return_1w":   r("return_1w"),
        "return_1m":   r("return_1m"),   "return_3m":   r("return_3m"),
        "return_6m":   r("return_6m"),   "return_1y":   r("return_1y"),
        "return_2y":   r("return_2y"),   "return_3y":   r("return_3y"),
        "return_5y":   r("return_5y"),   "return_7y":   r("return_7y"),
        "return_10y":  r("return_10y"),  "return_ytd":  r("return_ytd"),
        "return_cy2025": r("return_cy2025"), "return_cy2024": r("return_cy2024"),
        "return_cy2023": r("return_cy2023"), "return_cy2022": r("return_cy2022"),
        "return_cy2021": r("return_cy2021"),
        # Risk — 3 timeframes
        "std_dev_1y":          r("std_dev_1y"),
        "std_dev_3y":          r("std_dev_3y"),
        "std_dev_5y":          r("std_dev_5y"),
        "alpha_1y":            r("alpha_1y"),
        "alpha_3y":            r("alpha_3y"),
        "alpha_5y":            r("alpha_5y"),
        "beta_1y":             r("beta_1y"),
        "beta_3y":             r("beta_3y"),
        "beta_5y":             r("beta_5y"),
        "sharpe_ratio_1y":     r("sharpe_ratio_1y"),
        "sharpe_ratio_3y":     r("sharpe_ratio_3y"),
        "sharpe_ratio_5y":     r("sharpe_ratio_5y"),
        "sortino_ratio_1y":    r("sortino_ratio_1y"),
        "sortino_ratio_3y":    r("sortino_ratio_3y"),
        "sortino_ratio_5y":    r("sortino_ratio_5y"),
        "treynor_ratio_1y":    r("treynor_ratio_1y"),
        "treynor_ratio_3y":    r("treynor_ratio_3y"),
        "treynor_ratio_5y":    r("treynor_ratio_5y"),
        "information_ratio_1y":r("information_ratio_1y"),
        "information_ratio_3y":r("information_ratio_3y"),
        "information_ratio_5y":r("information_ratio_5y"),
        "up_capture_1y":       r("up_capture_1y"),
        "up_capture_3y":       r("up_capture_3y"),
        "up_capture_5y":       r("up_capture_5y"),
        "down_capture_1y":     r("down_capture_1y"),
        "down_capture_3y":     r("down_capture_3y"),
        "down_capture_5y":     r("down_capture_5y"),
        # Portfolio composition
        "large_cap":   r("large_cap"),   "mid_cap":     r("mid_cap"),
        "small_cap":   r("small_cap"),   "equity_pct":  r("equity_pct"),
        "bond_pct":    r("bond_pct"),    "cash_pct":    r("cash_pct"),
        "other_pct":   r("other_pct"),   "equity_style":s("equity_style"),
        "pe_ratio":    r("pe_ratio"),    "pb_ratio":    r("pb_ratio"),
        # Equity region
        "region_americas": r("region_americas"),
        "region_europe":   r("region_europe"),
        "region_asia":     r("region_asia"),
        "region_emerging": r("region_emerging"),
        # Factor profile
        "factor_momentum":   r("factor_momentum"),
        "factor_quality":    r("factor_quality"),
        "factor_volatility": r("factor_volatility"),
        "factor_size":       r("factor_size"),
        "factor_style":      r("factor_style"),
        "factor_yield":      r("factor_yield"),
        "factor_liquidity":  r("factor_liquidity"),
        # Debt
        "avg_maturity":        r("avg_maturity"),
        "modified_duration":   r("modified_duration"),
        "ytm":                 r("ytm"),
        "avg_credit_quality":  s("avg_credit_quality"),
        "credit_aaa":          r("credit_aaa"),
        "credit_aa":           r("credit_aa"),
        "credit_a":            r("credit_a"),
        "credit_bbb":          r("credit_bbb"),
    }


def _build_benchmark(row, col_map, bm_label, bm_name,
                     display_cat, raw_cat, asset_class,
                     sheet_name, data_date, email_date) -> dict:
    def r(f): return safe_float(row.get(f))
    return {
        "data_date":       data_date,
        "email_date":      email_date,
        "category":        display_cat,
        "raw_category":    raw_cat,
        "asset_class":     asset_class,
        "sheet_name":      sheet_name,
        "benchmark_label": bm_label,
        "benchmark_name":  bm_name,
        "return_1d":    r("return_1d"),  "return_1w":  r("return_1w"),
        "return_1m":    r("return_1m"),  "return_3m":  r("return_3m"),
        "return_6m":    r("return_6m"),  "return_1y":  r("return_1y"),
        "return_2y":    r("return_2y"),  "return_3y":  r("return_3y"),
        "return_5y":    r("return_5y"),  "return_7y":  r("return_7y"),
        "return_10y":   r("return_10y"), "return_ytd": r("return_ytd"),
        "return_cy2025":r("return_cy2025"),"return_cy2024":r("return_cy2024"),
        "return_cy2023":r("return_cy2023"),"return_cy2022":r("return_cy2022"),
        "return_cy2021":r("return_cy2021"),
    }