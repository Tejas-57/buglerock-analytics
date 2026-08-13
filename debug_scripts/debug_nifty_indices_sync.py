"""
debug_nifty_indices_sync.py

Sanity-check the new Nifty Indices sync before/after deploy.

  cd buglerock-analytics/backend
  python debug_nifty_indices_sync.py

Prints:
  1. The tail records that would be upserted (per index, per date)
  2. Current DB last_date per index
  3. What's "genuinely new" (would advance the DB's latest)
  4. Optional: actually runs the upsert (uncomment last line)
"""

import os
import sys
from collections import defaultdict

# Ensure env vars from .env are loaded when running standalone
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def main():
    if not os.getenv("BENCHMARK_SHEET_ID"):
        print("ERROR: BENCHMARK_SHEET_ID not set. Add it to backend/.env")
        sys.exit(1)
    if not (os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or
            os.path.exists("/etc/secrets/sheets_credentials.json") or
            os.path.exists("credentials/sheets_credentials.json")):
        print("ERROR: no Google service account creds available.")
        sys.exit(1)

    from services.benchmark_sheet_service import read_nifty_indices_tail
    from services.benchmark_db_service import get_available_indices

    print("=" * 70)
    print("STEP 1 — Read tail from 'Nifty Indices' tab")
    print("=" * 70)
    records = read_nifty_indices_tail(n_rows=20)
    if not records:
        print("No records read. Check sheet permissions and tab name.")
        sys.exit(1)

    by_index = defaultdict(list)
    for r in records:
        by_index[r["index_name"]].append((r["date"], r["value"]))

    print(f"\nRead {len(records)} records across {len(by_index)} indices:\n")
    for name in sorted(by_index.keys()):
        rows = sorted(by_index[name])
        earliest, latest = rows[0][0], rows[-1][0]
        print(f"  {name:<50} {len(rows):>3} rows   {earliest} → {latest}")

    print("\n" + "=" * 70)
    print("STEP 2 — Current DB latest per index (benchmark_nav table)")
    print("=" * 70)
    try:
        pre = {r["index_name"]: r for r in get_available_indices()}
    except Exception as e:
        print(f"DB read failed: {e}")
        print("(Set DATABASE_URL if you want to compare against DB.)")
        return

    if not pre:
        print("benchmark_nav table is empty. Run POST /api/benchmarks/load-history first.")
        return

    for name in sorted(by_index.keys()):
        info = pre.get(name)
        if info:
            print(f"  {name:<50} last DB date: {info['last_date']}   rows: {info['row_count']}")
        else:
            print(f"  {name:<50} NOT IN DB YET (would be created)")

    print("\n" + "=" * 70)
    print("STEP 3 — Records that are newer than what's in DB")
    print("=" * 70)
    new_records = []
    for r in records:
        last = pre.get(r["index_name"], {}).get("last_date")
        if not last or str(r["date"]) > last:
            new_records.append(r)

    if not new_records:
        print("\nNothing newer than DB — sync would be a no-op (as expected on quiet days).")
    else:
        print(f"\n{len(new_records)} record(s) would advance DB latest:\n")
        for r in sorted(new_records, key=lambda x: (x["index_name"], x["date"])):
            print(f"  {r['date']}  {r['index_name']:<50} {r['value']}")

    print("\n" + "=" * 70)
    print("STEP 4 — Dry run complete. Uncomment last line to actually upsert.")
    print("=" * 70)

    # Run the actual upsert
    from services.benchmark_watcher import sync_nifty_indices_from_sheet
    print("\nRunning upsert...")
    result = sync_nifty_indices_from_sheet()
    print(f"Done: {result}")


if __name__ == "__main__":
    main()