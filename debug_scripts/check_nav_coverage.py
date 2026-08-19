"""
Run from buglerock-analytics/backend:
  python ..\debug_scripts\check_nav_coverage.py
"""
import sys, os

# Always resolve to the backend directory (parent of debug_scripts)
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend')
backend_dir = os.path.normpath(backend_dir)
sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, '.env'))

from models.database import SessionLocal
from sqlalchemy import text
from datetime import date

db = SessionLocal()
try:
    latest = db.execute(text(
        "SELECT MAX(data_date) FROM daily_fund_data WHERE ranking IN ('R1','R2') AND nav IS NOT NULL"
    )).scalar()
    print(f"Latest data date: {latest}")

    funds = db.execute(text("""
        SELECT isin, name, asset_class, category
        FROM daily_fund_data
        WHERE data_date = :d AND ranking IN ('R1','R2') AND nav IS NOT NULL
        ORDER BY asset_class, category, name
    """), {"d": str(latest)}).fetchall()
    print(f"Total R1/R2 funds: {len(funds)}")

    isins = [f[0] for f in funds if f[0]]
    covered = db.execute(text("""
        SELECT isin, COUNT(*) as rows, MIN(date) as first_date, MAX(date) as last_date
        FROM nav_history
        WHERE isin = ANY(:isins)
        GROUP BY isin
    """), {"isins": isins}).fetchall()

    covered_map = {r[0]: {"rows": r[1], "first": r[2], "last": r[3]} for r in covered}
    cutoff_5y = date(2021, 1, 1)

    has_history = [i for i in isins if i in covered_map]
    has_5y      = [i for i in isins if i in covered_map and covered_map[i]["first"] <= cutoff_5y]
    no_history  = [i for i in isins if i not in covered_map]
    partial     = [i for i in isins if i in covered_map and covered_map[i]["first"] > cutoff_5y]

    print(f"\nNav history coverage:")
    print(f"  Has any history : {len(has_history)}/{len(isins)}")
    print(f"  Has 5Y+ history : {len(has_5y)}/{len(isins)} (first_date <= 2021-01-01)")
    print(f"  Partial (<5Y)   : {len(partial)}")
    print(f"  No history      : {len(no_history)}")

    if no_history:
        print(f"\nFunds with NO nav history (first 20):")
        for isin in no_history[:20]:
            f = next(x for x in funds if x[0] == isin)
            print(f"  {isin} | {f[2]:20} | {f[1][:50]}")

    if partial:
        print(f"\nFunds with partial history (<5Y) (first 20):")
        for isin in partial[:20]:
            f = next(x for x in funds if x[0] == isin)
            m = covered_map[isin]
            print(f"  {isin} | from {m['first']} | {m['rows']:4} rows | {f[1][:50]}")

finally:
    db.close()