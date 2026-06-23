"""
One-time migration: update asset_class to 'Precious Metals' for all
precious metals categories in daily_fund_data.

Run from backend/:
    python migrate_precious_metals.py
"""
from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal, DailyFundData
from sqlalchemy import or_

PRECIOUS_METALS_CATS = [
    'Cat: India Fund Sector - Precious Metals-Gold',
    'Cat: India Fund Sector - Precious Metals-Silver',
    'India Fund Sector - Precious Metals',
    'India ETF Sector - Precious Metals',
]

db = SessionLocal()
try:
    count = db.query(DailyFundData).filter(
        DailyFundData.category.in_(PRECIOUS_METALS_CATS)
    ).count()
    print(f"Found {count} rows to update")

    db.query(DailyFundData).filter(
        DailyFundData.category.in_(PRECIOUS_METALS_CATS)
    ).update(
        {"asset_class": "Precious Metals"},
        synchronize_session=False
    )
    db.commit()
    print(f"Updated {count} rows → asset_class='Precious Metals' ✓")
except Exception as e:
    db.rollback()
    print(f"Error: {e}")
finally:
    db.close()