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
        # CVaR-LP constraint params
        "dncap_ceiling": 92, "stress_ceiling": -10, "max_funds": 10, "min_holding_pct": 5,
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
        # CVaR-LP constraint params
        "dncap_ceiling": 92, "stress_ceiling": -14, "max_funds": 10, "min_holding_pct": 5,
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
        # CVaR-LP constraint params
        "dncap_ceiling": 92, "stress_ceiling": -28, "max_funds": 11, "min_holding_pct": 5,
        "label": "Balanced", "risk": "Moderate", "risk_score": 3,
        "horizon": "3–5 years", "volatility": "6–9%", "max_drawdown": "10–15%",
        "suitability": "Moderate growth portfolio with reduced volatility, balancing capital appreciation and income generation. Ideal for investors with moderate risk appetite and medium-term goals.",
        "eq_lo": 50, "eq_hi": 60, "debt_lo": 40, "debt_hi": 50,
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
        # CVaR-LP constraint params
        "dncap_ceiling": 88, "stress_ceiling": -30, "max_funds": 14, "min_holding_pct": 5,
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
        # CVaR-LP constraint params
        "dncap_ceiling": 86, "stress_ceiling": -40, "max_funds": 13, "min_holding_pct": 5,
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
# PHASE 3 — BLACK-LITTERMAN + CVaR-LP OPTIMIZATION
# ══════════════════════════════════════════════════════════════════════════════
#
# Pipeline:
#   1. _fetch_nav_data        — daily NAV → daily returns + monthly returns
#   2. _ewma_covariance       — exponentially weighted covariance from daily returns
#   3. _shrink_to_const_corr  — Ledoit-Wolf shrinkage toward constant-correlation
#   4. _black_litterman       — AUM-weighted equilibrium + House View → posterior
#   5. _cvar_lp               — CVaR-LP (Rockafellar-Uryasev) using monthly scenarios
#   6. _optimize_bl_cvar      — full pipeline; falls back to _solve_with_retry
#
# Fallback: if NAV data insufficient or CVaR-LP fails, falls back to feasibility LP.
# ══════════════════════════════════════════════════════════════════════════════

RISK_FREE_RATE = 6.5    # % — approximate Indian T-bill / repo rate
MIN_YEARS      = 3      # minimum calendar years of data required for inclusion
TARGET_FUNDS_LO = 8
TARGET_FUNDS_HI = 11

# BL parameters
DELTA = 2.5       # risk aversion coefficient
TAU   = 0.05      # uncertainty scalar for equilibrium prior
EWMA_LAMBDA = 0.94  # RiskMetrics standard decay factor
CVAR_ALPHA  = 0.95   # CVaR confidence level

# Constraint constants
AMC_CAP = 0.35
CORR_CAP_THRESHOLD = 0.95   # only cap very highly correlated pairs
CORR_CAP_LIMIT     = 0.40   # combined weight cap for highly correlated pairs
CRISIS_BASE_SHOCK   = 55  # % — house assumption for GFC-style equity shock

# House View stances — assertion magnitude (absolute shift) and confidence (Idzorek)
STANCE_PARAMS = {
    'Strong Underweight':   {'assertion': -0.04, 'confidence': 0.85},
    'Underweight':          {'assertion': -0.03, 'confidence': 0.675},
    'Moderate Underweight': {'assertion': -0.02, 'confidence': 0.57},
    'Neutral':              {'assertion':  0.00, 'confidence': 0.50},
    'Selective':            {'assertion':  0.015,'confidence': 0.45},
    'Moderate Overweight':  {'assertion':  0.02, 'confidence': 0.57},
    'Overweight':           {'assertion':  0.03, 'confidence': 0.675},
    'Strong Overweight':    {'assertion':  0.04, 'confidence': 0.85},
}

# Default House View — updated periodically by BugleRock investment team
DEFAULT_HOUSE_VIEW = {
    'equity':    'Overweight',
    'debt':      'Neutral',
    'gold':      'Moderate Overweight',
    'smallcap':  'Selective',
    'midcap':    'Moderate Overweight',
}


# ── Data fetching ───────────────────────────────────────────────────────────────

