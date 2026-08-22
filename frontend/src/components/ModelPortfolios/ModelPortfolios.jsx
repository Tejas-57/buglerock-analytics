import React, { useState, useEffect } from 'react';
import './ModelPortfolios.css';
import PortfolioXRay from '../PortfolioBuilder/steps/analyseTabs/PortfolioXRay.jsx';
import PDFProposal from '../PortfolioBuilder/steps/PDFProposal.jsx';

const API = process.env.REACT_APP_API_URL || '';

const RISK_COLORS = {
  1: { bg: '#E6F4ED', text: '#1A7A52', bar: '#1A7A52' },
  2: { bg: '#EBF4E8', text: '#3A7A30', bar: '#4C8C3C' },
  3: { bg: '#FBF4E0', text: '#7A5A10', bar: '#D97706' },
  4: { bg: '#FEF0E6', text: '#C2540A', bar: '#C2540A' },
  5: { bg: '#FDEAEF', text: '#912F63', bar: '#912F63' },
};
const SLEEVE = { Equity: '#912F63', Hybrid: '#6D5479', Debt: '#3E3452', Gold: '#B8860B', Other: '#A795AE' };
const CAP = { large: '#912F63', mid: '#6D5479', small: '#A795AE' };

const f1 = (v, suf = '') => v == null ? '—' : `${parseFloat(v).toFixed(1)}${suf}`;
const f2 = (v) => v == null ? '—' : parseFloat(v).toFixed(2);
const pct = (v) => { if (v == null) return '—'; const n = parseFloat(v); return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; };
const aum = (v) => !v ? '—' : v >= 100000 ? `₹${(v/100000).toFixed(1)}L Cr` : v >= 1000 ? `₹${(v/1000).toFixed(0)}k Cr` : `₹${Math.round(v)} Cr`;

/* ─── Build a B-object — full shape matching PortfolioXRay's expectations ─── */
function buildBlendedMetrics(p) {
  const b = p.blended || {};
  const a = p.actual  || {};
  return {
    return_1m:        b.return_1m      ?? null,
    return_3m:        b.return_3m      ?? null,
    return_6m:        b.return_6m      ?? null,
    return_ytd:       b.return_ytd     ?? null,
    return_1y:        b.return_1y      ?? null,
    return_3y:        b.return_3y      ?? null,
    return_5y:        b.return_5y      ?? null,
    return_cy2021:    b.return_cy2021  ?? null,
    return_cy2022:    b.return_cy2022  ?? null,
    return_cy2023:    b.return_cy2023  ?? null,
    return_cy2024:    b.return_cy2024  ?? null,
    return_cy2025:    b.return_cy2025  ?? null,
    std_dev_3y:       b.std_dev_3y     ?? null,
    std_dev_5y:       b.std_dev_5y     ?? null,
    sharpe_ratio_3y:  b.sharpe_3y      ?? null,
    sortino_ratio_3y: b.sortino_3y     ?? null,
    beta_3y:          b.beta_3y        ?? null,
    alpha_3y:         b.alpha_3y       ?? null,
    up_capture_3y:    b.up_capture_3y  ?? null,
    down_capture_3y:  b.down_capture_3y ?? null,
    expense_ratio:    b.expense_ratio  ?? null,
    large_cap:        a.large_cap      ?? null,
    mid_cap:          a.mid_cap        ?? null,
    small_cap:        a.small_cap      ?? null,
  };
}

/* ─── Build funds array + weights map ─── */
function buildFundsAndWeights(p) {
  const funds = (p.funds || []).map(f => ({
    isin:     f.isin,
    name:     f.name,
    category: f.category,
    color:    SLEEVE[f.sleeve] || '#912F63',
  }));
  const weights = {};
  (p.funds || []).forEach(f => { weights[f.isin] = f.weight; });
  return { funds, weights };
}

