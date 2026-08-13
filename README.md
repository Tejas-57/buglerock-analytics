# BugleRock Analytics

AI-native investment analytics platform for BugleRock Capital. Enables wealth managers to research mutual funds, build client portfolios, run risk/performance analysis, optimise allocations, and generate branded client proposals — all in one workflow.

---

## 🔴 Developer Rules — Read Before Every Session

These rules apply to every Claude session working on this project. No exceptions.

### 1. Full files only
When making any change to a file, always output the **complete file** — never diffs, never partial snippets, never "replace lines X–Y". The full file goes to `/mnt/user-data/outputs/` so it can be downloaded and replaced directly.

### 2. No multi-line code in terminal
Never write multi-line Python/bash directly in the terminal (`python3 -c "..."`). Always write debug/test logic to a `.py` file in `/mnt/user-data/outputs/`, present it for download, and ask the user to run it with:
```bash
cd buglerock-analytics/backend
python <filename>.py
```

### 3. Git commit format
Every change must end with a git commit command in this exact format:
```bash
git add -A && git commit -m "<type>(<scope>): <description>" && git push origin main
```
Types: `feat`, `fix`, `docs`, `refactor`, `chore`. Example:
```bash
git add -A && git commit -m "fix(models): correct bond_pct zero fallback for debt funds" && git push origin main
```

### 4. Session prompt — ask at the start of every new chat
When a new chat begins, ask:
> *"Should I read the transcript from the last session before we start? Also — are we continuing an existing feature or starting something new?"*

Then read `/mnt/transcripts/` for the relevant session transcript before making any changes.

### 5. Suggest README updates proactively
Whenever something new is built, discovered, or decided that future sessions need to know — suggest adding it to the README immediately. Say: *"This is worth noting in the README — want me to add it?"*

---

## Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | React (Create React App) | Deployed on Vercel — BugleRock work account |
| **Backend** | FastAPI (Python 3.11) | Deployed on Render — BugleRock work account |
| **Database** | PostgreSQL via SQLAlchemy ORM | Render Basic-1GB plan, 5GB storage |
| **Data Source** | Morningstar daily Excel | Delivered via Gmail API, auto-parsed on arrival |
| **Auth / Secrets** | Gmail OAuth 2.0 | Token stored in PostgreSQL `settings` table |

**Repo:** https://github.com/Tejas-57/buglerock-analytics  
**Frontend (live):** https://buglerock-analytics-plum.vercel.app  
**Backend (live):** https://buglerock-analytics-ew17.onrender.com

### Useful backend URLs
| Purpose | URL |
|---|---|
| API health check | https://buglerock-analytics-ew17.onrender.com/api/status |
| Model portfolios | https://buglerock-analytics-ew17.onrender.com/api/models/portfolios |
| Model portfolio debug | https://buglerock-analytics-ew17.onrender.com/api/models/debug |
| Holdings fetch status | https://buglerock-analytics-ew17.onrender.com/api/holdings/admin/fetch-status |
| Holdings fetch progress | https://buglerock-analytics-ew17.onrender.com/api/holdings/admin/fetch-progress |
| Accesscode status | https://buglerock-analytics-ew17.onrender.com/api/holdings/admin/accesscode-status |
| Fetch single fund holdings | https://buglerock-analytics-ew17.onrender.com/api/holdings/fetch/{isin} (POST) |
| Fetch all holdings | https://buglerock-analytics-ew17.onrender.com/api/holdings/fetch-universe (POST) |
| Trigger Gmail fetch | https://buglerock-analytics-ew17.onrender.com/api/funds/fetch?date=YYYY-MM-DD |
| Debug Gmail search | https://buglerock-analytics-ew17.onrender.com/api/funds/debug-gmail?date=YYYY-MM-DD |
| Peer group analytics | https://buglerock-analytics-ew17.onrender.com/api/peer/snapshot |
| Benchmark indices list | https://buglerock-analytics-ew17.onrender.com/api/benchmarks/indices |
| Benchmark NAV history | https://buglerock-analytics-ew17.onrender.com/api/benchmarks/nav-history?index=X |
| Benchmark sync (manual) | https://buglerock-analytics-ew17.onrender.com/api/benchmarks/sync (POST) |
| Benchmark load status | https://buglerock-analytics-ew17.onrender.com/api/benchmarks/load-status |
| Portfolio look-through | https://buglerock-analytics-ew17.onrender.com/api/holdings/portfolio-lookthrough?isins=X&weights=Y |
| FastAPI docs | https://buglerock-analytics-ew17.onrender.com/docs |

---

## Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (local) or use Render DB connection string

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # Mac/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm start                      # Runs on http://localhost:3000
```

### Environment Variables

**Backend** — create `backend/.env` or set in Render dashboard:
```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=...
GMAIL_TOKEN_JSON=...           # Stored in DB automatically after first OAuth flow
BENCHMARK_SHEET_ID=1g_-yQIVu4Ror0BgBhW2Pex3Fj3uP_0meZHrpwJQ5qWA
GOOGLE_SERVICE_ACCOUNT_JSON=...  # Full JSON of sheets_credentials.json (single line)
```

**Frontend** — create `frontend/.env.local`:
```env
REACT_APP_API_URL=http://localhost:8000
```

---

## Data Pipeline

Morningstar emails a daily Excel file (`New_Singlesheet_Daily_MF_Report_DDMMYYYY.xlsx`) to a monitored Gmail inbox.

### How it works
1. Backend polls Gmail every **5 minutes** and immediately on startup
2. Searches: `from:sujaya.l@alerts-morningstar.com subject:New Singlesheet Daily MF Report`
3. Downloads the `.xlsx` attachment
4. Parses all sheets into `DailyFundData` and `BenchmarkData` tables
5. `data_date` = most common `Return Date (Daily)` across all parsed funds — dynamically handles x-1, x-2, x-3 for market holidays

### Sheets parsed
| Sheet | Asset Class |
|---|---|
| Equity | Equity (active) |
| Equity Index & FoF | Equity Index, Passive FoFs |
| Equity ETF | ETF — Equity, Precious Metals ETF |
| Hybrid | Hybrid / Multi-asset |
| SIF | Specialised Investment Funds |
| Debt | Debt (active) |
| Debt ETF | ETF — Debt |
| International | International / Global funds |

### Manual trigger (if email missed or for recovery)
```
GET /api/funds/fetch?date=YYYY-MM-DD
```
⚠️ Returns `success: true` if data already in DB for that date (no re-fetch needed). Use the **data date** (not email arrival date). Email arrives next day but fetch endpoint accepts the data date directly.

### Debug Gmail search
```
GET /api/funds/debug-gmail?date=YYYY-MM-DD
```

---

## Gmail — Google Cloud Project

**IMPORTANT:** Gmail API is now under a new Google Cloud project.

| Item | Value |
|---|---|
| Google account | analytics@buglerock.asia |
| Project name | BugleRock Analytics |
| Project ID | buglerock-analytics |
| APIs enabled | Gmail API, Google Sheets API |
| OAuth client | Desktop app type |
| Service account | benchmark-bot@buglerock-analytics-505208.iam.gserviceaccount.com |

**Credential files on Render (Secret Files):**
- `/etc/secrets/gmail_credentials.json` — OAuth client credentials
- `/etc/secrets/gmail_token.json` — OAuth access+refresh token
- `/etc/secrets/sheets_credentials.json` — Service account JSON for Sheets API

**Token management:**
- Token stored in DB (`settings` table, key `gmail_token`)
- To push new token to DB after regenerating: `POST /api/gmail/store-token`
- To regenerate token locally: run `backend/generate_gmail_token.py`

---

## Benchmark NAV Pipeline

Daily closing NAV for CRISIL and NSE indices, stored in `benchmark_nav` table.

### Google Sheet
**Sheet ID:** `1g_-yQIVu4Ror0BgBhW2Pex3Fj3uP_0meZHrpwJQ5qWA` (analytics@buglerock.asia)

| Tab | Source | Method |
|---|---|---|
| Nifty Indices | Yahoo Finance via Apps Script | Auto-fetched daily by Apps Script triggers (5 triggers: 7PM, 9PM, 11PM, 1AM, 5AM IST) |
| Nifty Multi Asset | NSE email (indices@nse.co.in) | Backend parses ZIP → appends 1 row daily |
| CRISIL Composite | CRISIL email (Crisil.Indices@crisil.com) | Backend parses Excel → appends new rows |

### Apps Script (Nifty Indices)
- File: `NiftyIndexFetcher.gs` (in Google Sheet Extensions → Apps Script)
- All 10 tickers working via Yahoo Finance crumb authentication
- Retry logic: fills blank cells on subsequent trigger runs
- `testAllTickers()` — verify all tickers work
- `backfillMissingDates()` — fill historical gaps
- `fillAllBlanks()` — fill blank cells in rows from 2026-07-30 onwards only

### Database table
```sql
benchmark_nav (
  nav_date   DATE,
  index_name VARCHAR(200),
  value      NUMERIC(18,4),
  UNIQUE (nav_date, index_name)
)
```
47,171 rows loaded (as of Aug 2026) across 12 indices.

### Design principles
- **Stateless watcher** — no settings flags. Every 5-min poll searches Gmail, DB upsert handles dedup
- **DB-first** — checks DB before writing to sheet. Sheet write only when genuinely new data (avoids Google Sheets 429 rate limit)
- **Self-healing** — delete any DB row → restored within 5 minutes. Delete sheet row → manual sync needed
- **Historical load is one-time** — `POST /api/benchmarks/load-history` runs in background, not on startup

### Manual operations
```bash
# Trigger email fetch (NSE + CRISIL) — runs in background
curl -X POST https://buglerock-analytics-ew17.onrender.com/api/benchmarks/sync

