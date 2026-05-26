"""
db_service.py
All database read/write operations for BugleRock Analytics.
Updated for new template with 1Y/3Y/5Y risk metrics.
"""

from datetime import date
from sqlalchemy.orm import Session
from models.database import SessionLocal, DailyFundData, BenchmarkData, EmailFetchLog
import logging

logger = logging.getLogger(__name__)

WHITELIST = {"R1", "R2"}


# ── Session helper ───────────────────────────────────────────────────────────

def get_session() -> Session:
    return SessionLocal()


# ── Email fetch tracking ─────────────────────────────────────────────────────

def has_data_for_date(data_date: date) -> bool:
    db = get_session()
    try:
        return db.query(DailyFundData).filter(
            DailyFundData.data_date == data_date
        ).count() > 0
    finally:
        db.close()


def log_email_fetch(email_date, data_date, file_name, status, message):
    db = get_session()
    try:
        db.add(EmailFetchLog(
            email_date=email_date, data_date=data_date,
            file_name=file_name, status=status, message=message,
        ))
        db.commit()
    finally:
        db.close()


# ── Save parsed data ─────────────────────────────────────────────────────────

def save_parsed_data(parsed: dict):
    """Replace all funds and benchmarks for a given data_date."""
    db = get_session()
    from datetime import date as date_type

    raw_date = parsed["data_date"]
    data_date = date_type.fromisoformat(raw_date) if isinstance(raw_date, str) else raw_date

    DATE_FIELDS = [
        "data_date", "email_date", "nav_date", "nav_52w_high_date",
        "fund_size_date", "inception_date"
    ]

    def coerce_dates(d: dict) -> dict:
        result = dict(d)
        for field in DATE_FIELDS:
            val = result.get(field)
            if isinstance(val, str) and val:
                try:
                    result[field] = date_type.fromisoformat(val)
                except ValueError:
                    result[field] = None
        return result

    try:
        db.query(DailyFundData).filter(DailyFundData.data_date == data_date).delete()
        db.query(BenchmarkData).filter(BenchmarkData.data_date == data_date).delete()

        for fund in parsed["funds"]:
            clean = coerce_dates(fund)
            db.add(DailyFundData(**{k: v for k, v in clean.items() if hasattr(DailyFundData, k)}))

        for bm in parsed["benchmarks"]:
            clean = coerce_dates(bm)
            db.add(BenchmarkData(**{k: v for k, v in clean.items() if hasattr(BenchmarkData, k)}))

        db.commit()
        logger.info(f"Saved {len(parsed['funds'])} funds for {data_date}")
    except Exception as e:
        db.rollback()
        logger.error(f"Error saving data: {e}", exc_info=True)
        raise
    finally:
        db.close()


# ── Fund list queries ────────────────────────────────────────────────────────

def get_asset_classes(data_date: date) -> list:
    db = get_session()
    try:
        rows = db.query(DailyFundData.asset_class).filter(
            DailyFundData.data_date == data_date
        ).distinct().all()
        return sorted([r[0] for r in rows if r[0]])
    finally:
        db.close()


def get_categories(data_date: date, asset_class: str) -> list:
    db = get_session()
    try:
        rows = db.query(DailyFundData.category).filter(
            DailyFundData.data_date == data_date,
            DailyFundData.asset_class == asset_class,
        ).distinct().all()
        return sorted([r[0] for r in rows if r[0]])
    finally:
        db.close()


def get_funds_for_dropdown(data_date: date, asset_class: str, category: str) -> list:
    """Return whitelisted funds. If no R1/R2 in category, return all."""
    db = get_session()
    try:
        all_funds = db.query(
            DailyFundData.isin,
            DailyFundData.name,
            DailyFundData.ranking,
            DailyFundData.amfi_code,
        ).filter(
            DailyFundData.data_date == data_date,
            DailyFundData.asset_class == asset_class,
            DailyFundData.category == category,
            DailyFundData.isin.isnot(None),
        ).all()

        fund_list = [
            {"isin": f.isin, "name": f.name, "ranking": f.ranking, "amfi_code": f.amfi_code}
            for f in all_funds
        ]
        ranked = [f for f in fund_list if f["ranking"] in WHITELIST]
        return ranked if ranked else fund_list
    finally:
        db.close()


