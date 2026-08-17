# backend/routers/holdings.py
"""
Fund holdings endpoints — backed by Morningstar NewPortfolioApi data.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from datetime import date, timedelta
from typing import Optional
import logging
import math

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/historical-var")
def get_historical_var(
    isins: str = Query(...),
    weights: str = Query(...),
    categories: str = Query(""),
    asset_classes: str = Query(""),
    std_devs: str = Query(""),
    lookback_days: int = Query(9999),
):
    """
    Hybrid Historical + Parametric VaR for a portfolio.

    Default lookback: full history (9999 = all available NAV data in nav_history).
    Pass lookback_days=756 explicitly to limit to 3Y window.

    Per-fund classification per horizon:
      >= 252 days NAV  → historical for 1D/1W/1M horizons
      >= 504 days NAV  → historical for 1Y horizon
      < 252 days       → parametric normal distribution for all horizons
      252-503 days     → historical for 1D/1W/1M, parametric for 1Y

    Parametric std_dev proxy chain (when fund has insufficient history):
      1. Fund own std_dev_3y from Morningstar snapshot
      2. Category avg std_dev_3y from daily_fund_data (covers 99%+ of cases)
      3. Asset class avg std_dev_3y (new category with no peers having 3Y data)
      4. Hardcoded default — safety net, almost never fires
         (Equity 18%, Debt 4%, Hybrid 10%, ETF-Equity 15%, ETF-Debt 5%,
          International 20%, Precious Metals 22%)
    """
    from sqlalchemy import text
    from models.database import engine
    from collections import defaultdict

    isin_list   = [i.strip() for i in isins.split(",") if i.strip()]
    weight_list = [float(w.strip()) for w in weights.split(",") if w.strip()]
    cat_list    = [c.strip() for c in categories.split(",")] if categories else [""] * len(isin_list)
    ac_list     = [a.strip() for a in asset_classes.split(",")] if asset_classes else [""] * len(isin_list)
    sd_list     = [float(s.strip()) if s.strip() and s.strip() not in ("-1","","-") else None
                   for s in std_devs.split(",")] if std_devs else [None] * len(isin_list)

    if len(isin_list) != len(weight_list):
        raise HTTPException(400, "ISINs and weights must have same length")

    total_w = sum(weight_list)
    if abs(total_w - 100) > 1:
        raise HTTPException(400, f"Weights must sum to ~100, got {total_w}")

    w_frac = [w / 100.0 for w in weight_list]

    AC_DEFAULTS = {
        "equity": 18.0, "debt": 4.0, "hybrid": 10.0,
        "etf - equity": 15.0, "etf - debt": 5.0,
        "international": 20.0, "precious metals": 22.0,
    }

    # ── Fetch NAV history + category/AC std_dev averages ────────────────────
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT isin, date, nav FROM nav_history
            WHERE isin = ANY(:isins) AND nav IS NOT NULL AND nav > 0
            ORDER BY isin, date
        """), {"isins": isin_list}).fetchall()

        latest_date = conn.execute(text(
            "SELECT MAX(data_date) FROM daily_fund_data WHERE is_benchmark = 0 OR is_benchmark IS NULL"
        )).scalar()

        cat_avgs = {r[0]: float(r[1]) for r in conn.execute(text("""
            SELECT category, AVG(std_dev_3y) FROM daily_fund_data
            WHERE data_date = :d AND std_dev_3y IS NOT NULL AND std_dev_3y > 0
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
            GROUP BY category
        """), {"d": latest_date}).fetchall() if r[0]}

        ac_avgs = {r[0]: float(r[1]) for r in conn.execute(text("""
            SELECT asset_class, AVG(std_dev_3y) FROM daily_fund_data
            WHERE data_date = :d AND std_dev_3y IS NOT NULL AND std_dev_3y > 0
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
            GROUP BY asset_class
        """), {"d": latest_date}).fetchall() if r[0]}

    # ── Build per-fund NAV return series ────────────────────────────────────
    nav_series = defaultdict(list)
    for row in rows:
        nav_series[row[0]].append((row[1], row[2]))

    fund_meta    = {}
    fund_returns = {}  # {isin: [(date, return), ...] sorted ascending}
    MAX_GAP = 7

    for isin, series in nav_series.items():
        series.sort(key=lambda x: x[0])
        ret_list = []
        gap_detected = False
        for i in range(1, len(series)):
            pd_, pn = series[i-1]
            cd_, cn = series[i]
            if (cd_ - pd_).days > MAX_GAP:
                gap_detected = True
                continue
            if pn > 0:
                ret_list.append((cd_, (cn / pn) - 1))
        fund_meta[isin] = {
            "total_days":   len(series),
            "return_days":  len(ret_list),
            "gap_detected": gap_detected,
            "first_date":   str(series[0][0])  if series else None,
            "last_date":    str(series[-1][0]) if series else None,
        }
        fund_returns[isin] = ret_list  # list of (date, ret) sorted asc

    # ── Classify each fund ───────────────────────────────────────────────────
    def get_std_proxy(idx, isin):
        own = sd_list[idx] if idx < len(sd_list) else None
        if own and own > 0:
            return own, "fund_std_dev_3y"
        cat = cat_list[idx] if idx < len(cat_list) else ""
        if cat and cat in cat_avgs:
            return cat_avgs[cat], "category_avg"
        ac = ac_list[idx] if idx < len(ac_list) else ""
        if ac and ac in ac_avgs:
            return ac_avgs[ac], "asset_class_avg"
        for k, v in AC_DEFAULTS.items():
            if k in ac.lower():
                return v, "hardcoded_default"
        return 15.0, "hardcoded_default"

    HORIZONS = [
        {"label": "1 day",   "days": 1,   "min_returns": 252},
        {"label": "1 week",  "days": 5,   "min_returns": 252},
        {"label": "1 month", "days": 21,  "min_returns": 252},
        {"label": "1 year",  "days": 252, "min_returns": 504},
    ]

    # Normal distribution critical values
    T95, T99, ES95M, ES99M = 1.6449, 2.3263, 2.063, 2.665

    # ── Compute VaR per horizon ──────────────────────────────────────────────
    var_table   = []
    hist_notes  = []
    param_notes = []
    fund_std_proxies = {}

    for h in HORIZONS:
        h_label  = h["label"]
        h_days   = h["days"]
        min_ret  = h["min_returns"]

        # For each fund: decide historical or parametric for THIS horizon
        hist_isins_h  = []
        param_isins_h = []

        for idx, isin in enumerate(isin_list):
            rdays = fund_meta.get(isin, {}).get("return_days", 0)
            gap   = fund_meta.get(isin, {}).get("gap_detected", False)
            if rdays >= min_ret and not gap and isin in fund_returns:
                hist_isins_h.append((idx, isin))
            else:
                param_isins_h.append((idx, isin))
                if isin not in fund_std_proxies:
                    std, src = get_std_proxy(idx, isin)
                    fund_std_proxies[isin] = {"std": std, "source": src}

        hist_w_sum = sum(weight_list[idx] for idx, _ in hist_isins_h)

        # ── Historical contribution ──────────────────────────────────────────
        hvar95_1d = hes95_1d = hvar99_1d = hes99_1d = 0.0
        common_days_h = 0
        date_from_h = date_to_h = None

        if hist_isins_h and hist_w_sum > 0:
            hist_w_norm = {isin: weight_list[idx] / hist_w_sum
                           for idx, isin in hist_isins_h}

            # Build overlapping h_days-period returns
            # Use date-indexed dict for each fund, slice to lookback
            ret_dicts = {}
            for idx, isin in hist_isins_h:
                ret_list = fund_returns[isin]
                if lookback_days < 9999:
                    ret_list = ret_list[-lookback_days:]
                ret_dicts[isin] = {d: r for d, r in ret_list}

            # Common dates across hist funds for this horizon
            date_sets = [set(ret_dicts[isin].keys()) for _, isin in hist_isins_h]
            common = sorted(date_sets[0].intersection(*date_sets[1:]))

            if len(common) >= h_days + 1:
                # Overlapping period returns
                # For 1D: just use daily returns directly
                # For 1W/1M/1Y: compute product of returns over h_days window
                period_rets = []
                for i in range(h_days - 1, len(common)):
                    window = common[i - h_days + 1: i + 1]
                    if len(window) < h_days:
                        continue
                    # Weighted portfolio return over this window
                    port_ret = 0.0
                    for _, isin in hist_isins_h:
                        # Compound daily returns over window
                        compound = 1.0
                        for d in window:
                            compound *= (1 + ret_dicts[isin].get(d, 0))
                        port_ret += (compound - 1) * hist_w_norm[isin]
                    period_rets.append(port_ret)

                if period_rets:
                    period_rets.sort()
                    n = len(period_rets)
                    tidx95 = max(int(math.floor(n * 0.05)), 1)
                    tidx99 = max(int(math.floor(n * 0.01)), 1)

                    hvar95_raw = -period_rets[tidx95 - 1] * 100
                    hes95_raw  = -sum(period_rets[:tidx95]) / tidx95 * 100
                    hvar99_raw = -period_rets[tidx99 - 1] * 100
                    hes99_raw  = -sum(period_rets[:tidx99]) / tidx99 * 100

                    # Scale back to 1D equivalent then re-scale (for consistency)
                    # Actually use raw period return directly — no sqrt scaling needed
                    # since we computed actual h_days period returns
                    hvar95_1d = hvar95_raw
                    hes95_1d  = hes95_raw
                    hvar99_1d = hvar99_raw
                    hes99_1d  = hes99_raw

                    # Scale by hist weight fraction
                    scale_h = hist_w_sum / 100.0
                    hvar95_1d *= scale_h
                    hes95_1d  *= scale_h
                    hvar99_1d *= scale_h
                    hes99_1d  *= scale_h

                    common_days_h = n
                    date_from_h = str(common[0])
                    date_to_h   = str(common[-1])

        # ── Parametric contribution ──────────────────────────────────────────
        pvar95 = pes95 = pvar99 = pes99 = 0.0
        for idx, isin in param_isins_h:
            pw = w_frac[idx]
            if isin not in fund_std_proxies:
                std, src = get_std_proxy(idx, isin)
                fund_std_proxies[isin] = {"std": std, "source": src}
            std_ann = fund_std_proxies[isin]["std"]
            # Scale annualised std to h_days period
            std_period = std_ann * math.sqrt(h_days / 252.0)
            pvar95 += pw * T95  * std_period
            pes95  += pw * ES95M * std_period
            pvar99 += pw * T99  * std_period
            pes99  += pw * ES99M * std_period

        var_table.append({
            "horizon":     h_label,
            "days":        h_days,
            "var_95":      round(hvar95_1d + pvar95, 4),
            "es_95":       round(hes95_1d  + pes95,  4),
            "var_99":      round(hvar99_1d + pvar99, 4),
            "es_99":       round(hes99_1d  + pes99,  4),
            "hist_funds":  len(hist_isins_h),
            "param_funds": len(param_isins_h),
            "common_days": common_days_h,
            "date_from":   date_from_h,
            "date_to":     date_to_h,
        })

    # ── Build notes ──────────────────────────────────────────────────────────
    for idx, isin in enumerate(isin_list):
        rd  = fund_meta.get(isin, {}).get("return_days", 0)
        gap = fund_meta.get(isin, {}).get("gap_detected", False)
        if 252 <= rd < 504:
            # Historical for 1D/1W/1M but parametric for 1Y — note it
            hist_notes.append(f"{isin} ({rd} days — full history used for 1D/1W/1M; parametric for 1Y)")
        elif rd < 252 or gap:
            src = fund_std_proxies.get(isin, {}).get("source", "unknown")
            std = fund_std_proxies.get(isin, {}).get("std", 0)
            param_notes.append(f"{isin} ({rd} days NAV — parametric normal, std={std:.1f}%, source={src})")

    # Build fund lists for response
    historical_funds = [isin for isin in isin_list
                        if fund_meta.get(isin, {}).get("return_days", 0) >= 252
                        and not fund_meta.get(isin, {}).get("gap_detected", False)]
    parametric_funds = [isin for isin in isin_list
                        if fund_meta.get(isin, {}).get("return_days", 0) < 252
                        or fund_meta.get(isin, {}).get("gap_detected", False)]
    is_hybrid = len(parametric_funds) > 0

    return {
        "method":           "hybrid" if is_hybrid else "historical_simulation",
        "var":              var_table,
        "fund_meta":        {isin: fund_meta.get(isin, {}) for isin in isin_list},
        "fund_std_proxies": fund_std_proxies,
        "historical_funds": historical_funds,
        "parametric_funds": parametric_funds,
        "hist_notes":       hist_notes,
        "param_notes":      param_notes,
    }

