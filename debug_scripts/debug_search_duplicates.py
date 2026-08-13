"""
debug_search_duplicates.py

Investigate why search returns visual duplicates.

Usage:
  cd buglerock-analytics/backend
  python ..\\debug_scripts\\debug_search_duplicates.py

Investigates:
  1. All DB rows matching "Bandhan Large & Mid Cap" on latest data_date
     — shows ISIN, name, branding_name, amfi_code, category, asset_class, ranking
  2. Whether ISINs are all distinct (multi-plan) or repeated (ingest bug)
  3. What Morningstar column supplies "name" for these rows
"""

import os
import sys
from pathlib import Path

# Make backend/ importable regardless of where this script lives
BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Load .env from backend folder regardless of CWD
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
        # Latest data date
        latest = conn.execute(text(
            "SELECT MAX(data_date) FROM daily_fund_data WHERE is_benchmark = 0 OR is_benchmark IS NULL"
        )).scalar()
        print(f"Latest data_date: {latest}\n")

        # All rows matching Bandhan Large & Mid Cap on latest date
        print("=" * 100)
        print("STEP 1 — All DB rows matching 'Bandhan Large & Mid Cap' on latest date")
        print("=" * 100)
        rows = conn.execute(text("""
            SELECT isin, name, branding_name, amfi_code, category, asset_class,
                   ranking, nav, sheet_name, id
            FROM daily_fund_data
            WHERE data_date = :d
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
              AND name ILIKE '%bandhan large%mid cap%'
            ORDER BY id
        """), {"d": latest}).fetchall()

        if not rows:
            print("No rows found matching 'Bandhan Large & Mid Cap'.")
            return

        print(f"\nFound {len(rows)} row(s):\n")
        for i, r in enumerate(rows, 1):
            print(f"[{i}] DB id: {r[9]}  ISIN: {r[0]}")
            print(f"    name         : {r[1]}")
            print(f"    branding_name: {r[2]}")
            print(f"    amfi_code    : {r[3]}")
            print(f"    category     : {r[4]}")
            print(f"    asset_class  : {r[5]}")
            print(f"    ranking      : {r[6]}")
            print(f"    nav          : {r[7]}")
            print(f"    sheet_name   : {r[8]}")
            print()

        # Are DB ids contiguous? If so, the parser inserted them back-to-back.
        ids = [r[9] for r in rows]
        gaps = [ids[i+1] - ids[i] for i in range(len(ids)-1)]
        print(f"DB ids: {ids}")
        print(f"Gaps between consecutive ids: {gaps}")
        if all(g == 1 for g in gaps):
            print("→ Ids are consecutive: the parser inserted them one after another in the same run.")
        else:
            print("→ Ids are NOT consecutive: something inserted them at different times.")

        # Broader check: How many ISINs have exact duplicate rows on latest date?
        print("\n" + "=" * 100)
        print("STEP 2 — How many ISINs have MORE THAN ONE row on latest date?")
        print("=" * 100)
        dupes = conn.execute(text("""
            SELECT isin, name, COUNT(*) AS n
            FROM daily_fund_data
            WHERE data_date = :d
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
              AND isin IS NOT NULL AND isin != ''
            GROUP BY isin, name
            HAVING COUNT(*) > 1
            ORDER BY n DESC, name
            LIMIT 50
        """), {"d": latest}).fetchall()

        if not dupes:
            print("None. Bandhan appears to be a one-off.")
        else:
            print(f"\n{len(dupes)} ISIN(s) have duplicate rows. Top:\n")
            print(f"{'ISIN':<15} {'name':<60} {'#rows':>7}")
            print("-" * 85)
            for r in dupes:
                print(f"{r[0]:<15} {(r[1] or '')[:58]:<60} {r[2]:>7}")

        # Grand total
        total_dup_isins = conn.execute(text("""
            SELECT COUNT(*) FROM (
              SELECT isin FROM daily_fund_data
              WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)
                AND isin IS NOT NULL AND isin != ''
              GROUP BY isin HAVING COUNT(*) > 1
            ) sub
        """), {"d": latest}).scalar()
        total_rows = conn.execute(text("""
            SELECT COUNT(*) FROM daily_fund_data
            WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)
        """), {"d": latest}).scalar()
        distinct_isins = conn.execute(text("""
            SELECT COUNT(DISTINCT isin) FROM daily_fund_data
            WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)
              AND isin IS NOT NULL AND isin != ''
        """), {"d": latest}).scalar()
        print(f"\nOn {latest}: {total_rows} total rows, {distinct_isins} distinct ISINs, "
              f"{total_dup_isins} ISINs duplicated.")


if __name__ == "__main__":
    main()