from dotenv import load_dotenv
load_dotenv()
from models.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

r = db.execute(text("""
    SELECT 
        COUNT(*) as total_rows,
        COUNT(total_return) as rows_with_total_return,
        COUNT(nav) as rows_with_nav
    FROM nav_history
    LIMIT 1
""")).first()

print(f"Total rows:              {r.total_rows}")
print(f"Rows with total_return:  {r.rows_with_total_return}")
print(f"Rows with nav:           {r.rows_with_nav}")

db.close()