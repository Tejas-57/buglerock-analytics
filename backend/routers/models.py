# routers/models.py
"""
BugleRock Multi-Asset Model Portfolios — linprog (HiGHS) constraint solver.

Universe: R1/R2 ranked funds only (Active Equity, Debt, Hybrid).
Commodities/Alternates bucket is wired in for when Gold/Silver funds get ranked.

Solver: scipy.optimize.linprog, method="highs" (pure feasibility LP, objective=0).

Constraints per model:
  - Σ wᵢ = 100
  - MIN_W ≤ wᵢ ≤ MAX_W (with MAX_W capped at 100/MIN_FUNDS to force ≥ MIN_FUNDS)
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
    # Tier 1 — Overnight/liquid: zero duration, zero credit risk
    "India OE Overnight":               1,
    "India OE Liquid":                  1,
    "India OE Money Market":            1,
    "India OE Ultra Short Duration":    1,
    # Tier 2 — Short duration, high quality credit (AAA/govt)
    "India OE Low Duration":            2,
    "India OE Floating Rate":           2,
    "India OE Banking & PSU":           2,
    "India OE Short Duration":          2,
    "India OE Corporate Bond":          2,
    "India OE Government Bond":         2,  # sovereign = zero credit risk
    # Tier 3 — Medium duration, still high quality
    "India OE Medium Duration":         3,
    "India OE Medium to Long Duration": 3,
    "India OE Dynamic Bond":            3,
    # Tier 4 — Higher risk: credit risk or long duration
    "India OE Long Duration":           4,
    "India OE 10 yr Government Bond":   4,
    "India OE Credit Risk":             4,
}
HYBRID_RISK_TIER = {
    "India Fund Arbitrage Fund":                1,
    "India Fund Conservative Allocation":       1,
    "India Fund Equity Savings - Conservative": 2,
    "India Fund Equity Savings":                2,  # plain variant in DB
    "India Fund Dynamic Asset Allocation":      3,
    "India Fund Balanced Allocation":           3,  # ~65% equity, similar to DAA
    "India Fund Multi Asset Allocation":        3,  # multi-asset, moderate equity
    "India Fund Equity Savings - Aggressive":   3,
    "India Fund Aggressive Allocation":         4,
}

# Debt category priority — funds picked in this order (highest priority first)
DEBT_PRIORITY = [
    "India OE Corporate Bond",
    "India OE Ultra Short Duration",
    "India OE Money Market",
    "India OE Government Bond",
    "India OE Floating Rate",
    "India OE Banking & PSU",
    "India OE Short Duration",
    "India OE Low Duration",
    "India OE Dynamic Bond",
    "India OE Medium Duration",
    "India OE Medium to Long Duration",
    "India OE Liquid",
    "India OE Overnight",
    "India OE Credit Risk",
]

# For aggressive / mod-aggressive: the single debt fund must be one of these
AGG_DEBT_CATS = {
    "India OE Corporate Bond",
    "India OE Dynamic Bond",
    "India OE Ultra Short Duration",
    "India OE Government Bond",
}

# Hybrid category priority — BAF/DAA first, then equity savings, then allocation funds
HYBRID_PRIORITY = [
    "India Fund Dynamic Asset Allocation",       # BAF / DAA
    "India Fund Balanced Allocation",            # balanced hybrid
    "India Fund Multi Asset Allocation",         # multi-asset
    "India Fund Equity Savings - Aggressive",
    "India Fund Equity Savings",                 # plain variant
    "India Fund Equity Savings - Conservative",
    "India Fund Aggressive Allocation",
    "India Fund Conservative Allocation",
    "India Fund Arbitrage Fund",
]

# ── Model definitions ──────────────────────────────────────────────────────────
MODELS = {
    "conservative": {
        "label": "Conservative", "risk": "Low", "risk_score": 1,
        "horizon": "3+ years", "volatility": "5–6%", "max_drawdown": "5–10%",
        "suitability": "A low-volatility portfolio designed for capital preservation and stable returns, emphasizing fixed income with limited equity exposure. Ideal for investors with lower risk tolerance.",
        "eq_lo": 22, "eq_hi": 28, "debt_lo": 62, "debt_hi": 73,
        "cap_large": 75, "cap_mid": 15, "cap_small": 10,
        "gold_lo": 5, "gold_hi": 10,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [1, 2],
        "allowed_debt_cats": [
            "India OE Corporate Bond",
            "India OE Ultra Short Duration",
            "India OE Money Market",
            "India OE Government Bond",
            "India OE Floating Rate",
        ],
        "allowed_equity_cats": [
            "India Fund Large-Cap",
            "India Fund Large & Mid-Cap",
            "Cat: Flexi Cap Funds",
        ],
        "max_debt_funds": 3,
        "eq_per_cat": 1, "hyb_per_cat": 2, "min_funds": 7,
        "hyb_cat_limits": {
            "India Fund Conservative Allocation": 2,
            "India Fund Equity Savings - Conservative": 2,
            "India Fund Equity Savings": 1,
            "India Fund Arbitrage Fund": 0,
            "India Fund Dynamic Asset Allocation": 0,
            "India Fund Aggressive Allocation": 0,
        },
    },
    "mod_conservative": {
        "label": "Moderately Conservative", "risk": "Low–Moderate", "risk_score": 2,
        "horizon": "3–5 years", "volatility": "6–7%", "max_drawdown": "8–12%",
        "suitability": "Modest growth with limited equity exposure. Short-to-medium duration debt balanced with hybrid allocation for cautious investors wanting more than pure debt.",
        "eq_lo": 33, "eq_hi": 42, "debt_lo": 52, "debt_hi": 62,
        "cap_large": 70, "cap_mid": 20, "cap_small": 10,
        "gold_lo": 5, "gold_hi": 10,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [1, 2, 3],
        "allowed_equity_cats": [
            "India Fund Large & Mid-Cap",
            "Cat: Flexi Cap Funds",
            "Cat: Multi Cap Funds",
        ],
        "max_debt_funds": 3,
        "eq_per_cat": 2, "hyb_per_cat": 2, "min_funds": 7,
        "hyb_cat_limits": {
            "India Fund Dynamic Asset Allocation": 2,
            "India Fund Equity Savings - Aggressive": 2,
            "India Fund Equity Savings": 1,
            "India Fund Equity Savings - Conservative": 1,
            "India Fund Conservative Allocation": 1,  # debt anchor
            "India Fund Arbitrage Fund": 0,
            "India Fund Aggressive Allocation": 0,
        },
    },
    "balanced": {
        "label": "Balanced", "risk": "Moderate", "risk_score": 3,
        "horizon": "3–5 years", "volatility": "6–9%", "max_drawdown": "10–15%",
        "suitability": "Moderate growth portfolio with reduced volatility, balancing capital appreciation and income generation. Ideal for investors with moderate risk appetite and medium-term goals.",
        "eq_lo": 52, "eq_hi": 58, "debt_lo": 42, "debt_hi": 48,
        "cap_large": 60, "cap_mid": 25, "cap_small": 15, "cap_tol": 15,
        "gold_lo": 5, "gold_hi": 10,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [1, 2, 3, 4],
        "allowed_equity_cats": [
            "India Fund Large-Cap",
            "India Fund Large & Mid-Cap",
            "Cat: Flexi Cap Funds",
            "Cat: Multi Cap Funds",
            "India Fund Focused Fund",
            "India Fund Mid-Cap",
        ],
        "max_debt_funds": 3,
        "eq_per_cat": 1, "hyb_per_cat": 4,
        "hyb_cat_limits": {
            "India Fund Dynamic Asset Allocation": 2,
            "India Fund Balanced Allocation": 2,
            "India Fund Multi Asset Allocation": 1,
            "India Fund Aggressive Allocation": 2,
            "India Fund Equity Savings - Aggressive": 2,
            "India Fund Equity Savings": 1,
            "India Fund Equity Savings - Conservative": 1,
            "India Fund Conservative Allocation": 1,  # debt-heavy, anchors debt target
            "India Fund Arbitrage Fund": 0,            # excluded — pure arbitrage
        },
    },
    "mod_aggressive": {
        "label": "Moderately Aggressive", "risk": "Moderate–High", "risk_score": 4,
        "horizon": "5–7 years", "volatility": "8–12%", "max_drawdown": "12–18%",
        "suitability": "Growth-tilted portfolio with a debt ballast. Primarily equity across the cap spectrum, complemented by aggressive hybrid funds and minimal fixed income.",
        "eq_lo": 68, "eq_hi": 76, "debt_lo": 22, "debt_hi": 33, "gold_lo": 5, "gold_hi": 10,
        "cap_large": 50, "cap_mid": 27, "cap_small": 23,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [2, 3, 4],
        "allowed_equity_cats": None,
        "max_debt_funds": 2,
        "eq_per_cat": 2, "hyb_per_cat": 2,
        "eq_cat_limits": {
            "Cat: Multi Cap Funds": 1,
            "India Fund Focused Fund": 1,
            "Cat: Contra / Value Funds": 1,
        },
        "hyb_cat_limits": {
            "India Fund Dynamic Asset Allocation": 2,
            "India Fund Aggressive Allocation": 2,
            "India Fund Equity Savings - Aggressive": 1,
            "India Fund Equity Savings": 0,
            "India Fund Equity Savings - Conservative": 0,
            "India Fund Conservative Allocation": 0,
            "India Fund Arbitrage Fund": 0,
        },
    },
    "aggressive": {
        "label": "Aggressive", "risk": "High", "risk_score": 5,
        "horizon": "5+ years", "volatility": "10–15%", "max_drawdown": "15–20%",
        "suitability": "Maximizes growth potential through higher equity allocation across all cap segments, suitable for investors with a long-term horizon and higher risk tolerance.",
        "eq_lo": 80, "eq_hi": 87, "debt_lo": 12, "debt_hi": 23, "gold_lo": 5, "gold_hi": 10,
        "cap_large": 35, "cap_mid": 33, "cap_small": 32,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [2, 3, 4],
        "allowed_equity_cats": None,
        "max_debt_funds": 1,
        "eq_per_cat": 2, "hyb_per_cat": 2,
        "eq_cat_limits": {
            "India Fund Large-Cap": 1,
            "India Fund Large & Mid-Cap": 1,
            "Cat: Flexi Cap Funds": 2,
            "Cat: Multi Cap Funds": 1,
            "India Fund Focused Fund": 1,
            "India Fund Mid-Cap": 1,
            "India Fund Small-Cap": 1,
            "Cat: Contra / Value Funds": 1,
        },
    },
}

MIN_FUNDS = 9
MAX_FUNDS = 11
MIN_W_TIGHT = 5.0
MIN_W_LOOSE = 3.0
FUND_COUNT_THRESHOLD = 11

# ── Equity category classification ─────────────────────────────────────────────
CORE_EQUITY_CATS = [
    "India Fund Large-Cap",
    "India Fund Large & Mid-Cap",
    "Cat: Flexi Cap Funds",
    "Cat: Multi Cap Funds",
    "India Fund Focused Fund",
    "India Fund Mid-Cap",
    "India Fund Small-Cap",
    "Cat: Contra / Value Funds",
]

CAP_TOL = 5.0
MAX_W = 20.0


def _s(v):
    try: return float(v) if v is not None else None
    except: return None

def _sf(v, d=0.0):
    r = _s(v); return r if r is not None else d


def _solve(funds, eq_lo, eq_hi, debt_lo, debt_hi,
           cap_large, cap_mid, cap_small,
           cap_tol=CAP_TOL, max_w=MAX_W,
           gold_isins=None, gold_lo=0, gold_hi=0,
           fund_house_cap=35.0):
    """
    Pure feasibility LP via HiGHS. Returns weight array (sums to 100) or None.
    Constraints:
      - Equity/debt bands
      - Cap mix (large/mid/small) ± cap_tol
      - Gold/silver sleeve: gold_lo ≤ Σ w(gold funds) ≤ gold_hi
      - Fund house cap: no single AMC > fund_house_cap% of portfolio
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
        if f["asset_class"] == "Debt": return 100.0
        if f.get("category") == "India Fund Arbitrage Fund": return 100.0
        v = _s(f.get("bond_pct"))
        if v is not None and v > 0: return v
        return 0.0

    eq_pct   = np.array([get_eq_pct(f)   for f in funds])
    debt_pct = np.array([get_debt_pct(f) for f in funds])
    large    = np.array([_sf(f.get("large_cap")) for f in funds])
    mid      = np.array([_sf(f.get("mid_cap"))   for f in funds])
    small    = np.array([_sf(f.get("small_cap")) for f in funds])
    eq_weight_coef = eq_pct / 100.0

    A_ub, b_ub = [], []
    # Equity/debt bands
    A_ub.append(-eq_pct / 100.0);  b_ub.append(-eq_lo)
    A_ub.append( eq_pct / 100.0);  b_ub.append( eq_hi)
    A_ub.append(-debt_pct / 100.0); b_ub.append(-debt_lo)
    A_ub.append( debt_pct / 100.0); b_ub.append( debt_hi)
    # Cap mix constraints
    A_ub.append(-eq_weight_coef * (large - (cap_large - cap_tol))); b_ub.append(0)
    A_ub.append( eq_weight_coef * (large - (cap_large + cap_tol))); b_ub.append(0)
    A_ub.append(-eq_weight_coef * (mid   - (cap_mid   - cap_tol))); b_ub.append(0)
    A_ub.append( eq_weight_coef * (mid   - (cap_mid   + cap_tol))); b_ub.append(0)
    A_ub.append(-eq_weight_coef * (small - (cap_small - cap_tol))); b_ub.append(0)
    A_ub.append( eq_weight_coef * (small - (cap_small + cap_tol))); b_ub.append(0)

    # Gold/silver sleeve constraint
    if gold_isins and gold_lo > 0:
        gold_mask = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in funds])
        if gold_mask.sum() > 0:
            A_ub.append(-gold_mask); b_ub.append(-gold_lo)   # Σ gold ≥ gold_lo
            A_ub.append( gold_mask); b_ub.append( gold_hi)   # Σ gold ≤ gold_hi

    # Fund house concentration cap — no single AMC > fund_house_cap%
    from collections import defaultdict
    house_to_indices = defaultdict(list)
    for i, f in enumerate(funds):
        house = (f.get("branding_name") or "").strip()
        if house:
            house_to_indices[house].append(i)
    for house, idxs in house_to_indices.items():
        if len(idxs) > 1:  # only need constraint if house has multiple funds
            row = np.zeros(n)
            for i in idxs:
                row[i] = 1.0
            A_ub.append(row); b_ub.append(fund_house_cap)

    A_ub = np.array(A_ub); b_ub = np.array(b_ub)
    A_eq = np.ones((1, n)); b_eq = np.array([100.0])
    bounds = [(0.0, max_w)] * n
    c = np.zeros(n)

    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    if res.status == 0:
        w = res.x
        w[w < MIN_W_LOOSE] = 0.0
        total = w.sum()
        if total <= 0:
            return None
        w = w / total * 100

        nonzero = np.where(w > 0)[0]
        if len(nonzero) <= FUND_COUNT_THRESHOLD:
            w2 = w.copy()
            w2[w2 < MIN_W_TIGHT] = 0.0
            if w2.sum() > 0:
                w = w2 / w2.sum() * 100
                nonzero = np.where(w > 0)[0]

        if len(nonzero) > MAX_FUNDS:
            sorted_idx = nonzero[np.argsort(w[nonzero])]
            drop = sorted_idx[:len(nonzero) - MAX_FUNDS]
            w[drop] = 0.0
            w = w / w.sum() * 100

        return np.round(w, 2)
    return None


