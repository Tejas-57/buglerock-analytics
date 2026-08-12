"""
benchmark_db_service.py
Manages benchmark_nav table in PostgreSQL.
Syncs data from Google Sheet → DB on startup and after each email parse.
"""

import logging
from datetime import date
from typing import Optional
from sqlalchemy import text

logger = logging.getLogger(__name__)


def migrate_benchmark_nav_table():
    """Create benchmark_nav table if it doesn't exist."""
    from models.database import engine
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS benchmark_nav (
                id         SERIAL PRIMARY KEY,
                nav_date   DATE NOT NULL,
                index_name VARCHAR(200) NOT NULL,
                value      NUMERIC(18,4) NOT NULL,
                UNIQUE (nav_date, index_name)
            )
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_benchmark_nav_date_index
            ON benchmark_nav (nav_date, index_name)
        """))
        conn.commit()
    logger.info("benchmark_nav table ready")


def upsert_benchmark_rows(rows: list[dict]) -> int:
    """
    Upsert rows into benchmark_nav table.
    rows: list of {date, index_name, value} dicts.
    Returns number of rows upserted.
    """
    if not rows:
        return 0
    from models.database import engine
    count = 0
    with engine.connect() as conn:
        for r in rows:
            try:
                conn.execute(text("""
                    INSERT INTO benchmark_nav (nav_date, index_name, value)
                    VALUES (:d, :n, :v)
                    ON CONFLICT (nav_date, index_name)
                    DO UPDATE SET value = EXCLUDED.value
                """), {"d": r["date"], "n": r["index_name"], "v": r["value"]})
                count += 1
            except Exception as e:
                logger.warning(f"Upsert failed for {r}: {e}")
        conn.commit()
    return count


def sync_sheet_to_db() -> dict:
    """
    Full sync: read all 3 sheet tabs → upsert into benchmark_nav table.
    Called on startup and can be triggered manually.
    """
    try:
        from services.benchmark_sheet_service import read_all_benchmarks
        records = read_all_benchmarks()
        if not records:
            logger.warning("sync_sheet_to_db: no records read from sheet")
            return {"synced": 0, "error": "No records from sheet"}

        n = upsert_benchmark_rows(records)
        logger.info(f"sync_sheet_to_db: upserted {n} records from {len(records)} sheet rows")
        return {"synced": n, "total_read": len(records)}
    except Exception as e:
        logger.error(f"sync_sheet_to_db failed: {e}", exc_info=True)
        return {"synced": 0, "error": str(e)}


def get_nav_history(
    index_name: str,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> list[dict]:
    """
    Query benchmark_nav for a specific index, optionally filtered by date range.
    Returns list of {date, value} dicts sorted by date ascending.
    """
    from models.database import engine
    params = {"n": index_name}
    where = "WHERE index_name = :n"
    if from_date:
        where += " AND nav_date >= :from_date"
        params["from_date"] = from_date
    if to_date:
        where += " AND nav_date <= :to_date"
        params["to_date"] = to_date

    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT nav_date, value FROM benchmark_nav {where} ORDER BY nav_date ASC"),
            params,
        ).fetchall()

    return [{"date": str(r[0]), "value": float(r[1])} for r in rows]


def get_available_indices() -> list[str]:
    """Return list of all index names in the benchmark_nav table."""
    from models.database import engine
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT DISTINCT index_name FROM benchmark_nav ORDER BY index_name")
        ).fetchall()
    return [r[0] for r in rows]


def get_latest_value(index_name: str) -> Optional[dict]:
    """Return the most recent value for an index."""
    from models.database import engine
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT nav_date, value FROM benchmark_nav WHERE index_name = :n ORDER BY nav_date DESC LIMIT 1"),
            {"n": index_name},
        ).fetchone()
    if not row:
        return None
    return {"date": str(row[0]), "value": float(row[1])}