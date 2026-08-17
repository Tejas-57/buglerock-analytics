# backend/routers/benchmarks.py
from fastapi import APIRouter, Query, BackgroundTasks
from models.database import SessionLocal, DailyFundData
from sqlalchemy import func
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def trim_bm_name(name: str) -> str:
    for suffix in [' TR INR', ' PR INR', 'TR INR', 'PR INR']:
        name = name.replace(suffix, '').strip()
    return name


# ── Existing endpoint (fund benchmarks) ───────────────────────────────────────

@router.get("/benchmarks")
def get_benchmarks(date: str = None):
    """Return all unique Benchmark 1 entries from DailyFundData."""
    db = SessionLocal()
    try:
        if not date:
            latest = db.query(func.max(DailyFundData.data_date)).filter(
                DailyFundData.is_benchmark == 1
            ).scalar()
            if not latest:
                return {"benchmarks": [], "count": 0}
            date = str(latest)

        rows = db.query(DailyFundData).filter(
            DailyFundData.is_benchmark == 1,
            DailyFundData.benchmark_label == 'Benchmark 1',
            DailyFundData.name != None,
            DailyFundData.name != '',
            DailyFundData.data_date == date,
        ).all()

        seen = set()
        results = []
        for r in rows:
            if not r.name or r.name in seen: continue
            seen.add(r.name)
            results.append({
                "name": r.name, "display_name": trim_bm_name(r.name),
                "return_1m": r.return_1m, "return_3m": r.return_3m,
                "return_6m": r.return_6m, "return_1y": r.return_1y,
                "return_3y": r.return_3y, "return_5y": r.return_5y,
                "return_ytd": r.return_ytd,
                "return_cy2025": r.return_cy2025, "return_cy2024": r.return_cy2024,
                "return_cy2023": r.return_cy2023, "return_cy2022": r.return_cy2022,
                "return_cy2021": r.return_cy2021,
                "sharpe_ratio_3y": r.sharpe_ratio_3y, "std_dev_3y": r.std_dev_3y,
            })
        results.sort(key=lambda x: x["display_name"])
        return {"benchmarks": results, "count": len(results)}
    finally:
        db.close()


# ── Benchmark NAV time series ─────────────────────────────────────────────────

@router.get("/benchmarks/indices")
def get_benchmark_indices():
    """List all benchmark indices in the NAV history table with metadata."""
    try:
        from services.benchmark_db_service import get_available_indices
        return {"indices": get_available_indices()}
    except Exception as e:
        return {"indices": [], "error": str(e)}


