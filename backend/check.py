from models.database import SessionLocal, DailyFundData
from services.db_service import get_latest_data_date
from sqlalchemy import func

db = SessionLocal()

print("get_latest_data_date():", get_latest_data_date())

latest_nav = db.query(func.max(DailyFundData.nav_date)).scalar()
latest_data = db.query(func.max(DailyFundData.data_date)).scalar()
print("max nav_date:", latest_nav)
print("max data_date:", latest_data)

cats_data = db.query(DailyFundData.category).filter(
    DailyFundData.data_date == latest_data,
    DailyFundData.asset_class == "Equity"
).distinct().all()
print("\nCategories via data_date:", len(cats_data))
for c in sorted([r[0] for r in cats_data if r[0]]):
    print(repr(c))

cats_nav = db.query(DailyFundData.category).filter(
    DailyFundData.nav_date == latest_nav,
    DailyFundData.asset_class == "Equity"
).distinct().all()
print("\nCategories via nav_date:", len(cats_nav))
for c in sorted([r[0] for r in cats_nav if r[0]]):
    print(repr(c))

cats_all = db.query(DailyFundData.category).filter(
    DailyFundData.asset_class == "Equity"
).distinct().all()
print("\nAll Equity categories (no date filter):", len(cats_all))
for c in sorted([r[0] for r in cats_all if r[0]]):
    print(repr(c))

db.close()