def _fetch_nav_data(isins: list, db) -> dict:
    """
    Fetch daily NAV history from nav_history table (last 5 years).
    Returns per-ISIN:
      - daily_returns: numpy array of daily log returns
      - monthly_returns: numpy array of monthly returns (for CVaR scenarios)
      - calendar_returns: {year: pct_return} for validation
    """
    from sqlalchemy import text
    from datetime import date as date_type, timedelta
    from collections import defaultdict
    import numpy as np

    if not isins:
        return {}

    from datetime import date as date_type, timedelta
    five_years_ago = (date_type.today() - timedelta(days=5*365)).isoformat()

    rows = db.execute(text("""
        SELECT isin, date, nav
        FROM nav_history
        WHERE isin = ANY(:isins)
          AND nav IS NOT NULL AND nav > 0
          AND date >= :start_date
        ORDER BY isin, date ASC
    """), {"isins": isins, "start_date": five_years_ago}).fetchall()

    nav_by_isin = defaultdict(list)
    for r in rows:
        nav_by_isin[r[0]].append((r[1], float(r[2])))

    result = {}
    for isin, series in nav_by_isin.items():
        if len(series) < 756:  # need at least 3 years of daily data (252*3)
            continue

        dates = [d for d, _ in series]
        navs  = np.array([v for _, v in series])

        # Daily returns (simple returns, not log — more intuitive for MF NAVs)
        daily_ret = np.diff(navs) / navs[:-1]

        # Weekly returns — Friday-to-Friday (or last trading day of each week)
        from collections import OrderedDict
        weeks = OrderedDict()
        for d, v in series:
            # ISO week number gives consistent weekly bucketing
            wk_key = d.isocalendar()[:2]  # (year, week)
            if wk_key not in weeks:
                weeks[wk_key] = {'first': v, 'last': v}
            weeks[wk_key]['last'] = v

        weekly_ret = []
        wk_list = list(weeks.values())
        for i in range(1, len(wk_list)):
            prev_last = wk_list[i-1]['last']
            curr_last = wk_list[i]['last']
            if prev_last > 0:
                weekly_ret.append(curr_last / prev_last - 1)
        weekly_ret = np.array(weekly_ret)

        # Monthly returns — last NAV of each month vs last NAV of previous month
        from collections import OrderedDict as OD
        months = OD()
        for d, v in series:
            key = (d.year, d.month)
            if key not in months:
                months[key] = {'first': v, 'last': v}
            months[key]['last'] = v

        monthly_ret = []
        mo_list = list(months.values())
        for i in range(1, len(mo_list)):
            prev_last = mo_list[i-1]['last']
            curr_last = mo_list[i]['last']
            if prev_last > 0:
                monthly_ret.append(curr_last / prev_last - 1)
        monthly_ret = np.array(monthly_ret)

        # Calendar year returns (for validation / display)
        cal_returns = {}
        YEARS = [2021, 2022, 2023, 2024, 2025]
        year_navs = defaultdict(list)
        for d, v in series:
            if d.year in YEARS:
                year_navs[d.year].append(v)
        for yr, vv in year_navs.items():
            if len(vv) >= 20:  # at least 20 trading days
                cal_returns[yr] = (vv[-1] / vv[0] - 1) * 100

        if len(weekly_ret) >= 156:  # 3 years of weekly data (52*3)
            result[isin] = {
                'daily_returns': daily_ret,
                'weekly_returns': weekly_ret,
                'monthly_returns': monthly_ret,
                'calendar_returns': cal_returns,
                'n_days': len(daily_ret),
                'n_weeks': len(weekly_ret),
                'n_months': len(monthly_ret),
            }

    return result


def _apply_category_proxy(nav_data, funds, target_weeks=260):
    """
    For funds with 3–5yr weekly history, extend missing early periods using
    the average return of same-category peers that have full 5yr+ history.

    This is Option 2 (category proxy) — more honest than mean-padding because
    it uses ACTUAL market returns from that period via peer funds.

    Only modifies weekly_returns (used for CVaR-LP). Daily returns and
    covariance use pairwise overlapping windows so no proxy needed there.
    """
    import numpy as np

    # Build isin → category map
    isin_to_cat = {f['isin']: f.get('category', '') for f in funds}

    # Build category → list of full-history weekly return arrays
    cat_full_weekly = {}  # category → np.array of shape (n_full_funds, target_weeks)
    for isin, data in nav_data.items():
        if data['n_weeks'] >= target_weeks:
            cat = isin_to_cat.get(isin, '')
            if cat not in cat_full_weekly:
                cat_full_weekly[cat] = []
            cat_full_weekly[cat].append(data['weekly_returns'][-target_weeks:])

    # Compute category average weekly return series
    cat_avg_weekly = {}
    for cat, arrays in cat_full_weekly.items():
        if len(arrays) >= 2:  # need at least 2 peers to form a meaningful average
            cat_avg_weekly[cat] = np.mean(np.array(arrays), axis=0)

    # Apply proxy to short-history funds
    proxied = 0
    for isin, data in nav_data.items():
        n = data['n_weeks']
        if n >= target_weeks:
            continue  # already full history — no proxy needed

        cat = isin_to_cat.get(isin, '')
        proxy = cat_avg_weekly.get(cat)

        if proxy is None:
            # No peers with full history in same category
            # Fall back to broader asset class proxy
            # Try parent category (strip sub-category suffix)
            for known_cat, avg in cat_avg_weekly.items():
                # Match on asset class prefix e.g. "India Fund" or "Cat:"
                if known_cat[:12] == cat[:12]:
                    proxy = avg
                    break

        if proxy is None:
            # No proxy available — keep as-is (shorter history)
            continue

        # Extend: prepend proxy for missing periods, keep own actual returns
        missing = target_weeks - n
        extended = np.concatenate([proxy[:missing], data['weekly_returns'][-n:]])
        nav_data[isin]['weekly_returns'] = extended
        nav_data[isin]['n_weeks'] = target_weeks
        nav_data[isin]['proxy_weeks'] = missing  # track for logging
        proxied += 1

    if proxied > 0:
        logger.info(f"Category proxy applied to {proxied} funds with short history")

    return nav_data

