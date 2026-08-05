# backend/services/morningstar_service.py
"""
Morningstar API Center integration.

Two responsibilities:
  1. Accesscode lifecycle — verify, create, rotate (90-day expiry, self-healing)
  2. Holdings fetcher — pulls Full Holdings + Portfolio Statistics for funds
     via NewPortfolioApi, parses into FundHolding / FundPortfolioStats rows.

Rate limiting: Morningstar allows 10,000 calls/hour per account.
This service throttles to ~2 calls/second (well under the limit) and
processes in a single sequential loop — for 1,800 funds at 1 call each
(holdings endpoint returns everything in one call per fund), a full
universe refresh takes roughly 15 minutes.

Auth note: data-retrieval endpoints (holdings, NAV, performance) only need
the `accesscode` query param. Only the account-management endpoints
(CreateAccesscode / AccesscodeBasicInfo / DeleteAccesscode) require
account_code + account_password.
"""

import logging
import os
import time
from datetime import date, timedelta, datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.morningstar.com/v2/service"
ACCOUNT_BASE = f"{BASE_URL}/account"
MF_BASE = f"{BASE_URL}/mf"

HOLDINGS_API_CODE = "v4glpjr2u59vnr12"  # NewPortfolioApi — confirmed working

ACCOUNT_CODE = os.getenv("MSTAR_ACCOUNT_CODE", "")
ACCOUNT_PASSWORD = os.getenv("MSTAR_ACCOUNT_PASSWORD", "")

RATE_LIMIT_PER_SEC = 2          # stay well under 10K/hour (~2.7/sec ceiling)
REQUEST_TIMEOUT = 20
ACCESSCODE_RENEWAL_BUFFER_DAYS = 7   # rotate if expiring within this window


# ── Accesscode lifecycle ─────────────────────────────────────────────────────

def _get_session():
    from models.database import SessionLocal
    return SessionLocal()


def get_stored_accesscode() -> Optional[dict]:
    """Return the currently active accesscode + expiry from DB, or None."""
    from models.database import MorningstarAccessCode
    db = _get_session()
    try:
        row = (
            db.query(MorningstarAccessCode)
            .filter(MorningstarAccessCode.is_active == 1)
            .order_by(MorningstarAccessCode.created_at.desc())
            .first()
        )
        if not row:
            return None
        return {"accesscode": row.accesscode, "expires_at": row.expires_at, "id": row.id}
    finally:
        db.close()


