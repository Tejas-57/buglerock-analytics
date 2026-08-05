"""
debug_stock_exposure.py — clean up long branding_name values to short AMC names.
Run: cd buglerock-analytics/backend && python debug_stock_exposure.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text
engine = create_engine(os.getenv("DATABASE_URL",""))

# Map long provider names to short display names
CLEAN_MAP = {
    "Abakkus Investment Managers Private Limited": "Abakkus",
    "AlphaGrep Investment Management Private Limited": "AlphaGrep",
    "Unifi Asset Management Private Limited": "Unifi",
}

with engine.connect() as db:
    for long_name, short_name in CLEAN_MAP.items():
        result = db.execute(text("""
            UPDATE daily_fund_data
            SET branding_name = :short
            WHERE branding_name = :long
        """), {"short": short_name, "long": long_name})
        db.commit()
        print(f"  Updated {result.rowcount} rows: {repr(long_name)} → {repr(short_name)}")

    # Verify
    rows = db.execute(text("""
        SELECT DISTINCT branding_name, COUNT(*) as cnt
        FROM daily_fund_data
        WHERE data_date = (SELECT MAX(data_date) FROM daily_fund_data)
          AND branding_name IN ('Abakkus','AlphaGrep','Unifi')
        GROUP BY branding_name
    """)).fetchall()
    print("\nVerification:")
    for r in rows:
        print(f"  {r.branding_name}: {r.cnt} funds")