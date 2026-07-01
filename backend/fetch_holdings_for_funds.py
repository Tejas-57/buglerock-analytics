"""
Fetch holdings for specific funds by name search.
Run from backend/ directory:
    python fetch_holdings_for_funds.py

Edit the FUND_NAMES list below to match the funds you want to fetch.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from models.database import SessionLocal, DailyFundData
from services.morningstar_service import fetch_and_store_holdings, get_valid_accesscode

# ── Edit these to match the funds you want to fetch ──────────────────────────
FUND_NAMES = [
    "ICICI Prudential Large Cap",
    "Parag Parikh Flexi Cap",
]
# ─────────────────────────────────────────────────────────────────────────────

def find_isins(names):
    db = SessionLocal()
    try:
        results = []
        for name in names:
            rows = (
                db.query(DailyFundData.isin, DailyFundData.name)
                .filter(DailyFundData.name.ilike(f"%{name}%"))
                .distinct(DailyFundData.isin, DailyFundData.name)
                .limit(3)
                .all()
            )
            if rows:
                # Take the first match
                results.append((rows[0].isin, rows[0].name))
                if len(rows) > 1:
                    print(f"  Multiple matches for '{name}':")
                    for r in rows:
                        print(f"    {r.isin}  {r.name}")
                    print(f"  Using first: {rows[0].isin}")
            else:
                print(f"  No match found for '{name}'")
        return results
    finally:
        db.close()


def main():
    print("1. Looking up ISINs...")
    fund_list = find_isins(FUND_NAMES)
    if not fund_list:
        print("No funds found. Check FUND_NAMES list.")
        return

    print(f"\n2. Found {len(fund_list)} fund(s):")
    for isin, name in fund_list:
        print(f"   {isin}  {name}")

    print("\n3. Getting accesscode...")
    accesscode = get_valid_accesscode()
    if not accesscode:
        print("ERROR: No accesscode. Check MSTAR_ACCESSCODE in .env")
        return
    print(f"   Using: {accesscode[:8]}...{accesscode[-4:]}")

    print("\n4. Fetching holdings from Morningstar...")
    for isin, name in fund_list:
        print(f"   {name} ({isin})... ", end="", flush=True)
        ok = fetch_and_store_holdings(isin, accesscode)
        print("OK" if ok else "FAILED")

    print("\nDone. Refresh the Overlap tab in the app.")


if __name__ == "__main__":
    main()