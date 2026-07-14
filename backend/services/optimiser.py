"""
services/optimiser.py
Monte Carlo portfolio optimiser for BugleRock Analytics.

Architecture:
  1. Classify each fund into a sleeve
  2. Fetch weekly NAV returns from nav_history (up to 3Y)
  3. Flag funds with < 1Y data (manual weight required)
  4. Apply IPS constraints as weight bounds
  5. Run Monte Carlo (10,000 simulations)
  6. Return 3 strategies: Max Sharpe, Min Volatility, Max Return
  7. Return efficient frontier points for chart
"""

import numpy as np
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

RISK_FREE_RATE = 0.065  # 6.5% p.a.
MIN_WEIGHT = 0.05       # fallback only — user sets this via Optimise tab (default 5%)
MAX_WEIGHT = 0.40       # fallback only — user sets this via Optimise tab (default 40%)
N_SIMULATIONS = 5000    # fallback only — user sets this via Optimise tab dropdown
MIN_WEEKS_REQUIRED = 52  # 1 year minimum

# ── Sleeve classification ────────────────────────────────────────────────────

EQUITY_LIKE_HYBRID_CATS = {
    "India Fund Aggressive Allocation",
    "India Fund Dynamic Asset Allocation",
    "India Fund Equity Savings - Aggressive",
    "India Fund Equity Savings",
    "India Fund Balanced Allocation",
}

DEBT_LIKE_HYBRID_CATS = {
    "India Fund Equity Savings - Conservative",
    "India Fund Conservative Allocation",
    "India Fund Arbitrage Fund",
}

BALANCED_HYBRID_CATS = {
    "India Fund Multi Asset Allocation",
}

EXCLUDED_CATS = {
    "India Fund Children",
    "India Fund Retirement",
}

PRECIOUS_METALS_CAP = 0.10
EQUITY_PASSIVE_CAP  = 0.10
INTERNATIONAL_CAP   = 0.10
THEMATIC_CAP        = 0.10

THEMATIC_CATS = {
    "Thematic Funds",
    "Cat: Thematic - Quant",
    "Cat: Thematic - Business Cycle",
    "Cat: Banking & Financial Services Funds",
    "Cat: Infrastructure Funds",
    "Cat: Consumption Funds",
    "India Fund Sector - Energy",
    "Cat: IT / Tech Funds",
    "Cat: Healthcare funds",
    "Cat: MNC Funds",
}


SMALL_CAP_CATS = {
    "India Fund Small Cap",
    "India Fund Small-Cap",
    "Cat: Small Cap Funds",
    "Cat: Small-Cap Funds",
    "Small Cap",
    "Small-Cap",
}


def classify_fund(fund: dict) -> str:
    """
    Classify fund into sleeve.
    Returns: equity_active | equity_passive | debt_active | debt_passive |
             hybrid_equity | hybrid_debt | balanced | alternatives | international | excluded
    """
    asset_class = fund.get("asset_class", "")
    category    = fund.get("category", "")

    if asset_class == "SIF":
        return "excluded"
    if asset_class == "Precious Metals":
        return "alternatives"
    if asset_class == "International":
        return "international"
    if asset_class in ("Equity Index", "ETF - Equity"):
        return "equity_passive"
    if asset_class == "ETF - Debt":
        return "debt_passive"
    if asset_class == "Debt":
        return "debt_active"
    if asset_class == "Equity":
        return "equity_active"
    if asset_class == "Hybrid":
        if category in EXCLUDED_CATS:
            return "excluded"
        if category in EQUITY_LIKE_HYBRID_CATS:
            return "hybrid_equity"
        if category in DEBT_LIKE_HYBRID_CATS:
            return "hybrid_debt"
        if category in BALANCED_HYBRID_CATS:
            return "balanced"
        return "hybrid_equity"  # default hybrid → equity-like

    return "equity_active"  # fallback


def sleeve_equity_weight(sleeve: str) -> float:
    """How much does this sleeve count toward the equity allocation?"""
    return {
        "equity_active":  1.0,
        "equity_passive": 1.0,
        "hybrid_equity":  1.0,
        "hybrid_debt":    0.0,
        "balanced":       0.5,
        "debt_active":    0.0,
        "debt_passive":   0.0,
        "alternatives":   0.0,
        "international":  0.0,
        "excluded":       0.0,
    }.get(sleeve, 0.0)


