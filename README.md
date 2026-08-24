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
| **Backend** | FastAPI (Python 3.11) | Render Standard plan — 2GB RAM, 1 CPU, always-on. `WEB_CONCURRENCY=2` (2 uvicorn workers). |
| **Database** | PostgreSQL via SQLAlchemy ORM | Render Basic plan — 1GB RAM, 0.5 CPU, 5GB storage, always-on. |
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

### ✅ Nifty Indices daily DB sync (live)
Apps Script writes to the "Nifty Indices" sheet tab daily via Yahoo Finance. The 5-minute Gmail poll loop calls `sync_nifty_indices_from_sheet()` inside `fetch_all_benchmarks()` every poll cycle, reading the last 20 rows and upserting to `benchmark_nav`. Verified live Aug 2026 — all 12 indices current.

---

## Project Structure

```
buglerock-analytics/
├── frontend/
│   └── src/
│       └── components/
│           ├── FundExplorer/          # Fund browsing, filtering, search
│           ├── FundDetail/            # Individual fund deep dive
│           ├── PeerComparison/        # CompareFunds.jsx — up to 4 funds
│           ├── StockExposure/         # Stock Exposure Finder tab
│           ├── RetirementPlanner/     # Retirement Planner tab (Monte Carlo)
│           │   ├── RetirementPlanner.jsx
│           │   ├── rtEngine.js        # Monte Carlo engine
│           │   ├── rtReport.js        # 8-section report builder
│           │   └── RetirementPlanner.css
│           ├── Simulator/             # SIP Simulator (under CALCULATE nav section)
│           ├── RollingAnalytics/      # Rolling CAGR analytics (under CALCULATE nav section)
│           ├── ModelPortfolios/       # BugleRock multi-asset model portfolios
│           ├── Watchlist/             # Fund watchlist with card/table/compare views
│           └── PortfolioBuilder/      # 6-step portfolio workflow
│               ├── PortfolioBuilder.jsx
│               └── steps/
│                   ├── ClientIPS.jsx
│                   ├── FundSearch.jsx
│                   ├── BuildPortfolio.jsx
│                   ├── Analyse.jsx            # Analytics suite
│                   ├── analyseTabs/
│                   │   └── PortfolioXRay.jsx  # Comprehensive tear sheet
│                   ├── Optimise.jsx
│                   ├── Compare.jsx
│                   └── PDFProposal.jsx
│
└── backend/
    ├── main.py
    ├── routers/
    │   ├── funds.py
    │   ├── home.py
    │   ├── nav.py
    │   ├── holdings.py
    │   ├── benchmarks.py
    │   ├── models.py
    │   ├── optimise.py
    │   ├── gmail.py
    │   └── proposal.py
    └── services/
        ├── parser.py
        ├── db_service.py
        ├── morningstar_service.py
        ├── nav_fetcher.py
        ├── benchmark_db_service.py
        └── optimiser.py
```

---

## Database Models

### `DailyFundData`
One row per fund per data date. Includes: ISIN, name, category, asset_class, NAV, returns, risk metrics, cap allocation, expense ratio, AUM, rating, `branding_name`.

### `benchmark_nav`
Daily NAV time series for CRISIL/NSE indices. 47K+ rows.

### `FundHolding` (Render only)
Individual stock-level holdings per fund from Morningstar `NewPortfolioApi`. Uses Full Holdings V2 (up to 99,999 holdings per fund) with fallback to Top 25.

### `FundPortfolioStats` (Render only)
Fund-level portfolio stats — asset allocation, market cap breakdown, sector weights, PE/PB.

---

## Key Features

### Navbar Structure
- **DISCOVER** — Fund Explorer, Watchlist, Stock Exposure
- **ANALYSE** — Fund Detail, Compare Funds, Peer Group Analytics
- **BUILD** — Portfolio Builder, Model Portfolios, Retirement Planner
- **CALCULATE** — SIP Simulator, Rolling Analytics
- Sidebar scrollable when items overflow (small/zoomed screens)