FUND_HOUSE_CAP = 35.0  # No single AMC > 35% of any model portfolio


def _solve_with_retry(funds, m, gold_isins=None):
    """
    Two-pass approach:
    Pass 1: forced_max_w (100/MIN_FUNDS) with NO cap mix constraint.
            Ensures MIN_FUNDS by spreading weight across all candidates.
    Pass 2: MAX_W with cap mix constraint (with tolerance relaxation).
            Used only if Pass 1 fails to find MIN_FUNDS.
    Both passes enforce: gold sleeve + fund house cap.
    """
    cap_l, cap_m, cap_s = m["cap_large"], m["cap_mid"], m["cap_small"]
    base_tol = m.get("cap_tol", CAP_TOL)
    min_funds = m.get("min_funds", MIN_FUNDS)
    max_funds = m.get("max_funds", MAX_FUNDS)
    gold_lo = m.get("gold_lo", 0)
    gold_hi = m.get("gold_hi", 0)
    forced_max_w = min(MAX_W, 100.0 / min_funds)

    from scipy.optimize import linprog

    def get_eq_pct(f):
        v = _s(f.get("equity_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Equity" else 0.0

    def get_debt_pct(f):
        if f["asset_class"] == "Debt": return 100.0
        if f.get("category") == "India Fund Arbitrage Fund": return 100.0
        v = _s(f.get("bond_pct"))
        if v is not None and v > 0: return v
        return 0.0

    n = len(funds)
    eq_pct   = np.array([get_eq_pct(f)   for f in funds])
    debt_pct = np.array([get_debt_pct(f) for f in funds])

    # Pass 1: no cap mix, forced_max_w — but still enforce gold sleeve + fund house cap
    A_ub_p1 = [-eq_pct/100, eq_pct/100, -debt_pct/100, debt_pct/100]
    b_ub_p1 = [-m["eq_lo"], m["eq_hi"], -m["debt_lo"], m["debt_hi"]]

    if gold_isins and gold_lo > 0:
        gold_mask = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in funds])
        if gold_mask.sum() > 0:
            A_ub_p1.append(-gold_mask); b_ub_p1.append(-gold_lo)
            A_ub_p1.append( gold_mask); b_ub_p1.append( gold_hi)

    from collections import defaultdict
    house_to_indices_p1 = defaultdict(list)
    for i, f in enumerate(funds):
        house = (f.get("branding_name") or "").strip()
        if house:
            house_to_indices_p1[house].append(i)
    for house, idxs in house_to_indices_p1.items():
        if len(idxs) > 1:
            row = np.zeros(n); row[idxs] = 1.0
            A_ub_p1.append(row); b_ub_p1.append(FUND_HOUSE_CAP)

    A_ub_p1 = np.array(A_ub_p1); b_ub_p1 = np.array(b_ub_p1)
    res = linprog(np.zeros(n), A_ub=A_ub_p1, b_ub=b_ub_p1,
                  A_eq=np.ones((1,n)), b_eq=np.array([100.0]),
                  bounds=[(0.0, forced_max_w)]*n, method="highs")

    if res.status == 0:
        w = res.x.copy()
        w[w < MIN_W_LOOSE] = 0.0
        total = w.sum()
        if total > 0:
            w = w / total * 100
            nonzero = np.where(w > 0)[0]
            if len(nonzero) <= FUND_COUNT_THRESHOLD:
                w2 = w.copy(); w2[w2 < MIN_W_TIGHT] = 0.0
                if w2.sum() > 0:
                    w = w2 / w2.sum() * 100
                    nonzero = np.where(w > 0)[0]
            if len(nonzero) > max_funds:
                drop = nonzero[np.argsort(w[nonzero])][:len(nonzero)-max_funds]
                w[drop] = 0.0; w = w / w.sum() * 100
            if np.sum(w > 0) >= min_funds:
                return np.round(w, 2), 999  # 999 = pass 1 (no cap mix)

    # Pass 2: MAX_W with cap mix, relaxing tolerance
    for tol in [base_tol, base_tol+3, base_tol+6, base_tol+10, base_tol+15]:
        w = _solve(funds, m["eq_lo"], m["eq_hi"], m["debt_lo"], m["debt_hi"],
                   cap_l, cap_m, cap_s, tol, MAX_W,
                   gold_isins=gold_isins, gold_lo=gold_lo, gold_hi=gold_hi,
                   fund_house_cap=FUND_HOUSE_CAP)
        if w is not None:
            return w, tol

    # Last resort: widen asset bands
    w = _solve(funds, m["eq_lo"]-5, m["eq_hi"]+5, m["debt_lo"]-5, m["debt_hi"]+5,
               cap_l, cap_m, cap_s, base_tol+20, MAX_W,
               gold_isins=gold_isins, gold_lo=gold_lo, gold_hi=gold_hi,
               fund_house_cap=FUND_HOUSE_CAP)
    return (w, base_tol+20) if w is not None else (None, None)



# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — TRUE SHARPE OPTIMIZATION
# ══════════════════════════════════════════════════════════════════════════════
#
# Pipeline:
#   1. _fetch_nav_returns    — daily NAV → annual calendar-year returns per fund
#   2. _shrink_returns       — pull each fund toward category mean (Stein shrinkage)
#   3. _build_covariance     — shrunk correlation + PSD validation
#   4. _optimize_sharpe      — Frank-Wolfe QP maximizing (w·μ - rf) / sqrt(w·Σ·w)
#   5. _reduce_to_target     — iterative re-optimization to reach 8–10 funds
#
# Fallback: if NAV data insufficient or QP fails, falls back to feasibility LP.
# ══════════════════════════════════════════════════════════════════════════════

RISK_FREE_RATE = 6.5    # % — approximate Indian T-bill / repo rate
SHRINK_ALPHA   = 0.5    # correlation shrinkage intensity (toward grand mean)
MIN_YEARS      = 3      # minimum calendar years of data required for inclusion
TARGET_FUNDS_LO = 8
TARGET_FUNDS_HI = 11
FRANK_WOLFE_ITER = 200  # max iterations for Frank-Wolfe


def _fetch_nav_returns(isins: list, db) -> dict:
    """
    Fetch daily NAV history from nav_history table.
    Compute calendar-year returns (2021-2025) per fund.

    Returns: {isin: {2021: r, 2022: r, ...}} — only years with data.
    Missing years are omitted (not zero).
    """
    from sqlalchemy import text
    from datetime import date as date_type
    import calendar

    if not isins:
        return {}

    rows = db.execute(text("""
        SELECT isin, date, nav
        FROM nav_history
        WHERE isin = ANY(:isins)
          AND nav IS NOT NULL AND nav > 0
          AND date >= '2020-12-01'
        ORDER BY isin, date ASC
    """), {"isins": isins}).fetchall()

    # Group by isin
    from collections import defaultdict
    nav_by_isin = defaultdict(list)
    for r in rows:
        nav_by_isin[r[0]].append((r[1], float(r[2])))

    YEARS = [2021, 2022, 2023, 2024, 2025]

    def _nav_on_or_before(series, target_date):
        """Get NAV on or nearest before target_date (within 10 days)."""
        from datetime import timedelta
        cutoff = target_date - timedelta(days=10)
        best = None
        for d, v in reversed(series):
            if d <= target_date:
                if d >= cutoff:
                    best = v
                break
        return best

    def _nav_on_or_after(series, target_date):
        """Get NAV on or nearest after target_date (within 10 days)."""
        from datetime import timedelta
        cutoff = target_date + timedelta(days=10)
        for d, v in series:
            if d >= target_date:
                if d <= cutoff:
                    return v
        return None

    result = {}
    for isin, series in nav_by_isin.items():
        annual = {}
        for yr in YEARS:
            start_date = date_type(yr, 1, 1)
            end_date   = date_type(yr, 12, 31)
            sv = _nav_on_or_after(series, start_date)
            ev = _nav_on_or_before(series, end_date)
            if sv and ev and sv > 0:
                annual[yr] = (ev / sv - 1) * 100
        if len(annual) >= MIN_YEARS:
            result[isin] = annual
    return result


