"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\debug_phase3.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env'))

from models.database import SessionLocal
from sqlalchemy import text
from routers.models import (
    MODELS, CORE_EQUITY_CATS, MIN_FUNDS,
    _get_funds, _pick_candidates, _pick_gold_candidates,
    _fetch_nav_returns, _shrink_returns, _build_covariance,
    _frank_wolfe_sharpe, _s, _sf, CAP_TOL, MAX_W, FUND_HOUSE_CAP,
    MIN_W_LOOSE, MIN_W_TIGHT, FUND_COUNT_THRESHOLD, RISK_FREE_RATE
)
import numpy as np
from collections import defaultdict
from services.db_service import get_latest_data_date

db = SessionLocal()
try:
    data_date = get_latest_data_date()
    all_funds = _get_funds(db, data_date)
    print(f"Data date: {data_date} | Total funds: {len(all_funds)}\n")

    for model_key in MODELS:
        m = MODELS[model_key]
        print(f"{'='*60}")
        print(f"MODEL: {model_key.upper()}")

        eq_pool     = [f for f in all_funds if f["asset_class"] == "Equity" and f.get("category") in CORE_EQUITY_CATS]
        debt_pool   = [f for f in all_funds if f["asset_class"] == "Debt"]
        hybrid_pool = [f for f in all_funds if f["asset_class"] == "Hybrid"]
        gold_pool   = [f for f in all_funds if f["asset_class"] == "Precious Metals"]

        gold_lo = m.get("gold_lo", 0)
        gold_hi = m.get("gold_hi", 0)
        gold_candidates = _pick_gold_candidates(gold_pool, gold_lo, gold_hi)
        candidates = _pick_candidates(eq_pool, debt_pool, hybrid_pool, m)

        seen, candidates_deduped = set(), []
        for f in candidates + gold_candidates:
            key = f.get("isin") or (f.get("name") or "").strip().lower()
            if key not in seen:
                seen.add(key)
                candidates_deduped.append(f)
        candidates = candidates_deduped
        gold_isins = {f.get("isin") for f in gold_candidates if f.get("isin")}

        print(f"  Candidates: {len(candidates)} (gold: {len(gold_candidates)})")

        isins = [f.get("isin") for f in candidates if f.get("isin")]
        no_isin = [f.get("name") for f in candidates if not f.get("isin")]
        if no_isin:
            print(f"  Funds with NO isin: {no_isin}")

        nav_returns = _fetch_nav_returns(isins, db)
        print(f"  Nav returns fetched: {len(nav_returns)}/{len(isins)}")

        missing_nav = [i for i in isins if i not in nav_returns]
        if missing_nav:
            for isin in missing_nav:
                f = next((x for x in candidates if x.get("isin") == isin), None)
                name = f.get("name","?") if f else "?"
                print(f"    Missing NAV: {isin} | {name}")

        shrunk_mu = _shrink_returns(nav_returns, candidates)
        print(f"  Shrunk returns computed: {len(shrunk_mu)}")

        valid_isins_for_cov = [f.get("isin") for f in candidates if f.get("isin") in nav_returns]
        Sigma, valid_isins = _build_covariance(nav_returns, valid_isins_for_cov)
        print(f"  Covariance matrix: {len(valid_isins)}x{len(valid_isins)} | Sigma={'OK' if Sigma is not None else 'FAILED'}")

        if Sigma is not None and len(valid_isins) >= 4:
            isin_to_fund = {f.get("isin"): f for f in candidates}
            qp_funds = [isin_to_fund[i] for i in valid_isins if i in isin_to_fund]
            print(f"  QP funds: {len(qp_funds)}")

            mu_arr = np.array([
                shrunk_mu.get(f.get("isin"), 10.0) - RISK_FREE_RATE
                for f in qp_funds
            ])
            print(f"  mu range: {mu_arr.min():.2f}% to {mu_arr.max():.2f}% (excess return)")

            # Check if constraints are feasible
            cap_l = m["cap_large"]; cap_m = m["cap_mid"]; cap_s = m["cap_small"]
            cap_tol = m.get("cap_tol", CAP_TOL)
            n = len(qp_funds)

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

            eq_pct   = np.array([get_eq_pct(f) for f in qp_funds])
            debt_pct = np.array([get_debt_pct(f) for f in qp_funds])
            large    = np.array([_sf(f.get("large_cap")) for f in qp_funds])
            mid      = np.array([_sf(f.get("mid_cap")) for f in qp_funds])
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

            # Test LP feasibility first
            from scipy.optimize import linprog
            res = linprog(np.zeros(n), A_ub=A_ub_np, b_ub=b_ub_np,
                          A_eq=np.ones((1,n)), b_eq=np.array([100.0]),
                          bounds=bounds, method="highs")
            print(f"  LP feasibility: {'FEASIBLE' if res.status==0 else f'INFEASIBLE (status={res.status})'}")

            if res.status == 0:
                w = _frank_wolfe_sharpe(mu_arr, Sigma, A_ub_np, b_ub_np, bounds)
                print(f"  Frank-Wolfe: {'OK' if w is not None else 'FAILED'}")
                if w is not None:
                    active = np.where(w > 0)[0]
                    port_ret = w @ mu_arr / 100
                    port_var = (w @ Sigma @ w) / 10000
                    sharpe = port_ret / (port_var**0.5) if port_var > 0 else 0
                    print(f"  Sharpe: {sharpe:.4f} | Active funds: {len(active)}")
        else:
            print(f"  QP SKIPPED — Sigma=None or valid_isins < 4")
        print()

finally:
    db.close()