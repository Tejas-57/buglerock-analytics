# BugleRock Analytics (FündIQ)

Mutual-fund research and portfolio platform. React frontend (Vercel, `fundiq.buglerock.asia`), FastAPI backend (Render, `backend.buglerock.asia`), PostgreSQL on Render. See `README.md` for architecture, data pipelines and analytics rules.

## Git workflow
- Never commit or push directly to `main`; a push to `main` deploys to production (Render ~3 min, Vercel ~90 s).
- Work on a branch (`feat/...`, `fix/...`, `docs/...`), push it, and open a pull request. Vercel posts a build check on each PR.
- Commit format: `<type>(<scope>): <description>`. Types: `feat`, `fix`, `docs`, `refactor`, `chore`.
- Ask before `git push`, and before merging anything.
- Edit files in place. The "full files only" and "no multi-line terminal code" rules in the README are for the browser workflow and do not apply here.

## Running locally
- Backend: `cd backend && venv\scripts\activate && python main.py` (port 8000, auto-reload)
- Frontend: `cd frontend && npm start` (http://localhost:3000)
- Frontend build check: `cd frontend && npm run build`
- Node dependency for PPT export: `cd backend && npm install`

## Local database warning
`backend/.env` has `DATABASE_URL` pointing at the **production** Render database. Treat local runs as touching live data.
- `RUN_BACKGROUND_JOBS=false` in the local `.env` stops the Gmail poll, NAV/holdings crons and parser re-parse. Do not remove it.
- Ask before running anything that writes: migrations, `PARSER_VERSION` changes, NAV or holdings fetches, user management scripts, `/reparse` or `/fetch-all` endpoints.

## Previews
Vercel preview URLs (`*.vercel.app`) cannot log in: the backend CORS list excludes them and the auth cookie is scoped to `.buglerock.asia`. Test behind-login changes on localhost; use the PR preview only to confirm the build passes.

## Secrets and confidentiality
- Never print or commit `backend/.env`, `backend/credentials/`, tokens, or the database password. Mask credentials when showing config.
- Do not put client names with holdings, AUM or returns into code, docs, commits or fixtures.
- Use "BugleRock" (one word) in all text.
