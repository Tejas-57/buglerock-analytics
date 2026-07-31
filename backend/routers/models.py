# routers/models.py
"""
BugleRock Multi-Asset Model Portfolios — linprog (HiGHS) constraint solver.

Universe: R1/R2 ranked funds only (Active Equity, Debt, Hybrid).
Commodities/Alternates bucket is wired in for when Gold/Silver funds get ranked.

Solver: scipy.optimize.linprog, method="highs" (pure feasibility LP, objective=0).

Constraints per model:
  - Σ wᵢ = 100
  - MIN_W ≤ wᵢ ≤ MAX_W
  - Effective equity  = Σ wᵢ·equity_pctᵢ/100  ∈ [eq_lo, eq_hi]
  - Effective debt    = Σ wᵢ·bond_pctᵢ/100    ∈ [debt_lo, debt_hi]
  - Rebased cap mix (Large/Mid/Small) across equity-bearing funds, weighted by
    wᵢ·equity_pctᵢ, each ∈ target ±CAP_TOL  (linearised)

Weights come straight from the solver — NOT equal weight.
"""
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
import logging
import numpy as np

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Asset-class risk tiers (debt + hybrid) ──────────────────────────────────────
DEBT_RISK_TIER = {
    "India OE Overnight":               1,
    "India OE Liquid":                  1,
    "India OE Money Market":            1,
    "India OE Ultra Short Duration":    1,
    "India OE Low Duration":            2,
    "India OE Floating Rate":           2,
    "India OE Banking & PSU":           2,
    "India OE Short Duration":          3,
    "India OE Corporate Bond":          3,
    "India OE Medium Duration":         4,
    "India OE Medium to Long Duration": 4,
    "India OE Dynamic Bond":            4,
    "India OE Government Bond":         5,
    "India OE Credit Risk":             5,
}
HYBRID_RISK_TIER = {
    "India Fund Arbitrage Fund":                1,
    "India Fund Conservative Allocation":       1,
    "India Fund Equity Savings - Conservative": 2,
    "India Fund Dynamic Asset Allocation":      3,
    "India Fund Equity Savings - Aggressive":   3,
    "India Fund Aggressive Allocation":         4,
}

# ── Model definitions (5 profiles, per PDF + interpolation) ─────────────────────
# eq_lo/eq_hi and debt_lo/debt_hi are EFFECTIVE asset-class ranges (incl hybrid split)
MODELS = {
    "conservative": {
        "label": "Conservative", "risk": "Low", "risk_score": 1,
        "horizon": "3+ years", "volatility": "5–6%", "max_drawdown": "5–10%",
        "suitability": "A low-volatility portfolio designed for capital preservation and stable returns, emphasizing fixed income with limited equity exposure. Ideal for investors with lower risk tolerance.",
        "eq_lo": 27, "eq_hi": 33, "debt_lo": 67, "debt_hi": 73,
        "cap_large": 75, "cap_mid": 15, "cap_small": 10,
        "debt_tiers": [1, 2, 3], "hybrid_tiers": [1, 2],
        "eq_per_cat": 1, "debt_per_cat": 2, "hyb_per_cat": 2,
    },
    "mod_conservative": {
        "label": "Moderately Conservative", "risk": "Low–Moderate", "risk_score": 2,
        "horizon": "3–5 years", "volatility": "6–7%", "max_drawdown": "8–12%",
        "suitability": "Modest growth with limited equity exposure. Short-to-medium duration debt balanced with hybrid allocation for cautious investors wanting more than pure debt.",
        "eq_lo": 32, "eq_hi": 38, "debt_lo": 62, "debt_hi": 68,
        "cap_large": 70, "cap_mid": 20, "cap_small": 10,
        "debt_tiers": [2, 3, 4], "hybrid_tiers": [1, 2, 3],
        "eq_per_cat": 1, "debt_per_cat": 2, "hyb_per_cat": 2,
    },
    "balanced": {
        "label": "Balanced", "risk": "Moderate", "risk_score": 3,
        "horizon": "3–5 years", "volatility": "6–9%", "max_drawdown": "10–15%",
        "suitability": "Moderate growth portfolio with reduced volatility, balancing capital appreciation and income generation. Ideal for investors with moderate risk appetite and medium-term goals.",
        "eq_lo": 47, "eq_hi": 53, "debt_lo": 47, "debt_hi": 53,
        "cap_large": 60, "cap_mid": 25, "cap_small": 15,
        "debt_tiers": [3, 4], "hybrid_tiers": [2, 3, 4],
        "eq_per_cat": 1, "debt_per_cat": 1, "hyb_per_cat": 2,
    },
    "mod_aggressive": {
        "label": "Moderately Aggressive", "risk": "Moderate–High", "risk_score": 4,
        "horizon": "5–7 years", "volatility": "8–12%", "max_drawdown": "12–18%",
        "suitability": "Growth-tilted portfolio with a debt ballast. Primarily equity across the cap spectrum, complemented by aggressive hybrid funds and minimal fixed income.",
        "eq_lo": 67, "eq_hi": 73, "debt_lo": 27, "debt_hi": 33,
        "cap_large": 55, "cap_mid": 23, "cap_small": 22,
        "debt_tiers": [4, 5], "hybrid_tiers": [3, 4],
        "eq_per_cat": 2, "debt_per_cat": 1, "hyb_per_cat": 1,
    },
    "aggressive": {
        "label": "Aggressive", "risk": "High", "risk_score": 5,
        "horizon": "5+ years", "volatility": "10–15%", "max_drawdown": "15–20%",
        "suitability": "Maximizes growth potential through higher equity allocation across all cap segments, suitable for investors with a long-term horizon and higher risk tolerance.",
        "eq_lo": 77, "eq_hi": 83, "debt_lo": 17, "debt_hi": 23,
        "cap_large": 40, "cap_mid": 30, "cap_small": 30,
        "debt_tiers": [4, 5], "hybrid_tiers": [3, 4],
        "eq_per_cat": 2, "debt_per_cat": 1, "hyb_per_cat": 1,
    },
}