def _shrink_returns(nav_returns: dict, funds: list) -> dict:
    """
    Stein-type shrinkage: pull each fund's expected return toward its category mean.
    Shrinkage intensity = f(return volatility) — more volatile history → pulled harder.

    Returns: {isin: expected_return_%}
    """
    import math
    from collections import defaultdict

    # Build category means from available data
    cat_returns = defaultdict(list)
    isin_to_cat = {f.get("isin"): (f.get("category") or "") for f in funds}

    for isin, annual in nav_returns.items():
        cat = isin_to_cat.get(isin, "")
        if annual:
            mean_r = sum(annual.values()) / len(annual)
            cat_returns[cat].append(mean_r)

    cat_mean = {cat: sum(vs)/len(vs) for cat, vs in cat_returns.items() if vs}

    shrunk = {}
    for isin, annual in nav_returns.items():
        if not annual:
            continue
        vals = list(annual.values())
        mean_r = sum(vals) / len(vals)

        # Return volatility (std dev across years)
        if len(vals) > 1:
            variance = sum((v - mean_r)**2 for v in vals) / (len(vals) - 1)
            vol = math.sqrt(variance)
        else:
            vol = 15.0  # conservative default if only 1 year

        # Shrinkage intensity: higher vol → shrink more toward category
        # Alpha ranges from 0.2 (low vol, consistent) to 0.7 (high vol, noisy)
        alpha = max(0.2, min(0.7, vol / 20.0))

        cat = isin_to_cat.get(isin, "")
        cat_m = cat_mean.get(cat, mean_r)

        shrunk[isin] = (1 - alpha) * mean_r + alpha * cat_m

    return shrunk