@router.get("/benchmarks/nav-history")
def get_benchmark_nav_history(
    index: str = Query(...),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """Return daily NAV history for a benchmark index."""
    try:
        from services.benchmark_db_service import get_nav_history
        from datetime import date as date_type
        fd = date_type.fromisoformat(from_date) if from_date else None
        td = date_type.fromisoformat(to_date)   if to_date   else None
        rows = get_nav_history(index, fd, td)
        return {"index": index, "data": rows, "count": len(rows)}
    except Exception as e:
        return {"index": index, "data": [], "error": str(e)}


@router.get("/benchmarks/latest")
def get_benchmark_latest(index: str = Query(...)):
    try:
        from services.benchmark_db_service import get_latest_value
        return get_latest_value(index) or {"index": index, "error": "No data"}
    except Exception as e:
        return {"index": index, "error": str(e)}


@router.post("/benchmarks/sync")
async def sync_benchmarks(background_tasks: BackgroundTasks):
    """
    Poll Gmail for new NSE/CRISIL benchmark emails.
    Appends new rows to sheet and DB.
    Runs in background — returns immediately.
    """
    from services.benchmark_watcher import fetch_all_benchmarks

    def run():
        try:
            result = fetch_all_benchmarks(check_days=5)
            logger.info(f"sync_benchmarks: {result}")
        except Exception as e:
            logger.error(f"sync_benchmarks failed: {e}")

    background_tasks.add_task(run)
    return {"message": "Benchmark email check started in background"}


@router.post("/benchmarks/load-history")
async def load_historical(background_tasks: BackgroundTasks):
    """
    ONE-TIME: read entire Google Sheet → populate benchmark_nav table.
    Takes 1-3 minutes. Runs in background. Idempotent (safe to re-run).
    """
    from services.benchmark_db_service import load_historical_from_sheet

    def run():
        try:
            result = load_historical_from_sheet()
            logger.info(f"load_historical: {result}")
        except Exception as e:
            logger.error(f"load_historical failed: {e}")

    background_tasks.add_task(run)
    return {"message": "Historical load started in background — check /api/benchmarks/indices in 2-3 minutes"}


@router.get("/benchmarks/returns")
def get_benchmark_returns_endpoint(
    index: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
):
    """
    Returns computed point-to-point returns for benchmark indices.
    - If index + date: returns one index's returns for that date.
    - If only date: returns all indices' returns for that date.
    - If neither: uses latest available date, returns all indices.
    """
    try:
        from services.benchmark_db_service import (
            get_benchmark_returns, get_all_benchmark_returns
        )
        from sqlalchemy import text
        from models.database import engine

        # Resolve date — use latest available if not provided
        if not date:
            with engine.connect() as conn:
                latest = conn.execute(text(
                    "SELECT MAX(data_date) FROM benchmark_returns"
                )).scalar()
            if not latest:
                return {"benchmarks": [], "count": 0, "date": None}
            date = str(latest)

        if index:
            result = get_benchmark_returns(index, date)
            if not result:
                return {"benchmarks": [], "count": 0, "date": date}
            return {"benchmarks": [result], "count": 1, "date": date}
        else:
            results = get_all_benchmark_returns(date)
            return {"benchmarks": results, "count": len(results), "date": date}
    except Exception as e:
        logger.error(f"get_benchmark_returns_endpoint failed: {e}")
        return {"benchmarks": [], "count": 0, "error": str(e)}


@router.get("/benchmarks/load-status")
def load_status():
    """Check if the historical load has completed."""
    try:
        from services.db_service import get_setting
        from services.benchmark_db_service import get_available_indices
        loaded = get_setting("benchmark_historical_loaded") == "yes"
        indices = get_available_indices() if loaded else []
        return {"historical_loaded": loaded, "index_count": len(indices), "indices": indices}
    except Exception as e:
        return {"error": str(e)}


@router.get("/benchmarks/rolling-metrics")
def get_benchmark_rolling_metrics(
    index_names: str = Query(..., description="Comma-separated benchmark index names"),
    weights: str = Query(..., description="Comma-separated weights summing to 100"),
):
    """
    Compute rolling return metrics for a blended benchmark using benchmark_nav table.
    Same windows as fund rolling metrics:
      - 3M rolling return, averaged over 1Y lookback
      - 1Y rolling return, averaged over 3Y lookback
      - 3Y rolling CAGR, averaged over 5Y lookback

    Blends multiple indices by weight before computing rolling windows —
    giving a true blended benchmark rolling return, not an average of individual rolling returns.
    """
    from sqlalchemy import text
    from models.database import engine

    names = [n.strip() for n in index_names.split(",") if n.strip()]
    wts   = [float(w.strip()) for w in weights.split(",") if w.strip()]

    if len(names) != len(wts):
        return {"error": "index_names and weights must have same length"}

    total_w = sum(wts)
    if abs(total_w - 100) > 1:
        return {"error": f"Weights must sum to ~100, got {total_w}"}

    wt_frac = {n: w / 100.0 for n, w in zip(names, wts)}

    WINDOW_3M, LOOKBACK_3M = 63,      252
    WINDOW_1Y, LOOKBACK_1Y = 252,     252 * 3
    WINDOW_3Y, LOOKBACK_3Y = 252 * 3, 252 * 5

    def rolling_avg(navs, window, lookback):
        needed = window + lookback
        n = len(navs)
        if n < needed:
            return None, 0
        tail = navs[-needed:]
        rets = []
        for end in range(window, needed):
            sv, ev = tail[end - window], tail[end]
            if sv and sv > 0 and ev is not None:
                rets.append(ev / sv)
        if not rets:
            return None, 0
        years = window / 252
        if years > 1:
            avg = sum(r ** (1 / years) - 1 for r in rets) / len(rets)
        else:
            avg = sum(r - 1 for r in rets) / len(rets)
        return avg * 100, len(rets)

    try:
        # Normalise names — strip Morningstar suffixes to match benchmark_nav canonical names
        NAME_MAP = {
            'Nifty 500': 'Nifty 500',
            'CRISIL Composite Bond': 'CRISIL Composite Bond Index',
            'CRISIL Composite Bond Index': 'CRISIL Composite Bond Index',
            'Nifty 50': 'Nifty 50',
            'Nifty 100': 'Nifty 100',
            'Nifty Midcap 150': 'Nifty Midcap 150',
            'Nifty Next 50': 'Nifty Next 50',
            'Nifty Smallcap 250': 'Nifty Smallcap 250',
        }
        def normalise_name(n):
            # Strip Morningstar suffixes first
            for suffix in [' TR INR', ' PR INR', ' NR INR', ' TR', ' PR', ' NR']:
                if n.endswith(suffix):
                    n = n[:-len(suffix)].strip()
            # Map to canonical benchmark_nav name
            return NAME_MAP.get(n, n)
        names_norm = [normalise_name(n) for n in names]
        # Rebuild wt_frac with normalised names
        wt_frac = {normalise_name(n): w for n, w in wt_frac.items()}

        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT index_name, nav_date, value
                FROM benchmark_nav
                WHERE index_name = ANY(:names)
                  AND value IS NOT NULL AND value > 0
                ORDER BY index_name, nav_date ASC
            """), {"names": names_norm}).fetchall()

        from collections import defaultdict
        series = defaultdict(list)  # {index_name: [(date, value)]}
        for r in rows:
            series[r[0]].append((r[1], float(r[2])))

        # Build blended daily NAV series on common dates
        date_sets = [set(d for d, _ in series[n]) for n in names_norm if n in series]
        if not date_sets:
            return {"error": "No data found for any benchmark index"}

        common_dates = sorted(date_sets[0].intersection(*date_sets[1:]))

        if not common_dates:
            return {"error": "No common dates across benchmark indices"}

        # Build lookup dicts
        nav_lookup = {n: dict(series[n]) for n in names_norm}

        # Compute blended NAV on each common date (rebased to 100 at start)
        blended = []
        base_vals = {n: nav_lookup[n][common_dates[0]] for n in names_norm if common_dates[0] in nav_lookup.get(n, {})}
        for d in common_dates:
            val = 0.0
            for n in names_norm:
                nav_d = nav_lookup[n].get(d)
                base  = base_vals.get(n)
                if nav_d and base and base > 0:
                    val += (nav_d / base) * wt_frac[n] * 100
            blended.append(val)

        r3m_avg, r3m_n = rolling_avg(blended, WINDOW_3M, LOOKBACK_3M)
        r1y_avg, r1y_n = rolling_avg(blended, WINDOW_1Y, LOOKBACK_1Y)
        r3y_avg, r3y_n = rolling_avg(blended, WINDOW_3Y, LOOKBACK_3Y)

        bm_label = " + ".join(
            f"{n} ({int(wt_frac[n]*100)}%)" if len(names_norm) > 1 else n
            for n in names_norm
        )

        return {
            "benchmark_label": bm_label,
            "common_days": len(common_dates),
            "date_from": str(common_dates[0]),
            "date_to":   str(common_dates[-1]),
            "rolling_3m_avg_1y":   round(r3m_avg, 4) if r3m_avg is not None else None,
            "rolling_3m_windows":  r3m_n,
            "rolling_1y_avg_3y":   round(r1y_avg, 4) if r1y_avg is not None else None,
            "rolling_1y_windows":  r1y_n,
            "rolling_3y_cagr_avg_5y": round(r3y_avg, 4) if r3y_avg is not None else None,
            "rolling_3y_windows":  r3y_n,
        }

    except Exception as e:
        logger.error(f"benchmark rolling metrics failed: {e}", exc_info=True)
        return {"error": str(e)}


@router.get("/benchmarks/stress-returns")
def get_benchmark_stress_returns(
    index_names: str = Query(...),
    weights: str = Query(...),
):
    """
    Compute benchmark returns for each stress scenario period from benchmark_nav.
    Returns {scenario_id: return_pct} for blended benchmark.
    """
    from sqlalchemy import text
    from models.database import engine

    STRESS_SCENARIOS = [
        {"id": "gfc",         "start": "2008-01-01", "end": "2008-10-31"},
        {"id": "euro",        "start": "2010-11-01", "end": "2011-12-31"},
        {"id": "china",       "start": "2015-03-01", "end": "2016-02-29"},
        {"id": "ilfs",        "start": "2018-08-01", "end": "2018-10-31"},
        {"id": "covid",       "start": "2020-01-01", "end": "2020-03-31"},
        {"id": "fiirerating", "start": "2024-09-01", "end": "2026-03-31"},
    ]

    names = [n.strip() for n in index_names.split(",") if n.strip()]
    wts   = [float(w.strip()) for w in weights.split(",") if w.strip()]

    NAME_MAP = {
        'Nifty 500': 'Nifty 500',
        'CRISIL Composite Bond': 'CRISIL Composite Bond Index',
        'CRISIL Composite Bond Index': 'CRISIL Composite Bond Index',
        'Nifty 50': 'Nifty 50', 'Nifty 100': 'Nifty 100',
        'Nifty Midcap 150': 'Nifty Midcap 150',
        'Nifty Next 50': 'Nifty Next 50',
        'Nifty Smallcap 250': 'Nifty Smallcap 250',
    }
    def normalise_name(n):
        for suffix in [' TR INR', ' PR INR', ' NR INR', ' TR', ' PR', ' NR']:
            if n.endswith(suffix): n = n[:-len(suffix)].strip()
        return NAME_MAP.get(n, n)

    names_norm = [normalise_name(n) for n in names]
    total_w = sum(wts)
    if abs(total_w - 100) > 1 or not names_norm:
        return {"error": "invalid input"}

    wt_frac = {n: w / total_w for n, w in zip(names_norm, wts)}
    results = {}

    try:
        # Pre-fetch earliest available date per index — to detect if scenario predates index
        with engine.connect() as conn:
            earliest = {}
            for n in names_norm:
                row = conn.execute(text(
                    "SELECT MIN(nav_date) FROM benchmark_nav WHERE index_name = :n"
                ), {"n": n}).fetchone()
                earliest[n] = row[0] if row and row[0] else None

            for sc in STRESS_SCENARIOS:
                blended_ret = 0.0
                valid_w = 0.0
                for n in names_norm:
                    # Case 2: scenario predates index inception — show null, not holiday gap
                    from datetime import date as date_type
                    sc_start = date_type.fromisoformat(sc["start"])
                    if earliest.get(n) and sc_start < earliest[n]:
                        continue  # this component has no data for this period

                    # Case 1: holiday/weekend gap — use ±10 days window
                    sv_row = conn.execute(text("""
                        SELECT value FROM benchmark_nav
                        WHERE index_name = :n AND nav_date >= :s AND nav_date <= CAST(:s AS date) + INTERVAL '10 days'
                        ORDER BY nav_date ASC LIMIT 1
                    """), {"n": n, "s": sc["start"]}).fetchone()
                    ev_row = conn.execute(text("""
                        SELECT value FROM benchmark_nav
                        WHERE index_name = :n AND nav_date <= :e AND nav_date >= CAST(:e AS date) - INTERVAL '10 days'
                        ORDER BY nav_date DESC LIMIT 1
                    """), {"n": n, "e": sc["end"]}).fetchone()

                    if sv_row and ev_row and float(sv_row[0]) > 0:
                        ret = (float(ev_row[0]) / float(sv_row[0]) - 1) * 100
                        blended_ret += ret * wt_frac[n]
                        valid_w += wt_frac[n]

                # Require ALL components to have data — if any missing due to index inception, show null
                all_present = abs(valid_w - 1.0) < 0.01
                results[sc["id"]] = round(blended_ret, 2) if all_present else None

        bm_label = " + ".join(
            f"{n} ({int(wt_frac[n]*100)}%)" if len(names_norm) > 1 else n
            for n in names_norm
        )
        return {"returns": results, "benchmark_label": bm_label}

    except Exception as e:
        logger.error(f"benchmark stress returns failed: {e}", exc_info=True)
        return {"error": str(e)}