from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
rows = db.execute(text("""
    SELECT DISTINCT category, asset_class, COUNT(*) as funds
    FROM daily_fund_data
    WHERE is_benchmark = 0 OR is_benchmark IS NULL
    AND data_date = (SELECT MAX(data_date) FROM daily_fund_data)
    GROUP BY category, asset_class
    ORDER BY asset_class, category
""")).fetchall()

for r in rows:
    print(f"{r.asset_class:<20} {r.category:<60} {r.funds}")

db.close()