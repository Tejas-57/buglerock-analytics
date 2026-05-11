from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

from routers import home, performance, peer, simulator, rolling, chat, status, funds
from models.database import init_db

app = FastAPI(title="BugleRock Analytics API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(status.router,      prefix="/api")
app.include_router(home.router,        prefix="/api/home")
app.include_router(performance.router, prefix="/api/performance")
app.include_router(peer.router,        prefix="/api/peer")
app.include_router(simulator.router,   prefix="/api/simulator")
app.include_router(rolling.router,     prefix="/api/rolling")
app.include_router(chat.router,        prefix="/api/chat")
app.include_router(funds.router,       prefix="/api/funds")


def fetch_missing_dates():
    """
    On startup, find all trading dates between the latest DB date and today
    that are missing from the DB, and fetch them from Gmail.
    """
    from datetime import date, timedelta
    from services.db_service import get_latest_data_date
    from services.gmail_watcher import fetch_and_store
    from utils.trading_calendar import is_trading_day

    today = date.today()
    latest = get_latest_data_date()

    if latest is None:
        # No data at all — try fetching yesterday
        fetch_and_store(today - timedelta(days=1))
        return

    if latest >= today:
        print(f"[Startup] Data is up to date as of {latest}")
        return

    # Fetch all missing dates from latest+1 to yesterday
    current = latest + timedelta(days=1)
    fetched = 0
    while current < today:
        if is_trading_day(current):
            print(f"[Startup] Fetching missing date: {current}")
            success = fetch_and_store(current)
            if success:
                fetched += 1
        current += timedelta(days=1)

    print(f"[Startup] Fetched {fetched} missing date(s). Latest data now up to {latest}")


@app.on_event("startup")
async def startup():
    init_db()
    import asyncio
    # Fetch missing dates in background so server starts instantly
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, fetch_missing_dates)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "BugleRock Analytics"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("APP_PORT", 8000)), reload=True)