### Fund Explorer
- Category shown on watchlist card uses fund's own `category` field, NOT the sidebar filter category
- Back button on Fund Detail uses `navigate(-1)` — returns to wherever user came from

### Watchlist
- Category displayed from live snapshot (`f?.category`) with localStorage fallback
- Add-to-watchlist saves fund's own category, not selected sidebar filter

### Compare Funds (`/PeerComparison/CompareFunds.jsx`)
- 5 sub-tabs: Returns, Risk metrics, Composition, Sectoral exposure, Fund info, Overlap
- **Sectoral exposure** — fetches `stats.sector_breakdown` from `/api/holdings/{isin}` for each fund
- **Overlap tab** — Export Overlap Report PDF button (same format as Portfolio Builder)
- PDF uses `shortFundName()` for display names

### Model Portfolios (`/ModelPortfolios/`)

Five solver-constructed portfolios (Conservative → Aggressive) built from R1/R2 ranked funds only using HiGHS LP solver. Portfolio detail panel has two action buttons:

#### 🔬 View Portfolio X-Ray (modal overlay)
Full-screen modal reusing `PortfolioXRay` directly. On open fires three API calls in parallel:
- `GET /api/nav/stress-test?isins=...&weights=...`
- `GET /api/holdings/historical-var?isins=...&weights=...&categories=...&asset_classes=...&std_devs=...`
- `GET /api/holdings/overlap?isins=...` (auto-triggers `/api/holdings/fetch/{isin}` POST for missing funds, polls 30×2s)

Results keyed by `portfolio.key` — switching portfolios resets and re-fetches, reopening same portfolio reuses cached state. Modal subtitle shows live status ("Fetching holdings data…" / "Computing VaR…"). Modal positioned below 60px app header (`padding-top: 76px`, `align-items: flex-start`).

#### 📄 Generate PDF (modal overlay)
Reuses `PDFProposal` directly via `buildPDFProps()` adapter. Produces identical section-picker and multi-page HTML PDF as Portfolio Builder. If X-Ray was opened first, `stressData` and `overlapData` are passed through automatically.

#### Backend (`models.py`) — blended fields
`_get_funds` SQL and `blended{}` now include:
`return_1m · return_3m · return_6m · return_ytd · return_cy2021–cy2025 · sortino_3y · beta_3y · up_capture_3y · down_capture_3y`
(previously only `return_1y/3y/5y`, `sharpe_3y`, `alpha_3y`, `std_dev_3y/5y`, `expense_ratio`)

### Simulator (`/Simulator/`)
- SIP / Lumpsum backtest using actual NAV history
- **localStorage cache** (`sim_cache_v1`): persists `fund`, `mode`, `amount`, `startDate`, `endDate`, `sipDate`
- On mount: if valid saved inputs exist, auto re-runs the API and restores result
- Navigating away and back fully restores state

### Rolling Analytics (`/RollingAnalytics/`)
- Daily rolling CAGR distribution with stats (avg, median, best, worst, % positive, % > 12%, std dev)
- **localStorage cache** (`rolling_cache_v1`): persists `fund`, `rollingYears`, `startDate`, `endDate`
- On mount: if valid saved inputs exist, auto re-runs and restores result

### Portfolio Builder — Analyse Tab
Tab groups: `Portfolio X-Ray | Overview · Returns & projections · Risk metrics | Correlation · Overlap · Style & drift | Stress test · Sensitivity · What-If | Fund details`

**Returns & projections tab** includes (in order):
1. Return pills
2. Return contribution per fund table
3. Lump sum projection
4. SIP projection
5. Growth projection
6. Rolling returns consistency table

**Performance caching** — tab switch no longer triggers refetch for same portfolio:
| Tab | Cache key |
|---|---|
| Stress test | `isins + weights` |
| Rolling returns | `isins + weights` |
| Overlap | `equity fund isins` |
| Correlation | `isins` |

**What-If tab**:
- Fund substitution: up to 3 swaps, R1/R2 candidates + per-swap search, 8 delta metrics, persisted to localStorage
- Allocation shift: Option D (only pure equity/debt scaled, hybrids unchanged), trade-off chart, Apply+Revert buttons persisted to localStorage
- Growth projection moved to Returns tab

