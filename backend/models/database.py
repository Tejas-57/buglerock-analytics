from sqlalchemy import create_engine, Column, String, Float, Date, DateTime, Text, Integer, Boolean
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
    branding_name        = Column(String(200))   # "Branding Name" column from Morningstar daily Excel
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

    # Tracking error — present for ETF and Index funds only
    tracking_error_1y = Column(Float)
    tracking_error_3y = Column(Float)
    tracking_error_5y = Column(Float)

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

    # Fixed-Income super sector breakdown (new — from Debt/Debt ETF/Hybrid sheets)
    fi_sector_government  = Column(Float)
    fi_sector_corporate    = Column(Float)
    fi_sector_cash_equiv   = Column(Float)
    fi_sector_municipal    = Column(Float)
    fi_sector_securitized  = Column(Float)
    fi_sector_derivative   = Column(Float)

    # Structural flag: does this fund's source sheet have debt-parameter
    # columns at all (regardless of whether this particular row has values)
    has_debt_columns = Column(Boolean, default=False)
    # Structural flag: does this fund's source sheet have equity risk-analytics
    # columns at all (Up/Down Capture, Alpha, Beta, Sharpe, Sortino)
    has_equity_columns = Column(Boolean, default=False)

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


class PeriodDates(Base):
    """
    Stores the exact start/end dates Morningstar uses for each return period,
    extracted from the daily Excel file header rows.
    Used by the NAV chart to query nav_history on the exact same date range.
    """
    __tablename__ = "period_dates"

    id         = Column(Integer, primary_key=True)
    data_date  = Column(Date, nullable=False, index=True)
    db_field   = Column(String(30), nullable=False)   # e.g. "return_1m", "return_3y"
    start_date = Column(Date, nullable=False)
    end_date   = Column(Date, nullable=False)

    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint(
            'data_date', 'db_field', name='uq_period_dates_date_field'
        ),
    )

# ── Morningstar Holdings Integration ─────────────────────────────────────────

class FundHolding(Base):
    """
    Individual holding (stock/bond/cash/derivative) within a fund's portfolio,
    sourced from Morningstar's NewPortfolioApi (Full Holdings V2 / Top 25 Holdings).
    One row per holding per fund per portfolio_date.
    """
    __tablename__ = "fund_holdings"

    id            = Column(Integer, primary_key=True)
    isin          = Column(String(20), nullable=False, index=True)   # parent fund ISIN
    mstar_id      = Column(String(20), index=True)                    # parent fund MstarID
    portfolio_date = Column(Date, nullable=False, index=True)         # as-of date of this portfolio snapshot

    # Holding identity
    morningstar_id  = Column(String(20))     # holding's own Morningstar ID (may be null)
    holding_type    = Column(String(5))      # E, BT, CP, CD, CR, CQ, CA, FE, DD, DM etc.
    name            = Column(String(255))
    holding_isin    = Column(String(20))
    ticker          = Column(String(30))

    # Geography / currency
    country_id   = Column(String(10))
    country      = Column(String(100))
    currency_id  = Column(String(15))
    currency     = Column(String(50))

    # Position
    weighting        = Column(Float)   # % of portfolio
    number_of_shares = Column(Float)
    market_value     = Column(Float)
    share_change     = Column(Float)
    cost_basis       = Column(Float)

    # Classification (equity holdings)
    sector_id          = Column(String(10))
    sector              = Column(String(100))
    global_sector_id    = Column(String(10))
    global_sector       = Column(String(100))
    global_industry_id  = Column(String(15))
    global_industry     = Column(String(150))
    stylebox            = Column(String(5))

    # Performance / lifecycle
    holding_ytd_return = Column(Float)
    first_bought_date  = Column(Date)
    performance_id     = Column(String(20))

    # Bond-specific
    maturity_date = Column(Date)
    coupon        = Column(Float)
    indian_credit_quality = Column(String(100))

    # Exchange
    exchange_id    = Column(String(20))
    exchange_name  = Column(String(150))
    region_id      = Column(String(10))

    created_at = Column(DateTime, server_default=func.now())

    # No unique constraint here — save_fund_holdings() deletes all existing
    # rows for (isin, portfolio_date) before inserting fresh ones, so true
    # duplicates can't accumulate. A constraint on (name, holding_type) was
    # tried but real data breaks it: a fund can hold multiple T-bills/bonds
    # all named identically (e.g. "India (Republic of)", type GS) that are
    # only distinguished by holding_isin or morningstar_id.


