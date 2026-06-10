import mstarpy
from datetime import datetime, timedelta

end = datetime.today()
start = end - timedelta(days=5)

print("Initializing fund...")
fund = mstarpy.Funds(term='INF204K01562')
print("Fetching NAV...")
rows = fund.nav(start_date=start, end_date=end)
print("Result:", rows[:2])