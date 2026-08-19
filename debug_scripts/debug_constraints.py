"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\debug_constraints.py
Tests which constraint is limiting fund count for balanced and mod_aggressive.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env'))

import numpy as np
from collections import defaultdict
from scipy.optimize import linprog
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from routers.models import (
    MODELS, CORE_EQUITY_CATS, MIN_FUNDS, TARGET_FUNDS_LO, TARGET_FUNDS_HI,
    MIN_W_LOOSE, RISK_FREE_RATE, MAX_W, CAP_TOL, FUND_HOUSE_CAP,
    _get_funds, _pick_candidates, _pick_gold_candidates,
    _fetch_nav_returns, _shrink_returns, _build_covariance,
    _frank_wolfe_sharpe, _s, _sf
)

db = SessionLocal()
try:
    data_date = get_latest_data_date()
    all_funds = _get_funds(db, data_date)

    for model_key in ["balanced", "mod_aggressive"]:
        m = MODELS[model_key]
        print(f"\n{'='*60}")
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

        isins = [f.get("isin") for f in candidates if f.get("isin")]
        nav_returns = _fetch_nav_returns(isins, db)
        shrunk_mu   = _shrink_returns(nav_returns, candidates)
        valid_isins = [f.get("isin") for f in candidates if f.get("isin") in nav_returns]
        Sigma, valid_isins = _build_covariance(nav_returns, valid_isins)
        isin_to_fund = {f.get("isin"): f for f in candidates}
        qp_funds = [isin_to_fund[i] for i in valid_isins if i in isin_to_fund]
        n = len(qp_funds)
        mu_arr = np.array([shrunk_mu.get(f.get("isin"), 10.0) - RISK_FREE_RATE for f in qp_funds])

        cap_l = m["cap_large"]; cap_m = m["cap_mid"]; cap_s = m["cap_small"]
        cap_tol = m.get("cap_tol", CAP_TOL)

        def get_eq_pct(f):
            v = _s(f.get("equity_pct"))
            if v is not None and v > 0: return v
            return 100.0 if f["asset_class"] == "Equity" else 0.0
        def get_debt_pct(f):
            if f["asset_class"] == "Debt": return 100.0
            v = _s(f.get("bond_pct"))
            if v is not None and v > 0: return v
            return 0.0

        eq_pct   = np.array([get_eq_pct(f) for f in qp_funds])
        debt_pct = np.array([get_debt_pct(f) for f in qp_funds])
        large    = np.array([_sf(f.get("large_cap")) for f in qp_funds])
        mid      = np.array([_sf(f.get("mid_cap")) for f in qp_funds])
        small    = np.array([_sf(f.get("small_cap")) for f in qp_funds])
        eq_wc    = eq_pct / 100.0

        def build_A_ub(include_house_cap=True, house_cap=30.0, include_gold=True, include_cap_mix=True):
            A, b = [], []
            A.append(-eq_pct/100);  b.append(-m["eq_lo"])
            A.append( eq_pct/100);  b.append( m["eq_hi"])
            A.append(-debt_pct/100); b.append(-m["debt_lo"])
            A.append( debt_pct/100); b.append( m["debt_hi"])
            if include_cap_mix:
                A.append(-eq_wc*(large-(cap_l-cap_tol))); b.append(0)
                A.append( eq_wc*(large-(cap_l+cap_tol))); b.append(0)
                A.append(-eq_wc*(mid  -(cap_m-cap_tol))); b.append(0)
                A.append( eq_wc*(mid  -(cap_m+cap_tol))); b.append(0)
                A.append(-eq_wc*(small-(cap_s-cap_tol))); b.append(0)
                A.append( eq_wc*(small-(cap_s+cap_tol))); b.append(0)
            if include_gold and gold_isins and gold_lo > 0:
                gm = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in qp_funds])
                if gm.sum() > 0:
                    A.append(-gm); b.append(-gold_lo)
                    A.append( gm); b.append( gold_hi)
            if include_house_cap:
                house_idx = defaultdict(list)
                for i, f in enumerate(qp_funds):
                    h = (f.get("branding_name") or "").strip()
                    if h: house_idx[h].append(i)
                for h, idxs in house_idx.items():
                    if len(idxs) > 1:
                        row = np.zeros(n); row[idxs] = 1.0
                        A.append(row); b.append(house_cap)
            return np.array(A), np.array(b)

        bounds = [(0.0, MAX_W)] * n

        configs = [
            ("All constraints (30% house cap)", dict(include_house_cap=True,  house_cap=30.0)),
            ("House cap relaxed to 40%",        dict(include_house_cap=True,  house_cap=40.0)),
            ("House cap relaxed to 50%",        dict(include_house_cap=True,  house_cap=50.0)),
            ("No house cap",                    dict(include_house_cap=False)),
            ("No cap mix",                      dict(include_house_cap=True,  house_cap=30.0, include_cap_mix=False)),
            ("No gold constraint",              dict(include_house_cap=True,  house_cap=30.0, include_gold=False)),
        ]

        for label, kwargs in configs:
            A_ub, b_ub = build_A_ub(**kwargs)
            w = _frank_wolfe_sharpe(mu_arr, Sigma, A_ub, b_ub, bounds)
            if w is not None:
                active = int(np.sum(w > 0))
                port_ret = w @ mu_arr / 100
                port_var = (w @ Sigma @ w) / 10000
                sharpe = port_ret / (port_var**0.5) if port_var > 0 else 0
                print(f"  {label:40} → {active:2} funds | Sharpe {sharpe:.3f}")
            else:
                print(f"  {label:40} → FAILED")

finally:
    db.close()