/* ─── Build snapshots map — full shape matching PortfolioXRay + PDFProposal ─── */
function buildSnapshots(p) {
  const snapshots = {};
  (p.funds || []).forEach(f => {
    snapshots[f.isin] = {
      asset_class:  f.asset_class || f.sleeve,
      sub_category: f.category,
      category:     f.category,
      ranking:      f.ranking,
      equity_pct:   f.sleeve === 'Equity' ? 100 : f.sleeve === 'Hybrid' ? (f.equity_pct ?? 65) : 0,
      bond_pct:     f.sleeve === 'Debt'   ? 100 : f.sleeve === 'Hybrid' ? (f.bond_pct   ?? 30) : 0,
      cash_pct:     0,
      large_cap:    f.large_cap,
      mid_cap:      f.mid_cap,
      small_cap:    f.small_cap,
      expense_ratio: f.expense_ratio,
      returns: {
        '1y':    f.return_1y    ?? null,
        '3y':    f.return_3y    ?? null,
        '5y':    f.return_5y    ?? null,
        '1m':    f.return_1m    ?? null,
        '3m':    f.return_3m    ?? null,
        '6m':    f.return_6m    ?? null,
        'ytd':   f.return_ytd   ?? null,
        'cy2025': f.return_cy2025 ?? null,
        'cy2024': f.return_cy2024 ?? null,
        'cy2023': f.return_cy2023 ?? null,
        'cy2022': f.return_cy2022 ?? null,
        'cy2021': f.return_cy2021 ?? null,
      },
      risk: {
        std_dev_3y:       f.std_dev_3y      ?? null,
        std_dev_5y:       f.std_dev_5y      ?? null,
        sharpe_ratio_3y:  f.sharpe_3y       ?? null,
        sortino_ratio_3y: f.sortino_3y      ?? null,
        alpha_3y:         f.alpha_3y        ?? null,
        beta_3y:          f.beta_3y         ?? null,
        up_capture_3y:    f.up_capture_3y   ?? null,
        down_capture_3y:  f.down_capture_3y ?? null,
        expense_ratio:    f.expense_ratio   ?? null,
      },
    };
  });
  return snapshots;
}

/* ─── Adapter: build PDFProposal props from a model portfolio object ─── */
function buildPDFProps(p) {
  const funds = (p.funds || []).map(f => ({
    isin:        f.isin,
    name:        f.name,
    category:    f.category,
    asset_class: f.asset_class || f.sleeve,
    color:       SLEEVE[f.sleeve] || '#912F63',
  }));
  const weights = {};
  (p.funds || []).forEach(f => { weights[f.isin] = f.weight; });
  const snapshots = buildSnapshots(p);
  const ips = {
    name:             p.label,
    rm:               'BugleRock Capital',
    amount:           null,
    monthlySIP:       null,
    tenure:           '10',
    primaryObjective: p.suitability || 'Wealth creation',
    riskProfile:      p.risk || 'Moderate',
    targetReturn:     null,
    deploymentMode:   null,
    reviewFrequency:  'Quarterly',
    constraints:      null,
    notes:            `BugleRock Model Portfolio — ${p.label}. Constructed from R1/R2 ranked funds only using a linear-programming solver (HiGHS). Weights satisfy effective equity/debt bands and within-equity cap mix constraints. Per-fund weights bounded 5–15%.`,
    proposalDate:     null,
  };
  return { funds, weights, snapshots, ips };
}

/* ─── Modal overlay wrapper ─── */
function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="mp-modal-backdrop" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>
        <div className="mp-modal-hd">
          <div>
            <div className="mp-modal-title">{title}</div>
            {subtitle && <div className="mp-modal-sub">{subtitle}</div>}
          </div>
          <button className="mp-modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="mp-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─── Donut chart ─── */
function Donut({ mix, size = 130 }) {
  const cx = size/2, cy = size/2, r = size*0.36, sw = size*0.16;
  const segs = [
    { pct: mix.Equity,           c: SLEEVE.Equity, l: 'Equity' },
    { pct: mix.Debt,             c: SLEEVE.Debt,   l: 'Debt' },
    { pct: mix["Cash & Others"], c: SLEEVE.Other,  l: 'Cash & Others' },
  ].filter(s => s.pct > 0.5);
  const circ = 2*Math.PI*r;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={sw}/>
      {segs.map((s, i) => {
        const dash = (s.pct/100)*circ;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.c} strokeWidth={sw}
            strokeDasharray={`${dash} ${circ-dash}`} strokeDashoffset={-off + circ*0.25}>
            <title>{s.l}: {s.pct}%</title>
          </circle>
        );
        off += dash;
        return el;
      })}
    </svg>
  );
}