# Check historical load status
curl https://buglerock-analytics-ew17.onrender.com/api/benchmarks/load-status

# Query nav history
curl "https://buglerock-analytics-ew17.onrender.com/api/benchmarks/nav-history?index=Nifty%2050&from_date=2024-01-01"
```

### ⚠️ Pending: Nifty Indices daily DB sync
Apps Script writes to the sheet daily but the DB is NOT updated daily for the 10 Nifty index columns. Need a daily cron that reads last N rows from "Nifty Indices" sheet tab and upserts to DB.

---

## Project Structure

```
buglerock-analytics/
├── frontend/
│   └── src/
│       └── components/
│           ├── FundExplorer/          # Fund browsing, filtering, search
│           ├── FundDetail/            # Individual fund deep dive
│           ├── StockExposure/         # Stock Exposure Finder tab
│           ├── RetirementPlanner/     # Retirement Planner tab (Monte Carlo)
│           │   ├── RetirementPlanner.jsx
│           │   ├── rtEngine.js        # Monte Carlo engine
│           │   ├── rtReport.js        # 8-section report builder
│           │   └── RetirementPlanner.css
│           ├── ModelPortfolios/       # BugleRock multi-asset model portfolios
│           └── PortfolioBuilder/      # 6-step portfolio workflow
│               ├── PortfolioBuilder.jsx
│               └── steps/
│                   ├── ClientIPS.jsx
│                   ├── FundSearch.jsx
│                   ├── BuildPortfolio.jsx
│                   ├── Analyse.jsx            # Step 4: analytics suite
│                   ├── analyseTabs/           # New modular analyse tabs
│                   │   ├── AIDoctor.jsx       # Rules-based portfolio diagnostic
│                   │   └── PortfolioXRay.jsx  # Comprehensive tear sheet
│                   ├── Optimise.jsx
│                   ├── Compare.jsx
│                   └── PDFProposal.jsx
│
└── backend/
    ├── main.py                        # FastAPI app, startup, Gmail poll loop
    ├── generate_gmail_token.py        # Run once to generate gmail_token.json
    ├── routers/
    │   ├── funds.py                   # /api/funds
    │   ├── home.py                    # /api/home
    │   ├── nav.py                     # /api/nav
    │   ├── holdings.py                # /api/holdings (overlap, stock-exposure, portfolio-lookthrough)
    │   ├── performance.py             # /api/performance
    │   ├── peer.py                    # /api/peer
    │   ├── benchmarks.py             # /api/benchmarks (fund benchmarks + NAV time series)
    │   ├── models.py                  # /api/models (model portfolios LP solver)
    │   ├── optimise.py                # /api/optimise
    │   ├── gmail.py                   # /api/gmail (store-token, reparse)
    │   └── proposal.py                # /api/proposal
    ├── services/
    │   ├── parser.py                  # Excel → PostgreSQL parser
    │   ├── gmail_watcher.py           # Gmail OAuth + MF email fetch logic
    │   ├── benchmark_watcher.py       # Gmail poller for NSE + CRISIL benchmark emails
    │   ├── benchmark_sheet_service.py # Google Sheets read/write via service account
    │   ├── benchmark_parser.py        # Parses NSE ZIP + CRISIL Excel attachments
    │   ├── benchmark_db_service.py    # benchmark_nav table CRUD
    │   ├── db_service.py              # DB query functions
    │   ├── morningstar_service.py     # Morningstar API (holdings, AMC names)
    │   ├── nav_fetcher.py             # NAV history (Morningstar primary, mfapi fallback)
    │   └── optimiser.py              # Monte Carlo optimiser
    └── models/
        └── database.py               # SQLAlchemy models
