"""
One-off migration: drops the unique constraint on fund_holdings that was
too strict for real-world data (some bonds/T-bills share the same display
name but are distinct holdings).

Run from the backend/ directory:
    python drop_holdings_constraint.py
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from models.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text(
        "ALTER TABLE fund_holdings DROP CONSTRAINT IF EXISTS uq_fund_holdings_isin_date_name_type"
    ))
    conn.commit()

print("Constraint dropped successfully.")