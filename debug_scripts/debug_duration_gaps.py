"""
debug_duration_gaps.py

Finds all debt and hybrid funds in the DB that have NULL or missing
modified_duration on the latest data_date. Groups by category so you
can see which fund types need category-proxy fallback.

  cd buglerock-analytics\\backend
  python ..\\debug_scripts\\debug_duration_gaps.py
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
        print(f"Latest data_date: {latest}\n")

        # Which asset classes exist?
        asset_classes = conn.execute(text("""
            SELECT DISTINCT asset_class FROM daily_fund_data
            WHERE data_date = :d AND (is_benchmark = 0 OR is_benchmark IS NULL)
            ORDER BY asset_class
        """), {"d": latest}).fetchall()
        print("All asset classes in DB:", [r[0] for r in asset_classes])

        # Debt + hybrid funds — with and without duration
        print("\n" + "=" * 80)
        print("STEP 1 — Category breakdown: has vs missing modified_duration")
        print("=" * 80)
        rows = conn.execute(text("""
            SELECT
                asset_class,
                category,
                COUNT(*) AS total_funds,
                COUNT(modified_duration) AS has_duration,
                COUNT(*) - COUNT(modified_duration) AS missing_duration,
                ROUND(AVG(modified_duration)::numeric, 2) AS avg_duration
            FROM daily_fund_data
            WHERE data_date = :d
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
              AND asset_class ILIKE ANY(ARRAY['%debt%','%hybrid%','%balanced%','%fixed%','%bond%','%income%'])
            GROUP BY asset_class, category
            ORDER BY missing_duration DESC, asset_class, category
        """), {"d": latest}).fetchall()

        if not rows:
            print("No debt/hybrid rows found. Trying broader filter...")
            rows = conn.execute(text("""
                SELECT
                    asset_class,
                    category,
                    COUNT(*) AS total_funds,
                    COUNT(modified_duration) AS has_duration,
                    COUNT(*) - COUNT(modified_duration) AS missing_duration,
                    ROUND(AVG(modified_duration)::numeric, 2) AS avg_duration
                FROM daily_fund_data
                WHERE data_date = :d
                  AND (is_benchmark = 0 OR is_benchmark IS NULL)
                GROUP BY asset_class, category
                HAVING COUNT(*) - COUNT(modified_duration) > 0
                ORDER BY missing_duration DESC
                LIMIT 40
            """), {"d": latest}).fetchall()

        print(f"\n{'asset_class':<25} {'category':<45} {'total':>6} {'has_dur':>8} {'missing':>8} {'avg_dur':>8}")
        print("-" * 105)
        for r in rows:
            flag = " ⚠" if r[4] > 0 else ""
            print(f"{(r[0] or '')[:24]:<25} {(r[1] or '')[:44]:<45} {r[2]:>6} {r[3]:>8} {r[4]:>8} {str(r[5] or '—'):>8}{flag}")

        print("\n" + "=" * 80)
        print("STEP 2 — Summary: categories where ALL funds are missing duration")
        print("=" * 80)
        all_missing = [r for r in rows if r[3] == 0 and r[2] > 0]
        if not all_missing:
            print("None — all categories have at least some duration data.")
        else:
            for r in all_missing:
                print(f"  {r[0]} / {r[1]} — {r[2]} funds, 0 with duration → will use category proxy")

        print("\n" + "=" * 80)
        print("STEP 3 — Summary: categories where SOME funds are missing duration")
        print("=" * 80)
        some_missing = [r for r in rows if 0 < r[4] < r[2]]
        if not some_missing:
            print("None.")
        else:
            for r in some_missing:
                print(f"  {r[0]} / {r[1]} — {r[4]}/{r[2]} funds missing duration, avg of present = {r[5]}")

        print("\n" + "=" * 80)
        print("STEP 4 — Specific funds missing duration (sample, up to 30)")
        print("=" * 80)
        samples = conn.execute(text("""
            SELECT name, category, asset_class, modified_duration, avg_maturity
            FROM daily_fund_data
            WHERE data_date = :d
              AND (is_benchmark = 0 OR is_benchmark IS NULL)
              AND modified_duration IS NULL
              AND asset_class ILIKE ANY(ARRAY['%debt%','%hybrid%','%balanced%','%fixed%','%bond%','%income%'])
            ORDER BY category, name
            LIMIT 30
        """), {"d": latest}).fetchall()

        if not samples:
            # Broader fallback
            samples = conn.execute(text("""
                SELECT name, category, asset_class, modified_duration, avg_maturity
                FROM daily_fund_data
                WHERE data_date = :d
                  AND (is_benchmark = 0 OR is_benchmark IS NULL)
                  AND modified_duration IS NULL
                ORDER BY category, name
                LIMIT 30
            """), {"d": latest}).fetchall()

        if not samples:
            print("No funds with missing duration found.")
        else:
            print(f"\n{'name':<50} {'category':<35} {'asset_class':<20} {'avg_maturity':>12}")
            print("-" * 120)
            for r in samples:
                print(f"{(r[0] or '')[:49]:<50} {(r[1] or '')[:34]:<35} {(r[2] or '')[:19]:<20} {str(r[4] or '—'):>12}")


if __name__ == "__main__":
    main()