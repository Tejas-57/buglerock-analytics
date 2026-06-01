# BugleRock Analytics Platform

AI-native mutual fund analytics platform for BugleRock Capital (BRCPL).

## Live URLs
- **Frontend:** https://buglerock-analytics.onrender.com
- **Backend:** https://buglerock-backend.onrender.com
- **API Docs:** https://buglerock-backend.onrender.com/docs

## Stack
- **Backend:** FastAPI + PostgreSQL + SQLAlchemy + Python 3.11
- **Frontend:** React 18 + Recharts + React Router
- **Data:** Morningstar Daily Excel (auto-fetched via Gmail API)
- **AI Chat:** Gemini 2.5 Flash (`google-generativeai`)
- **Hosting:** Render (backend: Web Service, frontend: Static Site, DB: PostgreSQL)

## Repository
- **GitHub:** https://github.com/Tejas-57/buglerock-analytics
- **Branch:** `main` (auto-deploys to Render on push)

---

## Architecture

```
Gmail (sujaya.l@alerts-morningstar.com)
    → Backend polls every 5 mins
    → parser.py parses Excel (8 sheets)
    → PostgreSQL stores fund data
    → React frontend fetches via API
```

## Key Files
```
backend/
  main.py                    — FastAPI app, startup, Gmail poll loop
  services/parser.py         — Excel parser (PARSER_VERSION here)
  services/gmail_watcher.py  — Gmail OAuth + attachment download
  services/db_service.py     — All DB read/write operations
  models/database.py         — SQLAlchemy models + AppSettings
  routers/funds.py           — Fund list, search, upload endpoints
  routers/performance.py     — Performance metrics, peer avg
  routers/gmail.py           — Gmail token management
  utils/trading_calendar.py  — NSE holiday calendar + date resolution

frontend/
  src/components/FundExplorer/FundExplorer.jsx  — Main fund explorer UI
  src/App.jsx                                   — App shell, date fetching
  src/components/Layout/Header.jsx              — Header with data date
```

---

## Parser Version System (IMPORTANT)

`backend/services/parser.py` has a `PARSER_VERSION` constant:

```python
PARSER_VERSION = "1.1"
```

**Rule:** Whenever parser logic changes (new categories, column mapping, merging rules), bump this version. On next deploy, the app will:
1. Detect version mismatch
2. Delete last 7 days of DB data
3. Re-fetch from Gmail automatically
4. Re-parse with new logic
5. Save new version to DB

**This must be done by whoever makes parser changes — no manual data uploads needed.**

---

## Gmail Auto-Fetch
- Email arrives daily from `sujaya.l@alerts-morningstar.com`
- Subject: `Morningstar Performance Reporting batch [New Singlesheet Daily MF Report] has finished`
- Attachment: `New Singlesheet Daily MF Report_DDMMYYYY.xlsx`
- Token stored permanently in PostgreSQL (`app_settings` table, key: `gmail_token`)
- If token expires: call `POST /api/gmail/refresh-token` via `/docs`
- If token needs re-setup: call `POST /api/gmail/store-token` (reads from Render Secret Files)

---

## Render Setup
| Service | Type | Env Vars |
|---------|------|----------|
| buglerock-backend | Web Service (Python 3.11) | `DATABASE_URL`, `GEMINI_API_KEY`, `CORS_ORIGINS` |
| buglerock-analytics | Static Site | `REACT_APP_API_URL` |
| buglerock-db | PostgreSQL | — |

**Secret Files** (on backend service):
- `gmail_credentials.json` — OAuth client credentials
- `gmail_token.json` — OAuth token (backup, primary stored in DB)

**Redirect Rule** (on frontend service):
- Source: `/*` → Destination: `/index.html` (Type: Rewrite)

---

## Excel Sheet Names (as of May 2026)
| Sheet | Asset Class |
|-------|-------------|
| Equity | Equity |
| Equity Index & FoF | Equity Index |
| Equity ETF | ETF - Equity |
| Hybrid | Hybrid |
| SIF | SIF |
| International | International |
| Debt | Debt |
| Debt ETF | ETF - Debt |

---

## Category Rules
- All `Cat: Thematic - X` merge into `Thematic Funds` **except**:
  - `Cat: Thematic - Quant` (shown separately)
  - `Cat: Thematic - Business Cycle` (shown separately)
- `India Fund Equity Savings - Aggressive` and `India Fund Equity Savings - Conservative` are merged into `India Fund Equity Savings` in the UI
- SIF shows 1M/3M returns (not 1Y/3Y) since it's a new category

---

## Local Development
```bash
# Backend
cd backend
py -3.11 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Add to backend/.env:
# DATABASE_URL=<Render PostgreSQL External URL>
# GEMINI_API_KEY=<your key>
# CORS_ORIGINS=http://localhost:3000

python main.py

# Frontend
cd frontend
npm install
npm start
```

## Tar Command (for sharing code with Claude)
```bash
cd /c/Users/tejas.s_buglerock/buglerock-analytics
tar -czf ../buglerock_project.tar.gz --exclude=backend/venv --exclude=backend/__pycache__ --exclude=backend/buglerock.db --exclude=backend/credentials backend frontend/src frontend/public frontend/package.json .gitignore
```

---

## What's Built
- ✅ Fund Explorer — asset class → subtype → category → fund list with ranking, returns, peer avg
- ✅ Home tab — fund snapshot with NAV, returns, risk metrics
- ✅ Performance tab — NAV chart vs benchmark, return/risk metrics
- ✅ Peer Comparison tab — returns and risk comparison
- ✅ Simulator tab — SIP/lumpsum calculator
- ✅ Rolling Analytics tab
- ✅ AI Chat — Gemini powered
- ✅ Global search — all categories, partial word match
- ✅ Gmail auto-fetch — daily data, 5-min poll
- ✅ PostgreSQL — persistent data
- ✅ Parser version system — auto re-parse on logic changes

## What's Pending
- 🔲 Fund Detail tab
- 🔲 Compare Funds tab
- 🔲 Watchlist
- 🔲 Portfolio Builder
- 🔲 Optimisation
- 🔲 Recommended Portfolio
- 🔲 Portfolio Review
- 🔲 PDF Proposal