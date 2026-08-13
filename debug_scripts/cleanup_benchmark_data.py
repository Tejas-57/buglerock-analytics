"""
cleanup_benchmark_data.py

ONE-TIME: cleans duplicate rows from the benchmark_data table.
Run after cleanup_fund_duplicates.py (which already cleaned daily_fund_data).

  cd buglerock-analytics\\backend
  python ..\\debug_scripts\\cleanup_benchmark_data.py
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
        preview = conn.execute(text("""
            SELECT COUNT(*) FROM (
                SELECT data_date, benchmark_name FROM benchmark_data
                WHERE benchmark_name IS NOT NULL AND benchmark_name != ''
                GROUP BY data_date, benchmark_name
                HAVING COUNT(*) > 1
            ) sub
        """)).scalar()
        print(f"(data_date, benchmark_name) pairs with duplicates: {preview}")

    if preview == 0:
        print("Nothing to clean.")
        return

    with engine.begin() as conn:
        deleted = conn.execute(text("""
            DELETE FROM benchmark_data
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY data_date, benchmark_name
                               ORDER BY id DESC
                           ) AS rn
                    FROM benchmark_data
                    WHERE benchmark_name IS NOT NULL AND benchmark_name != ''
                ) sub
                WHERE rn > 1
            )
        """)).rowcount
        print(f"Deleted {deleted:,} duplicate rows from benchmark_data.")

    with engine.connect() as conn:
        remaining = conn.execute(text("""
            SELECT COUNT(*) FROM (
                SELECT data_date, benchmark_name FROM benchmark_data
                WHERE benchmark_name IS NOT NULL AND benchmark_name != ''
                GROUP BY data_date, benchmark_name
                HAVING COUNT(*) > 1
            ) sub
        """)).scalar()
        print(f"Remaining duplicates: {remaining}")
        if remaining == 0:
            print("Clean.")


if __name__ == "__main__":
    main()