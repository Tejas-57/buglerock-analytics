"""
db_service.py
All database read/write operations for BugleRock Analytics.
"""

from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import text
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
        count = db.query(DailyFundData).filter(
            DailyFundData.data_date == data_date
        ).count()
        return count > 0
    finally:
        db.close()


def log_email_fetch(email_date, data_date, file_name, status, message):
    db = get_session()
    try:
        log = EmailFetchLog(
            email_date=email_date,
            data_date=data_date,
            file_name=file_name,
            status=status,
            message=message,
        )
        db.add(log)
        db.commit()
    finally:
        db.close()


# ── Save parsed data ─────────────────────────────────────────────────────────

def save_parsed_data(parsed: dict):
    """Upsert all funds and benchmarks for a given data_date."""
    db = get_session()
    # Ensure data_date is a date object, not a string
    raw_date = parsed["data_date"]
    from datetime import date as date_type
    if isinstance(raw_date, str):
        data_date = date_type.fromisoformat(raw_date)
    else:
        data_date = raw_date

    # Also convert date strings in individual fund/benchmark dicts
    def coerce_dates(d: dict) -> dict:
        date_fields = ["data_date", "email_date", "nav_date", "nav_52w_high_date",
                       "fund_size_date", "inception_date"]
        result = dict(d)
        for field in date_fields:
            val = result.get(field)
            if isinstance(val, str) and val:
                try:
                    result[field] = date_type.fromisoformat(val)
                except ValueError:
                    result[field] = None
        return result

    try:
        # Delete existing data for this date (replace strategy)
        db.query(DailyFundData).filter(DailyFundData.data_date == data_date).delete()
        db.query(BenchmarkData).filter(BenchmarkData.data_date == data_date).delete()

        for fund in parsed["funds"]:
            fund_clean = coerce_dates(fund)
            obj = DailyFundData(**{k: v for k, v in fund_clean.items() if hasattr(DailyFundData, k)})
            db.add(obj)

        for bm in parsed["benchmarks"]:
            bm_clean = coerce_dates(bm)
            obj = BenchmarkData(**{k: v for k, v in bm_clean.items() if hasattr(BenchmarkData, k)})
            db.add(obj)

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
    """
    Return whitelisted funds for dropdown.
    If no R1/R2 exist in category, return all funds.
    """
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

        fund_list = [{"isin": f.isin, "name": f.name, "ranking": f.ranking, "amfi_code": f.amfi_code} for f in all_funds]

        # Apply whitelist rule
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
        if not f:
            return None
        return _fund_to_dict(f)
    finally:
        db.close()


