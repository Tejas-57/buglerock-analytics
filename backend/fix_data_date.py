"""
Fix data_date for batches where it doesn't match the most common nav_date.
Run from backend/: python fix_data_date.py
"""
from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal, DailyFundData
from sqlalchemy import func

db = SessionLocal()
try:
    # Find all distinct data_dates
    batches = db.query(DailyFundData.data_date).distinct().all()
    
    for (batch_date,) in batches:
        # Get most common nav_date for this batch
        nav_row = db.query(
            DailyFundData.nav_date,
            func.count(DailyFundData.id).label('cnt')
        ).filter(
            DailyFundData.data_date == batch_date,
            DailyFundData.nav_date != None,
            (DailyFundData.is_benchmark == 0) | (DailyFundData.is_benchmark == None),
        ).group_by(DailyFundData.nav_date
        ).order_by(func.count(DailyFundData.id).desc()).first()

        if not nav_row or not nav_row.nav_date:
            continue

        correct_date = nav_row.nav_date
        if correct_date == batch_date:
            print(f"  {batch_date}: already correct ✓")
            continue

        # Check if correct_date already exists as a batch
        existing = db.query(DailyFundData).filter(
            DailyFundData.data_date == correct_date
        ).count()
        if existing > 0:
            print(f"  {batch_date}: target date {correct_date} already has data, skipping")
            continue

        count = db.query(DailyFundData).filter(
            DailyFundData.data_date == batch_date
        ).count()
        db.query(DailyFundData).filter(
            DailyFundData.data_date == batch_date
        ).update({"data_date": correct_date})
        print(f"  {batch_date} → {correct_date} ({count} rows) ✓")

    db.commit()
    print("\nDone.")
except Exception as e:
    db.rollback()
    print(f"Error: {e}")
finally:
    db.close()