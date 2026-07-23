# BugleRock Analytics

AI-native investment analytics platform for BugleRock Capital. Enables wealth managers to research mutual funds, build client portfolios, run risk/performance analysis, optimise allocations, and generate branded client proposals — all in one workflow.

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

## Known Limitations / Pending

- PPT export is built but hidden (`display:none`) — to be enabled when ready
- `backend/utils/trading_calendar.py` is deprecated and safe to delete — no longer imported anywhere