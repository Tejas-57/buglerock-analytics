from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import asyncio
import logging
from datetime import date

load_dotenv()

from routers import home, performance, peer, simulator, rolling, chat, status, funds, gmail, nav, benchmarks, optimise, holdings, proposal, models
from models.database import init_db

logger = logging.getLogger(__name__)

app = FastAPI(title="BugleRock Analytics API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(status.router,      prefix="/api")
app.include_router(home.router,        prefix="/api/home")
app.include_router(performance.router, prefix="/api/performance")
app.include_router(peer.router,        prefix="/api/peer")
app.include_router(simulator.router,   prefix="/api/simulator")
app.include_router(rolling.router,     prefix="/api/rolling")
app.include_router(chat.router,        prefix="/api/chat")
app.include_router(funds.router,       prefix="/api/funds")
app.include_router(gmail.router,       prefix="/api/gmail")
app.include_router(nav.router,         prefix="/api/nav")
app.include_router(benchmarks.router,  prefix="/api")
app.include_router(optimise.router,    prefix="/api")
app.include_router(holdings.router,    prefix="/api/holdings")
app.include_router(proposal.router,    prefix="/api/proposal")
app.include_router(models.router,      prefix="/api/models")


async def gmail_poll_loop():
    """Poll Gmail every 5 minutes for the latest Morningstar report and benchmark emails."""
    from services.gmail_watcher import fetch_latest

    while True:
        try:
            logger.info("Gmail poll: checking for latest data...")
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, fetch_latest, 3)
            if result:
                logger.info("Gmail poll: new data loaded successfully")
                try:
                    from services.nav_fetcher import get_tracked_isins, append_daily_nav, fetch_nav_history
                    from services.db_service import get_all_isins_with_amfi_code

                    tracked_isins = get_tracked_isins()
                    if tracked_isins:
                        await loop.run_in_executor(None, append_daily_nav, tracked_isins)
                        logger.info(f"NAV append: updated {len(tracked_isins)} funds")

                    all_isins = set(get_all_isins_with_amfi_code())
                    tracked_set = set(tracked_isins)
                    new_funds = all_isins - tracked_set
                    if new_funds:
                        logger.info(f"New funds detected: {len(new_funds)} — fetching NAV history automatically")
                        import threading
                        def fetch_new_funds():
                            for isin in new_funds:
                                try:
                                    fetch_nav_history(isin, force_full=False)
                                    logger.info(f"NAV fetched for new fund: {isin}")
                                except Exception as e:
                                    logger.warning(f"NAV fetch failed for new fund {isin}: {e}")
                        threading.Thread(target=fetch_new_funds, daemon=True).start()
                    else:
                        logger.info("No new funds in today's email")
                except Exception as nav_err:
                    logger.warning(f"NAV update failed: {nav_err}")
            else:
                logger.info("Gmail poll: no new data found")

            # Also check for benchmark emails (NSE + CRISIL) every poll cycle
            try:
                from services.benchmark_watcher import fetch_all_benchmarks
                bm_result = await loop.run_in_executor(None, fetch_all_benchmarks, 5)
                if bm_result.get("nse") or bm_result.get("crisil"):
                    logger.info(f"Benchmark poll: new data — {bm_result}")
            except Exception as bm_err:
                logger.warning(f"Benchmark poll error: {bm_err}")

        except Exception as e:
            logger.error(f"Gmail poll error: {e}", exc_info=True)

        await asyncio.sleep(5 * 60)


async def migrate_benchmark_risk_columns():
    """Add benchmark fields to daily_fund_data table if they don't exist."""
    from sqlalchemy import text
    cols = [
        ("is_benchmark",    "INTEGER DEFAULT 0"),
        ("benchmark_label", "VARCHAR(20)"),
    ]
    try:
        from models.database import engine
        with engine.connect() as conn:
            for col_name, col_type in cols:
                try:
                    conn.execute(text(f"ALTER TABLE daily_fund_data ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
                    logger.info(f"Migration: added daily_fund_data.{col_name}")
                except Exception:
                    conn.rollback()
    except Exception as e:
        logger.warning(f"Migration skipped: {e}")


async def check_parser_version():
    """On startup, check if parser version has changed and re-parse if needed."""
    from services.parser import PARSER_VERSION
    from services.db_service import get_setting, set_setting
    from models.database import SessionLocal, DailyFundData, BenchmarkData
    from services.gmail_watcher import fetch_latest
    from datetime import timedelta

    try:
        stored_version = get_setting("parser_version")
        if stored_version == PARSER_VERSION:
            logger.info(f"Parser version {PARSER_VERSION} unchanged — no re-parse needed")
            return

        logger.info(f"Parser version changed: {stored_version} → {PARSER_VERSION}. Re-parsing recent data...")

        db = SessionLocal()
        try:
            cutoff = date.today() - timedelta(days=7)
            deleted = db.query(DailyFundData).filter(DailyFundData.data_date >= cutoff).delete()
            db.query(BenchmarkData).filter(BenchmarkData.data_date >= cutoff).delete()
            db.commit()
            logger.info(f"Deleted {deleted} fund records for re-parse")
        finally:
            db.close()

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, fetch_latest, 7)
        if result:
            logger.info("Re-parse complete — data reloaded successfully")
        else:
            logger.warning("Re-parse: could not fetch email, will retry on next poll")

        set_setting("parser_version", PARSER_VERSION)

    except Exception as e:
        logger.error(f"Parser version check failed: {e}", exc_info=True)


async def migrate_branding_name_column():
    """Add branding_name column to daily_fund_data if it doesn't exist."""
    from sqlalchemy import text
    from models.database import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("""
            ALTER TABLE daily_fund_data
            ADD COLUMN IF NOT EXISTS branding_name VARCHAR(200)
        """))
        db.commit()
        logger.info("migrate_branding_name_column: done")
    except Exception as e:
        logger.warning(f"migrate_branding_name_column: {e}")
        db.rollback()
    finally:
        db.close()



