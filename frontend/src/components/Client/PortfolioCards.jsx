import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listPortfolios, listVersions, getVersion, deletePortfolio, SOURCE_LABEL,
} from './clientPortfolios';
import { fmtDate } from './clientUtils';
import './Client.css';

const MIX_COLORS = { Equity: '#912F63', Debt: '#3E3452', 'Cash & Others': '#A795AE' };

const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`);

function MixBar({ mix }) {
  const parts = Object.entries(MIX_COLORS).filter(([k]) => mix?.[k] > 0.5);
  if (!parts.length) return null;
  return (
    <>
      <div className="pf-mix-bar">
        {parts.map(([k, c]) => <div key={k} style={{ width: `${mix[k]}%`, background: c }} title={`${k} ${mix[k]}%`} />)}
      </div>
      <div className="pf-legend">
        {parts.map(([k, c]) => <span key={k}><i style={{ background: c }} />{k} {mix[k]}%</span>)}
      </div>
    </>
  );
}

function PortfolioCard({ clientId, p, onDeleted }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);   // { funds } for the latest version
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const s = p.summary || {};

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || detail) return;
    try {
      const [v, all] = await Promise.all([
        getVersion(clientId, p.portfolio_key, p.version),
        listVersions(clientId, p.portfolio_key),
      ]);
      setDetail({ funds: v.snapshot?.portfolio?.funds || [] });
      setVersions(all);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${p.name}" and all ${p.version} saved version(s)? This cannot be undone.`)) return;
    try {
      await deletePortfolio(clientId, p.portfolio_key);
      onDeleted();
    } catch (e) {
      setError(e.message);
    }
  }

  function openModel() {
    try { localStorage.setItem('mp_sel', p.model_key); } catch { /* storage unavailable */ }
    navigate('/models');
  }

  return (
    <div className="pf-card">
      <div className="pf-head">
        <div>
          <div className="pf-name">{p.name}</div>
          <div className="pf-meta">
            <span className="pf-source">{SOURCE_LABEL[p.source] || p.source}</span>
            v{p.version} · saved {fmtDate(p.created_at)}
          </div>
        </div>
        <div className="pf-actions">
          {p.source === 'model' && <button className="btn-outline" onClick={openModel}>Open in Model Portfolios</button>}
          <button className="btn-outline" onClick={toggle}>{open ? 'Hide details' : 'Details'}</button>
        </div>
      </div>

      {p.source === 'model' && (
        <>
          <MixBar mix={s.asset_mix} />
          <div className="pf-stats">
            <span><b>{s.fund_count ?? '—'}</b> funds</span>
            <span><b>{pct(s.return_3y)}</b> 3Y CAGR</span>
            <span><b>{pct(s.return_5y)}</b> 5Y CAGR</span>
            {s.data_date && <span>Model data as of {s.data_date}</span>}
          </div>
        </>
      )}

      {error && <div className="pf-error">{error}</div>}

      {open && (
        <div className="pf-body">
          {!detail && !error && <div className="pf-note">Loading…</div>}
          {detail && detail.funds.length > 0 && (
            <table className="rm-table">
              <thead><tr><th>Fund</th><th>Sleeve</th><th className="r">Weight</th></tr></thead>
              <tbody>
                {detail.funds.map(f => (
                  <tr key={f.isin}><td>{f.name}</td><td>{f.sleeve || '—'}</td><td className="r">{f.weight}%</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {versions && versions.length > 1 && (
            <div className="pf-versions">
              Earlier versions: {versions.filter(v => v.version !== p.version)
                .map(v => `v${v.version} (${fmtDate(v.created_at)})`).join(', ')}
            </div>
          )}
          <div className="pf-foot">
            <button className="pf-delete" onClick={remove}>Delete portfolio</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Portfolios saved against the client. Shown only from what has been saved: nothing is inferred.
export default function PortfolioCards({ clientId }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(null); // null while loading
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    listPortfolios(clientId).then(setItems).catch(e => { setItems([]); setError(e.message); });
  }, [clientId]);

  useEffect(() => { setItems(null); load(); }, [load]);

  if (items === null) return null;

  return (
    <div className="client-section">
      <div className="client-section-title">Portfolios{items.length > 0 ? ` (${items.length})` : ''}</div>
      {error && <div className="pf-error">Could not load saved portfolios: {error}</div>}
      {items.length === 0 && !error && (
        <div className="pf-empty">
          <div>No portfolio saved for this client yet. Build one and use <strong>Save to client</strong>.</div>
          <div className="pf-empty-actions">
            <button className="btn-outline" onClick={() => navigate('/models')}>Model Portfolios</button>
            <button className="btn-outline" onClick={() => navigate('/portfolio')}>Portfolio Builder</button>
          </div>
        </div>
      )}
      {items.map(p => <PortfolioCard key={p.portfolio_key} clientId={clientId} p={p} onDeleted={load} />)}
    </div>
  );
}
