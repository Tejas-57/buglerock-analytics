"""Test with different max_w values"""
import sys
sys.path.insert(0, '.')
import numpy as np
from scipy.optimize import linprog
from routers.models import (MODELS, _pick_candidates, _get_eq_pct, _get_debt_pct, _sf,
    CORE_EQUITY_CATS, MIN_FUNDS)
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text

db = SessionLocal(); date = get_latest_data_date()
rows = db.execute(text("""SELECT * FROM daily_fund_data WHERE data_date = :date
    AND ranking IN ('R1','R2') AND nav IS NOT NULL"""), {"date": str(date)}).fetchall()
all_f = [dict(r._mapping) for r in rows]; db.close()

m = MODELS["conservative"]
eq_pool = [f for f in all_f if f["asset_class"]=="Equity" and f.get("category") in CORE_EQUITY_CATS]
debt_pool = [f for f in all_f if f["asset_class"]=="Debt"]
hyb_pool = [f for f in all_f if f["asset_class"]=="Hybrid"]
funds = _pick_candidates(eq_pool, debt_pool, hyb_pool, m)
n = len(funds)

eq_pct = np.array([_get_eq_pct(f) for f in funds])
debt_pct = np.array([_get_debt_pct(f) for f in funds])

print(f"Candidates ({n}):")
for i,f in enumerate(funds):
    print(f"  [{i}] {f['asset_class']:<8} eq={eq_pct[i]:5.1f}% bd={debt_pct[i]:5.1f}%  {f['name'][:40]}")

# max eq if all equity funds at 20%
print(f"\nEquity funds: {sum(1 for e in eq_pct if e > 50)}")
print(f"Max possible equity (all equity at 20%): {sum(20*e/100 for e in eq_pct if e>50):.1f}%")
print(f"Max possible equity (all equity at 11.1%): {sum(11.1*e/100 for e in eq_pct if e>50):.1f}%")

# Try WITHOUT MIN_FUNDS constraint
for max_w in [20, 15, 11.1, 10, 8]:
    bounds = [(0.0, max_w)] * n
    A_ub = [-eq_pct/100, eq_pct/100, -debt_pct/100, debt_pct/100]
    b_ub = [-m["eq_lo"], m["eq_hi"], -m["debt_lo"], m["debt_hi"]]
    r = linprog(np.zeros(n), A_ub=np.array(A_ub), b_ub=np.array(b_ub),
                A_eq=np.ones((1,n)), b_eq=np.array([100.0]),
                bounds=bounds, method="highs")
    if r.status == 0:
        w = r.x
        used = np.sum(w > 0.1)
        eff_eq = np.dot(w, eq_pct)/100
        eff_db = np.dot(w, debt_pct)/100
        print(f"\nmax_w={max_w}: ✓ used={used}, eq={eff_eq:.1f}% db={eff_db:.1f}%")
        for i,wi in enumerate(w):
            if wi > 0.1: print(f"    {wi:5.1f}%  {funds[i]['name'][:40]}")
    else:
        print(f"\nmax_w={max_w}: ✗ INFEASIBLE - {r.message}")