# Portfolio-level fund count bounds
MIN_FUNDS = 9
MAX_FUNDS = 15
# Dynamic minimum weight: if portfolio has >11 funds, allow smaller weights
MIN_W_TIGHT = 5.0    # for 9-11 funds
MIN_W_LOOSE = 3.0    # for 12-15 funds
FUND_COUNT_THRESHOLD = 11  # switch point

# ── Equity category classification ─────────────────────────────────────────────
CORE_EQUITY_CATS = {
    "India Fund Large-Cap",
    "India Fund Large & Mid-Cap",
    "Cat: Flexi Cap Funds",
    "Cat: Multi Cap Funds",
    "India Fund Focused Fund",
    "India Fund Mid-Cap",
    "India Fund Small-Cap",
    "Cat: Contra / Value Funds",
}

# Non-core (thematic/sectoral) — allowed but capped at MAX_NONCORE_W per fund
NONCORE_EQUITY_CATS = {
    "Cat: Banking & Financial Services Funds",
    "Cat: Healthcare funds",
    "Cat: IT / Tech Funds",
    "Cat: Infrastructure Funds",
    "Cat: Consumption Funds",
    "Cat: MNC Funds",
    "India Fund Sector - Energy",
    "Thematic Funds",
}

# Excluded entirely from model portfolios
EXCLUDED_EQUITY_CATS = {"India Fund ELSS (Tax Savings)"}

MAX_NONCORE_W = 10.0   # non-core equity funds capped at 10% of portfolio

# Cap-mix tolerance (per model targets defined in MODELS dict)
CAP_TOL = 5.0

# Weight bounds per fund
MAX_W = 20.0


def _s(v):
    try: return float(v) if v is not None else None
    except: return None

def _sf(v, d=0.0):
    r = _s(v); return r if r is not None else d


