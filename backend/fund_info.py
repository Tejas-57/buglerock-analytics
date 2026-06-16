"""
Get full info for a fund ISIN: AMFI code, inception date, and export full NAV history.
Usage: python fund_info.py INF843K01047
"""
import sys, os, requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from services.db_service import get_amfi_code_for_isin, get_fund_name_for_isin
from sqlalchemy import create_engine, text

engine = create_engine(os.getenv("DATABASE_URL"))

isin = sys.argv[1] if len(sys.argv) > 1 else "INF843K01047"

# 1. From DB
amfi = get_amfi_code_for_isin(isin)
name = get_fund_name_for_isin(isin)

with engine.connect() as conn:
    row = conn.execute(text("""
        SELECT inception_date, category, asset_class, ranking, expense_ratio
        FROM daily_fund_data
        WHERE isin = :isin AND inception_date IS NOT NULL
        ORDER BY data_date DESC LIMIT 1
    """), {"isin": isin}).fetchone()

print(f"\n{'='*55}")
print(f"ISIN:              {isin}")
print(f"Fund name:         {name}")
print(f"AMFI code:         {amfi}")
if row:
    print(f"Inception date:    {row[0]}  (from Morningstar DB)")
    print(f"Category:          {row[1]}")
    print(f"Asset class:       {row[2]}")
    print(f"Ranking:           {row[3]}")
    print(f"Expense ratio:     {row[4]}%")

if not amfi:
    print("\nNo AMFI code — cannot fetch from mfapi.")
    sys.exit()

# 2. From mfapi
resp = requests.get(f"https://api.mfapi.in/mf/{amfi}",
                    headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
data = resp.json()
meta = data.get("meta", {})
navs = data.get("data", [])

print(f"\n--- mfapi metadata ---")
print(f"Scheme name:       {meta.get('scheme_name')}")
print(f"Fund house:        {meta.get('fund_house')}")
print(f"Scheme type:       {meta.get('scheme_type')}")
print(f"Scheme category:   {meta.get('scheme_category')}")

if navs:
    earliest = navs[-1]
    latest = navs[0]
    print(f"\n--- NAV history ---")
    print(f"Total rows:        {len(navs)}")
    print(f"Earliest on mfapi: {earliest['date']}  NAV={earliest['nav']}")
    print(f"Latest on mfapi:   {latest['date']}  NAV={latest['nav']}")
    if row and row[0]:
        from datetime import datetime
        inc = row[0]
        earliest_mfapi = datetime.strptime(earliest['date'], "%d-%m-%Y").date()
        gap_days = (earliest_mfapi - inc).days
        if gap_days > 30:
            print(f"\n⚠️  DATA GAP DETECTED:")
            print(f"   Inception (Morningstar): {inc}")
            print(f"   Earliest NAV (mfapi):    {earliest['date']}")
            print(f"   Missing history:         {gap_days} days ({gap_days//365} yrs {(gap_days%365)//30} months)")
        else:
            print(f"\n✅ No significant data gap.")


print(f"{'='*55}")