# ── Fund snapshot ────────────────────────────────────────────────────────────

def get_fund_snapshot(isin: str, data_date: date) -> dict:
    db = get_session()
    try:
        f = db.query(DailyFundData).filter(
            DailyFundData.isin == isin,
            DailyFundData.data_date == data_date,
        ).first()
        return _fund_to_dict(f) if f else None
    finally:
        db.close()


def _fund_to_dict(f: DailyFundData) -> dict:
    def fmt(v): return v if v is not None else "-"

    return {
        "isin": f.isin, "name": f.name, "ranking": f.ranking,
        "category": f.category, "raw_category": fmt(f.raw_category),
        "asset_class": f.asset_class,
        "morningstar_category": fmt(f.morningstar_category),
        "morningstar_rating": fmt(f.morningstar_rating),
        "inception_date": str(f.inception_date) if f.inception_date else "-",
        "nav": fmt(f.nav),
        "nav_date": str(f.nav_date) if f.nav_date else "-",
        "nav_52w_high": fmt(f.nav_52w_high),
        "nav_52w_low": fmt(f.nav_52w_low),
        "nav_mo_end": fmt(f.nav_mo_end),
        "fund_size": fmt(f.fund_size),
        "expense_ratio": fmt(f.expense_ratio),
        "amfi_code": fmt(f.amfi_code),
        "rta_code": fmt(f.rta_code),
        "manager_name": fmt(f.manager_name),
        "exit_load": fmt(f.exit_load),
        "large_cap": fmt(f.large_cap),
        "mid_cap": fmt(f.mid_cap),
        "small_cap": fmt(f.small_cap),
        "equity_pct": fmt(f.equity_pct),
        "bond_pct": fmt(f.bond_pct),
        "cash_pct": fmt(f.cash_pct),
        "other_pct": fmt(f.other_pct),
        "pe_ratio": fmt(f.pe_ratio),
        "pb_ratio": fmt(f.pb_ratio),
        "equity_style": fmt(f.equity_style),
        # Equity region
        "region_americas": fmt(f.region_americas),
        "region_europe": fmt(f.region_europe),
        "region_asia": fmt(f.region_asia),
        "region_emerging": fmt(f.region_emerging),
        # Factor profile
        "factor_momentum": fmt(f.factor_momentum),
        "factor_quality": fmt(f.factor_quality),
        "factor_volatility": fmt(f.factor_volatility),
        "factor_size": fmt(f.factor_size),
        "factor_style": fmt(f.factor_style),
        "factor_yield": fmt(f.factor_yield),
        "factor_liquidity": fmt(f.factor_liquidity),
        # Debt
        "avg_maturity": fmt(f.avg_maturity),
        "modified_duration": fmt(f.modified_duration),
        "ytm": fmt(f.ytm),
        "avg_credit_quality": fmt(f.avg_credit_quality),
        "credit_aaa": fmt(f.credit_aaa),
        "credit_aa": fmt(f.credit_aa),
        "credit_a": fmt(f.credit_a),
        "credit_bbb": fmt(f.credit_bbb),
        "returns": _returns_dict(f),
        "risk": _risk_dict(f),
    }