class FundPortfolioStats(Base):
    """
    Fund-level portfolio statistics from Morningstar NewPortfolioApi —
    one row per fund per portfolio_date. Separate from FundHolding (which is
    per individual holding) since this is aggregate/summary data.
    """
    __tablename__ = "fund_portfolio_stats"

    id             = Column(Integer, primary_key=True)
    isin           = Column(String(20), nullable=False, index=True)
    mstar_id       = Column(String(20), index=True)
    portfolio_date = Column(Date, nullable=False, index=True)

    # Portfolio Statistics (Most Recent Port)
    number_of_holdings        = Column(Integer)
    number_of_bond_holdings   = Column(Integer)
    number_of_stock_holdings  = Column(Integer)
    equity_stylebox_name      = Column(String(50))
    fixed_inc_stylebox_name   = Column(String(50))
    roa_ttm                   = Column(Float)
    roe_ttm                   = Column(Float)
    net_margin_trailing       = Column(Float)
    prospective_dividend_yield = Column(Float)
    pb_ratio_ttm              = Column(Float)
    pc_ratio_ttm              = Column(Float)
    pe_ratio_ttm              = Column(Float)
    ps_ratio_ttm              = Column(Float)
    modified_duration         = Column(Float)
    average_credit_quality    = Column(String(20))
    yield_to_maturity         = Column(Float)
    average_eff_maturity      = Column(Float)

    # Asset Allocation (net %)
    asset_alloc_equity_net = Column(Float)
    asset_alloc_bond_net   = Column(Float)
    asset_alloc_cash_net   = Column(Float)
    convertible_net        = Column(Float)
    preferred_stock_net    = Column(Float)

    # Indian Asset Allocation
    stock_long                    = Column(Float)
    bond_and_debentures_long      = Column(Float)
    cash_and_net_current_assets_long = Column(Float)
    government_securities_long    = Column(Float)
    money_market_instruments_long = Column(Float)
    banks_or_fi_including_nbfc_long = Column(Float)
    cblos_or_repo_long             = Column(Float)
    private_corporate_bodies_long  = Column(Float)
    public_sector_units_long       = Column(Float)
    central_govt_securities_long   = Column(Float)
    state_govs_securities_long     = Column(Float)

    # Market Cap Breakdown (rescaled %)
    market_cap_giant = Column(Float)
    market_cap_large = Column(Float)
    market_cap_mid   = Column(Float)
    market_cap_small = Column(Float)
    market_cap_micro = Column(Float)

    # Global Stock Sector Breakdown (rescaled %)
    sector_basic_materials       = Column(Float)
    sector_communication_services = Column(Float)
    sector_consumer_cyclical     = Column(Float)
    sector_consumer_defensive    = Column(Float)
    sector_energy                = Column(Float)
    sector_financial_services    = Column(Float)
    sector_healthcare            = Column(Float)
    sector_industrials           = Column(Float)
    sector_real_estate           = Column(Float)
    sector_technology            = Column(Float)
    sector_utilities             = Column(Float)

    # Fund Net Assets
    fund_net_assets      = Column(Float)
    fund_net_assets_date = Column(Date)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint(
            'isin', 'portfolio_date', name='uq_fund_portfolio_stats_isin_date'
        ),
    )


class HoldingsFetchLog(Base):
    """Tracks each Morningstar holdings fetch run — for monitoring and debugging."""
    __tablename__ = "holdings_fetch_log"

    id         = Column(Integer, primary_key=True)
    isin       = Column(String(20), nullable=False, index=True)
    status     = Column(String(20))     # success | failed | no_data
    message    = Column(Text)
    fetched_at = Column(DateTime, server_default=func.now())


class MorningstarAccessCode(Base):
    """
    Stores the current Morningstar accesscode and its expiry,
    so the fetcher can self-check and rotate before it expires.
    """
    __tablename__ = "morningstar_accesscode"

    id           = Column(Integer, primary_key=True)
    accesscode   = Column(String(64), nullable=False)
    created_at   = Column(DateTime, server_default=func.now())
    expires_at   = Column(Date, nullable=False)
    is_active    = Column(Integer, default=1)  # 1 = active, 0 = superseded/deleted