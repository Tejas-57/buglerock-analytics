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
⚠️ Use the **email arrival date**, not the data date. Email for 21 July data arrives on 22 July.

### Debug Gmail search
```
GET /api/funds/debug-gmail?date=YYYY-MM-DD
```

---

## Project Structure

```
buglerock-analytics/
├── frontend/
│   └── src/
│       └── components/
│           ├── FundExplorer/          # Fund browsing, filtering, search
│           │   └── FundExplorer.jsx
│           ├── FundDetail/            # Individual fund deep dive
│           └── PortfolioBuilder/      # 6-step portfolio workflow
│               ├── PortfolioBuilder.jsx
│               └── steps/
│                   ├── ClientIPS.jsx          # Step 1: Investment Policy Statement
│                   ├── FundSearch.jsx         # Step 2: Select funds
│                   ├── BuildPortfolio.jsx     # Step 3: Assign weights
│                   ├── Analyse.jsx            # Step 4: Full analytics suite
│                   ├── Optimise.jsx           # Step 5: Monte Carlo optimiser
│                   ├── Compare.jsx            # Step 5b: Original vs optimised
│                   └── PDFProposal.jsx        # Step 6: Client proposal generator
│
└── backend/
    ├── main.py                        # FastAPI app, startup, Gmail poll loop
    ├── routers/
    │   ├── funds.py                   # /api/funds — browse, search, categories
    │   ├── home.py                    # /api/home — fund snapshot
    │   ├── nav.py                     # /api/nav — NAV history, stress test, correlation, rolling
    │   ├── holdings.py                # /api/holdings — overlap matrix
    │   ├── performance.py             # /api/performance — peer comparison
    │   ├── peer.py                    # /api/peer — peer averages
    │   ├── benchmarks.py              # /api/benchmarks — benchmark data
    │   ├── optimise.py                # /api/optimise — Monte Carlo
    │   └── proposal.py                # /api/proposal — PPT export (WIP)
    ├── services/
    │   ├── parser.py                  # Excel → PostgreSQL parser
    │   ├── gmail_watcher.py           # Gmail OAuth + fetch logic
    │   ├── db_service.py              # DB query functions
    │   └── optimiser.py               # Monte Carlo optimiser
    └── models/
        └── database.py                # SQLAlchemy models (PostgreSQL)
```

---

## Database Models

### `DailyFundData`
Stores one row per fund per data date. Fields include: ISIN, name, category, asset_class, NAV, returns (1M/3M/6M/1Y/3Y/5Y/YTD/CY), risk metrics (Sharpe, Alpha, Beta, Sortino, Up/Down capture, Std dev), cap allocation (large/mid/small), equity/bond/cash/other pct, expense ratio, AUM, Morningstar rating, holdings data.

### `BenchmarkData`
Benchmark performance by date. Fields: name, display_name, returns (1M/3M/6M/1Y/3Y/5Y/YTD/CY2021-2025).

### `EmailFetchLog`
Tracks which emails have been processed to prevent duplicate imports.

---

## Key Features

### Fund Explorer
- 2,000+ mutual funds across all asset classes
- Filter by: Active, Passive Index, Passive ETF, Global Funds
- Sub-filters by category (e.g. Large Cap, Nifty 50 ETF, Corporate Bond)
- Sort by 1Y / 3Y return
- Category peer average shown inline
- Search by fund name, AMC, or ISIN

### Portfolio Builder — 6-Step Workflow

**Step 1 — IPS (Investment Policy Statement)**  
Client name, objective, risk profile, investment amount, SIP amount, tenure, target return, benchmark (single or blended), constraints, deployment mode, review frequency, adviser notes.

**Step 2 — Select Funds**  
Search and add funds. Supports up to 20 funds.

**Step 3 — Build Portfolio**  
Assign weights manually. Equal-weight button. Validation that weights sum to 100%.

