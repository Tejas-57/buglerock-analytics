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


# ── Benchmark Returns Table ───────────────────────────────────────────────────

RETURN_FIELDS = [
    "return_1d", "return_1w", "return_1m", "return_3m", "return_6m",
    "return_1y", "return_2y", "return_3y", "return_5y", "return_7y", "return_10y",
    "return_ytd",
    "return_cy2025", "return_cy2024", "return_cy2023", "return_cy2022", "return_cy2021",
]


def migrate_benchmark_returns_table():
    """Create benchmark_returns table if it doesn't exist."""
    from models.database import engine
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        exists = conn.execute(text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'benchmark_returns')"
        )).scalar()
        if exists:
            return
        cols = ",\n".join([f"    {f} NUMERIC(10,4)" for f in RETURN_FIELDS])
        conn.execute(text(f"""
            CREATE TABLE benchmark_returns (
                id         SERIAL PRIMARY KEY,
                data_date  DATE NOT NULL,
                index_name VARCHAR(200) NOT NULL,
                {cols},
                UNIQUE (data_date, index_name)
            )
        """))
        conn.execute(text(
            "CREATE INDEX idx_bm_returns_date_index ON benchmark_returns (data_date, index_name)"
        ))
    logger.info("benchmark_returns table created")


def _get_nav_on_or_before(conn, index_name: str, target_date: str) -> Optional[float]:
    """
    Get the closing NAV for index_name on target_date, or the nearest
    available date before it (handles holidays/weekends).
    Returns None if no data exists within 7 calendar days before target_date.
    """
    row = conn.execute(text("""
        SELECT value FROM benchmark_nav
        WHERE index_name = :n
          AND nav_date <= :d
          AND nav_date >= CAST(:d AS DATE) - INTERVAL '7 days'
        ORDER BY nav_date DESC
        LIMIT 1
    """), {"n": index_name, "d": target_date}).fetchone()
    return float(row[0]) if row else None


def compute_and_store_benchmark_returns(period_dates: dict, data_date: str) -> dict:
    """
    Compute point-to-point returns for all indices in benchmark_nav using
    the exact period start/end dates extracted from the Morningstar Excel.

    Called from save_parsed_data after fund rows are inserted.

    period_dates: dict from parser — {db_field: {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}
    data_date:    the Morningstar data_date string (YYYY-MM-DD)

    Returns {"computed": N, "indices": M, "skipped": K}
    """
    if not period_dates:
        logger.warning("compute_and_store_benchmark_returns: no period_dates provided — skipping")
        return {"computed": 0, "indices": 0, "skipped": 0}

    from models.database import engine

    # Get all available indices
    with engine.connect() as conn:
        index_rows = conn.execute(text(
            "SELECT DISTINCT index_name FROM benchmark_nav"
        )).fetchall()
    indices = [r[0] for r in index_rows]
    if not indices:
        return {"computed": 0, "indices": 0, "skipped": 0}

    computed = 0
    skipped = 0

    # Fields that use CAGR (annualised) — anything with holding period > 1 year.
    # Calendar year returns (cy20xx) are always absolute (single-year return).
    # Periods <= 1Y (1d, 1w, 1m, 3m, 6m, 1y, ytd) stay as absolute % return.
    CAGR_FIELDS = {
        "return_2y":  2,
        "return_3y":  3,
        "return_5y":  5,
        "return_7y":  7,
        "return_10y": 10,
    }

    def compute_return(db_field: str, start_val: float, end_val: float) -> float:
        """
        For CAGR fields: annualise using fixed N years.
        For all other fields: simple point-to-point absolute return.
        """
        if db_field in CAGR_FIELDS:
            n = CAGR_FIELDS[db_field]
            return round(((end_val / start_val) ** (1 / n) - 1) * 100, 4)
        else:
            return round((end_val / start_val - 1) * 100, 4)

    with engine.connect() as conn:
        for index_name in indices:
            returns = {}
            for db_field, dates in period_dates.items():
                start_date = dates.get("start")
                end_date   = dates.get("end")
                if not start_date or not end_date:
                    continue
                start_val = _get_nav_on_or_before(conn, index_name, start_date)
                end_val   = _get_nav_on_or_before(conn, index_name, end_date)
                if start_val and end_val and start_val != 0:
                    val = compute_return(db_field, start_val, end_val)
                    if val is not None:
                        returns[db_field] = val
                # else: leave as NULL — index didn't exist yet for that period

            if not returns:
                skipped += 1
                continue

            # Build upsert
            set_clause = ", ".join([f"{f} = :{f}" for f in returns])
            col_names  = ", ".join(returns.keys())
            placeholders = ", ".join([f":{f}" for f in returns.keys()])
            params = {"data_date": data_date, "index_name": index_name, **returns}

            try:
                conn.execute(text(f"""
                    INSERT INTO benchmark_returns (data_date, index_name, {col_names})
                    VALUES (:data_date, :index_name, {placeholders})
                    ON CONFLICT (data_date, index_name)
                    DO UPDATE SET {set_clause}
                """), params)
                computed += 1
            except Exception as e:
                logger.warning(f"benchmark_returns upsert failed for {index_name}: {e}")
                skipped += 1

        conn.commit()

    logger.info(
        f"compute_and_store_benchmark_returns: {computed} indices computed, "
        f"{skipped} skipped, data_date={data_date}"
    )
    return {"computed": computed, "indices": len(indices), "skipped": skipped}


def get_benchmark_returns(index_name: str, data_date: str) -> Optional[dict]:
    """Return stored returns for one index on a given data_date."""
    from models.database import engine
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT index_name, data_date,
                   return_1d, return_1w, return_1m, return_3m, return_6m,
                   return_1y, return_2y, return_3y, return_5y, return_7y, return_10y,
                   return_ytd,
                   return_cy2025, return_cy2024, return_cy2023, return_cy2022, return_cy2021
            FROM benchmark_returns
            WHERE index_name = :n AND data_date = :d
        """), {"n": index_name, "d": data_date}).fetchone()
    if not row:
        return None
    keys = ["index_name", "data_date",
            "return_1d", "return_1w", "return_1m", "return_3m", "return_6m",
            "return_1y", "return_2y", "return_3y", "return_5y", "return_7y", "return_10y",
            "return_ytd",
            "return_cy2025", "return_cy2024", "return_cy2023", "return_cy2022", "return_cy2021"]
    result = dict(zip(keys, row))
    result["data_date"] = str(result["data_date"])
    return result


def get_all_benchmark_returns(data_date: str) -> list[dict]:
    """Return stored returns for ALL indices on a given data_date."""
    from models.database import engine
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT index_name, data_date,
                   return_1d, return_1w, return_1m, return_3m, return_6m,
                   return_1y, return_2y, return_3y, return_5y, return_7y, return_10y,
                   return_ytd,
                   return_cy2025, return_cy2024, return_cy2023, return_cy2022, return_cy2021
            FROM benchmark_returns
            WHERE data_date = :d
            ORDER BY index_name
        """), {"d": data_date}).fetchall()
    keys = ["index_name", "data_date",
            "return_1d", "return_1w", "return_1m", "return_3m", "return_6m",
            "return_1y", "return_2y", "return_3y", "return_5y", "return_7y", "return_10y",
            "return_ytd",
            "return_cy2025", "return_cy2024", "return_cy2023", "return_cy2022", "return_cy2021"]
    results = []
    for row in rows:
        d = dict(zip(keys, row))
        d["data_date"] = str(d["data_date"])
        results.append(d)
    return results