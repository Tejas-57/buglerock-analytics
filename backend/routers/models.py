# routers/models.py
"""
BugleRock Multi-Asset Model Portfolios — BL + CVaR-LP constraint solver.

Universe: R1/R2 ranked funds only (Active Equity, Debt, Hybrid).
Commodities/Alternates bucket is wired in for when Gold/Silver funds get ranked.

Solver: Black-Litterman posterior → CVaR-LP (Rockafellar-Uryasev) via HiGHS.
Fallback: scipy.optimize.linprog, method="highs" (pure feasibility LP, objective=0).

Methodology: BugleRock Model Portfolio Construction Architecture v1 (Sep 2026)
  Changes from Aug 2026 rulebook:
    - Gold fixed allocation per profile (not a range)
    - AMC cap reduced 35% → 30%
    - Per-fund cap unified to min(100/6, 20%) = 16.67%
    - Min holding profile-scaled: 4/4/3/3/4%
    - Down-capture ceilings corrected: 92/90/88/86/84
    - Return floor: hard constraint (profile-scaled), relaxes with governance flag
    - Mid+small look-through: absolute portfolio-level ceiling 15/20/30/40/50%
    - Debt credit quality floor: min AAA+AA% 89/85/80/75/70%
    - Duration ceiling: max mod duration 2.5/3/4/5/6 yrs
    - Liquid/Overnight exclusivity enforced post-solve
    - Fund eligibility: must have return_3y + at least one of CY2021-CY2025
    - Weight rounding: largest-remainder to whole percentages
    - Silver ≤ 30% of precious metals sleeve
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
    "India Fund Balanced Allocation":           3,
    "India Fund Multi Asset Allocation":        3,
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

# Hybrid category priority
HYBRID_PRIORITY = [
    "India Fund Dynamic Asset Allocation",
    "India Fund Balanced Allocation",
    "India Fund Multi Asset Allocation",
    "India Fund Equity Savings - Aggressive",
    "India Fund Equity Savings",
    "India Fund Equity Savings - Conservative",
    "India Fund Aggressive Allocation",
    "India Fund Conservative Allocation",
    "India Fund Arbitrage Fund",
]

# ── Categories that allow up to 2 funds (doc Section 9 — category count rule) ──
DUAL_ALLOWED_CATS = {
    "India Fund Large-Cap",
    "Cat: Flexi Cap Funds",
    "India Fund Dynamic Asset Allocation",
    "India Fund Equity Savings - Aggressive",
    "India Fund Equity Savings - Conservative",
}

# ── Model definitions ──────────────────────────────────────────────────────────
MODELS = {
    "conservative": {
        # BL+CVaR constraint params
        "dncap_ceiling": 92, "stress_ceiling": -10,
        "max_funds": 10, "min_holding_pct": 4,          # doc: 4% for conservative
        "return_floor": 6.5,                             # % annualised, hard constraint
        "mid_small_ceiling": 15,                         # % absolute portfolio look-through
        "min_aaa_aa_pct": 89,                            # % of debt sleeve min AAA+AA
        "max_duration": 2.5,                             # years, weighted mod duration
        "gold_fixed": 5,                                 # % fixed gold allocation (doc)
        "label": "Conservative", "risk": "Low", "risk_score": 1,
        "horizon": "3+ years", "volatility": "5–6%", "max_drawdown": "5–10%",
        "suitability": "A low-volatility portfolio designed for capital preservation and stable returns, emphasizing fixed income with limited equity exposure. Ideal for investors with lower risk tolerance.",
        "eq_lo": 22, "eq_hi": 28, "debt_lo": 62, "debt_hi": 73,
        "cap_large": 75, "cap_mid": 15, "cap_small": 10,
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
        "dncap_ceiling": 90, "stress_ceiling": -14,     # doc: 90 (was 92)
        "max_funds": 10, "min_holding_pct": 4,
        "return_floor": 7.0,
        "mid_small_ceiling": 20,
        "min_aaa_aa_pct": 85,
        "max_duration": 3.0,
        "gold_fixed": 5,
        "label": "Moderately Conservative", "risk": "Low–Moderate", "risk_score": 2,
        "horizon": "3–5 years", "volatility": "6–7%", "max_drawdown": "8–12%",
        "suitability": "Modest growth with limited equity exposure. Short-to-medium duration debt balanced with hybrid allocation for cautious investors wanting more than pure debt.",
        "eq_lo": 33, "eq_hi": 42, "debt_lo": 52, "debt_hi": 62,
        "cap_large": 70, "cap_mid": 20, "cap_small": 10,
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
            "India Fund Conservative Allocation": 1,
            "India Fund Arbitrage Fund": 0,
            "India Fund Aggressive Allocation": 0,
        },
    },
    "balanced": {
        "dncap_ceiling": 88, "stress_ceiling": -28,     # doc: 88 (was 92)
        "max_funds": 11, "min_holding_pct": 3,          # doc: 3% for balanced
        "return_floor": 7.5,
        "mid_small_ceiling": 30,
        "min_aaa_aa_pct": 80,
        "max_duration": 4.0,
        "gold_fixed": 6,                                 # doc: 6% for balanced
        "label": "Balanced", "risk": "Moderate", "risk_score": 3,
        "horizon": "3–5 years", "volatility": "6–9%", "max_drawdown": "10–15%",
        "suitability": "Moderate growth portfolio with reduced volatility, balancing capital appreciation and income generation. Ideal for investors with moderate risk appetite and medium-term goals.",
        "eq_lo": 50, "eq_hi": 60, "debt_lo": 40, "debt_hi": 50,
        "cap_large": 60, "cap_mid": 25, "cap_small": 15, "cap_tol": 15,
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
            "India Fund Conservative Allocation": 1,
            "India Fund Arbitrage Fund": 0,
        },
    },
    "mod_aggressive": {
        "dncap_ceiling": 86, "stress_ceiling": -30,     # doc: 86 (was 88)
        "max_funds": 14, "min_holding_pct": 3,          # doc: 3% for mod_aggressive
        "return_floor": 8.0,
        "mid_small_ceiling": 40,
        "min_aaa_aa_pct": 75,
        "max_duration": 5.0,
        "gold_fixed": 7,                                 # doc: 7%
        "label": "Moderately Aggressive", "risk": "Moderate–High", "risk_score": 4,
        "horizon": "5–7 years", "volatility": "8–12%", "max_drawdown": "12–18%",
        "suitability": "Growth-tilted portfolio with a debt ballast. Primarily equity across the cap spectrum, complemented by aggressive hybrid funds and minimal fixed income.",
        "eq_lo": 68, "eq_hi": 76, "debt_lo": 22, "debt_hi": 33,
        "cap_large": 50, "cap_mid": 27, "cap_small": 23,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [2, 3, 4],
        "allowed_equity_cats": None,
        "max_debt_funds": 2,
        "eq_per_cat": 2, "hyb_per_cat": 1,
        "eq_cat_limits": {
            # Core equity categories: Large-Cap, Large&Mid, Flexi, Mid, Small → 2 each (eq_per_cat default)
            # All others capped at 1
            "Cat: Multi Cap Funds": 1,
            "India Fund Focused Fund": 1,
            "Cat: Contra / Value Funds": 1,
        },
        "hyb_cat_limits": {
            # Max 1 per category — 3 hybrid slots total
            "India Fund Dynamic Asset Allocation":    1,
            "India Fund Aggressive Allocation":       1,
            "India Fund Equity Savings - Aggressive": 1,
            "India Fund Equity Savings":              0,
            "India Fund Equity Savings - Conservative": 0,
            "India Fund Conservative Allocation":     0,
            "India Fund Arbitrage Fund":              0,
        },
    },
    "aggressive": {
        "dncap_ceiling": 84, "stress_ceiling": -40,     # doc: 84 (was 86)
        "max_funds": 13, "min_holding_pct": 4,          # doc: 4% for aggressive
        "return_floor": 8.5,
        "mid_small_ceiling": 50,
        "min_aaa_aa_pct": 70,
        "max_duration": 6.0,
        "gold_fixed": 8,                                 # doc: 8%
        "label": "Aggressive", "risk": "High", "risk_score": 5,
        "horizon": "5+ years", "volatility": "10–15%", "max_drawdown": "15–20%",
        "suitability": "Maximizes growth potential through higher equity allocation across all cap segments, suitable for investors with a long-term horizon and higher risk tolerance.",
        "eq_lo": 80, "eq_hi": 87, "debt_lo": 8, "debt_hi": 23,
        "cap_large": 35, "cap_mid": 33, "cap_small": 32,
        "debt_tiers": [1, 2, 3, 4, 5], "hybrid_tiers": [2, 3, 4],
        "allowed_equity_cats": None,
        "max_debt_funds": 1,
        "eq_per_cat": 2, "hyb_per_cat": 1,
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
        # Max 3 hybrids total, 1 per category — only high-equity hybrids allowed
        "hyb_cat_limits": {
            "India Fund Dynamic Asset Allocation":   1,
            "India Fund Aggressive Allocation":      1,
            "India Fund Equity Savings - Aggressive":1,
            "India Fund Balanced Allocation":        0,
            "India Fund Multi Asset Allocation":     0,
            "India Fund Equity Savings":             0,
            "India Fund Equity Savings - Conservative": 0,
            "India Fund Conservative Allocation":    0,
            "India Fund Arbitrage Fund":             0,
        },
    },
}

MIN_FUNDS = 9
MAX_FUNDS = 11
MIN_W_TIGHT = 5.0
MIN_W_LOOSE = 3.0
FUND_COUNT_THRESHOLD = 11

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

# Per-fund cap: min(100/6, 20%) = 16.67% (doc Section 9)
PER_FUND_CAP = round(100.0 / 6, 4)   # 16.6667%
PER_FUND_CAP_FRAC = PER_FUND_CAP / 100.0

# AMC cap: 30% (doc Section 9, down from 35%)
FUND_HOUSE_CAP = 30.0
AMC_CAP = 0.30


def _s(v):
    try: return float(v) if v is not None else None
    except: return None

def _sf(v, d=0.0):
    r = _s(v); return r if r is not None else d


# ── Fund eligibility filter ─────────────────────────────────────────────────────
def _is_eligible(f):
    """
    Fund must have:
      - return_3y present
      - At least one CY2021–CY2025 return present
    (doc: must have 3Y data; 5Y not required)
    """
    if _s(f.get("return_3y")) is None:
        return False
    cy_fields = ["return_cy2021", "return_cy2022", "return_cy2023",
                 "return_cy2024", "return_cy2025"]
    if not any(_s(f.get(c)) is not None for c in cy_fields):
        return False
    return True


# ── Largest-remainder weight rounding ──────────────────────────────────────────
def _round_weights_lr(weights_pct, per_fund_cap_pct=PER_FUND_CAP, amc_cap_pct=FUND_HOUSE_CAP, funds=None):
    """
    Largest-remainder rounding to whole-percentage weights.
    Respects per-fund cap and (if funds provided) AMC cap.
    Returns list of integer weights summing to 100.
    If no valid integer solution exists, returns original rounded-to-1dp weights.
    """
    active = [(i, w) for i, w in enumerate(weights_pct) if w > 0]
    if not active:
        return [round(w, 1) for w in weights_pct]

    n = len(weights_pct)
    floors = [int(w) for w in weights_pct]
    remainders = [(weights_pct[i] - floors[i], i) for i in range(n)]
    total_floor = sum(floors)
    remainder_needed = 100 - total_floor

    # Distribute remainders by largest-remainder rule
    remainders_sorted = sorted(remainders, key=lambda x: -x[0])
    result = floors[:]
    for k in range(min(remainder_needed, len(remainders_sorted))):
        idx = remainders_sorted[k][1]
        result[idx] += 1

    # Validate caps — if violated, fall back to 1dp
    for i, w in enumerate(result):
        if w > per_fund_cap_pct + 0.5:  # +0.5 tolerance for rounding
            return [round(w, 1) for w in weights_pct]

    if funds and result:
        from collections import defaultdict
        amc_totals = defaultdict(int)
        for i, f in enumerate(funds):
            amc = (f.get("branding_name") or "").strip()
            if amc:
                amc_totals[amc] += result[i]
        for amc, total in amc_totals.items():
            if total > amc_cap_pct + 0.5:
                return [round(w, 1) for w in weights_pct]

    return result


# ── Liquid/Overnight exclusivity ───────────────────────────────────────────────
def _enforce_liquid_overnight_exclusivity(result_funds):
    """
    Doc: portfolio may hold Liquid OR Overnight, not both.
    If both present, drop the smaller-weighted one.
    """
    LIQUID_CAT = "India OE Liquid"
    OVERNIGHT_CAT = "India OE Overnight"

    liquid = [(i, f) for i, f in enumerate(result_funds) if f.get("category") == LIQUID_CAT]
    overnight = [(i, f) for i, f in enumerate(result_funds) if f.get("category") == OVERNIGHT_CAT]

    if liquid and overnight:
        liq_w = sum(f["weight"] for _, f in liquid)
        ovn_w = sum(f["weight"] for _, f in overnight)
        # Drop the smaller sleeve
        drop_indices = set(i for i, _ in (overnight if liq_w >= ovn_w else liquid))
        result_funds = [f for i, f in enumerate(result_funds) if i not in drop_indices]
        # Renormalise
        total = sum(f["weight"] for f in result_funds)
        if total > 0:
            for f in result_funds:
                f["weight"] = round(f["weight"] * 100 / total, 1)
        logger.info(f"Liquid/Overnight exclusivity: dropped {'overnight' if liq_w >= ovn_w else 'liquid'} fund(s)")

    return result_funds


def _solve(funds, eq_lo, eq_hi, debt_lo, debt_hi,
           cap_large, cap_mid, cap_small,
           cap_tol=CAP_TOL, max_w=MAX_W,
           gold_isins=None, gold_lo=0, gold_hi=0,
           fund_house_cap=FUND_HOUSE_CAP):
    """
    Pure feasibility LP via HiGHS. Returns weight array (sums to 100) or None.
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

    if gold_isins and gold_lo > 0:
        gold_mask = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in funds])
        if gold_mask.sum() > 0:
            A_ub.append(-gold_mask); b_ub.append(-gold_lo)
            A_ub.append( gold_mask); b_ub.append( gold_hi)

    from collections import defaultdict
    house_to_indices = defaultdict(list)
    for i, f in enumerate(funds):
        house = (f.get("branding_name") or "").strip()
        if house:
            house_to_indices[house].append(i)
    for house, idxs in house_to_indices.items():
        if len(idxs) > 1:
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