@router.get("/overlap")
def get_overlap(isins: str, portfolio_date: Optional[str] = None):
    """
    Calculate pairwise overlap + common holdings for a list of active equity funds.
    isins: comma-separated list of ISINs (2-4 funds)

    Only equity holdings (holding_type='E') are considered.
    Funds must be active equity mutual funds — filtering happens on the frontend
    before calling this endpoint, but we also filter holding_type='E' here.

    Returns:
      - pairwise_matrix: overlap % between each pair
      - common_all: holdings present in ALL selected funds (with each fund's weight)
      - common_pairs: per-pair common holdings detail
    """
    from models.database import SessionLocal, FundHolding
    from sqlalchemy import func
    from datetime import date as date_type

    isin_list = [i.strip() for i in isins.split(",") if i.strip()]
    if len(isin_list) < 2:
        raise HTTPException(400, "At least 2 ISINs required for overlap")
    if len(isin_list) > 20:
        raise HTTPException(400, "Maximum 20 funds for overlap")

    db = SessionLocal()
    try:
        # For each fund, get latest portfolio_date if not specified
        fund_holdings = {}  # {isin: {holding_isin: weight}}
        fund_dates = {}

        for isin in isin_list:
            q = db.query(FundHolding).filter(
                FundHolding.isin == isin,
                FundHolding.holding_type == "E",   # equity only
                FundHolding.holding_isin != None,  # must have ISIN to match
                FundHolding.weighting != None,
                FundHolding.weighting > 0,
            )

            if portfolio_date:
                q = q.filter(FundHolding.portfolio_date == date_type.fromisoformat(portfolio_date))
            else:
                latest = (
                    db.query(FundHolding.portfolio_date)
                    .filter(FundHolding.isin == isin)
                    .order_by(FundHolding.portfolio_date.desc())
                    .first()
                )
                if not latest:
                    fund_holdings[isin] = {}
                    continue
                q = q.filter(FundHolding.portfolio_date == latest[0])
                fund_dates[isin] = latest[0].isoformat()

            rows = q.all()
            fund_holdings[isin] = {
                r.holding_isin: {
                    "weight": round(float(r.weighting), 4),
                    "name": r.name,
                    "sector": r.global_sector,
                    "exchange": r.exchange_name,
                }
                for r in rows
            }

        # ── Pairwise overlap matrix ──────────────────────────────────────────
        pairwise = {}
        for i in range(len(isin_list)):
            for j in range(i + 1, len(isin_list)):
                a, b = isin_list[i], isin_list[j]
                holdings_a = fund_holdings.get(a, {})
                holdings_b = fund_holdings.get(b, {})
                common_isins = set(holdings_a.keys()) & set(holdings_b.keys())
                overlap = sum(
                    min(holdings_a[h]["weight"], holdings_b[h]["weight"])
                    for h in common_isins
                )
                key = f"{a}|{b}"
                pairwise[key] = {
                    "fund_a": a,
                    "fund_b": b,
                    "overlap_pct": round(overlap, 2),
                    "common_count": len(common_isins),
                }

        # ── Common holdings across ALL funds ─────────────────────────────────
        all_sets = [set(fund_holdings.get(isin, {}).keys()) for isin in isin_list]
        common_all_isins = set.intersection(*all_sets) if all_sets else set()

        common_all = []
        for h_isin in common_all_isins:
            weights = {}
            name = None
            sector = None
            for isin in isin_list:
                h = fund_holdings.get(isin, {}).get(h_isin)
                if h:
                    weights[isin] = h["weight"]
                    name = name or h["name"]
                    sector = sector or h["sector"]
            min_weight = min(weights.values()) if weights else 0
            common_all.append({
                "holding_isin": h_isin,
                "name": name,
                "sector": sector,
                "weights": weights,
                "min_weight": round(min_weight, 4),
            })

        # Sort by average weight descending
        common_all.sort(
            key=lambda x: sum(x["weights"].values()) / len(x["weights"]),
            reverse=True
        )

        # ── Per-pair common holdings detail ──────────────────────────────────
        pair_details = {}
        for i in range(len(isin_list)):
            for j in range(i + 1, len(isin_list)):
                a, b = isin_list[i], isin_list[j]
                holdings_a = fund_holdings.get(a, {})
                holdings_b = fund_holdings.get(b, {})
                common_isins = set(holdings_a.keys()) & set(holdings_b.keys())
                detail = []
                for h_isin in common_isins:
                    ha = holdings_a[h_isin]
                    hb = holdings_b[h_isin]
                    detail.append({
                        "holding_isin": h_isin,
                        "name": ha["name"],
                        "sector": ha["sector"],
                        "weight_a": ha["weight"],
                        "weight_b": hb["weight"],
                        "min_weight": round(min(ha["weight"], hb["weight"]), 4),
                    })
                detail.sort(key=lambda x: x["min_weight"], reverse=True)

                # Top 10 unique to each fund (not in the other)
                only_a = sorted(
                    [{"name": v["name"], "weight": v["weight"]}
                     for k, v in holdings_a.items() if k not in holdings_b],
                    key=lambda x: -x["weight"]
                )[:10]
                only_b = sorted(
                    [{"name": v["name"], "weight": v["weight"]}
                     for k, v in holdings_b.items() if k not in holdings_a],
                    key=lambda x: -x["weight"]
                )[:10]

                pair_details[f"{a}|{b}"] = {
                    "shared": detail[:50],
                    "only_a": only_a,
                    "only_b": only_b,
                }

        # True unique stock count — union of all holding ISINs across all funds
        all_isins_union = set()
        for isin in isin_list:
            all_isins_union.update(fund_holdings.get(isin, {}).keys())

        return {
            "isins": isin_list,
            "portfolio_dates": fund_dates,
            "pairwise_matrix": pairwise,
            "common_all": common_all[:30],
            "pair_details": pair_details,
            "fund_holdings_counts": {
                isin: len(fund_holdings.get(isin, {}))
                for isin in isin_list
            },
            "unique_stock_count": len(all_isins_union),
        }

    finally:
        db.close()


