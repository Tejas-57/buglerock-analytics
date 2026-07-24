# routers/models.py
"""
Model Portfolio / House View Hub
Computes BugleRock standard model portfolios from live fund universe.
Fund selection: best Sharpe_3Y → Morningstar rating → AUM per slice.
"""
from fastapi import APIRouter, Query
from datetime import date, timedelta
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Template definitions ───────────────────────────────────────────────────────
# Each slice: weight (%) + filter criteria applied to DailyFundData fields

TEMPLATES = {
    "conservative": {
        "label": "Conservative",
        "group": "risk",
        "risk": "Low",
        "risk_score": 1,
        "horizon": "1–3 years",
        "suitability": "Capital preservation with minimal volatility. Debt-anchored with a small equity sleeve for modest growth.",
        "slices": [
            {"w": 60, "asset_class": "Debt/Bond"},
            {"w": 20, "category_contains": "Large-Cap"},
            {"w": 10, "asset_class": "Hybrid"},
            {"w": 10, "category_contains": "Precious Metals"},
        ],
    },
    "mod_conservative": {
        "label": "Moderately Conservative",
        "group": "risk",
        "risk": "Low–Moderate",
        "risk_score": 2,
        "horizon": "3–5 years",
        "suitability": "Modest growth with limited equity exposure. For cautious investors wanting more than pure debt can offer.",
        "slices": [
            {"w": 45, "asset_class": "Debt/Bond"},
            {"w": 25, "category_contains": "Large-Cap"},
            {"w": 10, "category_contains": "Large & Mid-Cap"},
            {"w": 10, "asset_class": "Hybrid"},
            {"w": 10, "category_contains": "Precious Metals"},
        ],
    },
    "balanced": {
        "label": "Balanced",
        "group": "risk",
        "risk": "Moderate",
        "risk_score": 3,
        "horizon": "5–7 years",
        "suitability": "Roughly equal weight to growth and stability. A sensible core allocation for average risk tolerance.",
        "slices": [
            {"w": 30, "category_contains": "Large-Cap"},
            {"w": 20, "category_contains": "Large & Mid-Cap"},
            {"w": 25, "asset_class": "Debt/Bond"},
            {"w": 10, "category_contains": "Flexi Cap"},
            {"w": 10, "asset_class": "Hybrid"},
            {"w": 5,  "category_contains": "Precious Metals"},
        ],
    },
    "mod_aggressive": {
        "label": "Moderately Aggressive",
        "group": "risk",
        "risk": "Moderate–High",
        "risk_score": 4,
        "horizon": "7–10 years",
        "suitability": "Growth-tilted with a small ballast allocation. For investors comfortable with meaningful short-term swings.",
        "slices": [
            {"w": 25, "category_contains": "Large-Cap"},
            {"w": 25, "category_contains": "Large & Mid-Cap"},
            {"w": 15, "category_contains": "Mid-Cap"},
            {"w": 15, "category_contains": "Flexi Cap"},
            {"w": 15, "asset_class": "Debt/Bond"},
            {"w": 5,  "category_contains": "Precious Metals"},
        ],
    },
    "aggressive": {
        "label": "Aggressive",
        "group": "risk",
        "risk": "High",
        "risk_score": 5,
        "horizon": "10+ years",
        "suitability": "Maximum long-term growth potential. All-equity, spread across the cap spectrum for high growth with commensurate volatility.",
        "slices": [
            {"w": 20, "category_contains": "Large-Cap"},
            {"w": 20, "category_contains": "Large & Mid-Cap"},
            {"w": 25, "category_contains": "Mid-Cap"},
            {"w": 20, "category_contains": "Small-Cap"},
            {"w": 15, "category_contains": "Flexi Cap"},
        ],
    },
    "lmc_focus": {
        "label": "Large & Midcap Focus",
        "group": "theme",
        "risk": "Moderate–High",
        "risk_score": 4,
        "horizon": "7+ years",
        "suitability": "Concentrated in large and mid-cap equity — growth with stability from large-cap anchoring. No debt ballast.",
        "slices": [
            {"w": 40, "category_contains": "Large-Cap"},
            {"w": 40, "category_contains": "Large & Mid-Cap"},
            {"w": 20, "category_contains": "Mid-Cap"},
        ],
    },
    "mid_small_focus": {
        "label": "Mid & Small Cap Focus",
        "group": "theme",
        "risk": "High",
        "risk_score": 5,
        "horizon": "10+ years",
        "suitability": "High-growth mid and small-cap tilt for investors seeking aggressive capital appreciation and able to withstand deep drawdowns.",
        "slices": [
            {"w": 50, "category_contains": "Mid-Cap"},
            {"w": 50, "category_contains": "Small-Cap"},
        ],
    },
    "thematic": {
        "label": "Thematic Portfolio",
        "group": "theme",
        "risk": "High",
        "risk_score": 5,
        "horizon": "7–10 years",
        "suitability": "Diversified across sector plays — technology, financials, healthcare, infrastructure and consumption. Best as a satellite alongside a diversified core.",
        "slices": [
            {"w": 20, "category_contains": "Technology"},
            {"w": 20, "category_contains": "Financial Services"},
            {"w": 20, "category_contains": "Healthcare"},
            {"w": 20, "category_contains": "Infrastructure"},
            {"w": 20, "category_contains": "Consumption"},
        ],
    },
}


