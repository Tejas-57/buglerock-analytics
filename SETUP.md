# FundIQ Auth — Setup Instructions

## Step 1 — Install new Python packages

```bash
pip install python-jose[cryptography] passlib[bcrypt] python-multipart
```

Add to your `requirements.txt`:
```
python-jose[cryptography]
passlib[bcrypt]
python-multipart
```

---

## Step 2 — Generate JWT secret key

Run this once on your machine and copy the output:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Step 3 — Set environment variables on Render

Go to your Render service → Environment → Add these:

| Variable | Value |
|----------|-------|
| `JWT_SECRET_KEY` | (paste the key from Step 2) |
| `FRONTEND_URL` | `https://buglerock-analytics.vercel.app` |
| `ENV` | `production` |

The Gmail variables (GMAIL_ACCESS_TOKEN, GMAIL_REFRESH_TOKEN, etc.)
should already be set from your NAV pipeline setup.

---

## Step 4 — Copy new files into your project

```
backend/models/auth_models.py        → copy as-is
backend/services/auth_service.py     → copy as-is
backend/middleware/auth_middleware.py → copy as-is
backend/routers/auth.py              → copy as-is

frontend/src/components/Login/Login.jsx          → copy as-is
frontend/src/components/Login/Login.css          → copy as-is
frontend/src/components/Login/SetupPassword.jsx  → copy as-is
frontend/src/components/Admin/AdminPanel.jsx     → copy as-is
frontend/src/components/Admin/AdminPanel.css     → copy as-is
frontend/src/hooks/useAuth.js                    → copy as-is
```

---

## Step 5 — Patch your existing files

**backend/main.py** — add these lines (see main_auth_patch.py):
```python
from .routers.auth import router as auth_router
from .middleware.auth_middleware import AuthMiddleware

app.add_middleware(AuthMiddleware)
app.include_router(auth_router)
```

**frontend/src/App.jsx** — follow App_auth_patch.jsx instructions

---

## Step 6 — Run seed script locally

```bash
# Set your local env vars first
export DATABASE_URL=postgresql://...
export FRONTEND_URL=https://buglerock-analytics.vercel.app
export GMAIL_ACCESS_TOKEN=...
# (all other Gmail vars)

python seed_users.py
```

This will:
- Create the 4 new auth tables in PostgreSQL
- Create all 7 users
- Send setup emails to 6 people (everyone except BR Analytics)

---

## Step 7 — Deploy

```bash
git add .
git commit -m "feat: add FundIQ user authentication"
git push
```

Render auto-deploys. Vercel auto-deploys.

---

## Step 8 — Verify

```bash
# Check tables were created
curl https://buglerock-analytics-ew17.onrender.com/api/status

# Test login (after a user sets their password)
curl -X POST https://buglerock-analytics-ew17.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tejas.s@buglerock.asia","password":"theirpassword"}'

# Check user list (admin only)
curl https://buglerock-analytics-ew17.onrender.com/api/auth/users \
  --cookie "access_token=..."
```

---

## How it flows for a new user

1. You run `seed_users.py`
2. User gets email: "Set up your FundIQ account" with a link
3. User clicks link → SetupPassword page → sets their password
4. Auto-logged in → lands on FundIQ home
5. Next day: browser auto-refreshes token silently — no login needed
6. After 30 days of inactivity: login screen appears once

## Admin actions available at `/admin`

- See all users + their status
- Revoke sessions (force logout from all devices)
- Resend setup email (if someone missed it)
- Deactivate account (instant lockout)