@router.get("/portfolio-lookthrough")
def get_portfolio_lookthrough(
    isins: str = Query(..., description="Comma-separated fund ISINs"),
    weights: str = Query(..., description="Comma-separated portfolio weights (0-100), aligned with isins"),
    portfolio_date: Optional[str] = None,
):
    """
    Compute portfolio-level look-through: aggregates each fund's equity holdings
    weighted by portfolio allocation, then groups by ISIN (canonical) for stocks
    and by sector for sector mix.

    Returns:
      - sector_breakdown: [{sector, weight_pct}] sorted desc
      - top_stocks: [{name, isin, sector, weight_pct}] top 20 aggregated stocks
      - fund_count: number of funds with holdings data
      - total_effective_equity_pct: sum of weighted equity holdings
    """
    from models.database import SessionLocal
    from sqlalchemy import text

    isin_list = [x.strip() for x in isins.split(",") if x.strip()]
    weight_list = [float(x.strip()) for x in weights.split(",") if x.strip()]

    if len(isin_list) != len(weight_list):
        raise HTTPException(400, "isins and weights must have same length")
    if not isin_list:
        raise HTTPException(400, "At least one ISIN required")

    weight_map = dict(zip(isin_list, weight_list))
    db = SessionLocal()
    try:
        from models.database import FundHolding
        from datetime import date as date_type

        # For each fund, get equity holdings on latest portfolio date
        fund_holdings_per_isin = {}
        funds_with_data = 0
        for isin in isin_list:
            q = db.query(FundHolding).filter(
                FundHolding.isin == isin,
                FundHolding.holding_type == "E",
                FundHolding.weighting != None,
                FundHolding.weighting > 0,
            )
            if portfolio_date:
                q = q.filter(FundHolding.portfolio_date == date_type.fromisoformat(portfolio_date))
            else:
                latest = (
                    db.query(FundHolding.portfolio_date)
                    .filter(FundHolding.isin == isin)
                    .order_by(FundHolding.portfolio_date.desc())
                    .first()
                )
                if not latest:
                    continue
                q = q.filter(FundHolding.portfolio_date == latest[0])
            rows = q.all()
            if rows:
                funds_with_data += 1
                fund_holdings_per_isin[isin] = rows

        if not fund_holdings_per_isin:
            return {
                "sector_breakdown": [],
                "top_stocks": [],
                "fund_count": 0,
                "total_effective_equity_pct": 0.0,
            }

        # Canonicalise stocks by holding_isin (fallback to normalised name if ISIN missing)
        # Aggregate weight = sum of (fund_weight × holding_weight_within_fund)
        #                   where fund_weight is portfolio weight (0-100)
        # Result is weight as % of TOTAL portfolio value
        stock_agg = {}   # {canonical_key: {"name": ..., "isin": ..., "sector": ..., "weight_pct": ...}}
        sector_agg = {}  # {sector: weight_pct}

        for fund_isin, rows in fund_holdings_per_isin.items():
            fund_weight = weight_map.get(fund_isin, 0) / 100.0  # 0..1
            if fund_weight <= 0:
                continue
            for r in rows:
                # Contribution to portfolio = fund_weight × holding weight (%) / 100
                # holding.weighting is already in %, so:
                contrib_pct = fund_weight * float(r.weighting)
                # canonical key: prefer ISIN, fall back to normalised name
                key = r.holding_isin or ("NAME:" + (r.name or "").strip().upper())
                if key not in stock_agg:
                    stock_agg[key] = {
                        "name": r.name or "Unknown",
                        "isin": r.holding_isin,
                        "sector": r.global_sector or "Unclassified",
                        "weight_pct": 0.0,
                    }
                stock_agg[key]["weight_pct"] += contrib_pct
                # Sector agg
                sector = r.global_sector or "Unclassified"
                sector_agg[sector] = sector_agg.get(sector, 0.0) + contrib_pct

        # Total effective equity exposure (sum of all contribs — bounded by portfolio equity %)
        total_eff_equity = sum(sector_agg.values())

        # Sort stocks by weight desc, take top 20
        top_stocks = sorted(
            stock_agg.values(),
            key=lambda x: x["weight_pct"],
            reverse=True,
        )[:20]
        top_stocks = [
            {
                "name": s["name"],
                "isin": s["isin"],
                "sector": s["sector"],
                "weight_pct": round(s["weight_pct"], 3),
            }
            for s in top_stocks
        ]

        # Sort sectors by weight desc
        sector_breakdown = sorted(
            [{"sector": k, "weight_pct": round(v, 2)} for k, v in sector_agg.items()],
            key=lambda x: x["weight_pct"],
            reverse=True,
        )

        return {
            "sector_breakdown": sector_breakdown,
            "top_stocks": top_stocks,
            "fund_count": funds_with_data,
            "total_effective_equity_pct": round(total_eff_equity, 2),
        }

    finally:
        db.close()