**Step 4 — Analyse**  
Full analytics across 8 subtabs:
- Returns & Projections — fund-level returns with 1Y/3Y/5Y contribution columns; lump sum and SIP wealth projections vs benchmark
- Risk Metrics — Sharpe, Alpha, Beta, Up/Down capture, Std dev, ER
- Rolling Returns — 3M (avg 1Y), 1Y (avg 3Y), 3Y CAGR (avg 5Y)
- Style & Drift — cap-tier drift vs 60/25/15 neutral mix
- Exposure — asset class allocation vs IPS targets
- Overlap — pairwise stock overlap matrix (active equity funds only, max 20)
- Correlation — 3-year daily NAV correlation matrix
- Stress Test — historical drawdown in 6 market crash scenarios using actual NAV data

**Step 5 — Optimise**  
Monte Carlo simulation across 10,000+ portfolio combinations. Constraints: max fund weight, max passive exposure, max precious metals, min international. Strategies: Max Sharpe, Min Volatility, Max Alpha, Balanced.

**Step 6 — Proposal**  
Generate a branded client-ready PDF proposal with 12 configurable sections. Dynamic pagination — tables split across pages automatically with continuation headers. Overlap and correlation matrices auto-scale by fund count.

---

## Asset Class Classification

Single source of truth: `blendAssetClass()` function used across Analyse, Compare, Optimise, and PDF.

| Fund type | Classified as |
|---|---|
| Gold ETF, Silver ETF, Gold/Silver FoF | Commodities |
| Debt, Bond, Liquid, Gilt, Money Market | Debt |
| Hybrid / Multi-asset | Split by equity_pct / bond_pct |
| Equity, Index, Passive ETF | Equity |
| REITs, convertibles, preferred | REITs/Other |

**Rule:** Raw Morningstar values used as-is. No normalisation. Weights rebased when funds have null data.

---

## Overlap Analysis

Excluded from overlap (hold no equity stocks):
- All debt categories: liquid, overnight, money market, gilt, ultra short, low duration, corporate bond, credit risk, banking & PSU, duration, floater, fixed maturity
- All precious metals: gold ETFs, silver ETFs, gold FoFs, silver FoFs
- India OE (open-end non-equity)
- **API limit: 20 funds maximum**

---

## Benchmark Support

- Single or multiple benchmarks with custom IPS weights
- Blended returns computed per period with weight rebasing for missing data
- Periods with partial benchmark data marked with `~`
- Multi-benchmark displayed as "Blended BM" with footnote showing composition
- All periods covered: 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, CY2021–2025

---

## PDF Proposal

### Sections (configurable via checkbox)
Cover → IPS → Portfolio Overview → Performance → Wealth Projection → Risk Profile → Stress Test → Overlap Matrix → Correlation Matrix → Exposure & Style → Fund Table → Per-Fund Annexure

### Layout Engine
- Pre-calculates content height before rendering
- Fund allocation table paginated dynamically — calculates exact rows per page
- Each overflow page gets a "— continued" header with same spacing
- Asset class + market cap + scorecard always on their own slide
- Stress, overlap, correlation each on their own slide
- Matrices scale cell/font size automatically: ≤5 funds → 74px cells, 14+ funds → 30px cells

### Print CSS
```css
.pg { page-break-before: always; padding-top: 48px }
@page { margin: 8mm 12mm; size: 297mm 210mm }
tr { page-break-inside: avoid }
```

---

## Deployment

### Frontend (Vercel)
Push to `main` → Vercel auto-builds and deploys. No manual steps.

### Backend (Render)
Push to `main` → Render auto-deploys (~3 minutes). On startup the backend immediately fetches the latest Gmail email and begins the 5-minute polling loop.

---

## Holdings Data — Fetch Frequency & Logic

### Two independent data pipelines

