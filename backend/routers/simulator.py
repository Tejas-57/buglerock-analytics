# routers/simulator.py
from fastapi import APIRouter, Query, HTTPException
from datetime import date as date_type, timedelta
from services.mfapi import filter_by_date_range, calculate_cagr, calculate_xirr
from services.db_service import get_fund_inception_date_by_amfi, get_isin_for_amfi

router = APIRouter()


def _get_nav_from_db(amfi_code: str) -> list:
    """Fetch full NAV history from DB by amfi_code. Returns list of {date: str, nav: float}."""
    from services.nav_fetcher import get_nav_series
    from datetime import date

    isin = get_isin_for_amfi(amfi_code)
    if not isin:
        raise HTTPException(404, f"No fund found for AMFI code {amfi_code}")

    rows = get_nav_series(isin, date(1970, 1, 1), date.today())
    if not rows:
        raise HTTPException(404, "No NAV data in database for this fund. Try again later.")

    return sorted(
        [{"date": str(r["date"]), "nav": float(r["nav"])} for r in rows if r["nav"]],
        key=lambda x: x["date"]
    )


def find_nav_on_or_after(nav_data: list, target_date: str) -> dict:
    for entry in nav_data:
        if entry["date"] >= target_date:
            return entry
    return None


def find_nav_on_or_before(nav_data: list, target_date: str) -> dict:
    result = None
    for entry in nav_data:
        if entry["date"] <= target_date:
            result = entry
    return result


def validate_and_adjust_dates(amfi_code: str, start_date: str, end_date: str, nav_data: list):
    """
    Check if start_date is before fund inception.
    Returns (adjusted_start_date, warning_message or None)
    """
    warning = None

    # Get inception from DB first
    fund_info = get_fund_inception_date_by_amfi(amfi_code)
    inception = None

    if fund_info and fund_info.get("inception_date"):
        inception = fund_info["inception_date"]
        if isinstance(inception, str):
            inception = date_type.fromisoformat(inception)

    # Also check first available NAV date from MFAPI
    if nav_data:
        first_nav_date = date_type.fromisoformat(nav_data[0]["date"])
        if inception is None or first_nav_date > inception:
            inception = first_nav_date

    if inception is None:
        return start_date, None

    start_dt = date_type.fromisoformat(start_date)
    end_dt   = date_type.fromisoformat(end_date)

    if start_dt < inception:
        warning = f"This fund's data is available from {inception.strftime('%d %b %Y')}. Simulation adjusted to start from inception date."
        start_date = inception.isoformat()

    # Also validate end date is after start
    if date_type.fromisoformat(start_date) >= end_dt:
        raise HTTPException(400, "Start date must be before end date.")

    return start_date, warning


@router.get("/run")
def run_simulation(
    amfi_code: str,
    mode: str,
    amount: float,
    start_date: str,
    end_date: str,
    sip_date: int = Query(1, ge=1, le=28),
):
    nav_data = _get_nav_from_db(amfi_code)

    if not nav_data:
        raise HTTPException(404, "No NAV data available")

    # Validate and adjust dates
    start_date, warning = validate_and_adjust_dates(amfi_code, start_date, end_date, nav_data)

    if mode == "lumpsum":
        result = _lumpsum(nav_data, amount, start_date, end_date)
    elif mode == "sip":
        result = _sip(nav_data, amount, start_date, end_date, sip_date)
    else:
        raise HTTPException(400, "mode must be 'lumpsum' or 'sip'")

    if warning:
        result["warning"] = warning

    return result


