from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

from routers import home, performance, peer, simulator, rolling, chat, status, funds
from models.database import init_db

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


@app.on_event("startup")
async def startup():
    init_db()
    # Fetch today's data if not already loaded
    import asyncio
    from datetime import date
    from services.db_service import has_data_for_date
    from services.gmail_watcher import fetch_and_store

    today = date.today()
    if not has_data_for_date(today):
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, fetch_and_store, today)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "BugleRock Analytics", "version": "2.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("APP_PORT", 8000)), reload=True)