def _ewma_covariance(returns_dict, isins, lam=EWMA_LAMBDA):
    """
    EWMA covariance from daily returns.
    Handles variable history lengths by computing each (i,j) pair on their
    own overlapping window — so a new fund with 300 days doesn't truncate
    an older fund with 1250 days.
    Returns NxN annualised covariance matrix, and median history length.
    """
    import numpy as np

    N = len(isins)
    Sigma = np.zeros((N, N))

    # Each diagonal: fund's own variance on its own full history
    # Each off-diagonal: pairwise covariance on overlapping window
    for i in range(N):
        r_i = returns_dict[isins[i]]['daily_returns']
        T_i = len(r_i)

        # Diagonal: own variance
        w_i = np.array([lam ** (T_i - 1 - t) for t in range(T_i)])
        w_i /= w_i.sum()
        m_i = np.dot(w_i, r_i)
        dm_i = r_i - m_i
        Sigma[i, i] = np.dot(w_i, dm_i ** 2) * 252

        for j in range(i + 1, N):
            r_j = returns_dict[isins[j]]['daily_returns']
            T_j = len(r_j)

            # Use overlapping window (most recent common length)
            T_ij = min(T_i, T_j)
            ri = r_i[-T_ij:]
            rj = r_j[-T_ij:]

            w_ij = np.array([lam ** (T_ij - 1 - t) for t in range(T_ij)])
            w_ij /= w_ij.sum()
            m_ri = np.dot(w_ij, ri)
            m_rj = np.dot(w_ij, rj)
            cov_ij = np.dot(w_ij, (ri - m_ri) * (rj - m_rj)) * 252

            Sigma[i, j] = cov_ij
            Sigma[j, i] = cov_ij

    T_median = int(np.median([len(returns_dict[isin]['daily_returns']) for isin in isins]))
    return Sigma, T_median


# ── Ledoit-Wolf Shrinkage ───────────────────────────────────────────────────────

def _shrink_to_const_corr(Sigma, T, returns_matrix=None):
    """
    Ledoit-Wolf (2004) shrinkage toward constant-correlation target.
    - Diagonal: each fund's own variance (unshrunk)
    - Off-diagonal: shrunk toward avg_pairwise_correlation × σ_i × σ_j
    - Intensity: estimated to minimise expected squared error
    Returns (shrunk_Sigma, alpha, avg_corr).
    """
    import numpy as np

    N = Sigma.shape[0]
    stds = np.sqrt(np.maximum(np.diag(Sigma), 1e-20))

    # Average pairwise correlation
    corr_sum, corr_count = 0.0, 0
    for i in range(N):
        for j in range(i + 1, N):
            if stds[i] > 1e-10 and stds[j] > 1e-10:
                corr_sum += Sigma[i, j] / (stds[i] * stds[j])
                corr_count += 1
    avg_corr = corr_sum / corr_count if corr_count > 0 else 0

    # Target: constant correlation structure
    F = np.zeros_like(Sigma)
    for i in range(N):
        for j in range(N):
            F[i, j] = Sigma[i, i] if i == j else avg_corr * stds[i] * stds[j]

    # Compute Ledoit-Wolf optimal shrinkage intensity
    alpha = 0.5  # fallback
    if returns_matrix is not None and returns_matrix.shape[0] == N:
        Tsamp = returns_matrix.shape[1]
        means = returns_matrix.mean(axis=1, keepdims=True)
        dm = returns_matrix - means
        S = (dm @ dm.T) / Tsamp

        # pi_hat
        pi_hat = 0.0
        for i in range(N):
            for j in range(N):
                pi_hat += np.mean((dm[i] * dm[j] - S[i, j]) ** 2)

        # gamma_hat
        gamma_hat = np.sum((F - S) ** 2)

        # rho_hat
        rho_hat = sum(np.mean((dm[i] ** 2 - S[i, i]) ** 2) for i in range(N))
        for i in range(N):
            for j in range(N):
                if i == j:
                    continue
                theta_ii_ij = np.mean((dm[i] ** 2 - S[i, i]) * (dm[i] * dm[j] - S[i, j]))
                theta_jj_ij = np.mean((dm[j] ** 2 - S[j, j]) * (dm[i] * dm[j] - S[i, j]))
                if stds[i] > 1e-10 and stds[j] > 1e-10:
                    rho_hat += (avg_corr / 2) * (
                        np.sqrt(stds[j] / stds[i]) * theta_ii_ij
                        + np.sqrt(stds[i] / stds[j]) * theta_jj_ij
                    )

        kappa = (pi_hat - rho_hat) / gamma_hat if gamma_hat > 1e-15 else 0
        alpha = np.clip(kappa / Tsamp, 0.10, 0.95)

    # Apply shrinkage: diagonal untouched, off-diagonal blended
    result = np.copy(Sigma)
    for i in range(N):
        for j in range(N):
            if i != j:
                result[i, j] = alpha * F[i, j] + (1 - alpha) * Sigma[i, j]

    return result, float(alpha), float(avg_corr)


# ── Black-Litterman ─────────────────────────────────────────────────────────────

def _black_litterman_posterior(pi, Sigma, tau, P, Q, Omega):
    """
    BL posterior expected returns.
    pi: Nx1 equilibrium prior (annualised)
    Sigma: NxN covariance (annualised)
    P: KxN pick matrix, Q: Kx1 view returns, Omega: KxK view uncertainty
    Returns (posterior_mean, posterior_cov).
    """
    import numpy as np

    tau_sigma = tau * Sigma
    tau_sigma_inv = np.linalg.inv(tau_sigma)

    if P is None or len(P) == 0:
        return pi.copy(), tau_sigma

    P = np.array(P)
    Q = np.array(Q).flatten()
    Omega = np.array(Omega)
    Omega_inv = np.linalg.inv(Omega)

    left = tau_sigma_inv + P.T @ Omega_inv @ P
    left_inv = np.linalg.inv(left)
    right = tau_sigma_inv @ pi + P.T @ Omega_inv @ Q

    return left_inv @ right, left_inv


