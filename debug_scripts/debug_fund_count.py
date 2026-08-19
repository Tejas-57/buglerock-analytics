"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\debug_fund_count.py
Shows FW active funds before and after reduction for all 5 models,
plus detailed fund tables per model.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env'))

import numpy as np
from collections import defaultdict
from datetime import datetime
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from routers.models import (
    MODELS, CORE_EQUITY_CATS, MIN_FUNDS, TARGET_FUNDS_LO, TARGET_FUNDS_HI,
    MIN_W_LOOSE, MIN_W_TIGHT, FUND_COUNT_THRESHOLD, RISK_FREE_RATE,
    MAX_W, CAP_TOL, FUND_HOUSE_CAP,
    _get_funds, _pick_candidates, _pick_gold_candidates,
    _fetch_nav_returns, _shrink_returns, _build_covariance,
    _frank_wolfe_sharpe, _reduce_to_target, _s, _sf
)

db = SessionLocal()
run_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

try:
    data_date = get_latest_data_date()
    all_funds = _get_funds(db, data_date)

    print(f"\n{'='*90}")
    print(f"  MODEL PORTFOLIO FUND COUNT LOG — {run_time} | Data date: {data_date}")
    print(f"{'='*90}")

    # ── Summary table ─────────────────────────────────────────────────────────
    print(f"\n{'Model':20} {'Candidates':>10} {'FW Active':>10} {'After Reduce':>12} {'Dropped':>8}")
    print("-" * 65)

    all_model_data = {}

    for model_key in MODELS:
        m = MODELS[model_key]

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

        w_fw = _frank_wolfe_sharpe(mu_arr, Sigma, A_ub_np, b_ub_np, bounds)
        fw_active = int(np.sum(w_fw > 0)) if w_fw is not None else 0

        if w_fw is not None:
            w_final, _ = _reduce_to_target(qp_funds, w_fw, mu_arr, Sigma, A_ub_np, b_ub_np, bounds, gold_isins, m)
            after = int(np.sum(w_final > 0))
        else:
            w_final = None
            after = 0

        dropped = fw_active - after
        print(f"  {model_key:18} {len(candidates):>10} {fw_active:>10} {after:>12} {dropped:>8}")

        all_model_data[model_key] = {
            "candidates": candidates,
            "qp_funds": qp_funds,
            "shrunk_mu": shrunk_mu,
            "w_fw": w_fw,
            "w_final": w_final,
            "fw_active": fw_active,
            "after": after,
        }

    # ── Detailed fund tables per model ────────────────────────────────────────
    for model_key in MODELS:
        d = all_model_data[model_key]
        m = MODELS[model_key]
        qp_funds = d["qp_funds"]
        shrunk_mu = d["shrunk_mu"]
        w_fw    = d["w_fw"]
        w_final = d["w_final"]

        print(f"\n{'─'*90}")
        print(f"  {m['label'].upper()} — candidates: {len(d['candidates'])} | FW selected: {d['fw_active']} | Final: {d['after']}")
        print(f"{'─'*90}")
        print(f"  {'Fund':45} {'Category':30} {'ShrunkRet':>10} {'FW Wt':>7} {'FinalWt':>8} {'Status':>10}")
        print(f"  {'-'*45} {'-'*30} {'-'*10} {'-'*7} {'-'*8} {'-'*10}")

        # All candidate funds sorted by shrunk return desc
        all_cands = d["candidates"]
        # Map isin to FW and final weights
        isin_to_idx = {f.get("isin"): i for i, f in enumerate(qp_funds)}

        cands_sorted = sorted(all_cands, key=lambda f: shrunk_mu.get(f.get("isin"), 0), reverse=True)

        for f in cands_sorted:
            isin = f.get("isin", "")
            mu = shrunk_mu.get(isin)
            idx = isin_to_idx.get(isin)

            fw_w    = float(w_fw[idx])    if (w_fw    is not None and idx is not None) else 0.0
            final_w = float(w_final[idx]) if (w_final is not None and idx is not None) else 0.0

            if final_w >= 1.0:
                status = "✓ SELECTED"
            elif fw_w >= 1.0:
                status = "✗ DROPPED"
            else:
                status = "– excluded"

            mu_str = f"{mu:>8.1f}%" if mu is not None else f"{'N/A':>9}"
            fw_str  = f"{fw_w:>6.1f}%" if fw_w  > 0 else f"{'—':>7}"
            fin_str = f"{final_w:>7.1f}%" if final_w > 0 else f"{'—':>8}"

            print(f"  {f.get('name',''):45} {(f.get('category') or ''):30} {mu_str} {fw_str} {fin_str} {status:>10}")

    print(f"\n{'='*90}\n")

finally:
    db.close()