def _fund_to_dict(f: DailyFundData) -> dict:
    def fmt(v):
        return v if v is not None else "-"

    return {
        "isin": f.isin, "name": f.name, "ranking": f.ranking,
        "category": f.category, "asset_class": f.asset_class,
        "morningstar_category": fmt(f.morningstar_category),
        "morningstar_rating": fmt(f.morningstar_rating),
        "inception_date": str(f.inception_date) if f.inception_date else "-",
        "nav": fmt(f.nav), "nav_date": str(f.nav_date) if f.nav_date else "-",
        "nav_52w_high": fmt(f.nav_52w_high),
        "fund_size": fmt(f.fund_size),
        "expense_ratio": fmt(f.expense_ratio),
        "amfi_code": fmt(f.amfi_code), "rta_code": fmt(f.rta_code),
        "manager_name": fmt(f.manager_name), "exit_load": fmt(f.exit_load),
        "large_cap": fmt(f.large_cap), "mid_cap": fmt(f.mid_cap), "small_cap": fmt(f.small_cap),
        "equity_pct": fmt(f.equity_pct), "bond_pct": fmt(f.bond_pct),
        "cash_pct": fmt(f.cash_pct), "other_pct": fmt(f.other_pct),
        "pe_ratio": fmt(f.pe_ratio), "pb_ratio": fmt(f.pb_ratio),
        "equity_style": fmt(f.equity_style),
        "returns": _returns_dict(f),
        "risk": _risk_dict(f),
        # Debt fields
        "avg_maturity": fmt(f.avg_maturity), "modified_duration": fmt(f.modified_duration),
        "ytm": fmt(f.ytm), "avg_credit_quality": fmt(f.avg_credit_quality),
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
    def fmt(v): return round(v, 4) if v is not None else "-"
    return {
        "std_dev": fmt(f.std_dev), "alpha": fmt(f.alpha),
        "beta": fmt(f.beta), "sharpe_ratio": fmt(f.sharpe_ratio),
        "sortino_ratio": fmt(f.sortino_ratio), "treynor_ratio": fmt(f.treynor_ratio),
        "information_ratio": fmt(f.information_ratio),
        "up_capture": fmt(f.up_capture), "down_capture": fmt(f.down_capture),
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
                "1d":    avg([f.return_1d for f in funds]),
                "1w":    avg([f.return_1w for f in funds]),
                "1m":    avg([f.return_1m for f in funds]),
                "3m":    avg([f.return_3m for f in funds]),
                "6m":    avg([f.return_6m for f in funds]),
                "1y":    avg([f.return_1y for f in funds]),
                "2y":    avg([f.return_2y for f in funds]),
                "3y":    avg([f.return_3y for f in funds]),
                "5y":    avg([f.return_5y for f in funds]),
                "7y":    avg([f.return_7y for f in funds]),
                "10y":   avg([f.return_10y for f in funds]),
                "ytd":   avg([f.return_ytd for f in funds]),
                "cy2025":avg([f.return_cy2025 for f in funds]),
                "cy2024":avg([f.return_cy2024 for f in funds]),
                "cy2023":avg([f.return_cy2023 for f in funds]),
                "cy2022":avg([f.return_cy2022 for f in funds]),
                "cy2021":avg([f.return_cy2021 for f in funds]),
            },
            "risk": {
                "std_dev":          avg([f.std_dev for f in funds]),
                "alpha":            avg([f.alpha for f in funds]),
                "beta":             avg([f.beta for f in funds]),
                "sharpe_ratio":     avg([f.sharpe_ratio for f in funds]),
                "sortino_ratio":    avg([f.sortino_ratio for f in funds]),
                "treynor_ratio":    avg([f.treynor_ratio for f in funds]),
                "information_ratio":avg([f.information_ratio for f in funds]),
                "up_capture":       avg([f.up_capture for f in funds]),
                "down_capture":     avg([f.down_capture for f in funds]),
            },
        }
    finally:
        db.close()


# ── Peer comparison ──────────────────────────────────────────────────────────

def get_whitelisted_peers(category: str, data_date: date, asset_class: str) -> list:
    """Return only R1/R2 funds in category for peer comparison."""
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
            "is_fresh": latest_date == today or (today.weekday() >= 5 and latest_date >= today),
        }
    finally:
        db.close()


def get_latest_data_date():
    """Return the most recent data_date in the DB, or None if empty."""
    db = get_session()
    try:
        result = db.query(DailyFundData.data_date).order_by(DailyFundData.data_date.desc()).first()
        return result[0] if result else None
    finally:
        db.close()


def get_fund_inception_date(isin: str):
    """Return inception date for a fund by ISIN, or None if not found."""
    from datetime import date as date_type
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
    """Return inception date for a fund by AMFI code, or None if not found."""
    db = get_session()
    try:
        result = db.query(DailyFundData.inception_date, DailyFundData.isin, DailyFundData.name).filter(
            DailyFundData.amfi_code == amfi_code,
            DailyFundData.inception_date.isnot(None)
        ).first()
        if result:
            return {"inception_date": result[0], "isin": result[1], "name": result[2]}
        return None
    finally:
        db.close()