def _build_house_view_pq(pool, pi, Sigma, tau, house_view):
    """
    Construct P, Q, Omega from House View stances via Idzorek confidence method.
    """
    import numpy as np

    N = len(pool)
    P_rows, Q_vals, omega_diag = [], [], []

    def _eq_pct_frac(f):
        if f.get('asset_class') == 'Debt':
            return 0.0
        v = f.get('equity_pct')
        return (float(v) / 100) if v else (1.0 if f.get('asset_class') == 'Equity' else 0.0)

    def _debt_pct_frac(f):
        if f.get('asset_class') == 'Debt':
            return 1.0
        v = f.get('bond_pct')
        return (float(v) / 100) if v else 0.0

    def _gold_flag(f):
        return 1.0 if f.get('asset_class') == 'Precious Metals' else 0.0

    def _sc_frac(f):
        return _eq_pct_frac(f) * (float(f.get('small_cap') or 0) / 100)

    def _mc_frac(f):
        return _eq_pct_frac(f) * (float(f.get('mid_cap') or 0) / 100)

    exposure_fns = {
        'equity':   _eq_pct_frac,
        'debt':     _debt_pct_frac,
        'gold':     _gold_flag,
        'smallcap': _sc_frac,
        'midcap':   _mc_frac,
    }

    for cat_key, exp_fn in exposure_fns.items():
        stance = house_view.get(cat_key)
        params = STANCE_PARAMS.get(stance)
        if not params or params['confidence'] <= 0.01:
            continue

        exposures = np.array([exp_fn(f) for f in pool])
        total = exposures.sum()
        if total <= 0:
            continue

        row = exposures / total
        prior_for_cat = float(row @ pi)

        P_rows.append(row)
        Q_vals.append(prior_for_cat + params['assertion'])

        # Omega diagonal via Idzorek method
        p_tau_sigma = (tau * Sigma) @ row
        quad_form = float(row @ p_tau_sigma)
        omega_diag.append((1.0 / params['confidence'] - 1.0) * quad_form)

    if not P_rows:
        return None, None, None

    K = len(P_rows)
    return np.array(P_rows), np.array(Q_vals), np.diag(omega_diag)


# ── CVaR-LP (Rockafellar-Uryasev) ──────────────────────────────────────────────

def _cvar_lp(scenario_returns, alpha, upper_bounds, add_A, add_b, add_sense, return_bonus=None):
    """
    Mean-CVaR portfolio optimization via scipy.optimize.linprog (HiGHS).
    scenario_returns: NxT numpy array (weekly returns, fractional)
    alpha: CVaR confidence level (e.g. 0.95)
    upper_bounds: list of per-fund max weight (fractional)
    add_A/b/sense: additional linear constraints
    return_bonus: optional Nx1 array — small negative weight on expected return
                  added to objective to softly prefer higher-return portfolios
                  without a hard constraint floor.
    Returns dict with status, weights (N array, fractional), cvar.
    """
    import numpy as np
    from scipy.optimize import linprog

    N, T = scenario_returns.shape
    # Variables: w_1..w_N, zeta_plus, zeta_minus, z_1..z_T
    n_vars = N + 2 + T
    zp, zm = N, N + 1

    def z(t):
        return N + 2 + t

    # Objective: min CVaR - lambda * expected_return (soft return preference)
    c = np.zeros(n_vars)
    c[zp] = 1.0
    c[zm] = -1.0
    for t in range(T):
        c[z(t)] = 1.0 / (T * (1 - alpha))

    # ── FIX 1: Soft return penalty ──
    # Instead of a hard return floor constraint (which causes infeasibility),
    # subtract a small multiple of expected weekly return from the objective.
    # λ=0.5 means: optimizer will accept 0.5 unit more CVaR to gain 1 unit return.
    # This makes high-return portfolios preferred without making low-return ones infeasible.
    RETURN_LAMBDA = 0.5
    if return_bonus is not None:
        for i in range(N):
            c[i] -= RETURN_LAMBDA * float(return_bonus[i])

    # Inequality constraints (A_ub @ x <= b_ub)
    A_ub_list, b_ub_list = [], []

    # Scenario constraints: -r_t'w - zeta - z_t <= 0
    for t in range(T):
        row = np.zeros(n_vars)
        for i in range(N):
            row[i] = -scenario_returns[i, t]
        row[zp] = -1.0
        row[zm] = 1.0
        row[z(t)] = -1.0
        A_ub_list.append(row)
        b_ub_list.append(0.0)

    # Per-fund upper bounds
    for i in range(N):
        row = np.zeros(n_vars)
        row[i] = 1.0
        A_ub_list.append(row)
        b_ub_list.append(upper_bounds[i])

    # Equality constraint: sum(w) = 1
    A_eq = np.zeros((1, n_vars))
    A_eq[0, :N] = 1.0
    b_eq = np.array([1.0])

    # Additional constraints
    for idx in range(len(add_A)):
        full_row = np.zeros(n_vars)
        for i in range(min(N, len(add_A[idx]))):
            full_row[i] = add_A[idx][i]

        if add_sense[idx] == '<=':
            A_ub_list.append(full_row)
            b_ub_list.append(add_b[idx])
        elif add_sense[idx] == '>=':
            A_ub_list.append(-full_row)
            b_ub_list.append(-add_b[idx])
        elif add_sense[idx] == '=':
            A_eq = np.vstack([A_eq, full_row.reshape(1, -1)])
            b_eq = np.append(b_eq, add_b[idx])

    # Variable bounds
    bounds = [(0, ub) for ub in upper_bounds]  # w_i
    bounds.append((0, None))  # zeta_plus
    bounds.append((0, None))  # zeta_minus
    bounds.extend([(0, None)] * T)  # z_t

    A_ub = np.array(A_ub_list)
    b_ub = np.array(b_ub_list)

    try:
        res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq,
                      bounds=bounds, method='highs',
                      options={'presolve': True, 'time_limit': 30})
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

    if not res.success:
        return {'status': 'infeasible', 'message': res.message}

    return {
        'status': 'optimal',
        'weights': res.x[:N],
        'cvar': res.fun,
    }


