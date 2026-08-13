"""
debug_modcons.py — trace mod_conservative solver.
Run: cd buglerock-analytics/backend && python debug_modcons.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import numpy as np
from scipy.optimize import linprog
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from routers.models import (
    MODELS, CORE_EQUITY_CATS, MIN_FUNDS, MAX_FUNDS,
    MIN_W_TIGHT, MIN_W_LOOSE, FUND_COUNT_THRESHOLD,
    CAP_TOL, MAX_W, _s, _sf, _pick_candidates, _build_portfolio, _get_funds
)

db = SessionLocal()
data_date = get_latest_data_date()
all_f = _get_funds(db, data_date)
db.close()

m = MODELS["mod_conservative"]
eq_pool   = [f for f in all_f if f["asset_class"]=="Equity"  and f.get("category") in CORE_EQUITY_CATS]
debt_pool = [f for f in all_f if f["asset_class"]=="Debt"]
hyb_pool  = [f for f in all_f if f["asset_class"]=="Hybrid"]

print(f"Hybrid pool R1/R2 ({len(hyb_pool)} funds):")
from collections import Counter
for cat, cnt in sorted(Counter(f.get("category") for f in hyb_pool).items()):
    print(f"  {cnt}  {cat}")

cands = _pick_candidates(eq_pool, debt_pool, hyb_pool, m)
n = len(cands)
forced_max_w = min(MAX_W, 100.0 / MIN_FUNDS)

def get_eq(f):
    v = _s(f.get("equity_pct"))
    if v and v > 0: return v
    return 100.0 if f["asset_class"]=="Equity" else 0.0

def get_debt(f):
    if f["asset_class"]=="Debt": return 100.0
    if f.get("category")=="India Fund Arbitrage Fund": return 100.0
    v = _s(f.get("bond_pct"))
    if v and v > 0: return v
    return 0.0

eq_pct   = np.array([get_eq(f)   for f in cands])
debt_pct = np.array([get_debt(f) for f in cands])

print(f"\n=== CANDIDATE POOL ({n} funds) ===")
print(f"Target: eq={m['eq_lo']}–{m['eq_hi']}%  debt={m['debt_lo']}–{m['debt_hi']}%")
for i, f in enumerate(cands):
    print(f"  {i+1:2d}. [{f['asset_class'][:3]}] eq={eq_pct[i]:5.1f}% debt={debt_pct[i]:5.1f}%  {f['name'][:40]}")

print(f"\nMax equity at forced_max_w={forced_max_w:.1f}%: {np.sum(eq_pct)*forced_max_w/100:.1f}%  (need ≥{m['eq_lo']}%)")
print(f"Max debt   at forced_max_w={forced_max_w:.1f}%: {np.sum(debt_pct)*forced_max_w/100:.1f}%  (need ≥{m['debt_lo']}%)")

# Pass 1
A1 = np.array([-eq_pct/100, eq_pct/100, -debt_pct/100, debt_pct/100])
b1 = np.array([-m["eq_lo"], m["eq_hi"], -m["debt_lo"], m["debt_hi"]])
res1 = linprog(np.zeros(n), A_ub=A1, b_ub=b1,
               A_eq=np.ones((1,n)), b_eq=np.array([100.0]),
               bounds=[(0.0, forced_max_w)]*n, method="highs")
print(f"\nPass 1 (forced_max_w, no cap mix): {'FEASIBLE' if res1.status==0 else 'INFEASIBLE'}")
if res1.status == 0:
    w = res1.x.copy(); w[w<MIN_W_LOOSE]=0; total=w.sum()
    w=w/total*100; nz=np.sum(w>0)
    if nz<=FUND_COUNT_THRESHOLD:
        w2=w.copy(); w2[w2<MIN_W_TIGHT]=0
        if w2.sum()>0: w=w2/w2.sum()*100
    nz_f=np.sum(w>0)
    print(f"  {'✓' if nz_f>=MIN_FUNDS else '✗'} {nz_f} funds  eq={np.dot(w,eq_pct)/100:.1f}%  debt={np.dot(w,debt_pct)/100:.1f}%")
    for f,wi in zip(cands,w):
        if wi>0: print(f"    {wi:5.1f}%  [{f['asset_class'][:3]}]  {f['name'][:40]}")

# Pass 2
print(f"\nPass 2 (MAX_W={MAX_W}%, cap mix tolerance ladder):")
base_tol = m.get("cap_tol", CAP_TOL)
cap_l, cap_m, cap_s = m["cap_large"], m["cap_mid"], m["cap_small"]
eqc = eq_pct/100
for tol in [base_tol, base_tol+3, base_tol+6, base_tol+10, base_tol+15]:
    A2 = np.array([
        -eq_pct/100, eq_pct/100, -debt_pct/100, debt_pct/100,
        -eqc*(np.array([_sf(f.get("large_cap")) for f in cands])-(cap_l-tol)),
         eqc*(np.array([_sf(f.get("large_cap")) for f in cands])-(cap_l+tol)),
        -eqc*(np.array([_sf(f.get("mid_cap"))   for f in cands])-(cap_m-tol)),
         eqc*(np.array([_sf(f.get("mid_cap"))   for f in cands])-(cap_m+tol)),
        -eqc*(np.array([_sf(f.get("small_cap")) for f in cands])-(cap_s-tol)),
         eqc*(np.array([_sf(f.get("small_cap")) for f in cands])-(cap_s+tol)),
    ])
    b2 = np.array([-m["eq_lo"],m["eq_hi"],-m["debt_lo"],m["debt_hi"],0,0,0,0,0,0])
    r = linprog(np.zeros(n), A_ub=A2, b_ub=b2,
                A_eq=np.ones((1,n)), b_eq=np.array([100.0]),
                bounds=[(0.0,MAX_W)]*n, method="highs")
    if r.status==0:
        w2=r.x.copy(); w2[w2<MIN_W_LOOSE]=0
        if w2.sum()>0:
            w2=w2/w2.sum()*100; nz=np.sum(w2>0)
            print(f"  tol=±{tol:.0f}%  FEASIBLE  {nz} funds  eq={np.dot(w2,eq_pct)/100:.1f}%  debt={np.dot(w2,debt_pct)/100:.1f}%")
            if nz>=MIN_FUNDS:
                print(f"  ✓ passes at tol=±{tol:.0f}%")
                break
    else:
        print(f"  tol=±{tol:.0f}%  INFEASIBLE")