function CapMixBar({ actual, target }) {
  const rows = [
    { k: 'large', label: 'Large cap', val: actual.large_cap, tgt: target.large_cap },
    { k: 'mid',   label: 'Mid cap',   val: actual.mid_cap,   tgt: target.mid_cap },
    { k: 'small', label: 'Small cap', val: actual.small_cap, tgt: target.small_cap },
  ];
  return (
    <div className="mp-capmix">
      <div className="mp-section-label">Within-equity cap mix (rebased)</div>
      {rows.map(r => {
        const inRange = r.val != null && Math.abs(r.val - r.tgt) <= target.cap_tol;
        return (
          <div key={r.k} className="mp-capmix-row">
            <div className="mp-capmix-label">{r.label}</div>
            <div className="mp-capmix-track">
              <div className="mp-capmix-fill" style={{ width: `${Math.min(r.val || 0, 100)}%`, background: CAP[r.k] }}/>
              <div className="mp-capmix-target" style={{ left: `${r.tgt}%` }} title={`Target ${r.tgt}%`}/>
            </div>
            <div className="mp-capmix-val" style={{ color: inRange ? '#1A7A52' : '#C2540A' }}>
              {f1(r.val, '%')}
              <span className="mp-capmix-tgt-txt">/ {r.tgt}±{target.cap_tol}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OverviewCard({ p, selected, onClick }) {
  const rc = RISK_COLORS[p.risk_score] || RISK_COLORS[3];
  return (
    <div className={`mp-card ${selected ? 'mp-card--sel' : ''}`} onClick={onClick}>
      <div className="mp-card-top">
        <span className="mp-card-label" style={{ color: rc.text }}>{p.label}</span>
        <span className="mp-card-risk" style={{ background: rc.bg, color: rc.text }}>{p.risk}</span>
      </div>
      <div className="mp-card-donut">
        <Donut mix={p.asset_mix} size={96}/>
      </div>
      <div className="mp-card-legend">
        <div><i style={{ background: SLEEVE.Equity }}/>Equity {p.actual.equity_pct}%</div>
        <div><i style={{ background: SLEEVE.Debt }}/>Debt {p.actual.debt_pct}%</div>
        {p.actual.cash_other_pct > 0.5 && <div><i style={{ background: SLEEVE.Other }}/>Cash & Others {p.actual.cash_other_pct}%</div>}
      </div>
      <div className="mp-card-stats">
        <div><b style={{ color: p.blended.return_3y >= 0 ? '#1A7A52' : '#912F63' }}>{pct(p.blended.return_3y)}</b><span>3Y CAGR</span></div>
        <div><b>{p.blended.std_dev_3y != null ? `${f1(p.blended.std_dev_3y)}%` : '—'}</b><span>3Y SD</span></div>
        <div><b>{p.fund_count}</b><span>Funds</span></div>
      </div>
      <div className="mp-card-horizon">⏱ {p.horizon} · Vol {p.volatility}</div>
    </div>
  );
}

function Detail({ p, onXRay, onPDF }) {
  const rc = RISK_COLORS[p.risk_score] || RISK_COLORS[3];
  const b = p.blended;
  const eq = p.actual.equity_pct, db = p.actual.debt_pct;
  const alt = p.actual.cash_other_pct || 0;
  const dbl = b.return_5y > 0 ? (72 / b.return_5y).toFixed(1) : '—';
  return (
    <div className="mp-detail">
      <div className="mp-detail-hd">
        <div>
          <div className="mp-detail-badges">
            <span className="mp-card-risk" style={{ background: rc.bg, color: rc.text }}>{p.risk}</span>
            <span className="mp-detail-meta">Horizon {p.horizon} · Volatility {p.volatility} · Max DD {p.max_drawdown}</span>
          </div>
          <div className="mp-detail-title">{p.label}</div>
          <div className="mp-detail-sub">{p.suitability}</div>
        </div>
        <div className="mp-detail-actions">
          <button className="mp-btn mp-btn--secondary" onClick={onXRay}>
            <span className="mp-btn-icon">🔬</span> View Portfolio X-Ray
          </button>
          <button className="mp-btn mp-btn--primary" onClick={onPDF}>
            <span className="mp-btn-icon">📄</span> Generate PDF
          </button>
        </div>
      </div>

      <div className="mp-alloc">
        <div className="mp-alloc-donut"><Donut mix={p.asset_mix} size={150}/></div>
        <div className="mp-alloc-chips">
          <div className="mp-chip"><b style={{ color: SLEEVE.Equity }}>{eq}%</b><span>Equity (wtd avg)</span><em>Target {p.target.eq_lo}–{p.target.eq_hi}%</em></div>
          <div className="mp-chip"><b style={{ color: SLEEVE.Debt }}>{db}%</b><span>Debt (wtd avg)</span><em>Target {p.target.debt_lo}–{p.target.debt_hi}%</em></div>
          {alt > 0.5 && <div className="mp-chip"><b style={{ color: SLEEVE.Other }}>{alt}%</b><span>Cash & Others</span><em>Cash / other</em></div>}
          <div className="mp-chip"><b style={{ color: b.return_5y >= 0 ? '#1A7A52' : '#912F63' }}>{pct(b.return_5y)}</b><span>5Y CAGR (wtd avg)</span><em>Actual blended return</em></div>
          <div className="mp-chip"><b>{dbl} yrs</b><span>Time to double</span><em>Rule of 72</em></div>
        </div>
      </div>

      <CapMixBar actual={p.actual} target={p.target}/>

      <div className="mp-metrics">
        {[
          ['1Y Return',    pct(b.return_1y),   b.return_1y    >= 0 ? '#1A7A52' : '#912F63'],
          ['3Y CAGR',      pct(b.return_3y),   b.return_3y    >= 0 ? '#1A7A52' : '#912F63'],
          ['5Y CAGR',      pct(b.return_5y),   b.return_5y    >= 0 ? '#1A7A52' : '#912F63'],
          ['Std Dev (3Y)', b.std_dev_3y  != null ? `${f1(b.std_dev_3y)}%`  : '—', 'var(--text-muted)'],
          ['Std Dev (5Y)', b.std_dev_5y  != null ? `${f1(b.std_dev_5y)}%`  : '—', 'var(--text-muted)'],
          ['Sharpe (3Y)',  f2(b.sharpe_3y), 'var(--text-primary)'],
          ['Expense Ratio',b.expense_ratio != null ? `${f2(b.expense_ratio)}%` : '—', 'var(--text-muted)'],
        ].map(([l, v, c]) => (
          <div key={l} className="mp-metric"><b style={{ color: c }}>{v}</b><span>{l}</span></div>
        ))}
      </div>

      <div className="mp-table-card">
        <div className="mp-table-hd">Fund holdings — {p.fund_count} funds · R1/R2 only · solver-weighted</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="mp-table">
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Fund</th>
              <th>Sleeve</th><th>Rank</th><th>Weight</th>
              <th>1Y</th><th>3Y</th><th>Std Dev 3Y</th><th>Std Dev 5Y</th><th>Sharpe</th><th>ER</th><th>Cap mix</th>
            </tr></thead>
            <tbody>
              {p.funds.map(f => (
                <tr key={f.isin}>
                  <td style={{ textAlign: 'left' }}>
                    <div className="mp-fname">{f.name}</div>
                    <div className="mp-fcat">{(f.category || '').replace(/^(India Fund |India OE |Cat: )/, '')}</div>
                  </td>
                  <td><span className="mp-sleeve" style={{ background: `${SLEEVE[f.sleeve]}18`, color: SLEEVE[f.sleeve] }}>{f.sleeve}</span></td>
                  <td><span className={`mp-rank mp-rank-${f.ranking}`}>{f.ranking}</span></td>
                  <td className="mp-wt">{f.weight}%</td>
                  <td style={{ color: f.return_1y >= 0 ? '#1A7A52' : '#912F63' }}>{pct(f.return_1y)}</td>
                  <td style={{ color: f.return_3y >= 0 ? '#1A7A52' : '#912F63' }}>{pct(f.return_3y)}</td>
                  <td>{f.std_dev_3y != null ? `${f1(f.std_dev_3y)}%` : '—'}</td>
                  <td>{f.std_dev_5y != null ? `${f1(f.std_dev_5y)}%` : '—'}</td>
                  <td>{f2(f.sharpe_3y)}</td>
                  <td>{f.expense_ratio ? `${f2(f.expense_ratio)}%` : '—'}</td>
                  <td>
                    {f.sleeve === 'Debt' ? <span className="mp-na">N/A</span> : (
                      <div className="mp-mini-cap">
                        <div style={{ flex: f.large_cap || 0, background: CAP.large }} title={`Large ${f1(f.large_cap)}%`}/>
                        <div style={{ flex: f.mid_cap   || 0, background: CAP.mid   }} title={`Mid ${f1(f.mid_cap)}%`}/>
                        <div style={{ flex: f.small_cap || 0, background: CAP.small }} title={`Small ${f1(f.small_cap)}%`}/>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main component
════════════════════════════════════════════════════════════════════ */
export default function ModelPortfolios({ selectedDate }) {
  const [ports, setPorts]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [sel, setSel]           = useState(() => localStorage.getItem('mp_sel') || 'balanced');
  const [dataDate, setDataDate] = useState(null);

  // Modal state
  const [xrayOpen, setXrayOpen] = useState(false);
  const [pdfOpen, setPdfOpen]   = useState(false);

  // X-Ray data — fetched lazily on modal open, keyed by portfolio key
  const [xrayKey, setXrayKey]               = useState(null);
  const [stressData, setStressData]         = useState(null);
  const [histVar, setHistVar]               = useState(null);
  const [histVarLoading, setHistVarLoading] = useState(false);
  const [overlapData, setOverlapData]       = useState(null);
  const [overlapStatus, setOverlapStatus]   = useState(null);

  const ds = selectedDate ? selectedDate.toISOString().split('T')[0] : null;

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`${API}/api/models/portfolios${ds ? `?date=${ds}` : ''}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setPorts(d.portfolios || []); setDataDate(d.data_date); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ds]);

  const selected = ports.find(p => p.key === sel) || ports[0];

  const openXray = () => {
    setXrayOpen(true);
    if (!selected) return;
    if (xrayKey === selected.key) return; // already fetched

    setXrayKey(selected.key);
    setStressData(null);
    setHistVar(null);
    setOverlapData(null);
    setOverlapStatus(null);

    const funds   = selected.funds || [];
    const isins   = funds.map(f => f.isin).join(',');
    const weights = funds.map(f => f.weight).join(',');
    if (!isins) return;

    // 1. Stress test
    fetch(`${API}/api/nav/stress-test?isins=${encodeURIComponent(isins)}&weights=${encodeURIComponent(weights)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setStressData(d))
      .catch(() => {});

    // 2. Historical VaR
    const cats = funds.map(f => f.category || '').join(',');
    const acs  = funds.map(f => (f.asset_class || f.sleeve || '').toLowerCase()).join(',');
    const sds  = funds.map(f => { const v = parseFloat(f.std_dev_3y); return isNaN(v) ? -1 : v; }).join(',');
    setHistVarLoading(true);
    fetch(`${API}/api/holdings/historical-var`
      + `?isins=${encodeURIComponent(isins)}`
      + `&weights=${encodeURIComponent(weights)}`
      + `&categories=${encodeURIComponent(cats)}`
      + `&asset_classes=${encodeURIComponent(acs)}`
      + `&std_devs=${encodeURIComponent(sds)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setHistVar(d); setHistVarLoading(false); })
      .catch(() => setHistVarLoading(false));

    // 3. Overlap
    const equityFunds = funds.filter(f => {
      const ac = (f.asset_class || f.sleeve || '').toLowerCase();
      return ac === 'equity' || ac === 'hybrid';
    });
    if (equityFunds.length >= 2) {
      const eqIsins = equityFunds.map(f => f.isin).join(',');
      setOverlapStatus('loading');
      (async () => {
        try {
          const r1 = await fetch(`${API}/api/holdings/overlap?isins=${encodeURIComponent(eqIsins)}`);
          if (!r1.ok) throw new Error('overlap failed');
          const d1 = await r1.json();
          const missing = equityFunds.filter(f => (d1.fund_holdings_counts?.[f.isin] ?? -1) === 0);
          if (missing.length === 0) { setOverlapData(d1); setOverlapStatus('done'); return; }

          setOverlapStatus('fetching-holdings');
          await Promise.all(missing.map(f =>
            fetch(`${API}/api/holdings/fetch/${f.isin}`, { method: 'POST' }).catch(() => {})
          ));
          for (let i = 0; i < 30; i++) {
            await new Promise(res => setTimeout(res, 2000));
            const r2 = await fetch(`${API}/api/holdings/overlap?isins=${encodeURIComponent(eqIsins)}`);
            if (!r2.ok) continue;
            const d2 = await r2.json();
            if (equityFunds.filter(f => (d2.fund_holdings_counts?.[f.isin] ?? -1) === 0).length === 0) {
              setOverlapData(d2); setOverlapStatus('done'); return;
            }
          }
          const rFinal = await fetch(`${API}/api/holdings/overlap?isins=${encodeURIComponent(eqIsins)}`);
          if (rFinal.ok) setOverlapData(await rFinal.json());
          setOverlapStatus('done');
        } catch { setOverlapStatus('error'); }
      })();
    }
  };

  if (loading) return <div className="mp-page"><div className="mp-loading"><div className="mp-spinner"/><span>Building model portfolios…</span></div></div>;
  if (error)   return <div className="mp-page"><div style={{ padding: 40, color: '#B71C1C' }}>Error: {error}</div></div>;

  const xrayProps = selected ? {
    B:              buildBlendedMetrics(selected),
    AC:             {},
    funds:          buildFundsAndWeights(selected).funds,
    weights:        buildFundsAndWeights(selected).weights,
    snapshots:      buildSnapshots(selected),
    benchmarks:     [],
    bmRets:         null,
    ips:            null,
    overlapData:    xrayKey === selected.key ? overlapData    : null,
    histVar:        xrayKey === selected.key ? histVar        : null,
    histVarLoading: xrayKey === selected.key ? histVarLoading : false,
    stressData:     xrayKey === selected.key ? stressData     : null,
    bmStress:       null,
  } : null;

  return (
    <div className="mp-page">
      <div className="mp-header">
        <div>
          <div className="mp-page-title">Model Portfolios</div>
          <div className="mp-page-desc">BugleRock Multi-Asset Model Portfolios · R1/R2 ranked funds · Constraint-based Construction</div>
        </div>
        {dataDate && <div className="mp-data-date">Data: {dataDate}</div>}
      </div>

      <div className="mp-grid">
        {ports.map(p => (
          <OverviewCard key={p.key} p={p} selected={selected?.key === p.key}
            onClick={() => { setSel(p.key); localStorage.setItem('mp_sel', p.key); }}/>
        ))}
      </div>

      {selected && (
        <Detail
          p={selected}
          onXRay={openXray}
          onPDF={() => setPdfOpen(true)}
        />
      )}

      <div className="mp-method">
        <div className="mp-method-hd">ℹ Methodology</div>
        <div className="mp-method-body">
          Portfolios are constructed from R1/R2 ranked funds only using a linear-programming solver (HiGHS). Weights are chosen to satisfy each model's effective equity/debt bands and a within-equity cap mix of Large 60% / Mid 25% / Small 15% (±10%), rebased across all equity-bearing exposure including the equity portion of hybrid funds. Effective equity and debt factor in each hybrid fund's underlying equity/debt split. Per-fund weights are bounded 5–15%. Estimated returns assume equity 15% p.a., hybrid 11% p.a., debt 7% p.a. Illustrative only, not a guarantee.
        </div>
      </div>

      {/* ── Portfolio X-Ray Modal ── */}
      {xrayOpen && selected && xrayProps && (
        <Modal
          title={`Portfolio X-Ray — ${selected.label}`}
          subtitle={
            `${selected.fund_count} funds · ${selected.risk} profile · Data: ${dataDate || '—'}`
            + (overlapStatus === 'fetching-holdings' ? ' · Fetching holdings data…' : '')
            + (histVarLoading ? ' · Computing VaR…' : '')
          }
          onClose={() => setXrayOpen(false)}
        >
          <PortfolioXRay {...xrayProps} />
        </Modal>
      )}

      {/* ── PDF Proposal Modal ── */}
      {pdfOpen && selected && (() => {
        const { funds, weights, snapshots, ips } = buildPDFProps(selected);
        return (
          <Modal
            title={`PDF Proposal — ${selected.label}`}
            subtitle="Select sections, then click Download PDF — opens in a new tab."
            onClose={() => setPdfOpen(false)}
          >
            <PDFProposal
              funds={funds}
              weights={weights}
              originalWeights={{}}
              snapshots={snapshots}
              benchmarks={[]}
              ips={ips}
              selectedPortfolio="original"
              setSelectedPortfolio={() => {}}
              onEditPortfolio={() => setPdfOpen(false)}
              onCompare={() => {}}
              analyseData={{
                stressData:  xrayKey === selected.key ? stressData  : null,
                overlapData: xrayKey === selected.key ? overlapData : null,
                corrData:    null,
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}