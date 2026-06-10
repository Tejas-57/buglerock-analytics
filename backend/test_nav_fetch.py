import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load env
from dotenv import load_dotenv
load_dotenv()

print("Testing nav fetch directly...")

# Test 1: mfapi directly
try:
    from services.nav_fetcher import fetch_via_mfapi
    from datetime import date, timedelta
    end = date.today()
    start = end - timedelta(days=5)
    rows = fetch_via_mfapi("106235", start, end)
    print(f"mfapi test: OK - {len(rows)} rows")
    print("Sample:", rows[:1])
except Exception as e:
    print(f"mfapi test FAILED: {e}")

# Test 2: get amfi code
try:
    from services.db_service import get_amfi_code_for_isin
    code = get_amfi_code_for_isin("INF204K01562")
    print(f"AMFI code for INF204K01562: {code}")
except Exception as e:
    print(f"get_amfi_code FAILED: {e}")

# Test 3: full fetch
try:
    from services.nav_fetcher import fetch_nav_history
    result = fetch_nav_history("INF204K01562", force_full=False)
    print(f"fetch_nav_history result: {result}")
except Exception as e:
    print(f"fetch_nav_history FAILED: {e}")

# Test 4: check nav_history table exists
try:
    from models.database import engine
    from sqlalchemy import inspect
    tables = inspect(engine).get_table_names()
    print(f"Tables in DB: {tables}")
except Exception as e:
    print(f"DB inspect FAILED: {e}")