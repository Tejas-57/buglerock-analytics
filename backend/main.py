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
app.include_router(gmail.router,       prefix="/api/gmail")


async def gmail_poll_loop():
    """
    Poll Gmail every 5 minutes for the latest Morningstar report.
    Checks today and up to 3 days back so we never miss an email.
    """
    from services.gmail_watcher import fetch_latest

    while True:
        try:
            logger.info("Gmail poll: checking for latest data...")
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, fetch_latest, 3)
            if result:
                logger.info("Gmail poll: new data loaded successfully")
            else:
                logger.info("Gmail poll: no new data found")
        except Exception as e:
            logger.error(f"Gmail poll error: {e}", exc_info=True)

        await asyncio.sleep(5 * 60)  # poll every 5 minutes


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