**Portfolio X-Ray — Stress section**:
- Fetched when X-Ray tab opens (same trigger as Stress Test tab)
- Shows real NAV-based returns: Portfolio, Nifty 500, Blended BM
- Falls back to "Computing..." message while loading
- Footnote: "Returns calculated from actual NAV history. '—' means fund not active or NAV unavailable."

### Retirement Planner
- **Canonical file:** 425 lines — `RetirementPlanner.jsx` stored in session Aug 2026
- `Field` component at module level (fixes focus/cursor loss on keystroke)
- `type="text"` with `inputMode="decimal"` (fixes leading zero bug)
- Chip nav scrolls to sections via `id="rt-section-{code}"`
- `retAge < age` validation — allows already-retired clients (retAge = currentAge)
- Goals/lumps stored as raw strings, parsed to numbers in `collectInputs`
- P10 corpus clamped to `—` after depletion in cashflow table
- Single column layout for goals/inflows rows

### Fund Detail
- Period toggle (1Y/3Y/5Y) — `rk()` returns null for missing periods (no 3Y fallback)
- Toggle stays visible even when selected period has no data — shows "No Xy data — select shorter period"

### Build Portfolio
- Weight warning: red background + bold message when weights exceed 100%

### Optimise Tab
- Runs **all three portfolios simultaneously** (Max Sharpe · Min Volatility · Max Return) on a single "Run optimisation" click
- Optimisation Objective dropdown **removed** — it was redundant since all three are always computed

---

## Analytics Rules (uniform across all tabs and PDF)

All verdict thresholds are consistent between `PortfolioXRay.jsx`, `Analyse.jsx`, and `PDFProposal.jsx`.

### Overlap — 5-tier scale
| Range | Label | Colour |
|---|---|---|
| < 5% | Negligible | Grey |
| 5–15% | Low | Green |
| 15–25% | Moderate | Amber `#F39C12` |
| 25–35% | High | Orange `#E67E22` |
| ≥ 35% | Very High | Red `#C0392B` |

Applies to: average overlap between any two holdings, and highest overlapping pair.

### Sharpe ratio
`> 0.7` Strong · `> 0.4` Adequate · else Weak

### Alpha
`> 2` Outperforming · `> 0` Positive · else Lagging

### Beta
`< 0.8` Defensive · `< 1.1` Market-like · else Aggressive

### Down capture
`< 90` Protected · `< 100` Moderate (amber) · else Exposed

---

## Stress Test Scenarios

Four scenarios active (Global Financial Crisis and European Sovereign Debt Crisis removed):

| ID | Name | Period |
|---|---|---|
| `china` | China Slowdown & Yuan Devaluation | Mar 2015 – Feb 2016 |
| `ilfs` | IL&FS / NBFC Credit Crisis | Aug 2018 – Oct 2018 |
| `covid` | Covid-19 Crash | Jan 2020 – Mar 2020 |
| `fiirerating` | FII-Driven Rerating | Sep 2024 – Mar 2026 |

Defined in `STRESS_SCENARIOS` list in `backend/routers/nav.py`.

---

## PDF Proposal — Stress Section

**Columns:** Scenario · Period · Portfolio · Nifty 500 · [Blended BM — only if `bmStress` available] · Cushion vs [Blended BM or Nifty 500]

Column count is dynamic: 4 columns when no IPS benchmark, 5 when blended BM is present. `bmStress` is destructured from `analyseData` prop.

---

## VaR / ES (`holdings.py`)

All four output values (`var_95`, `es_95`, `var_99`, `es_99`) clamped to `max(0.0, value)` before serialisation. Negative VaR (positive tail return) is mathematically valid but meaningless as a risk display and caused a `--0.6%` double-negative bug at 1Y horizon.

---

## Asset Class Classification

Single source of truth: `blendAssetClass()` in `Analyse.jsx`.