def resolve_date(date_str):
    if date_str:
        try:
            return date.fromisoformat(date_str)
        except Exception:
            pass
    return date.today()


def get_funds_for_slice(db, data_date, slice_def):
    """Return candidate funds for a slice, sorted by Sharpe3Y desc → rating desc → AUM desc."""
    from models.database import DailyFundData
    from sqlalchemy import func

    q = db.query(DailyFundData).filter(
        DailyFundData.nav_date == data_date,
        DailyFundData.nav != None,
        DailyFundData.fund_size != None,
    )

    if "asset_class" in slice_def:
        q = q.filter(DailyFundData.asset_class == slice_def["asset_class"])
    if "category_contains" in slice_def:
        q = q.filter(DailyFundData.category.ilike(f"%{slice_def['category_contains']}%"))

    funds = q.all()

    # Sort: Sharpe3Y desc → rating desc → AUM desc
    def sort_key(f):
        return (
            -(f.sharpe_ratio_3y or -99),
            -(f.morningstar_rating or 0),
            -(f.fund_size or 0),
        )

    funds.sort(key=sort_key)
    return funds


def compute_template(db, data_date, key, tpl):
    """Pick best fund per slice, compute blended metrics, return model dict."""
    picks = []
    used_isins = set()

    for sl in tpl["slices"]:
        candidates = get_funds_for_slice(db, data_date, sl)
        # Skip already-picked ISINs to avoid duplicates
        candidates = [f for f in candidates if f.isin not in used_isins]
        if not candidates:
            continue
        f = candidates[0]
        used_isins.add(f.isin)
        picks.append({"fund": f, "slice_weight": sl["w"], "slice_def": sl})

    if not picks:
        return None

    # Normalise weights to 100
    total_w = sum(p["slice_weight"] for p in picks)
    for p in picks:
        p["weight"] = round((p["slice_weight"] / total_w) * 100, 1)

    # Adjust rounding to sum exactly to 100
    diff = 100 - sum(p["weight"] for p in picks)
    if picks:
        picks[0]["weight"] = round(picks[0]["weight"] + diff, 1)

    # Blended metrics (weighted average)
    def blend(field):
        vals = [(getattr(p["fund"], field, None), p["weight"] / 100) for p in picks]
        valid = [(v, w) for v, w in vals if v is not None]
        if not valid:
            return None
        total_valid_w = sum(w for _, w in valid)
        if total_valid_w == 0:
            return None
        return sum(v * w for v, w in valid) / total_valid_w

    # Asset mix
    asset_mix = {"Equity": 0, "Debt": 0, "Hybrid": 0, "Gold": 0, "Other": 0}
    for p in picks:
        f = p["fund"]
        w = p["weight"]
        ac = (f.asset_class or "").lower()
        cat = (f.category or "").lower()
        if "debt" in ac or "bond" in ac:
            asset_mix["Debt"] += w
        elif "hybrid" in ac:
            asset_mix["Hybrid"] += w
        elif "precious metals" in cat or "gold" in cat or "silver" in cat:
            asset_mix["Gold"] += w
        elif "equity" in ac:
            asset_mix["Equity"] += w
        else:
            asset_mix["Other"] += w

    fund_list = []
    for p in picks:
        f = p["fund"]
        fund_list.append({
            "isin": f.isin,
            "name": f.name,
            "amfi_code": f.amfi_code,
            "category": f.category,
            "asset_class": f.asset_class,
            "weight": p["weight"],
            "nav": f.nav,
            "aum_cr": f.fund_size,
            "expense_ratio": f.expense_ratio,
            "morningstar_rating": f.morningstar_rating,
            "return_1y": f.return_1y,
            "return_3y": f.return_3y,
            "return_5y": f.return_5y,
            "return_1m": f.return_1m,
            "return_3m": f.return_3m,
            "sharpe_3y": f.sharpe_ratio_3y,
            "alpha_3y": f.alpha_3y,
            "beta_3y": f.beta_3y,
            "std_dev_3y": f.std_dev_3y,
            "up_capture_3y": f.up_capture_3y,
            "down_capture_3y": f.down_capture_3y,
        })

    return {
        "key": key,
        "label": tpl["label"],
        "group": tpl["group"],
        "risk": tpl["risk"],
        "risk_score": tpl["risk_score"],
        "horizon": tpl["horizon"],
        "suitability": tpl["suitability"],
        "funds": fund_list,
        "asset_mix": asset_mix,
        "blended": {
            "return_1y": round(blend("return_1y"), 2) if blend("return_1y") is not None else None,
            "return_3y": round(blend("return_3y"), 2) if blend("return_3y") is not None else None,
            "return_5y": round(blend("return_5y"), 2) if blend("return_5y") is not None else None,
            "return_1m": round(blend("return_1m"), 2) if blend("return_1m") is not None else None,
            "sharpe_3y": round(blend("sharpe_ratio_3y"), 2) if blend("sharpe_ratio_3y") is not None else None,
            "alpha_3y": round(blend("alpha_3y"), 2) if blend("alpha_3y") is not None else None,
            "std_dev_3y": round(blend("std_dev_3y"), 2) if blend("std_dev_3y") is not None else None,
            "expense_ratio": round(blend("expense_ratio"), 2) if blend("expense_ratio") is not None else None,
        },
        "fund_count": len(fund_list),
        "data_date": str(data_date),
    }


