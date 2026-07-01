from dotenv import load_dotenv
load_dotenv()
from services.morningstar_service import fetch_fund_portfolio, get_valid_accesscode

accesscode = get_valid_accesscode()
data = fetch_fund_portfolio("INF03VN01779", accesscode)
print([k for k in data.keys()])