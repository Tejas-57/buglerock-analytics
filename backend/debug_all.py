"""Run: cd backend && python debug_all.py"""
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

MODELS = {
    "conservative":    {"eq_lo":27,"eq_hi":33,"debt_lo":67,"debt_hi":73,"debt_tiers":[1,2,3],"hybrid_tiers":[2]},
    "mod_conservative":{"eq_lo":32,"eq_hi":38,"debt_lo":62,"debt_hi":68,"debt_tiers":[2,3,4],"hybrid_tiers":[1,2,3]},
    "balanced":        {"eq_lo":47,"eq_hi":53,"debt_lo":47,"debt_hi":53,"debt_tiers":[3,4],"hybrid_tiers":[2,3,4]},
    "mod_aggressive":  {"eq_lo":67,"eq_hi":73,"debt_lo":27,"debt_hi":33,"debt_tiers":[4,5],"hybrid_tiers":[3,4]},
    "aggressive":      {"eq_lo":77,"eq_hi":83,"debt_lo":17,"debt_hi":23,"debt_tiers":[4,5],"hybrid_tiers":[3,4]},
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

def sf(v, d=0.0): return float(v) if v is not None else d
def get_eq(f):
    v = float(f["equity_pct"]) if f["equity_pct"] else None
    if v and v > 0: return v
    return 100.0 if f["asset_class"]=="Equity" else 0.0
def get_debt(f):
    v = float(f["bond_pct"]) if f["bond_pct"] else None
    if v and v > 0: return v
    return 100.0 if f["asset_class"]=="Debt" else 0.0

def cap_dev(f):
    return abs(sf(f["large_cap"])-60)+abs(sf(f["mid_cap"])-25)+abs(sf(f["small_cap"])-15)

def best_per_cat(pool):
    bc = defaultdict(list)
    for f in pool: bc[f["category"]].append(f)
    return [min(fs, key=cap_dev) for fs in bc.values()]

eq_pool = [f for f in all_funds if f["asset_class"]=="Equity" and f["category"] in CORE_EQUITY_CATS]
debt_pool = [f for f in all_funds if f["asset_class"]=="Debt"]
hyb_pool  = [f for f in all_funds if f["asset_class"]=="Hybrid"]

print(f"Pools: eq={len(eq_pool)} debt={len(debt_pool)} hyb={len(hyb_pool)}\n")

for mname, m in MODELS.items():
    debt_ok = [f for f in debt_pool if f["category"] in {c for c,t in DEBT_RISK_TIER.items() if t in m["debt_tiers"]}]
    hyb_ok  = [f for f in hyb_pool  if f["category"] in {c for c,t in HYBRID_RISK_TIER.items() if t in m["hybrid_tiers"]}]
    
    candidates = best_per_cat(eq_pool) + best_per_cat(debt_ok or debt_pool) + best_per_cat(hyb_ok or hyb_pool)
    n = len(candidates)
    
    eq_pct   = np.array([get_eq(f)   for f in candidates])
    debt_pct = np.array([get_debt(f) for f in candidates])
    large    = np.array([sf(f["large_cap"]) for f in candidates])
    mid      = np.array([sf(f["mid_cap"])   for f in candidates])
    small    = np.array([sf(f["small_cap"]) for f in candidates])
    eqc      = eq_pct/100
    
    # Check feasibility ranges
    min_eq = sum(sorted(eq_pct*MIN_W/100))
    max_eq = sum(sorted(eq_pct*MAX_W/100, reverse=True))
    min_db = sum(sorted(debt_pct*MIN_W/100))
    max_db = sum(sorted(debt_pct*MAX_W/100, reverse=True))
    
    print(f"{mname}: {n} candidates")
    print(f"  Equity range: {min_eq:.1f}–{max_eq:.1f}%  Target: {m['eq_lo']}–{m['eq_hi']}%  {'OK' if max_eq>=m['eq_lo'] and min_eq<=m['eq_hi'] else 'INFEASIBLE'}")
    print(f"  Debt range:   {min_db:.1f}–{max_db:.1f}%  Target: {m['debt_lo']}–{m['debt_hi']}%  {'OK' if max_db>=m['debt_lo'] and min_db<=m['debt_hi'] else 'INFEASIBLE'}")
    
    # Try solve
    A,b=[],[]
    A.append(-eq_pct/100);b.append(-m["eq_lo"])
    A.append(eq_pct/100);b.append(m["eq_hi"])
    A.append(-debt_pct/100);b.append(-m["debt_lo"])
    A.append(debt_pct/100);b.append(m["debt_hi"])
    for cap,t in [(large,60),(mid,25),(small,15)]:
        A.append(-eqc*(cap-(t-10)));b.append(0)
        A.append(eqc*(cap-(t+10)));b.append(0)
    r = linprog(np.zeros(n),A_ub=np.array(A),b_ub=np.array(b),
                A_eq=np.ones((1,n)),b_eq=np.array([100.0]),
                bounds=[(MIN_W,MAX_W)]*n,method="highs")
    print(f"  Solver: {'OK' if r.status==0 else 'INFEASIBLE - '+r.message}")
    if r.status==0:
        w=r.x/r.x.sum()*100
        eff_eq=sum(w*eq_pct/100); eff_db=sum(w*debt_pct/100)
        cap_w=sum(w*eqc); rb_l=sum(w*eqc*large)/cap_w if cap_w>0 else 0
        rb_m=sum(w*eqc*mid)/cap_w if cap_w>0 else 0
        print(f"  Result: eq={eff_eq:.1f}% debt={eff_db:.1f}% L={rb_l:.0f}% M={rb_m:.0f}%")
    print()