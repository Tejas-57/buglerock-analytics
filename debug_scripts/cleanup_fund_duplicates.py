"""
cleanup_fund_duplicates.py

ONE-TIME cleanup: removes duplicate DailyFundData rows that accumulated from
the concurrency bug in save_parsed_data (multiple simultaneous startup fetches
each doing DELETE+INSERT under READ COMMITTED, stacking rows 4×/8×).

Strategy: for each (data_date, isin) group, keep the row with the highest id
and delete the rest. This is safe because all duplicate rows contain identical
data — we're just removing exact copies.

Run once after deploying the fixed save_parsed_data:

  cd buglerock-analytics\\backend
  python ..\\debug_scripts\\cleanup_fund_duplicates.py

Shows a dry-run summary first. Type 'yes' to actually delete.
"""

import os
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
        # Preview
        print("=" * 80)
        print("STEP 1 — Dry run: count duplicates by data_date")
        print("=" * 80)
        summary = conn.execute(text("""
            SELECT data_date,
                   COUNT(*) AS total_rows,
                   COUNT(DISTINCT isin) AS distinct_isins,
                   COUNT(*) - COUNT(DISTINCT isin) AS extra_rows
            FROM daily_fund_data
            WHERE isin IS NOT NULL AND isin != ''
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
            GROUP BY data_date
            HAVING COUNT(*) > COUNT(DISTINCT isin)
            ORDER BY data_date DESC
            LIMIT 30
        """)).fetchall()

        if not summary:
            print("\nNo duplicates found. Nothing to clean up.")
            return

        print(f"\n{'data_date':<12} {'total':>8} {'distinct':>10} {'extra':>8}")
        print("-" * 42)
        total_extra = 0
        for r in summary:
            print(f"{str(r[0]):<12} {r[1]:>8} {r[2]:>10} {r[3]:>8}")
            total_extra += r[3]
        print(f"\nTotal extra rows to delete (across shown dates): {total_extra:,}")

        # Also check benchmarks in DailyFundData
        bm_summary = conn.execute(text("""
            SELECT data_date, COUNT(*) - COUNT(DISTINCT name) AS extra
            FROM daily_fund_data
            WHERE is_benchmark = 1
              AND name IS NOT NULL AND name != ''
            GROUP BY data_date
            HAVING COUNT(*) > COUNT(DISTINCT name)
            ORDER BY data_date DESC
            LIMIT 30
        """)).fetchall()
        bm_extra = sum(r[1] for r in bm_summary)
        if bm_extra:
            print(f"Benchmark rows also duplicated: {bm_extra:,} extra")

        print()
        print("=" * 80)
        print("STEP 2 — Confirm cleanup")
        print("=" * 80)
        ans = input("\nDelete all duplicate rows now? Type 'yes' to proceed: ").strip().lower()
        if ans != "yes":
            print("Aborted. No changes made.")
            return

    # Execute cleanup — one transaction for atomicity
    print("\nDeleting duplicates...")
    with engine.begin() as conn:
        # Funds: keep row with MAX(id) per (data_date, isin)
        fund_deleted = conn.execute(text("""
            DELETE FROM daily_fund_data
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                             PARTITION BY data_date, isin
                             ORDER BY id DESC
                           ) AS rn
                    FROM daily_fund_data
                    WHERE isin IS NOT NULL AND isin != ''
                      AND (is_benchmark = 0 OR is_benchmark IS NULL)
                ) sub
                WHERE rn > 1
            )
        """)).rowcount
        print(f"  daily_fund_data (funds): deleted {fund_deleted:,} duplicate rows")

        # Benchmarks (is_benchmark = 1): dedupe by (data_date, name, benchmark_label)
        bm_deleted = conn.execute(text("""
            DELETE FROM daily_fund_data
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                             PARTITION BY data_date, name, benchmark_label
                             ORDER BY id DESC
                           ) AS rn
                    FROM daily_fund_data
                    WHERE is_benchmark = 1
                      AND name IS NOT NULL AND name != ''
                ) sub
                WHERE rn > 1
            )
        """)).rowcount
        print(f"  daily_fund_data (benchmarks): deleted {bm_deleted:,} duplicate rows")

        # Also clean benchmark_data table (backward-compat table)
        bmt_deleted = conn.execute(text("""
            DELETE FROM benchmark_data
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                             PARTITION BY data_date, name
                             ORDER BY id DESC
                           ) AS rn
                    FROM benchmark_data
                    WHERE name IS NOT NULL AND name != ''
                ) sub
                WHERE rn > 1
            )
        """)).rowcount
        print(f"  benchmark_data (backward-compat): deleted {bmt_deleted:,} duplicate rows")

    # Verify
    print("\n" + "=" * 80)
    print("STEP 3 — Verify")
    print("=" * 80)
    with engine.connect() as conn:
        remaining = conn.execute(text("""
            SELECT COUNT(*) FROM (
              SELECT data_date, isin FROM daily_fund_data
              WHERE isin IS NOT NULL AND isin != ''
                AND (is_benchmark = 0 OR is_benchmark IS NULL)
              GROUP BY data_date, isin HAVING COUNT(*) > 1
            ) sub
        """)).scalar()
        print(f"\nRemaining (data_date, isin) pairs with duplicates: {remaining}")
        if remaining == 0:
            print("✓ Clean. No duplicates remain.")
        else:
            print("⚠ Some duplicates still present — investigate.")


if __name__ == "__main__":
    main()