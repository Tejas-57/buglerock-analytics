"""
check_dupes.py
Quick check — how many duplicate (data_date, isin) pairs remain in local DB.

  cd buglerock-analytics\\backend
  python ..\\debug_scripts\\check_dupes.py
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    backend_env = BACKEND_DIR / ".env"
    if backend_env.exists():
        load_dotenv(backend_env)
    else:
        load_dotenv()
except ImportError:
    pass


def main():
    from sqlalchemy import text
    from models.database import engine

    with engine.connect() as conn:
        latest = conn.execute(text(
            "SELECT MAX(data_date) FROM daily_fund_data WHERE is_benchmark = 0 OR is_benchmark IS NULL"
        )).scalar()
        print(f"Latest data_date: {latest}")

        total = conn.execute(text(
            "SELECT COUNT(*) FROM daily_fund_data WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)",
        ), {"d": latest}).scalar()

        distinct = conn.execute(text(
            "SELECT COUNT(DISTINCT isin) FROM daily_fund_data WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL) AND isin IS NOT NULL",
        ), {"d": latest}).scalar()

        print(f"Total rows: {total}")
        print(f"Distinct ISINs: {distinct}")
        print(f"Duplicate rows: {total - distinct}")

        # Sample one duplicated ISIN
        sample = conn.execute(text("""
            SELECT isin, COUNT(*) as n FROM daily_fund_data
            WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)
              AND isin IS NOT NULL
            GROUP BY isin HAVING COUNT(*) > 1
            LIMIT 1
        """), {"d": latest}).fetchone()
        if sample:
            print(f"Sample duplicate ISIN: {sample[0]} appears {sample[1]} times")
        else:
            print("No duplicates found for latest date.")


if __name__ == "__main__":
    main()