def _lumpsum(nav_data, amount, start_date, end_date):
    start_entry = find_nav_on_or_after(nav_data, start_date)
    end_entry   = find_nav_on_or_before(nav_data, end_date)

    if not start_entry or not end_entry:
        raise HTTPException(400, "NAV data not available for selected dates")

    units = amount / start_entry["nav"]
    current_value = units * end_entry["nav"]

    start_dt = date_type.fromisoformat(start_entry["date"])
    end_dt   = date_type.fromisoformat(end_entry["date"])
    years    = (end_dt - start_dt).days / 365.25

    cagr = calculate_cagr(start_entry["nav"], end_entry["nav"], years)
    abs_return = ((current_value - amount) / amount) * 100

    filtered = filter_by_date_range(nav_data, start_entry["date"], end_entry["date"])
    chart_data = [
        {
            "date": e["date"],
            "portfolio_value": round((e["nav"] / start_entry["nav"]) * amount, 2),
            "invested_value": amount,
        }
        for e in filtered
    ]

    return {
        "mode": "lumpsum",
        "total_invested": round(amount, 2),
        "current_value": round(current_value, 2),
        "absolute_return": round(abs_return, 2),
        "cagr_or_xirr": round(cagr, 2) if cagr else None,
        "years": round(years, 2),
        "start_date": start_entry["date"],
        "end_date": end_entry["date"],
        "chart_data": chart_data,
    }


def _sip(nav_data, monthly_amount, start_date, end_date, sip_date):
    nav_lookup = {e["date"]: e["nav"] for e in nav_data}
    nav_dates  = sorted(nav_lookup.keys())

    start_dt = date_type.fromisoformat(start_date)
    end_dt   = date_type.fromisoformat(end_date)

    # First SIP on or after start_date on the chosen sip_date
    current = date_type(start_dt.year, start_dt.month, sip_date)
    if current < start_dt:
        if current.month == 12:
            current = date_type(current.year + 1, 1, sip_date)
        else:
            current = date_type(current.year, current.month + 1, sip_date)

    total_units    = 0
    total_invested = 0
    cash_flows     = []
    cf_dates       = []
    cumulative     = []

    while current <= end_dt:
        date_str  = current.isoformat()
        nav_entry = find_nav_on_or_after(
            [{"date": d, "nav": nav_lookup[d]} for d in nav_dates if d >= date_str],
            date_str
        )
        if nav_entry:
            units = monthly_amount / nav_entry["nav"]
            total_units    += units
            total_invested += monthly_amount
            cash_flows.append(-monthly_amount)
            cf_dates.append(date_type.fromisoformat(nav_entry["date"]))
            cumulative.append({"date": nav_entry["date"], "invested": total_invested, "units_held": total_units})

        # Next month
        if current.month == 12:
            current = date_type(current.year + 1, 1, sip_date)
        else:
            try:
                current = date_type(current.year, current.month + 1, sip_date)
            except ValueError:
                import calendar
                last_day = calendar.monthrange(current.year, current.month + 1)[1]
                current = date_type(current.year, current.month + 1, min(sip_date, last_day))

    final_nav_entry = find_nav_on_or_before(nav_data, end_date)
    if not final_nav_entry or total_units == 0:
        raise HTTPException(400, "Could not calculate SIP — check date range")

    current_value = total_units * final_nav_entry["nav"]
    cash_flows.append(current_value)
    cf_dates.append(date_type.fromisoformat(final_nav_entry["date"]))

    xirr       = calculate_xirr(cash_flows, cf_dates)
    abs_return = ((current_value - total_invested) / total_invested) * 100
    years      = (cf_dates[-1] - cf_dates[0]).days / 365.25

    # Chart: units_held is cumulative units after each instalment;
    # portfolio_value = units held × NAV on that instalment date.
    chart_data = []
    for inv in cumulative:
        nav_at_date = nav_lookup[inv["date"]]
        chart_data.append({
            "date": inv["date"],
            "portfolio_value": round(inv["units_held"] * nav_at_date, 2),
            "invested_value":  round(inv["invested"], 2),
        })

    return {
        "mode": "sip",
        "total_invested": round(total_invested, 2),
        "current_value":  round(current_value, 2),
        "absolute_return": round(abs_return, 2),
        "cagr_or_xirr":   round(xirr, 2) if xirr else None,
        "total_instalments": len(cumulative),
        "years":  round(years, 2),
        "start_date": start_date,
        "end_date":   final_nav_entry["date"],
        "chart_data": chart_data,
    }