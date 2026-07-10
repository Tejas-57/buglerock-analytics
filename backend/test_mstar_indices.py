"""
Test Morningstar API for Nifty index historical data availability.
Run from backend/ directory:
    python test_mstar_indices.py
"""
import sys, os, requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

BASE = "https://api.morningstar.com/v2/service"

# Morningstar SecIDs for major Nifty TRI indices
NIFTY_SECIDS = {
    "Nifty 50 TRI":           "F0GBR04YKY",
    "Nifty 500 TRI":          "F0GBR04YL0",
    "Nifty Midcap 150 TRI":   "F0GBR06GS9",
    "Nifty Bank TRI":         "F0GBR04YL5",
    "Nifty IT TRI":           "F0GBR04YL8",
}

# Get accesscode from DB
def get_accesscode():
    from models.database import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        row = db.execute(text(
            "SELECT accesscode FROM morningstar_accesscode ORDER BY id DESC LIMIT 1"
        )).fetchone()
        return row[0] if row else None
    finally:
        db.close()

ac = get_accesscode()
if not ac:
    print("ERROR: No accesscode found in DB")
    sys.exit(1)
print(f"Accesscode: {ac[:8]}...{ac[-4:]}\n")

# Endpoint patterns to probe
ENDPOINTS = [
    ("TimeSeries/NAV by SecID",
     lambda s: f"{BASE}/timeseries/nav/secid/{s}?accesscode={ac}&format=json&startdate=2020-01-01&enddate=2024-12-31"),
    ("NAV by SecID (MF endpoint)",
     lambda s: f"{BASE}/mf/v4glpjr2u59vnr12/secid/{s}?accesscode={ac}&format=json"),
    ("SecurityDetail (quote)",
     lambda s: f"{BASE}/security/realtime/SecurityDetail?SecIds={s}&accesscode={ac}&format=json"),
    ("TimeSeries HistoricalTR",
     lambda s: f"{BASE}/timeseries/HistoricalTR?SecId={s}&accesscode={ac}&format=json&startdate=2020-01-01"),
    ("Performance (returns)",
     lambda s: f"{BASE}/security/Performance?SecId={s}&accesscode={ac}&format=json"),
]

# Test with Nifty 50 TRI first
secid, name = "F0GBR04YKY", "Nifty 50 TRI"
print(f"Testing: {name} (SecID: {secid})")
print("=" * 72)

for ep_name, url_fn in ENDPOINTS:
    url = url_fn(secid)
    try:
        r = requests.get(url, timeout=15)
        status_sym = "✓" if r.status_code == 200 else "✗"
        print(f"\n{status_sym} [{ep_name}] HTTP {r.status_code}")
        if r.status_code == 200:
            try:
                body = r.json()
                api_status = body.get("status", {})
                print(f"  API code={api_status.get('code')} msg={str(api_status.get('message',''))[:80]}")
                data = body.get("data", [])
                print(f"  data items: {len(data)}")
                if data and isinstance(data[0], dict):
                    print(f"  first item keys: {list(data[0].keys())[:10]}")
                    # Try to show a date and value if available
                    for k in ['date', 'Date', 'nav', 'NAV', 'value', 'Value', 'close', 'Close']:
                        if k in data[0]:
                            print(f"  sample: {k}={data[0][k]}")
            except Exception as je:
                print(f"  JSON parse error: {je}")
                print(f"  raw: {r.text[:200]}")
        else:
            print(f"  body: {r.text[:200]}")
    except Exception as e:
        print(f"\n✗ [{ep_name}] ERROR: {e}")

print("\n\nDone.")