def _returns_dict(f) -> dict:
    def fmt(v): return round(v, 4) if v is not None else "-"
    return {
        "1d": fmt(f.return_1d), "1w": fmt(f.return_1w),
        "1m": fmt(f.return_1m), "3m": fmt(f.return_3m),
        "6m": fmt(f.return_6m), "1y": fmt(f.return_1y),
        "2y": fmt(f.return_2y), "3y": fmt(f.return_3y),
        "5y": fmt(f.return_5y), "7y": fmt(f.return_7y),
        "10y": fmt(f.return_10y), "ytd": fmt(f.return_ytd),
        "cy2025": fmt(f.return_cy2025), "cy2024": fmt(f.return_cy2024),
        "cy2023": fmt(f.return_cy2023), "cy2022": fmt(f.return_cy2022),
        "cy2021": fmt(f.return_cy2021),
    }


def _risk_dict(f) -> dict:
    """Returns risk metrics for all 3 timeframes (1Y, 3Y, 5Y)."""
    def fmt(v): return round(v, 4) if v is not None else "-"
    return {
        # 1 Year
        "std_dev_1y": fmt(f.std_dev_1y), "alpha_1y": fmt(f.alpha_1y),
        "beta_1y": fmt(f.beta_1y), "sharpe_ratio_1y": fmt(f.sharpe_ratio_1y),
        "sortino_ratio_1y": fmt(f.sortino_ratio_1y), "treynor_ratio_1y": fmt(f.treynor_ratio_1y),
        "information_ratio_1y": fmt(f.information_ratio_1y),
        "up_capture_1y": fmt(f.up_capture_1y), "down_capture_1y": fmt(f.down_capture_1y),
        # 3 Year
        "std_dev_3y": fmt(f.std_dev_3y), "alpha_3y": fmt(f.alpha_3y),
        "beta_3y": fmt(f.beta_3y), "sharpe_ratio_3y": fmt(f.sharpe_ratio_3y),
        "sortino_ratio_3y": fmt(f.sortino_ratio_3y), "treynor_ratio_3y": fmt(f.treynor_ratio_3y),
        "information_ratio_3y": fmt(f.information_ratio_3y),
        "up_capture_3y": fmt(f.up_capture_3y), "down_capture_3y": fmt(f.down_capture_3y),
        # 5 Year
        "std_dev_5y": fmt(f.std_dev_5y), "alpha_5y": fmt(f.alpha_5y),
        "beta_5y": fmt(f.beta_5y), "sharpe_ratio_5y": fmt(f.sharpe_ratio_5y),
        "sortino_ratio_5y": fmt(f.sortino_ratio_5y), "treynor_ratio_5y": fmt(f.treynor_ratio_5y),
        "information_ratio_5y": fmt(f.information_ratio_5y),
        "up_capture_5y": fmt(f.up_capture_5y), "down_capture_5y": fmt(f.down_capture_5y),
    }


# ── Performance ──────────────────────────────────────────────────────────────

def get_benchmark_for_category(category: str, data_date: date) -> dict:
    db = get_session()
    try:
        bm = db.query(BenchmarkData).filter(
            BenchmarkData.data_date == data_date,
            BenchmarkData.category == category,
            BenchmarkData.benchmark_label == "Benchmark 1",
        ).first()
        if not bm:
            return None
        def fmt(v): return round(v, 4) if v is not None else "-"
        return {
            "name": bm.benchmark_name,
            "returns": {
                "1d": fmt(bm.return_1d), "1w": fmt(bm.return_1w),
                "1m": fmt(bm.return_1m), "3m": fmt(bm.return_3m),
                "6m": fmt(bm.return_6m), "1y": fmt(bm.return_1y),
                "2y": fmt(bm.return_2y), "3y": fmt(bm.return_3y),
                "5y": fmt(bm.return_5y), "7y": fmt(bm.return_7y),
                "10y": fmt(bm.return_10y), "ytd": fmt(bm.return_ytd),
                "cy2025": fmt(bm.return_cy2025), "cy2024": fmt(bm.return_cy2024),
                "cy2023": fmt(bm.return_cy2023), "cy2022": fmt(bm.return_cy2022),
                "cy2021": fmt(bm.return_cy2021),
            },
            "risk": {},
        }
    finally:
        db.close()


