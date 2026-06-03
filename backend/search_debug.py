from models.database import SessionLocal, DailyFundData
from datetime import date

db = SessionLocal()
funds = db.query(DailyFundData).filter(
    DailyFundData.data_date == date(2026, 5, 28),
    DailyFundData.category == 'India Fund Large-Cap',
    DailyFundData.isin == 'INF204K01562'
).all()
print(f"Count: {len(funds)}")
for f in funds:
    print(f.name, f.is_benchmark)
db.close()