def _solve_with_retry(funds, m, gold_isins=None):
    """
    Two-pass LP fallback. See rulebook Section 7.
    """
    cap_l, cap_m, cap_s = m["cap_large"], m["cap_mid"], m["cap_small"]
    base_tol = m.get("cap_tol", CAP_TOL)
    min_funds = m.get("min_funds", MIN_FUNDS)
    max_funds = m.get("max_funds", MAX_FUNDS)
    gold_lo = m.get("gold_fixed", m.get("gold_lo", 0))
    gold_hi = gold_lo  # fixed allocation in LP fallback too

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

    A_ub_p1 = [-eq_pct/100, eq_pct/100, -debt_pct/100, debt_pct/100]
    b_ub_p1 = [-m["eq_lo"], m["eq_hi"], -m["debt_lo"], m["debt_hi"]]

    if gold_isins and gold_lo > 0:
        gold_mask = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in funds])
        if gold_mask.sum() > 0:
            A_ub_p1.append(-gold_mask); b_ub_p1.append(-gold_lo)
            A_ub_p1.append( gold_mask); b_ub_p1.append( gold_hi)

    from collections import defaultdict
    house_map = defaultdict(list)
    for i, f in enumerate(funds):
        house = (f.get("branding_name") or "").strip()
        if house:
            house_map[house].append(i)
    for house, idxs in house_map.items():
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
                return np.round(w, 2), 999

    for tol in [base_tol, base_tol+3, base_tol+6, base_tol+10, base_tol+15]:
        w = _solve(funds, m["eq_lo"], m["eq_hi"], m["debt_lo"], m["debt_hi"],
                   cap_l, cap_m, cap_s, tol, MAX_W,
                   gold_isins=gold_isins, gold_lo=gold_lo, gold_hi=gold_hi,
                   fund_house_cap=FUND_HOUSE_CAP)
        if w is not None:
            return w, tol

    w = _solve(funds, m["eq_lo"]-5, m["eq_hi"]+5, m["debt_lo"]-5, m["debt_hi"]+5,
               cap_l, cap_m, cap_s, base_tol+20, MAX_W,
               gold_isins=gold_isins, gold_lo=gold_lo, gold_hi=gold_hi,
               fund_house_cap=FUND_HOUSE_CAP)
    return (w, base_tol+20) if w is not None else (None, None)


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — BLACK-LITTERMAN + CVaR-LP OPTIMIZATION
# ══════════════════════════════════════════════════════════════════════════════