def get_peer_avg(category: str, data_date: date, asset_class: str) -> dict:
    """Calculate peer average for all funds in category (full universe)."""
    db = get_session()
    try:
        funds = db.query(DailyFundData).filter(
            DailyFundData.data_date == data_date,
            DailyFundData.category == category,
            DailyFundData.isin.isnot(None),
        ).all()

        if not funds:
            return None

        def avg(vals):
            clean = [v for v in vals if v is not None]
            return round(sum(clean) / len(clean), 4) if clean else "-"

        return {
            "returns": {
                "1d":     avg([f.return_1d for f in funds]),
                "1w":     avg([f.return_1w for f in funds]),
                "1m":     avg([f.return_1m for f in funds]),
                "3m":     avg([f.return_3m for f in funds]),
                "6m":     avg([f.return_6m for f in funds]),
                "1y":     avg([f.return_1y for f in funds]),
                "2y":     avg([f.return_2y for f in funds]),
                "3y":     avg([f.return_3y for f in funds]),
                "5y":     avg([f.return_5y for f in funds]),
                "7y":     avg([f.return_7y for f in funds]),
                "10y":    avg([f.return_10y for f in funds]),
                "ytd":    avg([f.return_ytd for f in funds]),
                "cy2025": avg([f.return_cy2025 for f in funds]),
                "cy2024": avg([f.return_cy2024 for f in funds]),
                "cy2023": avg([f.return_cy2023 for f in funds]),
                "cy2022": avg([f.return_cy2022 for f in funds]),
                "cy2021": avg([f.return_cy2021 for f in funds]),
            },
            "risk": {
                # 1Y
                "std_dev_1y":           avg([f.std_dev_1y for f in funds]),
                "alpha_1y":             avg([f.alpha_1y for f in funds]),
                "beta_1y":              avg([f.beta_1y for f in funds]),
                "sharpe_ratio_1y":      avg([f.sharpe_ratio_1y for f in funds]),
                "sortino_ratio_1y":     avg([f.sortino_ratio_1y for f in funds]),
                "treynor_ratio_1y":     avg([f.treynor_ratio_1y for f in funds]),
                "information_ratio_1y": avg([f.information_ratio_1y for f in funds]),
                "up_capture_1y":        avg([f.up_capture_1y for f in funds]),
                "down_capture_1y":      avg([f.down_capture_1y for f in funds]),
                # 3Y
                "std_dev_3y":           avg([f.std_dev_3y for f in funds]),
                "alpha_3y":             avg([f.alpha_3y for f in funds]),
                "beta_3y":              avg([f.beta_3y for f in funds]),
                "sharpe_ratio_3y":      avg([f.sharpe_ratio_3y for f in funds]),
                "sortino_ratio_3y":     avg([f.sortino_ratio_3y for f in funds]),
                "treynor_ratio_3y":     avg([f.treynor_ratio_3y for f in funds]),
                "information_ratio_3y": avg([f.information_ratio_3y for f in funds]),
                "up_capture_3y":        avg([f.up_capture_3y for f in funds]),
                "down_capture_3y":      avg([f.down_capture_3y for f in funds]),
                # 5Y
                "std_dev_5y":           avg([f.std_dev_5y for f in funds]),
                "alpha_5y":             avg([f.alpha_5y for f in funds]),
                "beta_5y":              avg([f.beta_5y for f in funds]),
                "sharpe_ratio_5y":      avg([f.sharpe_ratio_5y for f in funds]),
                "sortino_ratio_5y":     avg([f.sortino_ratio_5y for f in funds]),
                "treynor_ratio_5y":     avg([f.treynor_ratio_5y for f in funds]),
                "information_ratio_5y": avg([f.information_ratio_5y for f in funds]),
                "up_capture_5y":        avg([f.up_capture_5y for f in funds]),
                "down_capture_5y":      avg([f.down_capture_5y for f in funds]),
            },
        }
    finally:
        db.close()


# ── Peer comparison ──────────────────────────────────────────────────────────