| | Daily Excel (DailyFundData) | Holdings API (FundHolding + FundPortfolioStats) |
|---|---|---|
| Source | Morningstar email attachment | Morningstar REST API (`NewPortfolioApi`) |
| Frequency | Every trading day (auto) | Every day at 6AM (staleness check) |
| What it has | Fund-level aggregates (returns, NAV, large_cap%, equity_pct%, risk metrics) | Individual stock holdings + market cap breakdown, sector weights, PE/PB |
| Exists locally? | ✅ Yes (SQLite) | ❌ No (Render/PostgreSQL only) |
| Tables | `DailyFundData`, `BenchmarkData` | `FundHolding`, `FundPortfolioStats` |

### How the daily staleness check works (`refresh_stale_holdings`)

Runs every day at **6:00 AM** via `holdings_monthly_cron()` in `main.py`.

**Logic:**
1. Finds the most recent `portfolio_date` across all funds currently in the DB (e.g. `2026-06-30`)
2. Checks every fund in the universe — if a fund's `portfolio_date < latest_known_date` → it's stale
3. Fetches **only the stale funds** — if 2 out of 1,800 funds have updated data on Morningstar, only those 2 are re-fetched
4. If all funds are up to date → does nothing, exits immediately

**Why daily?**
Morningstar publishes each fund's monthly holdings on different days (typically 10th–25th of the following month, varies per fund). Running daily ensures we pick up each fund's updated holdings the exact day Morningstar publishes them — rather than waiting for a fixed monthly batch.

**Staleness logic detail:**
When Fund A updates to `2026-07-31` and Fund B is still at `2026-06-30`, Fund B gets re-fetched every day until it also publishes July data. This is correct — it keeps retrying stale funds until everything is current.

### Manual triggers
```bash
# Fetch single fund immediately
POST /api/holdings/fetch/{isin}

# Fetch all funds immediately (full universe, ~15 min)
POST /api/holdings/fetch-universe

# Check staleness status
GET /api/holdings/admin/fetch-status
GET /api/holdings/admin/fetch-progress
```

### Holdings data characteristics
- **No history accumulated** — each successful fetch replaces all previous holdings for that ISIN with the latest month's data. DB always holds exactly one month's disclosure per fund.
- **Per-fund error isolation** — if one fund fails, others are not affected. Failed fund retains its previous holdings intact.
- **`large_cap` in DailyFundData** = Giant + Large from Morningstar's 5-tier breakdown (Giant/Large/Mid/Small/Micro). Both are point-in-time, not rolling averages.
- **`FundPortfolioStats.market_cap_breakdown`** = same point-in-time data from the API, just at individual stock level. No historical rolling average available from current API subscription for Indian funds.

### New fund handling
When a new fund appears in the daily email that has never been fetched before, `fetch_holdings_for_new_isins()` is called automatically after each daily parse — fetching up to 50 new ISINs per run.

---

The local and production databases are **not in sync** and have different schemas. Always be aware of this when debugging.

### Tables that exist ONLY on Render (PostgreSQL)
These tables are **missing from local SQLite** — any script querying them will throw `no such table`:

| Table | Purpose |
|---|---|
| `fund_holding` | Individual stock-level holdings per fund (from Morningstar `NewPortfolioApi`) |
| `fund_portfolio_stats` | Fund-level portfolio statistics — asset allocation, market cap breakdown (`MCBRP`), sector weights, PE/PB, duration. Populated by the same holdings fetch |
| `holdings_fetch_log` | Tracks which ISINs have been fetched, status, timestamp |
| `morningstar_access_code` | Morningstar API accesscode with expiry, auto-rotated every 90 days |

### Columns that exist ONLY on Render
Local SQLite may be missing newer columns added to the schema (e.g. `tracking_error_1y`, `tracking_error_3y`, `tracking_error_5y`). **Always use raw `text()` SQL in scripts** — never use the ORM model directly — to avoid `no such column` errors locally.

