from sqlalchemy import create_engine, Column, String, Float, Date, DateTime, Text, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./buglerock.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
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
    # Run migrations for new columns
    _migrate_benchmark_risk_columns()


def _migrate_benchmark_risk_columns():
    """Add risk columns to benchmark_data table if they don't exist."""
    new_cols = [
        ("std_dev_1y",       "FLOAT"),
        ("sharpe_ratio_1y",  "FLOAT"),
        ("sortino_ratio_1y", "FLOAT"),
        ("std_dev_3y",       "FLOAT"),
        ("sharpe_ratio_3y",  "FLOAT"),
        ("sortino_ratio_3y", "FLOAT"),
        ("std_dev_5y",       "FLOAT"),
        ("sharpe_ratio_5y",  "FLOAT"),
        ("sortino_ratio_5y", "FLOAT"),
    ]
    try:
        with engine.connect() as conn:
            for col_name, col_type in new_cols:
                try:
                    conn.execute(
                        __import__('sqlalchemy').text(
                            f"ALTER TABLE benchmark_data ADD COLUMN {col_name} {col_type}"
                        )
                    )
                    conn.commit()
                except Exception:
                    conn.rollback()  # Column already exists — skip
    except Exception:
        pass  # SQLite or migration not needed


class DailyFundData(Base):
    __tablename__ = "daily_fund_data"

    id          = Column(Integer, primary_key=True, index=True)
    data_date   = Column(Date, nullable=False, index=True)
    email_date  = Column(Date)
    file_name   = Column(String(255))
    sheet_name  = Column(String(100))

    # Identity
    isin                 = Column(String(20), index=True)
    name                 = Column(String(255))
    ranking              = Column(String(10))
    category             = Column(String(200))
    raw_category         = Column(String(200))
    asset_class          = Column(String(100))
    amfi_code            = Column(String(20))
    rta_code             = Column(String(50))
    morningstar_category = Column(String(200))
    morningstar_rating   = Column(Float)
    inception_date       = Column(Date)
    manager_name         = Column(Text)
    exit_load            = Column(Text)

    # NAV
    nav               = Column(Float)
    nav_date          = Column(Date)
    nav_52w_high      = Column(Float)
    nav_52w_high_date = Column(Date)
    nav_52w_low       = Column(Float)
    nav_mo_end        = Column(Float)

    # Fund size
    fund_size      = Column(Float)
    fund_size_date = Column(Date)
    expense_ratio  = Column(Float)

    # Returns
    return_1d     = Column(Float)
    return_1w     = Column(Float)
    return_1m     = Column(Float)
    return_3m     = Column(Float)
    return_6m     = Column(Float)
    return_1y     = Column(Float)
    return_2y     = Column(Float)
    return_3y     = Column(Float)
    return_5y     = Column(Float)
    return_7y     = Column(Float)
    return_10y    = Column(Float)
    return_ytd    = Column(Float)
    return_cy2025 = Column(Float)
    return_cy2024 = Column(Float)
    return_cy2023 = Column(Float)
    return_cy2022 = Column(Float)
    return_cy2021 = Column(Float)

    # Risk — 1Y
    std_dev_1y           = Column(Float)
    alpha_1y             = Column(Float)
    beta_1y              = Column(Float)
    sharpe_ratio_1y      = Column(Float)
    sortino_ratio_1y     = Column(Float)
    treynor_ratio_1y     = Column(Float)
    information_ratio_1y = Column(Float)
    up_capture_1y        = Column(Float)
    down_capture_1y      = Column(Float)

    # Risk — 3Y
    std_dev_3y           = Column(Float)
    alpha_3y             = Column(Float)
    beta_3y              = Column(Float)
    sharpe_ratio_3y      = Column(Float)
    sortino_ratio_3y     = Column(Float)
    treynor_ratio_3y     = Column(Float)
    information_ratio_3y = Column(Float)
    up_capture_3y        = Column(Float)
    down_capture_3y      = Column(Float)

    # Risk — 5Y
    std_dev_5y           = Column(Float)
    alpha_5y             = Column(Float)
    beta_5y              = Column(Float)
    sharpe_ratio_5y      = Column(Float)
    sortino_ratio_5y     = Column(Float)
    treynor_ratio_5y     = Column(Float)
    information_ratio_5y = Column(Float)
    up_capture_5y        = Column(Float)
    down_capture_5y      = Column(Float)

    # Portfolio composition
    large_cap    = Column(Float)
    mid_cap      = Column(Float)
    small_cap    = Column(Float)
    equity_pct   = Column(Float)
    bond_pct     = Column(Float)
    cash_pct     = Column(Float)
    other_pct    = Column(Float)
    pe_ratio     = Column(Float)
    pb_ratio     = Column(Float)
    equity_style = Column(String(50))

    # Equity region
    region_americas = Column(Float)
    region_europe   = Column(Float)
    region_asia     = Column(Float)
    region_emerging = Column(Float)

    # Factor profile
    factor_momentum   = Column(Float)
    factor_quality    = Column(Float)
    factor_volatility = Column(Float)
    factor_size       = Column(Float)
    factor_style      = Column(Float)
    factor_yield      = Column(Float)
    factor_liquidity  = Column(Float)

    # Debt specific
    avg_maturity       = Column(Float)
    modified_duration  = Column(Float)
    ytm                = Column(Float)
    avg_credit_quality = Column(String(10))
    credit_aaa         = Column(Float)
    credit_aa          = Column(Float)
    credit_a           = Column(Float)
    credit_bbb         = Column(Float)
    credit_bb          = Column(Float)
    credit_b           = Column(Float)
    credit_below_b     = Column(Float)
    credit_nr          = Column(Float)

    # Benchmark identifier fields
    is_benchmark    = Column(Integer, default=0)  # 1 if this row is a benchmark
    benchmark_label = Column(String(20))           # e.g. "Benchmark 1"

    created_at = Column(DateTime, server_default=func.now())


