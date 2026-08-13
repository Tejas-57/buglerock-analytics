"""
debug_mstar_amc.py — get full FundShareClassBasicInfo response to find ProviderCompanyName.
Run: cd buglerock-analytics/backend && python debug_mstar_amc.py
"""
import os, sys, requests, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()
from services.morningstar_service import get_valid_accesscode, BASE_URL

accesscode = get_valid_accesscode()
test_isin = "INF209K01RU9"

url = f"{BASE_URL}/mf/FundShareClassBasicInfo/ISIN/{test_isin}?accesscode={accesscode}"
r = requests.get(url, timeout=20)
print(f"Status: {r.status_code}")
print(f"\nFull response:\n{r.text}")