def _build_covariance(nav_returns: dict, isins: list) -> tuple:
    """
    Build a shrunk, PSD-validated covariance matrix from annual returns.

    Steps:
      1. Build raw return matrix (funds × years), filling missing years with category mean
      2. Compute raw correlation matrix
      3. Shrink toward grand mean correlation (intensity = SHRINK_ALPHA)
      4. Validate PSD via eigenvalue clipping (all eigenvalues >= 0)
      5. Convert to covariance using each fund's std dev

    Returns: (Sigma, valid_isins) where Sigma is n×n covariance matrix
    and valid_isins is the ordered list of ISINs used.
    """
    import numpy as np
    import math

    YEARS = [2021, 2022, 2023, 2024, 2025]

    # Filter to ISINs that have enough data
    valid = [i for i in isins if i in nav_returns and len(nav_returns[i]) >= MIN_YEARS]
    if len(valid) < 2:
        return None, valid

    n = len(valid)

    # Build return matrix: rows=funds, cols=years
    # Fill missing years with fund's own mean (not zero — avoids biasing correlation)
    R = np.zeros((n, len(YEARS)))
    for i, isin in enumerate(valid):
        annual = nav_returns[isin]
        fund_mean = sum(annual.values()) / len(annual)
        for j, yr in enumerate(YEARS):
            R[i, j] = annual.get(yr, fund_mean)

    # Demean
    means = R.mean(axis=1, keepdims=True)
    R_dm  = R - means

    # Raw covariance and correlation
    T = R.shape[1]
    cov_raw = (R_dm @ R_dm.T) / max(T - 1, 1)

    # Std devs
    std_devs = np.sqrt(np.diag(cov_raw))
    std_devs = np.where(std_devs < 0.1, 0.1, std_devs)  # floor at 0.1% to avoid divide-by-zero

    # Raw correlation
    outer_std = np.outer(std_devs, std_devs)
    corr_raw = cov_raw / outer_std
    np.fill_diagonal(corr_raw, 1.0)
    corr_raw = np.clip(corr_raw, -1.0, 1.0)

    # Shrink toward grand mean off-diagonal correlation
    mask = 1 - np.eye(n)
    grand_mean_corr = (corr_raw * mask).sum() / max(mask.sum(), 1)
    target = grand_mean_corr * mask + np.eye(n)  # target matrix

    corr_shrunk = (1 - SHRINK_ALPHA) * corr_raw + SHRINK_ALPHA * target
    np.fill_diagonal(corr_shrunk, 1.0)

    # PSD validation — clip negative eigenvalues to zero
    eigvals, eigvecs = np.linalg.eigh(corr_shrunk)
    if eigvals.min() < 0:
        eigvals = np.clip(eigvals, 0, None)
        corr_shrunk = eigvecs @ np.diag(eigvals) @ eigvecs.T
        # Re-normalise diagonal to 1
        d = np.sqrt(np.diag(corr_shrunk))
        d = np.where(d < 1e-10, 1.0, d)
        corr_shrunk = corr_shrunk / np.outer(d, d)
        np.fill_diagonal(corr_shrunk, 1.0)

    # Convert back to covariance
    Sigma = corr_shrunk * outer_std

    return Sigma, valid


def _frank_wolfe_sharpe(mu_arr, Sigma, A_ub, b_ub, bounds, max_iter=FRANK_WOLFE_ITER):
    """
    Frank-Wolfe (conditional gradient) algorithm to maximize Sharpe ratio.

    Objective: maximize f(w) = (w·mu - rf) / sqrt(w·Sigma·w)
    Equivalent to: maximize w·mu / sqrt(w·Sigma·w)  [rf baked into mu already]

    Frank-Wolfe projects the gradient onto the feasible set (LP subproblem)
    and takes a step toward that vertex. Converges for smooth objectives on
    convex polytopes.

    Returns weight array (sums to 100) or None if failed.
    """
    import numpy as np
    from scipy.optimize import linprog

    n = len(mu_arr)
    A_eq = np.ones((1, n))
    b_eq = np.array([100.0])

    # Start: feasibility LP solution (already has valid starting point)
    res0 = linprog(np.zeros(n), A_ub=A_ub, b_ub=b_ub,
                   A_eq=A_eq, b_eq=b_eq,
                   bounds=bounds, method="highs")
    if res0.status != 0:
        return None

    w = res0.x.copy()
    w = np.clip(w, 0, None)
    if w.sum() <= 0:
        return None
    w = w / w.sum() * 100

    def sharpe(w_):
        port_ret = w_ @ mu_arr / 100      # scale: weights in %, returns in %
        port_var = (w_ @ Sigma @ w_) / 10000
        if port_var <= 1e-10:
            return 0.0
        return port_ret / (port_var ** 0.5)

    def grad_sharpe(w_):
        """Gradient of Sharpe w.r.t. w (in weight-% space)."""
        ret   = w_ @ mu_arr / 100
        var   = (w_ @ Sigma @ w_) / 10000
        if var <= 1e-10:
            return mu_arr / 100
        vol   = var ** 0.5
        g_ret = mu_arr / 100
        g_vol = (Sigma @ w_) / (10000 * vol)
        return (g_ret * vol - ret * g_vol) / var

    best_w    = w.copy()
    best_shp  = sharpe(w)
    no_improve = 0

    for it in range(max_iter):
        grad = grad_sharpe(w)

        # Linear minimization oracle: minimize -grad·s over feasible set (LP)
        res = linprog(-grad, A_ub=A_ub, b_ub=b_ub,
                      A_eq=A_eq, b_eq=b_eq,
                      bounds=bounds, method="highs")
        if res.status != 0:
            break

        s = res.x  # vertex of feasible set in gradient direction

        # Line search: optimal step size
        d = s - w
        # Exact line search for Sharpe is non-trivial; use backtracking
        step = 2.0 / (it + 2)  # standard FW decay
        w_new = w + step * d
        w_new = np.clip(w_new, 0, None)
        if w_new.sum() > 0:
            w_new = w_new / w_new.sum() * 100

        shp_new = sharpe(w_new)
        if shp_new > best_shp + 1e-6:
            best_shp = shp_new
            best_w   = w_new.copy()
            no_improve = 0
        else:
            no_improve += 1

        w = w_new

        # Convergence: Frank-Wolfe gap < tolerance
        fw_gap = grad @ (w - s)
        if abs(fw_gap) < 1e-4 and no_improve > 10:
            break

    return best_w