def sleeve_debt_weight(sleeve: str) -> float:
    return {
        "equity_active":  0.0,
        "equity_passive": 0.0,
        "hybrid_equity":  0.0,
        "hybrid_debt":    1.0,
        "balanced":       0.5,
        "debt_active":    1.0,
        "debt_passive":   1.0,
        "alternatives":   0.0,
        "international":  0.0,
        "excluded":       0.0,
    }.get(sleeve, 0.0)


# ── NAV history fetch ────────────────────────────────────────────────────────

def fetch_weekly_returns(isins: List[str], as_of_date: date, lookback_years: int = 3) -> Dict[str, np.ndarray]:
    """
    Fetch weekly NAV returns for all ISINs in ONE query for performance.
    Returns dict of {isin: array of weekly returns}.
    """
    from models.database import SessionLocal, NavHistory
    from sqlalchemy import and_

    start_date = as_of_date - timedelta(days=lookback_years * 365 + 30)
    db = SessionLocal()
    result = {isin: np.array([]) for isin in isins}

    try:
        # Single query for all ISINs
        all_rows = db.query(NavHistory.isin, NavHistory.date, NavHistory.nav).filter(
            NavHistory.isin.in_(isins),
            NavHistory.date >= start_date,
            NavHistory.date <= as_of_date,
            NavHistory.nav != None,
        ).order_by(NavHistory.isin, NavHistory.date.asc()).all()

        # Group by ISIN
        from itertools import groupby
        for isin, rows in groupby(all_rows, key=lambda r: r.isin):
            rows = list(rows)
            if len(rows) < 10:
                continue

            nav_by_date = {r.date: r.nav for r in rows}
            dates = sorted(nav_by_date.keys())

            # Resample to weekly — take every 5th trading day approx (faster than week iteration)
            # Sample every Friday or nearest available
            weekly_navs = []
            i = 0
            while i < len(dates):
                d = dates[i]
                # Find end of this week (Friday = weekday 4)
                days_to_friday = (4 - d.weekday()) % 7
                week_end = d + timedelta(days=days_to_friday)
                # Get last date in this week from our data
                week_dates = [dates[j] for j in range(i, len(dates)) if dates[j] <= week_end]
                if week_dates:
                    last_d = week_dates[-1]
                    weekly_navs.append(nav_by_date[last_d])
                    i += len(week_dates)
                else:
                    i += 1

            if len(weekly_navs) < 10:
                continue

            navs = np.array(weekly_navs, dtype=float)
            returns = (navs[1:] - navs[:-1]) / navs[:-1]
            result[isin] = returns

    finally:
        db.close()

    return result


# ── Constraint builder ───────────────────────────────────────────────────────

