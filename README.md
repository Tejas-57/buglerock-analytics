# BugleRock Analytics

**AI-native portfolio analytics platform for BugleRock Capital**

GitHub: https://github.com/Tejas-57/buglerock-analytics

---

## Live URLs

- **Frontend**: https://buglerock-analytics-plum.vercel.app
- **Backend**: https://buglerock-analytics-ew17.onrender.com
- **Local backend**: `cd backend && venv\Scripts\activate && python main.py`

---

## Stack

- **Frontend**: React (Create React App) → Vercel (BugleRock work account)
- **Backend**: FastAPI (Python) → Render (BugleRock work account)
- **Database**: PostgreSQL → Render Basic-1gb + 5GB storage
- **Data source**: Morningstar daily Excel via Gmail API

---

## Project Structure

```
buglerock-analytics/
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── PortfolioBuilder/
│       │   │   ├── PortfolioBuilder.jsx       ← parent, 6-step rail
│       │   │   └── steps/
│       │   │       ├── ClientIPS.jsx           ← Step 1
│       │   │       ├── BuildPortfolio.jsx      ← Step 2
│       │   │       ├── Analyse.jsx             ← Step 3 (incl. Overlap sub-tab)
│       │   │       ├── Optimise.jsx            ← Step 4 (Monte Carlo)
│       │   │       ├── Compare.jsx             ← Step 5
│       │   │       └── PDFProposal.jsx         ← Step 6
│       │   ├── FundExplorer/
│       │   │   └── FundExplorer.jsx
│       │   ├── FundDetail/
│       │   │   └── FundDetail.jsx
│       │   ├── PeerComparison/
│       │   │   └── CompareFunds.jsx
│       │   ├── Performance/
│       │   │   ├── Performance.jsx
│       │   │   ├── NAVLineChart.jsx
│       │   │   ├── ReturnMetrics.jsx
│       │   │   └── RiskMetrics.jsx
│       │   ├── RollingAnalytics/
│       │   │   └── RollingAnalytics.jsx        ← rolling return/CAGR analysis
│       │   ├── Simulator/
│       │   │   └── Simulator.jsx               ← lumpsum/SIP what-if simulator
│       │   ├── Chat/
│       │   │   └── ChatButton.jsx              ← Gemini-powered fund assistant
│       │   ├── Watchlist/
│       │   │   └── Watchlist.jsx
│       │   ├── Layout/
│       │   │   ├── Header.jsx
│       │   │   └── Navbar.jsx
│       │   └── ...
│       └── styles/
│           └── global.css
└── backend/
    ├── main.py
    ├── models/
    │   └── database.py
    ├── routers/
    │   ├── status.py
    │   ├── home.py
    │   ├── funds.py
    │   ├── performance.py
    │   ├── peer.py
    │   ├── benchmarks.py
    │   ├── optimise.py
    │   ├── holdings.py        ← overlap analysis, Morningstar holdings
    │   ├── rolling.py         ← rolling return / CAGR endpoints
    │   ├── simulator.py       ← lumpsum/SIP simulator endpoints
    │   ├── chat.py            ← Gemini chat assistant endpoint
    │   ├── nav.py
    │   ├── gmail.py
    │   └── ...
    ├── services/
    │   ├── parser.py           ← PARSER_VERSION=1.5
    │   ├── db_service.py
    │   ├── gmail_watcher.py
    │   ├── optimiser.py        ← Monte Carlo engine
    │   ├── nav_fetcher.py
    │   ├── mfapi.py             ← external NAV history fetch (mfapi.in), CAGR/XIRR helpers
    │   ├── morningstar_service.py  ← Morningstar NewPortfolioApi client (holdings, access code)
    │   └── nse_fetch.py         ← NSE data fetch helpers
    └── utils/
        └── trading_calendar.py
```

---

## Key Features

### Fund Explorer
- Browse all mutual funds by asset class, category, sub-type
- Asset classes: Equity, Hybrid, Debt, ETF, Precious Metals, International, SIF
- Precious Metals as separate asset class (Gold, Silver, ETFs)
- Global search with deduplication
- R1/R2 whitelist filter

### Portfolio Builder (6 steps)
1. **Client & IPS** — client details, risk profile, asset allocation ranges, live benchmark picker (multi-select with manual weights)
2. **Build Portfolio** — add funds, set weights, view exposure metrics from snapshots
3. **Analyse** — 6 sub-tabs: overview, returns, risk, exposure, calendar year, projection
4. **Optimise** — Monte Carlo (10,000 simulations), 3 strategies: Max Sharpe / Min Volatility / Max Return
5. **Compare** — original vs optimised side-by-side
6. **PDF Proposal** — branded client-ready proposal