def _optimize_sharpe(funds, m, gold_isins=None, db=None):
    """
    Main Phase 3 entry point.

    1. Fetch NAV returns from nav_history
    2. Shrink expected returns toward category mean
    3. Build shrunk PSD covariance matrix
    4. Run Frank-Wolfe Sharpe optimization with all LP constraints
    5. Reduce to 8-10 funds via iterative re-optimization
    6. Return (weights_array, fund_list, used_method)

    Falls back to _solve_with_retry if QP fails.
    """
    import numpy as np

    if db is None:
        return None, funds, "lp_fallback"

    isins = [f.get("isin") for f in funds if f.get("isin")]

    # Step 1: fetch NAV returns
    nav_returns = _fetch_nav_returns(isins, db)
    if len(nav_returns) < len(funds) * 0.5:
        logger.warning(f"_optimize_sharpe: only {len(nav_returns)}/{len(funds)} funds have NAV data — falling back to LP")
        return None, funds, "lp_fallback"

    # Step 2: shrink returns
    shrunk_mu = _shrink_returns(nav_returns, funds)

    # Step 3: build covariance
    valid_isins_for_cov = [f.get("isin") for f in funds if f.get("isin") in nav_returns]
    Sigma, valid_isins = _build_covariance(nav_returns, valid_isins_for_cov)
    if Sigma is None or len(valid_isins) < 4:
        logger.warning("_optimize_sharpe: covariance build failed — falling back to LP")
        return None, funds, "lp_fallback"

    # Reorder funds to match valid_isins order; funds not in valid_isins are excluded from QP
    isin_to_fund = {f.get("isin"): f for f in funds}
    qp_funds = [isin_to_fund[i] for i in valid_isins if i in isin_to_fund]

    if len(qp_funds) < 4:
        return None, funds, "lp_fallback"

    n = len(qp_funds)

    # Build mu vector (expected return - risk free rate, in % units)
    mu_arr = np.array([
        shrunk_mu.get(f.get("isin"), 10.0) - RISK_FREE_RATE
        for f in qp_funds
    ])

    # Build LP constraint matrices (same as _solve but for qp_funds subset)
    cap_l  = m["cap_large"]; cap_m = m["cap_mid"]; cap_s = m["cap_small"]
    cap_tol = m.get("cap_tol", CAP_TOL)
    gold_lo = m.get("gold_lo", 0); gold_hi = m.get("gold_hi", 0)

    def get_eq_pct(f):
        v = _s(f.get("equity_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Equity" else 0.0

    def get_debt_pct(f):
        if f["asset_class"] == "Debt": return 100.0
        if f.get("category") == "India Fund Arbitrage Fund": return 100.0
        v = _s(f.get("bond_pct"))
        if v is not None and v > 0: return v
        return 0.0

    eq_pct   = np.array([get_eq_pct(f)   for f in qp_funds])
    debt_pct = np.array([get_debt_pct(f) for f in qp_funds])
    large    = np.array([_sf(f.get("large_cap")) for f in qp_funds])
    mid      = np.array([_sf(f.get("mid_cap"))   for f in qp_funds])
    small    = np.array([_sf(f.get("small_cap")) for f in qp_funds])
    eq_wc    = eq_pct / 100.0

    A_ub, b_ub = [], []
    A_ub.append(-eq_pct/100);  b_ub.append(-m["eq_lo"])
    A_ub.append( eq_pct/100);  b_ub.append( m["eq_hi"])
    A_ub.append(-debt_pct/100); b_ub.append(-m["debt_lo"])
    A_ub.append( debt_pct/100); b_ub.append( m["debt_hi"])
    A_ub.append(-eq_wc*(large-(cap_l-cap_tol))); b_ub.append(0)
    A_ub.append( eq_wc*(large-(cap_l+cap_tol))); b_ub.append(0)
    A_ub.append(-eq_wc*(mid  -(cap_m-cap_tol))); b_ub.append(0)
    A_ub.append( eq_wc*(mid  -(cap_m+cap_tol))); b_ub.append(0)
    A_ub.append(-eq_wc*(small-(cap_s-cap_tol))); b_ub.append(0)
    A_ub.append( eq_wc*(small-(cap_s+cap_tol))); b_ub.append(0)

    if gold_isins and gold_lo > 0:
        gold_mask = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in qp_funds])
        if gold_mask.sum() > 0:
            A_ub.append(-gold_mask); b_ub.append(-gold_lo)
            A_ub.append( gold_mask); b_ub.append( gold_hi)

    from collections import defaultdict
    house_idx = defaultdict(list)
    for i, f in enumerate(qp_funds):
        h = (f.get("branding_name") or "").strip()
        if h: house_idx[h].append(i)
    for h, idxs in house_idx.items():
        if len(idxs) > 1:
            row = np.zeros(n); row[idxs] = 1.0
            A_ub.append(row); b_ub.append(FUND_HOUSE_CAP)

    A_ub_np = np.array(A_ub); b_ub_np = np.array(b_ub)
    bounds = [(0.0, MAX_W)] * n

    # Step 4: Frank-Wolfe optimization
    w = _frank_wolfe_sharpe(mu_arr, Sigma, A_ub_np, b_ub_np, bounds)
    if w is None:
        logger.warning("_optimize_sharpe: Frank-Wolfe failed — falling back to LP")
        return None, funds, "lp_fallback"

    # Step 5: reduce to target fund count via iterative re-optimization
    w, qp_funds = _reduce_to_target(
        qp_funds, w, mu_arr, Sigma, A_ub_np, b_ub_np, bounds, gold_isins, m
    )

    return w, qp_funds, "sharpe_qp"


def _reduce_to_target(funds, weights, mu_arr, Sigma, A_ub, b_ub, bounds, gold_isins, m):
    """
    Iteratively drop the least economically important fund and re-optimize
    until fund count is in [TARGET_FUNDS_LO, TARGET_FUNDS_HI].

    "Least important" = dropping this fund causes the smallest loss in Sharpe ratio.
    For each candidate to drop, compute Sharpe of re-optimized portfolio without it.
    Drop the one with smallest Sharpe loss.

    If inner Frank-Wolfe fails for a candidate, fall back to dropping smallest weight.
    Always preserves the last state with >= TARGET_FUNDS_LO active funds.
    """
    import numpy as np

    def sharpe_of(w_, S_):
        w_ = np.array(w_)
        ret = w_ @ mu_arr[:len(w_)] / 100
        var = (w_ @ S_ @ w_) / 10000
        return ret / (var**0.5) if var > 1e-10 else 0.0

    lo = min(TARGET_FUNDS_LO, m.get("min_funds", MIN_FUNDS))  # respect per-model min
    hi = TARGET_FUNDS_HI      # 10 — only reduce if FW gives >10 funds

    # Do NOT apply loose filter before the loop — it can drop funds from 10 to 6 immediately,
    # bypassing the reduction logic entirely and leaving last_good in a bad state.
    # The loop handles reduction; loose/tight filters apply only at the end.
    w = np.array(weights, dtype=float)
    if w.sum() > 0: w = w / w.sum() * 100

    active = np.where(w > 0)[0].tolist()
    # Initialize last_good to full active set — will be updated as we drop
    last_good_w      = w.copy()
    last_good_active = active[:]

    while len(active) > hi:
        best_drop = None
        best_shp  = -np.inf
        best_w    = None
        best_keep = None

        for drop_i in active:
            keep = [i for i in active if i != drop_i]
            if len(keep) < lo:
                continue

            mu_k  = mu_arr[keep]
            S_k   = Sigma[np.ix_(keep, keep)]
            A_k   = A_ub[:, keep]
            bds_k = [bounds[i] for i in keep]

            # Try Frank-Wolfe re-optimization
            w_k = _frank_wolfe_sharpe(mu_k, S_k, A_k, b_ub, bds_k, max_iter=100)
            if w_k is None:
                # FW failed — use equal weight as proxy Sharpe estimate
                w_k = np.ones(len(keep)) * (100.0 / len(keep))

            shp = sharpe_of(w_k, S_k)
            if shp > best_shp:
                best_shp  = shp
                best_drop = drop_i
                best_w    = w_k
                best_keep = keep

        if best_drop is None or best_w is None:
            break  # can't drop any more — stop here

        # Commit the drop
        active = best_keep
        w_full = np.zeros(len(weights))
        for idx, wi in zip(active, best_w):
            w_full[idx] = wi
        if w_full.sum() > 0:
            w_full = w_full / w_full.sum() * 100
        w = w_full

        # Track last good state (>= lo funds)
        if len(active) >= lo:
            last_good_w      = w.copy()
            last_good_active = active[:]

    # If we went below lo, restore last good state
    restored = False
    if len(np.where(w > 0)[0]) < lo and last_good_active:
        w = last_good_w.copy()
        restored = True

    # Apply tight filter only if it won't push count below lo
    if not restored:
        nonzero = np.where(w > 0)[0]
        if len(nonzero) <= FUND_COUNT_THRESHOLD:
            w2 = w.copy(); w2[w2 < MIN_W_TIGHT] = 0.0
            if w2.sum() > 0 and np.sum(w2 > 0) >= lo:
                w = w2 / w2.sum() * 100

    # Final renormalise
    if w.sum() > 0:
        w = w / w.sum() * 100

    return np.round(w, 2), funds


