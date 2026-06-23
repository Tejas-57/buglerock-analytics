from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal
from sqlalchemy import text
from datetime import date, timedelta

db = SessionLocal()

# Check how many funds have 3Y of daily NAV data
cutoff = date.today() - timedelta(days=3*365)

result = db.execute(text("""
    SELECT 
        COUNT(DISTINCT isin) as total_funds,
        COUNT(DISTINCT CASE WHEN min_date <= :cutoff THEN isin END) as funds_with_3y
    FROM (
        SELECT isin, MIN(date) as min_date
        FROM nav_history
        GROUP BY isin
    ) t
"""), {"cutoff": cutoff}).first()

print(f"Total funds with NAV history: {result.total_funds}")
print(f"Funds with 3Y+ history: {result.funds_with_3y}")
print(f"Coverage: {result.funds_with_3y/result.total_funds*100:.1f}%")

db.close()