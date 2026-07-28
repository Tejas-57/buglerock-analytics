# routers/peer.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.db_service import get_whitelisted_peers, get_peer_avg, get_latest_data_date
from services.gmail_watcher import fetch_and_store

router = APIRouter()

PEER_CATEGORIES = [
    {"group": "Core equity",     "label": "Large Cap",          "db_sub": "India Fund Large-Cap"},
    {"group": "Core equity",     "label": "Large & Mid Cap",    "db_sub": "India Fund Large & Mid-Cap"},
    {"group": "Core equity",     "label": "Flexi Cap",          "db_sub": "Cat: Flexi Cap Funds"},
    {"group": "Core equity",     "label": "Multi Cap",          "db_sub": "Cat: Multi Cap Funds"},
    {"group": "Core equity",     "label": "Focused Fund",       "db_sub": "India Fund Focused Fund"},
    {"group": "Mid & small cap", "label": "Mid Cap",            "db_sub": "India Fund Mid-Cap"},
    {"group": "Mid & small cap", "label": "Small Cap",          "db_sub": "India Fund Small-Cap"},
    {"group": "Value & contra",  "label": "Value / Contra",     "db_sub": "Cat: Contra / Value Funds"},
    {"group": "Tax saving",      "label": "ELSS (Tax Savings)", "db_sub": "India Fund ELSS (Tax Savings)"},
]

CAT_DESC = {
    "Large Cap":          "Funds investing ≥80% in top-100 companies by market cap. Stable, lower volatility. Benchmark: Nifty 50 TRI.",
    "Large & Mid Cap":    "Funds split ≥35% each in large and mid cap. Higher growth potential than pure large cap. Benchmark: Nifty LargeMidcap 250 TRI.",
    "Flexi Cap":          "Unconstrained across market caps. Manager discretion on allocation. Benchmark: Nifty 500 TRI.",
    "Multi Cap":          "Mandatory ≥25% each in large, mid and small cap. Diversified by SEBI mandate. Benchmark: Nifty 500 TRI.",
    "Focused Fund":       "Concentrated portfolios of max 30 stocks. Conviction-driven, higher idiosyncratic risk. Benchmark: Nifty 500 TRI.",
    "Mid Cap":            "Funds investing ≥65% in mid-cap companies (rank 101–250). Higher growth, higher volatility. Benchmark: Nifty Midcap 150 TRI.",
    "Small Cap":          "Funds investing ≥65% in small-cap companies (rank 251+). Maximum long-term growth potential, significant volatility. Benchmark: Nifty Smallcap 250 TRI.",
    "Value / Contra":     "Value and contrarian strategies — undervalued or out-of-favour stocks. Benchmark: Nifty 500 TRI.",
    "ELSS (Tax Savings)": "80C tax-saving funds with 3-year lock-in. Predominantly equity. Benchmark: Nifty 500 TRI.",
}

CY_YEARS = [2021, 2022, 2023, 2024, 2025]