class BenchmarkData(Base):
    __tablename__ = "benchmark_data"

    id              = Column(Integer, primary_key=True)
    data_date       = Column(Date, nullable=False, index=True)
    email_date      = Column(Date)
    category        = Column(String(200), index=True)
    raw_category    = Column(String(200))
    asset_class     = Column(String(100))
    sheet_name      = Column(String(100))
    benchmark_label = Column(String(20))
    benchmark_name  = Column(String(255))

    return_1d     = Column(Float)
    return_1w     = Column(Float)
    return_1m     = Column(Float)
    return_3m     = Column(Float)
    return_6m     = Column(Float)
    return_1y     = Column(Float)
    return_2y     = Column(Float)
    return_3y     = Column(Float)
    return_5y     = Column(Float)
    return_7y     = Column(Float)
    return_10y    = Column(Float)
    return_ytd    = Column(Float)
    return_cy2025 = Column(Float)
    return_cy2024 = Column(Float)
    return_cy2023 = Column(Float)
    return_cy2022 = Column(Float)
    return_cy2021 = Column(Float)

    std_dev_1y       = Column(Float)
    sharpe_ratio_1y  = Column(Float)
    sortino_ratio_1y = Column(Float)
    std_dev_3y       = Column(Float)
    sharpe_ratio_3y  = Column(Float)
    sortino_ratio_3y = Column(Float)
    std_dev_5y       = Column(Float)
    sharpe_ratio_5y  = Column(Float)
    sortino_ratio_5y = Column(Float)


class EmailFetchLog(Base):
    __tablename__ = "email_fetch_log"

    id         = Column(Integer, primary_key=True)
    email_date = Column(Date)
    data_date  = Column(Date)
    file_name  = Column(String(255))
    status     = Column(String(20))
    message    = Column(Text)
    fetched_at = Column(DateTime, server_default=func.now())


class AppSettings(Base):
    __tablename__ = "app_settings"

    key   = Column(String(100), primary_key=True)
    value = Column(Text)

class NavHistory(Base):
    __tablename__ = "nav_history"

    id           = Column(Integer, primary_key=True)
    isin         = Column(String(20), nullable=False, index=True)
    date         = Column(Date, nullable=False, index=True)
    nav          = Column(Float)
    total_return = Column(Float)
    created_at   = Column(DateTime, server_default=func.now())

    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint('isin', 'date', name='uq_nav_history_isin_date'),
    )


class NavFetchLog(Base):
    __tablename__ = "nav_fetch_log"

    id         = Column(Integer, primary_key=True)
    isin       = Column(String(20), nullable=False, index=True)
    status     = Column(String(20))
    rows_added = Column(Integer, default=0)
    message    = Column(Text)
    fetched_at = Column(DateTime, server_default=func.now())