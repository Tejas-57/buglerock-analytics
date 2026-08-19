"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\debug_agg_candidates.py
Shows candidate pool and shrunk expected returns for aggressive model.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env'))

from models.database import SessionLocal
from services.db_service import get_latest_data_date
from routers.models import (
    MODELS, CORE_EQUITY_CATS, _get_funds, _pick_candidates,
    _pick_gold_candidates, _fetch_nav_returns, _shrink_returns,
    RISK_FREE_RATE
)

db = SessionLocal()
try:
    data_date = get_latest_data_date()
    all_funds = _get_funds(db, data_date)
    m = MODELS["aggressive"]

    eq_pool     = [f for f in all_funds if f["asset_class"] == "Equity" and f.get("category") in CORE_EQUITY_CATS]
    debt_pool   = [f for f in all_funds if f["asset_class"] == "Debt"]
    hybrid_pool = [f for f in all_funds if f["asset_class"] == "Hybrid"]
    gold_pool   = [f for f in all_funds if f["asset_class"] == "Precious Metals"]

    gold_candidates = _pick_gold_candidates(gold_pool, m.get("gold_lo",0), m.get("gold_hi",0))
    candidates = _pick_candidates(eq_pool, debt_pool, hybrid_pool, m)

    seen, cands = set(), []
    for f in candidates + gold_candidates:
        key = f.get("isin") or (f.get("name") or "").strip().lower()
        if key not in seen:
            seen.add(key); cands.append(f)
    candidates = cands

    isins = [f.get("isin") for f in candidates if f.get("isin")]
    nav_returns = _fetch_nav_returns(isins, db)
    shrunk_mu   = _shrink_returns(nav_returns, candidates)

    print(f"AGGRESSIVE — {len(candidates)} candidates\n")
    print(f"{'Category':45} {'Fund':45} {'ShrunkRet':>10} {'ExcessRet':>10}")
    print("-"*115)

    # Sort by shrunk return descending
    cands_sorted = sorted(candidates, key=lambda f: shrunk_mu.get(f.get("isin"), 0), reverse=True)
    for f in cands_sorted:
        isin = f.get("isin","")
        mu = shrunk_mu.get(isin, None)
        excess = (mu - RISK_FREE_RATE) if mu is not None else None
        print(f"  {(f.get('category') or ''):43} {f.get('name',''):43} {mu:>9.2f}%" if mu else f"  {(f.get('category') or ''):43} {f.get('name',''):43} {'N/A':>10}")

finally:
    db.close()