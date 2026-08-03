from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text

db = SessionLocal()
date = get_latest_data_date()

# Check Income Plus Arbitrage funds
rows = db.execute(text("""
    SELECT isin, name, category, asset_class, ranking, equity_pct, bond_pct
    FROM daily_fund_data
    WHERE data_date = :date
      AND (LOWER(name) LIKE '%arbitrage fof%' OR LOWER(name) LIKE '%income plus%')
    ORDER BY ranking
"""), {"date": str(date)}).fetchall()

print("=== Income Plus Arbitrage FoF funds ===")
for r in rows:
    print(f"  {r.ranking or '—':<4} {r.asset_class:<10} {r.category:<40} eq={r.equity_pct} bd={r.bond_pct}  {r.name}")

# Check hybrid categories available
print("\n=== Hybrid fund categories (R1/R2) ===")
rows2 = db.execute(text("""
    SELECT category, COUNT(*) as cnt
    FROM daily_fund_data
    WHERE data_date = :date AND asset_class = 'Hybrid' AND ranking IN ('R1','R2')
    GROUP BY category ORDER BY category
"""), {"date": str(date)}).fetchall()
for r in rows2:
    print(f"  {r.cnt:>3}  {r.category}")

# Check debt categories
print("\n=== Debt fund categories (R1/R2) ===")
rows3 = db.execute(text("""
    SELECT category, COUNT(*) as cnt
    FROM daily_fund_data
    WHERE data_date = :date AND asset_class = 'Debt' AND ranking IN ('R1','R2')
    GROUP BY category ORDER BY category
"""), {"date": str(date)}).fetchall()
for r in rows3:
    print(f"  {r.cnt:>3}  {r.category}")

db.close()