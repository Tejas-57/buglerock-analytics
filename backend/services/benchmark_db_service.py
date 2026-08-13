"""
benchmark_db_service.py
Manages benchmark_nav table in PostgreSQL.
"""

import logging
from datetime import date
from typing import Optional
from sqlalchemy import text

logger = logging.getLogger(__name__)


def migrate_benchmark_nav_table():
    """Create benchmark_nav table if it doesn't exist. Skips immediately if already there."""
    from models.database import engine
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        # Fast check — skip all DDL if table already exists
        exists = conn.execute(text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'benchmark_nav')"
        )).scalar()
        if exists:
            return  # already set up — nothing to do
        # First-time only
        conn.execute(text("""
            CREATE TABLE benchmark_nav (
                id         SERIAL PRIMARY KEY,
                nav_date   DATE NOT NULL,
                index_name VARCHAR(200) NOT NULL,
                value      NUMERIC(18,4) NOT NULL,
                UNIQUE (nav_date, index_name)
            )
        """))
        conn.execute(text(
            "CREATE INDEX idx_benchmark_nav_date_index ON benchmark_nav (nav_date, index_name)"
        ))
    logger.info("benchmark_nav table created")


def upsert_benchmark_rows(rows: list[dict]) -> int:
    """Upsert rows: [{date, index_name, value}]."""
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
                logger.warning(f"Upsert failed: {e}")
        conn.commit()
    return count


def bulk_upsert_benchmark_rows(rows: list[dict], batch_size: int = 500) -> int:
    """Faster upsert for large historical load."""
    if not rows:
        return 0
    from models.database import engine
    total = 0
    with engine.connect() as conn:
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i+batch_size]
            values = ",".join([
                f"('{r['date']}', :n{j}, :v{j})"
                for j, r in enumerate(batch)
            ])
            params = {}
            for j, r in enumerate(batch):
                params[f"n{j}"] = r["index_name"]
                params[f"v{j}"] = r["value"]
            try:
                conn.execute(text(f"""
                    INSERT INTO benchmark_nav (nav_date, index_name, value)
                    VALUES {values}
                    ON CONFLICT (nav_date, index_name)
                    DO UPDATE SET value = EXCLUDED.value
                """), params)
                total += len(batch)
                logger.info(f"bulk_upsert: {total}/{len(rows)}")
            except Exception as e:
                logger.warning(f"bulk_upsert batch failed: {e}")
        conn.commit()
    return total


def load_historical_from_sheet() -> dict:
    """
    ONE-TIME operation: read entire Google Sheet → populate benchmark_nav DB.
    Runs in background — takes 1-3 minutes.
    """
    from services.benchmark_sheet_service import read_all_benchmarks_full
    from services.db_service import set_setting

    try:
        logger.info("load_historical_from_sheet: starting sheet read...")
        records = read_all_benchmarks_full()
        if not records:
            logger.warning("load_historical_from_sheet: no records from sheet")
            return {"loaded": 0, "error": "No records from sheet"}
        n = bulk_upsert_benchmark_rows(records)
        set_setting("benchmark_historical_loaded", "yes")
        logger.info(f"load_historical_from_sheet: loaded {n} records")
        return {"loaded": n, "total_read": len(records)}
    except Exception as e:
        logger.error(f"load_historical_from_sheet failed: {e}", exc_info=True)
        return {"loaded": 0, "error": str(e)}


def get_nav_history(index_name: str, from_date: Optional[date] = None, to_date: Optional[date] = None) -> list[dict]:
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


def get_available_indices() -> list[dict]:
    """Return all indices with row counts and latest date."""
    from models.database import engine
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT index_name, COUNT(*) as n, MIN(nav_date) as first_dt, MAX(nav_date) as last_dt
            FROM benchmark_nav
            GROUP BY index_name
            ORDER BY index_name
        """)).fetchall()
    return [
        {"index_name": r[0], "row_count": r[1], "first_date": str(r[2]), "last_date": str(r[3])}
        for r in rows
    ]


def get_latest_value(index_name: str) -> Optional[dict]:
    from models.database import engine
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT nav_date, value FROM benchmark_nav WHERE index_name = :n ORDER BY nav_date DESC LIMIT 1"),
            {"n": index_name},
        ).fetchone()
    return {"date": str(row[0]), "value": float(row[1])} if row else None