# ── Main optimizer entry point ──────────────────────────────────────────────────

def _optimize_sharpe(funds, m, gold_isins=None, db=None):
    """
    Phase 3 entry point — Black-Litterman + CVaR-LP.
    Replaces the old Frank-Wolfe Sharpe optimizer.
    Same signature: returns (weights_array, fund_list, method_string).
    Falls back to _solve_with_retry if BL+CVaR fails.
    """
    import numpy as np

    logger.info(f"BL+CVaR starting for {len(funds)} candidates, db={'present' if db else 'None'}")

    if db is None:
        logger.warning("BL+CVaR: db is None — LP fallback")
        return None, funds, "lp_fallback"

    isins = [f.get("isin") for f in funds if f.get("isin")]
    if len(isins) < 3:
        return None, funds, "lp_fallback"

    # ── Step 1: Fetch daily NAV data ──
    nav_data = _fetch_nav_data(isins, db)
    valid_isins = [isin for isin in isins if isin in nav_data]

    if len(valid_isins) < max(3, len(funds) * 0.5):
        logger.warning(f"BL+CVaR: only {len(valid_isins)}/{len(funds)} have NAV data — LP fallback")
        return None, funds, "lp_fallback"

    # Filter funds to those with NAV data
    isin_set = set(valid_isins)
    valid_funds = [f for f in funds if f.get("isin") in isin_set]
    valid_isins = [f["isin"] for f in valid_funds]
    N = len(valid_funds)

    # ── Step 1b: Apply category proxy to extend short-history funds ──
    # Funds with 3–5yr history get missing early periods estimated from
    # same-category peers that have full 5yr history.
    nav_data = _apply_category_proxy(nav_data, valid_funds, target_weeks=260)

    # ── Step 2: EWMA covariance from daily returns ──
    # Each fund may have different history length.
    # Use pairwise EWMA on the common overlapping window per pair,
    # then assemble the full NxN matrix.
    try:
        Sigma, T_daily = _ewma_covariance(nav_data, valid_isins, EWMA_LAMBDA)
    except Exception as e:
        logger.warning(f"EWMA covariance failed: {e} — LP fallback")
        return None, funds, "lp_fallback"

    # ── Step 3: Ledoit-Wolf shrinkage ──
    try:
        # After category proxy, use median daily history for shrinkage
        all_n_days = [nav_data[isin]['n_days'] for isin in valid_isins]
        common_len = int(np.median(all_n_days))
        daily_matrix = np.zeros((N, common_len))
        for i, isin in enumerate(valid_isins):
            dr = nav_data[isin]['daily_returns']
            if len(dr) >= common_len:
                daily_matrix[i] = dr[-common_len:]
            else:
                # Shorter history — no proxy for daily (EWMA handles pairwise)
                # Use fund's own mean for the gap
                pad = common_len - len(dr)
                daily_matrix[i] = np.concatenate([np.full(pad, np.mean(dr)), dr])
        daily_ann = daily_matrix * np.sqrt(252)
        Sigma, shrink_alpha, avg_corr = _shrink_to_const_corr(Sigma, common_len, daily_ann)
        logger.info(f"Shrinkage: alpha={shrink_alpha:.3f}, avg_corr={avg_corr:.3f}, common_len={common_len}d")
    except Exception as e:
        logger.warning(f"Shrinkage failed: {e} — using raw EWMA covariance")

    # ── Step 4: Black-Litterman posterior ──
    try:
        # AUM-weighted market equilibrium prior
        aum_arr = np.array([float(f.get("fund_size") or 1) for f in valid_funds])
        w_mkt = aum_arr / aum_arr.sum()
        pi = DELTA * Sigma @ w_mkt  # equilibrium expected returns (annualised)

        # Build House View P, Q, Omega
        P, Q, Omega = _build_house_view_pq(valid_funds, pi, Sigma, TAU, DEFAULT_HOUSE_VIEW)

        # Compute posterior
        if P is not None:
            posterior_mean, posterior_cov = _black_litterman_posterior(pi, Sigma, TAU, P, Q, Omega)
            logger.info(f"BL posterior computed: {N} funds, {len(P)} views")
        else:
            posterior_mean = pi.copy()
            posterior_cov = TAU * Sigma
            logger.info(f"No active views — using equilibrium prior")
    except Exception as e:
        logger.warning(f"BL posterior failed: {e} — using equilibrium prior")
        aum_arr = np.array([float(f.get("fund_size") or 1) for f in valid_funds])
        w_mkt = aum_arr / aum_arr.sum()
        posterior_mean = DELTA * Sigma @ w_mkt

    # ── Step 5: Build constraints for CVaR-LP ──
    gold_isins_set = gold_isins or set()
    min_funds = m.get("min_funds", MIN_FUNDS)
    # Per-fund cap — high-equity profiles (eq_lo >= 68%) get 20% cap
    # Conservative/mod_conservative/balanced get 15% to force diversification
    per_fund_cap = 0.20 if m.get('eq_lo', 0) >= 68 else 0.15
    upper_bounds = [per_fund_cap] * N

    add_A, add_b, add_sense = [], [], []

    # Equity band
    eq_row = [(_s(f.get("equity_pct")) or (100.0 if f["asset_class"] == "Equity" else 0.0)) / 100
              for f in valid_funds]
    add_A.append(eq_row); add_b.append(m["eq_lo"] / 100); add_sense.append('>=')
    add_A.append(eq_row); add_b.append(m["eq_hi"] / 100); add_sense.append('<=')

    # Debt band
    debt_row = [(100.0 if f["asset_class"] == "Debt" else (_s(f.get("bond_pct")) or 0.0)) / 100
                for f in valid_funds]
    add_A.append(debt_row); add_b.append(m["debt_lo"] / 100); add_sense.append('>=')
    add_A.append(debt_row); add_b.append(m["debt_hi"] / 100); add_sense.append('<=')

    # Gold sleeve
    if m.get("gold_lo", 0) > 0:
        gold_row = [1.0 if f.get("isin") in gold_isins_set else 0.0 for f in valid_funds]
        if any(g > 0 for g in gold_row):
            add_A.append(gold_row); add_b.append(m["gold_lo"] / 100); add_sense.append('>=')
            add_A.append(gold_row); add_b.append(m["gold_hi"] / 100); add_sense.append('<=')

    # AMC cap 35% — always applied regardless of pool size
    amc_map = {}
    for f in valid_funds:
        amc = (f.get("branding_name") or f.get("name", "").split(" ")[0] or "").strip()
        if amc:
            amc_map[f["isin"]] = amc
    unique_amcs = set(amc_map.values())
    for amc in unique_amcs:
        row = [1.0 if amc_map.get(f["isin"]) == amc else 0.0 for f in valid_funds]
        add_A.append(row); add_b.append(AMC_CAP); add_sense.append('<=')
    logger.info(f"AMC cap applied: {len(unique_amcs)} AMCs in pool")

    # ── FIX 2: Pairwise correlation cap — only the single most-correlated pair ──
    # Old: cap every pair > 0.95 → dozens of constraints → collectively infeasible
    # New: per fund, cap only its most correlated partner (worst offender only)
    # This prevents a single fund from being over-concentrated with its closest peer.
    fund_corr_partner = {}  # isin → (partner_isin, corr, pair_indices)
    for ci in range(N):
        for cj in range(ci + 1, N):
            wr_i = nav_data[valid_isins[ci]]['weekly_returns']
            wr_j = nav_data[valid_isins[cj]]['weekly_returns']
            min_w = min(len(wr_i), len(wr_j))
            if min_w >= 156:
                corr = float(np.corrcoef(wr_i[-min_w:], wr_j[-min_w:])[0, 1])
                if corr > CORR_CAP_THRESHOLD:
                    # Track highest correlation per fund
                    for idx, isin in [(ci, valid_isins[ci]), (cj, valid_isins[cj])]:
                        other_idx = cj if idx == ci else ci
                        if isin not in fund_corr_partner or corr > fund_corr_partner[isin][1]:
                            fund_corr_partner[isin] = (other_idx, corr, ci, cj)

    # Add constraint only for unique (ci, cj) pairs that are worst for either fund
    added_pairs = set()
    for isin, (other_idx, corr, ci, cj) in fund_corr_partner.items():
        pair_key = (min(ci, cj), max(ci, cj))
        if pair_key not in added_pairs:
            row = [0.0] * N
            row[ci] = 1.0
            row[cj] = 1.0
            add_A.append(row); add_b.append(CORR_CAP_LIMIT); add_sense.append('<=')
            added_pairs.add(pair_key)
            logger.info(f"Corr cap: {valid_funds[ci]['name'][:20]} + {valid_funds[cj]['name'][:20]} corr={corr:.3f}")

    # Down-capture ceiling — only equity and hybrid funds with meaningful equity exposure
    dncap_ceil = m.get("dncap_ceiling")
    if dncap_ceil:
        dncap_row = []
        has_dncap_data = False
        for f in valid_funds:
            ac = f.get("asset_class", "")
            eq_frac = (_s(f.get("equity_pct")) or (100.0 if ac == "Equity" else 0.0))
            if ac in ("Equity", "Hybrid") and eq_frac > 20:
                dc_raw = f.get("down_capture_3y")
                if dc_raw is not None:
                    has_dncap_data = True
                    dncap_row.append(float(dc_raw) - dncap_ceil)
                else:
                    dncap_row.append(0)
            else:
                dncap_row.append(0)
        if has_dncap_data and any(v != 0 for v in dncap_row):
            add_A.append(dncap_row); add_b.append(0); add_sense.append('<=')

    # Crisis drawdown ceiling: eq% × dncap × 55%
    stress_ceil = m.get("stress_ceiling")
    if stress_ceil:
        crisis_row = []
        has_dncap = False
        for f in valid_funds:
            ac = f.get("asset_class", "")
            eq_frac = (_s(f.get("equity_pct")) or (100.0 if ac == "Equity" else 0.0)) / 100
            if ac in ("Equity", "Hybrid") and eq_frac > 0.20:
                dc_raw = f.get("down_capture_3y")
                if dc_raw is not None:
                    has_dncap = True
                dc = (float(dc_raw) if dc_raw is not None else 100.0) / 100
                crisis_row.append(eq_frac * dc * CRISIS_BASE_SHOCK)
            else:
                crisis_row.append(0)
        if has_dncap:
            add_A.append(crisis_row); add_b.append(abs(stress_ceil)); add_sense.append('<=')

    # ── FIX 1: Return floor as soft penalty in objective rather than hard constraint ──
    # Old: hard constraint posterior_mean @ w >= floor → conflicts with CVaR minimization
    # New: add a tiny negative weight on posterior_mean to the CVaR objective
    #      so optimizer naturally prefers higher-return portfolios without a hard floor.
    # This is done by passing posterior_mean as a return_bonus to _cvar_lp.

    # Convert BL posterior to weekly scale for soft return bonus
    posterior_weekly = (1 + posterior_mean) ** (1 / 52) - 1
    logger.info(f"BL posterior weekly range: [{posterior_weekly.min():.5f}, {posterior_weekly.max():.5f}]")

    # ── Step 6: Build weekly scenario matrix for CVaR-LP ──
    target_weeks = 260
    scenario_matrix = np.zeros((N, target_weeks))
    for i, isin in enumerate(valid_isins):
        wr = nav_data[isin]['weekly_returns']
        scenario_matrix[i] = wr[-target_weeks:] if len(wr) >= target_weeks else \
            np.concatenate([np.zeros(target_weeks - len(wr)), wr])

    # ── Step 7: Solve CVaR-LP ──
    # Return floor is now SOFT (penalty in objective) not hard constraint.
    logger.warning(f"CVaR-LP: N={N}, T={target_weeks}, constraints={len(add_A)}, cap={per_fund_cap:.2f}")
    try:
        result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, add_A, add_b, add_sense,
                          return_bonus=posterior_weekly)

        # ── Progressive constraint relaxation ──────────────────────────────────
        # Return floor is now soft — first try dropping correlation pairs
        if result['status'] != 'optimal':
            logger.warning("CVaR-LP infeasible with full constraints — dropping correlation pairs")
            rA, rb, rs = [], [], []
            for i in range(len(add_A)):
                n_nz = sum(1 for v in add_A[i] if abs(v) > 1e-9)
                if n_nz != 2:
                    rA.append(add_A[i]); rb.append(add_b[i]); rs.append(add_sense[i])
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, rA, rb, rs,
                              return_bonus=posterior_weekly)
            logger.warning(f"Without corr pairs: {result['status']} ({len(rA)} constraints)")

        # Layer 2: drop AMC cap constraints
        if result['status'] != 'optimal':
            logger.warning("CVaR-LP infeasible — dropping AMC cap constraints")
            rA, rb, rs = [], [], []
            for i in range(len(add_A)):
                n_nz = sum(1 for v in add_A[i] if abs(v) > 1e-9)
                if n_nz >= int(N * 0.3):  # keep broad constraints only
                    rA.append(add_A[i]); rb.append(add_b[i]); rs.append(add_sense[i])
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, rA, rb, rs,
                              return_bonus=posterior_weekly)
            logger.warning(f"Without AMC cap: {result['status']} ({len(rA)} constraints)")

        # Layer 3: bare minimum — just equity/debt band
        if result['status'] != 'optimal':
            logger.warning(f"CVaR-LP bare minimum: N={N}, cap={per_fund_cap:.2f}")
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds,
                              add_A[:4], add_b[:4], add_sense[:4],
                              return_bonus=posterior_weekly)
            logger.warning(f"Bare equity+debt band: {result['status']}")

        if result['status'] != 'optimal':
            logger.warning("CVaR-LP completely infeasible — LP fallback")
            return None, funds, "lp_fallback"

    except Exception as e:
        logger.warning(f"CVaR-LP exception: {e} — LP fallback")
        return None, funds, "lp_fallback"

    # ── Step 8: Enforce maxFunds via iterative trimming ──
    weights = result['weights']
    max_funds = m.get("max_funds", TARGET_FUNDS_HI)
    min_holding = m.get("min_holding_pct", 5.0) / 100

    # ── Trim to maxFunds ──────────────────────────────────────────────────────
    for trim_iter in range(20):
        active = sum(1 for w in weights if w > 0.005)
        if active <= max_funds:
            break
        min_idx = None
        min_w = float('inf')
        for i in range(N):
            if weights[i] > 0.005 and weights[i] < min_w:
                min_w = weights[i]
                min_idx = i
        if min_idx is None:
            break
        upper_bounds[min_idx] = 0
        try:
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, add_A, add_b, add_sense,
                              return_bonus=posterior_weekly)
            if result['status'] == 'optimal':
                weights = result['weights']
            else:
                break
        except:
            break

    # ── Enforce min_holding (5%) — drop funds below threshold and re-solve ───
    for min_iter in range(20):
        below = [i for i in range(N) if 0 < weights[i] < min_holding]
        if not below:
            break
        # Drop the smallest weight fund below threshold
        drop_idx = min(below, key=lambda i: weights[i])
        upper_bounds[drop_idx] = 0
        try:
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, add_A, add_b, add_sense,
                              return_bonus=posterior_weekly)
            if result['status'] == 'optimal':
                weights = result['weights']
            else:
                break
        except:
            break

    # Convert to percentage weights aligned with valid_funds
    weights_pct = weights * 100

    logger.warning(f"BL+CVaR solved: {sum(1 for w in weights_pct if w > 0.5)} funds, "
                f"CVaR={result.get('cvar', 0):.4f}")

    return weights_pct, valid_funds, "bl_cvar"



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

    # Accept BL+CVaR if it produced >= 6 active funds (relaxed from TARGET_FUNDS_LO=8)
    # BL+CVaR naturally concentrates into fewer, higher-quality funds than LP.
    # We trust the optimizer's fund count as long as it meets the model minimum (≥6).
    qp_accept_threshold = max(6, m.get("min_funds", 6) - 1)
    if qp_weights is not None and qp_active >= qp_accept_threshold:
        # QP succeeded — use qp_funds + qp_weights
        weights   = qp_weights
        candidates = qp_funds
        used_tol  = "bl_cvar"
        logger.info(f"BL+CVaR succeeded for {model_key}: {qp_active} funds (threshold={qp_accept_threshold})")
    else:
        # QP failed or insufficient funds — fall back to LP with original full candidate pool
        logger.info(f"BL+CVaR fallback for {model_key} (qp_active={qp_active}, need>={qp_accept_threshold}) — using LP")
        candidates = original_candidates
        weights, used_tol = _solve_with_retry(candidates, m, gold_isins=gold_isins)

    result = []
    seen_result = set()
    # For QP results, use a lower threshold (1%) — QP weights are already optimized
    # For LP results, use MIN_W_LOOSE (3%) as before
    w_threshold = 1.0 if used_tol in ("sharpe_qp", "bl_cvar") else MIN_W_LOOSE - 0.1
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

    def wavg_exclude_precious(key):
        """Weighted average excluding Precious Metals funds (gold/silver).
        Their down_capture values are invalid (-300+) as they benchmark differently."""
        vals = [(f["weight"], _sf(f.get(key))) for f in result
                if _s(f.get(key)) is not None
                and f.get("asset_class", "") != "Precious Metals"
                and "gold" not in (f.get("category") or "").lower()
                and "silver" not in (f.get("category") or "").lower()]
        if not vals: return None
        tw = sum(w for w,_ in vals)
        return round(sum(w*v for w,v in vals)/tw, 2) if tw else None

    def wavg_coverage(key):
        """Returns % of total portfolio weight that contributed to this metric."""
        total_w = sum(f["weight"] for f in result)
        valid_w = sum(f["weight"] for f in result if _s(f.get(key)) is not None)
        if total_w == 0: return None
        return round(valid_w / total_w * 100, 1)

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
            # Returns
            "return_1y":   wavg("return_1y"),
            "return_3y":   wavg("return_3y"),
            "return_5y":   wavg("return_5y"),
            "return_1m":   wavg("return_1m"),
            "return_3m":   wavg("return_3m"),
            "return_6m":   wavg("return_6m"),
            "return_ytd":  wavg("return_ytd"),
            # Calendar year returns
            "return_cy2021": wavg("return_cy2021"),
            "return_cy2022": wavg("return_cy2022"),
            "return_cy2023": wavg("return_cy2023"),
            "return_cy2024": wavg("return_cy2024"),
            "return_cy2025": wavg("return_cy2025"),
            # Risk metrics
            "sharpe_3y":      wavg("sharpe_ratio_3y"),
            "sortino_3y":     wavg("sortino_ratio_3y"),
            "alpha_3y":       wavg("alpha_3y"),
            "beta_3y":        wavg("beta_3y"),
            "up_capture_3y":  wavg("up_capture_3y"),
            "down_capture_3y": wavg_exclude_precious("down_capture_3y"),
            "std_dev_3y":     wavg("std_dev_3y"),
            "std_dev_5y":     wavg("std_dev_5y"),
            "expense_ratio":  wavg("expense_ratio"),
        },
        # Coverage: % of portfolio weight that contributed to each risk metric
        # < 100% means some funds (typically debt/gold) had no data for that metric
        "blended_coverage": {
            "sharpe_3y":       wavg_coverage("sharpe_ratio_3y"),
            "alpha_3y":        wavg_coverage("alpha_3y"),
            "beta_3y":         wavg_coverage("beta_3y"),
            "up_capture_3y":   wavg_coverage("up_capture_3y"),
            "down_capture_3y": wavg_coverage("down_capture_3y"),
            "std_dev_3y":      wavg_coverage("std_dev_3y"),
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
               sharpe_ratio_3y, sortino_ratio_3y,
               return_1y, return_3y, return_5y,
               return_1m, return_3m, return_6m, return_ytd,
               return_cy2021, return_cy2022, return_cy2023, return_cy2024, return_cy2025,
               expense_ratio, std_dev_3y, std_dev_5y,
               alpha_3y, beta_3y, up_capture_3y, down_capture_3y,
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