RISK_FREE_RATE = 6.5
MIN_YEARS      = 3
TARGET_FUNDS_LO = 8
TARGET_FUNDS_HI = 11

DELTA = 2.5
TAU   = 0.05
CVAR_ALPHA  = 0.95
RETURN_LAMBDA = 0.5   # soft return preference weight in CVaR-LP objective

CORR_CAP_THRESHOLD = 0.95
CORR_CAP_LIMIT     = 0.40
CRISIS_BASE_SHOCK  = 55
SAMPLE_COV_WEEKS   = 260   # weeks of NAV history used for sample covariance

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

DEFAULT_HOUSE_VIEW = {
    'equity':    'Overweight',
    'debt':      'Neutral',
    'gold':      'Moderate Overweight',
    'smallcap':  'Selective',
    'midcap':    'Moderate Overweight',
}


def _fetch_nav_data(isins: list, db) -> dict:
    from sqlalchemy import text
    from datetime import date as date_type, timedelta
    from collections import defaultdict

    if not isins:
        return {}

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
        if len(series) < 756:
            continue

        # Weekly returns — last NAV of each ISO week
        from collections import OrderedDict
        weeks = OrderedDict()
        for d, v in series:
            wk_key = d.isocalendar()[:2]
            if wk_key not in weeks:
                weeks[wk_key] = v
            weeks[wk_key] = v   # keep last NAV of the week

        wk_navs = list(weeks.values())
        weekly_ret = np.array([
            wk_navs[i] / wk_navs[i-1] - 1
            for i in range(1, len(wk_navs))
            if wk_navs[i-1] > 0
        ])

        if len(weekly_ret) >= 156:
            result[isin] = {
                'weekly_returns': weekly_ret,
                'n_weeks': len(weekly_ret),
            }

    return result