@router.get("/stock-exposure")
def get_stock_exposure(
    stock: str = Query(..., description="Stock name or ISIN (partial match supported)"),
    whitelisted: bool = Query(False, description="True = R1/R2 funds only, False = all funds"),
    portfolio_date: Optional[str] = None,
):
    """
    Find all funds holding a given stock.
    ISIN-first approach: resolves name → holding_isin, then groups all name variants
    under the same ISIN so duplicates like 'HDFC Life' vs 'Hdfc Life Insurance Co Limited'
    are merged. Falls back to name-only matching when holding_isin is null.
    """
    from models.database import SessionLocal
    from sqlalchemy import text

    if not stock or len(stock.strip()) < 2:
        raise HTTPException(400, "Stock name must be at least 2 characters")

    db = SessionLocal()
    try:
        query = stock.strip()

        # Step 1: Find matching holding_isins and names via partial name match
        # Group by holding_isin so all name variants of the same stock collapse into one
        isin_rows = db.execute(text("""
            SELECT
                holding_isin,
                -- pick the most-used name as canonical
                (SELECT name FROM fund_holdings fh2
                 WHERE fh2.holding_isin = fh.holding_isin
                   AND fh2.holding_type = 'E'
                 GROUP BY name ORDER BY COUNT(*) DESC LIMIT 1) AS canonical_name,
                COUNT(DISTINCT isin) AS fund_count
            FROM fund_holdings fh
            WHERE holding_type = 'E'
              AND name IS NOT NULL
              AND LOWER(name) LIKE LOWER(:q)
              AND holding_isin IS NOT NULL
            GROUP BY holding_isin
            ORDER BY fund_count DESC
            LIMIT 20
        """), {"q": f"%{query}%"}).fetchall()

        # Also get name-only matches (no holding_isin) to avoid missing funds
        name_only_rows = db.execute(text("""
            SELECT DISTINCT name, COUNT(DISTINCT isin) AS fund_count
            FROM fund_holdings
            WHERE holding_type = 'E'
              AND name IS NOT NULL
              AND LOWER(name) LIKE LOWER(:q)
              AND (holding_isin IS NULL OR holding_isin = '')
            GROUP BY name
            ORDER BY fund_count DESC
            LIMIT 10
        """), {"q": f"%{query}%"}).fetchall()

        if not isin_rows and not name_only_rows:
            return {"stock": query, "matched_name": None, "holders": [], "amc_breakdown": [], "summary": {}}

        # Pick the best match — highest fund_count across isin-grouped results
        if isin_rows:
            best_isin_row = isin_rows[0]
            target_isin = best_isin_row.holding_isin
            stock_name = best_isin_row.canonical_name or query
            other_isins = [r.holding_isin for r in isin_rows[1:5]]
        else:
            target_isin = None
            stock_name = name_only_rows[0].name
            other_isins = []

        # Step 2: Portfolio date filter
        if portfolio_date:
            pd_filter = f"AND fh.portfolio_date = '{portfolio_date}'"
        else:
            pd_filter = """
                AND fh.portfolio_date = (
                    SELECT MAX(portfolio_date) FROM fund_holdings fh2
                    WHERE fh2.isin = fh.isin
                )
            """

        # Step 3: Fetch all holdings for this stock
        # Primary: match by holding_isin (catches all name variants)
        # Secondary: match by name for null-isin rows
        if target_isin:
            holdings_rows = db.execute(text(f"""
                SELECT fh.isin, fh.name AS stock_name, fh.weighting,
                       fh.portfolio_date, fh.sector, fh.holding_isin AS stock_isin
                FROM fund_holdings fh
                WHERE fh.holding_type = 'E'
                  AND fh.holding_isin = :target_isin
                  AND fh.weighting IS NOT NULL AND fh.weighting > 0
                  {pd_filter}
            """), {"target_isin": target_isin}).fetchall()
        else:
            # name-only fallback
            holdings_rows = db.execute(text(f"""
                SELECT fh.isin, fh.name AS stock_name, fh.weighting,
                       fh.portfolio_date, fh.sector, fh.holding_isin AS stock_isin
                FROM fund_holdings fh
                WHERE fh.holding_type = 'E'
                  AND fh.name = :sname
                  AND fh.weighting IS NOT NULL AND fh.weighting > 0
                  {pd_filter}
            """), {"sname": stock_name}).fetchall()

        if not holdings_rows:
            return {"stock": query, "matched_name": stock_name, "holders": [], "amc_breakdown": [], "summary": {}}

        fund_isins = list({r.isin for r in holdings_rows})

        # Step 4: Fund metadata from DailyFundData
        latest_date = db.execute(text("SELECT MAX(data_date) FROM daily_fund_data")).scalar()
        fund_rows = db.execute(text("""
            SELECT isin, name, branding_name, category, asset_class, ranking, fund_size
            FROM daily_fund_data
            WHERE data_date = :d AND isin = ANY(:isins)
        """), {"d": str(latest_date), "isins": fund_isins}).fetchall() if latest_date else []
        fund_meta = {r.isin: dict(r._mapping) for r in fund_rows}

        # Step 5: Build holders — group by fund isin, take highest weight
        fund_weights = {}
        for r in holdings_rows:
            fi = r.isin
            if fi not in fund_weights or r.weighting > fund_weights[fi]["weighting"]:
                fund_weights[fi] = {
                    "weighting": r.weighting,
                    "portfolio_date": str(r.portfolio_date),
                    "sector": r.sector,
                    "stock_isin": r.stock_isin,
                }

        holders = []
        for fi, hw in fund_weights.items():
            meta = fund_meta.get(fi, {})
            ranking = meta.get("ranking") or ""
            if whitelisted and ranking not in ("R1", "R2"):
                continue
            fund_name = meta.get("name") or ""
            # Skip funds not in daily_fund_data (untracked ETFs, AIFs, IFSC funds)
            if not fund_name:
                continue
            amc = meta.get("branding_name") or _extract_amc(fund_name)
            holders.append({
                "isin": fi,
                "fund_name": fund_name,
                "amc": amc,
                "category": meta.get("category") or "—",
                "asset_class": meta.get("asset_class") or "—",
                "ranking": ranking or "—",
                "weight": round(hw["weighting"], 4),
                "aum_cr": meta.get("fund_size"),
                "aum_exposed_cr": round((meta.get("fund_size") or 0) * hw["weighting"] / 100, 1),
                "portfolio_date": hw["portfolio_date"],
                "sector": hw["sector"],
                "stock_isin": hw["stock_isin"],
            })

        holders.sort(key=lambda x: x["weight"], reverse=True)

        # Step 6: AMC breakdown
        amc_map = {}
        for h in holders:
            a = h["amc"]
            if a not in amc_map:
                amc_map[a] = {"amc": a, "fund_count": 0, "weight_sum": 0, "aum_exposed": 0}
            amc_map[a]["fund_count"] += 1
            amc_map[a]["weight_sum"] += h["weight"]
            amc_map[a]["aum_exposed"] += h["aum_exposed_cr"]

        amc_breakdown = sorted(
            [{"amc": v["amc"], "fund_count": v["fund_count"],
              "avg_weight": round(v["weight_sum"] / v["fund_count"], 4),
              "aum_exposed_cr": round(v["aum_exposed"], 1)}
             for v in amc_map.values()],
            key=lambda x: x["aum_exposed_cr"], reverse=True
        )

        total_aum = sum(h["aum_exposed_cr"] for h in holders)
        top3_aum = sum(r["aum_exposed_cr"] for r in amc_breakdown[:3])
        top3_share = round(top3_aum / total_aum * 100, 1) if total_aum > 0 else 0

        return {
            "stock": query,
            "matched_name": stock_name,
            "stock_isin": target_isin,
            "sector": holders[0]["sector"] if holders else None,
            "portfolio_date": holders[0]["portfolio_date"] if holders else None,
            "whitelisted": whitelisted,
            "summary": {
                "fund_count": len(holders),
                "amc_count": len(amc_map),
                "avg_weight": round(sum(h["weight"] for h in holders) / len(holders), 4) if holders else 0,
                "total_aum_exposed_cr": round(total_aum, 1),
                "top3_amc_share_pct": top3_share,
            },
            "holders": holders,
            "amc_breakdown": amc_breakdown,
        }
    finally:
        db.close()


