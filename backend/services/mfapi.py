"""
mfapi.py
Fetches historical NAV data from MFAPI.in (free, no auth required).
API docs: https://www.mfapi.in/
"""

import httpx
import logging
from datetime import date, timedelta
from functools import lru_cache

logger = logging.getLogger(__name__)

MFAPI_BASE = "https://api.mfapi.in/mf"
TRADING_DAYS_PER_YEAR = 252


async def fetch_nav_history(amfi_code: str) -> list:
    """
    Fetch complete NAV history for a fund.
    Returns list of {"date": "YYYY-MM-DD", "nav": float} sorted ascending.
    """
    url = f"{MFAPI_BASE}/{amfi_code}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    nav_data = data.get("data", [])
    result = []
    for entry in nav_data:
        try:
            # MFAPI returns date as "DD-MM-YYYY"
            day, month, year = entry["date"].split("-")
            iso_date = f"{year}-{month}-{day}"
            nav = float(entry["nav"])
            result.append({"date": iso_date, "nav": nav})
        except Exception:
            continue

    # Sort ascending by date
    result.sort(key=lambda x: x["date"])
    return result


def filter_by_period(nav_data: list, period: str) -> tuple:
    """
    Filter NAV data to a given period string (1m, 3m, 6m, 1y, 3y, 5y, 10y).
    Returns (filtered_data, warning_message_or_None).
    """
    if not nav_data:
        return [], None

    today = date.today()
    period_map = {
        "1m":  30,
        "3m":  90,
        "6m":  180,
        "1y":  365,
        "3y":  3 * 365,
        "5y":  5 * 365,
        "10y": 10 * 365,
    }

    days = period_map.get(period, 365)
    start_date = today - timedelta(days=days)

    # Find actual earliest date in data
    earliest_date = date.fromisoformat(nav_data[0]["date"])
    warning = None

    if earliest_date > start_date:
        label = period.upper()
        warning = (
            f"No {label} data available — showing data from {earliest_date.strftime('%d %b %Y')} "
            f"(fund inception)"
        )
        filtered = nav_data
    else:
        start_str = start_date.isoformat()
        filtered = [d for d in nav_data if d["date"] >= start_str]

    return filtered, warning


def filter_by_date_range(nav_data: list, start_date: str, end_date: str) -> list:
    """Filter NAV data to a custom date range."""
    return [d for d in nav_data if start_date <= d["date"] <= end_date]


def calculate_cagr(start_nav: float, end_nav: float, years: float) -> float:
    """CAGR = (end/start)^(1/years) - 1"""
    if years <= 0 or start_nav <= 0:
        return None
    return ((end_nav / start_nav) ** (1 / years) - 1) * 100


def calculate_xirr(cash_flows: list, dates: list) -> float:
    """
    Calculate XIRR given cash_flows and dates.
    cash_flows: list of floats (negative = investment, positive = redemption)
    dates: list of date objects
    Uses scipy.optimize for Newton-Raphson.
    """
    from scipy.optimize import brentq
    from datetime import date as date_type

    if len(cash_flows) != len(dates) or len(cash_flows) < 2:
        return None

    base_date = dates[0]

    def npv(rate):
        total = 0
        for cf, dt in zip(cash_flows, dates):
            days = (dt - base_date).days
            years = days / 365.0
            total += cf / ((1 + rate) ** years)
        return total

    try:
        result = brentq(npv, -0.999, 100.0, maxiter=1000)
        return round(result * 100, 4)
    except Exception:
        return None


