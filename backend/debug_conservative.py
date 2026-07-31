"""Run from backend dir: python debug_conservative.py"""
import sys
sys.path.insert(0, '.')
import numpy as np
from scipy.optimize import linprog
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text
from collections import defaultdict

MIN_W, MAX_W = 5.0, 20.0
CAP_LARGE, CAP_MID, CAP_SMALL, CAP_TOL = 60.0, 25.0, 15.0, 10.0

CORE_EQUITY_CATS = {
    "India Fund Large-Cap","India Fund Large & Mid-Cap","Cat: Flexi Cap Funds",
    "Cat: Multi Cap Funds","India Fund Focused Fund","India Fund Mid-Cap",
    "India Fund Small-Cap","Cat: Contra / Value Funds",
}
DEBT_RISK_TIER = {
    "India OE Overnight":1,"India OE Liquid":1,"India OE Money Market":1,
    "India OE Ultra Short Duration":1,"India OE Low Duration":2,
    "India OE Floating Rate":2,"India OE Banking & PSU":2,
    "India OE Short Duration":3,"India OE Corporate Bond":3,
    "India OE Medium Duration":4,"India OE Medium to Long Duration":4,
    "India OE Dynamic Bond":4,"India OE Government Bond":5,"India OE Credit Risk":5,
}
HYBRID_RISK_TIER = {
    "India Fund Arbitrage Fund":1,"India Fund Conservative Allocation":1,
    "India Fund Equity Savings - Conservative":2,"India Fund Dynamic Asset Allocation":3,
    "India Fund Equity Savings - Aggressive":3,"India Fund Aggressive Allocation":4,
}

db = SessionLocal()
date = get_latest_data_date()
rows = db.execute(text("""
    SELECT isin, name, asset_class, category, equity_pct, bond_pct,
           large_cap, mid_cap, small_cap, sharpe_ratio_3y
    FROM daily_fund_data
    WHERE data_date = :date AND ranking IN ('R1','R2') AND nav IS NOT NULL
"""), {"date": str(date)}).fetchall()
db.close()
all_funds = [dict(r._mapping) for r in rows]

sf = lambda v, d=0.0: float(v) if v is not None else d

eq_pool = [f for f in all_funds if f["asset_class"]=="Equity" and f.get("category") in CORE_EQUITY_CATS]
debt_pool = [f for f in all_funds if f["asset_class"]=="Debt"]
hyb_pool  = [f for f in all_funds if f["asset_class"]=="Hybrid"]

# Conservative: n_equity=3, n_debt=4, n_hybrid=2
# Pick 1 best per equity category by Sharpe
by_cat = defaultdict(list)
for f in eq_pool:
    by_cat[f.get("category","")].append(f)
cat_reps = [max(fs, key=lambda f: sf(f.get("sharpe_ratio_3y"))) for fs in by_cat.values()]
def cap_dev(f): return abs(sf(f.get("large_cap"))-60)+abs(sf(f.get("mid_cap"))-25)+abs(sf(f.get("small_cap"))-15)
eq_sorted = sorted(cat_reps, key=cap_dev)

debt_allowed = {c for c,t in DEBT_RISK_TIER.items() if t in [1,2,3]}
hyb_allowed  = {c for c,t in HYBRID_RISK_TIER.items() if t in [1,2]}
debt_sorted = sorted([f for f in debt_pool if f.get("category") in debt_allowed],
                     key=lambda f: sf(f.get("sharpe_ratio_3y")), reverse=True)
hyb_sorted  = sorted([f for f in hyb_pool if f.get("category") in hyb_allowed],
                     key=lambda f: sf(f.get("sharpe_ratio_3y")), reverse=True)

candidates = eq_sorted[:3] + debt_sorted[:4] + hyb_sorted[:2]
print(f"Conservative candidates ({len(candidates)}):")
for f in candidates:
    eq = sf(f.get("equity_pct"), 100 if f["asset_class"]=="Equity" else 0)
    bd = sf(f.get("bond_pct"),   100 if f["asset_class"]=="Debt"   else 0)
    print(f"  {f['asset_class']:<8} eq={eq:>5.1f}% bd={bd:>5.1f}%  {f['name'][:45]}")

# Check feasibility
eq_pct   = np.array([sf(f.get("equity_pct"),100 if f["asset_class"]=="Equity" else 0) for f in candidates])
debt_pct = np.array([sf(f.get("bond_pct"),  100 if f["asset_class"]=="Debt"   else 0) for f in candidates])
n = len(candidates)

print(f"\nTarget equity: 27–33%")
print(f"Min effective equity (all at MIN_W): {sum(eq_pct*MIN_W/100):.1f}%")
print(f"Max effective equity (all at MAX_W): {sum(eq_pct*MAX_W/100):.1f}%")
print(f"Min effective debt: {sum(debt_pct*MIN_W/100):.1f}%")
print(f"Max effective debt: {sum(debt_pct*MAX_W/100):.1f}%")

# Try solve
A,b=[],[]
A.append(-eq_pct/100); b.append(-27)
A.append(eq_pct/100);  b.append(33)
A.append(-debt_pct/100); b.append(-67)
A.append(debt_pct/100);  b.append(73)
eqc = eq_pct/100
large = np.array([sf(f.get("large_cap")) for f in candidates])
mid   = np.array([sf(f.get("mid_cap"))   for f in candidates])
small = np.array([sf(f.get("small_cap")) for f in candidates])
for cap,t in [(large,60),(mid,25),(small,15)]:
    A.append(-eqc*(cap-(t-10))); b.append(0)
    A.append(eqc*(cap-(t+10))); b.append(0)
r = linprog(np.zeros(n),A_ub=np.array(A),b_ub=np.array(b),
            A_eq=np.ones((1,n)),b_eq=np.array([100.0]),
            bounds=[(MIN_W,MAX_W)]*n, method="highs")
print(f"\nStatus: {r.status} ({r.message})")
if r.status == 0:
    w = r.x/r.x.sum()*100
    eff_eq = sum(w*eq_pct/100)
    eff_db = sum(w*debt_pct/100)
    print(f"Solved! Effective equity={eff_eq:.1f}% debt={eff_db:.1f}%")
    for i,(f,wi) in enumerate(zip(candidates,w)):
        print(f"  {wi:5.1f}%  {f['name'][:45]}")