def _safe_float(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def _percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    idx = (n - 1) * p
    lo, hi = int(idx), min(int(idx) + 1, n - 1)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def _dist_stats(values):
    vals = sorted([v for v in values if v is not None])
    if not vals:
        return None
    avg = sum(vals) / len(vals)
    return {
        "min":    round(vals[0], 2),
        "p25":    round(_percentile(vals, 0.25), 2),
        "median": round(_percentile(vals, 0.5), 2),
        "p75":    round(_percentile(vals, 0.75), 2),
        "max":    round(vals[-1], 2),
        "avg":    round(avg, 2),
        "count":  len(vals),
    }


def _assign_quartiles(funds, key):
    with_vals = [(f["isin"], f.get(key)) for f in funds if f.get(key) is not None]
    with_vals.sort(key=lambda x: x[1], reverse=True)
    n = len(with_vals)
    qmap = {}
    for i, (isin, _) in enumerate(with_vals):
        qmap[isin] = min(int((i / n) * 4) + 1, 4) if n > 0 else 4
    return qmap


@router.get("/categories")
def list_peer_categories():
    from collections import OrderedDict
    groups = OrderedDict()
    for c in PEER_CATEGORIES:
        g = c["group"]
        if g not in groups:
            groups[g] = []
        groups[g].append({"label": c["label"], "desc": CAT_DESC.get(c["label"], "")})
    return {"groups": [{"group": g, "categories": cats} for g, cats in groups.items()]}


@router.get("/category")
def peer_category(
    category: str = Query(..., description="Category label e.g. 'Large Cap'"),
    date: str = Query(None),
):
    from models.database import SessionLocal, DailyFundData
    from sqlalchemy import func

    allowed = {c["label"] for c in PEER_CATEGORIES}
    if category not in allowed:
        raise HTTPException(400, f"Category '{category}' not in allowed peer groups. Valid: {sorted(allowed)}")

    db = SessionLocal()
    try:
        if date:
            try:
                data_date = date_type.fromisoformat(date)
            except Exception:
                raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD.")
        else:
            data_date = get_latest_data_date()

        # Verify data exists for this date; fall back to latest if not
        count = db.query(DailyFundData).filter(DailyFundData.data_date == data_date).count()
        if count == 0:
            latest = db.query(func.max(DailyFundData.data_date)).scalar()
            if not latest:
                raise HTTPException(404, "No fund data available.")
            data_date = latest

        cat_lookup = next(c for c in PEER_CATEGORIES if c["label"] == category)
        db_sub = cat_lookup["db_sub"]

        funds_raw = db.query(DailyFundData).filter(
            DailyFundData.data_date == data_date,
            DailyFundData.category == db_sub,
            DailyFundData.nav != None,
        ).all()

        # Deduplicate by ISIN
        seen = set()
        funds = []
        for f in funds_raw:
            if f.isin not in seen:
                seen.add(f.isin)
                funds.append(f)

        if not funds:
            return {"category": category, "funds": [], "stats": {}, "distribution": {}, "data_date": str(data_date)}

        def ser(f):
            d = {
                "isin":              f.isin,
                "name":              f.name,
                "amfi_code":         f.amfi_code,
                "amc":               (f.name or "").split()[0] if f.name else None,
                "category":          f.category,
                "morningstar_rating": _safe_float(f.morningstar_rating),
                "nav":               _safe_float(f.nav),
                "fund_size":         _safe_float(f.fund_size),
                "expense_ratio":     _safe_float(f.expense_ratio),
                "ranking":           f.ranking,
                "return_6m":         _safe_float(f.return_6m),
                "return_1y":         _safe_float(f.return_1y),
                "return_3y":         _safe_float(f.return_3y),
                "return_5y":         _safe_float(f.return_5y),
                "return_ytd":        _safe_float(f.return_ytd),
                "return_1m":         _safe_float(f.return_1m),
                "return_3m":         _safe_float(f.return_3m),
                "sharpe_ratio_3y":   _safe_float(f.sharpe_ratio_3y),
                "alpha_3y":          _safe_float(f.alpha_3y),
                "alpha_5y":          _safe_float(f.alpha_5y),
                "beta_3y":           _safe_float(f.beta_3y),
                "std_dev_3y":        _safe_float(f.std_dev_3y),
                "std_dev_5y":        _safe_float(f.std_dev_5y),
                "up_capture_3y":     _safe_float(f.up_capture_3y),
                "down_capture_3y":   _safe_float(f.down_capture_3y),
            }
            for yr in CY_YEARS:
                d[f"return_cy{yr}"] = _safe_float(getattr(f, f"return_cy{yr}", None))
            return d

        fund_list = [ser(f) for f in funds]

        # Quartiles
        q1y = _assign_quartiles(fund_list, "return_1y")
        q3y = _assign_quartiles(fund_list, "return_3y")
        for f in fund_list:
            f["quartile_1y"] = q1y.get(f["isin"], 4)
            f["quartile_3y"] = q3y.get(f["isin"], 4)

        # Default sort: 1Y return desc
        fund_list.sort(key=lambda x: (x["return_1y"] is None, -(x["return_1y"] or 0)))
        for i, f in enumerate(fund_list):
            f["peer_rank_1y"] = i + 1

        def avg(vals):
            v = [x for x in vals if x is not None]
            return round(sum(v) / len(v), 2) if v else None

        stats = {
            "fund_count":       len(fund_list),
            "avg_return_1m":    avg([f["return_1m"]    for f in fund_list]),
            "avg_return_3m":    avg([f["return_3m"]    for f in fund_list]),
            "avg_return_6m":    avg([f["return_6m"]    for f in fund_list]),
            "avg_return_1y":    avg([f["return_1y"]    for f in fund_list]),
            "avg_return_3y":    avg([f["return_3y"]    for f in fund_list]),
            "avg_return_5y":    avg([f["return_5y"]    for f in fund_list]),
            "avg_std_dev_3y":   avg([f["std_dev_3y"]   for f in fund_list]),
            "avg_std_dev_5y":   avg([f["std_dev_5y"]   for f in fund_list]),
            "avg_aum":          avg([f["fund_size"]    for f in fund_list]),
            # kept for other sections
            "avg_sharpe":       avg([f["sharpe_ratio_3y"] for f in fund_list]),
            "avg_er":           avg([f["expense_ratio"]   for f in fund_list]),
            "avg_alpha_3y":     avg([f["alpha_3y"]        for f in fund_list]),
            "avg_alpha_5y":     avg([f["alpha_5y"]        for f in fund_list]),
            "avg_beta":         avg([f["beta_3y"]         for f in fund_list]),
            "avg_up_capture":   avg([f["up_capture_3y"]   for f in fund_list]),
            "avg_down_capture": avg([f["down_capture_3y"] for f in fund_list]),
        }

        cy_medians = {}
        for yr in CY_YEARS:
            key = f"return_cy{yr}"
            cy_medians[key] = _dist_stats([f[key] for f in fund_list])

        distribution = {
            "return_1y":       _dist_stats([f["return_1y"]       for f in fund_list]),
            "return_3y":       _dist_stats([f["return_3y"]       for f in fund_list]),
            "return_5y":       _dist_stats([f["return_5y"]       for f in fund_list]),
            "sharpe_ratio_3y": _dist_stats([f["sharpe_ratio_3y"] for f in fund_list]),
            "std_dev_3y":      _dist_stats([f["std_dev_3y"]      for f in fund_list]),
            "expense_ratio":   _dist_stats([f["expense_ratio"]   for f in fund_list]),
            "cy_medians":      cy_medians,
        }

        return {
            "category":    category,
            "description": CAT_DESC.get(category, ""),
            "funds":       fund_list,
            "stats":       stats,
            "distribution": distribution,
            "data_date":   str(data_date),
        }
    finally:
        db.close()


@router.get("/comparison")
def peer_comparison(isin: str, category: str, asset_class: str, date: str = Query(None)):
    d = date_type.fromisoformat(date) if date else (get_latest_data_date() or date_type.today())
    fetch_and_store(d)
    peers    = get_whitelisted_peers(category, d, asset_class)
    peer_avg = get_peer_avg(category, d, asset_class)
    return {"peers": peers, "peer_avg": peer_avg, "date": str(d)}