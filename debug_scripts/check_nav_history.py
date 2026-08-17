import sys
from pathlib import Path
BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")
from sqlalchemy import text
from models.database import engine
with engine.connect() as conn:
    total = conn.execute(text("SELECT COUNT(*) FROM nav_history")).scalar()
    distinct = conn.execute(text("SELECT COUNT(DISTINCT isin) FROM nav_history")).scalar()
    sample = conn.execute(text("SELECT isin, MIN(date), MAX(date), COUNT(*) FROM nav_history GROUP BY isin ORDER BY COUNT(*) DESC LIMIT 5")).fetchall()
    print(f"Total rows: {total:,}")
    print(f"Distinct ISINs: {distinct:,}")
    print("\nTop 5 by row count:")
    for r in sample:
        print(f"  {r[0]}  {r[1]} → {r[2]}  ({r[3]} rows)")