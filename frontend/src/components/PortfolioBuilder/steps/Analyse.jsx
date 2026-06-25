import React, { useState } from 'react';
import { fp, f2 } from './BuildPortfolio';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'returns', label: 'Returns & projections' },
  { id: 'risk', label: 'Risk metrics' },
  { id: 'exposure', label: 'Exposure' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'funds', label: 'Fund details' },
];

function blendFromSnaps(funds, weights, snapshots) {
  // Same approach as Watchlist — use snapshot data
  function get(isin, getter) {
    const snap = snapshots[isin];
    if (!snap) return null;
    const v = getter(snap);
    if (v==null||v==='-'||v===''||isNaN(parseFloat(v))) return null;
    return parseFloat(v);
  }
  function wblend(getter) {
    let val=0, cov=0;
    funds.forEach(f => {
      const v = get(f.isin, getter);
      if (v==null||isNaN(v)) return;
      val += v*(weights[f.isin]||0); cov += (weights[f.isin]||0);
    });
    return cov>0 ? val/cov : null;
  }
  return {
    return_1y:       wblend(s=>s.returns?.['1y']),
    return_3y:       wblend(s=>s.returns?.['3y']),
    return_5y:       wblend(s=>s.returns?.['5y']),
    return_1m:       wblend(s=>s.returns?.['1m']),
    return_3m:       wblend(s=>s.returns?.['3m']),
    return_ytd:      wblend(s=>s.returns?.['ytd']),
    return_cy2025:   wblend(s=>s.returns?.['cy2025']),
    return_cy2024:   wblend(s=>s.returns?.['cy2024']),
    return_cy2023:   wblend(s=>s.returns?.['cy2023']),
    return_cy2022:   wblend(s=>s.returns?.['cy2022']),
    return_cy2021:   wblend(s=>s.returns?.['cy2021']),
    sharpe_ratio_3y: wblend(s=>s.risk?.sharpe_ratio_3y),
    sortino_ratio_3y:wblend(s=>s.risk?.sortino_ratio_3y),
    alpha_3y:        wblend(s=>s.risk?.alpha_3y),
    beta_3y:         wblend(s=>s.risk?.beta_3y),
    down_capture_3y: wblend(s=>s.risk?.down_capture_3y),
    up_capture_3y:   wblend(s=>s.risk?.up_capture_3y),
    std_dev_3y:      wblend(s=>s.risk?.std_dev_3y),
    expense_ratio:   wblend(s=>s.expense_ratio),
    large_cap:       wblend(s=>s.large_cap),
    mid_cap:         wblend(s=>s.mid_cap),
    small_cap:       wblend(s=>s.small_cap),
    equity_pct:      wblend(s=>s.equity_pct),
    bond_pct:        wblend(s=>s.bond_pct),
    cash_pct:        wblend(s=>s.cash_pct),
    other_pct:       wblend(s=>s.other_pct),
    pe_ratio:        wblend(s=>s.pe_ratio),
    pb_ratio:        wblend(s=>s.pb_ratio),
    expense_ratio:   wblend(s=>s.expense_ratio),
    fund_size:       wblend(s=>s.fund_size),
  };
}
function blend(funds, weights, keys) { return {}; } // legacy stub


const CY_KEYS = ['cy2021','cy2022','cy2023','cy2024','cy2025'];
const CY_LBL  = ['2021','2022','2023','2024','2025'];

function pearson(a, b) {
  const pairs = a.map((v, i) => [v, b[i]]).filter(p => p[0] != null && p[1] != null);
  if (pairs.length < 2) return null;
  const n = pairs.length;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
  const num = pairs.reduce((s, p) => s + (p[0] - ma) * (p[1] - mb), 0);
  const da = Math.sqrt(pairs.reduce((s, p) => s + Math.pow(p[0] - ma, 2), 0));
  const db = Math.sqrt(pairs.reduce((s, p) => s + Math.pow(p[1] - mb, 2), 0));
  if (da === 0 || db === 0) return null;
  return num / (da * db);
}

function corrColor(v) {
  if (v == null) return { bg: '#f5f5f5', color: '#999' };
  if (v >= 0.9) return { bg: '#fde8ee', color: '#912F63' };
  if (v >= 0.7) return { bg: '#fef3e2', color: '#D97706' };
  if (v >= 0.5) return { bg: '#f0f9f5', color: '#1A7A52' };
  return { bg: '#eef0f7', color: '#3E3452' };
}