def _pick_candidates(eq_pool, debt_pool, hybrid_pool, m):
    """
    Select candidates per sleeve:
    - Equity: restricted to allowed_equity_cats (or all core), eq_per_cat best-fit per category
    - Debt: picked in DEBT_PRIORITY order, capped at max_debt_funds.
            For agg/mod-agg (max_debt_funds=1), the single debt fund must be from AGG_DEBT_CATS.
    - Hybrid: picked in HYBRID_PRIORITY order, hyb_per_cat funds per category.
    """
    cap_l, cap_m, cap_s = m["cap_large"], m["cap_mid"], m["cap_small"]
    def cap_dev(f):
        return (abs(_sf(f.get("large_cap")) - cap_l) +
                abs(_sf(f.get("mid_cap"))   - cap_m) +
                abs(_sf(f.get("small_cap")) - cap_s))

    from collections import defaultdict

    # ── Equity ────────────────────────────────────────────────────────────────
    allowed_eq = m.get("allowed_equity_cats") or CORE_EQUITY_CATS
    eq_by_cat = defaultdict(list)
    for f in eq_pool:
        if f.get("category") in allowed_eq:
            eq_by_cat[f.get("category","")].append(f)

    eq_sorted = []
    eq_cat_limits = m.get("eq_cat_limits", {})
    for cat in CORE_EQUITY_CATS:
        if cat in eq_by_cat:
            n = eq_cat_limits.get(cat, m["eq_per_cat"])
            eq_sorted.extend(sorted(eq_by_cat[cat], key=cap_dev)[:n])
    for cat, funds in eq_by_cat.items():
        if cat not in CORE_EQUITY_CATS:
            n = eq_cat_limits.get(cat, m["eq_per_cat"])
            eq_sorted.extend(sorted(funds, key=cap_dev)[:n])

    # ── Debt ──────────────────────────────────────────────────────────────────
    debt_allowed = {c for c,t in DEBT_RISK_TIER.items() if t in m["debt_tiers"]}
    max_debt = m.get("max_debt_funds", 3)

    if m.get("allowed_debt_cats"):
        debt_eligible_cats = set(m["allowed_debt_cats"]) & debt_allowed
    elif max_debt == 1:
        debt_eligible_cats = debt_allowed & AGG_DEBT_CATS
    else:
        debt_eligible_cats = debt_allowed

    debt_by_cat = defaultdict(list)
    for f in debt_pool:
        if f.get("category") in debt_eligible_cats:
            debt_by_cat[f.get("category")].append(f)

    debt_sorted = []
    for cat in DEBT_PRIORITY:
        if cat in debt_by_cat and len(debt_sorted) < max_debt:
            best = min(debt_by_cat[cat], key=lambda f: -_sf(f.get("sharpe_ratio_3y")))
            debt_sorted.append(best)
        if len(debt_sorted) >= max_debt:
            break

    # ── Hybrid ────────────────────────────────────────────────────────────────
    hyb_allowed = {c for c,t in HYBRID_RISK_TIER.items() if t in m["hybrid_tiers"]}
    hyb_by_cat = defaultdict(list)
    for f in hybrid_pool:
        if f.get("category") in hyb_allowed:
            hyb_by_cat[f.get("category")].append(f)

    hyb_sorted = []
    hyb_cat_limits = m.get("hyb_cat_limits", {})
    for cat in HYBRID_PRIORITY:
        if cat in hyb_by_cat:
            n = hyb_cat_limits.get(cat, m["hyb_per_cat"])
            hyb_sorted.extend(sorted(hyb_by_cat[cat], key=cap_dev)[:n])

    raw = eq_sorted + hyb_sorted + debt_sorted

    seen, out = set(), []
    for f in raw:
        key = f.get("isin") or (f.get("name") or "").strip().lower()
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def _pick_gold_candidates(gold_pool, gold_lo, gold_hi):
    """
    Pick top gold/silver funds by AUM (largest, most liquid).
    No R1/R2 filter — precious metals have no skill-based rating.
    Returns 1–2 funds: best by AUM, second only if genuinely different category
    (e.g. one gold ETF + one silver ETF, or one ETF + one FoF).
    """
    if not gold_pool or not gold_lo:
        return []
    # Sort by AUM descending
    sorted_gold = sorted(gold_pool, key=lambda f: _sf(f.get("fund_size")), reverse=True)
    picked = []
    seen_cats = set()
    for f in sorted_gold:
        cat = (f.get("category") or "").lower()
        # Allow at most one per broad type: ETF vs FoF
        broad = "fof" if ("fof" in cat or "fund of fund" in cat) else "etf"
        if broad not in seen_cats:
            seen_cats.add(broad)
            picked.append(f)
        if len(picked) >= 2:
            break
    return picked


