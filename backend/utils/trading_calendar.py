"""
trading_calendar.py
NSE holiday list and date offset logic.
data_date = email_date - 1 trading day
So: email_date = data_date + 1 trading day (skipping weekends and holidays)
"""

from datetime import date, timedelta

# NSE Market Holidays 2025-2026
# Update annually from: https://www.nseindia.com/products-services/equity-market-timings-holidays
NSE_HOLIDAYS = {
    # 2025
    date(2025, 1, 26),   # Republic Day
    date(2025, 2, 26),   # Mahashivratri
    date(2025, 3, 14),   # Holi
    date(2025, 3, 31),   # Id-Ul-Fitr (Ramzan Eid)
    date(2025, 4, 10),   # Shri Mahavir Jayanti
    date(2025, 4, 14),   # Dr. Baba Saheb Ambedkar Jayanti
    date(2025, 4, 18),   # Good Friday
    date(2025, 5, 1),    # Maharashtra Day
    date(2025, 8, 15),   # Independence Day
    date(2025, 8, 27),   # Ganesh Chaturthi
    date(2025, 10, 2),   # Mahatma Gandhi Jayanti
    date(2025, 10, 2),   # Gandhi Jayanti
    date(2025, 10, 24),  # Dussehra
    date(2025, 11, 5),   # Diwali (Laxmi Pujan)
    date(2025, 11, 6),   # Diwali (Balipratipada)
    date(2025, 11, 24),  # Gurunanak Jayanti
    date(2025, 12, 25),  # Christmas
    # 2026
    date(2026, 1, 26),   # Republic Day
    date(2026, 3, 20),   # Holi
    date(2026, 4, 2),    # Ram Navami (tentative)
    date(2026, 4, 3),    # Good Friday
    date(2026, 4, 10),   # Good Friday (actual - adjust per NSE)
    date(2026, 4, 14),   # Dr. Ambedkar Jayanti
    date(2026, 5, 1),    # Maharashtra Day
    date(2026, 8, 15),   # Independence Day
    date(2026, 10, 2),   # Gandhi Jayanti
    date(2026, 11, 14),  # Diwali (tentative)
    date(2026, 12, 25),  # Christmas
}


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5  # Saturday=5, Sunday=6


def is_market_holiday(d: date) -> bool:
    return d in NSE_HOLIDAYS


def is_trading_day(d: date) -> bool:
    return not is_weekend(d) and not is_market_holiday(d)


def next_trading_day(d: date) -> date:
    """Return the next trading day after d (exclusive of d)."""
    candidate = d + timedelta(days=1)
    while not is_trading_day(candidate):
        candidate += timedelta(days=1)
    return candidate


def prev_trading_day(d: date) -> date:
    """Return the previous trading day before d (exclusive of d)."""
    candidate = d - timedelta(days=1)
    while not is_trading_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


def get_email_date_for(data_date: date) -> date:
    """
    Given the data_date the user wants to see,
    return the email_date to search for in Gmail.

    Rule: Morningstar sends emails every calendar day (including weekends).
    Email date = data_date + 1 calendar day (simple +1, no trading day skip).
    """
    return data_date + timedelta(days=1)


def get_data_date_for_email(email_date: date) -> date:
    """
    Given an email_date, return the data_date inside the file.
    Rule: data_date = previous trading day before email_date.
    """
    return prev_trading_day(email_date)


def resolve_user_date(user_date: date, check_db: bool = False) -> date:
    """
    If user picks a non-trading day, resolve to the most recent trading day.
    If check_db=True, first check if data exists for the exact date.
    e.g. Saturday → Friday, Holiday → day before
    """
    if is_trading_day(user_date):
        return user_date
    if check_db:
        try:
            from models.database import SessionLocal, DailyFundData
            db = SessionLocal()
            exists = db.query(DailyFundData.data_date).filter(
                DailyFundData.data_date == user_date
            ).first()
            db.close()
            if exists:
                return user_date
        except Exception:
            pass
    return prev_trading_day(user_date)