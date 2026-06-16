import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text
from services.nav_fetcher import get_tracked_isins

engine = create_engine(os.getenv("DATABASE_URL"))

with engine.connect() as conn:
    # All ISINs with AMFI code across all dates
    all_with_amfi = conn.execute(text("""
        SELECT COUNT(DISTINCT isin) FROM daily_fund_data
        WHERE asset_class != 'SIF'
        AND isin IS NOT NULL
        AND amfi_code IS NOT NULL AND amfi_code != ''
    """)).scalar()
    print(f"All ISINs with AMFI code (all dates): {all_with_amfi}")

    # ISINs already in nav_history
    tracked = set(get_tracked_isins())
    print(f"ISINs in nav_history:                  {len(tracked)}")
    print(f"Gap (not yet fetched):                 {all_with_amfi - len(tracked)}")

    # Which ISINs have AMFI code but are NOT in nav_history
    missing = conn.execute(text("""
        SELECT DISTINCT isin, name, amfi_code, asset_class
        FROM daily_fund_data
        WHERE asset_class != 'SIF'
        AND isin IS NOT NULL
        AND amfi_code IS NOT NULL AND amfi_code != ''
    """)).fetchall()

    missing_from_nav = [(r[0], r[1], r[2], r[3]) for r in missing if r[0] not in tracked]
    print(f"\nFunds with AMFI code NOT in nav_history: {len(missing_from_nav)}")
    print("\nFirst 20:")
    for isin, name, amfi, ac in missing_from_nav[:20]:
        print(f"  {isin} | {amfi} | {str(ac):<12} | {name[:40]}")