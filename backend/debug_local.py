from dotenv import load_dotenv
load_dotenv()
import os

print("=== DB URL ===")
db_url = os.getenv('DATABASE_URL', 'NOT SET')
print(db_url[:60] + "...")

print("\n=== Test snapshot query ===")
from models.database import SessionLocal, DailyFundData
from sqlalchemy import func

db = SessionLocal()
try:
    latest = db.query(func.max(DailyFundData.data_date)).filter(
        DailyFundData.is_benchmark == 0
    ).scalar()
    print(f"Latest data_date: {latest}")

    count = db.query(DailyFundData).filter(
        DailyFundData.data_date == latest,
        DailyFundData.isin != None
    ).count()
    print(f"Funds on {latest}: {count}")

    # Test snapshot
    f = db.query(DailyFundData).filter(
        DailyFundData.data_date == latest,
        DailyFundData.isin == 'INF204K01562'
    ).first()
    print(f"Test fund: {f.name if f else 'NOT FOUND'}")
    print(f"return_1y: {f.return_1y if f else 'N/A'}")

except Exception as e:
    print(f"ERROR: {e}")
finally:
    db.close()

print("\n=== Test asset classes ===")
from services.db_service import get_asset_classes
try:
    classes = get_asset_classes(latest)
    print(f"Asset classes: {classes}")
except Exception as e:
    print(f"ERROR: {e}")