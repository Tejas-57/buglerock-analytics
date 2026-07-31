"""Run: cd backend && python check_portfolio_stats.py"""
from models.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

# Check if FundPortfolioStats has data
count = db.execute(text("SELECT COUNT(*) FROM fund_portfolio_stats")).scalar()
print(f"FundPortfolioStats rows: {count}")

if count > 0:
    # Sample a few rows
    rows = db.execute(text("""
        SELECT isin, portfolio_date,
               market_cap_giant, market_cap_large, market_cap_mid,
               market_cap_small, market_cap_micro,
               asset_alloc_equity_net, asset_alloc_bond_net
        FROM fund_portfolio_stats
        LIMIT 5
    """)).fetchall()
    for r in rows:
        total_cap = sum(filter(None, [r.market_cap_giant, r.market_cap_large,
                                      r.market_cap_mid, r.market_cap_small, r.market_cap_micro]))
        print(f"\n{r.isin} ({r.portfolio_date})")
        print(f"  Giant={r.market_cap_giant} Large={r.market_cap_large} "
              f"Mid={r.market_cap_mid} Small={r.market_cap_small} "
              f"Micro={r.market_cap_micro} → total={total_cap:.1f}")
        print(f"  Equity={r.asset_alloc_equity_net} Bond={r.asset_alloc_bond_net}")

db.close()