@router.get("/portfolios")
def get_model_portfolios(date: str = Query(None)):
    """
    Returns all BugleRock standard model portfolios computed from live fund universe.
    Fund selection: best Sharpe_3Y → rating → AUM per slice.
    """
    from models.database import SessionLocal, DailyFundData
    from services.db_service import get_latest_data_date

    data_date = resolve_date(date) if date else get_latest_data_date()

    db = SessionLocal()
    try:
        # Verify data exists for this date
        count = db.query(DailyFundData).filter(DailyFundData.nav_date == data_date).count()
        if count == 0:
            # Fall back to latest available date
            from sqlalchemy import func
            latest = db.query(func.max(DailyFundData.nav_date)).scalar()
            if not latest:
                return {"error": "No fund data available", "portfolios": []}
            data_date = latest

        portfolios = []
        for key, tpl in TEMPLATES.items():
            result = compute_template(db, data_date, key, tpl)
            if result:
                portfolios.append(result)

        return {
            "portfolios": portfolios,
            "data_date": str(data_date),
            "total": len(portfolios),
        }
    finally:
        db.close()


@router.get("/portfolios/{key}")
def get_model_portfolio(key: str, date: str = Query(None)):
    """Return a single model portfolio by key."""
    from models.database import SessionLocal, DailyFundData
    from services.db_service import get_latest_data_date

    if key not in TEMPLATES:
        from fastapi import HTTPException
        raise HTTPException(404, f"Model '{key}' not found. Valid keys: {list(TEMPLATES.keys())}")

    data_date = resolve_date(date) if date else get_latest_data_date()

    db = SessionLocal()
    try:
        result = compute_template(db, data_date, key, TEMPLATES[key])
        if not result:
            from fastapi import HTTPException
            raise HTTPException(500, "Could not compute model portfolio — fund data may be missing")
        return result
    finally:
        db.close()