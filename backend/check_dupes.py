from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text

db = SessionLocal()
date = get_latest_data_date()

# Check for duplicate ISINs on the same date among R1/R2
rows = db.execute(text("""
    SELECT isin, name, COUNT(*) as cnt
    FROM daily_fund_data
    WHERE data_date = :date AND ranking IN ('R1','R2') AND nav IS NOT NULL
    GROUP BY isin
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
"""), {"date": str(date)}).fetchall()

print(f"Duplicate ISINs on {date} (R1/R2):")
if not rows:
    print("  None — ISINs are unique")
for r in rows:
    print(f"  {r.cnt}x  {r.isin}  {r.name}")

# Also check duplicate by NAME (different ISIN, same fund name)
print("\nDuplicate NAMES (may be diff ISIN):")
name_rows = db.execute(text("""
    SELECT name, COUNT(DISTINCT isin) as isin_cnt, COUNT(*) as row_cnt
    FROM daily_fund_data
    WHERE data_date = :date AND ranking IN ('R1','R2') AND nav IS NOT NULL
    GROUP BY name
    HAVING COUNT(*) > 1
    ORDER BY row_cnt DESC
    LIMIT 20
"""), {"date": str(date)}).fetchall()
for r in name_rows:
    print(f"  {r.row_cnt} rows, {r.isin_cnt} distinct ISIN  →  {r.name}")

db.close()