def _solve(funds, eq_lo, eq_hi, debt_lo, debt_hi,
           cap_large, cap_mid, cap_small,
           cap_tol=CAP_TOL, max_w=MAX_W):
    """
    Pure feasibility LP via HiGHS. Returns weight array (sums to 100) or None.
    Cap targets and tolerance are per-model.
    """
    from scipy.optimize import linprog

    n = len(funds)
    if n == 0:
        return None

    def get_eq_pct(f):
        v = _s(f.get("equity_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Equity" else 0.0

    def get_debt_pct(f):
        v = _s(f.get("bond_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Debt" else 0.0

    eq_pct   = np.array([get_eq_pct(f)   for f in funds])
    debt_pct = np.array([get_debt_pct(f) for f in funds])
    large    = np.array([_sf(f.get("large_cap")) for f in funds])
    mid      = np.array([_sf(f.get("mid_cap"))   for f in funds])
    small    = np.array([_sf(f.get("small_cap")) for f in funds])
    eq_weight_coef = eq_pct / 100.0

    A_ub, b_ub = [], []
    A_ub.append(-eq_pct / 100.0);  b_ub.append(-eq_lo)
    A_ub.append( eq_pct / 100.0);  b_ub.append( eq_hi)
    A_ub.append(-debt_pct / 100.0); b_ub.append(-debt_lo)
    A_ub.append( debt_pct / 100.0); b_ub.append( debt_hi)
    A_ub.append(-eq_weight_coef * (large - (cap_large - cap_tol))); b_ub.append(0)
    A_ub.append( eq_weight_coef * (large - (cap_large + cap_tol))); b_ub.append(0)
    A_ub.append(-eq_weight_coef * (mid   - (cap_mid   - cap_tol))); b_ub.append(0)
    A_ub.append( eq_weight_coef * (mid   - (cap_mid   + cap_tol))); b_ub.append(0)
    A_ub.append(-eq_weight_coef * (small - (cap_small - cap_tol))); b_ub.append(0)
    A_ub.append( eq_weight_coef * (small - (cap_small + cap_tol))); b_ub.append(0)

    A_ub = np.array(A_ub); b_ub = np.array(b_ub)
    A_eq = np.ones((1, n)); b_eq = np.array([100.0])
    bounds = [(0.0, max_w)] * n
    c = np.zeros(n)

    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    if res.status == 0:
        w = res.x
        # First pass: drop anything below the loose threshold (3%)
        w[w < MIN_W_LOOSE] = 0.0
        total = w.sum()
        if total <= 0:
            return None
        w = w / total * 100

        # Count remaining funds
        nonzero = np.where(w > 0)[0]

        # Dynamic min weight: if ≤11 funds, apply tight (5%) threshold
        if len(nonzero) <= FUND_COUNT_THRESHOLD:
            w2 = w.copy()
            w2[w2 < MIN_W_TIGHT] = 0.0
            if w2.sum() > 0:
                w = w2 / w2.sum() * 100
                nonzero = np.where(w > 0)[0]

        # Enforce MAX_FUNDS: if too many, drop lowest-weighted
        if len(nonzero) > MAX_FUNDS:
            sorted_idx = nonzero[np.argsort(w[nonzero])]
            drop = sorted_idx[:len(nonzero) - MAX_FUNDS]
            w[drop] = 0.0
            w = w / w.sum() * 100

        return np.round(w, 2)
    return None


def _solve_with_retry(funds, m):
    """
    Retry ladder: progressively relax cap-mix tolerance.
    LP lower bound = 0 throughout.
    """
    cap_l, cap_m, cap_s = m["cap_large"], m["cap_mid"], m["cap_small"]
    for tol in [CAP_TOL, CAP_TOL+2, CAP_TOL+5, CAP_TOL+8, CAP_TOL+12]:
        w = _solve(funds, m["eq_lo"], m["eq_hi"], m["debt_lo"], m["debt_hi"],
                   cap_l, cap_m, cap_s, tol, MAX_W)
        if w is not None:
            return w, tol
    # Last resort: widen asset bands by 5%
    w = _solve(funds, m["eq_lo"]-5, m["eq_hi"]+5, m["debt_lo"]-5, m["debt_hi"]+5,
               cap_l, cap_m, cap_s, CAP_TOL+15, MAX_W)
    return (w, CAP_TOL+15) if w is not None else (None, None)


def _pick_candidates(eq_pool, debt_pool, hybrid_pool, m):
    """
    Pass eligible candidates to the solver with per-category limits.
    - eq_per_cat: max equity funds per category (typically 1, 2 for aggressive)
    - debt_per_cat: max debt funds per category
    - hyb_per_cat: max hybrid funds per category
    LP lower bound = 0 so solver zeros funds it doesn't need.
    """
    cap_l, cap_m, cap_s = m["cap_large"], m["cap_mid"], m["cap_small"]
    def cap_dev(f):
        return (abs(_sf(f.get("large_cap")) - cap_l) +
                abs(_sf(f.get("mid_cap"))   - cap_m) +
                abs(_sf(f.get("small_cap")) - cap_s))

    from collections import defaultdict

    def top_n_per_cat(pool, n):
        """Take top N funds per category, sorted by cap-mix fit within category."""
        bc = defaultdict(list)
        for f in pool: bc[f.get("category","")].append(f)
        result = []
        for cat, funds in bc.items():
            result.extend(sorted(funds, key=cap_dev)[:n])
        return sorted(result, key=cap_dev)

    eq_sorted = top_n_per_cat(eq_pool, m["eq_per_cat"])

    debt_allowed = {c for c,t in DEBT_RISK_TIER.items()   if t in m["debt_tiers"]}
    hyb_allowed  = {c for c,t in HYBRID_RISK_TIER.items() if t in m["hybrid_tiers"]}
    debt_elig = [f for f in debt_pool   if f.get("category") in debt_allowed] or list(debt_pool)
    hyb_elig  = [f for f in hybrid_pool if f.get("category") in hyb_allowed]  or list(hybrid_pool)

    debt_sorted = top_n_per_cat(debt_elig, m["debt_per_cat"])
    hyb_sorted  = top_n_per_cat(hyb_elig,  m["hyb_per_cat"])

    raw = eq_sorted + debt_sorted + hyb_sorted

    seen, out = set(), []
    for f in raw:
        key = f.get("isin") or (f.get("name") or "").strip().lower()
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def _build_portfolio(model_key, all_funds):
    m = MODELS[model_key]
    eq_pool     = [f for f in all_funds
                   if f["asset_class"] == "Equity"
                   and f.get("category") in CORE_EQUITY_CATS]
    debt_pool   = [f for f in all_funds if f["asset_class"] == "Debt"]
    hybrid_pool = [f for f in all_funds if f["asset_class"] == "Hybrid"]

    candidates = _pick_candidates(eq_pool, debt_pool, hybrid_pool, m)

    # Final dedup — belt and suspenders
    seen, candidates_deduped = set(), []
    for f in candidates:
        key = f.get("isin") or (f.get("name") or "").strip().lower()
        if key not in seen:
            seen.add(key)
            candidates_deduped.append(f)
    candidates = candidates_deduped

    weights, used_tol = _solve_with_retry(candidates, m)

    result = []
    seen_result = set()
    if weights is not None:
        for f, w in zip(candidates, weights):
            key = f.get("isin") or (f.get("name") or "").strip().lower()
            if w >= MIN_W_LOOSE - 0.1 and key not in seen_result:
                seen_result.add(key)
                sleeve = ("Equity" if f["asset_class"]=="Equity"
                          else "Hybrid" if f["asset_class"]=="Hybrid" else "Debt")
                result.append({**f, "weight": round(float(w), 1), "sleeve": sleeve})
        tot = sum(f["weight"] for f in result)
        if tot > 0:
            for f in result:
                f["weight"] = round(f["weight"] * 100 / tot, 1)

    # ── Effective asset-class exposure (rebased incl hybrid split) ──────────
    def _eq_pct(f):
        v = _s(f.get("equity_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Equity" else 0.0

    def _debt_pct(f):
        v = _s(f.get("bond_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Debt" else 0.0

    eff_equity = sum(f["weight"] * _eq_pct(f) / 100 for f in result)
    eff_debt   = sum(f["weight"] * _debt_pct(f) / 100 for f in result)
    eff_other  = max(0.0, 100 - eff_equity - eff_debt)

    # ── Rebased cap mix (weighted by equity-bearing exposure) ───────────────
    cap_num_l = cap_num_m = cap_num_s = cap_den = 0.0
    for f in result:
        eq_frac = _eq_pct(f) / 100
        ew = f["weight"] * eq_frac
        if ew > 0 and (_sf(f.get("large_cap")) + _sf(f.get("mid_cap")) + _sf(f.get("small_cap"))) > 1:
            cap_num_l += ew * _sf(f.get("large_cap"))
            cap_num_m += ew * _sf(f.get("mid_cap"))
            cap_num_s += ew * _sf(f.get("small_cap"))
            cap_den   += ew
    rb_large = round(cap_num_l/cap_den, 1) if cap_den else None
    rb_mid   = round(cap_num_m/cap_den, 1) if cap_den else None
    rb_small = round(cap_num_s/cap_den, 1) if cap_den else None

    def wavg(key):
        vals = [(f["weight"], _sf(f.get(key))) for f in result if _s(f.get(key)) is not None]
        if not vals: return None
        tw = sum(w for w,_ in vals)
        return round(sum(w*v for w,v in vals)/tw, 2) if tw else None

    # ── Sort funds: equity (by category order) → hybrid → debt → alternates ────
    EQUITY_CAT_ORDER = [
        "India Fund Large-Cap",
        "India Fund Large & Mid-Cap",
        "Cat: Flexi Cap Funds",
        "Cat: Multi Cap Funds",
        "India Fund Focused Fund",
        "India Fund Mid-Cap",
        "India Fund Small-Cap",
        "Cat: Contra / Value Funds",
    ]
    SLEEVE_ORDER = {"Equity": 0, "Hybrid": 1, "Debt": 2, "Alternates": 3}

    def sort_key(f):
        sleeve_rank = SLEEVE_ORDER.get(f["sleeve"], 9)
        if f["sleeve"] == "Equity":
            cat_rank = EQUITY_CAT_ORDER.index(f.get("category")) if f.get("category") in EQUITY_CAT_ORDER else 99
        else:
            cat_rank = 0
        return (sleeve_rank, cat_rank)

    result.sort(key=sort_key)

    # ── Normalise cap mix to sum to exactly 100 (they should already ~≈100) ──
    if rb_large is not None and rb_mid is not None and rb_small is not None:
        cap_total = rb_large + rb_mid + rb_small
        if cap_total > 0:
            rb_large = round(rb_large * 100 / cap_total, 1)
            rb_mid   = round(rb_mid   * 100 / cap_total, 1)
            rb_small = round(rb_small * 100 / cap_total, 1)

    return {
        "key": model_key, "label": m["label"], "risk": m["risk"],
        "risk_score": m["risk_score"], "horizon": m["horizon"],
        "volatility": m["volatility"], "max_drawdown": m["max_drawdown"],
        "suitability": m["suitability"], "group": "risk",
        "fund_count": len(result),
        "target": {
            "eq_lo": m["eq_lo"], "eq_hi": m["eq_hi"],
            "debt_lo": m["debt_lo"], "debt_hi": m["debt_hi"],
            "large_cap": m["cap_large"], "mid_cap": m["cap_mid"], "small_cap": m["cap_small"], "cap_tol": CAP_TOL,
        },
        # Weighted-avg asset exposure (hybrid split factored) — sums to 100 with alternates
        "actual": {
            "equity_pct":     round(eff_equity, 1),
            "debt_pct":       round(eff_debt, 1),
            "alternates_pct": round(eff_other, 1),
            "large_cap":      rb_large,
            "mid_cap":        rb_mid,
            "small_cap":      rb_small,
        },
        # asset_mix now = weighted avg (not sleeve totals) — matches actual
        "asset_mix": {
            "Equity":     round(eff_equity, 1),
            "Debt":       round(eff_debt, 1),
            "Alternates": round(eff_other, 1),
            "Gold":       0.0,
        },
        "blended": {
            "return_1y": wavg("return_1y"), "return_3y": wavg("return_3y"),
            "return_5y": wavg("return_5y"), "sharpe_3y": wavg("sharpe_ratio_3y"),
            "alpha_3y": wavg("alpha_3y"), "std_dev_3y": wavg("std_dev_3y"),
            "expense_ratio": wavg("expense_ratio"),
        },
        "funds": [
            {
                "isin": f["isin"], "name": f["name"], "category": f.get("category"),
                "asset_class": f["asset_class"], "ranking": f.get("ranking"),
                "weight": f["weight"], "sleeve": f["sleeve"],
                "nav": f.get("nav"),
                "return_1y": f.get("return_1y"), "return_3y": f.get("return_3y"),
                "return_5y": f.get("return_5y"), "sharpe_3y": f.get("sharpe_ratio_3y"),
                "alpha_3y": f.get("alpha_3y"), "expense_ratio": f.get("expense_ratio"),
                "aum_cr": f.get("fund_size"), "morningstar_rating": f.get("morningstar_rating"),
                "equity_pct": f.get("equity_pct"), "bond_pct": f.get("bond_pct"),
                "large_cap": f.get("large_cap"), "mid_cap": f.get("mid_cap"), "small_cap": f.get("small_cap"),
            } for f in result
        ],
    }


def _get_funds(db, data_date):
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT isin, name, asset_class, ranking, category,
               equity_pct, bond_pct, large_cap, mid_cap, small_cap,
               sharpe_ratio_3y, return_1y, return_3y, return_5y,
               expense_ratio, std_dev_3y, alpha_3y,
               fund_size, amfi_code, nav, morningstar_rating
        FROM daily_fund_data
        WHERE data_date = :date AND ranking IN ('R1','R2') AND nav IS NOT NULL
    """), {"date": str(data_date)}).fetchall()

    # Deduplicate — a fund must appear only once.
    # Dedupe by ISIN first, then by normalised name as a safety net.
    seen_isin, seen_name, out = set(), set(), []
    for r in rows:
        d = dict(r._mapping)
        isin = d.get("isin")
        name_key = (d.get("name") or "").strip().lower()
        if isin and isin in seen_isin:
            continue
        if name_key and name_key in seen_name:
            continue
        if isin:      seen_isin.add(isin)
        if name_key:  seen_name.add(name_key)
        out.append(d)
    return out


@router.get("/debug")
def debug_portfolios(date: str = Query(None)):
    """Debug endpoint — shows exactly what's failing."""
    from models.database import SessionLocal
    from services.db_service import get_latest_data_date
    import traceback
    db = SessionLocal()
    try:
        data_date = date_type.fromisoformat(date) if date else get_latest_data_date()
        funds = _get_funds(db, data_date)
        results = {"data_date": str(data_date), "fund_count": len(funds), "models": {}}
        for k in MODELS:
            try:
                p = _build_portfolio(k, funds)
                results["models"][k] = {"ok": True, "fund_count": p["fund_count"]}
            except Exception as e:
                results["models"][k] = {"ok": False, "error": str(e), "trace": traceback.format_exc()}
        return results
    except Exception as e:
        return {"fatal": str(e), "trace": traceback.format_exc()}
    finally:
        db.close()


@router.get("/portfolios")
def get_portfolios(date: str = Query(None)):
    from models.database import SessionLocal
    from services.db_service import get_latest_data_date
    import traceback
    db = SessionLocal()
    try:
        data_date = date_type.fromisoformat(date) if date else get_latest_data_date()
        if not data_date:
            return {"portfolios": [], "data_date": None}
        funds = _get_funds(db, data_date)
        out = []
        for k in MODELS:
            try:
                p = _build_portfolio(k, funds)
                p["data_date"] = str(data_date)
                out.append(p)
            except Exception as e:
                logger.error(f"build {k} failed: {e}\n{traceback.format_exc()}")
        return {"portfolios": sorted(out, key=lambda x: x["risk_score"]), "data_date": str(data_date)}
    finally:
        db.close()


@router.get("/list")
def get_list(date: str = Query(None)):
    return get_portfolios(date=date)


@router.get("/detail")
def get_detail(key: str = Query(...), date: str = Query(None)):
    from models.database import SessionLocal
    from services.db_service import get_latest_data_date
    db = SessionLocal()
    try:
        if key not in MODELS:
            raise HTTPException(400, f"Unknown model '{key}'")
        data_date = date_type.fromisoformat(date) if date else get_latest_data_date()
        funds = _get_funds(db, data_date)
        p = _build_portfolio(key, funds)
        p["data_date"] = str(data_date)
        return p
    finally:
        db.close()