def _build_portfolio(model_key, all_funds, db=None):
    m = MODELS[model_key]
    _build_portfolio._db = db  # stash db for _optimize_sharpe
    eq_pool     = [f for f in all_funds
                   if f["asset_class"] == "Equity"
                   and f.get("category") in CORE_EQUITY_CATS]
    debt_pool   = [f for f in all_funds if f["asset_class"] == "Debt"]
    hybrid_pool = [f for f in all_funds if f["asset_class"] == "Hybrid"]
    gold_pool   = [f for f in all_funds if f["asset_class"] == "Precious Metals"]

    gold_lo = m.get("gold_lo", 0)
    gold_hi = m.get("gold_hi", 0)
    gold_candidates = _pick_gold_candidates(gold_pool, gold_lo, gold_hi)

    candidates = _pick_candidates(eq_pool, debt_pool, hybrid_pool, m)

    # Merge gold candidates into the pool (after dedup, before solve)
    seen, candidates_deduped = set(), []
    for f in candidates + gold_candidates:
        key = f.get("isin") or (f.get("name") or "").strip().lower()
        if key not in seen:
            seen.add(key)
            candidates_deduped.append(f)
    candidates = candidates_deduped

    # Tag gold funds so solver can apply gold + fund-house constraints
    gold_isins = {f.get("isin") for f in gold_candidates if f.get("isin")}

    # Phase 3: attempt true Sharpe optimization; fall back to LP if needed
    # qp_funds may be a subset of candidates (funds with sufficient NAV history)
    # Keep original candidates for LP fallback
    original_candidates = candidates
    min_funds_needed = m.get("min_funds", MIN_FUNDS)

    qp_weights, qp_funds, used_method = _optimize_sharpe(
        candidates, m, gold_isins=gold_isins, db=_build_portfolio._db
    )
    qp_active = int(np.sum(qp_weights > 0)) if qp_weights is not None else 0

    # Accept QP if it produced >= per-model min_funds active funds
    # Conservative/mod_conservative have min_funds=7; others default to MIN_FUNDS=9
    # but TARGET_FUNDS_LO=8 is the floor for reduction — use whichever is lower
    qp_accept_threshold = min(TARGET_FUNDS_LO, min_funds_needed)
    if qp_weights is not None and qp_active >= qp_accept_threshold:
        # QP succeeded — use qp_funds + qp_weights
        weights   = qp_weights
        candidates = qp_funds
        used_tol  = "sharpe_qp"
        logger.info(f"Sharpe QP succeeded for {model_key}: {qp_active} funds (threshold={qp_accept_threshold})")
    else:
        # QP failed or insufficient funds — fall back to LP with original full candidate pool
        logger.info(f"Sharpe QP fallback for {model_key} (qp_active={qp_active}, need>={qp_accept_threshold}) — using LP")
        candidates = original_candidates
        weights, used_tol = _solve_with_retry(candidates, m, gold_isins=gold_isins)

    result = []
    seen_result = set()
    # For QP results, use a lower threshold (1%) — QP weights are already optimized
    # For LP results, use MIN_W_LOOSE (3%) as before
    w_threshold = 1.0 if used_tol == "sharpe_qp" else MIN_W_LOOSE - 0.1
    if weights is not None:
        for f, w in zip(candidates, weights):
            key = f.get("isin") or (f.get("name") or "").strip().lower()
            if w >= w_threshold and key not in seen_result:
                seen_result.add(key)
                sleeve = ("Equity" if f["asset_class"]=="Equity"
                          else "Hybrid" if f["asset_class"]=="Hybrid"
                          else "Gold" if f["asset_class"]=="Precious Metals"
                          else "Debt")
                result.append({**f, "weight": round(float(w), 1), "sleeve": sleeve})
        tot = sum(f["weight"] for f in result)
        if tot > 0:
            for f in result:
                f["weight"] = round(f["weight"] * 100 / tot, 1)

    def _eq_pct(f):
        v = _s(f.get("equity_pct"))
        if v is not None and v > 0: return v
        return 100.0 if f["asset_class"] == "Equity" else 0.0

    def _debt_pct(f):
        if f["asset_class"] == "Debt": return 100.0
        if f.get("category") == "India Fund Arbitrage Fund": return 100.0
        v = _s(f.get("bond_pct"))
        if v is not None and v > 0: return v
        return 0.0

    eff_equity = sum(f["weight"] * _eq_pct(f) / 100 for f in result)
    eff_debt   = sum(f["weight"] * _debt_pct(f) / 100 for f in result)
    eff_other  = max(0.0, 100 - eff_equity - eff_debt)

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
    SLEEVE_ORDER = {"Equity": 0, "Hybrid": 1, "Debt": 2, "Gold": 3, "Alternates": 4}

    def sort_key(f):
        sleeve_rank = SLEEVE_ORDER.get(f["sleeve"], 9)
        if f["sleeve"] == "Equity":
            cat_rank = EQUITY_CAT_ORDER.index(f.get("category")) if f.get("category") in EQUITY_CAT_ORDER else 99
        else:
            cat_rank = 0
        return (sleeve_rank, cat_rank)

    result.sort(key=sort_key)

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
        "used_method": used_tol if isinstance(used_tol, str) else f"lp_tol{used_tol}",
        "target": {
            "eq_lo": m["eq_lo"], "eq_hi": m["eq_hi"],
            "debt_lo": m["debt_lo"], "debt_hi": m["debt_hi"],
            "large_cap": m["cap_large"], "mid_cap": m["cap_mid"], "small_cap": m["cap_small"], "cap_tol": CAP_TOL,
        },
        "actual": {
            "equity_pct":     round(eff_equity, 1),
            "debt_pct":       round(eff_debt, 1),
            "cash_other_pct": round(eff_other, 1),
            "large_cap":      rb_large,
            "mid_cap":        rb_mid,
            "small_cap":      rb_small,
        },
        "asset_mix": {
            "Equity":         round(eff_equity, 1),
            "Debt":           round(eff_debt, 1),
            "Cash & Others":  round(eff_other, 1),
            "Gold":           round(sum(f["weight"] for f in result if f["asset_class"] == "Precious Metals"), 1),
        },
        "blended": {
            "return_1y": wavg("return_1y"), "return_3y": wavg("return_3y"),
            "return_5y": wavg("return_5y"), "sharpe_3y": wavg("sharpe_ratio_3y"),
            "alpha_3y": wavg("alpha_3y"), "std_dev_3y": wavg("std_dev_3y"),
            "std_dev_5y": wavg("std_dev_5y"),
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
                "alpha_3y": f.get("alpha_3y"), "std_dev_3y": f.get("std_dev_3y"), "std_dev_5y": f.get("std_dev_5y"), "expense_ratio": f.get("expense_ratio"),
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
               expense_ratio, std_dev_3y, std_dev_5y, alpha_3y,
               fund_size, amfi_code, nav, morningstar_rating, branding_name
        FROM daily_fund_data
        WHERE data_date = :date AND nav IS NOT NULL
          AND (ranking IN ('R1','R2') OR asset_class = 'Precious Metals')
    """), {"date": str(data_date)}).fetchall()

    seen_isin, seen_name, out = set(), set(), []
    for r in rows:
        d = dict(r._mapping)
        isin = d.get("isin")
        name_key = (d.get("name") or "").strip().lower()
        if isin and isin in seen_isin: continue
        if name_key and name_key in seen_name: continue
        if isin:      seen_isin.add(isin)
        if name_key:  seen_name.add(name_key)
        out.append(d)
    return out


@router.get("/debug")
def debug_portfolios(date: str = Query(None)):
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
                p = _build_portfolio(k, funds, db=db)
                results["models"][k] = {"ok": True, "fund_count": p["fund_count"], "method": p.get("used_method","lp")}
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
                p = _build_portfolio(k, funds, db=db)
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
        p = _build_portfolio(key, funds, db=db)
        p["data_date"] = str(data_date)
        return p
    finally:
        db.close()