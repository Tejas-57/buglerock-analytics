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
**Frontend (live):** https://fundiq.buglerock.asia
**Backend (live):** https://backend.buglerock.asia

### Custom domains (GoDaddy — buglerock.asia)
| Subdomain | Points to |
|---|---|
| `fundiq.buglerock.asia` | Vercel (CNAME → Vercel DNS) |
| `backend.buglerock.asia` | Render (CNAME → buglerock-analytics-ew17.onrender.com) |

### Useful backend URLs
| Purpose | URL |
|---|---|
| API health check | https://backend.buglerock.asia/api/status |
| Model portfolios | https://backend.buglerock.asia/api/models/portfolios |
| Model portfolio debug | https://backend.buglerock.asia/api/models/debug |
| Holdings fetch status | https://backend.buglerock.asia/api/holdings/admin/fetch-status |
| Holdings fetch progress | https://backend.buglerock.asia/api/holdings/admin/fetch-progress |
| Accesscode status | https://backend.buglerock.asia/api/holdings/admin/accesscode-status |
| Fetch single fund holdings | https://backend.buglerock.asia/api/holdings/fetch/{isin} (POST) |
| Fetch all holdings | https://backend.buglerock.asia/api/holdings/fetch-universe (POST) |
| Trigger Gmail fetch | https://backend.buglerock.asia/api/funds/fetch?date=YYYY-MM-DD |
| Debug Gmail search | https://backend.buglerock.asia/api/funds/debug-gmail?date=YYYY-MM-DD |
| Peer group analytics | https://backend.buglerock.asia/api/peer/snapshot |
| Benchmark indices list | https://backend.buglerock.asia/api/benchmarks/indices |
| Benchmark NAV history | https://backend.buglerock.asia/api/benchmarks/nav-history?index=X |
| Benchmark sync (manual) | https://backend.buglerock.asia/api/benchmarks/sync (POST) |
| Benchmark load status | https://backend.buglerock.asia/api/benchmarks/load-status |
| Portfolio look-through | https://backend.buglerock.asia/api/holdings/portfolio-lookthrough?isins=X&weights=Y |
| FastAPI docs | https://backend.buglerock.asia/docs |
| **Period dates debug** | https://backend.buglerock.asia/api/performance/period-dates |

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