@router.get("/stock-search")
def search_stocks(q: str = Query(..., min_length=2), limit: int = Query(15, le=50)):
    """
    Typeahead — ISIN-first deduplication.
    Groups all name variants of the same stock under one entry using holding_isin.
    """
    from models.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        # ISIN-grouped results — one entry per unique stock regardless of name variants
        isin_rows = db.execute(text("""
            SELECT
                holding_isin,
                (SELECT name FROM fund_holdings fh2
                 WHERE fh2.holding_isin = fh.holding_isin
                   AND fh2.holding_type = 'E'
                 GROUP BY name ORDER BY COUNT(*) DESC LIMIT 1) AS canonical_name,
                COUNT(DISTINCT isin) AS fund_count
            FROM fund_holdings fh
            WHERE holding_type = 'E'
              AND name IS NOT NULL
              AND LOWER(name) LIKE LOWER(:q)
              AND holding_isin IS NOT NULL
            GROUP BY holding_isin
            ORDER BY fund_count DESC
            LIMIT :limit
        """), {"q": f"%{q}%", "limit": limit}).fetchall()

        # Name-only fallback for stocks without holding_isin
        name_rows = db.execute(text("""
            SELECT name, COUNT(DISTINCT isin) AS fund_count
            FROM fund_holdings
            WHERE holding_type = 'E'
              AND name IS NOT NULL
              AND LOWER(name) LIKE LOWER(:q)
              AND (holding_isin IS NULL OR holding_isin = '')
            GROUP BY name
            ORDER BY fund_count DESC
            LIMIT :limit
        """), {"q": f"%{q}%", "limit": limit}).fetchall()

        import re
        def norm(n):
            n = n.lower().strip()
            n = re.sub(r'[\.\'\^\$]', '', n)
            n = re.sub(r'\s+', ' ', n)
            n = n.replace(' limited', '').replace(' ltd', '')
            return n.strip()

        results = []
        seen_isins = set()
        canonical_norms = set()
        for r in isin_rows:
            if r.holding_isin not in seen_isins and r.canonical_name:
                seen_isins.add(r.holding_isin)
                canonical_norms.add(norm(r.canonical_name))
                results.append({"name": r.canonical_name, "fund_count": r.fund_count, "isin": r.holding_isin})

        # For name-only entries, try to resolve their ISIN from the DB
        # (same stock may have holding_isin populated in other funds' disclosures)
        unresolved_names = [r.name for r in name_rows if norm(r.name) not in canonical_norms]
        if unresolved_names:
            resolved = db.execute(text("""
                SELECT DISTINCT ON (n.name) n.name, fh.holding_isin
                FROM (SELECT UNNEST(:names::text[]) AS name) n
                JOIN fund_holdings fh
                  ON LOWER(fh.name) LIKE LOWER(CONCAT('%', SPLIT_PART(n.name, ' ', 1), '%'))
                 AND fh.holding_isin IS NOT NULL
                 AND fh.holding_type = 'E'
                ORDER BY n.name, fh.holding_isin
            """), {"names": unresolved_names}).fetchall()
            resolved_map = {r.name: r.holding_isin for r in resolved}
        else:
            resolved_map = {}

        for r in name_rows:
            n_norm = norm(r.name)
            if n_norm in canonical_norms:
                continue  # already covered by ISIN-grouped result
            resolved_isin = resolved_map.get(r.name)
            if resolved_isin and resolved_isin in seen_isins:
                continue  # resolved to an ISIN we already have
            results.append({"name": r.name, "fund_count": r.fund_count, "isin": resolved_isin})

        results.sort(key=lambda x: x["fund_count"], reverse=True)
        return {"results": results[:limit]}
    finally:
        db.close()