def _apply_category_proxy(nav_data, funds, target_weeks=260):
    isin_to_cat = {f['isin']: f.get('category', '') for f in funds}
    cat_full_weekly = {}
    for isin, data in nav_data.items():
        if data['n_weeks'] >= target_weeks:
            cat = isin_to_cat.get(isin, '')
            if cat not in cat_full_weekly:
                cat_full_weekly[cat] = []
            cat_full_weekly[cat].append(data['weekly_returns'][-target_weeks:])

    cat_avg_weekly = {}
    for cat, arrays in cat_full_weekly.items():
        if len(arrays) >= 2:
            cat_avg_weekly[cat] = np.mean(np.array(arrays), axis=0)

    proxied = 0
    for isin, data in nav_data.items():
        n = data['n_weeks']
        if n >= target_weeks:
            continue
        cat = isin_to_cat.get(isin, '')
        proxy = cat_avg_weekly.get(cat)
        if proxy is None:
            for known_cat, avg in cat_avg_weekly.items():
                if known_cat[:12] == cat[:12]:
                    proxy = avg
                    break
        if proxy is None:
            continue
        missing = target_weeks - n
        extended = np.concatenate([proxy[:missing], data['weekly_returns'][-n:]])
        nav_data[isin]['weekly_returns'] = extended
        nav_data[isin]['n_weeks'] = target_weeks
        proxied += 1

    if proxied > 0:
        logger.info(f"Category proxy applied to {proxied} funds with short history")
    return nav_data


def _sample_covariance(nav_data, isins, n_weeks=SAMPLE_COV_WEEKS):
    """
    Simple equal-weighted sample covariance from weekly NAV returns.
    Each (i,j) pair uses the common overlapping window (most recent n_weeks).
    Annualised by multiplying by 52.
    No EWMA decay, no shrinkage — straightforward and transparent.
    """
    N = len(isins)
    Sigma = np.zeros((N, N))

    for i in range(N):
        wr_i = nav_data[isins[i]]['weekly_returns']
        for j in range(i, N):
            wr_j = nav_data[isins[j]]['weekly_returns']
            T_ij = min(len(wr_i), len(wr_j), n_weeks)
            ri = wr_i[-T_ij:]
            rj = wr_j[-T_ij:]
            cov = float(np.cov(ri, rj, ddof=1)[0, 1] if i != j else np.var(ri, ddof=1))
            Sigma[i, j] = cov * 52   # annualise
            Sigma[j, i] = Sigma[i, j]

    return Sigma


def _black_litterman_posterior(pi, Sigma, tau, P, Q, Omega):
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

        p_tau_sigma = (tau * Sigma) @ row
        quad_form = float(row @ p_tau_sigma)
        omega_diag.append((1.0 / params['confidence'] - 1.0) * quad_form)

    if not P_rows:
        return None, None, None

    return np.array(P_rows), np.array(Q_vals), np.diag(omega_diag)


def _cvar_lp(scenario_returns, alpha, upper_bounds, add_A, add_b, add_sense,
             return_bonus=None):
    """
    CVaR-LP (Rockafellar-Uryasev).
    return_bonus: optional N-array of BL posterior weekly returns.
                  Added as soft preference in objective: min CVaR - RETURN_LAMBDA * E[r_BL].
                  This steers the solver toward higher-return portfolios without a hard floor.
    Returns dict with status, weights (fractional), cvar.
    """
    from scipy.optimize import linprog

    N, T = scenario_returns.shape
    n_vars = N + 2 + T
    zp, zm = N, N + 1

    def z(t):
        return N + 2 + t

    c = np.zeros(n_vars)
    c[zp] = 1.0
    c[zm] = -1.0
    for t in range(T):
        c[z(t)] = 1.0 / (T * (1 - alpha))

    # Soft return preference: subtract RETURN_LAMBDA * BL_posterior from objective
    # Optimizer accepts more CVaR to gain return — controlled by RETURN_LAMBDA
    if return_bonus is not None:
        for i in range(N):
            c[i] -= RETURN_LAMBDA * float(return_bonus[i])

    A_ub_list, b_ub_list = [], []

    for t in range(T):
        row = np.zeros(n_vars)
        for i in range(N):
            row[i] = -scenario_returns[i, t]
        row[zp] = -1.0
        row[zm] = 1.0
        row[z(t)] = -1.0
        A_ub_list.append(row)
        b_ub_list.append(0.0)

    for i in range(N):
        row = np.zeros(n_vars)
        row[i] = 1.0
        A_ub_list.append(row)
        b_ub_list.append(upper_bounds[i])

    A_eq = np.zeros((1, n_vars))
    A_eq[0, :N] = 1.0
    b_eq = np.array([1.0])

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

    bounds = [(0, ub) for ub in upper_bounds]
    bounds.append((0, None))
    bounds.append((0, None))
    bounds.extend([(0, None)] * T)

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