def get_whitelisted_peers(category: str, data_date: date, asset_class: str) -> list:
    """Return R1/R2 funds in category. If none, return all."""
    db = get_session()
    try:
        all_funds = db.query(DailyFundData).filter(
            DailyFundData.data_date == data_date,
            DailyFundData.category == category,
            DailyFundData.isin.isnot(None),
        ).all()
        fund_dicts = [_fund_to_dict(f) for f in all_funds]
        ranked = [f for f in fund_dicts if f["ranking"] in WHITELIST]
        return ranked if ranked else fund_dicts
    finally:
        db.close()


# ── Status ───────────────────────────────────────────────────────────────────

def get_latest_data_status() -> dict:
    db = get_session()
    try:
        latest = db.query(DailyFundData.data_date).order_by(
            DailyFundData.data_date.desc()
        ).first()
        if not latest:
            return {"data_as_of": None, "is_fresh": False}
        latest_date = latest[0]
        today = date.today()
        return {
            "data_as_of": str(latest_date),
            "is_fresh": latest_date == today,
        }
    finally:
        db.close()


def get_latest_data_date():
    db = get_session()
    try:
        result = db.query(DailyFundData.data_date).order_by(
            DailyFundData.data_date.desc()
        ).first()
        return result[0] if result else None
    finally:
        db.close()


def get_fund_inception_date(isin: str):
    db = get_session()
    try:
        result = db.query(DailyFundData.inception_date).filter(
            DailyFundData.isin == isin,
            DailyFundData.inception_date.isnot(None)
        ).first()
        return result[0] if result else None
    finally:
        db.close()


def get_fund_inception_date_by_amfi(amfi_code: str):
    db = get_session()
    try:
        result = db.query(
            DailyFundData.inception_date,
            DailyFundData.isin,
            DailyFundData.name
        ).filter(
            DailyFundData.amfi_code == amfi_code,
            DailyFundData.inception_date.isnot(None)
        ).first()
        if result:
            return {"inception_date": result[0], "isin": result[1], "name": result[2]}
        return None
    finally:
        db.close()


def get_all_funds_for_dropdown(data_date, asset_class: str, category: str) -> list:
    """Return ALL funds sorted by rank order: R1, R2, R3, R4, R5, then unranked/0."""
    db = get_session()
    RANK_ORDER = {'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'R5': 5}
    try:
        funds = db.query(
            DailyFundData.isin,
            DailyFundData.name,
            DailyFundData.ranking,
            DailyFundData.amfi_code,
            DailyFundData.return_1y,
            DailyFundData.return_3y,
        ).filter(
            DailyFundData.data_date == data_date,
            DailyFundData.asset_class == asset_class,
            DailyFundData.category == category,
            DailyFundData.isin.isnot(None),
        ).all()

        result = [{"isin": f.isin, "name": f.name, "ranking": f.ranking,
                   "amfi_code": f.amfi_code, "return_1y": f.return_1y,
                   "return_3y": f.return_3y} for f in funds]

        def sort_key(f):
            r = f.get("ranking") or ""
            return (RANK_ORDER.get(r, 99), -(f.get("return_1y") or -999))

        result.sort(key=sort_key)
        return result
    finally:
        db.close()

# ── App Settings (Gmail token storage) ──────────────────────────────────────

def get_setting(key: str) -> str | None:
    """Get a setting value from the DB."""
    db = get_session()
    try:
        from models.database import AppSettings
        row = db.query(AppSettings).filter(AppSettings.key == key).first()
        return row.value if row else None
    finally:
        db.close()


def set_setting(key: str, value: str):
    """Upsert a setting value in the DB."""
    db = get_session()
    try:
        from models.database import AppSettings
        row = db.query(AppSettings).filter(AppSettings.key == key).first()
        if row:
            row.value = value
        else:
            db.add(AppSettings(key=key, value=value))
        db.commit()
    finally:
        db.close()