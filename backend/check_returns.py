"""Run: cd backend && python check_returns.py"""
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text

db = SessionLocal()
date = get_latest_data_date()

rows = db.execute(text("""
    SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN return_1y IS NOT NULL THEN 1 ELSE 0 END) as has_1y,
        SUM(CASE WHEN return_3y IS NOT NULL THEN 1 ELSE 0 END) as has_3y,
        SUM(CASE WHEN return_5y IS NOT NULL THEN 1 ELSE 0 END) as has_5y
    FROM daily_fund_data
    WHERE data_date = :date AND ranking IN ('R1','R2')
"""), {"date": str(date)}).fetchone()

print(f"Date: {date}")
print(f"Total R1/R2 funds: {rows.total}")
print(f"Has return_1y: {rows.has_1y}")
print(f"Has return_3y: {rows.has_3y}")
print(f"Has return_5y: {rows.has_5y}")
db.close()