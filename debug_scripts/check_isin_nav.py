import sys
from pathlib import Path
BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")
from sqlalchemy import text
from models.database import engine
with engine.connect() as conn:
    r = conn.execute(text("SELECT COUNT(*) FROM nav_history WHERE isin = 'INF204K01EY4'")).scalar()
    print(f"Rows in nav_history: {r}")
    r2 = conn.execute(text("SELECT isin, name, amfi_code FROM daily_fund_data WHERE isin = 'INF204K01EY4' LIMIT 1")).fetchone()
    print(f"In daily_fund_data: {r2}")
    r3 = conn.execute(text("SELECT isin, status, message FROM nav_fetch_log WHERE isin = 'INF204K01EY4' ORDER BY fetched_at DESC LIMIT 3")).fetchall()
    print(f"Nav fetch log: {r3}")