### Node.js dependency (required for PowerPoint generation)
```bash
cd backend
npm install
```
This installs `pptxgenjs`. The `node_modules/` folder is gitignored — run `npm install` after every fresh clone.

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
JWT_SECRET_KEY=<hex32>
ENV=development
AUTH_EMAIL_SENDER=analytics@buglerock.asia
FRONTEND_URL=http://localhost:3000
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=...
GMAIL_TOKEN_JSON=...           # Stored in DB automatically after first OAuth flow
BENCHMARK_SHEET_ID=1g_-yQIVu4Ror0BgBhW2Pex3Fj3uP_0meZHrpwJQ5qWA
GOOGLE_SERVICE_ACCOUNT_JSON=...  # Full JSON of sheets_credentials.json (single line)
```

**Frontend** — create `frontend/.env.development` (gitignored, local only):
```env
REACT_APP_API_URL=http://localhost:8000
```

**Frontend production** — `frontend/.env.production` (committed):
```env
REACT_APP_API_URL=https://backend.buglerock.asia
```

React automatically uses `.env.development` for `npm start` and `.env.production` for `npm run build` (Vercel).

---

## Authentication System

JWT-based auth with HttpOnly cookies. Implemented Sep 2026.

### Architecture
- Access token: 8 hours, HttpOnly cookie, `domain=.buglerock.asia`
- Refresh token: 30-day sliding, HttpOnly cookie, stored in DB for revocation
- Cookie domain works because both `fundiq.buglerock.asia` and `backend.buglerock.asia` share the `.buglerock.asia` parent
- Password hashing: direct `bcrypt` (passlib had version bug on Render Python 3.11)
- OTP email: Gmail API with `gmail.send` scope via `analytics@buglerock.asia`
- Local dev cookies work because `ENV=development` sets `cookie_domain=None`

### Key files
| File | Role |
|---|---|
| `backend/auth/models/auth_models.py` | Users, RefreshToken, OTPCode, SetupToken tables |
| `backend/auth/services/auth_service.py` | JWT, bcrypt, OTP, setup token, Gmail email sending |
| `backend/auth/middleware/auth_middleware.py` | Route protection, public routes whitelist |
| `backend/auth/routers/auth.py` | All `/api/auth/*` endpoints |
| `frontend/src/hooks/useAuth.js` | Session restore on startup, silent refresh every 7h |
| `frontend/src/components/Login/Login.jsx` | Login + forgot password + OTP reset |
| `frontend/src/components/Login/SetupPassword.jsx` | First-login setup page |
| `frontend/src/components/Admin/AdminPanel.jsx` | User management UI (at `/admin`, no navbar link) |

### Render environment variables (production)
| Variable | Value |
|---|---|
| `JWT_SECRET_KEY` | hex32 secret |
| `FRONTEND_URL` | `https://fundiq.buglerock.asia` |
| `ENV` | `production` |
| `AUTH_EMAIL_SENDER` | `analytics@buglerock.asia` |
| `CORS_ORIGINS` | `http://localhost:3000,https://fundiq.buglerock.asia` |
| `WEB_CONCURRENCY` | `2` |

### User management scripts (run from project root)
| Script | Purpose |
|---|---|
| `seed_users.py` | Create users + send setup emails. `FRONTEND_URL` hardcoded to `https://fundiq.buglerock.asia` |
| `resend_setup.py` | Resend setup email to one user. `FRONTEND_URL` hardcoded to `https://fundiq.buglerock.asia` |
| `check_users.py` | List all users with status |
| `reauth_gmail.py` | OAuth reauthorisation with send scope |
| `update_gmail_token.py` | Push local token file to DB |

⚠️ Both `seed_users.py` and `resend_setup.py` have `FRONTEND_URL` hardcoded (not read from `.env`) — this ensures setup email links always point to production regardless of local env.

⚠️ Corporate network SSL issue: Gmail token refresh fails locally with `SSLCertVerificationError`. Fix — add at top of any script that sends email:
```python
import ssl
ssl._create_default_https_context = ssl._create_unverified_context
```

### Gmail token scope
Token must have both scopes: `gmail.readonly` AND `gmail.send`. Check with:
```bash
type backend\credentials\gmail_token.json | findstr scope
```
If only `readonly` — run `python reauth_gmail.py` then `python update_gmail_token.py`.
After reauth, also update token on Render: Render → backend service → Environment → Secret Files → `/etc/secrets/gmail_token.json`.

Google OAuth app must be set to **Internal** (buglerock.asia Workspace) to avoid "Something went wrong" error during reauth.

### Users
| Name | Email | Role | Status |
|---|---|---|---|
| BR Analytics | analytics@buglerock.asia | admin | Service account |
| Tejas Singh | tejas.s@buglerock.asia | admin | Active |
| Divyansh Agarwal | divyansh.a@buglerock.asia | user | Active |
| Sujaya Lakshmi | sujaya.l@buglerock.asia | user | Active |
| Arjun Prasanna | arjun.p@buglerock.asia | user | Commented out in seed |
| Pranav Shenoy | pranav.s@buglerock.asia | user | Commented out in seed |
| Ishwar Raj | ishwar.r@buglerock.asia | user | Commented out in seed |

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
| OAuth client | Desktop app type — **Internal** (buglerock.asia Workspace) |
| Service account | benchmark-bot@buglerock-analytics-505208.iam.gserviceaccount.com |

**Credential files on Render (Secret Files):**
- `/etc/secrets/gmail_credentials.json` — OAuth client credentials
- `/etc/secrets/gmail_token.json` — OAuth access+refresh token
- `/etc/secrets/sheets_credentials.json` — Service account JSON for Sheets API

**Token management:**
- Token stored in DB (`settings` table, key `gmail_token`)
- To push new token to DB after regenerating: `POST /api/gmail/store-token`
- To regenerate token locally: run `backend/reauth_gmail.py`

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
- **DB-first** — checks DB before writing to sheet
- **Self-healing** — delete any DB row → restored within 5 minutes

### Manual operations
```bash
# Trigger email fetch (NSE + CRISIL) — runs in background
curl -X POST https://backend.buglerock.asia/api/benchmarks/sync

# Check historical load status
curl https://backend.buglerock.asia/api/benchmarks/load-status

# Query nav history
curl "https://backend.buglerock.asia/api/benchmarks/nav-history?index=Nifty%2050&from_date=2024-01-01"
```

### ✅ Nifty Indices daily DB sync (live)
Apps Script writes to the "Nifty Indices" sheet tab daily via Yahoo Finance. The 5-minute Gmail poll loop calls `sync_nifty_indices_from_sheet()` inside `fetch_all_benchmarks()` every poll cycle. Verified live Aug 2026 — all 12 indices current.

---

## NAV Pipeline (DB-first architecture)

### Priority order for NAV data
```
1. nav_history table in PostgreSQL  ← primary (fast, <50ms)
2. Morningstar Price API             ← gap fill / backfill
3. mfapi.in                          ← fallback if Morningstar fails
```

### Key files
| File | Role |
|---|---|
| `backend/services/nav_service.py` | NAV orchestration — DB-first with period_dates. **Replaces old `mfapi.py`** |
| `backend/services/nav_fetcher.py` | Raw NAV fetching — Morningstar primary, mfapi fallback, upsert |
| `backend/routers/performance.py` | `/api/performance/nav-chart` endpoint |
| `backend/routers/nav.py` | `/api/nav/fetch/{isin}`, `/api/nav/fetch-all` |

### ⚠️ `mfapi.py` → `nav_service.py` rename
`backend/services/mfapi.py` was renamed to `backend/services/nav_service.py`. All imports in `performance.py`, `simulator.py`, `rolling.py` updated. If any file still imports from `services.mfapi` it will crash on startup.

### period_dates table
New PostgreSQL table stores exact start/end dates extracted from daily Morningstar Excel header rows.

| Column | Description |
|---|---|
| `data_date` | Date of the Excel file |
| `db_field` | e.g. `return_1m`, `return_3m`, `return_1y` |
| `start_date` | Exact period start from Excel |
| `end_date` | Exact period end from Excel |

- Table is wiped and re-inserted every daily Excel parse (always only latest 17 rows)
- Debug endpoint: `GET /api/performance/period-dates`
- To repopulate manually: `curl -X POST http://localhost:8000/api/gmail/reparse`
- On startup: if table is empty, forces reparse of last 7 days automatically

### nav_history table
- 4,546,322 rows across 2,033 funds from inception (full refetch Sep 2026 via Morningstar)
- `UNIQUE(isin, date)` enforced at DB level

### Full refetch command (Morningstar, overwrites everything)
```cmd
curl -X POST "http://localhost:8000/api/nav/fetch-all?force=true"
```
Monitor: `curl "http://localhost:8000/api/nav/fetch-all/status"`

### New ISIN auto-detection
Every daily Gmail parse: new ISINs in `DailyFundData` not yet in `nav_history` → automatically fetches full history from inception in background thread.

### SSL fix
`verify=False` on all `httpx.AsyncClient` calls in `nav_service.py` — required for Morningstar calls in dev environment.

---

## Project Structure

```
buglerock-analytics/
├── frontend/
│   └── src/
│       └── components/
│           ├── FundExplorer/
│           ├── FundDetail/
│           ├── PeerComparison/
│           │   ├── CompareFunds.jsx
│           │   └── generateComparisonPDF.js   ← NEW Sep 2026
│           ├── StockExposure/
│           ├── RetirementPlanner/
│           │   ├── RetirementPlanner.jsx
│           │   ├── rtEngine.js
│           │   ├── rtReport.js
│           │   ├── rtWorker.js
│           │   └── RetirementPlanner.css
│           ├── Simulator/
│           ├── RollingAnalytics/
│           ├── ModelPortfolios/
│           ├── Watchlist/
│           ├── Login/                         ← NEW Sep 2026
│           │   ├── Login.jsx
│           │   ├── Login.css
│           │   └── SetupPassword.jsx
│           ├── Admin/                         ← NEW Sep 2026
│           │   ├── AdminPanel.jsx
│           │   └── AdminPanel.css
│           ├── Layout/
│           │   ├── Header.jsx                 ← Updated Sep 2026 (logout button)
│           │   └── Header.css
│           └── PortfolioBuilder/
│               ├── PortfolioBuilder.jsx
│               └── steps/
│                   ├── ClientIPS.jsx
│                   ├── FundSearch.jsx
│                   ├── BuildPortfolio.jsx
│                   ├── Analyse.jsx
│                   ├── analyseTabs/
│                   │   └── PortfolioXRay.jsx
│                   ├── Optimise.jsx
│                   ├── Compare.jsx
│                   └── PDFProposal.jsx
│
└── backend/
    ├── main.py
    ├── auth/                                  ← NEW Sep 2026
    │   ├── models/auth_models.py
    │   ├── services/auth_service.py
    │   ├── middleware/auth_middleware.py
    │   └── routers/auth.py
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
        ├── nav_service.py             # ← renamed from mfapi.py
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

### `NavHistory`
Daily NAV per fund from inception. 4.5M+ rows. `UNIQUE(isin, date)`.

### `PeriodDates`
17 rows (wiped + refreshed daily). Exact start/end dates per return period from Morningstar Excel.

### Auth tables (Sep 2026)
| Table | Purpose |
|---|---|
| `users` | Email, name, role, password hash, is_active, is_service_account, password_set |
| `refresh_tokens` | Token hash, user_id, expiry, revoked flag |
| `otp_codes` | 6-digit OTP for password reset, expires 10 min |
| `setup_tokens` | First-login password setup link, expires 7 days |

---

## Key Features

### Navbar Structure
- **DISCOVER** — Fund Explorer, Watchlist, Stock Exposure
- **ANALYSE** — Fund Detail, Compare Funds, Peer Group Analytics
- **BUILD** — Portfolio Builder, Model Portfolios, Retirement Planner
- **CALCULATE** — SIP Simulator, Rolling Analytics
- Sidebar scrollable when items overflow (small/zoomed screens)

### Login Page
- Logo: **FündIQ** (with umlaut ü) centered, no square mark
- Subtitle: "A BugleRock Analytics Platform"
- Forgot password → 6-digit OTP via Gmail API
- `SetupPassword.jsx` — first-login route, publicly accessible (whitelisted in auth middleware)

### Header
- Username (first name only) + logout icon button top right
- Props: `user` (object with `.name`) and `onLogout` (function)
- CSS classes: `.header-user`, `.header-username`, `.header-logout`

### Fund Explorer
- Category shown on watchlist card uses fund's own `category` field, NOT the sidebar filter category
- Back button on Fund Detail uses `navigate(-1)` — returns to wherever user came from
- **R1-R5 ranking colors**: R1/R2 = green `#059669`, R3 = black `#2D1F2B`, R4/R5 = red `#EF4444`

### Fund Detail
- Period toggle (1Y/3Y/5Y) — `rk()` returns null for missing periods (no 3Y fallback)
- **NAV chart** uses exact `period_dates` from DB — not `today - N days`
- `isin` passed as param from frontend — backend skips ISIN lookup from amfi_code

### Watchlist
- Category displayed from live snapshot (`f?.category`) with localStorage fallback
- Add-to-watchlist saves fund's own category, not selected sidebar filter

### Compare Funds (`/PeerComparison/CompareFunds.jsx`)
- 6 sub-tabs: Returns, Risk metrics, Composition, Sectoral exposure, Fund info, Overlap
- **Export Comparison PDF** button — sits in the tabs row, right-aligned, hidden on Overlap tab
- PDF generated by `generateComparisonPDF.js` — cover page + 4 pages (Returns, Risk, Composition, Sectoral Exposure). Fund Info tab excluded from PDF.
- Cover page: dark header banner (title + BugleRock branding) + separate white card listing funds with color squares, NAV, 1Y return, AUM
- **Overlap tab** — separate "Export Overlap Report" PDF button

### generateComparisonPDF.js
| Page | Content |
|---|---|
| Cover | Dark banner (title, date, BugleRock), fund list card (color dot, name, category, AUM, NAV, 1Y), disclaimer |
| 1 — Returns | All return periods + calendar years + periods won tally |
| 2 — Risk Metrics | 1Y and 3Y risk metrics with highlighting |
| 3 — Composition | Market cap split, asset allocation, valuation |
| 4 — Sectoral Exposure | Morningstar sector classification |

⚠️ Sector data only appears if user visited the Sectoral Exposure tab first (data loaded on tab visit). PDF shows "visit Sectoral Exposure tab first" message if data is missing.

### Model Portfolios (`/ModelPortfolios/`)
Five solver-constructed portfolios (Conservative → Aggressive) built from R1/R2 ranked funds only using HiGHS LP solver. Portfolio detail panel has two action buttons:

#### 🔬 View Portfolio X-Ray (modal overlay)
Full-screen modal reusing `PortfolioXRay` directly. On open fires three API calls in parallel:
- `GET /api/nav/stress-test?isins=...&weights=...`
- `GET /api/holdings/historical-var?isins=...&weights=...&categories=...&asset_classes=...&std_devs=...`
- `GET /api/holdings/overlap?isins=...` (auto-triggers `/api/holdings/fetch/{isin}` POST for missing funds, polls 30×2s)

Results keyed by `portfolio.key` — switching portfolios resets and re-fetches, reopening same portfolio reuses cached state.

#### 📄 Generate PDF (modal overlay)
Reuses `PDFProposal` directly via `buildPDFProps()` adapter. If X-Ray was opened first, `stressData` and `overlapData` are passed through automatically.

#### Backend (`models.py`) — blended fields
`_get_funds` SQL and `blended{}` now include:
`return_1m · return_3m · return_6m · return_ytd · return_cy2021–cy2025 · sortino_3y · beta_3y · up_capture_3y · down_capture_3y`

### Simulator (`/Simulator/`)
- SIP / Lumpsum backtest using actual NAV history
- **localStorage cache** (`sim_cache_v1`): persists `fund`, `mode`, `amount`, `startDate`, `endDate`, `sipDate`
- On mount: if valid saved inputs exist, auto re-runs the API and restores result

### Rolling Analytics (`/RollingAnalytics/`)
- Daily rolling CAGR distribution with stats (avg, median, best, worst, % positive, % > 12%, std dev)
- **localStorage cache** (`rolling_cache_v1`): persists `fund`, `rollingYears`, `startDate`, `endDate`

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

**Portfolio X-Ray — Stress section**:
- Fetched when X-Ray tab opens
- Shows real NAV-based returns: Portfolio, Nifty 500, Blended BM
- Footnote: "Returns calculated from actual NAV history. '—' means fund not active or NAV unavailable."

### Retirement Planner
- **Web Worker**: `rtWorker.js` runs simulation off main thread — UI stays responsive
- `Field` component at module level (fixes focus/cursor loss on keystroke)
- `type="text"` with `inputMode="decimal"` (fixes leading zero bug)
- `retAge < age` validation — allows already-retired clients (retAge = currentAge)

#### Report sections (in order)
1. Plan score badge
2. Hero card — gradient, status, KPI strip, "What needs to change?" table, funding gap bar
3. What could derail the plan? — risk section ranked by impact points
4. Phase 1 / Phase 2 split card
5. Retirement readiness bridge — 7 nodes
6. What should you do? — 3 action cards + plain English paragraph
7. Corpus Projection Fan Chart
8. Corpus Milestones
9. Corpus Percentile Analysis
10. Retirement Income Requirement (waterfall — gross-up corrected)
11. Sensitivity Analysis
12. Plan Score
13. Financial Goals
14. Year-by-Year Cashflow
15. Investment Policy & Assumptions

#### Key engine fields
- `R.score` — `{composite, components: [{label, score, weight}]}`
- `R.firstNeed` — gross portfolio withdrawal (pre-tax, lakhs/year)
- `R.incomeAtRet` — lifestyle cost at retirement (₹ absolute monthly)
- `R.npsAnnualAnnuity` — NPS annuity (lakhs/year). Old name `npsAnnuityIncome` was wrong.
- `R.totalSIPContrib` — raw nominal SIP cash (no compounding)
- `R.marketGrowthEst` — `P50 - corpus0 - totalSIPContrib - epfAtRet - npsLump`
- Solvers (`rtSolveSIP`, `rtSolveRetAge`, `rtSolveSpend`) run at full `nSims`

#### Key fixes (Sep 2026)
- Waterfall corrected: tax grossed-up (added), not subtracted
- `npsAnnuityIncome` → `npsAnnualAnnuity` field name
- `R.planScore` → `R.score` with correct shape
- `IN.lateRMu/lateRSig` → `IN.lateMu/lateSig`
- All hardcoded "500/1000 simulations" → `R.NSIM`
- PDF: all `rt-` CSS classes inlined in `rtOpenReport` `<style>` block

### Build Portfolio
- Weight warning: red background + bold message when weights exceed 100%

### Optimise Tab
- Runs **all three portfolios simultaneously** (Max Sharpe · Min Volatility · Max Return) on a single "Run optimisation" click
- Optimisation Objective dropdown **removed** — redundant since all three are always computed

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

Column count is dynamic: 4 columns when no IPS benchmark, 5 when blended BM is present.

---

## VaR / ES (`holdings.py`)

All four output values (`var_95`, `es_95`, `var_99`, `es_99`) clamped to `max(0.0, value)` before serialisation. Negative VaR (positive tail return) caused a `--0.6%` double-negative bug at 1Y horizon.

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
**Env var required:** `REACT_APP_API_URL = https://backend.buglerock.asia`

### Backend (Render)
Push to `main` → auto-deploys (~3 min). On startup: DB migrations → Gmail poll loop + NAV cron + holdings cron.
**Env var required:** `CORS_ORIGINS = http://localhost:3000,https://fundiq.buglerock.asia`

If the backend cannot resolve external hostnames — `Name or service not known` / `getaddrinfo failed` — this is a **Render infrastructure/DNS issue, not a code bug**. Check [status.render.com](https://status.render.com) and trigger a manual redeploy.

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

## .gitignore — Important Notes

```
backend/node_modules/      ← gitignored — run npm install after clone
frontend/.env.development  ← gitignored — create locally
backend/.env               ← gitignored — set on Render
backend/credentials/       ← gitignored — set on Render as secret files
```

⚠️ `echo` on Windows CMD adds literal quotes to `.gitignore` entries. Always edit `.gitignore` directly in VS Code to avoid broken patterns.

---

## Pending Features

1. **Seed remaining 3 users** — uncomment Arjun, Pranav, Ishwar in `seed_users.py` and run
2. **Audit log** — track who accessed what and when (SEBI compliance)
3. **AWS Cognito migration** — deferred until AWS call
4. **Data residency** — PostgreSQL in Oregon (US); consider AWS RDS Mumbai for SEBI compliance
5. **Enable Storage Autoscaling** on Render PostgreSQL (currently at 28% of 5GB — ~6-8 months runway)
6. **Wire Header logout** — ensure `user` and `onLogout` props flow correctly from `App.jsx` to `Header`
7. **Forgot password OTP** — working locally; verify on production after Gmail token fix
8. **Portfolio NAV series** — actual drawdown/ulcer/recovery from computed portfolio daily returns
9. **Cost basis (WACB)** — Retirement Planner LTCG tax calculation
10. **Model Portfolio presets** — Pre-fill Retirement Planner from real blended returns
11. **Old Cloud project cleanup** — Shut down tejas.s@buglerock.asia project
12. **CY 2026 column** — add to calendar year chart when year completes (do not add before year-end)
13. **google.generativeai deprecation** — `chat.py` uses deprecated package, switch to `google.genai`

---

## Output Files (always use these, not repo)

| File | Deploy to |
|---|---|
| `CompareFunds.jsx` | `frontend/src/components/PeerComparison/` |
| `generateComparisonPDF.js` | `frontend/src/components/PeerComparison/` |
| `Login.jsx` | `frontend/src/components/Login/` |
| `Login.css` | `frontend/src/components/Login/` |
| `SetupPassword.jsx` | `frontend/src/components/Login/` |
| `AdminPanel.jsx` | `frontend/src/components/Admin/` |
| `AdminPanel.css` | `frontend/src/components/Admin/` |
| `Header.jsx` | `frontend/src/components/Layout/` |
| `Header.css` | `frontend/src/components/Layout/` |
| `Analyse.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `PortfolioXRay.jsx` | `frontend/src/components/PortfolioBuilder/steps/analyseTabs/` |
| `BuildPortfolio.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `PortfolioBuilder.jsx` | `frontend/src/components/PortfolioBuilder/` |
| `ClientIPS.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `PDFProposal.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `Optimise.jsx` | `frontend/src/components/PortfolioBuilder/steps/` |
| `FundExplorer.jsx` | `frontend/src/components/FundExplorer/` |
| `FundDetail.jsx` | `frontend/src/components/FundDetail/` |
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
| `rtWorker.js` | `frontend/src/components/RetirementPlanner/` |
| `holdings.py` | `backend/routers/` |
| `benchmarks.py` | `backend/routers/` |
| `nav.py` | `backend/routers/` |
| `models.py` | `backend/routers/` |
| `db_service.py` | `backend/services/` |
| `benchmark_db_service.py` | `backend/services/` |
| `parser.py` | `backend/services/` |
| `nav_service.py` | `backend/services/` *(replaces mfapi.py — do not use mfapi.py)* |
| `nav_fetcher.py` | `backend/services/` |
| `performance.py` | `backend/routers/` |
| `simulator.py` | `backend/routers/` |
| `rolling.py` | `backend/routers/` |
| `database.py` | `backend/models/` |
| `main.py` | `backend/` |

---

- PPT export is built but hidden (`display:none`) — to be enabled when ready