def _optimize_sharpe(funds, m, gold_isins=None, db=None):
    """
    BL+CVaR-LP entry point.
    Pipeline:
      1. Fetch weekly NAV returns
      2. Sample covariance (equal-weighted, 260 weeks)
      3. BL posterior: equal-weight prior + House View → posterior expected returns
      4. CVaR-LP: minimise tail risk with BL posterior as soft return preference
    Returns (weights_pct, fund_list, method_string, governance_flags).
    """
    governance_flags = []

    logger.info(f"BL+CVaR starting for {len(funds)} candidates")

    if db is None:
        return None, funds, "lp_fallback", governance_flags

    isins = [f.get("isin") for f in funds if f.get("isin")]
    if len(isins) < 3:
        return None, funds, "lp_fallback", governance_flags

    # ── Step 1: Fetch weekly NAV returns ────────────────────────────────────
    nav_data = _fetch_nav_data(isins, db)
    valid_isins = [isin for isin in isins if isin in nav_data]

    if len(valid_isins) < max(3, len(funds) * 0.5):
        logger.warning(f"BL+CVaR: only {len(valid_isins)}/{len(funds)} have NAV data — LP fallback")
        return None, funds, "lp_fallback", governance_flags

    isin_set = set(valid_isins)
    valid_funds = [f for f in funds if f.get("isin") in isin_set]
    valid_isins = [f["isin"] for f in valid_funds]
    N = len(valid_funds)

    # ── Step 2: Category proxy for short-history funds ───────────────────────
    nav_data = _apply_category_proxy(nav_data, valid_funds, target_weeks=260)

    # ── Step 3: Sample covariance from weekly returns (equal-weighted) ───────
    try:
        Sigma = _sample_covariance(nav_data, valid_isins, n_weeks=SAMPLE_COV_WEEKS)
        logger.info(f"Sample covariance: {N}x{N}, annualised weekly returns")
    except Exception as e:
        logger.warning(f"Sample covariance failed: {e} — LP fallback")
        return None, funds, "lp_fallback", governance_flags

    # ── Step 4: Black-Litterman posterior (equal-weight prior) ───────────────
    try:
        # Equal-weight prior — every fund in the pool is treated as equally
        # likely before House View is applied. Avoids AUM bias toward large AMCs.
        w_eq = np.ones(N) / N
        pi = DELTA * Sigma @ w_eq   # equilibrium prior expected returns

        P, Q, Omega = _build_house_view_pq(valid_funds, pi, Sigma, TAU, DEFAULT_HOUSE_VIEW)

        if P is not None:
            posterior_mean, _ = _black_litterman_posterior(pi, Sigma, TAU, P, Q, Omega)
            logger.info(f"BL posterior: {N} funds, {len(P)} views, "
                        f"range=[{posterior_mean.min():.4f}, {posterior_mean.max():.4f}]")
        else:
            posterior_mean = pi.copy()
            logger.info(f"BL: no active views — using equal-weight equilibrium prior")
    except Exception as e:
        logger.warning(f"BL posterior failed: {e} — using equal-weight prior")
        w_eq = np.ones(N) / N
        posterior_mean = DELTA * Sigma @ w_eq

    # Convert annualised BL posterior to weekly scale for CVaR-LP objective
    posterior_weekly = (1 + posterior_mean) ** (1 / 52) - 1

    # ── Build constraints ──────────────────────────────────────────────────────
    gold_isins_set = gold_isins or set()
    gold_fixed = m.get("gold_fixed", 0)  # fixed allocation %

    # Per-fund cap: 16.67% for all profiles (doc)
    upper_bounds = [PER_FUND_CAP_FRAC] * N

    add_A, add_b, add_sense, add_tag = [], [], [], []

    def _add(row, b, sense, tag):
        add_A.append(row); add_b.append(b); add_sense.append(sense); add_tag.append(tag)

    def get_eq_pct_frac(f):
        v = _s(f.get("equity_pct"))
        if v is not None and v > 0: return v / 100
        return 1.0 if f["asset_class"] == "Equity" else 0.0

    def get_debt_pct_frac(f):
        if f["asset_class"] == "Debt": return 1.0
        if f.get("category") == "India Fund Arbitrage Fund": return 1.0
        v = _s(f.get("bond_pct"))
        return v / 100 if v is not None and v > 0 else 0.0

    # Equity band
    eq_row = [get_eq_pct_frac(f) for f in valid_funds]
    _add(eq_row, m["eq_lo"] / 100, '>=', 'equity')
    _add(eq_row, m["eq_hi"] / 100, '<=', 'equity')

    # Debt band
    debt_row = [get_debt_pct_frac(f) for f in valid_funds]
    _add(debt_row, m["debt_lo"] / 100, '>=', 'debt')
    _add(debt_row, m["debt_hi"] / 100, '<=', 'debt')

    # Cap mix — Large/Mid/Small (linearised ratio constraint, same as LP fallback)
    # Only funds where L+M+S > 1 participate — funds with missing cap data are excluded
    cap_l  = m["cap_large"]
    cap_m  = m["cap_mid"]
    cap_s  = m["cap_small"]
    cap_tol = m.get("cap_tol", CAP_TOL)
    large  = np.array([_sf(f.get("large_cap")) for f in valid_funds])
    mid    = np.array([_sf(f.get("mid_cap"))   for f in valid_funds])
    small  = np.array([_sf(f.get("small_cap")) for f in valid_funds])
    eq_wt  = np.array([get_eq_pct_frac(f)      for f in valid_funds])

    # Mask: only include funds with genuine cap data
    has_cap = (large + mid + small) > 1
    if has_cap.sum() >= 2:
        def _cap_row(target, tol, sign):
            # sign=+1 → upper bound, sign=-1 → lower bound
            row = np.zeros(N)
            for i in range(N):
                if has_cap[i]:
                    row[i] = sign * eq_wt[i] * (large[i] - (target + sign * tol)) if False else \
                             eq_wt[i] * (large[i] - (target + sign * tol))
            return row

        # Large cap lower: eq_wt*(L - (cap_l - tol)) >= 0  →  -(eq_wt*(L-(cap_l-tol))) <= 0
        row_lo_l = np.array([-eq_wt[i] * (large[i] - (cap_l - cap_tol)) if has_cap[i] else 0.0 for i in range(N)])
        row_hi_l = np.array([ eq_wt[i] * (large[i] - (cap_l + cap_tol)) if has_cap[i] else 0.0 for i in range(N)])
        row_lo_m = np.array([-eq_wt[i] * (mid[i]   - (cap_m - cap_tol)) if has_cap[i] else 0.0 for i in range(N)])
        row_hi_m = np.array([ eq_wt[i] * (mid[i]   - (cap_m + cap_tol)) if has_cap[i] else 0.0 for i in range(N)])
        row_lo_s = np.array([-eq_wt[i] * (small[i] - (cap_s - cap_tol)) if has_cap[i] else 0.0 for i in range(N)])
        row_hi_s = np.array([ eq_wt[i] * (small[i] - (cap_s + cap_tol)) if has_cap[i] else 0.0 for i in range(N)])

        _add(row_lo_l.tolist(), 0, '<=', 'cap_mix')
        _add(row_hi_l.tolist(), 0, '<=', 'cap_mix')
        _add(row_lo_m.tolist(), 0, '<=', 'cap_mix')
        _add(row_hi_m.tolist(), 0, '<=', 'cap_mix')
        _add(row_lo_s.tolist(), 0, '<=', 'cap_mix')
        _add(row_hi_s.tolist(), 0, '<=', 'cap_mix')
        logger.info(f"Cap mix constraints added: L={cap_l}±{cap_tol} M={cap_m}±{cap_tol} S={cap_s}±{cap_tol}")

    # Gold — fixed allocation (equality if funds available, else skip)
    if gold_fixed > 0:
        gold_row = [1.0 if f.get("isin") in gold_isins_set else 0.0 for f in valid_funds]
        if any(g > 0 for g in gold_row):
            _add(gold_row, gold_fixed / 100, '=', 'gold')
        else:
            logger.warning(f"Gold funds not in NAV data — skipping gold constraint for {m['label']}")

    # Silver ≤ 30% of precious metals sleeve (doc)
    silver_row = [1.0 if (f.get("isin") in gold_isins_set and
                          "silver" in (f.get("category") or "").lower())
                  else 0.0 for f in valid_funds]
    gold_total_row = [1.0 if f.get("isin") in gold_isins_set else 0.0 for f in valid_funds]
    if any(s > 0 for s in silver_row) and any(g > 0 for g in gold_total_row):
        combined = [silver_row[i] - 0.30 * gold_total_row[i] for i in range(N)]
        _add(combined, 0.0, '<=', 'gold')

    # AMC cap 30%
    from collections import defaultdict
    amc_map = {}
    for f in valid_funds:
        amc = (f.get("branding_name") or f.get("name", "").split(" ")[0] or "").strip()
        if amc:
            amc_map[f["isin"]] = amc
    unique_amcs = set(amc_map.values())
    for amc in unique_amcs:
        row = [1.0 if amc_map.get(f["isin"]) == amc else 0.0 for f in valid_funds]
        _add(row, AMC_CAP, '<=', 'amc')

    # Correlation cap
    fund_corr_partner = {}
    for ci in range(N):
        for cj in range(ci + 1, N):
            wr_i = nav_data[valid_isins[ci]]['weekly_returns']
            wr_j = nav_data[valid_isins[cj]]['weekly_returns']
            min_w = min(len(wr_i), len(wr_j))
            if min_w >= 156:
                corr = float(np.corrcoef(wr_i[-min_w:], wr_j[-min_w:])[0, 1])
                if corr > CORR_CAP_THRESHOLD:
                    for idx, isin in [(ci, valid_isins[ci]), (cj, valid_isins[cj])]:
                        other_idx = cj if idx == ci else ci
                        if isin not in fund_corr_partner or corr > fund_corr_partner[isin][1]:
                            fund_corr_partner[isin] = (other_idx, corr, ci, cj)

    added_pairs = set()
    for isin, (other_idx, corr, ci, cj) in fund_corr_partner.items():
        pair_key = (min(ci, cj), max(ci, cj))
        if pair_key not in added_pairs:
            row = [0.0] * N
            row[ci] = 1.0; row[cj] = 1.0
            _add(row, CORR_CAP_LIMIT, '<=', 'corr')
            added_pairs.add(pair_key)

    # Down-capture ceiling
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
            _add(dncap_row, 0, '<=', 'soft')

    # Crisis drawdown ceiling
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
            _add(crisis_row, abs(stress_ceil), '<=', 'soft')

    # Mid+small portfolio look-through ceiling (doc Section 9)
    mid_small_ceil = m.get("mid_small_ceiling")
    if mid_small_ceil is not None:
        ms_row = []
        has_ms_data = False
        for f in valid_funds:
            eq_frac = get_eq_pct_frac(f)
            mid_pct = _sf(f.get("mid_cap")) / 100
            small_pct = _sf(f.get("small_cap")) / 100
            if mid_pct + small_pct > 0:
                has_ms_data = True
            ms_row.append(eq_frac * (mid_pct + small_pct))
        if has_ms_data:
            _add(ms_row, mid_small_ceil / 100, '<=', 'soft')

    # Debt credit quality floor (doc Section 9)
    # min_aaa_aa_pct: minimum % of debt sleeve that must be AAA or AA rated
    # Proxy: funds in tier 1 and tier 2 (Corporate Bond, Govt, Banking PSU etc) are AAA+AA
    # Credit Risk (tier 4) funds are NOT AAA/AA
    min_aaa_aa = m.get("min_aaa_aa_pct")
    if min_aaa_aa is not None:
        # Identify non-investment-grade debt (Credit Risk category)
        credit_risk_isins = {f.get("isin") for f in valid_funds
                             if f.get("category") == "India OE Credit Risk"}
        if credit_risk_isins:
            # constraint: sum of credit risk weight within debt sleeve <= (1 - min_aaa_aa/100) * total debt
            # equivalently: credit_row @ w <= (1 - min_aaa_aa/100) * debt_row @ w
            # rearranged: [credit - (1 - min_aaa_aa/100) * debt] @ w <= 0
            min_frac = min_aaa_aa / 100
            cr_row = []
            for f in valid_funds:
                is_cr = f.get("isin") in credit_risk_isins
                d_frac = get_debt_pct_frac(f)
                cr_row.append((1.0 if is_cr else 0.0) * d_frac - (1 - min_frac) * d_frac)
            _add(cr_row, 0.0, '<=', 'soft')

    # Duration ceiling (doc Section 9)
    # Uses modified_duration field from daily_fund_data — skips if data absent
    max_dur = m.get("max_duration")
    if max_dur is not None:
        dur_row = []
        has_dur = False
        for f in valid_funds:
            dur = _s(f.get("modified_duration"))
            d_frac = get_debt_pct_frac(f)
            if dur is not None and d_frac > 0:
                has_dur = True
                dur_row.append(d_frac * (dur - max_dur))
            else:
                dur_row.append(0.0)
        if has_dur and any(v != 0 for v in dur_row):
            _add(dur_row, 0.0, '<=', 'soft')

    # ── Step 5: Build scenario matrix (260 weekly returns) ───────────────────
    target_weeks = 260
    scenario_matrix = np.zeros((N, target_weeks))
    for i, isin in enumerate(valid_isins):
        wr = nav_data[isin]['weekly_returns']
        scenario_matrix[i] = wr[-target_weeks:] if len(wr) >= target_weeks else \
            np.concatenate([np.zeros(target_weeks - len(wr)), wr])

    # ── Step 6: Solve CVaR-LP with BL posterior as soft return preference ────
    # Tags were set explicitly as each constraint was added above:
    #   'equity'  — equity band lo/hi       → never dropped
    #   'debt'    — debt band lo/hi          → never dropped
    #   'gold'    — gold fixed + silver cap  → never dropped
    #   'cap_mix' — Large/Mid/Small bands    → never dropped (until Layer 3)
    #   'amc'     — AMC 30% cap              → dropped in Layer 2
    #   'corr'    — correlation pairs        → dropped in Layer 1
    #   'soft'    — dncap, crisis, duration, credit, mid+small → dropped in Layer 2
    def _filter(tags_to_drop):
        rA, rb, rs = [], [], []
        for i in range(len(add_A)):
            if add_tag[i] not in tags_to_drop:
                rA.append(add_A[i]); rb.append(add_b[i]); rs.append(add_sense[i])
        return rA, rb, rs

    try:
        result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds,
                          add_A, add_b, add_sense,
                          return_bonus=posterior_weekly)

        # Layer 1: drop correlation pairs only
        if result['status'] != 'optimal':
            logger.warning("CVaR-LP infeasible — dropping correlation pairs")
            rA, rb, rs = _filter({'corr'})
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, rA, rb, rs,
                              return_bonus=posterior_weekly)

        # Layer 2: drop AMC cap + soft constraints (keep equity/debt/gold/cap_mix)
        if result['status'] != 'optimal':
            logger.warning("CVaR-LP infeasible — dropping AMC cap and soft constraints")
            rA, rb, rs = _filter({'corr', 'amc', 'soft'})
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, rA, rb, rs,
                              return_bonus=posterior_weekly)
            if result['status'] == 'optimal':
                governance_flags.append({
                    "type": "amc_cap_dropped",
                    "severity": "warning",
                    "message": "AMC concentration cap dropped due to infeasibility.",
                })

        # Layer 3: equity/debt/gold only — drop cap_mix too
        if result['status'] != 'optimal':
            logger.warning("CVaR-LP bare minimum — equity/debt/gold only")
            rA, rb, rs = _filter({'corr', 'amc', 'soft', 'cap_mix'})
            result = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds, rA, rb, rs,
                              return_bonus=posterior_weekly)

        if result['status'] != 'optimal':
            logger.warning("CVaR-LP completely infeasible — LP fallback")
            return None, funds, "lp_fallback", governance_flags

    except Exception as e:
        logger.warning(f"CVaR-LP exception: {e} — LP fallback")
        return None, funds, "lp_fallback", governance_flags

    # ── Step 7: Trim to max_funds ─────────────────────────────────────────────
    weights = result['weights']
    max_funds = m.get("max_funds", TARGET_FUNDS_HI)
    min_holding = m.get("min_holding_pct", 4.0) / 100

    for trim_iter in range(20):
        active = sum(1 for w in weights if w > 0.005)
        if active <= max_funds:
            break
        min_idx = min((i for i in range(N) if weights[i] > 0.005),
                      key=lambda i: weights[i], default=None)
        if min_idx is None:
            break
        upper_bounds[min_idx] = 0
        try:
            r2 = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds,
                          add_A, add_b, add_sense, return_bonus=posterior_weekly)
            if r2['status'] == 'optimal':
                weights = r2['weights']
            else:
                break
        except:
            break

    # ── Step 8: Enforce min_holding ───────────────────────────────────────────
    for min_iter in range(20):
        below = [i for i in range(N) if 0 < weights[i] < min_holding]
        if not below:
            break
        drop_idx = min(below, key=lambda i: weights[i])
        upper_bounds[drop_idx] = 0
        try:
            r2 = _cvar_lp(scenario_matrix, CVAR_ALPHA, upper_bounds,
                          add_A, add_b, add_sense, return_bonus=posterior_weekly)
            if r2['status'] == 'optimal':
                weights = r2['weights']
            else:
                break
        except:
            break

    weights_pct = weights * 100
    logger.info(f"BL+CVaR solved: {sum(1 for w in weights_pct if w > 0.5)} funds, "
                f"CVaR={result.get('cvar', 0):.4f}, flags={len(governance_flags)}")

    return weights_pct, valid_funds, "bl_cvar", governance_flags


