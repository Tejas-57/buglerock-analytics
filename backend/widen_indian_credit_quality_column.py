"""
One-off migration: widens fund_holdings.indian_credit_quality from
VARCHAR(20) to VARCHAR(100).

For normal bonds, Morningstar returns a short rating here (e.g. "AAA",
"Sovereign"). But for InvIT/Infrastructure Investment Trust holdings (e.g.
Raajmarg Infra Investment Trust, Cube Highways Trust), it returns a longer
classification label instead (e.g. "Transport Infrastructure" — 24 chars),
which overflowed the 20-char column and caused the whole holdings save for
that fund to fail with:
    psycopg2.errors.StringDataRightTruncation: value too long for type
    character varying(20)

Run from the backend/ directory:
    python widen_indian_credit_quality_column.py
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
        "ALTER TABLE fund_holdings ALTER COLUMN indian_credit_quality TYPE VARCHAR(100)"
    ))
    conn.commit()

print("Widened fund_holdings.indian_credit_quality to VARCHAR(100).")