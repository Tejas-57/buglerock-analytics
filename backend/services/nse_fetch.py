"""
nse_fetch.py
Fetches NSE index historical data for benchmark comparison.
Uses NSE India API as primary source for Total Return Index data.
"""

import httpx
import logging
from datetime import date, timedelta

logger = logging.getLogger(__name__)

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


async def fetch_nse_index_history(index_name: str) -> dict | None:
    """
    Fetch historical daily data for an NSE index.
    Returns dict of {date_str: value} or None if unavailable.
    """
    try:
        # NSE requires a session cookie first
        async with httpx.AsyncClient(headers=NSE_HEADERS, timeout=15, follow_redirects=True) as client:
            # Get session cookie
            await client.get("https://www.nseindia.com/")

            end_date = date.today()
            start_date = end_date - timedelta(days=365 * 6)  # 6 years max

            url = (
                f"https://www.nseindia.com/api/historicalindices"
                f"?indexType={index_name.replace(' ', '%20')}"
                f"&from={start_date.strftime('%d-%m-%Y')}"
                f"&to={end_date.strftime('%d-%m-%Y')}"
            )

            resp = await client.get(url)
            if resp.status_code != 200:
                return None

            data = resp.json()
            records = data.get("data", [])
            if not records:
                return None

            result = {}
            for rec in records:
                try:
                    d = rec.get("TIMESTAMP") or rec.get("HistoricalDate", "")
                    v = rec.get("CLOSE") or rec.get("CLOSINGINDEX")
                    if d and v:
                        # Normalize date format to YYYY-MM-DD
                        from datetime import datetime
                        for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
                            try:
                                parsed = datetime.strptime(str(d), fmt)
                                result[parsed.strftime("%Y-%m-%d")] = float(v)
                                break
                            except ValueError:
                                continue
                except Exception:
                    continue

            return result if result else None

    except Exception as e:
        logger.warning(f"NSE fetch failed for {index_name}: {e}")
        return None
    