def _pick_candidates(eq_pool, debt_pool, hybrid_pool, m):
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
            eq_by_cat[f.get("category", "")].append(f)

    eq_sorted = []
    eq_cat_limits = m.get("eq_cat_limits", {})
    for cat in CORE_EQUITY_CATS:
        if cat in eq_by_cat:
            n = eq_cat_limits.get(cat, m["eq_per_cat"])
            eq_sorted.extend(sorted(eq_by_cat[cat], key=cap_dev)[:n])
    for cat, flist in eq_by_cat.items():
        if cat not in CORE_EQUITY_CATS:
            n = eq_cat_limits.get(cat, m["eq_per_cat"])
            eq_sorted.extend(sorted(flist, key=cap_dev)[:n])

    # ── Debt ──────────────────────────────────────────────────────────────────
    debt_allowed = {c for c, t in DEBT_RISK_TIER.items() if t in m["debt_tiers"]}
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
    hyb_allowed = {c for c, t in HYBRID_RISK_TIER.items() if t in m["hybrid_tiers"]}
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


def _pick_gold_candidates(gold_pool, gold_fixed):
    """
    Pick gold/silver funds by AUM. Silver capped at 30% of precious metals sleeve.
    Returns 1–2 funds (one ETF + one FoF at most).
    """
    if not gold_pool or not gold_fixed:
        return []
    sorted_gold = sorted(gold_pool, key=lambda f: _sf(f.get("fund_size")), reverse=True)
    picked = []
    seen_cats = set()
    for f in sorted_gold:
        cat = (f.get("category") or "").lower()
        broad = "fof" if ("fof" in cat or "fund of fund" in cat) else "etf"
        if broad not in seen_cats:
            seen_cats.add(broad)
            picked.append(f)
        if len(picked) >= 2:
            break
    return picked


