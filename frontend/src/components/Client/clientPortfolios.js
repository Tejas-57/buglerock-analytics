// API helpers for portfolios saved against a client (backend/routers/client_portfolios.py).

const API = process.env.REACT_APP_API_URL || '';

async function call(path, options = {}) {
  const r = await fetch(`${API}/api/clients/${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).detail; } catch { /* body was not JSON */ }
    throw new Error(detail || `Request failed (${r.status})`);
  }
  return r.json();
}

// Latest version of each portfolio the client holds (summaries only).
export async function listPortfolios(clientId) {
  return (await call(`${clientId}/portfolios`)).portfolios;
}

export async function listVersions(clientId, portfolioKey) {
  return (await call(`${clientId}/portfolios/${portfolioKey}`)).versions;
}

// One version including its full snapshot.
export function getVersion(clientId, portfolioKey, version) {
  return call(`${clientId}/portfolios/${portfolioKey}/versions/${version}`);
}

// body: { name, source, model_key?, summary, snapshot } starts a new portfolio;
//       { portfolio_key, model_key?, summary, snapshot } adds a version to an existing one.
export function savePortfolio(clientId, body) {
  return call(`${clientId}/portfolios`, { method: 'POST', body: JSON.stringify(body) });
}

export function deletePortfolio(clientId, portfolioKey) {
  return call(`${clientId}/portfolios/${portfolioKey}`, { method: 'DELETE' });
}

// Today's version of a model portfolio. The optimiser solves it on request, so this takes a few seconds.
export async function fetchCurrentModel(modelKey) {
  const r = await fetch(`${API}/api/models/detail?key=${encodeURIComponent(modelKey)}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`Could not load the current model (${r.status})`);
  return r.json();
}

export const SOURCE_LABEL = {
  model: 'Model portfolio',
  custom: 'Custom portfolio',
  retirement: 'Retirement plan',
};
