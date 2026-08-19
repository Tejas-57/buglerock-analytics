"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\debug_phase3d.py
Traces _reduce_to_target step by step for balanced and mod_aggressive.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env'))

import numpy as np
from collections import defaultdict
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from routers.models import (
    MODELS, CORE_EQUITY_CATS, MIN_FUNDS, TARGET_FUNDS_LO, TARGET_FUNDS_HI,
    MIN_W_LOOSE, MIN_W_TIGHT, FUND_COUNT_THRESHOLD, RISK_FREE_RATE,
    MAX_W, CAP_TOL, FUND_HOUSE_CAP,
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
        print(f"  min_funds={m.get('min_funds', MIN_FUNDS)}, lo=min({TARGET_FUNDS_LO},{m.get('min_funds',MIN_FUNDS)})={min(TARGET_FUNDS_LO, m.get('min_funds', MIN_FUNDS))}")

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
        valid_isins_for_cov = [f.get("isin") for f in candidates if f.get("isin") in nav_returns]
        Sigma, valid_isins = _build_covariance(nav_returns, valid_isins_for_cov)
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
            gm = np.array([1.0 if f.get("isin") in gold_isins else 0.0 for f in qp_funds])
            if gm.sum() > 0:
                A_ub.append(-gm); b_ub.append(-gold_lo)
                A_ub.append( gm); b_ub.append( gold_hi)
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

        w = _frank_wolfe_sharpe(mu_arr, Sigma, A_ub_np, b_ub_np, bounds)
        print(f"  FW active funds: {int(np.sum(w > 0))}")

        # Manual step-by-step reduction
        lo = min(TARGET_FUNDS_LO, m.get("min_funds", MIN_FUNDS))
        hi = TARGET_FUNDS_HI

        def sharpe_of(w_, idxs):
            mu_k = mu_arr[idxs]; S_k = Sigma[np.ix_(idxs, idxs)]
            ret = w_ @ mu_k / 100
            var = (w_ @ S_k @ w_) / 10000
            return ret / (var**0.5) if var > 1e-10 else 0.0

        w_cur = w.copy()
        w_cur[w_cur < MIN_W_LOOSE] = 0.0
        if w_cur.sum() > 0: w_cur = w_cur / w_cur.sum() * 100
        active = np.where(w_cur > 0)[0].tolist()
        last_good = active[:]
        step = 0

        while len(active) > hi:
            step += 1
            print(f"\n  Step {step}: active={len(active)}, trying to drop to {hi}")
            best_drop = None; best_shp = -np.inf; best_keep = None; best_wk = None
            for drop_i in active:
                keep = [i for i in active if i != drop_i]
                if len(keep) < lo: continue
                mu_k = mu_arr[keep]; S_k = Sigma[np.ix_(keep, keep)]
                A_k = A_ub_np[:, keep]; bds_k = [bounds[i] for i in keep]
                wk = _frank_wolfe_sharpe(mu_k, S_k, A_k, b_ub_np, bds_k, max_iter=100)
                if wk is None:
                    wk = np.ones(len(keep)) * (100.0 / len(keep))
                    print(f"    drop {qp_funds[drop_i].get('name','?')[:30]:30} FW failed — using equal weight proxy")
                shp = sharpe_of(wk, keep)
                if shp > best_shp:
                    best_shp = shp; best_drop = drop_i; best_keep = keep; best_wk = wk

            if best_drop is None:
                print(f"  No valid drop found — stopping")
                break

            dropped_name = qp_funds[best_drop].get('name','?')
            active = best_keep
            print(f"  Dropping: {dropped_name[:40]} | Remaining: {len(active)} | Sharpe after: {best_shp:.4f}")
            if len(active) >= lo:
                last_good = active[:]
                print(f"  last_good updated: {len(last_good)} funds")

        final_active = np.where(w_cur > 0)[0].tolist()
        print(f"\n  Final active: {len(active)} | last_good: {len(last_good)}")
        print(f"  Would restore to last_good: {len(active) < lo}")

finally:
    db.close()