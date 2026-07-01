"""
Quick test script — validates the Morningstar NewPortfolioApi holdings endpoint
for a single fund before building the full integration.

Uses `requests` instead of `httpx` to avoid a Python 3.14 / httpcore
compatibility issue.

Usage:
    pip install requests
    python test_holdings.py
"""

import requests
import json

ACCESSCODE = "nyzpbnrru7ikuhesew06jfcxdoph162b"  # existing valid accesscode
HOLDINGS_API_CODE = "v4glpjr2u59vnr12"  # NewPortfolioApi
TEST_ISIN = "INF03VN01779"

url = f"https://api.morningstar.com/v2/service/mf/{HOLDINGS_API_CODE}/ISIN/{TEST_ISIN}"
params = {
    "accesscode": ACCESSCODE,
    "format": "json",
}

print(f"Calling: {url}")
print(f"Params: {params}\n")

try:
    resp = requests.get(url, params=params, timeout=20)
    print(f"Status: {resp.status_code}\n")

    try:
        data = resp.json()
        text = json.dumps(data, indent=2)
        print(text)
        if len(text) > 3000:
            print("\n... (truncated, full response is longer)")
    except json.JSONDecodeError:
        print("Response was not JSON. Raw text:")
        print(resp.text[:2000])

except requests.RequestException as e:
    print(f"Request failed: {e}")