"""
debug_cons_vs_modcons.py — compare fund selection and returns for cons vs mod_cons.
Run: cd buglerock-analytics/backend && python debug_cons_vs_modcons.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

from models.database import SessionLocal
from services.db_service import get_latest_data_date
from routers.models import MODELS, CORE_EQUITY_CATS, _build_portfolio, _get_funds, _s, _sf

db = SessionLocal()
data_date = get_latest_data_date()
all_f = _get_funds(db, data_date)
db.close()

for k in ["conservative", "mod_conservative"]:
    p = _build_portfolio(k, all_f)
    b = p["blended"]
    print(f"\n{'='*65}")
    print(f"{p['label']}  —  {p['fund_count']} funds  eq={p['actual']['equity_pct']}%  debt={p['actual']['debt_pct']}%")
    print(f"  Blended: 1Y={b['return_1y']}%  3Y={b['return_3y']}%  5Y={b['return_5y']}%  StdDev3Y={b['std_dev_3y']}%  Sharpe={b['sharpe_3y']}")
    print()
    print(f"  {'Fund':<38} {'Sleeve':<7} {'Wt%':>5}  {'1Y':>6}  {'3Y':>6}  {'5Y':>6}  {'StdDev3Y':>9}  {'Sharpe':>7}")
    print(f"  {'-'*95}")
    for f in p["funds"]:
        r1  = f"{f['return_1y']:+.1f}%" if f.get('return_1y') is not None else "—"
        r3  = f"{f['return_3y']:+.1f}%" if f.get('return_3y') is not None else "—"
        r5  = f"{f['return_5y']:+.1f}%" if f.get('return_5y') is not None else "—"
        sd3 = f"{f['std_dev_3y']:.1f}%" if f.get('std_dev_3y') is not None else "—"
        sh  = f"{f['sharpe_3y']:.2f}"   if f.get('sharpe_3y') is not None else "—"
        print(f"  {f['name']:<38} {f['sleeve']:<7} {f['weight']:>5.1f}  {r1:>6}  {r3:>6}  {r5:>6}  {sd3:>9}  {sh:>7}")

# Also show what equity/hybrid funds are available for each
print(f"\n\n{'='*65}")
print("EQUITY pool available for cons (allowed_equity_cats):")
cons_eq_cats = set(MODELS["conservative"].get("allowed_equity_cats") or CORE_EQUITY_CATS)
modcons_eq_cats = set(MODELS["mod_conservative"].get("allowed_equity_cats") or CORE_EQUITY_CATS)

eq_pool = [f for f in all_f if f["asset_class"]=="Equity" and f.get("category") in CORE_EQUITY_CATS]
for f in sorted(eq_pool, key=lambda x: -(x.get("return_3y") or 0)):
    in_cons    = "✓" if f.get("category") in cons_eq_cats else " "
    in_modcons = "✓" if f.get("category") in modcons_eq_cats else " "
    r3 = f"{f['return_3y']:+.1f}%" if f.get('return_3y') is not None else "—"
    print(f"  Cons:{in_cons} ModCons:{in_modcons}  3Y={r3:>7}  {f['name']:<40}  {(f.get('category','') or '')[-30:]}")