@app.on_event("startup")
async def startup():
    init_db()
    await migrate_benchmark_risk_columns()
    await migrate_branding_name_column()

    # Benchmark NAV table migration
    try:
        from services.benchmark_db_service import migrate_benchmark_nav_table
        migrate_benchmark_nav_table()
    except Exception as e:
        logger.warning(f"Benchmark NAV migration failed: {e}")

    # Benchmark Returns table migration (new)
    try:
        from services.benchmark_db_service import migrate_benchmark_returns_table
        migrate_benchmark_returns_table()
    except Exception as e:
        logger.warning(f"Benchmark Returns migration failed: {e}")

    await check_parser_version()
    from services.morningstar_service import seed_accesscode_from_env
    seed_accesscode_from_env()

    # Force-fetch today's email on startup so localhost is always up to date
    async def startup_fetch():
        try:
            from services.gmail_watcher import fetch_latest
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: fetch_latest(check_days=3, force=False))
            if result:
                logger.info("Startup fetch: new data loaded")
            else:
                logger.info("Startup fetch: already up to date")
        except Exception as e:
            logger.warning(f"Startup fetch failed: {e}")

    asyncio.create_task(startup_fetch())
    asyncio.create_task(gmail_poll_loop())
    asyncio.create_task(nav_daily_cron())
    asyncio.create_task(holdings_monthly_cron())


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "BugleRock Analytics", "version": "2.0.0"}


async def nav_daily_cron():
    """Independent daily cron — appends latest NAV for all tracked ISINs at midnight."""
    import asyncio
    from datetime import datetime, timedelta
    from services.nav_fetcher import get_tracked_isins, append_daily_nav
    from services.db_service import set_setting

    logger.info("NAV daily cron started")
    while True:
        try:
            now = datetime.now()
            next_run = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
            sleep_secs = (next_run - now).total_seconds()
            logger.info(f"NAV cron: next run at {next_run.strftime('%Y-%m-%d %H:%M:%S')} (in {int(sleep_secs/3600)}h {int((sleep_secs%3600)/60)}m)")
            await asyncio.sleep(sleep_secs)

            logger.info("NAV daily cron: starting append...")
            isins = get_tracked_isins()
            if isins:
                results = await asyncio.get_event_loop().run_in_executor(None, append_daily_nav, isins)
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                log_msg = f"NAV daily append completed at {now_str} — success:{results['success']} failed:{results['failed']} up_to_date:{results['up_to_date']} total_funds:{len(isins)}"
                logger.info(log_msg)
                set_setting("nav_last_append", now_str)
                set_setting("nav_last_append_result", str(results))
            else:
                logger.info("NAV daily cron: no tracked ISINs yet, skipping")
        except Exception as e:
            logger.error(f"NAV daily cron error: {e}", exc_info=True)
            await asyncio.sleep(3600)



async def holdings_monthly_cron():
    """
    Monthly cron — fetches full holdings for all funds on the 1st of each month.
    Also triggers accesscode auto-rotation when expiry is within 7 days.
    Runs at 02:00 AM on the 1st of each month.
    """
    import asyncio
    from datetime import datetime
    from services.morningstar_service import fetch_universe_holdings, get_valid_accesscode
    from models.database import SessionLocal, DailyFundData

    while True:
        now = datetime.now()
        if now.day == 1 and now.hour == 2:
            logger.info("Monthly holdings cron: starting universe fetch")
            db = SessionLocal()
            try:
                latest_date = db.query(DailyFundData.data_date).order_by(
                    DailyFundData.data_date.desc()
                ).first()
                if latest_date:
                    isins = [
                        r[0] for r in db.query(DailyFundData.isin).filter(
                            DailyFundData.data_date == latest_date[0]
                        ).distinct().all()
                    ]
                    accesscode = get_valid_accesscode()  # auto-rotates if expiring soon
                    if accesscode and isins:
                        summary = fetch_universe_holdings(isins, accesscode)
                        logger.info(f"Monthly holdings fetch complete: {summary}")
            except Exception as e:
                logger.error(f"Monthly holdings cron error: {e}", exc_info=True)
            finally:
                db.close()
            await asyncio.sleep(25 * 3600)  # sleep 25h to avoid double-run
        else:
            await asyncio.sleep(3600)  # check again in 1 hour


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("APP_PORT", 8000)), reload=True)