def build_weight_bounds(funds: List[dict], manual_weights: Dict[str, float], ips: dict, min_w_override: float = None, max_w_override: float = None, cfg: dict = None) -> List[Tuple[float, float]]:
    """
    Build (min, max) weight bounds for each fund.
    Manual funds are fixed at their weight.
    Sleeve caps are PORTFOLIO-LEVEL — the total weight of all funds in a sleeve
    cannot exceed the cap, regardless of how many funds are in that sleeve.
    """
    # Count optimisable funds per sleeve group (excluding manual)
    sleeve_groups: Dict[str, List[str]] = {}
    for fund in funds:
        isin = fund["isin"]
        if isin in manual_weights:
            continue
        sleeve = classify_fund(fund)
        category = fund.get("category", "")

        # Determine which portfolio-level cap applies
        if sleeve == "alternatives":
            group = "alternatives"
        elif sleeve == "equity_passive":
            group = "equity_passive"
        elif sleeve == "international":
            group = "international"
        elif category in THEMATIC_CATS:
            group = "thematic"
        else:
            group = None  # no group cap, only per-fund cap

        if group:
            sleeve_groups.setdefault(group, []).append(isin)

    # Portfolio-level caps
    _cfg = cfg or {}
    GROUP_CAPS = {
        "alternatives":   _cfg.get("cap_precious",      PRECIOUS_METALS_CAP),
        "equity_passive": _cfg.get("cap_passive",       EQUITY_PASSIVE_CAP),
        "international":  _cfg.get("cap_international", INTERNATIONAL_CAP),
        "thematic":       _cfg.get("cap_thematic",      THEMATIC_CAP),
    }

    # Per-fund max for each group = cap / number of funds in that group
    # This ensures total sleeve exposure cannot exceed the cap even if all funds
    # hit their individual maximum simultaneously
    group_per_fund_max: Dict[str, float] = {}
    for group, isins in sleeve_groups.items():
        cap = GROUP_CAPS[group]
        n = len(isins)
        # Each fund gets an equal share of the sleeve cap as its maximum
        # e.g. 2 precious metals funds → each capped at 5% (10% / 2)
        group_per_fund_max[group] = cap / n

    # Build isin → group lookup
    isin_group: Dict[str, str] = {}
    for group, isins in sleeve_groups.items():
        for isin in isins:
            isin_group[isin] = group

    # Detect sleeve overcrowding — warn when cap/n < effective min weight
    min_w_eff = min_w_override if min_w_override is not None else MIN_WEIGHT
    sleeve_warnings = []
    for group, isins in sleeve_groups.items():
        cap = GROUP_CAPS[group]
        n = len(isins)
        per_fund = cap / n
        if per_fund < min_w_eff:
            sleeve_warnings.append({
                "group": group,
                "n_funds": n,
                "cap_pct": round(cap * 100, 1),
                "per_fund_pct": round(per_fund * 100, 2),
                "min_weight_pct": round(min_w_eff * 100, 1),
                "message": (
                    f"{n} funds in '{group}' sleeve exceed the {round(cap*100,0):.0f}% portfolio cap. "
                    f"Each fund is capped at {round(per_fund*100,2):.2f}%, "
                    f"below the {round(min_w_eff*100,1):.1f}% minimum weight. "
                    f"Consider removing some {group} funds."
                )
            })

    bounds = []
    for fund in funds:
        isin = fund["isin"]
        if isin in manual_weights:
            w = manual_weights[isin] / 100.0
            bounds.append((w, w))
            continue

        max_w = max_w_override if max_w_override is not None else MAX_WEIGHT

        # Apply portfolio-level sleeve cap (divided equally across funds in sleeve)
        group = isin_group.get(isin)
        if group:
            max_w = min(max_w, group_per_fund_max[group])

        # Soft override: lower min to match max when overcrowded
        min_w_base = min_w_override if min_w_override is not None else MIN_WEIGHT
        min_w = min(min_w_base, max_w)

        bounds.append((min_w, max_w))

    return bounds, sleeve_warnings


# ── Monte Carlo engine ───────────────────────────────────────────────────────

