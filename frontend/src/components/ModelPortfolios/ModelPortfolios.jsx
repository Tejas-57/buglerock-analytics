import React, { useState, useEffect } from 'react';
import './ModelPortfolios.css';

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

function Donut({ mix, size = 130 }) {
  const cx = size/2, cy = size/2, r = size*0.36, sw = size*0.16;
  const segs = [
    { pct: mix.Equity,     c: SLEEVE.Equity, l: 'Equity' },
    { pct: mix.Debt,       c: SLEEVE.Debt,   l: 'Debt' },
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
        <div><b>{f2(p.blended.sharpe_3y)}</b><span>Sharpe</span></div>
        <div><b>{p.fund_count}</b><span>Funds</span></div>
      </div>
      <div className="mp-card-horizon">⏱ {p.horizon} · Vol {p.volatility}</div>
    </div>
  );
}

function Detail({ p }) {
  const rc = RISK_COLORS[p.risk_score] || RISK_COLORS[3];
  const b = p.blended;
  const eq = p.actual.equity_pct, db = p.actual.debt_pct;
  const alt = p.actual.cash_other_pct || 0;
  const est = ((eq*15) + (db*7) + (alt*7)) / 100;
  const dbl = est > 0 ? (72/est).toFixed(1) : '—';
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
      </div>

      <div className="mp-alloc">
        <div className="mp-alloc-donut"><Donut mix={p.asset_mix} size={150}/></div>
        <div className="mp-alloc-chips">
          <div className="mp-chip"><b style={{ color: SLEEVE.Equity }}>{eq}%</b><span>Equity (wtd avg)</span><em>Target {p.target.eq_lo}–{p.target.eq_hi}%</em></div>
          <div className="mp-chip"><b style={{ color: SLEEVE.Debt }}>{db}%</b><span>Debt (wtd avg)</span><em>Target {p.target.debt_lo}–{p.target.debt_hi}%</em></div>
          {alt > 0.5 && <div className="mp-chip"><b style={{ color: SLEEVE.Other }}>{alt}%</b><span>Cash & Others</span><em>Cash / other</em></div>}
          <div className="mp-chip"><b>{est.toFixed(1)}%</b><span>Est. return p.a.</span><em>Eq 15% · Debt 7%</em></div>
          <div className="mp-chip"><b>{dbl} yrs</b><span>Time to double</span><em>Rule of 72</em></div>
        </div>
      </div>

      <CapMixBar actual={p.actual} target={p.target}/>

      <div className="mp-metrics">
        {[
          ['1Y Return', pct(b.return_1y), b.return_1y >= 0 ? '#1A7A52' : '#912F63'],
          ['3Y CAGR', pct(b.return_3y), b.return_3y >= 0 ? '#1A7A52' : '#912F63'],
          ['5Y CAGR', pct(b.return_5y), b.return_5y >= 0 ? '#1A7A52' : '#912F63'],
          ['Sharpe (3Y)', f2(b.sharpe_3y), 'var(--text-primary)'],
          ['Std Dev (3Y)', b.std_dev_3y != null ? `${f1(b.std_dev_3y)}%` : '—', 'var(--text-muted)'],
          ['Expense Ratio', b.expense_ratio != null ? `${f2(b.expense_ratio)}%` : '—', 'var(--text-muted)'],
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
              <th>1Y</th><th>3Y</th><th>Sharpe</th><th>ER</th><th>Cap mix</th>
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
                  <td>{f2(f.sharpe_3y)}</td>
                  <td>{f.expense_ratio ? `${f2(f.expense_ratio)}%` : '—'}</td>
                  <td>
                    {f.sleeve === 'Debt' ? <span className="mp-na">N/A</span> : (
                      <div className="mp-mini-cap">
                        <div style={{ flex: f.large_cap || 0, background: CAP.large }} title={`Large ${f1(f.large_cap)}%`}/>
                        <div style={{ flex: f.mid_cap || 0, background: CAP.mid }} title={`Mid ${f1(f.mid_cap)}%`}/>
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

export default function ModelPortfolios({ selectedDate }) {
  const [ports, setPorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(() => localStorage.getItem('mp_sel') || 'balanced');
  const [dataDate, setDataDate] = useState(null);

  const ds = selectedDate ? selectedDate.toISOString().split('T')[0] : null;

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`${API}/api/models/portfolios${ds ? `?date=${ds}` : ''}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setPorts(d.portfolios || []); setDataDate(d.data_date); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ds]);

  const selected = ports.find(p => p.key === sel) || ports[0];

  if (loading) return <div className="mp-page"><div className="mp-loading"><div className="mp-spinner"/><span>Building model portfolios…</span></div></div>;
  if (error) return <div className="mp-page"><div style={{ padding: 40, color: '#B71C1C' }}>Error: {error}</div></div>;

  return (
    <div className="mp-page">
      <div className="mp-header">
        <div>
          <div className="mp-page-title">Model Portfolios</div>
          <div className="mp-page-desc">BugleRock Multi-Asset DPMS · R1/R2 ranked funds · constraint-based construction (linprog)</div>
        </div>
        {dataDate && <div className="mp-data-date">Data: {dataDate}</div>}
      </div>

      <div className="mp-grid">
        {ports.map(p => (
          <OverviewCard key={p.key} p={p} selected={selected?.key === p.key}
            onClick={() => { setSel(p.key); localStorage.setItem('mp_sel', p.key); }}/>
        ))}
      </div>

      {selected && <Detail p={selected}/>}

      <div className="mp-method">
        <div className="mp-method-hd">ℹ Methodology</div>
        <div className="mp-method-body">
          Portfolios are constructed from R1/R2 ranked funds only using a linear-programming solver (HiGHS). Weights are chosen to satisfy each model's effective equity/debt bands and a within-equity cap mix of Large 60% / Mid 25% / Small 15% (±10%), rebased across all equity-bearing exposure including the equity portion of hybrid funds. Effective equity and debt factor in each hybrid fund's underlying equity/debt split. Per-fund weights are bounded 5–15%. Estimated returns assume equity 15% p.a., hybrid 11% p.a., debt 7% p.a. Illustrative only, not a guarantee.
        </div>
      </div>
    </div>
  );
}