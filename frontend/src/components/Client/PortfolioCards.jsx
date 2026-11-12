import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listPortfolios, listVersions, getVersion, deletePortfolio, fetchCurrentModel, SOURCE_LABEL,
} from './clientPortfolios';
import { fmtDate, fmtINR } from './clientUtils';
import { RT_KEYS } from '../RetirementPlanner/RetirementPlanner';
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

// A change is flagged when a saved fund has left the model, or when turnover (the share of the
// portfolio that would have to move to match today's model) is above this many percentage points.
const TURNOVER_FLAG = 10;

function compareWithModel(savedFunds, currentFunds) {
  const saved = new Map(savedFunds.map(f => [f.isin, f]));
  const now = new Map(currentFunds.map(f => [f.isin, f]));
  const removed = savedFunds.filter(f => !now.has(f.isin));
  const added = currentFunds.filter(f => !saved.has(f.isin));
  let absDiff = 0;
  const moves = [];
  new Set([...saved.keys(), ...now.keys()]).forEach(isin => {
    const a = saved.get(isin)?.weight || 0;
    const b = now.get(isin)?.weight || 0;
    absDiff += Math.abs(a - b);
    if (saved.has(isin) && now.has(isin) && Math.abs(a - b) >= 0.5) {
      moves.push({ name: saved.get(isin).name, from: a, to: b });
    }
  });
  moves.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
  const turnover = absDiff / 2;
  return { removed, added, moves, turnover, flagged: removed.length > 0 || turnover > TURNOVER_FLAG };
}

function PortfolioCard({ clientId, p, onDeleted }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);   // { funds } for the latest version
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);     // { loading } | { error } | { result, dataDate }
  const s = p.summary || {};

  // Compares the saved copy with today's model. Solves the model on request, so it only runs on click.
  async function checkChanges() {
    setCheck({ loading: true });
    try {
      const [saved, current] = await Promise.all([
        getVersion(clientId, p.portfolio_key, p.version),
        fetchCurrentModel(p.model_key),
      ]);
      setCheck({
        result: compareWithModel(saved.snapshot?.portfolio?.funds || [], current.funds || []),
        dataDate: current.data_date,
      });
    } catch (e) {
      setCheck({ error: e.message });
    }
  }

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

  // Puts the saved plan back into the planner's own storage and opens it.
  //   'report'  the saved report exactly as it was, on the Results tab
  //   'refresh' the saved inputs only, on the Input tab, ready to edit and run again
  async function openRetirement(mode) {
    let hasOpenPlan = false;
    try { const cur = localStorage.getItem(RT_KEYS.result); hasOpenPlan = !!cur && cur !== 'null'; } catch { /* storage unavailable */ }
    if (hasOpenPlan && !window.confirm('This replaces the plan currently open in the Retirement Planner. Continue?')) return;
    try {
      const v = await getVersion(clientId, p.portfolio_key, p.version);
      const { inputs, result } = v.snapshot || {};
      if (!inputs || (mode === 'report' && !result)) throw new Error('This saved plan has no report to open.');
      localStorage.setItem(RT_KEYS.form, JSON.stringify(inputs.form));
      localStorage.setItem(RT_KEYS.goals, JSON.stringify(inputs.goals));
      localStorage.setItem(RT_KEYS.lumps, JSON.stringify(inputs.lumps));
      if (mode === 'report') {
        localStorage.setItem(RT_KEYS.result, JSON.stringify(result));
        localStorage.setItem(RT_KEYS.step, JSON.stringify('output'));
      } else {
        localStorage.removeItem(RT_KEYS.result);
        localStorage.setItem(RT_KEYS.step, JSON.stringify('input'));
      }
      navigate('/retirement-planner');
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
          {p.source === 'model' && (
            <button className="btn-outline" onClick={checkChanges} disabled={check?.loading}>
              {check?.loading ? 'Checking…' : 'Check for changes'}
            </button>
          )}
          {p.source === 'model' && <button className="btn-outline" onClick={openModel}>Open in Model Portfolios</button>}
          {p.source === 'retirement' && (
            <>
              <button className="btn-outline" onClick={() => openRetirement('refresh')}>Edit inputs and re-run</button>
              <button className="btn-outline" onClick={() => openRetirement('report')}>Open saved report</button>
            </>
          )}
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

      {check?.error && <div className="pf-error">{check.error}</div>}
      {check?.result && (
        <div className={`pf-notice ${check.result.flagged ? 'warn' : 'ok'}`}>
          {check.result.flagged
            ? <strong>The {p.name} model has changed since this was saved on {fmtDate(p.created_at)}.</strong>
            : <strong>No material change since this was saved. The model is in line with this portfolio.</strong>}
          <div>
            {check.result.turnover.toFixed(1)}% of the portfolio would move to match today's model
            (data as of {check.dataDate || '—'}).
          </div>
          {check.result.removed.length > 0 && (
            <div>No longer in the model: {check.result.removed.map(f => f.name).join(', ')}</div>
          )}
          {check.result.added.length > 0 && (
            <div>New in the model: {check.result.added.map(f => f.name).join(', ')}</div>
          )}
          {check.result.moves.slice(0, 5).map(m => (
            <div key={m.name}>{m.name}: {m.from}% → {m.to}%</div>
          ))}
          {check.result.flagged && (
            <div className="pf-notice-foot">
              This portfolio is unchanged. To follow the model, save it again from Model Portfolios and choose Overwrite.
            </div>
          )}
        </div>
      )}

      {p.source === 'retirement' && (
        <div className="pf-stats">
          <span>
            <b>{s.success_rate}%</b> chance the plan lasts to age {s.life_exp}
            {' '}({s.success_rate >= 85 ? 'on track' : s.success_rate >= 65 ? 'needs attention' : 'at risk'})
          </span>
          {s.plan_score != null && <span>Plan score <b>{s.plan_score}/100</b></span>}
          <span>Corpus needed <b>{fmtINR(s.corpus_needed)}</b></span>
          <span>Median corpus at {s.ret_age} <b>{fmtINR(s.median_corpus)}</b></span>
          <span>SIP <b>{fmtINR(s.current_sip)}</b>/mo{s.required_sip ? ` (${fmtINR(s.required_sip)} needed for ${s.target_conf}% confidence)` : ''}</span>
        </div>
      )}
      {p.source === 'retirement' && (
        <div className="pf-note">
          These figures are the report as saved on {fmtDate(p.created_at)}. They don't update by themselves.
          Use <strong>Edit inputs and re-run</strong> to change the inputs, run the plan again and save it as a new version.
        </div>
      )}

      {p.source === 'custom' && (
        <div className="pf-stats">
          <span><b>{s.fund_count ?? '—'}</b> funds</span>
          {s.weights && <span>Weights: <b>{s.weights}</b></span>}
          {s.risk_profile && <span>Mandate risk: <b>{s.risk_profile}</b></span>}
        </div>
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
