# backend/routers/holdings.py
"""
Fund holdings endpoints — backed by Morningstar NewPortfolioApi data.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from datetime import date
from typing import Optional

router = APIRouter()


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
    if len(isin_list) > 4:
        raise HTTPException(400, "Maximum 4 funds for overlap")

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
def trigger_universe_fetch(background_tasks: BackgroundTasks, limit: Optional[int] = None):
    """
    Trigger a holdings fetch for all funds in DailyFundData.
    Runs in background since 1,800 funds takes ~15 minutes at the throttled rate.
    Use `limit` to test with a small batch first.
    """
    from services.morningstar_service import fetch_universe_holdings
    from models.database import SessionLocal, DailyFundData

    db = SessionLocal()
    try:
        latest_date = db.query(DailyFundData.data_date).order_by(DailyFundData.data_date.desc()).first()
        if not latest_date:
            raise HTTPException(404, "No fund data available")

        q = db.query(DailyFundData.isin).filter(DailyFundData.data_date == latest_date[0]).distinct()
        if limit:
            q = q.limit(limit)
        isins = [row[0] for row in q.all()]
    finally:
        db.close()

    background_tasks.add_task(fetch_universe_holdings, isins)
    return {"status": "fetch_triggered", "fund_count": len(isins)}


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