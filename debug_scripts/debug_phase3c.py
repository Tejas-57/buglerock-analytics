"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\debug_phase3c.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env'))

from models.database import SessionLocal
from routers.models import (
    MODELS, CORE_EQUITY_CATS, MIN_FUNDS,
    _get_funds, _pick_candidates, _pick_gold_candidates,
    _optimize_sharpe, _build_portfolio
)
import numpy as np
from services.db_service import get_latest_data_date

db = SessionLocal()
try:
    data_date = get_latest_data_date()
    all_funds = _get_funds(db, data_date)
    _build_portfolio._db = db

    for model_key in ["balanced", "mod_aggressive", "aggressive"]:
        m = MODELS[model_key]
        print(f"{'='*60}")
        print(f"MODEL: {model_key.upper()}")

        eq_pool     = [f for f in all_funds if f["asset_class"] == "Equity" and f.get("category") in CORE_EQUITY_CATS]
        debt_pool   = [f for f in all_funds if f["asset_class"] == "Debt"]
        hybrid_pool = [f for f in all_funds if f["asset_class"] == "Hybrid"]
        gold_pool   = [f for f in all_funds if f["asset_class"] == "Precious Metals"]

        gold_lo = m.get("gold_lo", 0); gold_hi = m.get("gold_hi", 0)
        gold_candidates = _pick_gold_candidates(gold_pool, gold_lo, gold_hi)
        candidates = _pick_candidates(eq_pool, debt_pool, hybrid_pool, m)

        seen, cands = set(), []
        for f in candidates + gold_candidates:
            key = f.get("isin") or (f.get("name") or "").strip().lower()
            if key not in seen:
                seen.add(key); cands.append(f)
        candidates = cands
        gold_isins = {f.get("isin") for f in gold_candidates if f.get("isin")}

        print(f"  Candidates: {len(candidates)}")

        qp_weights, qp_funds, used_method = _optimize_sharpe(
            candidates, m, gold_isins=gold_isins, db=db
        )

        qp_active = int(np.sum(qp_weights > 0)) if qp_weights is not None else 0
        min_funds_needed = m.get("min_funds", MIN_FUNDS)

        print(f"  used_method: {used_method}")
        print(f"  qp_weights shape: {qp_weights.shape if qp_weights is not None else None}")
        print(f"  qp_funds count: {len(qp_funds)}")
        print(f"  qp_active: {qp_active}")
        print(f"  min_funds_needed: {min_funds_needed}")
        print(f"  Would accept QP: {qp_weights is not None and qp_active >= min_funds_needed}")

        if qp_weights is not None:
            print(f"  Nonzero weights:")
            for f, w in zip(qp_funds, qp_weights):
                if w > 0:
                    print(f"    {w:5.1f}% | {f['asset_class']:12} | {f.get('name','')[:40]}")
        print()

finally:
    db.close()