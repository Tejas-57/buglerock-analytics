"""Check the R1/R2 fund universe for portfolio construction."""
from models.database import SessionLocal
from services.db_service import get_latest_data_date
from sqlalchemy import text
from collections import Counter

db = SessionLocal()
date = get_latest_data_date()
print(f"Date: {date}\n")

# All R1/R2 funds
rows = db.execute(text("""
    SELECT isin, name, asset_class, category, ranking,
           equity_pct, bond_pct, large_cap, mid_cap, small_cap,
           sharpe_ratio_3y, return_1y, return_3y
    FROM daily_fund_data
    WHERE data_date = :date AND ranking IN ('R1','R2') AND nav IS NOT NULL
"""), {"date": str(date)}).fetchall()

print(f"Total R1/R2 funds: {len(rows)}\n")

# Detect fund types by name pattern
def classify_fund_type(name, category, asset_class):
    n = (name or "").lower()
    c = (category or "").lower()
    ac = (asset_class or "").lower()
    
    if "gold" in n or "silver" in n or "precious" in c:
        return "Alternates (Gold/Silver)"
    if any(k in n for k in ["etf", "index", "nifty", "sensex", "bse"]):
        if any(k in n for k in ["low vol", "quality", "momentum", "value etf", "alpha", "equal weight"]):
            return "Smart Beta"
        return "Passive/ETF"
    if "global" in n or "international" in n or "us equity" in n or "china" in n or "europe" in n or "japan" in n or "world" in n or "foreign" in n:
        return "Global"
    if ac == "hybrid":
        return "Hybrid"
    if ac == "debt":
        return "Debt"
    if ac == "equity":
        return "Equity MF (Active)"
    return "Other"

buckets = Counter()
for r in rows:
    buckets[classify_fund_type(r.name, r.category, r.asset_class)] += 1

print("Fund type breakdown (R1/R2 only):")
for k, v in sorted(buckets.items(), key=lambda x: -x[1]):
    print(f"  {v:>3}  {k}")

# Also check if we have any Gold/Silver ETFs at all (may not be R1/R2)
print("\n=== Gold/Silver ETFs in full universe (any ranking) ===")
gold_rows = db.execute(text("""
    SELECT name, asset_class, category, ranking
    FROM daily_fund_data
    WHERE data_date = :date AND nav IS NOT NULL
      AND (LOWER(name) LIKE '%gold%' OR LOWER(name) LIKE '%silver%')
    LIMIT 15
"""), {"date": str(date)}).fetchall()
for r in gold_rows:
    print(f"  {r.ranking or '—':<4} {r.asset_class:<10} {r.name[:50]}")

# Passive/ETF sample
print("\n=== Passive/ETF sample (R1/R2) ===")
for r in rows[:60]:
    ftype = classify_fund_type(r.name, r.category, r.asset_class)
    if ftype in ("Passive/ETF", "Smart Beta", "Global"):
        print(f"  {ftype:<15} {r.name[:55]}")

db.close()