def build_chart_data(nav_data: list, period: str, benchmark_nav: list = None) -> tuple:
    """
    Build chart-ready data combining fund NAV and benchmark NAV (rebased to 100).
    Returns (chart_data_list, warning).
    """
    filtered, warning = filter_by_period(nav_data, period)

    if not filtered:
        return [], warning

    chart = []
    for entry in filtered:
        row = {
            "date": entry["date"],
            "fund_nav": round(entry["nav"], 4),
        }
        chart.append(row)

    # Add benchmark if provided — rebased to fund start NAV for visual comparability
    if benchmark_nav:
        start_str = filtered[0]["date"]
        end_str   = filtered[-1]["date"]
        bm_filtered = [d for d in benchmark_nav if start_str <= d["date"] <= end_str]
        if bm_filtered:
            fund_start_nav = filtered[0]["nav"]
            bm_start_nav   = bm_filtered[0]["nav"]
            bm_lookup = {d["date"]: d["nav"] for d in bm_filtered}
            for row in chart:
                bm_val = bm_lookup.get(row["date"])
                if bm_val is not None and bm_start_nav:
                    # Rebase: bm_val / bm_start_nav * fund_start_nav
                    row["benchmark_nav"] = round((bm_val / bm_start_nav) * fund_start_nav, 4)
                else:
                    row["benchmark_nav"] = None

    # Calculate performance stats for the period
    start_nav = filtered[0]["nav"]
    end_nav   = filtered[-1]["nav"]
    start_date = date.fromisoformat(filtered[0]["date"])
    end_date   = date.fromisoformat(filtered[-1]["date"])
    years = (end_date - start_date).days / 365.0

    absolute_return = round(((end_nav - start_nav) / start_nav) * 100, 2) if start_nav else None

    cagr = None
    if years > 1:
        cagr = round(calculate_cagr(start_nav, end_nav, years), 2)

    performance = {
        "start_nav":       round(start_nav, 2),
        "end_nav":         round(end_nav, 2),
        "absolute_return": absolute_return,
        "cagr":            cagr,
        "years":           round(years, 2),
        "period_label":    period.upper(),
    }

    return chart, warning, performance


def calculate_rolling_cagr(nav_data: list, rolling_years: int) -> dict:
    """
    Calculate rolling CAGR on daily NAV data.
    rolling_years: 1, 3, or 5
    Returns dict with chart_data, stats, total_points, or error.
    """
    TRADING_DAYS = TRADING_DAYS_PER_YEAR
    window = rolling_years * TRADING_DAYS
    min_required = window * 2  # need at least 2 full periods

    if len(nav_data) < min_required:
        years_available = len(nav_data) / TRADING_DAYS
        years_required  = (min_required) / TRADING_DAYS
        return {
            "error": "insufficient_data",
            "message": (
                f"Date range has only ~{years_available:.1f} years of data. "
                f"For {rolling_years}Y rolling average, you need at least "
                f"{years_required:.0f} years ({min_required} trading days). "
                f"Please extend your date range."
            ),
        }

    cagr_series = []
    for i in range(len(nav_data) - window):
        start_nav = nav_data[i]["nav"]
        end_nav   = nav_data[i + window]["nav"]
        end_date  = nav_data[i + window]["date"]
        if start_nav > 0:
            cagr = calculate_cagr(start_nav, end_nav, rolling_years)
            if cagr is not None:
                cagr_series.append({"date": end_date, "cagr": round(cagr, 4)})

    if not cagr_series:
        return {"error": "no_data", "message": "Could not calculate rolling CAGR."}

    values = [c["cagr"] for c in cagr_series]
    positive = [v for v in values if v > 0]
    above_12 = [v for v in values if v > 12]

    import statistics
    stats = {
        "avg_cagr":     round(sum(values) / len(values), 2),
        "median_cagr":  round(statistics.median(values), 2),
        "best_cagr":    round(max(values), 2),
        "worst_cagr":   round(min(values), 2),
        "pct_positive": round(len(positive) / len(values) * 100, 1),
        "pct_above_12": round(len(above_12) / len(values) * 100, 1),
        "std_dev_cagr": round(statistics.stdev(values), 2) if len(values) > 1 else 0,
    }

    return {
        "chart_data":   cagr_series,
        "stats":        stats,
        "total_points": len(cagr_series),
    }


async def fetch_yahoo_history(ticker: str) -> list:
    """
    Fetch historical price data from Yahoo Finance for a given ticker.
    Returns list of {"date": "YYYY-MM-DD", "nav": float} sorted ascending.
    """
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval=1d&range=15y"
    )
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        async with httpx.AsyncClient(timeout=30, headers=headers) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        result_data = data.get("chart", {}).get("result", [])
        if not result_data:
            return []

        timestamps = result_data[0].get("timestamp", [])
        closes = result_data[0].get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])

        if not timestamps or not closes:
            return []

        result = []
        for ts, close in zip(timestamps, closes):
            if close is None:
                continue
            from datetime import datetime, timezone
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            result.append({"date": dt.strftime("%Y-%m-%d"), "nav": round(float(close), 4)})

        result.sort(key=lambda x: x["date"])
        return result
    except Exception as e:
        logger.warning(f"Yahoo Finance fetch failed for {ticker}: {e}")
        return []