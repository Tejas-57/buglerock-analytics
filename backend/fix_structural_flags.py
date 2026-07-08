"""
One-off backfill: sets has_debt_columns and has_equity_columns correctly
for all existing daily_fund_data rows that were parsed before these flags
existed in parser.py (and therefore defaulted to FALSE).

This is derived from the actual source Excel sheet structure — confirmed by
inspecting the real daily Morningstar file:
  - has_debt_columns = TRUE for: Debt, ETF - Debt, Hybrid
  - has_equity_columns = TRUE for: everything EXCEPT Debt and ETF - Debt

Run from backend/ — safe to re-run multiple times (idempotent).
    python fix_structural_flags.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from models.database import engine
from sqlalchemy import text

DEBT_CLASSES = ("Debt", "ETF - Debt", "Hybrid")

with engine.connect() as conn:
    # Set has_debt_columns = TRUE for Debt / ETF - Debt / Hybrid
    r1 = conn.execute(text(
        "UPDATE daily_fund_data SET has_debt_columns = TRUE "
        "WHERE asset_class IN :classes AND (has_debt_columns IS NULL OR has_debt_columns = FALSE)"
    ), {"classes": DEBT_CLASSES})
    print(f"has_debt_columns = TRUE: {r1.rowcount} rows updated")

    # Set has_equity_columns = TRUE for everything except Debt and ETF - Debt
    r2 = conn.execute(text(
        "UPDATE daily_fund_data SET has_equity_columns = TRUE "
        "WHERE asset_class NOT IN :classes AND (has_equity_columns IS NULL OR has_equity_columns = FALSE)"
    ), {"classes": ("Debt", "ETF - Debt")})
    print(f"has_equity_columns = TRUE: {r2.rowcount} rows updated")

    conn.commit()

print("\nDone. All existing rows now have correct structural flags.")
print("Going forward, the parser sets these automatically on every daily parse.")