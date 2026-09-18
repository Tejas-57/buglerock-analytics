# BugleRock Analytics — Backend

## Setup

### Python dependencies
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

### Node.js dependencies (required for PowerPoint generation)
```bash
cd backend
npm install
```
This installs `pptxgenjs` which is used to generate `.pptx` proposal files.
The `node_modules/` folder is gitignored — you must run `npm install` after cloning.

### Environment variables
Copy `.env.example` to `.env` and fill in the values.
Required variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET_KEY` — generate with: `python -c "import secrets; print(secrets.token_hex(32))"`
- `ENV` — `development` or `production`
- `AUTH_EMAIL_SENDER` — `analytics@buglerock.asia`
- `FRONTEND_URL` — `http://localhost:3000` (local) or `https://fundiq.buglerock.asia` (production)

### Gmail credentials
Place the following in `backend/credentials/`:
- `gmail_credentials.json` — OAuth2 client credentials
- `gmail_token.json` — OAuth2 token (run `python reauth_gmail.py` from project root to generate)

### Running locally
```bash
cd backend
venv\Scripts\activate
python main.py
```
Server runs on `http://localhost:8000`

## Architecture
- **Framework:** FastAPI (Python)
- **Database:** PostgreSQL (Render)
- **Auth:** JWT + HttpOnly cookies, domain `.buglerock.asia`
- **Email:** Gmail API (analytics@buglerock.asia)
- **PowerPoint generation:** Node.js + pptxgenjs