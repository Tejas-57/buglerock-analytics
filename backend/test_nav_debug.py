import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from datetime import date, timedelta

print("step 1: get amfi code")
from services.db_service import get_amfi_code_for_isin
code = get_amfi_code_for_isin('INF204K01562')
print("step 2: amfi code =", code)

print("step 3: fetching mfapi...")
from services.nav_fetcher import fetch_via_mfapi
start = date(2016, 1, 1)
end = date.today()
rows = fetch_via_mfapi(code, start, end)
print("step 4: rows fetched =", len(rows))

print("step 5: saving rows...")
from services.nav_fetcher import save_nav_rows
added = save_nav_rows('INF204K01562', rows)
print("step 6: rows saved =", added)

print("step 7: checking status...")
from services.nav_fetcher import get_latest_nav_date, has_nav_history
print("has data:", has_nav_history('INF204K01562'))
print("latest date:", get_latest_nav_date('INF204K01562'))
