from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal, DailyFundData, EmailFetchLog
from sqlalchemy import func

db = SessionLocal()

print("=== EmailFetchLog latest ===")
logs = db.query(EmailFetchLog).order_by(EmailFetchLog.fetched_at.desc()).limit(5).all()
for r in logs:
    print(f"  email_date={r.email_date} | data_date={r.data_date} | status={r.status}")

print("\n=== DailyFundData latest dates ===")
rows = db.query(
    DailyFundData.data_date,
    func.count(DailyFundData.id).label('cnt')
).group_by(DailyFundData.data_date
).order_by(DailyFundData.data_date.desc()).limit(5).all()
for r in rows:
    print(f"  {r.data_date} → {r.cnt} rows")

print("\n=== AppSettings ===")
from models.database import AppSettings
settings = db.query(AppSettings).all()
for s in settings:
    if s.key in ('mail_date', 'parser_version'):
        print(f"  {s.key} = {s.value}")

db.close()