def _clean_amc_name(name: str) -> str:
    """
    Strips legal suffixes from ProviderCompanyName to get a clean short brand name.
    Used when BrandingName is absent and only ProviderCompanyName is available.
    """
    import re
    if not name:
        return name
    suffixes = [
        r"\s+Investment\s+Managers?\s+Private\s+Limited",
        r"\s+Asset\s+Management\s+(Company\s+)?(Private\s+)?Limited",
        r"\s+Mutual\s+Fund",
        r"\s+AMC\s+Ltd\.?",
        r"\s+AMC\s+Limited",
        r"\s+Private\s+Limited",
        r"\s+Pvt\.?\s+Ltd\.?",
        r"\s+Ltd\.?$",
    ]
    result = name
    for suffix in suffixes:
        result = re.sub(suffix, "", result, flags=re.IGNORECASE).strip()
    return result or name


def _extract_amc(fund_name: str) -> str:
    """
    Extract AMC name from fund name using a comprehensive prefix lookup.
    Covers all active Indian AMCs as of 2026.
    Longer prefixes checked first to avoid partial matches (e.g. "Baroda BNP Paribas" before "Baroda").
    """
    AMC_MAP = [
        # Full name → canonical AMC label  (sorted longest-first inside the loop)
        ("Aditya Birla Sun Life", "Aditya BSL"),
        ("Aditya BSL", "Aditya BSL"),
        ("Angel One", "Angel One"),
        ("Axis", "Axis"),
        ("Bajaj Finserv", "Bajaj Finserv"),
        ("Bandhan", "Bandhan"),
        ("Bank of India", "Bank of India"),
        ("Baroda BNP Paribas", "Baroda BNP Paribas"),
        ("Baroda BNP P", "Baroda BNP Paribas"),
        ("Canara Robeco", "Canara Robeco"),
        ("Capitalmind", "Capitalmind"),
        ("DSP", "DSP"),
        ("Edelweiss", "Edelweiss"),
        ("Franklin India", "Franklin Templeton"),
        ("Franklin", "Franklin Templeton"),
        ("Groww", "Groww"),
        ("HDFC", "HDFC"),
        ("Helios", "Helios"),
        ("HSBC", "HSBC"),
        ("ICICI Prudential", "ICICI Prudential"),
        ("ICICI Pru", "ICICI Prudential"),
        ("IIFL", "IIFL"),
        ("Invesco India", "Invesco"),
        ("Invesco", "Invesco"),
        ("ITI", "ITI"),
        ("JM Financial", "JM Financial"),
        ("JM", "JM Financial"),
        ("Kotak", "Kotak"),
        ("LIC", "LIC"),
        ("Mahindra Manulife", "Mahindra Manulife"),
        ("Mirae Asset", "Mirae Asset"),
        ("Motilal Oswal", "Motilal Oswal"),
        ("Navi", "Navi"),
        ("Nippon India", "Nippon India"),
        ("Nippon", "Nippon India"),
        ("NJ", "NJ"),
        ("Old Bridge", "Old Bridge"),
        ("PGIM India", "PGIM India"),
        ("PGIM", "PGIM India"),
        ("Parag Parikh", "Parag Parikh"),
        ("PPFAS", "Parag Parikh"),
        ("Quant", "Quant"),
        ("Quantum", "Quantum"),
        ("Samco", "Samco"),
        ("Sapphire", "Sapphire"),
        ("SBI", "SBI"),
        ("Shriram", "Shriram"),
        ("Sundaram", "Sundaram"),
        ("Tata", "Tata"),
        ("Taurus", "Taurus"),
        ("Trust", "Trust"),
        ("Union", "Union"),
        ("UTI", "UTI"),
        ("WhiteOak Capital", "WhiteOak Capital"),
        ("WhiteOak", "WhiteOak Capital"),
        ("WSIF", "WSIF"),
        ("Zerodha", "Zerodha"),
        ("Unifi", "Unifi"),
        ("Abakkus", "Abakkus"),
        ("Aikyam", "Aikyam"),
        ("Diviniti", "Diviniti"),
        ("Altiva", "Altiva"),
        ("Titanium", "Titanium"),
        ("Arudha", "Arudha"),
        ("360 ONE", "360 ONE"),
        ("360 One", "360 ONE"),
        ("CHOICE", "Choice"),
        ("Choice", "Choice"),
        ("qsif", "QSIF"),
        ("QSIF", "QSIF"),
        ("Wealth Company", "Wealth Company"),
        ("The Wealth", "Wealth Company"),
    ]
    name = fund_name.strip()
    # Sort by prefix length descending to match longest first
    for prefix, canonical in sorted(AMC_MAP, key=lambda x: len(x[0]), reverse=True):
        if name.lower().startswith(prefix.lower()):
            return canonical
    # Fallback: return "Other" — better than showing full fund name or ISIN as AMC
    return "Other"


