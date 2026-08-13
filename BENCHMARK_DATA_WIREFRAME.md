# Benchmark Data — Complete Architecture Wireframe

---

## Overview

Three independent data sources feed three Google Sheet tabs, which all converge into one PostgreSQL table (`benchmark_nav`) on the Render backend.

```
SOURCE 1: Yahoo Finance          SOURCE 2: NSE Email              SOURCE 3: CRISIL Email
(via Apps Script)                (indices@nse.co.in)              (Crisil.Indices@crisil.com)
        │                                │                                │
        ▼                                ▼                                ▼
┌───────────────────┐          ┌─────────────────────┐        ┌──────────────────────┐
│  Google Sheet     │          │  Google Sheet        │        │  Google Sheet        │
│  "Nifty Indices"  │          │  "Nifty Multi Asset" │        │  "CRISIL Composite"  │
│  (10 indices)     │          │  (1 index)           │        │  (1 index)           │
└───────────────────┘          └─────────────────────┘        └──────────────────────┘
        │                                │                                │
        │  Backend reads tail            │  Backend appends new row       │  Backend appends new rows
        │  every 5 min (poll)            │  after parsing email           │  after parsing email
        │                                │                                │
        └────────────────────────────────┴────────────────────────────────┘
                                         │
                                         ▼
                             ┌───────────────────────┐
                             │  PostgreSQL DB         │
                             │  benchmark_nav table   │
                             │  (12 indices, 47K+ rows│
                             └───────────────────────┘
                                         │
                                         ▼
                             GET /api/benchmarks/nav-history
                             GET /api/benchmarks/latest
                             GET /api/benchmarks/indices
```

---

## Sheet 1 — "Nifty Indices" (10 indices)

### Indices tracked
Nifty 50, Nifty 100, Nifty 500, Nifty Next 50, Nifty Midcap 150,
Nifty Smallcap 250, Nifty MidSmallcap 400, Nifty LargeMidcap 250,
Nifty 500 Multicap 50:25:25, Nifty Total Market

### Data source
Yahoo Finance — pulled directly by a Google Apps Script attached to the sheet.

### How it gets written
Apps Script has **5 daily time-based triggers** set up in Google Workspace.
Each trigger fires at a different time of day and writes the current closing
value for all 10 indices into a new row in the sheet.

### How it reaches the DB
The backend **does not watch Gmail** for this tab. Instead, `benchmark_watcher.py`
reads the **last 20 rows** of this sheet tab every 5 minutes as part of the
existing Gmail poll loop. It upserts those rows into `benchmark_nav` via
`ON CONFLICT DO UPDATE` — so re-reading already-stored rows is a no-op.

### Trigger → DB latency
Apps Script writes → next 5-min backend poll picks it up → **within 5 minutes**

### Frequency
- Apps Script writes: up to 5× per day (one per trigger)
- Backend reads tail: every 5 minutes (288× per day)
- New data lands in DB: once per trading day, within 5 min of Apps Script firing

---

## Sheet 2 — "Nifty Multi Asset" (1 index)

### Index tracked
Nifty Multi Asset — Equity : Arbitrage : REITs/InvITs (50:40:10)

### Data source
NSE email: `indices@nse.co.in` — sends a ZIP attachment daily around **7:30 PM IST**.
ZIP contains a CSV with the closing NAV.

### How it gets written
`benchmark_watcher.py → fetch_nse_benchmark()`:
1. Searches Gmail for emails from `indices@nse.co.in` with subject "Nifty Multi Asset" in last 5 days
2. Downloads the ZIP attachment
3. Parses the CSV inside → extracts date + NAV value
4. Checks if that date is already in DB
5. Upserts to `benchmark_nav`
6. If genuinely new → also appends a row to this sheet tab (audit trail)
7. If already in DB → skips sheet write (no duplicate rows)

### Trigger → DB latency
NSE sends email ~7:30 PM IST → next 5-min Gmail poll downloads and parses it → **within 5 minutes of email arrival**

### Frequency
- NSE sends email: once per trading day (~7:30 PM IST)
- Backend checks Gmail: every 5 minutes
- New data lands in DB: once per trading day, within 5 min of email

---

## Sheet 3 — "CRISIL Composite" (1 index)

### Index tracked
CRISIL Composite Bond Index

### Data source
CRISIL email: `Crisil.Indices@crisil.com` — sends an Excel attachment at
variable times (not always daily, sometimes batched).
The Excel contains **full historical data** (not just one row).

