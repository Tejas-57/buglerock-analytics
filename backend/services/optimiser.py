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
MIN_WEIGHT = 0.03       # 3% minimum per fund
MAX_WEIGHT = 0.20       # 20% maximum per fund
N_SIMULATIONS = 10000
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

def build_weight_bounds(funds: List[dict], manual_weights: Dict[str, float], ips: dict) -> List[Tuple[float, float]]:
    """
    Build (min, max) weight bounds for each fund.
    Manual funds are fixed at their weight.
    Sleeve caps applied on top of per-fund limits.
    """
    bounds = []
    for fund in funds:
        isin = fund["isin"]
        if isin in manual_weights:
            w = manual_weights[isin] / 100.0
            bounds.append((w, w))
            continue

        sleeve = classify_fund(fund)
        category = fund.get("category", "")

        max_w = MAX_WEIGHT

        # Apply sleeve caps
        if sleeve == "equity_passive":
            max_w = min(max_w, EQUITY_PASSIVE_CAP)
        elif sleeve == "alternatives":
            max_w = min(max_w, PRECIOUS_METALS_CAP)
        elif sleeve == "international":
            max_w = min(max_w, INTERNATIONAL_CAP)

        # Thematic cap
        if category in THEMATIC_CATS:
            max_w = min(max_w, THEMATIC_CAP)

        bounds.append((MIN_WEIGHT, max_w))

    return bounds


# ── Monte Carlo engine ───────────────────────────────────────────────────────

def run_monte_carlo(
    funds: List[dict],
    returns_map: Dict[str, np.ndarray],
    manual_weights: Dict[str, float],
    ips: dict,
    n_sims: int = N_SIMULATIONS,
) -> dict:
    """
    Run Monte Carlo optimisation.
    Returns strategies, frontier points, and sleeve summary.
    """
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
    opt_fund_objs = [f for f in opt_funds if f["isin"] in valid_isins]
    bounds = build_weight_bounds(opt_fund_objs, {}, ips)

    # IPS sleeve constraints
    equity_min = ips.get("equity", {}).get("min", 0) / 100.0
    equity_max = ips.get("equity", {}).get("max", 100) / 100.0
    debt_min   = ips.get("debt", {}).get("min", 0) / 100.0
    debt_max   = ips.get("debt", {}).get("max", 100) / 100.0

    sleeves = [classify_fund(f) for f in opt_fund_objs]
    eq_wts  = np.array([sleeve_equity_weight(s) for s in sleeves])
    dt_wts  = np.array([sleeve_debt_weight(s) for s in sleeves])

    # Monte Carlo
    all_weights  = []
    all_returns  = []
    all_vols     = []
    all_sharpes  = []

    np.random.seed(42)
    attempts = 0
    max_attempts = n_sims * 20

    while len(all_weights) < n_sims and attempts < max_attempts:
        attempts += 1

        # Random weights from Dirichlet (naturally sums to 1)
        raw = np.random.dirichlet(np.ones(n_funds))

        # Scale to remaining allocation
        w = raw * remaining

        # Apply per-fund bounds — check against absolute weight not fraction
        valid = True
        for i, (lo, hi) in enumerate(bounds):
            if w[i] < lo or w[i] > hi:
                valid = False
                break

        if not valid:
            continue

        # Check sleeve constraints
        total_eq = float(np.dot(w, eq_wts)) + sum(
            manual_weights.get(f["isin"], 0) / 100.0 * sleeve_equity_weight(classify_fund(f))
            for f in funds if f["isin"] in manual_weights
        )
        total_dt = float(np.dot(w, dt_wts)) + sum(
            manual_weights.get(f["isin"], 0) / 100.0 * sleeve_debt_weight(classify_fund(f))
            for f in funds if f["isin"] in manual_weights
        )

        # Only enforce sleeve constraints if relevant funds exist
        has_equity = any(sleeve_equity_weight(s) > 0 for s in sleeves)
        has_debt   = any(sleeve_debt_weight(s) > 0 for s in sleeves)

        if has_equity and not (equity_min <= total_eq <= equity_max):
            continue
        if has_debt and not (debt_min <= total_dt <= debt_max):
            continue

        # Portfolio metrics
        port_ret = float(np.dot(w, mu))
        port_var = float(w @ cov @ w)
        port_vol = float(np.sqrt(port_var))
        port_sharpe = (port_ret - RISK_FREE_RATE) / port_vol if port_vol > 0 else 0

        all_weights.append(w)
        all_returns.append(port_ret)
        all_vols.append(port_vol)
        all_sharpes.append(port_sharpe)

    if not all_weights:
        return {"error": "Could not generate valid portfolios — check IPS constraints"}

    all_weights = np.array(all_weights)
    all_returns = np.array(all_returns)
    all_vols    = np.array(all_vols)
    all_sharpes = np.array(all_sharpes)

    def build_strategy(idx: int, name: str) -> dict:
        w = all_weights[idx]
        weight_map = {}
        for i, isin in enumerate(valid_isins):
            weight_map[isin] = round(float(w[i]) * 100, 2)
        # Add manual weights
        for isin, mw in manual_weights.items():
            weight_map[isin] = mw
        # Round to sum exactly to 100
        total = sum(weight_map.values())
        if total != 100:
            largest = max(weight_map, key=weight_map.get)
            weight_map[largest] += round(100 - total, 2)

        return {
            "name": name,
            "weights": weight_map,
            "metrics": {
                "return":   round(float(all_returns[idx]) * 100, 2),
                "volatility": round(float(all_vols[idx]) * 100, 2),
                "sharpe":   round(float(all_sharpes[idx]), 3),
            }
        }

    strategies = {
        "max_sharpe":    build_strategy(int(np.argmax(all_sharpes)), "Max Sharpe"),
        "min_volatility": build_strategy(int(np.argmin(all_vols)), "Min Volatility"),
        "max_return":    build_strategy(int(np.argmax(all_returns)), "Max Return"),
    }

    # Efficient frontier — sample 200 points
    frontier_idx = np.argsort(all_vols)
    step = max(1, len(frontier_idx) // 200)
    frontier = [
        [round(float(all_vols[i]) * 100, 2), round(float(all_returns[i]) * 100, 2)]
        for i in frontier_idx[::step]
    ]

    return {
        "strategies": strategies,
        "frontier": frontier,
        "n_valid_simulations": len(all_weights),
        "optimised_isins": valid_isins,
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

            # Find R1/R2 alternatives in same category
            suggestions = db.query(
                DailyFundData.isin,
                DailyFundData.name,
                DailyFundData.ranking,
                DailyFundData.return_1y,
            ).filter(
                DailyFundData.data_date == date,
                DailyFundData.category == fund.get("category"),
                DailyFundData.ranking.in_(["R1", "R2"]),
                DailyFundData.isin != fund["isin"],
            ).order_by(DailyFundData.ranking, DailyFundData.return_1y.desc()).limit(3).all()

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
    manual_weights = payload.get("manual_weights", {})  # {isin: weight_pct}
    date_str       = payload.get("date")
    as_of_date     = date.fromisoformat(date_str) if date_str else date.today()

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

    # Step 5: Run Monte Carlo
    logger.info(f"NAV fetch complete. Running Monte Carlo...")
    opt_result = run_monte_carlo(funds, returns_map, manual_weights, ips)
    logger.info(f"Monte Carlo complete. Valid sims: {opt_result.get('n_valid_simulations', 0)}")

    # Step 6: Build sleeve summary for current weights
    total_w = sum(f.get("current_weight", 0) for f in funds)
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