@router.get("/{isin}")
def get_fund_holdings(isin: str, portfolio_date: Optional[str] = None):
    """
    Returns the full holdings list + portfolio stats for one fund.
    If portfolio_date is omitted, returns the most recent snapshot.
    """
    from models.database import SessionLocal, FundHolding, FundPortfolioStats

    db = SessionLocal()
    try:
        q = db.query(FundHolding).filter(FundHolding.isin == isin)

        if portfolio_date:
            q = q.filter(FundHolding.portfolio_date == date.fromisoformat(portfolio_date))
        else:
            latest = (
                db.query(FundHolding.portfolio_date)
                .filter(FundHolding.isin == isin)
                .order_by(FundHolding.portfolio_date.desc())
                .first()
            )
            if not latest:
                raise HTTPException(404, f"No holdings data found for {isin}")
            q = q.filter(FundHolding.portfolio_date == latest[0])

        holdings = q.order_by(FundHolding.weighting.desc().nullslast()).all()

        stats = (
            db.query(FundPortfolioStats)
            .filter(FundPortfolioStats.isin == isin)
            .order_by(FundPortfolioStats.portfolio_date.desc())
            .first()
        )

        def holding_to_dict(h):
            return {
                "morningstar_id": h.morningstar_id,
                "holding_type": h.holding_type,
                "name": h.name,
                "isin": h.holding_isin,
                "ticker": h.ticker,
                "country": h.country,
                "currency": h.currency,
                "weighting": h.weighting,
                "number_of_shares": h.number_of_shares,
                "market_value": h.market_value,
                "share_change": h.share_change,
                "sector": h.sector,
                "global_sector": h.global_sector,
                "global_industry": h.global_industry,
                "stylebox": h.stylebox,
                "holding_ytd_return": h.holding_ytd_return,
                "first_bought_date": h.first_bought_date.isoformat() if h.first_bought_date else None,
                "maturity_date": h.maturity_date.isoformat() if h.maturity_date else None,
                "coupon": h.coupon,
                "indian_credit_quality": h.indian_credit_quality,
                "exchange_name": h.exchange_name,
            }

        def stats_to_dict(s):
            if not s:
                return None
            return {
                "portfolio_date": s.portfolio_date.isoformat() if s.portfolio_date else None,
                "number_of_holdings": s.number_of_holdings,
                "number_of_bond_holdings": s.number_of_bond_holdings,
                "number_of_stock_holdings": s.number_of_stock_holdings,
                "equity_stylebox_name": s.equity_stylebox_name,
                "fixed_inc_stylebox_name": s.fixed_inc_stylebox_name,
                "pe_ratio_ttm": s.pe_ratio_ttm,
                "pb_ratio_ttm": s.pb_ratio_ttm,
                "roe_ttm": s.roe_ttm,
                "roa_ttm": s.roa_ttm,
                "net_margin_trailing": s.net_margin_trailing,
                "modified_duration": s.modified_duration,
                "average_credit_quality": s.average_credit_quality,
                "yield_to_maturity": s.yield_to_maturity,
                "average_eff_maturity": s.average_eff_maturity,
                "asset_allocation": {
                    "equity": s.asset_alloc_equity_net,
                    "bond": s.asset_alloc_bond_net,
                    "cash": s.asset_alloc_cash_net,
                    "convertible": s.convertible_net,
                    "preferred_stock": s.preferred_stock_net,
                },
                "indian_asset_allocation": {
                    "stock": s.stock_long,
                    "bond_and_debentures": s.bond_and_debentures_long,
                    "cash_and_net_current_assets": s.cash_and_net_current_assets_long,
                    "government_securities": s.government_securities_long,
                    "money_market_instruments": s.money_market_instruments_long,
                    "banks_or_fi_including_nbfc": s.banks_or_fi_including_nbfc_long,
                    "cblos_or_repo": s.cblos_or_repo_long,
                },
                "market_cap_breakdown": {
                    "giant": s.market_cap_giant,
                    "large": s.market_cap_large,
                    "mid": s.market_cap_mid,
                    "small": s.market_cap_small,
                    "micro": s.market_cap_micro,
                },
                "sector_breakdown": {
                    "basic_materials": s.sector_basic_materials,
                    "communication_services": s.sector_communication_services,
                    "consumer_cyclical": s.sector_consumer_cyclical,
                    "consumer_defensive": s.sector_consumer_defensive,
                    "energy": s.sector_energy,
                    "financial_services": s.sector_financial_services,
                    "healthcare": s.sector_healthcare,
                    "industrials": s.sector_industrials,
                    "real_estate": s.sector_real_estate,
                    "technology": s.sector_technology,
                    "utilities": s.sector_utilities,
                },
                "fund_net_assets": s.fund_net_assets,
            }

        return {
            "isin": isin,
            "portfolio_date": holdings[0].portfolio_date.isoformat() if holdings else None,
            "holdings": [holding_to_dict(h) for h in holdings],
            "stats": stats_to_dict(stats),
        }

    finally:
        db.close()


