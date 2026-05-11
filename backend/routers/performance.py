# routers/performance.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.db_service import get_fund_snapshot, get_benchmark_for_category, get_peer_avg
from services.mfapi import fetch_nav_history, build_chart_data
from services.gmail_watcher import fetch_and_store
from utils.trading_calendar import resolve_user_date
import asyncio

router = APIRouter()


def _resolve(date_str):
    d = date_type.fromisoformat(date_str) if date_str else date_type.today()
    return resolve_user_date(d)


@router.get("/metrics")
def performance_metrics(
    isin: str,
    category: str,
    asset_class: str,
    date: str = Query(None),
):
    d = _resolve(date)
    fetch_and_store(d)

    fund_data = get_fund_snapshot(isin, d)
    if not fund_data:
        raise HTTPException(404, f"No data for {isin} on {d}")

    benchmark = get_benchmark_for_category(category, d)
    peer_avg  = get_peer_avg(category, d, asset_class)

    return {
        "fund":      {"returns": fund_data["returns"], "risk": fund_data["risk"], "name": fund_data["name"]},
        "benchmark": benchmark,
        "peer_avg":  peer_avg,
        "date":      str(d),
    }


@router.get("/nav-chart")
async def nav_chart(
    amfi_code: str,
    period: str = "1y",
    asset_class: str = Query(None),
    category: str = Query(None),
    date: str = Query(None),
):
    """Fetch historical NAV from MFAPI and optionally benchmark from Yahoo Finance."""
    from utils.benchmark_tickers import get_ticker_for_benchmark, BENCHMARK_ENABLED_ASSET_CLASSES
    from services.mfapi import fetch_yahoo_history
    from services.db_service import get_benchmark_for_category
    from utils.trading_calendar import resolve_user_date
    import asyncio

    try:
        # Fetch fund NAV from MFAPI
        nav_data = await fetch_nav_history(amfi_code)

        # Fetch benchmark from Yahoo only for equity asset classes
        benchmark_nav = None
        benchmark_name = None
        yahoo_ticker = None

        if asset_class in BENCHMARK_ENABLED_ASSET_CLASSES and category:
            d = resolve_user_date(
                date_type.fromisoformat(date) if date else date_type.today()
            )
            bm = get_benchmark_for_category(category, d)
            if bm and bm.get("name"):
                benchmark_name = bm["name"]
                yahoo_ticker = get_ticker_for_benchmark(benchmark_name)
                if yahoo_ticker:
                    benchmark_nav = await fetch_yahoo_history(yahoo_ticker)

        chart_data, warning, performance = build_chart_data(nav_data, period, benchmark_nav)
        return {
            "data": chart_data,
            "warning": warning,
            "period": period,
            "performance": performance,
            "benchmark_name": benchmark_name,
            "benchmark_ticker": yahoo_ticker,
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch NAV data: {str(e)}")