| Fund type | Classified as |
|---|---|
| Gold ETF, Silver ETF, Gold/Silver FoF | Commodities |
| Debt, Bond, Liquid, Gilt, Money Market | Debt |
| Hybrid / Multi-asset | Split by equity_pct / bond_pct |
| Equity, Index, Passive ETF | Equity |
| REITs, convertibles, preferred | REITs/Other |

**Allocation shift (What-If):** Pure equity = equity_pct ≥ 80%, pure debt = bond_pct ≥ 80%. Hybrids unchanged. Shift limit = min(pureEqW, pureDebtW, 30pp).

---

## Overlap Analysis

Excluded: all debt categories, precious metals, India OE.
API limit: 20 funds maximum.

---

## Deployment

### Frontend (Vercel)
Push to `main` → auto-builds and deploys (~90 sec).

### Backend (Render)
Push to `main` → auto-deploys (~3 min). On startup: DB migrations → Gmail poll loop + NAV cron + holdings cron.

If the backend cannot resolve external hostnames (PostgreSQL, Gmail, Google APIs) — `Name or service not known` / `getaddrinfo failed` — this is a **Render infrastructure/DNS issue, not a code bug**. Check [status.render.com](https://status.render.com) and trigger a manual redeploy from the Render dashboard.

---

## Holdings Data

### Two independent pipelines
| | Daily Excel | Holdings API |
|---|---|---|
| Source | Morningstar email | Morningstar REST API |
| Frequency | Every trading day (auto) | Daily at 6AM (staleness check) |
| Tables | `DailyFundData` | `FundHolding`, `FundPortfolioStats` |

Full Holdings V2 used when available (up to 99,999 holdings). Falls back to Top 25 if V2 unavailable.

---

## Pending Features

1. **User auth** — Google OAuth login, per-user saved portfolios and watchlists
2. **Portfolio NAV series** — actual drawdown/ulcer/recovery from computed portfolio daily returns
3. **Cost basis (WACB)** — Retirement Planner LTCG tax calculation
4. **Model Portfolio presets** — Pre-fill Retirement Planner from real blended returns
5. **Old Cloud project cleanup** — Shut down tejas.s@buglerock.asia project
6. **CY 2026 column** — add to calendar year chart when year completes (do not add before year-end)

---

## Output Files (always use these, not repo)

| File | Deploy to |
|---|---|
| `Analyse.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `PortfolioXRay.jsx` | `frontend/src/components/PortfolioBuilder/steps/analyseTabs/` |
| `BuildPortfolio.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `PortfolioBuilder.jsx` | `frontend/src/components/PortfolioBuilder/` |
| `ClientIPS.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `PDFProposal.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `Optimise.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `FundExplorer.jsx` | `frontend/src/components/FundExplorer/` |
| `FundDetail.jsx` | `frontend/src/components/FundDetail/` |
| `CompareFunds.jsx` | `frontend/src/components/PeerComparison/` |
| `Watchlist.jsx` | `frontend/src/components/Watchlist/` |
| `Navbar.jsx` | `frontend/src/components/Layout/` |
| `Navbar.css` | `frontend/src/components/Layout/` |
| `ModelPortfolios.jsx` | `frontend/src/components/ModelPortfolios/` |
| `ModelPortfolios.css` | `frontend/src/components/ModelPortfolios/` |
| `Simulator.jsx` | `frontend/src/components/Simulator/` |
| `RollingAnalytics.jsx` | `frontend/src/components/RollingAnalytics/` |
| `RetirementPlanner.jsx` | `frontend/src/components/RetirementPlanner/` |
| `RetirementPlanner.css` | `frontend/src/components/RetirementPlanner/` |
| `rtEngine.js` | `frontend/src/components/RetirementPlanner/` |
| `rtReport.js` | `frontend/src/components/RetirementPlanner/` |
| `holdings.py` | `backend/routers/` |
| `benchmarks.py` | `backend/routers/` |
| `nav.py` | `backend/routers/` |
| `models.py` | `backend/routers/` |
| `db_service.py` | `backend/services/` |
| `benchmark_db_service.py` | `backend/services/` |
| `parser.py` | `backend/services/` |

---

- PPT export is built but hidden (`display:none`) — to be enabled when ready