"""
Standalone test script for the Morningstar holdings integration.
Run this from backend/ directory after setting up models.database imports correctly.

Usage:
    cd backend
    python test_holdings_pipeline.py

This will:
  1. Initialize the DB (creates fund_holdings, fund_portfolio_stats,
     holdings_fetch_log, morningstar_accesscode tables if not present)
  2. Fetch holdings for one test ISIN
  3. Print what got saved

Set MSTAR_ACCESSCODE in your .env before running this (the existing
portal-created code works fine for testing):
    MSTAR_ACCESSCODE=nyzpbnrru7ikuhesew06jfcxdoph162b
"""

import os
import sys

# Ensure backend/ is on the path when running from backend/ directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from models.database import init_db, SessionLocal, FundHolding, FundPortfolioStats
from services.morningstar_service import fetch_and_store_holdings, get_valid_accesscode

TEST_ISIN = "INF03VN01779"  # confirmed working — multi-asset fund with gold/silver/equity/bonds


def main():
    print("1. Initializing DB tables...")
    init_db()

    print("2. Getting accesscode...")
    accesscode = get_valid_accesscode()
    if not accesscode:
        print("   ERROR: No accesscode found. Set MSTAR_ACCESSCODE in your .env file.")
        return
    print(f"   Using accesscode: {accesscode[:8]}...{accesscode[-4:]}")

    print(f"3. Fetching holdings for {TEST_ISIN}...")
    success = fetch_and_store_holdings(TEST_ISIN, accesscode)

    if not success:
        print("   FAILED — check logs above for the reason")
        return

    print("   SUCCESS\n")

    print("4. Verifying what got saved to DB...")
    db = SessionLocal()
    try:
        holdings = (
            db.query(FundHolding)
            .filter(FundHolding.isin == TEST_ISIN)
            .order_by(FundHolding.weighting.desc().nullslast())
            .limit(10)
            .all()
        )
        print(f"\n   Top 10 holdings by weight ({len(holdings)} shown):")
        print(f"   {'Name':<45} {'Type':<6} {'Weight%':>8}")
        print(f"   {'-'*45} {'-'*6} {'-'*8}")
        for h in holdings:
            w = f"{h.weighting:.2f}" if h.weighting is not None else "—"
            print(f"   {h.name[:44]:<45} {h.holding_type or '—':<6} {w:>8}")

        stats = (
            db.query(FundPortfolioStats)
            .filter(FundPortfolioStats.isin == TEST_ISIN)
            .first()
        )
        if stats:
            print(f"\n   Portfolio stats:")
            print(f"   Total holdings: {stats.number_of_holdings}")
            print(f"   Stock holdings: {stats.number_of_stock_holdings}")
            print(f"   Bond holdings: {stats.number_of_bond_holdings}")
            print(f"   Equity %: {stats.asset_alloc_equity_net}")
            print(f"   PE Ratio: {stats.pe_ratio_ttm}")

    finally:
        db.close()

    print("\nDone. Holdings pipeline is working end-to-end.")


if __name__ == "__main__":
    main()