@router.post("/fetch/{isin}")
def trigger_holdings_fetch(isin: str, background_tasks: BackgroundTasks):
    """Trigger a holdings fetch for a single fund — runs in background."""
    from services.morningstar_service import fetch_and_store_holdings, get_valid_accesscode

    accesscode = get_valid_accesscode()
    if not accesscode:
        raise HTTPException(503, "No valid Morningstar accesscode configured")

    background_tasks.add_task(fetch_and_store_holdings, isin, accesscode)
    return {"isin": isin, "status": "fetch_triggered"}


@router.post("/fetch-universe")
def trigger_universe_fetch(background_tasks: BackgroundTasks, limit: Optional[int] = None, skip_done: bool = True):
    """
    Trigger a holdings fetch for all funds in DailyFundData.
    Runs in background since 1,800 funds takes ~15 minutes at the throttled rate.
    Use `limit` to test with a small batch first.

    skip_done (default True): skip ISINs that already have a successful fetch
    logged in the last 24 hours. Without this, re-triggering the endpoint
    (e.g. after a crash/restart) re-processes already-done funds from the
    start of the list every time, wasting many minutes before reaching new
    ones — this looked exactly like a "stalled" fetch in practice. Pass
    skip_done=false to force a full re-fetch of everything regardless.
    """
    from services.morningstar_service import fetch_universe_holdings
    from models.database import SessionLocal, DailyFundData, HoldingsFetchLog
    from datetime import datetime, timedelta

    db = SessionLocal()
    try:
        latest_date = db.query(DailyFundData.data_date).order_by(DailyFundData.data_date.desc()).first()
        if not latest_date:
            raise HTTPException(404, "No fund data available")

        q = (
            db.query(DailyFundData.isin)
            .filter(
                DailyFundData.data_date == latest_date[0],
                DailyFundData.isin != None,
                DailyFundData.isin != "",
                DailyFundData.is_benchmark != 1,  # benchmarks often have no real ISIN
            )
            .distinct()
        )
        isins = [row[0] for row in q.all()]

        if skip_done:
            cutoff = datetime.utcnow() - timedelta(hours=24)
            already_done = {
                row[0] for row in db.query(HoldingsFetchLog.isin)
                .filter(HoldingsFetchLog.status == "success", HoldingsFetchLog.fetched_at >= cutoff)
                .distinct()
                .all()
            }
            before = len(isins)
            isins = [i for i in isins if i not in already_done]
            skipped = before - len(isins)
        else:
            skipped = 0

        if limit:
            isins = isins[:limit]
    finally:
        db.close()

    background_tasks.add_task(fetch_universe_holdings, isins)
    return {"status": "fetch_triggered", "fund_count": len(isins), "skipped_already_done": skipped}


@router.get("/admin/fetch-progress")
def get_fetch_progress(since: Optional[str] = None):
    """
    Aggregate progress for a holdings fetch run — e.g. "312/1947 funds processed".
    since: ISO datetime (e.g. "2026-07-07T11:00:00") to scope counts to a specific
    run. If omitted, defaults to all-time (NOT "start of today" — a long-running
    universe fetch can span midnight, and resetting the counter at midnight made
    an actively-progressing run look like it had "0 processed" right after
    rollover, which is misleading).
    """
    from models.database import SessionLocal, HoldingsFetchLog, DailyFundData
    from datetime import datetime

    db = SessionLocal()
    try:
        cutoff = datetime.fromisoformat(since) if since else datetime(2000, 1, 1)

        logs = db.query(HoldingsFetchLog).filter(HoldingsFetchLog.fetched_at >= cutoff).all()

        # Most recent status per ISIN (a fund may appear more than once if retried)
        latest_by_isin = {}
        for l in logs:
            if l.isin not in latest_by_isin or l.fetched_at > latest_by_isin[l.isin].fetched_at:
                latest_by_isin[l.isin] = l

        status_counts = {"success": 0, "failed": 0, "no_data": 0}
        for l in latest_by_isin.values():
            status_counts[l.status] = status_counts.get(l.status, 0) + 1

        processed = len(latest_by_isin)

        latest_date = db.query(DailyFundData.data_date).order_by(DailyFundData.data_date.desc()).first()
        total_universe = (
            db.query(DailyFundData.isin).filter(DailyFundData.data_date == latest_date[0]).distinct().count()
            if latest_date else None
        )

        last_activity = max((l.fetched_at for l in logs), default=None)

        return {
            "since": cutoff.isoformat(),
            "processed": processed,
            "total_universe": total_universe,
            "progress": f"{processed}/{total_universe}" if total_universe else str(processed),
            "status_counts": status_counts,
            "last_activity": last_activity.isoformat() if last_activity else None,
            "appears_stalled": (
                last_activity is not None and
                (datetime.utcnow() - last_activity).total_seconds() > 60
            ),
        }
    finally:
        db.close()


@router.get("/admin/fetch-status")
def get_fetch_status(limit: int = 50):
    """Returns recent holdings fetch log entries — for monitoring."""
    from models.database import SessionLocal, HoldingsFetchLog

    db = SessionLocal()
    try:
        logs = (
            db.query(HoldingsFetchLog)
            .order_by(HoldingsFetchLog.fetched_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "isin": l.isin,
                "status": l.status,
                "message": l.message,
                "fetched_at": l.fetched_at.isoformat() if l.fetched_at else None,
            }
            for l in logs
        ]
    finally:
        db.close()


@router.get("/admin/accesscode-status")
def get_accesscode_status():
    """Returns the current Morningstar accesscode status — for monitoring expiry."""
    from services.morningstar_service import get_stored_accesscode
    from datetime import date as date_type

    stored = get_stored_accesscode()
    if not stored:
        return {"status": "not_configured", "message": "No DB-managed accesscode yet — using env var fallback if set"}

    days_left = (stored["expires_at"] - date_type.today()).days
    return {
        "status": "active" if days_left > 0 else "expired",
        "expires_at": stored["expires_at"].isoformat(),
        "days_left": days_left,
    }