def run_monte_carlo(
    funds: List[dict],
    returns_map: Dict[str, np.ndarray],
    manual_weights: Dict[str, float],
    ips: dict,
    n_sims: int = N_SIMULATIONS,
    config: dict = None,
) -> dict:
    """
    Run Monte Carlo optimisation.
    Returns strategies, frontier points, and sleeve summary.
    """
    cfg         = config or {}
    min_w_user  = cfg.get("min_w", MIN_WEIGHT)   # fraction e.g. 0.05
    max_w_user  = cfg.get("max_w", MAX_WEIGHT)   # fraction e.g. 0.40
    max_vol_cap = cfg.get("max_vol")              # % e.g. 16.0 or None
    objective   = cfg.get("objective", "max_sharpe")
    # Separate optimisable vs manual funds
    opt_funds  = [f for f in funds if f["isin"] not in manual_weights]
    manual_sum = sum(manual_weights.values()) / 100.0  # fraction already allocated

    if not opt_funds:
        return {"error": "All funds are manual — nothing to optimise"}

    # Build aligned returns matrix
    valid_isins = []
    returns_list = []
    for f in opt_funds:
        isin = f["isin"]
        rets = returns_map.get(isin, np.array([]))
        if len(rets) >= MIN_WEEKS_REQUIRED:
            valid_isins.append(isin)
            returns_list.append(rets)

    if not valid_isins:
        return {"error": "No funds have sufficient NAV history for optimisation"}

    # Align lengths — use shortest common period
    min_len = min(len(r) for r in returns_list)
    aligned = np.array([r[-min_len:] for r in returns_list])  # shape: (n_funds, n_weeks)

    # Annualised expected returns and covariance
    mu  = np.mean(aligned, axis=1) * 52       # annualised mean
    cov = np.cov(aligned) * 52                 # annualised covariance

    n_funds = len(valid_isins)
    remaining = 1.0 - manual_sum  # fraction available for optimisation

    # Build bounds for optimisable funds
    # Build bounds using user-specified min/max weight
    opt_fund_objs = [f for f in opt_funds if f["isin"] in valid_isins]
    bounds, sleeve_warnings = build_weight_bounds(opt_fund_objs, {}, ips, min_w_override=min_w_user, max_w_override=max_w_user, cfg=cfg)
    if sleeve_warnings:
        logger.warning(f"Sleeve overcrowding: {[w['message'] for w in sleeve_warnings]}")

    # IPS sleeve constraints
    equity_min = ips.get("equity", {}).get("min", 0) / 100.0
    equity_max = ips.get("equity", {}).get("max", 100) / 100.0
    debt_min   = ips.get("debt", {}).get("min", 0) / 100.0
    debt_max   = ips.get("debt", {}).get("max", 100) / 100.0

    # Commodities and global allocation from config
    comm_min  = (cfg.get("minComm")  or 0)   / 100.0
    comm_max  = (cfg.get("maxComm")  or 100) / 100.0
    intl_min  = (cfg.get("minIntl")  or 0)   / 100.0
    intl_max  = (cfg.get("maxIntl")  or 100) / 100.0

    sleeves   = [classify_fund(f) for f in opt_fund_objs]
    eq_wts    = np.array([sleeve_equity_weight(s) for s in sleeves])
    dt_wts    = np.array([sleeve_debt_weight(s) for s in sleeves])
    comm_wts  = np.array([1.0 if s == "alternatives"  else 0.0 for s in sleeves])
    intl_wts  = np.array([1.0 if s == "international" else 0.0 for s in sleeves])

    # Small cap — characteristic-weighted portfolio constraint
    # Step 1: Fund-level normalize L+M+S to 100% (removes cash/debt drag)
    # Step 2: Portfolio-level rebase to funds with data only (null = exclude, 0 = include)
    sc_fund_data = []
    for f in opt_fund_objs:
        sc_pct = f.get("small_cap_pct")
        lc_pct = f.get("large_cap_pct")
        mc_pct = f.get("mid_cap_pct")
        if sc_pct is None:
            sc_fund_data.append(None)
        else:
            try:
                sc = float(sc_pct)
                lc = float(lc_pct) if lc_pct is not None else 0.0
                mc = float(mc_pct) if mc_pct is not None else 0.0
                lms_sum = lc + mc + sc
                if lms_sum > 0:
                    # Normalize to 100% at fund level
                    sc_norm = sc / lms_sum
                else:
                    sc_norm = 0.0
                sc_fund_data.append(sc_norm)
            except (ValueError, TypeError):
                sc_fund_data.append(None)

    has_sc_data = any(v is not None for v in sc_fund_data)

    # sc_wts: for funds with data use actual value; for null funds use 0
    # The filter will rebase weights of null funds out of the calculation
    sc_wts = np.array([v if v is not None else 0.0 for v in sc_fund_data])

    # sc_rebase_wts: 1.0 for funds with data, 0.0 for null funds
    # Used to compute the sum of weights that have data → rebase denominator
    sc_rebase_wts = np.array([1.0 if v is not None else 0.0 for v in sc_fund_data])

    has_sc   = has_sc_data
    _max_sc  = cfg.get("max_sc")
    sc_max   = (_max_sc / 100.0) if _max_sc is not None else 1.0

    logger.info(f"Small cap filter: has_sc={has_sc}, sc_max={sc_max}, funds_with_data={sum(1 for v in sc_fund_data if v is not None)}/{len(sc_fund_data)}")
    logger.info(f"SC exposure per fund: {[(f.get('name','')[:20], round(v*100,1) if v is not None else 'null') for f, v in zip(opt_fund_objs, sc_fund_data)]}")

    # Monte Carlo
    all_weights  = []
    all_returns  = []
    all_vols     = []
    all_sharpes  = []

    # Pre-compute bias vectors for objective-driven sampling
    # For max_return: bias toward funds with higher historical returns
    # For min_volatility: bias toward funds with lower volatility
    # For max_sharpe: uniform (unbiased)
    mu_arr   = np.array(mu)
    vol_arr  = np.array([float(np.sqrt(cov[i][i])) for i in range(len(mu))])

    def biased_sample():
        """Sample weights biased toward the objective — 50% biased, 50% uniform for diversity."""
        if objective == 'max_return' and mu_arr.max() > mu_arr.min():
            # Bias toward higher-return funds
            bias = (mu_arr - mu_arr.min()) / (mu_arr.max() - mu_arr.min() + 1e-9)
            bias = lows + bias * (highs - lows)
            raw = np.random.uniform(lows, highs) if np.random.random() < 0.5 else np.random.uniform(bias * 0.7, highs)
        elif objective == 'min_volatility' and vol_arr.max() > vol_arr.min():
            # Bias toward lower-volatility funds
            bias = 1 - (vol_arr - vol_arr.min()) / (vol_arr.max() - vol_arr.min() + 1e-9)
            bias = lows + bias * (highs - lows)
            raw = np.random.uniform(lows, highs) if np.random.random() < 0.5 else np.random.uniform(lows, bias * 1.3)
        else:
            raw = np.random.uniform(lows, highs)
        return np.clip(raw, lows, highs)

    np.random.seed(None)  # Use random seed so results differ between runs
    attempts = 0
    max_attempts = n_sims * 20

    # Pre-validate: check bounds are feasible (sum of mins <= remaining <= sum of maxs)
    sum_min = sum(lo for lo, hi in bounds)
    sum_max = sum(hi for lo, hi in bounds)
    if sum_min > remaining * 1.001:
        return {"error": f"Minimum weight constraints ({sum_min*100:.0f}%) exceed available allocation ({remaining*100:.0f}%). Reduce the minimum weight per fund or add fewer funds."}
    if sum_max < remaining * 0.999:
        return {"error": f"Maximum weight constraints ({sum_max*100:.0f}%) are too tight to allocate the full portfolio ({remaining*100:.0f}%). Increase the maximum weight per fund."}

    lows  = np.array([lo for lo, hi in bounds])
    highs = np.array([hi for lo, hi in bounds])

    MIN_VALID = max(20, n_sims // 100)  # need at least 1% of target sims
    constraint_warnings = []  # will be populated if any constraint was relaxed

    def run_mc(eq_min, eq_max, dt_min, dt_max, c_min, c_max, i_min, i_max, sc_mx, vol_mx):
        """Run Monte Carlo with given constraints. Returns (weights, returns, vols, sharpes)."""
        ws, rs, vs, ss = [], [], [], []
        att = 0
        while len(ws) < n_sims and att < max_attempts:
            att += 1
            raw = biased_sample()
            w = raw / raw.sum() * remaining
            w = np.clip(w, lows, highs)
            if abs(w.sum() - remaining) > 0.005:
                continue
            total_eq = float(np.dot(w, eq_wts)) + sum(
                manual_weights.get(f["isin"], 0) / 100.0 * sleeve_equity_weight(classify_fund(f))
                for f in funds if f["isin"] in manual_weights
            )
            total_dt = float(np.dot(w, dt_wts)) + sum(
                manual_weights.get(f["isin"], 0) / 100.0 * sleeve_debt_weight(classify_fund(f))
                for f in funds if f["isin"] in manual_weights
            )
            has_equity = any(sleeve_equity_weight(s) > 0 for s in sleeves)
            has_debt   = any(sleeve_debt_weight(s) > 0 for s in sleeves)
            has_comm   = any(s == "alternatives"  for s in sleeves)
            has_intl   = any(s == "international" for s in sleeves)
            if has_equity and not (eq_min <= total_eq <= eq_max): continue
            if has_debt   and not (dt_min <= total_dt <= dt_max): continue
            if has_comm and c_max < 1.0:
                if not (c_min <= float(np.dot(w, comm_wts)) <= c_max): continue
            if has_intl and i_max < 1.0:
                if not (i_min <= float(np.dot(w, intl_wts)) <= i_max): continue
            if has_sc and sc_mx < 1.0:
                weight_with_data = float(np.dot(w, sc_rebase_wts))
                if weight_with_data > 0:
                    rebased_sc = float(np.dot(w, sc_wts)) / weight_with_data
                    if rebased_sc > sc_mx: continue
            port_ret = float(np.dot(w, mu))
            port_var = float(w @ cov @ w)
            port_vol = float(np.sqrt(port_var))
            if vol_mx is not None and port_vol > vol_mx / 100.0: continue
            port_sharpe = (port_ret - RISK_FREE_RATE) / port_vol if port_vol > 0 else 0
            ws.append(w); rs.append(port_ret); vs.append(port_vol); ss.append(port_sharpe)
        return ws, rs, vs, ss

    # --- Step 1: try with all constraints as-is ---
    all_weights, all_returns, all_vols, all_sharpes = run_mc(
        equity_min, equity_max, debt_min, debt_max,
        comm_min, comm_max, intl_min, intl_max, sc_max, max_vol_cap
    )

    # --- Step 2: if too few results, identify and relax constraints one by one ---
    if len(all_weights) < MIN_VALID:
        logger.warning(f"Only {len(all_weights)} valid portfolios — attempting constraint relaxation")

        # Track relaxed values — carry them through each step
        r_eq_min, r_eq_max = equity_min, equity_max
        r_dt_min, r_dt_max = debt_min, debt_max
        r_sc_max = sc_max
        r_vol    = max_vol_cap
        relaxed_ok = False  # flag — stop cascade once we have enough

        # Try relaxing small cap first
        if not relaxed_ok and has_sc and r_sc_max < 1.0:
            test_w, test_r, test_v, test_s = run_mc(
                r_eq_min, r_eq_max, r_dt_min, r_dt_max,
                comm_min, comm_max, intl_min, intl_max, 1.0, r_vol
            )
            if len(test_w) >= max(10, MIN_VALID // 3):
                actual_sc_vals = sorted([
                    float(np.dot(w, sc_wts)) / max(float(np.dot(w, sc_rebase_wts)), 1e-9)
                    for w in test_w
                ])
                p10_idx = max(0, int(len(actual_sc_vals) * 0.10))
                min_feasible_sc = round(actual_sc_vals[p10_idx] * 100, 1)
                r_sc_max = min_feasible_sc / 100.0
                logger.warning(f"Small cap constraint relaxed from {sc_max*100:.0f}% to {min_feasible_sc:.1f}%")
                constraint_warnings.append({
                    "constraint": "small_cap",
                    "label": "Small cap exposure",
                    "requested": round(sc_max * 100, 1),
                    "relaxed_to": min_feasible_sc,
                    "message": f"Small cap exposure cap of {sc_max*100:.0f}% is not achievable with this fund set. Auto-relaxed to {min_feasible_sc:.1f}% — the minimum feasible level given current fund selection."
                })
                all_weights, all_returns, all_vols, all_sharpes = run_mc(
                    r_eq_min, r_eq_max, r_dt_min, r_dt_max,
                    comm_min, comm_max, intl_min, intl_max, r_sc_max, r_vol
                )
                logger.info(f"After sc relaxation: {len(all_weights)} valid portfolios (MIN_VALID={MIN_VALID})")
                if len(all_weights) > 0:
                    relaxed_ok = True

        # Try relaxing max_vol if still too few
        if not relaxed_ok and r_vol is not None:
            test_w, test_r, test_v, test_s = run_mc(
                r_eq_min, r_eq_max, r_dt_min, r_dt_max,
                comm_min, comm_max, intl_min, intl_max, r_sc_max, None
            )
            if len(test_w) >= max(10, MIN_VALID // 3):
                actual_vols = sorted([v * 100 for v in test_v])
                p10_idx = max(0, int(len(actual_vols) * 0.10))
                min_feasible_vol = round(actual_vols[p10_idx], 1)
                r_vol = min_feasible_vol
                constraint_warnings.append({
                    "constraint": "max_vol",
                    "label": "Max portfolio volatility",
                    "requested": max_vol_cap,
                    "relaxed_to": min_feasible_vol,
                    "message": f"Volatility cap of {max_vol_cap:.0f}% is not achievable. Auto-relaxed to {min_feasible_vol:.1f}% — the minimum feasible given current fund selection."
                })
                all_weights, all_returns, all_vols, all_sharpes = run_mc(
                    r_eq_min, r_eq_max, r_dt_min, r_dt_max,
                    comm_min, comm_max, intl_min, intl_max, r_sc_max, r_vol
                )
                if len(all_weights) > 0:
                    relaxed_ok = True

        # Try relaxing equity/debt if still too few
        if not relaxed_ok and (r_eq_min > 0 or r_eq_max < 1.0 or r_dt_min > 0 or r_dt_max < 1.0):
            test_w, test_r, test_v, test_s = run_mc(
                0, 1.0, 0, 1.0,
                comm_min, comm_max, intl_min, intl_max, r_sc_max, r_vol
            )
            if len(test_w) >= max(10, MIN_VALID // 3):
                r_eq_min, r_eq_max = 0, 1.0
                r_dt_min, r_dt_max = 0, 1.0
                constraint_warnings.append({
                    "constraint": "equity_debt",
                    "label": "Equity / Debt allocation",
                    "requested": f"Equity {equity_min*100:.0f}–{equity_max*100:.0f}%, Debt {debt_min*100:.0f}–{debt_max*100:.0f}%",
                    "relaxed_to": "Unconstrained",
                    "message": f"Equity/debt allocation constraints are too tight for this fund set. Auto-relaxed to unconstrained."
                })
                all_weights, all_returns, all_vols, all_sharpes = test_w, test_r, test_v, test_s
                if len(all_weights) > 0:
                    relaxed_ok = True

        # Final fallback — run completely unconstrained
        if not relaxed_ok and len(all_weights) < MIN_VALID:
            logger.warning("All constraints too tight — running unconstrained")
            all_weights, all_returns, all_vols, all_sharpes = run_mc(0, 1.0, 0, 1.0, 0, 1.0, 0, 1.0, 1.0, None)
            constraint_warnings.append({
                "constraint": "all",
                "label": "All constraints",
                "requested": "Multiple",
                "relaxed_to": "Unconstrained",
                "message": "Combination of constraints is infeasible for this fund set. All constraints have been removed. Please review your fund selection and constraint settings."
            })

    if not all_weights:
        return {"error": "Could not generate valid portfolios. Try removing some funds or widening constraints."}

    all_weights = np.array(all_weights)
    all_returns = np.array(all_returns)
    all_vols    = np.array(all_vols)
    all_sharpes = np.array(all_sharpes)

    def build_strategy(idx: int, name: str) -> dict:
        w = all_weights[idx]
        weight_map = {}
        for i, isin in enumerate(valid_isins):
            weight_map[isin] = round(float(w[i]) * 100, 2)
        for isin, mw in manual_weights.items():
            weight_map[isin] = mw
        total = sum(weight_map.values())
        diff = round(100 - total, 2)
        if diff != 0:
            # Spread rounding correction across non-manual funds in small increments
            # so no single fund gets pushed outside its bounds
            adjustable = [isin for isin in weight_map if isin not in manual_weights]
            if adjustable:
                per_fund = round(diff / len(adjustable), 2)
                remainder = diff
                for isin in adjustable:
                    if remainder == 0:
                        break
                    adj = per_fund if abs(per_fund) <= abs(remainder) else remainder
                    weight_map[isin] = round(weight_map[isin] + adj, 2)
                    remainder = round(remainder - adj, 2)
        return {
            "name": name,
            "weights": weight_map,
            "metrics": {
                "return":     round(float(all_returns[idx]) * 100, 2),
                "volatility": round(float(all_vols[idx]) * 100, 2),
                "sharpe":     round(float(all_sharpes[idx]), 3),
            }
        }

    strategies = {
        "max_sharpe":     build_strategy(int(np.argmax(all_sharpes)),  "Max Sharpe"),
        "min_volatility": build_strategy(int(np.argmin(all_vols)),     "Min Volatility"),
        "max_return":     build_strategy(int(np.argmax(all_returns)),  "Max Return"),
    }

    # Scatter dots — 300 random samples for background cloud
    # Each point is [vol, return, sharpe] so frontend can colour by Sharpe
    scatter_idx = np.random.choice(len(all_vols), size=min(300, len(all_vols)), replace=False)
    frontier = [
        [round(float(all_vols[i]) * 100, 2), round(float(all_returns[i]) * 100, 2), round(float(all_sharpes[i]), 3)]
        for i in scatter_idx
    ]

    # Efficient frontier curve — smooth upper envelope
    # Use wider buckets (20) then enforce monotone increasing return
    # so the line never dips back down (matches classic efficient frontier shape)
    vol_min, vol_max = all_vols.min(), all_vols.max()
    n_buckets = 20
    bucket_edges = np.linspace(vol_min, vol_max, n_buckets + 1)
    curve_points = []
    for j in range(n_buckets):
        lo, hi = bucket_edges[j], bucket_edges[j + 1]
        # Use a slightly wider window (overlap 20%) to smooth gaps
        lo_exp = lo - (hi - lo) * 0.2
        hi_exp = hi + (hi - lo) * 0.2
        mask = (all_vols >= lo_exp) & (all_vols < hi_exp)
        if not mask.any():
            continue
        best_ret = all_returns[mask].max()
        mid_vol  = (lo + hi) / 2
        curve_points.append([round(float(mid_vol) * 100, 2), round(float(best_ret) * 100, 2)])
    curve_points.sort(key=lambda p: p[0])
    # Enforce monotone non-decreasing returns (efficient frontier never dips)
    running_max = -np.inf
    monotone = []
    for p in curve_points:
        if p[1] >= running_max:
            running_max = p[1]
            monotone.append(p)
        else:
            monotone.append([p[0], round(running_max, 2)])
    curve_points = monotone

    return {
        "strategies": strategies,
        "frontier": frontier,
        "curve": curve_points,
        "n_valid_simulations": len(all_weights),
        "optimised_isins": valid_isins,
        "sleeve_warnings": sleeve_warnings,
        "constraint_warnings": constraint_warnings,
    }


# ── R1/R2 flag + suggestions ─────────────────────────────────────────────────

def get_ranking_flags(funds: List[dict], date: date) -> List[dict]:
    """Flag non-R1/R2 active funds and suggest alternatives."""
    from models.database import SessionLocal, DailyFundData

    ACTIVE_SLEEVES = {"equity_active", "debt_active", "hybrid_equity", "hybrid_debt"}
    flags = []
    db = SessionLocal()

    try:
        for fund in funds:
            sleeve = classify_fund(fund)
            if sleeve not in ACTIVE_SLEEVES:
                continue
            ranking = fund.get("ranking")
            if ranking in ("R1", "R2"):
                continue

            # Find R1/R2 alternatives in same category — deduplicate by name
            suggestions_raw = db.query(
                DailyFundData.isin,
                DailyFundData.name,
                DailyFundData.ranking,
                DailyFundData.return_1y,
            ).filter(
                DailyFundData.data_date == date,
                DailyFundData.category == fund.get("category"),
                DailyFundData.ranking.in_(["R1", "R2"]),
                DailyFundData.isin != fund["isin"],
            ).order_by(DailyFundData.ranking, DailyFundData.return_1y.desc()).limit(20).all()

            # Deduplicate by AMC+name prefix (same fund, different plans)
            seen_names, suggestions = set(), []
            for s in suggestions_raw:
                # Use first 3 words of name as dedup key
                key = ' '.join(s.name.split()[:3]).lower()
                if key not in seen_names:
                    seen_names.add(key)
                    suggestions.append(s)
                if len(suggestions) == 3:
                    break

            flags.append({
                "isin":     fund["isin"],
                "name":     fund.get("name", ""),
                "ranking":  ranking,
                "issue":    "not_ranked" if not ranking else "low_rank",
                "suggestions": [
                    {"isin": s.isin, "name": s.name, "ranking": s.ranking, "return_1y": s.return_1y}
                    for s in suggestions
                ]
            })
    finally:
        db.close()

    return flags


# ── Main entry point ──────────────────────────────────────────────────────────

def optimise_portfolio(payload: dict) -> dict:
    """
    Main entry point called by the API endpoint.
    """
    logger.info(f"Optimiser started for {len(payload.get('funds', []))} funds")
    funds          = payload["funds"]
    ips            = payload.get("ips", {})
    manual_weights = payload.get("manual_weights", {})
    date_str       = payload.get("date")
    as_of_date     = date.fromisoformat(date_str) if date_str else date.today()
    cfg            = payload.get("config", {})

    # Step 1: Classify all funds
    for fund in funds:
        fund["_sleeve"] = classify_fund(fund)

    # Step 2: Exclude funds that shouldn't be optimised
    excluded = [f for f in funds if f["_sleeve"] == "excluded"]

    # Step 3: Determine which funds need manual weight (< 1Y data)
    all_isins = [f["isin"] for f in funds if f["_sleeve"] != "excluded"]
    returns_map = fetch_weekly_returns(all_isins, as_of_date)

    insufficient = []
    for isin in all_isins:
        rets = returns_map.get(isin, np.array([]))
        if len(rets) < MIN_WEEKS_REQUIRED:
            fund = next((f for f in funds if f["isin"] == isin), None)
            if fund and isin not in manual_weights:
                insufficient.append({
                    "isin":  isin,
                    "name":  fund.get("name", ""),
                    "weeks": len(rets),
                    "message": f"Only {len(rets)} weeks of NAV data — manual weight required"
                })

    # Step 4: Get ranking flags
    ranking_flags = get_ranking_flags(funds, as_of_date)

    # Step 5: Run Monte Carlo with user config
    n_sims = int(cfg.get("n_sims", N_SIMULATIONS))
    logger.info(f"NAV fetch complete. Running Monte Carlo ({n_sims} sims, objective={cfg.get('objective','max_sharpe')})...")
    opt_result = run_monte_carlo(funds, returns_map, manual_weights, ips, n_sims=n_sims, config=cfg)
    logger.info(f"Monte Carlo complete. Valid sims: {opt_result.get('n_valid_simulations', 0)}")

    # Step 6: Build sleeve summary for current weights
    sleeve_summary = {}
    for fund in funds:
        s = fund["_sleeve"]
        sleeve_summary[s] = sleeve_summary.get(s, 0) + fund.get("current_weight", 0)

    return {
        **opt_result,
        "insufficient_data": insufficient,
        "ranking_flags": ranking_flags,
        "excluded_funds": [{"isin": f["isin"], "name": f.get("name", "")} for f in excluded],
        "sleeve_summary": sleeve_summary,
    }