def _build_portfolio(model_key, all_funds, db=None):
    m = MODELS[model_key]
    _build_portfolio._db = db

    # Apply fund eligibility filter to non-Precious Metals funds
    eligible_funds = []
    for f in all_funds:
        if f.get("asset_class") == "Precious Metals":
            eligible_funds.append(f)  # gold not filtered by eligibility
        elif _is_eligible(f):
            eligible_funds.append(f)

    eq_pool     = [f for f in eligible_funds
                   if f["asset_class"] == "Equity"
                   and f.get("category") in CORE_EQUITY_CATS]
    debt_pool   = [f for f in eligible_funds if f["asset_class"] == "Debt"]
    hybrid_pool = [f for f in eligible_funds if f["asset_class"] == "Hybrid"]
    gold_pool   = [f for f in eligible_funds if f["asset_class"] == "Precious Metals"]

    gold_fixed = m.get("gold_fixed", 0)
    gold_candidates = _pick_gold_candidates(gold_pool, gold_fixed)

    candidates = _pick_candidates(eq_pool, debt_pool, hybrid_pool, m)

    # Merge gold
    seen, candidates_deduped = set(), []
    for f in candidates + gold_candidates:
        key = f.get("isin") or (f.get("name") or "").strip().lower()
        if key not in seen:
            seen.add(key)
            candidates_deduped.append(f)
    candidates = candidates_deduped

    gold_isins = {f.get("isin") for f in gold_candidates if f.get("isin")}

    original_candidates = candidates
    governance_flags = []

    qp_weights, qp_funds, used_method, gov_flags = _optimize_sharpe(
        candidates, m, gold_isins=gold_isins, db=_build_portfolio._db
    )
    governance_flags.extend(gov_flags)

    qp_active = int(np.sum(qp_weights > 0)) if qp_weights is not None else 0
    qp_accept_threshold = max(6, m.get("min_funds", 6) - 1)

    if qp_weights is not None and qp_active >= qp_accept_threshold:
        weights   = qp_weights
        candidates = qp_funds
        used_tol  = "bl_cvar"
    else:
        logger.info(f"BL+CVaR fallback for {model_key} — using LP")
        candidates = original_candidates
        weights, used_tol = _solve_with_retry(candidates, m, gold_isins=gold_isins)
        if used_tol == 999 or (isinstance(used_tol, int) and used_tol > 0):
            governance_flags.append({
                "type": "bl_cvar_fallback",
                "severity": "info",
                "message": "BL+CVaR insufficient fund count — LP feasibility solver used.",
            })

    # ── Build result list ──────────────────────────────────────────────────────
    result = []
    seen_result = set()
    w_threshold = 1.0 if used_tol in ("sharpe_qp", "bl_cvar") else MIN_W_LOOSE - 0.1
    if weights is not None:
        for f, w in zip(candidates, weights):
            key = f.get("isin") or (f.get("name") or "").strip().lower()
            if w >= w_threshold and key not in seen_result:
                seen_result.add(key)
                sleeve = ("Equity" if f["asset_class"] == "Equity"
                          else "Hybrid" if f["asset_class"] == "Hybrid"
                          else "Gold" if f["asset_class"] == "Precious Metals"
                          else "Debt")
                result.append({**f, "weight": round(float(w), 1), "sleeve": sleeve})
        tot = sum(f["weight"] for f in result)
        if tot > 0:
            for f in result:
                f["weight"] = round(f["weight"] * 100 / tot, 1)

    # ── Liquid/Overnight exclusivity (doc) ────────────────────────────────────
    result = _enforce_liquid_overnight_exclusivity(result)

    # ── Largest-remainder whole-% rounding (doc Section 13) ──────────────────
    if result:
        raw_weights = [f["weight"] for f in result]
        rounded = _round_weights_lr(raw_weights, per_fund_cap_pct=PER_FUND_CAP, funds=result)
        for f, rw in zip(result, rounded):
            f["weight"] = rw
        # Final renorm to ensure sum=100 (rounding may be off by 1)
        tot = sum(f["weight"] for f in result)
        if tot > 0 and abs(tot - 100) > 0.5:
            # Fallback to 1dp if rounding failed
            for f, ow in zip(result, raw_weights):
                f["weight"] = round(ow, 1)

    # ── Output calculations ────────────────────────────────────────────────────
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
    rb_large = round(cap_num_l / cap_den, 1) if cap_den else None
    rb_mid   = round(cap_num_m / cap_den, 1) if cap_den else None
    rb_small = round(cap_num_s / cap_den, 1) if cap_den else None

    def wavg(key):
        vals = [(f["weight"], _sf(f.get(key))) for f in result if _s(f.get(key)) is not None]
        if not vals: return None
        tw = sum(w for w, _ in vals)
        return round(sum(w * v for w, v in vals) / tw, 2) if tw else None

    def wavg_exclude_precious(key):
        vals = [(f["weight"], _sf(f.get(key))) for f in result
                if _s(f.get(key)) is not None
                and f.get("asset_class", "") != "Precious Metals"
                and "gold" not in (f.get("category") or "").lower()
                and "silver" not in (f.get("category") or "").lower()]
        if not vals: return None
        tw = sum(w for w, _ in vals)
        return round(sum(w * v for w, v in vals) / tw, 2) if tw else None

    def wavg_coverage(key):
        total_w = sum(f["weight"] for f in result)
        valid_w = sum(f["weight"] for f in result if _s(f.get(key)) is not None)
        if total_w == 0: return None
        return round(valid_w / total_w * 100, 1)

    EQUITY_CAT_ORDER = [
        "India Fund Large-Cap", "India Fund Large & Mid-Cap", "Cat: Flexi Cap Funds",
        "Cat: Multi Cap Funds", "India Fund Focused Fund", "India Fund Mid-Cap",
        "India Fund Small-Cap", "Cat: Contra / Value Funds",
    ]
    SLEEVE_ORDER = {"Equity": 0, "Hybrid": 1, "Debt": 2, "Gold": 3, "Alternates": 4}

    def sort_key(f):
        sleeve_rank = SLEEVE_ORDER.get(f["sleeve"], 9)
        cat_rank = (EQUITY_CAT_ORDER.index(f.get("category"))
                    if f["sleeve"] == "Equity" and f.get("category") in EQUITY_CAT_ORDER else 0)
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
        "governance_flags": governance_flags,
        "target": {
            "eq_lo": m["eq_lo"], "eq_hi": m["eq_hi"],
            "debt_lo": m["debt_lo"], "debt_hi": m["debt_hi"],
            "large_cap": m["cap_large"], "mid_cap": m["cap_mid"],
            "small_cap": m["cap_small"], "cap_tol": CAP_TOL,
            "gold_fixed": gold_fixed,
            "mid_small_ceiling": m.get("mid_small_ceiling"),
            "min_aaa_aa_pct": m.get("min_aaa_aa_pct"),
            "max_duration": m.get("max_duration"),
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
            "Equity":        round(eff_equity, 1),
            "Debt":          round(eff_debt, 1),
            "Cash & Others": round(eff_other, 1),
            "Gold":          round(sum(f["weight"] for f in result
                                       if f["asset_class"] == "Precious Metals"), 1),
        },
        "blended": {
            "return_1y":      wavg("return_1y"),
            "return_3y":      wavg("return_3y"),
            "return_5y":      wavg("return_5y"),
            "return_1m":      wavg("return_1m"),
            "return_3m":      wavg("return_3m"),
            "return_6m":      wavg("return_6m"),
            "return_ytd":     wavg("return_ytd"),
            "return_cy2021":  wavg("return_cy2021"),
            "return_cy2022":  wavg("return_cy2022"),
            "return_cy2023":  wavg("return_cy2023"),
            "return_cy2024":  wavg("return_cy2024"),
            "return_cy2025":  wavg("return_cy2025"),
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
                "alpha_3y": f.get("alpha_3y"), "std_dev_3y": f.get("std_dev_3y"),
                "std_dev_5y": f.get("std_dev_5y"), "expense_ratio": f.get("expense_ratio"),
                "aum_cr": f.get("fund_size"), "morningstar_rating": f.get("morningstar_rating"),
                "equity_pct": f.get("equity_pct"), "bond_pct": f.get("bond_pct"),
                "large_cap": f.get("large_cap"), "mid_cap": f.get("mid_cap"),
                "small_cap": f.get("small_cap"),
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
               fund_size, amfi_code, nav, morningstar_rating, branding_name,
               modified_duration, avg_credit_quality
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
                results["models"][k] = {
                    "ok": True, "fund_count": p["fund_count"],
                    "method": p.get("used_method", "lp"),
                    "governance_flags": p.get("governance_flags", []),
                }
            except Exception as e:
                results["models"][k] = {"ok": False, "error": str(e),
                                        "trace": traceback.format_exc()}
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
        return {"portfolios": sorted(out, key=lambda x: x["risk_score"]),
                "data_date": str(data_date)}
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