### How it gets written
`benchmark_watcher.py → fetch_crisil_benchmark()`:
1. Searches Gmail for emails from `Crisil.Indices@crisil.com` with subject "CRISIL Indices" in last 5 days
2. Downloads the Excel attachment from the **most recent email only** (it has full history)
3. Parses all rows → gets full date+value history
4. Checks what's already in DB (latest date)
5. Upserts all rows to `benchmark_nav` (dedup handles re-writes)
6. Only rows newer than DB's latest → appended to sheet tab
7. No new rows → skips sheet write

### Trigger → DB latency
CRISIL sends email (variable time) → next 5-min Gmail poll processes it → **within 5 minutes of email arrival**

### Frequency
- CRISIL sends email: variable (not strictly daily)
- Backend checks Gmail: every 5 minutes
- New data lands in DB: within 5 min of email arrival

---

## The Database — `benchmark_nav`

Single table, one row per (date, index) pair.

```sql
CREATE TABLE benchmark_nav (
    id         SERIAL PRIMARY KEY,
    nav_date   DATE NOT NULL,
    index_name VARCHAR(200) NOT NULL,
    value      NUMERIC(18,4) NOT NULL,
    UNIQUE (nav_date, index_name)
);
```

| Column     | Description                              |
|------------|------------------------------------------|
| nav_date   | Trading date                             |
| index_name | Canonical index name (see name map below)|
| value      | Closing index value                      |

### Current state (as of Aug 2026)
- **12 indices** tracked
- **47,171+ rows** total
- Historical data loaded via one-time `POST /api/benchmarks/load-history`

### Index name canonicalisation
Raw sheet headers and email content are mapped to clean canonical names
via `INDEX_NAME_MAP` in `benchmark_sheet_service.py`. For example:
`"Nifty Multi Asset - Equity : Arbitrage : REITs/InvITs (50:40:10) Index"`
→ `"Nifty Multi Asset 50:40:10"`

---

## The Poll Loop — `gmail_poll_loop()` in `main.py`

Runs as an `asyncio` background task from server startup. Never stops.

```
Server starts
     │
     ▼
Every 5 minutes:
     │
     ├── fetch_latest()                    ← Morningstar daily Excel (fund data)
     │       └── on new data: append_daily_nav()
     │
     └── fetch_all_benchmarks()            ← All 3 benchmark sources
             ├── fetch_nse_benchmark()     ← Gmail → ZIP → parse → DB + sheet
             ├── fetch_crisil_benchmark()  ← Gmail → Excel → parse → DB + sheet
             └── sync_nifty_indices_from_sheet()  ← Sheet tail → DB (NEW)
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/benchmarks/indices` | List all 12 indices with row counts and date ranges |
| `GET /api/benchmarks/nav-history?index=X&from_date=Y&to_date=Z` | Full NAV time series for one index |
| `GET /api/benchmarks/latest?index=X` | Most recent value for one index |
| `POST /api/benchmarks/sync` | Manually trigger `fetch_all_benchmarks()` in background |
| `POST /api/benchmarks/load-history` | One-time historical load from all sheet tabs (already done) |
| `GET /api/benchmarks/load-status` | Check if historical load completed |

---

## Deduplication Strategy

All three sources use the same pattern — **DB-first, stateless dedup**:

- `benchmark_nav` has a `UNIQUE (nav_date, index_name)` constraint
- Every upsert uses `ON CONFLICT DO UPDATE SET value = EXCLUDED.value`
- No "already processed" flags anywhere — safe to re-run any poll at any time
- Sheet writes are gated by a date check (don't write if date already in sheet)
- Self-healing: delete any row from DB → it re-appears within 5 minutes

---

## Data Flow Summary

```
Yahoo Finance ──► Apps Script (5×/day) ──► Sheet: Nifty Indices
                                                    │
                                           Backend reads tail every 5 min
                                                    │
                                                    ▼
NSE Email (7:30 PM IST) ────────────────► Sheet: Nifty Multi Asset
       │                                            │
       └──► Backend parses on Gmail poll            │
                                                    │
CRISIL Email (variable) ────────────────► Sheet: CRISIL Composite
       │                                            │
       └──► Backend parses on Gmail poll            │
                                                    │
                                                    ▼
                                         ┌─────────────────┐
                                         │  benchmark_nav  │
                                         │  PostgreSQL DB  │
                                         │  12 indices     │
                                         │  47K+ rows      │
                                         └─────────────────┘
                                                    │
                                         ┌──────────┴──────────┐
                                         │   /api/benchmarks/  │
                                         │   nav-history etc.  │
                                         └─────────────────────┘
```