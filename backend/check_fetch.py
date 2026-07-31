"""Run: cd backend && python check_fetch.py"""
from models.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

# Check columns in holdings_fetch_log
cols = db.execute(text("PRAGMA table_info(holdings_fetch_log)")).fetchall()
print("holdings_fetch_log columns:", [c[1] for c in cols])

rows = db.execute(text("SELECT * FROM holdings_fetch_log LIMIT 5")).fetchall()
print(f"\nFetch log rows: {len(rows)}")
for r in rows:
    print(f"  {r}")

print("\n=== FundHolding rows ===")
count = db.execute(text("SELECT COUNT(*) FROM fund_holding")).scalar()
print(f"  {count} rows")

if count > 0:
    sample = db.execute(text("""
        SELECT isin, portfolio_date, holding_type, name, weighting 
        FROM fund_holding LIMIT 3
    """)).fetchall()
    for r in sample:
        print(f"  {r.isin} {r.portfolio_date} {r.holding_type} {str(r.name)[:30]} {r.weighting}")

print("\n=== FundPortfolioStats ===")
pcount = db.execute(text("SELECT COUNT(*) FROM fund_portfolio_stats")).scalar()
print(f"  {pcount} rows")

if pcount > 0:
    ps_cols = db.execute(text("PRAGMA table_info(fund_portfolio_stats)")).fetchall()
    print("  columns:", [c[1] for c in ps_cols])
    sample = db.execute(text("""
        SELECT isin, portfolio_date, market_cap_giant, market_cap_large, 
               market_cap_mid, market_cap_small, market_cap_micro
        FROM fund_portfolio_stats LIMIT 3
    """)).fetchall()
    for r in sample:
        print(f"  {r}")

db.close()