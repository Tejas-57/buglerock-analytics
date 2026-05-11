# routers/rolling.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type
from services.mfapi import fetch_nav_history, filter_by_date_range, calculate_rolling_cagr
from services.db_service import get_fund_inception_date_by_amfi

router = APIRouter()

# Minimum range needed for each rolling period (in trading days, 252/year)
MIN_YEARS = {1: 2, 3: 6, 5: 10}


@router.get("/analysis")
async def rolling_analysis(
    amfi_code: str,
    rolling_years: int = Query(1, ge=1, le=5),
    start_date: str = Query(...),
    end_date: str   = Query(...),
):
    try:
        all_nav = await fetch_nav_history(amfi_code)
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch NAV data: {e}")

    if not all_nav:
        raise HTTPException(404, "No NAV data available for this fund")

    warning = None

    # Validate start date against inception
    fund_info = get_fund_inception_date_by_amfi(amfi_code)
    inception = None

    if fund_info and fund_info.get("inception_date"):
        inception = fund_info["inception_date"]
        if isinstance(inception, str):
            inception = date_type.fromisoformat(str(inception))

    first_nav_date = date_type.fromisoformat(all_nav[0]["date"])
    if inception is None or first_nav_date > inception:
        inception = first_nav_date

    start_dt = date_type.fromisoformat(start_date)
    end_dt   = date_type.fromisoformat(end_date)

    if start_dt < inception:
        warning = f"This fund's data is available from {inception.strftime('%d %b %Y')}. Analysis adjusted to start from inception date."
        start_date = inception.isoformat()
        start_dt = inception

    # Validate minimum date range for rolling period
    min_years = MIN_YEARS.get(rolling_years, rolling_years * 2)
    total_years = (end_dt - start_dt).days / 365.25
    if total_years < min_years:
        raise HTTPException(
            400,
            f"Date range too short. {rolling_years}Y rolling analysis needs at least {min_years} years of data. "
            f"Selected range is only {total_years:.1f} years."
        )

    # Filter to user date range
    nav_data = filter_by_date_range(all_nav, start_date, end_date)

    if not nav_data:
        raise HTTPException(400, "No NAV data in selected date range")

    result = calculate_rolling_cagr(nav_data, rolling_years)

    if warning:
        result["warning"] = warning

    return result