### Holdings data
- Fund detail pages showing holdings data **only work on Render** — the `FundHolding` table doesn't exist locally
- Holdings are fetched monthly via `POST /api/holdings/fetch-universe`
- Individual fund: `POST /api/holdings/fetch/{isin}`
- The `fund_portfolio_stats` table contains Morningstar's `MCBRP-MarketCapLargeLongRescaled` etc. fields. **Confirmed point-in-time** (portfolio as of the `portfolio_date`, not a rolling average). Morningstar splits into Giant/Large/Mid/Small/Micro — `DailyFundData.large_cap` = Giant + Large combined. No historical rolling average cap mix is available from the current API subscription for Indian funds.

### Local dev data date
- Local SQLite data date: `2026-05-28`
- Render data date: current (updated daily via Gmail)

---

## Model Portfolios (BugleRock Multi-Asset DPMS)

### Architecture
Constraint-based portfolio construction using `scipy.optimize.linprog` with HiGHS backend — pure feasibility LP (no objective, just find valid weights).

### Fund universe
R1/R2 ranked funds only. Three asset classes:
- **Equity** — 8 core categories only (Large Cap, Large & Mid Cap, Flexi Cap, Multi Cap, Focused Fund, Mid Cap, Small Cap, Contra/Value). ELSS and thematic excluded.
- **Debt** — filtered by risk tier per model profile (Tier 1=Overnight/Liquid → Tier 5=Govt Bond/Credit Risk)
- **Hybrid** — filtered by risk tier per model profile (Tier 1=Arbitrage/Conservative → Tier 4=Aggressive Allocation)

### 5 model profiles (equity/debt targets ±3%)
| Model | Equity | Debt | Cap Mix (L/M/S) |
|---|---|---|---|
| Conservative | 30% | 70% | 75/15/10 ±5% |
| Mod Conservative | 35% | 65% | 70/20/10 ±5% |
| Balanced | 50% | 50% | 60/25/15 ±5% |
| Mod Aggressive | 70% | 30% | 55/23/22 ±5% |
| Aggressive | 80% | 20% | 40/30/30 ±5% |

### Solver constraints
All constraints are weighted averages (effective, not sleeve totals):
- `Σ wᵢ × equity_pctᵢ / 100` ∈ [eq_lo, eq_hi] — hybrid's equity portion counts
- `Σ wᵢ × bond_pctᵢ / 100` ∈ [debt_lo, debt_hi] — hybrid's debt portion counts
- Rebased cap mix: `Σ(wᵢ × equity_pctᵢ × large_capᵢ) / Σ(wᵢ × equity_pctᵢ)` ∈ cap_target ±5%
- Per-fund weight: 0% ≤ wᵢ ≤ 20% (LP lower bound = 0, post-filtered at 3% or 5%)
- Portfolio fund count: 9–15 funds (dynamic, solver decides)

### Per-category fund limits
| Model | Equity/cat | Debt/cat | Hybrid/cat |
|---|---|---|---|
| Conservative | 1 | 2 | 2 |
| Mod Conservative | 1 | 2 | 2 |
| Balanced | 1 | 1 | 2 |
| Mod Aggressive | 2 | 1 | 1 |
| Aggressive | 2 | 1 | 1 |

### Dynamic minimum weight
- ≤11 funds → min weight 5% per fund
- 12–15 funds → min weight 3% per fund

### Cap mix note
`large_cap`, `mid_cap`, `small_cap` in `DailyFundData` are **point-in-time** values from the Morningstar daily Excel. Historical rolling averages (`MCBRP` fields) are in `fund_portfolio_stats` on Render — but whether `MCBRP` is truly a rolling average or also point-in-time is **not confirmed** from Morningstar's API docs. Verify before relying on it.

### API endpoints
- `GET /api/models/portfolios` — all 5 portfolios
- `GET /api/models/detail?key=balanced` — single portfolio
- `GET /api/models/debug` — per-model error traces (use when portfolios return empty)

### Key debug script
```bash
cd backend && python debug_all.py
```
Shows per-model candidate counts, feasibility range checks, and solver status.

---



- PPT export is built but hidden (`display:none`) — to be enabled when ready
- `backend/utils/trading_calendar.py` is deprecated and safe to delete — no longer imported anywhere