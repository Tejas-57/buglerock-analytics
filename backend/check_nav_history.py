from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
r = db.execute(text("SELECT COUNT(DISTINCT date) as dates, COUNT(DISTINCT isin) as funds, MIN(date) as earliest, MAX(date) as latest FROM nav_history")).first()
print(f"Dates: {r.dates}, Funds: {r.funds}, Earliest: {r.earliest}, Latest: {r.latest}")
db.close()