```

---

## Database Models

### `DailyFundData`
One row per fund per data date. Includes: ISIN, name, category, asset_class, NAV, returns, risk metrics, cap allocation, expense ratio, AUM, rating, `branding_name` (AMC short name from Morningstar).

### `BenchmarkData`
Benchmark performance by date from Morningstar Excel.

### `benchmark_nav`
Daily NAV time series for CRISIL/NSE indices. 47K+ rows. Queried for benchmark charts and rolling returns.

### `EmailFetchLog`
Tracks which MF emails have been processed.

### `FundHolding` (Render only)
Individual stock-level holdings per fund from Morningstar `NewPortfolioApi`.

### `FundPortfolioStats` (Render only)
Fund-level portfolio stats — asset allocation, market cap breakdown, sector weights, PE/PB.

---

## Key Features

### Fund Explorer
2,000+ mutual funds. Filter by asset class, category. Sort by return. Search by name/AMC/ISIN. Whitelisted (R1/R2) filter.

### Stock Exposure Finder
Search any stock → see all funds holding it with weights, AUM exposure, AMC breakdown. Uses real Morningstar holdings data. ISIN-first deduplication handles name variants.

### Retirement Planner
Monte Carlo retirement planning tool.
- **Engine:** Box-Muller normal distribution, 5,000 simulations main, 1,000/scenario for sensitivity
- **Inputs:** 7 sections (personal, corpus/SIP, EPF/NPS, inflows, goals, income, assumptions)
- **Outputs:** Success rate, verdict, 8-section inline report + printable PDF
- **Persistence:** localStorage — survives hard refresh, only resets on Reset button
- **Feasibility threshold:** 1.25× median corpus vs inflated goal
- **Pending:** Cost basis (WACB) tax calculation, Model Portfolio presets for Section G

### Portfolio Builder — Analyse Tab
Tab order: AI Doctor → Portfolio X-Ray → Overview → Returns → Risk → Exposure → Correlation → Overlap → Rolling → Stress → Style & Drift → Fund Details

**AI Doctor** — Rules-based diagnostic. 10 checks. 0–100 health score. Symptom cards with prescriptions. Confirmed strengths. Uses real Morningstar overlap data.

**Portfolio X-Ray** — Comprehensive tear sheet. 7 sections. Real sector look-through and top 10 companies via `/api/holdings/portfolio-lookthrough`. Parametric tail risk estimates.

**Pending tabs:** Sensitivity, What-If

### Model Portfolios
See `MODEL_PORTFOLIOS_RULEBOOK.md` for full documentation.

---

## Asset Class Classification

Single source of truth: `blendAssetClass()` function in `Analyse.jsx`.

| Fund type | Classified as |
|---|---|
| Gold ETF, Silver ETF, Gold/Silver FoF | Commodities |
| Debt, Bond, Liquid, Gilt, Money Market | Debt |
| Hybrid / Multi-asset | Split by equity_pct / bond_pct |
| Equity, Index, Passive ETF | Equity |
| REITs, convertibles, preferred | REITs/Other |

---

## Overlap Analysis

Excluded from overlap: all debt categories, precious metals, India OE.
API limit: 20 funds maximum.

---

## Deployment

### Frontend (Vercel)
Push to `main` → auto-builds and deploys.

### Backend (Render)
Push to `main` → auto-deploys (~3 minutes). On startup: runs DB migrations → seeds accesscode → launches Gmail poll loop (MF + benchmark emails) + NAV cron + holdings cron.

---

## Holdings Data

### Two independent pipelines
| | Daily Excel | Holdings API |
|---|---|---|
| Source | Morningstar email | Morningstar REST API |
| Frequency | Every trading day (auto) | Daily at 6AM (staleness check) |
| Tables | `DailyFundData` | `FundHolding`, `FundPortfolioStats` |

### Staleness check
Runs daily at 6AM. Finds most recent `portfolio_date` across all funds. Re-fetches only funds where `portfolio_date < latest_known_date`.

### Tables only on Render
`fund_holding`, `fund_portfolio_stats`, `holdings_fetch_log`, `morningstar_access_code`

---

## Model Portfolios

Constraint-based LP solver using HiGHS via `scipy.optimize.linprog`. R1/R2 funds only. See `MODEL_PORTFOLIOS_RULEBOOK.md` for full documentation.

### API endpoints
- `GET /api/models/portfolios`
- `GET /api/models/detail?key=balanced`
- `GET /api/models/debug`

---

## Pending Features

1. **Nifty Indices daily DB sync** — Apps Script → Sheet daily but DB not updated for 10 Nifty indices
2. **Sensitivity tab** — Portfolio Builder Analyse (HTML ref lines 10540–10828)
3. **What-If tab** — Portfolio Builder Analyse (HTML ref lines 10829–10965)
4. **Cost basis (WACB) tax** — Retirement Planner proper LTCG tax calculation
5. **Model Portfolio presets** — Pre-fill Retirement Planner Section G from real blended returns
6. **Old Cloud project cleanup** — Shut down tejas.s@buglerock.asia project

---

- PPT export is built but hidden (`display:none`) — to be enabled when ready
- `backend/utils/trading_calendar.py` is deprecated and safe to delete