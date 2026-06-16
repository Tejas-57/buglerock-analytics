import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text

engine = create_engine(os.getenv("DATABASE_URL"))
with engine.connect() as conn:
    latest = conn.execute(text("SELECT MAX(data_date) FROM daily_fund_data")).scalar()
    print(f"Latest data_date: {latest}\n")

    # Total funds on latest date excluding SIF
    total = conn.execute(text("""
        SELECT COUNT(*) FROM daily_fund_data
        WHERE data_date = :d AND asset_class != 'SIF'
    """), {"d": latest}).scalar()
    print(f"Total rows (non-SIF):                {total}")

    # Unique ISINs
    unique_isins = conn.execute(text("""
        SELECT COUNT(DISTINCT isin) FROM daily_fund_data
        WHERE data_date = :d AND asset_class != 'SIF'
        AND isin IS NOT NULL
    """), {"d": latest}).scalar()
    print(f"Unique ISINs (non-SIF):              {unique_isins}")

    # With AMFI code
    with_amfi = conn.execute(text("""
        SELECT COUNT(DISTINCT isin) FROM daily_fund_data
        WHERE data_date = :d AND asset_class != 'SIF'
        AND isin IS NOT NULL
        AND amfi_code IS NOT NULL AND amfi_code != ''
    """), {"d": latest}).scalar()
    print(f"With AMFI code:                      {with_amfi}")

    # Without AMFI code
    without_amfi = conn.execute(text("""
        SELECT COUNT(DISTINCT isin) FROM daily_fund_data
        WHERE data_date = :d AND asset_class != 'SIF'
        AND isin IS NOT NULL
        AND (amfi_code IS NULL OR amfi_code = '')
    """), {"d": latest}).scalar()
    print(f"Without AMFI code:                   {without_amfi}")

    # Breakdown by asset class
    print(f"\n--- Breakdown by asset class ---")
    rows = conn.execute(text("""
        SELECT asset_class,
               COUNT(DISTINCT isin) as total,
               COUNT(DISTINCT CASE WHEN amfi_code IS NOT NULL AND amfi_code != '' THEN isin END) as with_amfi,
               COUNT(DISTINCT CASE WHEN amfi_code IS NULL OR amfi_code = '' THEN isin END) as without_amfi
        FROM daily_fund_data
        WHERE data_date = :d AND asset_class != 'SIF'
        AND isin IS NOT NULL
        GROUP BY asset_class
        ORDER BY total DESC
    """), {"d": latest}).fetchall()
    
    print(f"{'Asset Class':<15} {'Total':>8} {'With AMFI':>10} {'Missing':>8}")
    print("-" * 45)
    for r in rows:
        print(f"{str(r[0]):<15} {r[1]:>8} {r[2]:>10} {r[3]:>8}")

    # Show missing funds sample
    print(f"\n--- Sample funds WITHOUT AMFI code ---")
    missing = conn.execute(text("""
        SELECT DISTINCT isin, name, asset_class, category
        FROM daily_fund_data
        WHERE data_date = :d AND asset_class != 'SIF'
        AND isin IS NOT NULL
        AND (amfi_code IS NULL OR amfi_code = '')
        ORDER BY asset_class, name
        LIMIT 30
    """), {"d": latest}).fetchall()
    
    for r in missing:
        print(f"  {r[0]} | {str(r[2]):<10} | {r[1][:50]}")

    print(f"\nTotal missing: {without_amfi}")
    print(f"Expected by you: 1872")
    print(f"Gap: {1872 - with_amfi}")