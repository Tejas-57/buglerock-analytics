# routers/performance.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.db_service import get_fund_snapshot, get_benchmark_for_category, get_peer_avg
from services.nav_service import fetch_nav_history, build_chart_data
from services.gmail_watcher import fetch_and_store

router = APIRouter()


def _resolve(date_str):
    from services.db_service import get_latest_data_date, has_data_for_date
    if date_str:
        d = date_type.fromisoformat(date_str)
        if has_data_for_date(d):
            return d
    return get_latest_data_date() or date_type.today()


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
    isin: str = Query(None),
    asset_class: str = Query(None),
    category: str = Query(None),
    date: str = Query(None),
):
    from utils.benchmark_tickers import (
        get_nse_index_for_benchmark,
        get_yahoo_ticker_for_benchmark,
        BENCHMARK_ENABLED_ASSET_CLASSES,
    )
    from services.nse_fetch import fetch_nse_index_history
    from services.nav_service import fetch_yahoo_history

    try:
        nav_data = await fetch_nav_history(amfi_code, isin=isin, period=period)
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch NAV: {e}")

    benchmark_nav  = None
    benchmark_name = None
    data_source    = None

    if asset_class in BENCHMARK_ENABLED_ASSET_CLASSES and category:
        d = (
            date_type.fromisoformat(date) if date else date_type.today()
        )
        bm = get_benchmark_for_category(category, d)

        if bm and bm.get("name"):
            benchmark_name = bm["name"]

            # Try NSE India first (TR index)
            nse_index = get_nse_index_for_benchmark(benchmark_name)
            if nse_index:
                try:
                    benchmark_nav = await fetch_nse_index_history(nse_index)
                    if benchmark_nav:
                        data_source = f"NSE India TRI"
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"NSE fetch failed: {e}")
                    benchmark_nav = None

            # Fallback to Yahoo Finance for international indices
            if not benchmark_nav:
                yahoo_ticker = get_yahoo_ticker_for_benchmark(benchmark_name)
                if yahoo_ticker:
                    try:
                        benchmark_nav = await fetch_yahoo_history(yahoo_ticker)
                        if benchmark_nav:
                            data_source = "Yahoo Finance PR"
                    except Exception:
                        benchmark_nav = None

    chart_data, warning, performance = build_chart_data(nav_data, period, benchmark_nav)

    bm_disclaimer = None
    if data_source == "NSE India TRI":
        bm_disclaimer = f"Benchmark: {benchmark_name} — Total Return Index (NSE India)"
    elif data_source == "Yahoo Finance PR":
        bm_disclaimer = f"Benchmark shows Price Return (Yahoo Finance) — excludes dividends, may differ from Morningstar TR"

    return {
        "data":           chart_data,
        "warning":        warning,
        "period":         period,
        "performance":    performance,
        "benchmark_name": benchmark_name,
        "data_source":    data_source,
        "bm_disclaimer":  bm_disclaimer,
    }


@router.get("/peer-avg")
def peer_avg_only(category: str, asset_class: str, date: str = Query(None)):
    """Return peer average for a category without needing a specific fund ISIN."""
    from services.db_service import get_latest_data_date
    d = date_type.fromisoformat(date) if date else date_type.today()
    # If no data for requested date, fall back to latest available
    from services.db_service import get_peer_avg as _get_peer_avg
    peer_avg = _get_peer_avg(category, d, asset_class)
    if peer_avg is None:
        d = get_latest_data_date() or d
        peer_avg = _get_peer_avg(category, d, asset_class)
    benchmark = get_benchmark_for_category(category, d)
    return {
        "benchmark": benchmark,
        "peer_avg": peer_avg,
        "date": str(d),
    }