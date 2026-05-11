from sqlalchemy import create_engine, Column, String, Float, Date, DateTime, Text, Integer, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/buglerock_analytics")

# engine = create_engine(DATABASE_URL)  For PosegrSQL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # required for SQLite
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)


# ── Models ──────────────────────────────────────────────────────────────────

class DailyFundData(Base):
    """Parsed fund data from daily Excel — one row per fund per data_date."""
    __tablename__ = "daily_fund_data"

    id              = Column(Integer, primary_key=True, index=True)
    data_date       = Column(Date, nullable=False, index=True)
    email_date      = Column(Date, nullable=True)
    file_name       = Column(String(255))
    sheet_name      = Column(String(100))

    # Identity
    isin            = Column(String(20), index=True)
    name            = Column(String(255))
    ranking         = Column(String(10))
    category        = Column(String(200))
    asset_class     = Column(String(100))
    amfi_code       = Column(String(20))
    rta_code        = Column(String(50))
    morningstar_category = Column(String(200))
    morningstar_rating   = Column(Float)
    inception_date  = Column(Date)
    manager_name    = Column(Text)
    exit_load       = Column(Text)

    # NAV
    nav             = Column(Float)
    nav_date        = Column(Date)
    nav_52w_high    = Column(Float)
    nav_52w_high_date = Column(Date)

    # Fund size
    fund_size       = Column(Float)
    fund_size_date  = Column(Date)

    # Expense
    expense_ratio   = Column(Float)

    # Returns
    return_1d       = Column(Float)
    return_1w       = Column(Float)
    return_1m       = Column(Float)
    return_3m       = Column(Float)
    return_6m       = Column(Float)
    return_1y       = Column(Float)
    return_2y       = Column(Float)
    return_3y       = Column(Float)
    return_5y       = Column(Float)
    return_7y       = Column(Float)
    return_10y      = Column(Float)
    return_ytd      = Column(Float)
    return_cy2025   = Column(Float)
    return_cy2024   = Column(Float)
    return_cy2023   = Column(Float)
    return_cy2022   = Column(Float)
    return_cy2021   = Column(Float)

    # Risk metrics (3Y)
    std_dev         = Column(Float)
    alpha           = Column(Float)
    beta            = Column(Float)
    sharpe_ratio    = Column(Float)
    sortino_ratio   = Column(Float)
    treynor_ratio   = Column(Float)
    information_ratio = Column(Float)
    up_capture      = Column(Float)
    down_capture    = Column(Float)

    # Portfolio
    large_cap       = Column(Float)
    mid_cap         = Column(Float)
    small_cap       = Column(Float)
    equity_pct      = Column(Float)
    bond_pct        = Column(Float)
    cash_pct        = Column(Float)
    other_pct       = Column(Float)
    pe_ratio        = Column(Float)
    pb_ratio        = Column(Float)
    equity_style    = Column(String(50))

    # Debt-specific
    avg_maturity    = Column(Float)
    modified_duration = Column(Float)
    ytm             = Column(Float)
    avg_credit_quality = Column(String(10))
    credit_aaa      = Column(Float)
    credit_aa       = Column(Float)
    credit_a        = Column(Float)
    credit_bbb      = Column(Float)
    credit_bb       = Column(Float)
    credit_b        = Column(Float)
    credit_below_b  = Column(Float)
    credit_nr       = Column(Float)

    created_at      = Column(DateTime, server_default=func.now())


class BenchmarkData(Base):
    """Benchmark rows per category per date."""
    __tablename__ = "benchmark_data"

    id              = Column(Integer, primary_key=True)
    data_date       = Column(Date, nullable=False, index=True)
    category        = Column(String(200), index=True)
    asset_class     = Column(String(100))
    benchmark_label = Column(String(20))   # "Benchmark 1", "Benchmark 2" etc.
    benchmark_name  = Column(String(255))

    # Same return columns as fund
    return_1d       = Column(Float)
    return_1w       = Column(Float)
    return_1m       = Column(Float)
    return_3m       = Column(Float)
    return_6m       = Column(Float)
    return_1y       = Column(Float)
    return_2y       = Column(Float)
    return_3y       = Column(Float)
    return_5y       = Column(Float)
    return_7y       = Column(Float)
    return_10y      = Column(Float)
    return_ytd      = Column(Float)
    return_cy2025   = Column(Float)
    return_cy2024   = Column(Float)
    return_cy2023   = Column(Float)
    return_cy2022   = Column(Float)
    return_cy2021   = Column(Float)


class EmailFetchLog(Base):
    """Track every email fetch attempt."""
    __tablename__ = "email_fetch_log"

    id          = Column(Integer, primary_key=True)
    email_date  = Column(Date)
    data_date   = Column(Date)
    file_name   = Column(String(255))
    status      = Column(String(20))  # success | failed | skipped
    message     = Column(Text)
    fetched_at  = Column(DateTime, server_default=func.now())
