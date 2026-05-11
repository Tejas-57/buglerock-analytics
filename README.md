# BugleRock Analytics — Setup Guide

## Project Structure

```
buglerock-analytics/
├── frontend/          ← React app
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout/        (Navbar, Header)
│   │   │   ├── Home/          (Fund snapshot, pie charts)
│   │   │   ├── Performance/   (Returns, risk, NAV chart)
│   │   │   ├── PeerComparison/(Peer table)
│   │   │   ├── Simulator/     (SIP/Lumpsum backtest)
│   │   │   ├── RollingAnalytics/ (Rolling CAGR)
│   │   │   └── Chat/          (Gemini floating chat)
│   │   ├── styles/global.css
│   │   └── App.jsx
│   └── package.json
│
└── backend/           ← Python FastAPI
    ├── main.py
    ├── models/database.py
    ├── routers/
    │   ├── funds.py
    │   ├── home.py
    │   ├── performance.py
    │   ├── peer.py
    │   ├── simulator.py
    │   ├── rolling.py
    │   ├── chat.py
    │   └── status.py
    ├── services/
    │   ├── parser.py
    │   ├── gmail_watcher.py
    │   ├── mfapi.py
    │   └── db_service.py
    ├── utils/
    │   └── trading_calendar.py
    └── requirements.txt
```

---

## Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+

---

## Step 1 — PostgreSQL Setup

```sql
CREATE DATABASE buglerock_analytics;
CREATE USER buglerock WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE buglerock_analytics TO buglerock;
```

---

## Step 2 — Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your actual values:
#   DATABASE_URL
#   GEMINI_API_KEY
#   Gmail credentials path
```

### Gmail API Setup

1. Go to https://console.cloud.google.com
2. Create a new project → Enable **Gmail API**
3. Create OAuth 2.0 credentials (Desktop App)
4. Download `credentials.json` → save to `backend/credentials/gmail_credentials.json`
5. On first run, a browser window will open for OAuth login
6. Login with `tejas.s@buglerock.asia`
7. Token saved automatically to `backend/credentials/gmail_token.json`

### Gemini API Key

1. Go to https://aistudio.google.com
2. Create API key → paste in `.env` as `GEMINI_API_KEY`

### Run Backend

```bash
cd backend
python main.py
# API runs at http://localhost:8000
# Docs at http://localhost:8000/docs
```

---

## Step 3 — Frontend Setup

```bash
cd frontend
npm install
npm start
# Runs at http://localhost:3000
```

---

## Step 4 — First Data Load

The Gmail watcher will automatically:
1. Check for today's email every 5 minutes
2. Download the Excel attachment
3. Parse all 4 sheets
4. Store in PostgreSQL

To manually trigger a data load for a specific date:
```bash
# From backend directory
python -c "
from services.gmail_watcher import fetch_and_store
from datetime import date
fetch_and_store(date(2026, 4, 9))
"
```

---

## NSE Holiday List

Update `backend/utils/trading_calendar.py` annually with the new NSE holiday list.
Official source: https://www.nseindia.com/products-services/equity-market-timings-holidays

---

## Key Rules Implemented

| Rule | Implementation |
|---|---|
| R1/R2 whitelist | `parser.py → apply_whitelist()` |
| No rankings → show all | `db_service.py → get_funds_for_dropdown()` |
| Thematic merge | `parser.py → MERGE_RULES` |
| Index MF excluded | `parser.py → EXCLUDE_PREFIXES` |
| Email X+1 offset | `trading_calendar.py → get_email_date_for()` |
| NSE holiday handling | `trading_calendar.py → is_trading_day()` |
| Missing data as "-" | `db_service.py → _fund_to_dict()` |
| Peer avg only (no rank) | `db_service.py → get_peer_avg()` |
| 252 trading days/year | `mfapi.py → TRADING_DAYS_PER_YEAR` |

---

## Adding Index MFs Later

In `backend/services/parser.py`, remove `"Index MF"` from `EXCLUDE_PREFIXES`:

```python
EXCLUDE_PREFIXES = [
    # "Index MF",   ← remove this line
]
```

Restart backend. Index MFs will appear automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 |
| Backend | Python 3.11 + FastAPI |
| Database | PostgreSQL 15 |
| Email | Gmail API (OAuth2) |
| Market Data | MFAPI.in (free) |
| AI Chat | Google Gemini 1.5 Flash |
| Charts | Recharts |
| Fonts | Cormorant Garamond + DM Sans |