def verify_accesscode(accesscode: str) -> bool:
    """
    POST AccesscodeBasicInfo — confirms the accesscode is valid.
    Requires account_code + account_password (account-management endpoint).
    """
    if not ACCOUNT_CODE or not ACCOUNT_PASSWORD:
        logger.warning("MSTAR_ACCOUNT_CODE/PASSWORD not set — cannot verify accesscode")
        return False

    url = f"{ACCOUNT_BASE}/AccesscodeBasicInfo/{accesscode}"
    try:
        resp = requests.post(
            url,
            data={"account_code": ACCOUNT_CODE, "account_password": ACCOUNT_PASSWORD},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return False
        # Morningstar returns XML by default; treat any "code>0<" as failure
        return "<code>0</code>" in resp.text or '"code": 0' in resp.text
    except requests.RequestException as e:
        logger.error(f"Accesscode verification failed: {e}")
        return False


def create_accesscode(days: int = 90, comment: str = "BugleRock Analytics") -> Optional[str]:
    """
    POST CreateAccesscode/{days}d — generates a new accesscode.
    Credentials go as query params (confirmed working format from O3SEC account).
    Stores result in DB, marking any previous one inactive.
    """
    if not ACCOUNT_CODE or not ACCOUNT_PASSWORD:
        logger.error("MSTAR_ACCOUNT_CODE/PASSWORD not set — cannot create accesscode")
        return None

    url = f"{ACCOUNT_BASE}/CreateAccesscode/{days}d"
    try:
        resp = requests.post(
            url,
            params={
                "format": "json",
                "account_code": ACCOUNT_CODE,
                "account_password": ACCOUNT_PASSWORD,
            },
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            logger.error(f"CreateAccesscode failed: {resp.status_code} {resp.text}")
            return None

        # Response format varies (XML/JSON) — extract the accesscode token.
        # Adjust this parsing once we see a real CreateAccesscode response sample.
        new_code = _extract_accesscode_from_response(resp.text)
        if not new_code:
            logger.error(f"Could not parse accesscode from response: {resp.text}")
            return None

        # Parse actual expiry from Morningstar response (more accurate than days calc)
        import json as _json
        try:
            body = _json.loads(resp.text)
            expire_str = body.get("data", {}).get("api", {}).get("ExpireTime", "")
            if expire_str:
                expires_at = datetime.strptime(expire_str[:10], "%Y-%m-%d").date()
            else:
                expires_at = date.today() + timedelta(days=days)
        except Exception:
            expires_at = date.today() + timedelta(days=days)

        _store_accesscode(new_code, expires_at)
        logger.info(f"New Morningstar accesscode created, expires {expires_at}")
        return new_code

    except requests.RequestException as e:
        logger.error(f"CreateAccesscode request failed: {e}")
        return None


def _extract_accesscode_from_response(text: str) -> Optional[str]:
    """
    Parse accesscode out of response body.
    Confirmed response shape from O3SEC account:
    {"status": {...}, "data": {"api": {"AccessCode": "xxx..."}}}
    """
    import re
    import json

    try:
        body = json.loads(text)
        # Confirmed shape: data.api.AccessCode
        api = body.get("data", {}).get("api", {})
        if api.get("AccessCode"):
            return api["AccessCode"]
        # Fallback shapes
        if body.get("data", {}).get("AccessCode"):
            return body["data"]["AccessCode"]
        if body.get("AccessCode"):
            return body["AccessCode"]
    except (json.JSONDecodeError, TypeError):
        pass

    # XML fallback
    match = re.search(r"<AccessCode>([a-zA-Z0-9]+)</AccessCode>", text, re.IGNORECASE)
    if match:
        return match.group(1)
    # Last resort — 32-char lowercase hex token
    match = re.search(r"\b([a-z0-9]{32})\b", text)
    if match:
        return match.group(1)
    return None


def _store_accesscode(accesscode: str, expires_at: date):
    """Store a new accesscode in DB, marking all previous ones inactive."""
    from models.database import MorningstarAccessCode
    db = _get_session()
    try:
        db.query(MorningstarAccessCode).update({"is_active": 0})
        row = MorningstarAccessCode(
            accesscode=accesscode,
            expires_at=expires_at,
            is_active=1,
        )
        db.add(row)
        db.commit()
        logger.info(f"Accesscode stored in DB, expires {expires_at}")
    finally:
        db.close()


def seed_accesscode_from_env():
    """
    One-time seeding: if DB has no active accesscode but .env has one,
    seed the DB with it using the expiry from MSTAR_ACCESSCODE_EXPIRY.
    Call this on app startup.
    """
    stored = get_stored_accesscode()
    if stored:
        return  # already DB-managed, nothing to do

    env_code = os.getenv("MSTAR_ACCESSCODE", "")
    env_expiry = os.getenv("MSTAR_ACCESSCODE_EXPIRY", "")

    if not env_code:
        logger.warning("MSTAR_ACCESSCODE not set in .env — Morningstar integration disabled")
        return

    if env_expiry:
        try:
            expiry = datetime.strptime(env_expiry, "%Y-%m-%d").date()
        except ValueError:
            expiry = date.today() + timedelta(days=90)
    else:
        expiry = date.today() + timedelta(days=90)

    _store_accesscode(env_code, expiry)
    logger.info(f"Seeded accesscode from .env into DB (expires {expiry})")


def get_valid_accesscode(auto_rotate: bool = True) -> Optional[str]:
    """
    Main entry point — returns a valid accesscode, auto-rotating if needed.

    Flow:
      1. Seed DB from .env if not yet DB-managed (first run)
      2. Check DB expiry
      3. If expiry > 7 days away → use current code
      4. If expiry <= 7 days away → call CreateAccesscode → store new code → use it
      5. If rotation fails → use expiring code rather than returning nothing
    """
    # Step 1 — seed DB from .env on first run
    seed_accesscode_from_env()

    # Step 2 — get from DB
    stored = get_stored_accesscode()
    if not stored:
        logger.error("No Morningstar accesscode available — set MSTAR_ACCESSCODE in .env")
        return None

    days_left = (stored["expires_at"] - date.today()).days
    logger.debug(f"Accesscode expires {stored['expires_at']} ({days_left} days left)")

    # Step 3 — still valid, use it
    if days_left > ACCESSCODE_RENEWAL_BUFFER_DAYS:
        return stored["accesscode"]

    # Step 4 — expiring soon, auto-rotate
    if auto_rotate and ACCOUNT_CODE and ACCOUNT_PASSWORD:
        logger.info(f"Accesscode expiring in {days_left} days — auto-rotating")
        new_code = create_accesscode(90)
        if new_code:
            return new_code
        logger.warning("Auto-rotation failed — using expiring code as fallback")
    elif days_left <= 0:
        logger.error("Accesscode has expired and auto-rotation is not configured")

    # Step 5 — fallback: use whatever we have
    return stored["accesscode"]


# ── Holdings fetcher ──────────────────────────────────────────────────────────

# Holding types that carry equity-style classification fields
EQUITY_LIKE_TYPES = {"E"}
BOND_LIKE_TYPES = {"BT", "CP", "CD"}
CASH_LIKE_TYPES = {"CR", "CQ", "CA"}


def _safe_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _safe_int(v) -> Optional[int]:
    f = _safe_float(v)
    return int(f) if f is not None else None


def _safe_date(v) -> Optional[date]:
    if not v:
        return None
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def fetch_fund_portfolio(isin: str, accesscode: str) -> Optional[dict]:
    """
    Single API call to NewPortfolioApi for one fund by ISIN.
    Returns the parsed 'api' dict from the response, or None on failure.
    """
    url = f"{MF_BASE}/{HOLDINGS_API_CODE}/ISIN/{isin}"
    params = {"accesscode": accesscode, "format": "json"}

    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            logger.warning(f"{isin}: HTTP {resp.status_code}")
            return None

        body = resp.json()
        status = body.get("status", {})
        if status.get("code") != 0:
            logger.warning(f"{isin}: API error — {status.get('message')}")
            return None

        data_list = body.get("data", [])
        if not data_list:
            logger.warning(f"{isin}: no data returned")
            return None

        return data_list[0].get("api", {})

    except requests.RequestException as e:
        logger.error(f"{isin}: request failed — {e}")
        return None
    except (ValueError, KeyError) as e:
        logger.error(f"{isin}: response parsing failed — {e}")
        return None


def parse_holdings(isin: str, mstar_id: str, portfolio_date: date, api_data: dict) -> list:
    """
    Parses the T25H-HoldingDetail array into FundHolding-ready dicts.
    Handles the varying field sets across holding types (E, BT, CP, CD, CR, CQ, CA, FE, DD, DM).
    """
    # Prefer Full Holdings V2 (all holdings) over Top 25 if available
    holdings_raw = api_data.get("FHV2-HoldingDetail") or api_data.get("T25H-HoldingDetail", [])
    rows = []

    for h in holdings_raw:
        rows.append({
            "isin": isin,
            "mstar_id": mstar_id,
            "portfolio_date": portfolio_date,
            "morningstar_id": h.get("MorningstarID"),
            "holding_type": h.get("HoldingType"),
            "name": h.get("Name"),
            "holding_isin": h.get("ISIN"),
            "ticker": h.get("Ticker"),
            "country_id": h.get("CountryId"),
            "country": h.get("Country"),
            "currency_id": h.get("CurrencyId"),
            "currency": h.get("Currency"),
            "weighting": _safe_float(h.get("Weighting")),
            "number_of_shares": _safe_float(h.get("NumberOfShare")),
            "market_value": _safe_float(h.get("MarketValue")),
            "share_change": _safe_float(h.get("ShareChange")),
            "cost_basis": _safe_float(h.get("CostBasis")),
            "sector_id": h.get("SectorId"),
            "sector": h.get("Sector"),
            "global_sector_id": h.get("GlobalSectorId"),
            "global_sector": h.get("GlobalSector"),
            "global_industry_id": h.get("GlobalIndustryId"),
            "global_industry": h.get("GlobalIndustry"),
            "stylebox": h.get("Stylebox"),
            "holding_ytd_return": _safe_float(h.get("HoldingYTDReturn")),
            "first_bought_date": _safe_date(h.get("FirstBoughtDate")),
            "performance_id": h.get("PerformanceId"),
            "maturity_date": _safe_date(h.get("MaturityDate")),
            "coupon": _safe_float(h.get("Coupon")),
            "indian_credit_quality": h.get("IndianCreditQualityClassification"),
            "exchange_id": h.get("ExchangeId"),
            "exchange_name": h.get("ExchangeName"),
            "region_id": h.get("RegionId"),
        })

    return rows


def parse_portfolio_stats(isin: str, mstar_id: str, portfolio_date: date, api_data: dict) -> dict:
    """Parses fund-level portfolio statistics into a FundPortfolioStats-ready dict."""
    g = api_data.get  # shorthand

    return {
        "isin": isin,
        "mstar_id": mstar_id,
        "portfolio_date": portfolio_date,
        "number_of_holdings": _safe_int(g("PSRP-NumberofHolding")),
        "number_of_bond_holdings": _safe_int(g("PSRP-NumberOfBondHoldings")),
        "number_of_stock_holdings": _safe_int(g("PSRP-NumberOfStockHoldings")),
        "equity_stylebox_name": g("PSRP-EquityStyleBoxLongName"),
        "fixed_inc_stylebox_name": g("PSRP-FixedIncStyleBoxLongName"),
        "roa_ttm": _safe_float(g("PSRP-ROATTMLong")),
        "roe_ttm": _safe_float(g("PSRP-ROETTMLong")),
        "net_margin_trailing": _safe_float(g("PSRP-NetMarginTrailingLong")),
        "prospective_dividend_yield": _safe_float(g("PSRP-ProspectiveDividendYield")),
        "pb_ratio_ttm": _safe_float(g("PSRP-PBRatioTTMLong")),
        "pc_ratio_ttm": _safe_float(g("PSRP-PCRatioTTMLong")),
        "pe_ratio_ttm": _safe_float(g("PSRP-PERatioTTMLong")),
        "ps_ratio_ttm": _safe_float(g("PSRP-PSRatioTTMLong")),
        "modified_duration": _safe_float(g("PSRP-ModifiedDurationLong")),
        "average_credit_quality": g("PSRP-AverageCreditQualityName"),
        "yield_to_maturity": _safe_float(g("PSRP-YieldtoMaturityLong")),
        "average_eff_maturity": _safe_float(g("PSRP-AverageEffMaturity")),

        "asset_alloc_equity_net": _safe_float(g("AABRP-AssetAllocEquityNet")),
        "asset_alloc_bond_net": _safe_float(g("AABRP-AssetAllocBondNet")),
        "asset_alloc_cash_net": _safe_float(g("AABRP-AssetAllocCashNet")),
        "convertible_net": _safe_float(g("AABRP-ConvertibleNet")),
        "preferred_stock_net": _safe_float(g("AABRP-PreferredStockNet")),

        "stock_long": _safe_float(g("IAAPL-StockLong")),
        "bond_and_debentures_long": _safe_float(g("IAASL-BondAndDebenturesLong")),
        "cash_and_net_current_assets_long": _safe_float(g("IAASL-CashAndNetCurrentAssetsLong")),
        "government_securities_long": _safe_float(g("IAASL-GovernmentSecuritiesLong")),
        "money_market_instruments_long": _safe_float(g("IAASL-MoneyMarketInstrumentsLong")),
        "banks_or_fi_including_nbfc_long": _safe_float(g("IAAPL-BanksOrFIIncludingNBFCLong")),
        "cblos_or_repo_long": _safe_float(g("IAAPL-CBLOsOrRepoLong")),
        "private_corporate_bodies_long": _safe_float(g("IAAPL-PrivateCorporateBodiesLong")),
        "public_sector_units_long": _safe_float(g("IAAPL-PublicSectorUnitsLong")),
        "central_govt_securities_long": _safe_float(g("IAAPL-CentralGovtSecuritiesLong")),
        "state_govs_securities_long": _safe_float(g("IAAPL-StateGovsSecuritiesLong")),

        "market_cap_giant": _safe_float(g("MCBRP-MarketCapGiantLongRescaled")),
        "market_cap_large": _safe_float(g("MCBRP-MarketCapLargeLongRescaled")),
        "market_cap_mid": _safe_float(g("MCBRP-MarketCapMidLongRescaled")),
        "market_cap_small": _safe_float(g("MCBRP-MarketCapSmallLongRescaled")),
        "market_cap_micro": _safe_float(g("MCBRP-MarketCapMicroLongRescaled")),

        "sector_basic_materials": _safe_float(g("GSSBRP-EquitySectorBasicMaterialsLongRescaled")),
        "sector_communication_services": _safe_float(g("GSSBRP-EquitySectorCommunicationServicesLongRescaled")),
        "sector_consumer_cyclical": _safe_float(g("GSSBRP-EquitySectorConsumerCyclicalLongRescaled")),
        "sector_consumer_defensive": _safe_float(g("GSSBRP-EquitySectorConsumerDefensiveLongRescaled")),
        "sector_energy": _safe_float(g("GSSBRP-EquitySectorEnergyLongRescaled")),
        "sector_financial_services": _safe_float(g("GSSBRP-EquitySectorFinancialServicesLongRescaled")),
        "sector_healthcare": _safe_float(g("GSSBRP-EquitySectorHealthcareLongRescaled")),
        "sector_industrials": _safe_float(g("GSSBRP-EquitySectorIndustrialsLongRescaled")),
        "sector_real_estate": _safe_float(g("GSSBRP-EquitySectorRealEstateLongRescaled")),
        "sector_technology": _safe_float(g("GSSBRP-EquitySectorTechnologyLongRescaled")),
        "sector_utilities": _safe_float(g("GSSBRP-EquitySectorUtilitiesLongRescaled")),

        "fund_net_assets": _safe_float(g("FNA-AsOfOriginalReported")),
        "fund_net_assets_date": _safe_date(g("FNA-AsOfOriginalReportedDate")),
    }


def save_fund_holdings(isin: str, holdings_rows: list, stats_row: dict):
    """Upserts holdings + portfolio stats for one fund into the DB."""
    from models.database import FundHolding, FundPortfolioStats
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import inspect

    db = _get_session()
    try:
        is_postgres = "postgresql" in str(db.bind.url)

        # Delete ALL existing holdings for this ISIN (not just same portfolio_date)
        # so we never accumulate month-on-month history — DB always holds exactly
        # one month's disclosure per fund, the latest one Morningstar has published.
        # If the fetch fails after this delete, the old data is gone — but the
        # caller's try/except ensures the log still shows "failed", and the
        # display layer always falls back to whatever is currently in the DB
        # (which remains intact if the delete+insert happens atomically in one
        # transaction — either both commit or both roll back).
        if holdings_rows:
            db.query(FundHolding).filter(FundHolding.isin == isin).delete()
            db.bulk_insert_mappings(FundHolding, holdings_rows)

        if stats_row:
            # Delete all existing stats for this ISIN before re-inserting
            db.query(FundPortfolioStats).filter(
                FundPortfolioStats.isin == isin,
            ).delete()
            db.add(FundPortfolioStats(**stats_row))

        db.commit()

    except Exception as e:
        db.rollback()
        logger.error(f"{isin}: failed to save holdings — {e}")
        raise
    finally:
        db.close()


def log_fetch_result(isin: str, status: str, message: str = ""):
    from models.database import HoldingsFetchLog
    db = _get_session()
    try:
        db.add(HoldingsFetchLog(isin=isin, status=status, message=message))
        db.commit()
    finally:
        db.close()


def fetch_and_store_holdings(isin: str, accesscode: str) -> bool:
    """
    Full pipeline for one fund: fetch → parse → save.
    Returns True on success, False otherwise. Always logs the result.
    """
    api_data = fetch_fund_portfolio(isin, accesscode)
    if not api_data:
        log_fetch_result(isin, "failed", "No data returned from API")
        return False

    mstar_id = api_data.get("FSCBI-MStarID") or api_data.get("DP-MStarID")
    portfolio_date = _safe_date(api_data.get("FHV2-PortfolioDate")) or date.today()

    holdings_rows = parse_holdings(isin, mstar_id, portfolio_date, api_data)
    stats_row = parse_portfolio_stats(isin, mstar_id, portfolio_date, api_data)

    if not holdings_rows:
        log_fetch_result(isin, "no_data", "No holdings in response")
        return False

    try:
        save_fund_holdings(isin, holdings_rows, stats_row)
        log_fetch_result(isin, "success", f"{len(holdings_rows)} holdings saved")
        return True
    except Exception as e:
        log_fetch_result(isin, "failed", str(e))
        return False


def fetch_universe_holdings(isins: list, accesscode: Optional[str] = None) -> dict:
    """
    Batch fetch holdings for a list of ISINs, rate-limited to RATE_LIMIT_PER_SEC.
    Designed to be run as a scheduled job (e.g. monthly, since holdings update
    monthly for most funds).

    Returns a summary dict: {"total": N, "success": N, "failed": N, "no_data": N}
    """
    accesscode = accesscode or get_valid_accesscode()
    if not accesscode:
        logger.error("Cannot fetch holdings — no valid accesscode available")
        return {"total": len(isins), "success": 0, "failed": len(isins), "no_data": 0}

    summary = {"total": len(isins), "success": 0, "failed": 0, "no_data": 0}
    delay = 1.0 / RATE_LIMIT_PER_SEC

    for i, isin in enumerate(isins):
        if not isin:
            logger.warning(f"Skipping empty/null ISIN at index {i}")
            summary["failed"] += 1
            continue
        try:
            ok = fetch_and_store_holdings(isin, accesscode)
            if ok:
                summary["success"] += 1
            else:
                summary["failed"] += 1
        except Exception as e:
            # A single bad ISIN (or transient DB/API error) must never kill
            # the rest of the batch — log and move on to the next fund.
            logger.error(f"Unexpected error fetching holdings for {isin}: {e}", exc_info=True)
            summary["failed"] += 1
            try:
                log_fetch_result(isin, "failed", f"Unexpected error: {e}")
            except Exception:
                pass  # even the error-logging must not be allowed to crash the loop

        if (i + 1) % 100 == 0:
            logger.info(f"Holdings fetch progress: {i+1}/{len(isins)}")

        time.sleep(delay)  # throttle

    logger.info(f"Holdings fetch complete: {summary}")
    return summary


def fetch_holdings_for_new_isins(candidate_isins: list) -> dict:
    """
    Given a list of ISINs (typically "every fund in today's just-parsed daily
    Excel"), fetch holdings only for the ones that have NEVER been attempted
    before (no row at all in holdings_fetch_log). This is what lets brand-new
    funds that appear in a future daily email automatically get their
    holdings fetched, without needing someone to manually re-run the full
    universe fetch.

    Cheap by design: on a normal day this is 0-a few funds, since most days
    introduce no new funds. Capped at MAX_NEW_PER_RUN as a safety valve in
    case an unusually large batch of new funds appears at once (falls back
    to leaving the rest for the next scheduled/manual universe fetch).
    """
    from models.database import SessionLocal, HoldingsFetchLog

    MAX_NEW_PER_RUN = 50

    db = SessionLocal()
    try:
        candidates = {i for i in candidate_isins if i}
        if not candidates:
            return {"new_found": 0, "fetched": 0}

        ever_attempted = {
            row[0] for row in db.query(HoldingsFetchLog.isin)
            .filter(HoldingsFetchLog.isin.in_(candidates))
            .distinct()
            .all()
        }
        new_isins = list(candidates - ever_attempted)
    finally:
        db.close()

    if not new_isins:
        return {"new_found": 0, "fetched": 0}

    if len(new_isins) > MAX_NEW_PER_RUN:
        logger.warning(
            f"{len(new_isins)} new funds found — fetching first {MAX_NEW_PER_RUN} now, "
            f"the rest will be picked up by the next universe fetch."
        )
    to_fetch = new_isins[:MAX_NEW_PER_RUN]

    logger.info(f"Fetching holdings for {len(to_fetch)} newly-seen fund(s): {to_fetch}")
    summary = fetch_universe_holdings(to_fetch)
    return {"new_found": len(new_isins), "fetched": len(to_fetch), **summary}


def _expected_latest_month_end(today) -> "date":
    """Last calendar day of the previous month, relative to `today`."""
    from datetime import date as date_cls
    first_of_this_month = today.replace(day=1)
    return first_of_this_month - timedelta(days=1)


def refresh_stale_holdings(max_per_run: int = 2000) -> dict:
    """
    Daily holdings freshness check — runs every day after the daily parse.

    Design principles:
    - No fixed day-of-month window. Checks every day, catches each fund the
      exact day Morningstar publishes its updated disclosure (varies per fund,
      typically 10th-25th of the month — no single fixed date).
    - Identifies the latest portfolio_date from the data already in DB
      (across all funds), uses that as the "expected" latest date. Any fund
      still behind that date is stale and gets re-fetched.
    - Per-fund error isolation: a failure on one fund is logged but never
      blocks other funds, and never corrupts the existing display data for
      that fund (the delete+insert is atomic per fund in a single transaction
      — if it fails, the old data stays intact and the fund keeps showing its
      last known holdings).
    - No history accumulation: each successful fetch replaces all previous
      holdings rows for that ISIN with the new ones.
    """
    from datetime import date as date_cls
    from models.database import SessionLocal, FundHolding, DailyFundData
    from sqlalchemy import func as sqlfunc

    today = date_cls.today()

    db = SessionLocal()
    try:
        # Get the universe of real fund ISINs from the latest data_date
        latest_data_date = db.query(DailyFundData.data_date).order_by(DailyFundData.data_date.desc()).first()
        if not latest_data_date:
            return {"skipped": True, "reason": "no fund universe available"}

        all_isins = {
            row[0] for row in db.query(DailyFundData.isin)
            .filter(
                DailyFundData.data_date == latest_data_date[0],
                DailyFundData.isin != None,
                DailyFundData.isin != "",
                DailyFundData.is_benchmark != 1,
            )
            .distinct()
            .all()
        }

        # Find the most recent portfolio_date across ALL funds in the DB —
        # this is the "gold standard" latest date that every fund should ideally
        # be at. Any fund behind this date is stale.
        latest_known_portfolio_date = db.query(sqlfunc.max(FundHolding.portfolio_date)).scalar()
        if not latest_known_portfolio_date:
            return {"skipped": True, "reason": "no holdings data in DB yet — run universe fetch first"}

        # Latest portfolio_date per ISIN currently in DB
        latest_by_isin = dict(
            db.query(FundHolding.isin, sqlfunc.max(FundHolding.portfolio_date))
            .filter(FundHolding.isin.in_(all_isins))
            .group_by(FundHolding.isin)
            .all()
        )

        # Stale = never fetched, or behind the latest known portfolio_date
        stale = [
            isin for isin in all_isins
            if latest_by_isin.get(isin) is None
            or latest_by_isin[isin] < latest_known_portfolio_date
        ]
    finally:
        db.close()

    if not stale:
        logger.info(
            f"Holdings refresh ({today}): all funds up to date as of {latest_known_portfolio_date}. "
            f"Nothing to re-fetch."
        )
        return {
            "latest_portfolio_date": str(latest_known_portfolio_date),
            "stale_found": 0,
            "fetched": 0,
            "failed": 0,
        }

    to_fetch = stale[:max_per_run]
    logger.info(
        f"Holdings refresh ({today}): {len(stale)} fund(s) behind latest portfolio_date "
        f"{latest_known_portfolio_date}, fetching {len(to_fetch)} now."
    )

    # Fetch per-fund with full error isolation — one failure never blocks others
    accesscode = get_valid_accesscode()
    if not accesscode:
        logger.error("Holdings refresh: no valid Morningstar accesscode available — skipping")
        return {"skipped": True, "reason": "no valid accesscode"}
    summary = {"success": 0, "failed": 0, "no_data": 0}
    for i, isin in enumerate(to_fetch):
        if not isin:
            continue
        try:
            ok = fetch_and_store_holdings(isin, accesscode)
            if ok:
                summary["success"] += 1
            else:
                summary["no_data"] += 1
        except Exception as e:
            logger.error(f"Holdings refresh: failed for {isin} — {e}", exc_info=True)
            summary["failed"] += 1
            try:
                log_fetch_result(isin, "failed", f"refresh error: {e}")
            except Exception:
                pass

        if (i + 1) % 50 == 0:
            logger.info(f"Holdings refresh progress: {i+1}/{len(to_fetch)}")

        time.sleep(1 / RATE_LIMIT_PER_SEC)

    logger.info(f"Holdings refresh complete: {summary}")
    return {
        "latest_portfolio_date": str(latest_known_portfolio_date),
        "stale_found": len(stale),
        "fetched": len(to_fetch),
        **summary,
    }

# ── AMC Name Fetcher (FundShareClassBasicInfo) ──────────────────────────────

FSCBI_API_CODE = "FundShareClassBasicInfo"

def fetch_amc_name(isin: str, accesscode: str) -> dict:
    """
    Fetch BrandingName and ProviderCompanyName for a single ISIN
    from the FundShareClassBasicInfo API.
    Returns dict with branding_name, provider_name or empty dict on failure.
    """
    import xml.etree.ElementTree as ET
    url = f"{BASE_URL}/mf/{FSCBI_API_CODE}/ISIN/{isin}?accesscode={accesscode}"
    try:
        r = requests.get(url, timeout=REQUEST_TIMEOUT)
        if r.status_code != 200:
            return {}
        root = ET.fromstring(r.text)
        api = root.find(".//api")
        if api is None:
            return {}
        branding  = api.findtext("BrandingName")
        provider  = api.findtext("ProviderCompanyName")
        # Use BrandingName if available, else clean ProviderCompanyName
        import re
        def clean(n):
            if not n: return n
            for pat in [r"\s+Investment\s+Managers?\s+Private\s+Limited",
                        r"\s+Asset\s+Management\s+(Company\s+)?(Private\s+)?Limited",
                        r"\s+Mutual\s+Fund", r"\s+AMC\s+Ltd\.?",
                        r"\s+AMC\s+Limited", r"\s+Private\s+Limited",
                        r"\s+Pvt\.?\s+Ltd\.?", r"\s+Ltd\.?$"]:
                n = re.sub(pat, "", n, flags=re.IGNORECASE).strip()
            return n
        display_name = branding or clean(provider)
        return {"branding_name": display_name, "provider_name": provider}
    except Exception as e:
        logger.warning(f"fetch_amc_name({isin}): {e}")
        return {}


def refresh_amc_names(force: bool = False):
    """
    Fetch and store AMC names (BrandingName) for all funds in DailyFundData
    where amc is NULL (or all funds if force=True).

    Uses FundShareClassBasicInfo API. Rate-limited to RATE_LIMIT_PER_SEC.
    Safe to call on startup — exits immediately if all AMC names are populated.
    """
    from models.database import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        # Find ISINs needing AMC names
        if force:
            rows = db.execute(text("""
                SELECT DISTINCT isin FROM daily_fund_data
                WHERE isin IS NOT NULL
            """)).fetchall()
        else:
            rows = db.execute(text("""
                SELECT DISTINCT isin FROM daily_fund_data
                WHERE isin IS NOT NULL AND (amc IS NULL OR amc = '')
            """)).fetchall()

        isins = [r.isin for r in rows]
        if not isins:
            logger.info("refresh_amc_names: all funds already have AMC names, skipping")
            return {"fetched": 0, "updated": 0}

        logger.info(f"refresh_amc_names: fetching AMC names for {len(isins)} ISINs")

        accesscode = get_valid_accesscode()
        if not accesscode:
            logger.error("refresh_amc_names: no valid accesscode")
            return {"error": "no_accesscode"}

        updated = 0
        failed = 0
        for i, isin in enumerate(isins):
            result = fetch_amc_name(isin, accesscode)
            # Prefer BrandingName (short), fall back to ProviderCompanyName
            amc = result.get("branding_name") or result.get("provider_name")
            if amc:
                db.execute(text("""
                    UPDATE daily_fund_data SET amc = :amc
                    WHERE isin = :isin AND (amc IS NULL OR amc = '')
                """), {"amc": amc, "isin": isin})
                db.commit()
                updated += 1
            else:
                failed += 1

            if (i + 1) % 50 == 0:
                logger.info(f"refresh_amc_names progress: {i+1}/{len(isins)} — updated={updated} failed={failed}")

            time.sleep(1 / RATE_LIMIT_PER_SEC)

        logger.info(f"refresh_amc_names complete: updated={updated} failed={failed}")
        return {"fetched": len(isins), "updated": updated, "failed": failed}
    finally:
        db.close()