### Optimiser Architecture
- **Layer 1**: IPS constraints (equity/debt ranges, per-fund min 3% / max 20%)
- **Layer 2**: Sleeve classification (equity active/passive, hybrid equity/debt, debt, alternatives, international)
- **Layer 3**: Monte Carlo on weekly NAV returns (3Y lookback from `nav_history`)
- **Sub-sleeve caps**: Precious metals 10%, Equity passive 10%, International 10%, Thematic 10%
- **R1/R2 quality flags** with alternative suggestions
- **Manual weight** option for funds with <1Y NAV history

### Holdings & Overlap Analysis
- Fund holdings sourced from Morningstar NewPortfolioApi (`services/morningstar_service.py`)
- `fund_holdings` table stores per-fund holding-level data (`holding_type='E'` = equity)
- `/api/holdings/overlap` — pairwise overlap % + common holdings across 2-4 active equity funds
- `fund_portfolio_stats` stores derived portfolio-level stats per fund/date
- `morningstar_accesscode` stores/refreshes the Morningstar API access token (`MSTAR_ACCESSCODE`, expiry-tracked)
- Overlap analysis surfaced as a sub-tab inside Portfolio Builder → Analyse (Step 3)

### Peer Comparison
- `CompareFunds.jsx` (PeerComparison) — side-by-side comparison of funds across return, risk, cost & rating metrics
- Backed by `routers/peer.py`
- Color-coded win/loss cells (green/red) per metric

### Rolling Analytics
- `RollingAnalytics.jsx` + `routers/rolling.py`
- Rolling CAGR over 1Y/3Y/5Y windows using external NAV history (`services/mfapi.py`, mfapi.in)
- Validates requested date range against fund inception date; warns/adjusts if start predates inception

### Simulator
- `Simulator.jsx` + `routers/simulator.py`
- Lumpsum / SIP what-if return simulation using historical NAV (CAGR, XIRR)
- Inception-date validation shared with Rolling Analytics

### Fund Detail & Chat Assistant
- `FundDetail.jsx` — single-fund deep dive (metrics, holdings, performance)
- `ChatButton.jsx` + `routers/chat.py` — Gemini-powered (`gemini-2.5-flash`) fund/financial Q&A assistant, scoped to fund context passed from the frontend; no personalized investment advice

### Data Pipeline
- Gmail watcher polls every 5 minutes for Morningstar daily Excel
- Parser v1.5 extracts funds, benchmarks, all metrics
- `data_date` = most common `nav_date` from the file (not filename date)
- Benchmarks stored in `DailyFundData` with `is_benchmark=1`
- NAV history in `nav_history` table (3.6M+ rows)
- `nse_fetch.py` — supplementary NSE data fetch helpers

---

## Database Tables

| Table | Rows (approx) | Purpose |
|---|---|---|
| `daily_fund_data` | ~8,000/day | Fund metrics per data_date |
| `nav_history` | 3.6M+ | Daily NAV per ISIN |
| `email_fetch_log` | ~100+ | Gmail fetch audit trail |
| `app_settings` | 4 | Gmail token, parser version, mail_date |
| `benchmark_data` | 0 (cleared) | Legacy — not used |
| `nav_fetch_log` | ~6,500 | NAV fetch audit |
| `fund_holdings` | growing | Per-fund, per-holding data from Morningstar (equity/debt) |
| `fund_portfolio_stats` | growing | Derived portfolio-level stats per fund/date |
| `holdings_fetch_log` | growing | Morningstar holdings fetch audit trail |
| `morningstar_accesscode` | 1 | Cached Morningstar API access token + expiry |

---

## Environment Variables (Backend)

```
DATABASE_URL          = PostgreSQL connection string (new Render DB)
CORS_ORIGINS          = https://buglerock-analytics-plum.vercel.app
GEMINI_API_KEY        = Gemini AI key (chat assistant, gemini-2.5-flash)
WEB_CONCURRENCY       = 2
APP_PORT              = backend port override
MSTAR_ACCOUNT_CODE    = Morningstar API account code
MSTAR_ACCOUNT_PASSWORD = Morningstar API account password
MSTAR_ACCESSCODE      = cached Morningstar access token (auto-refreshed, stored in DB)
MSTAR_ACCESSCODE_EXPIRY = expiry timestamp for cached Morningstar access token
```

## Secret Files (Render)

```
gmail_credentials.json   → OAuth2 client credentials
gmail_token.json         → OAuth2 refresh token
```

---

## Git Workflow

```bash
git add -A && git commit -m "message" && git push
```

- Push to `main` → auto-deploys to Render (backend) and Vercel (frontend)

---

## Important Rules

1. Always generate full files for download — never snippets
2. Never alter `parser.py` for debugging
3. Never create separate files for same task — modify existing
4. Save Python scripts as `.py` files — never multiline in CMD
5. Parser version bump (`PARSER_VERSION`) triggers automatic re-parse on deploy

---

## Pending / Known Issues

- ✅ Render web service on Standard plan ($25/mo) — upgraded
- `WEB_CONCURRENCY=2`
- Old Render account (personal) still running — delete after confirming new account stable