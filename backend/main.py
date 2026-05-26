from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import asyncio
import logging
from datetime import date

load_dotenv()

from routers import home, performance, peer, simulator, rolling, chat, status, funds, gmail
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


async def gmail_poll_loop():
    """Poll Gmail every 30 minutes for today's Morningstar report."""
    from services.db_service import has_data_for_date
    from services.gmail_watcher import fetch_and_store

    while True:
        try:
            today = date.today()
            if not has_data_for_date(today):
                logger.info(f"Gmail poll: checking for data on {today}...")
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, fetch_and_store, today)
                if result:
                    logger.info(f"Gmail poll: data loaded for {today}")
                else:
                    logger.info(f"Gmail poll: no email found yet for {today}")
            else:
                logger.info(f"Gmail poll: data already present for {today}")
        except Exception as e:
            logger.error(f"Gmail poll error: {e}", exc_info=True)

        await asyncio.sleep(30 * 60)  # poll every 30 minutes


@app.on_event("startup")
async def startup():
    init_db()
    asyncio.create_task(gmail_poll_loop())


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "BugleRock Analytics", "version": "2.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("APP_PORT", 8000)), reload=True)