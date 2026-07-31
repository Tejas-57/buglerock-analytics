from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text
from collections import Counter

db = SessionLocal()
date = get_latest_data_date()
print(f"Date: {date}")

rows = db.execute(text("""
    SELECT isin, name, asset_class, ranking, category, return_3y, sharpe_ratio_3y, std_dev_3y
    FROM daily_fund_data
    WHERE data_date = :date
      AND ranking IN ('R1','R2')
      AND nav IS NOT NULL
"""), {"date": str(date)}).fetchall()

debt  = [r for r in rows if r.asset_class == "Debt"]
hybrid = [r for r in rows if r.asset_class == "Hybrid"]
equity = [r for r in rows if r.asset_class == "Equity"]

print(f"\n=== DEBT categories ({len(debt)} funds) ===")
dc = Counter(r.category for r in debt)
for k,v in sorted(dc.items()): print(f"  {v:>3}  {repr(k)}")

print(f"\n=== HYBRID categories ({len(hybrid)} funds) ===")
hc = Counter(r.category for r in hybrid)
for k,v in sorted(hc.items()): print(f"  {v:>3}  {repr(k)}")

print(f"\n=== EQUITY categories ({len(equity)} funds) ===")
ec = Counter(r.category for r in equity)
for k,v in sorted(ec.items()): print(f"  {v:>3}  {repr(k)}")

db.close()