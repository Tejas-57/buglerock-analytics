"""
debug_stock_exposure.py — check exact branding name column in DB.
Run: cd buglerock-analytics/backend && python debug_stock_exposure.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text
engine = create_engine(os.getenv("DATABASE_URL",""))

with engine.connect() as db:
    # Check exact column name
    cols = db.execute(text("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'daily_fund_data'
          AND LOWER(column_name) LIKE '%brand%'
    """)).fetchall()
    print("Branding-related columns:")
    for c in cols:
        print(f"  column_name={repr(c.column_name)}  type={c.data_type}")

    # Sample values
    if cols:
        col = cols[0].column_name
        rows = db.execute(text(f"""
            SELECT name, "{col}"
            FROM daily_fund_data
            WHERE data_date = (SELECT MAX(data_date) FROM daily_fund_data)
              AND "{col}" IS NOT NULL
            LIMIT 10
        """)).fetchall()
        print(f"\nSample values for '{col}':")
        for r in rows:
            print(f"  {r[0][:40]:<40}  {repr(r[1])}")