function fmtL(v) { return v >= 100000 ? '₹' + (v / 100000).toFixed(2) + 'L' : '₹' + (v / 1000).toFixed(1) + 'K'; }

export default function Analyse({ funds, weights, snapshots={}, benchmarks=[], ips, onEdit, onOptimise }) {
  const [activeTab, setActiveTab] = useState('overview');

  // Compute blended benchmark from benchmarks array (manual weights)
  const totalBmW = benchmarks.reduce((s, b) => s + (b.weight || 0), 0) || 1;
  function blendBm(getter) {
    let val = 0, cov = 0;
    benchmarks.forEach(b => {
      const v = getter(b);
      if (v == null || isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (b.weight || 0);
      cov += (b.weight || 0);
    });
    return cov > 0 ? val / cov : null;
  }

  const bm = benchmarks.length > 0 ? {
    name: benchmarks.length === 1
      ? benchmarks[0].display_name
      : benchmarks.map(b => `${b.display_name} (${b.weight}%)`).join(' + '),
    rets: {
      r1y:  blendBm(b => b.return_1y),
      r3y:  blendBm(b => b.return_3y),
      r5y:  blendBm(b => b.return_5y),
      cy25: blendBm(b => b.return_cy2025),
      cy24: blendBm(b => b.return_cy2024),
      cy23: blendBm(b => b.return_cy2023),
      cy22: blendBm(b => b.return_cy2022),
      cy21: blendBm(b => b.return_cy2021),
      r1m:  blendBm(b => b.return_1m),
      r3m:  blendBm(b => b.return_3m),
      ytd:  blendBm(b => b.return_ytd),
    }
  } : {
    name: 'No benchmark selected',
    rets: { r1y: null, r3y: null, r5y: null, cy25: null, cy24: null, cy23: null, cy22: null, cy21: null, r1m: null, r3m: null, ytd: null }
  };
  const B = blendFromSnaps(funds, weights, snapshots);
  const total = funds.reduce((s, f) => s + (weights[f.isin] || 0), 0);

  const investAmt = ips?.amount ? parseFloat(ips.amount.replace(/[^0-9.]/g, '')) : 1000000;
  const sipAmt = ips?.monthlySIP ? parseFloat(ips.monthlySIP.replace(/[^0-9.]/g, '')) : 10000;

  function sipFV(m, r, y) { const mo = r / 100 / 12; if (mo === 0) return m * 12 * y; return m * ((Math.pow(1 + mo, 12 * y) - 1) / mo) * (1 + mo); }

  const RISK_METRICS = [
    { k: 'sharpe_ratio_3y',  l: 'Sharpe (3Y)',  good: 0.6,  lb: false, fmt: v => f2(v),        sig: v => v > 0.7 ? ['Strong','pos'] : v > 0.4 ? ['Adequate','warn'] : ['Weak','neg'] },
    { k: 'sortino_ratio_3y', l: 'Sortino (3Y)', good: 0.8,  lb: false, fmt: v => f2(v),        sig: v => v > 1.0 ? ['Strong','pos'] : v > 0.6 ? ['Moderate','warn'] : ['Weak','neg'] },
    { k: 'alpha_3y',   l: 'Alpha (3Y)',   good: 0,    lb: false, fmt: v => fp(v),        sig: v => v > 2 ? ['Outperform','pos'] : v > 0 ? ['Positive','pos'] : ['Lagging','neg'] },
    { k: 'beta_3y',    l: 'Beta (3Y)',    good: 1.1,  lb: true,  fmt: v => f2(v),        sig: v => v < 0.8 ? ['Defensive','pos'] : v < 1.1 ? ['Mkt-like','pos'] : ['Aggressive','neg'] },
    { k: 'up_capture_3y',   l: 'Up capture',  good: 95,   lb: false, fmt: v => f2(v) + '%',  sig: v => v > 105 ? ['High','pos'] : v > 95 ? ['On par','pos'] : ['Low','warn'] },
    { k: 'down_capture_3y',   l: 'Dn capture',  good: 100,  lb: true,  fmt: v => f2(v) + '%',  sig: v => v < 90 ? ['Protected','pos'] : v < 100 ? ['Moderate','warn'] : ['Exposed','neg'] },
    { k: 'std_dev_3y',   l: 'Std dev (3Y)', good: 16,  lb: true,  fmt: v => f2(v) + '%',  sig: v => v < 12 ? ['Low vol','pos'] : v < 18 ? ['Moderate','warn'] : ['High vol','neg'] },
  ];
  const SIG_COL = { pos: 'var(--pos)', warn: '#D97706', neg: 'var(--brand-primary)' };
  const SIG_BG  = { pos: '#E6F4ED',    warn: '#FEF9EC', neg: 'rgba(145,47,99,.06)' };

  // Correlation matrix — use snapshot CY returns
  const corrMatrix = funds.map(fi => funds.map(fj => {
    if (fi.isin === fj.isin) return 1.0;
    const snapI = snapshots[fi.isin];
    const snapJ = snapshots[fj.isin];
    if (!snapI || !snapJ) return null;
    const vI = CY_KEYS.map(k => {
      const v = snapI.returns?.[k];
      return (v==null||v==='-') ? null : parseFloat(v);
    });
    const vJ = CY_KEYS.map(k => {
      const v = snapJ.returns?.[k];
      return (v==null||v==='-') ? null : parseFloat(v);
    });
    return pearson(vI, vJ);
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Tab bar */}
      <div className="ptf-tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`ptf-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
        <div className="ptf-tab-actions">
          <button className="btn btn-ghost" onClick={onEdit} style={{ fontSize: 11 }}>← Edit</button>
          <button className="btn btn-primary" onClick={onOptimise} style={{ fontSize: 11 }}>Optimise →</button>
        </div>
      </div>

      <div className="ptf-analytics">

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div>
            {/* KPI strip */}
            <div className="ptf-kpi-row" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))', marginBottom: 14 }}>
              {[
                { v: fp(B.return_1y), l: '1Y Return', pos: B.return_1y >= 0 },
                { v: fp(B.return_3y), l: '3Y CAGR', pos: B.return_3y >= 0 },
                { v: fp(B.return_5y), l: '5Y CAGR', pos: B.return_5y >= 0 },
                { v: f2(B.sharpe_ratio_3y), l: 'Sharpe (3Y)', pos: B.sharpe_ratio_3y >= 0.5 },
                { v: fp(B.alpha_3y), l: 'Alpha (3Y)', pos: B.alpha_3y >= 0 },
                { v: f2(B.expense_ratio) + '%', l: 'Blended ER', pos: B.expense_ratio <= 1 },
              ].map((k, i) => (
                <div key={i} className="ptf-kpi">
                  <div className="ptf-kpi-val" style={{ color: k.pos ? 'var(--pos)' : 'var(--brand-primary)' }}>{k.v}</div>
                  <div className="ptf-kpi-lbl">{k.l}</div>
                </div>
              ))}
            </div>

            {/* Allocation + cap split */}
            <div className="ptf-2col">
              <div className="ptf-card">
                <div className="ptf-card-hd">Fund allocation</div>
                <div style={{ padding: '12px 14px' }}>
                  {/* Allocation bar */}
                  <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', gap: 2, marginBottom: 12 }}>
                    {funds.map((f, i) => <div key={f.isin} style={{ flex: weights[f.isin] || 0, background: f.color }} />)}
                  </div>
                  {funds.map((f, i) => {
                    const fsnap = snapshots[f.isin];
                    return (
                    <div key={f.isin} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                      <div style={{ width: 3, height: 30, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{f.name}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{f.category}{fsnap?.returns?.['3y'] != null && fsnap.returns['3y'] !== '-' ? ' · 3Y ' + fp(fsnap.returns['3y']) : ''}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: f.color }}>{weights[f.isin] || 0}%</div>
                    </div>
                    );
                  })}
                </div>
              </div>
              <div className="ptf-card">
                <div className="ptf-card-hd">Market cap & asset mix</div>
                <div style={{ padding: '12px 14px' }}>
                  {[
                    [B.large_cap, 'Large cap', 'var(--brand-primary)'],
                    [B.mid_cap, 'Mid cap', 'var(--muted-pur,#6D5479)'],
                    [B.small_cap, 'Small cap', '#C46985'],
                    [B.bond_pct, 'Bonds/Debt', 'var(--lav-grey,#A795AE)'],
                    [B.cash_pct, 'Cash/Liquid', 'var(--text-muted)'],
                  ].filter(r => (r[0] || 0) > 0.1).map(([v, lbl, clr], i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', width: 68, textAlign: 'right', flexShrink: 0 }}>{lbl}</div>
                      <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: Math.min(v || 0, 100).toFixed(1) + '%', height: '100%', background: clr, borderRadius: 4 }} />
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: clr, minWidth: 36, textAlign: 'right' }}>{(v || 0).toFixed(1)}%</div>
                    </div>
                  ))}
                  {B.pe_ratio > 0 || B.pb_ratio > 0 ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      {B.pe_ratio > 0 && <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)' }}>{f2(B.pe_ratio)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>P/E ratio</div>
                      </div>}
                      {B.pb_ratio > 0 && <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)' }}>{f2(B.pb_ratio)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>P/B ratio</div>
                      </div>}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Calendar year chart */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Calendar year performance vs {bm.name}</div>
              <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                <svg width="100%" height="110" viewBox="0 0 500 110" preserveAspectRatio="xMidYMid meet">
                  {(() => {
                    const cyV = CY_KEYS.map(k => B['return_'+k]); // e.g. return_cy2021
                    const bmV = ['cy21','cy22','cy23','cy24','cy25'].map(k => bm.rets[k]);
                    const mx = Math.max(...cyV.concat(bmV).filter(v => v != null).map(Math.abs).concat([5]));
                    const PH = 92, ZH = 18;
                    return CY_KEYS.map((k, i) => {
                      const fv = cyV[i], bv = bmV[i];
                      const x = i * 96, bw = 36, gp = 4;
                      const fh = fv != null ? Math.max(2, Math.abs(fv) / mx * PH) : 0;
                      const bh = bv != null ? Math.max(2, Math.abs(bv) / mx * PH) : 0;
                      const diff = fv != null && bv != null ? fv - bv : null;
                      return (
                        <g key={k}>
                          {diff != null && <text x={x + bw} y={PH - Math.max(fh, bh) - 5} textAnchor="middle" fontSize="8" fontWeight="700" fill={diff >= 0 ? 'var(--pos)' : 'var(--brand-primary)'} fontFamily="sans-serif">{diff >= 0 ? '+' : ''}{diff.toFixed(1)}%</text>}
                          {fv != null && <rect x={x} y={PH - fh} width={bw} height={fh} fill={fv >= 0 ? 'var(--brand-primary)' : '#C46985'} rx="2" />}
                          {bv != null && <rect x={x + bw + gp} y={PH - bh} width={bw - 4} height={bh} fill="var(--lav-grey,#A795AE)" rx="2" opacity=".8" />}
                          <text x={x + bw} y={107} textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="sans-serif">{CY_LBL[i]}</text>
                        </g>
                      );
                    });
                  })()}
                  <line x1="0" y1="92" x2="500" y2="92" stroke="var(--border)" strokeWidth="1" />
                </svg>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 9, color: 'var(--text-muted)' }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--brand-primary)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Portfolio</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lav-grey,#A795AE)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle', opacity: .8 }}></span>{bm.name}</span>
                  <span style={{ fontStyle: 'italic' }}>Δ above bars = outperformance</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── RETURNS & PROJECTIONS ── */}
        {activeTab === 'returns' && (
          <div>
            {/* Return pills */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
              {[
                { v: fp(B.return_1m), l: '1M Return' },
                { v: fp(B.return_3m), l: '3M Return' },
                { v: fp(B.return_1y), l: '1Y Return' },
                { v: fp(B.return_3y), l: '3Y CAGR' },
                { v: fp(B.return_5y), l: '5Y CAGR' },
                { v: fp(B.return_ytd), l: 'YTD' },
                { v: fp(B.return_cy2025), l: 'CY 2025' },
                { v: fp(B.return_cy2024), l: 'CY 2024' },
              ].map((p, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '11px 10px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, marginBottom: 3, color: (parseFloat(p.v) || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{p.v}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{p.l}</div>
                </div>
              ))}
            </div>

            {/* Projection cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div className="ptf-card">
                <div className="ptf-card-hd">Lump sum projection — {fmtL(investAmt)}</div>
                <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                  <table className="ptf-analytics-tbl">
                    <thead><tr><th style={{ textAlign: 'left' }}>Horizon</th><th>Portfolio</th><th>{bm.name.split(' ').slice(0, 2).join(' ')}</th><th>Gain</th></tr></thead>
                    <tbody>
                      {[3, 5, 10].map(y => {
                        const ptfV = investAmt * Math.pow(1 + (B.return_3y || 0) / 100, y);
                        const bmV = investAmt * Math.pow(1 + ((bm.rets.r3y || 13)) / 100, y);
                        return (
                          <tr key={y}>
                            <td>{y} yrs</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{fmtL(ptfV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtL(bmV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: ptfV >= bmV ? 'var(--pos)' : 'var(--brand-primary)' }}>
                              {ptfV >= bmV ? '+' : '-'}{fmtL(Math.abs(ptfV - bmV))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="ptf-card">
                <div className="ptf-card-hd">SIP projection — ₹{sipAmt.toLocaleString('en-IN')}/month</div>
                <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                  <table className="ptf-analytics-tbl">
                    <thead><tr><th style={{ textAlign: 'left' }}>Horizon</th><th>Invested</th><th>Portfolio</th><th>vs BM</th></tr></thead>
                    <tbody>
                      {[5, 10].map(y => {
                        const ptfV = sipFV(sipAmt, B.return_3y || 0, y);
                        const bmV = sipFV(sipAmt, bm.rets.r3y || 13, y);
                        const invested = sipAmt * 12 * y;
                        return (
                          <tr key={y}>
                            <td>{y} yrs</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtL(invested)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{fmtL(ptfV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: ptfV >= bmV ? 'var(--pos)' : 'var(--brand-primary)' }}>
                              {ptfV >= bmV ? '+' : ''}{(((ptfV - bmV) / bmV) * 100).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>Based on blended 3Y CAGR ({(B.return_3y || 0).toFixed(2)}% p.a.) vs {bm.name} ({(bm.rets.r3y || 0).toFixed(2)}% p.a.). Illustrative only — not a guarantee of future returns.</div>
                </div>
              </div>
            </div>

            {/* Per-fund return table */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Return contribution per fund</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr><th style={{ textAlign: 'left' }}>Fund</th><th>Weight</th><th>1M</th><th>3M</th><th>1Y</th><th>3Y CAGR</th><th>5Y CAGR</th><th>YTD</th><th>1Y contrib</th></tr></thead>
                  <tbody>
                    {funds.map(f => {
                      const w = weights[f.isin] || 0;
                      const fsnap = snapshots[f.isin];
                      return (
                        <tr key={f.isin}>
                          <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 3, height: 34, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                              <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                            </div>
                          </div></td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{w}%</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['1m'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['1m'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['3m'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['3m'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: (fsnap?.returns?.['1y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['1y'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['3y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['3y'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['5y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['5y'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(fsnap?.returns?.['ytd'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--pos)' }}>{snapshots[f.isin]?.returns?.['1y'] != null ? fp(snapshots[f.isin]?.returns?.['1y'] * w / 100) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Blended portfolio</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{total}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_1m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_3m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_ytd)}</td>
                      <td>—</td>
                    </tr>
                    <tr style={{ background: 'var(--brand-dark)' }}>
                      <td style={{ fontWeight: 600, color: '#fff' }}>{bm.name || 'Benchmark'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>BM</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>—</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>—</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{fp(bm.rets.r1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{fp(bm.rets.r3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{fp(bm.rets.r5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>—</td>
                      <td style={{ color: '#fff' }}>—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── RISK METRICS ── */}
        {activeTab === 'risk' && (
          <div>
            <div className="ptf-kpi-row" style={{ gridTemplateColumns: 'repeat(7,minmax(0,1fr))', marginBottom: 14 }}>
              {RISK_METRICS.map(m => {
                const v = B[m.k];
                if (v == null) return <div key={m.k} className="ptf-kpi"><div className="ptf-kpi-val" style={{ color: 'var(--text-muted)' }}>—</div><div className="ptf-kpi-lbl">{m.l}</div></div>;
                const s = m.sig(v);
                return (
                  <div key={m.k} className="ptf-kpi" style={{ background: SIG_BG[s[1]] }}>
                    <div className="ptf-kpi-val" style={{ color: SIG_COL[s[1]] }}>{m.fmt(v)}</div>
                    <div className="ptf-kpi-lbl">{m.l}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: SIG_COL[s[1]] }}>{s[0]}</div>
                  </div>
                );
              })}
            </div>

            <div className="ptf-card">
              <div className="ptf-card-hd">Risk metrics per fund</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr>
                    <th style={{ textAlign: 'left' }}>Fund</th>
                    <th>Weight</th>
                    {RISK_METRICS.map(m => <th key={m.k}>{m.l}</th>)}
                  </tr></thead>
                  <tbody>
                    {funds.map(f => {
                      const fsnap = snapshots[f.isin];
                      return (<tr key={f.isin}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 3, height: 32, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                            <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                          </div>
                        </div></td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, textAlign: 'center' }}>{weights[f.isin] || 0}%</td>
                        {RISK_METRICS.map(m => {
                          const riskMap = {
                            sharpe_ratio_3y:  fsnap?.risk?.sharpe_ratio_3y,
                            sortino_ratio_3y: fsnap?.risk?.sortino_ratio_3y,
                            alpha_3y:         fsnap?.risk?.alpha_3y,
                            beta_3y:          fsnap?.risk?.beta_3y,
                            up_capture_3y:    fsnap?.risk?.up_capture_3y,
                            down_capture_3y:  fsnap?.risk?.down_capture_3y,
                            std_dev_3y:       fsnap?.risk?.std_dev_3y,
                          };
                          const raw = riskMap[m.k];
                          const v = (raw == null || raw === '-') ? null : parseFloat(raw);
                          if (v == null || isNaN(v)) return <td key={m.k} style={{ color: 'var(--text-muted)', textAlign: 'right' }}>—</td>;
                          const s = m.sig(v);
                          return <td key={m.k} style={{ fontFamily: 'var(--font-mono)', color: SIG_COL[s[1]], textAlign: 'right' }}>{m.fmt(v)}</td>;
                        })}
                      </tr>);
                    })}
                  </tbody>
                  <tfoot>
                    {RISK_METRICS.map(m => {
                      const v = B[m.k];
                      if (v == null) return null;
                      const s = m.sig(v);
                      const pct = Math.min(100, Math.max(0, m.lb ? (1 - v / 20) * 100 : (v / (m.good * 2)) * 100));
                      return (
                        <tr key={m.k} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                          <td style={{ fontWeight: 700, color: 'var(--brand-dark)' }}>Blended</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: SIG_COL[s[1]], textAlign: 'right' }}>{m.fmt(v)}</td>
                          <td colSpan={RISK_METRICS.length - 1}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: pct.toFixed(0) + '%', height: '100%', background: SIG_COL[s[1]], borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: SIG_BG[s[1]], color: SIG_COL[s[1]] }}>{s[0]}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })[0]}
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Risk alerts */}
            {B.down_capture_3y > 100 && <div className="ptf-insight-neg" style={{ marginTop: 10 }}>⚠ Down capture of {f2(B.down_capture_3y)}% — portfolio amplifies benchmark drawdowns.</div>}
            {B.alpha_3y < 0 && <div className="ptf-insight-warn" style={{ marginTop: 6 }}>⚠ Blended alpha negative ({fp(B.alpha_3y)}) — active fund fees not justified by outperformance.</div>}
            {B.sharpe_ratio_3y < 0.4 && <div className="ptf-insight-neg" style={{ marginTop: 6 }}>⚠ Sharpe of {f2(B.sharpe_ratio_3y)} is weak. Returns do not adequately compensate for risk taken.</div>}
            {B.sharpe_ratio_3y >= 0.6 && B.alpha_3y >= 0 && B.down_capture_3y <= 100 && <div className="ptf-insight-pos" style={{ marginTop: 6 }}>✓ Risk profile looks healthy — Sharpe {f2(B.sharpe_ratio_3y)}, positive alpha, down capture {f2(B.down_capture_3y)}%.</div>}
          </div>
        )}

        {/* ── EXPOSURE ── */}
        {activeTab === 'exposure' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {[
                {
                  title: 'Blended market cap vs IPS targets', items: [
                    [B.large_cap, 'Large cap', 'var(--brand-primary)', [+(ips?.alloc?.lcMin || 0), +(ips?.alloc?.lcMax || 100)]],
                    [B.mid_cap, 'Mid cap', 'var(--muted-pur,#6D5479)', [+(ips?.alloc?.mcMin || 0), +(ips?.alloc?.mcMax || 100)]],
                    [B.small_cap, 'Small cap', '#C46985', [+(ips?.alloc?.scMin || 0), +(ips?.alloc?.scMax || 100)]],
                  ]
                },
                {
                  title: 'Asset allocation vs IPS targets', items: [
                    [B.equity_pct, 'Equity', 'var(--brand-dark)', [+(ips?.alloc?.eqMin || 0), +(ips?.alloc?.eqMax || 100)]],
                    [B.bond_pct || 0, 'Bonds/Debt', 'var(--lav-grey,#A795AE)', [+(ips?.alloc?.debtMin || 0), +(ips?.alloc?.debtMax || 100)]],
                    [B.cash_pct || 0, 'Cash/Liquid', 'var(--text-muted)', null],
                  ]
                }
              ].map((card, ci) => (
                <div key={ci} className="ptf-exp-card">
                  <div className="ptf-exp-hd">{card.title}</div>
                  {card.items.map(([v, lbl, clr, tgt], ii) => {
                    const p = v || 0;
                    const inRange = !tgt || (p >= tgt[0] && p <= tgt[1]);
                    return (
                      <div key={ii} className="ptf-bar-row2">
                        <div className="ptf-bar-lbl2">{lbl}</div>
                        <div style={{ flex: 1, position: 'relative' }}>
                          <div className="ptf-bar-track2">
                            <div className="ptf-bar-fill2" style={{ width: Math.min(p, 100).toFixed(1) + '%', background: clr }} />
                          </div>
                          {tgt && <div style={{ position: 'absolute', top: -2, bottom: -2, left: tgt[0] + '%', width: (tgt[1] - tgt[0]) + '%', border: '1.5px dashed ' + (inRange ? 'var(--pos)' : 'var(--brand-primary)'), borderRadius: 2, opacity: .5, pointerEvents: 'none' }} />}
                        </div>
                        <div className="ptf-bar-val2" style={{ color: tgt && !inRange ? 'var(--brand-primary)' : clr }}>
                          {p.toFixed(1)}%
                          {tgt && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}> / {tgt[0]}-{tgt[1]}%</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="ptf-exp-card" style={{ marginBottom: 14 }}>
              <div className="ptf-exp-hd">Market cap per fund</div>
              {funds.map(f => {
                const w = weights[f.isin] || 0;
                if (!snapshots[f.isin]?.large_cap && !snapshots[f.isin]?.mid_cap && !snapshots[f.isin]?.small_cap) return null;
                const lc = snapshots[f.isin]?.large_cap || 0, mc = snapshots[f.isin]?.mid_cap || 0, sc = snapshots[f.isin]?.small_cap || 0;
                return (
                  <div key={f.isin} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 3, height: 20, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                      <div style={{ fontSize: 11, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{w}%</div>
                    </div>
                    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
                      {lc > 0 && <div style={{ flex: lc, background: 'var(--brand-primary)', borderRadius: '2px 0 0 2px' }} title={`Large cap ${lc.toFixed(1)}%`} />}
                      {mc > 0 && <div style={{ flex: mc, background: 'var(--muted-pur,#6D5479)' }} title={`Mid cap ${mc.toFixed(1)}%`} />}
                      {sc > 0 && <div style={{ flex: sc, background: '#C46985', borderRadius: '0 2px 2px 0' }} title={`Small cap ${sc.toFixed(1)}%`} />}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                      {lc > 0 && <span style={{ fontSize: 9, color: 'var(--brand-primary)' }}>LC {lc.toFixed(0)}%</span>}
                      {mc > 0 && <span style={{ fontSize: 9, color: 'var(--muted-pur,#6D5479)' }}>MC {mc.toFixed(0)}%</span>}
                      {sc > 0 && <span style={{ fontSize: 9, color: '#C46985' }}>SC {sc.toFixed(0)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CORRELATION ── */}
        {activeTab === 'correlation' && (
          <div>
            {funds.length < 2 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, opacity: .2, marginBottom: 12 }}>⊞</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--brand-dark)', marginBottom: 6 }}>Add at least 2 funds</div>
                <div style={{ fontSize: 13 }}>Correlation analysis requires 2 or more funds in the portfolio.</div>
              </div>
            ) : (
              <>
                <div className="ptf-card" style={{ marginBottom: 14 }}>
                  <div className="ptf-card-hd">Correlation matrix (calendar year returns CY21–CY25)</div>
                  <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, fontSize: 9, color: 'var(--text-muted)' }}></th>
                          {funds.map((f, i) => <th key={f.isin} style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600, fontSize: 9, color: f.color, whiteSpace: 'nowrap' }}>F{i + 1}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {funds.map((fi, i) => (
                          <tr key={fi.isin}>
                            <td style={{ padding: '4px 8px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <span style={{ color: fi.color }}>F{i + 1}</span> {fi.name}
                            </td>
                            {funds.map((fj, j) => {
                              const v = corrMatrix[i][j];
                              const { bg, color } = corrColor(v);
                              return (
                                <td key={fj.isin} style={{ padding: '4px 6px', textAlign: 'center', background: bg, color, fontFamily: 'var(--font-mono)', fontWeight: 600, borderRadius: 3, border: '2px solid #fff', minWidth: 52 }}>
                                  {v != null ? v.toFixed(2) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Correlation legend */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
                  {[['≥0.90', '#fde8ee', '#912F63', 'Very high — diversification benefit minimal'],
                    ['0.70–0.89', '#fef3e2', '#D97706', 'High — some overlap'],
                    ['0.50–0.69', '#f0f9f5', '#1A7A52', 'Moderate — reasonable diversification'],
                    ['<0.50', '#eef0f7', '#3E3452', 'Low — strong diversification'],
                  ].map(([range, bg, color, desc]) => (
                    <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 28, height: 16, background: bg, borderRadius: 3, border: '1px solid #ddd', fontSize: 8, fontWeight: 700, color, textAlign: 'center', lineHeight: '16px' }}>{range}</span>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>

                {/* Insights */}
                {(() => {
                  const highPairs = [];
                  funds.forEach((fi, i) => funds.forEach((fj, j) => {
                    if (j > i && corrMatrix[i][j] != null && corrMatrix[i][j] >= 0.85)
                      highPairs.push(`${fi.name.split(' ').slice(0, 2).join(' ')} & ${fj.name.split(' ').slice(0, 2).join(' ')} (${corrMatrix[i][j].toFixed(2)})`);
                  }));
                  return highPairs.length > 0 ? (
                    <div className="ptf-insight-warn">⚠ High correlation detected: {highPairs.join('; ')}. Consider replacing one with a lower-correlated fund for better diversification.</div>
                  ) : (
                    <div className="ptf-insight-pos">✓ Portfolio shows reasonable diversification across calendar year return patterns.</div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── FUND DETAILS ── */}
        {activeTab === 'funds' && (
          <div>
            <div className="ptf-card" style={{ marginBottom: 14 }}>
              <div className="ptf-card-hd">Fund details & analytics</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr>
                    <th style={{ textAlign: 'left' }}>Fund</th>
                    <th>Weight</th>
                    <th>1Y</th>
                    <th>3Y CAGR</th>
                    <th>5Y CAGR</th>
                    <th>Sharpe</th>
                    <th>Alpha</th>
                    <th>Beta</th>
                    <th>Dn cap</th>
                    <th>ER</th>
                    <th>Rating</th>
                  </tr></thead>
                  <tbody>
                    {funds.map(f => {
                      const fsnap = snapshots[f.isin];
                      return (<tr key={f.isin}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 3, height: 34, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                              <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                              {fsnap?.fund_size != null && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>₹{fsnap?.fund_size >= 100000 ? (fsnap?.fund_size / 100000).toFixed(0) + 'L Cr' : (fsnap?.fund_size / 1000).toFixed(0) + 'K Cr'}</span>}
                            </div>
                          </div>
                        </div></td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{weights[f.isin] || 0}%</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['1y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['1y'])}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['3y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['3y'])}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['5y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['5y'])}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.risk?.sharpe_ratio_3y || 0) >= 0.5 ? 'var(--pos)' : 'var(--text-muted)' }}>{f2(fsnap?.risk?.sharpe_ratio_3y)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.risk?.alpha_3y || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.risk?.alpha_3y)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{f2(fsnap?.risk?.beta_3y)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.risk?.down_capture_3y || 0) < 100 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fsnap?.risk?.down_capture_3y != null ? f2(fsnap?.risk?.down_capture_3y) + '%' : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.expense_ratio || 0) <= 1 ? 'var(--pos)' : (fsnap?.expense_ratio || 0) >= 2 ? 'var(--brand-primary)' : 'var(--text-muted)' }}>{fsnap?.expense_ratio != null ? fsnap?.expense_ratio + '%' : '—'}</td>
                        <td style={{ color: '#B46B10', letterSpacing: -1 }}>{fsnap?.morningstar_rating && fsnap.morningstar_rating !== '-' ? '★'.repeat(parseInt(fsnap.morningstar_rating)) + '☆'.repeat(5 - parseInt(fsnap.morningstar_rating)) : '—'}</td>
                      </tr>);
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Blended portfolio</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{total}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.sharpe_ratio_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.alpha_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.beta_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.down_capture_3y)}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.expense_ratio)}%</td>
                      <td>—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}