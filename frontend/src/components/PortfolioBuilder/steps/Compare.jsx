import React from 'react';
import { fp, f2 } from './BuildPortfolio';
const fp2 = v => { if (v == null || v === '-') return '—'; const n = parseFloat(v); return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; };
const f22 = v => v == null || v === '-' ? '—' : parseFloat(v).toFixed(2);

// Blend metrics from snapshots using given weight map
function blendFromSnaps(funds, wtMap, snapshots) {
  function wblend(getter) {
    let val = 0, cov = 0;
    funds.forEach(f => {
      const snap = snapshots[f.isin];
      if (!snap) return;
      const v = getter(snap);
      if (v == null || v === '-' || isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (wtMap[f.isin] || 0);
      cov += (wtMap[f.isin] || 0);
    });
    return cov > 0 ? val / cov : null;
  }
  return {
    ret1m:  wblend(s => s.returns?.['1m']),
    ret3m:  wblend(s => s.returns?.['3m']),
    ret1y:  wblend(s => s.returns?.['1y']),
    ret3y:  wblend(s => s.returns?.['3y']),
    ret5y:  wblend(s => s.returns?.['5y']),
    ytd:    wblend(s => s.returns?.['ytd']),
    sharpe: wblend(s => s.risk?.sharpe_ratio_3y),
    sortino:wblend(s => s.risk?.sortino_ratio_3y),
    alpha:  wblend(s => s.risk?.alpha_3y),
    beta:   wblend(s => s.risk?.beta_3y),
    upcap:  wblend(s => s.risk?.up_capture_3y),
    dncap:  wblend(s => s.risk?.down_capture_3y),
    std3y:  wblend(s => s.risk?.std_dev_3y),
    er:     wblend(s => s.expense_ratio),
    lc:     wblend(s => s.large_cap),
    mc:     wblend(s => s.mid_cap),
    sc:     wblend(s => s.small_cap),
    eq:     wblend(s => s.equity_pct),
    debt:   wblend(s => s.bond_pct),
    cash:   wblend(s => s.cash_pct),
  };
}

function delta(nv, ov, lowerBetter) {
  if (nv == null || ov == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const d = nv - ov;
  const good = lowerBetter ? d < 0 : d > 0;
  const clr = Math.abs(d) < 0.005 ? 'var(--text-muted)' : good ? 'var(--pos)' : 'var(--neg)';
  const arrow = d > 0.005 ? '↑' : d < -0.005 ? '↓' : '→';
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: clr }}>{arrow}{d >= 0 ? '+' : ''}{d.toFixed(2)}</span>;
}
function deltaPct(nv, ov, lowerBetter) {
  if (nv == null || ov == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const d = nv - ov;
  const good = lowerBetter ? d < 0 : d > 0;
  const clr = Math.abs(d) < 0.01 ? 'var(--text-muted)' : good ? 'var(--pos)' : 'var(--neg)';
  const arrow = d > 0.01 ? '↑' : d < -0.01 ? '↓' : '→';
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: clr }}>{arrow}{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span>;
}

export default function Compare({ funds, weights, originalWeights, snapshots={}, benchmarks=[], onBack, onGeneratePDF, selectedPortfolio, setSelectedPortfolio }) {
  const hasOpt = Object.keys(originalWeights || {}).length > 0;

  // Always compute original portfolio metrics
  const OB = blendFromSnaps(funds, hasOpt ? originalWeights : weights, snapshots);
  const NB = hasOpt ? blendFromSnaps(funds, weights, snapshots) : OB;

  const kpiCards = [
    { l: '1Y Return',   o: fp2(OB.ret1y),  n: fp2(NB.ret1y),  dv: deltaPct(NB.ret1y, OB.ret1y, false) },
    { l: '3Y CAGR',    o: fp2(OB.ret3y),  n: fp2(NB.ret3y),  dv: deltaPct(NB.ret3y, OB.ret3y, false) },
    { l: 'Sharpe',     o: f22(OB.sharpe), n: f22(NB.sharpe), dv: delta(NB.sharpe, OB.sharpe, false) },
    { l: 'Alpha',      o: fp2(OB.alpha),  n: fp2(NB.alpha),  dv: deltaPct(NB.alpha, OB.alpha, false) },
    { l: 'Down cap',   o: OB.dncap != null ? f22(OB.dncap)+'%' : '—', n: NB.dncap != null ? f22(NB.dncap)+'%' : '—', dv: delta(NB.dncap, OB.dncap, true) },
    { l: 'Blended ER', o: OB.er != null ? f22(OB.er)+'%' : '—', n: NB.er != null ? f22(NB.er)+'%' : '—', dv: delta(NB.er, OB.er, true) },
  ];

  const METRIC_ROWS = [
    { section: 'Return metrics' },
    { l: '1M return',  o: fp(OB.ret1m),  n: fp(NB.ret1m),  dv: deltaPct(NB.ret1m, OB.ret1m, false) },
    { l: '3M return',  o: fp(OB.ret3m),  n: fp(NB.ret3m),  dv: deltaPct(NB.ret3m, OB.ret3m, false) },
    { l: '1Y return',  o: fp(OB.ret1y),  n: fp(NB.ret1y),  dv: deltaPct(NB.ret1y, OB.ret1y, false) },
    { l: '3Y CAGR',    o: fp2(OB.ret3y),  n: fp2(NB.ret3y),  dv: deltaPct(NB.ret3y, OB.ret3y, false) },
    { l: '5Y CAGR',    o: fp(OB.ret5y),  n: fp(NB.ret5y),  dv: deltaPct(NB.ret5y, OB.ret5y, false) },
    { l: 'YTD',        o: fp(OB.ytd),    n: fp(NB.ytd),    dv: deltaPct(NB.ytd, OB.ytd, false) },
    { section: 'Risk metrics' },
    { l: 'Sharpe (3Y)',  o: f2(OB.sharpe),  n: f2(NB.sharpe),  dv: delta(NB.sharpe, OB.sharpe, false) },
    { l: 'Sortino (3Y)', o: f2(OB.sortino), n: f2(NB.sortino), dv: delta(NB.sortino, OB.sortino, false) },
    { l: 'Alpha (3Y)',   o: fp(OB.alpha),   n: fp(NB.alpha),   dv: deltaPct(NB.alpha, OB.alpha, false) },
    { l: 'Beta (3Y)',    o: f2(OB.beta),    n: f2(NB.beta),    dv: delta(NB.beta, OB.beta, true) },
    { l: 'Up capture',   o: OB.upcap != null ? f2(OB.upcap)+'%' : '—', n: NB.upcap != null ? f2(NB.upcap)+'%' : '—', dv: delta(NB.upcap, OB.upcap, false) },
    { l: 'Down capture', o: OB.dncap != null ? f2(OB.dncap)+'%' : '—', n: NB.dncap != null ? f2(NB.dncap)+'%' : '—', dv: delta(NB.dncap, OB.dncap, true) },
    { l: 'Std dev (3Y)', o: OB.std3y != null ? f2(OB.std3y)+'%' : '—', n: NB.std3y != null ? f2(NB.std3y)+'%' : '—', dv: delta(NB.std3y, OB.std3y, true) },
    { l: 'Blended ER',   o: OB.er != null ? f2(OB.er)+'%' : '—', n: NB.er != null ? f2(NB.er)+'%' : '—', dv: delta(NB.er, OB.er, true) },
    { section: 'Exposure' },
    { l: 'Equity',     o: OB.eq != null ? f2(OB.eq)+'%' : '—',   n: NB.eq != null ? f2(NB.eq)+'%' : '—',   dv: delta(NB.eq, OB.eq, false) },
    { l: 'Debt',       o: OB.debt != null ? f2(OB.debt)+'%' : '—', n: NB.debt != null ? f2(NB.debt)+'%' : '—', dv: delta(NB.debt, OB.debt, false) },
    { l: 'Cash',       o: OB.cash != null ? f2(OB.cash)+'%' : '—', n: NB.cash != null ? f2(NB.cash)+'%' : '—', dv: delta(NB.cash, OB.cash, false) },
    { l: 'Large cap',  o: OB.lc != null ? f2(OB.lc)+'%' : '—',   n: NB.lc != null ? f2(NB.lc)+'%' : '—',   dv: delta(NB.lc, OB.lc, false) },
    { l: 'Mid cap',    o: OB.mc != null ? f2(OB.mc)+'%' : '—',   n: NB.mc != null ? f2(NB.mc)+'%' : '—',   dv: delta(NB.mc, OB.mc, false) },
    { l: 'Small cap',  o: OB.sc != null ? f2(OB.sc)+'%' : '—',   n: NB.sc != null ? f2(NB.sc)+'%' : '—',   dv: delta(NB.sc, OB.sc, false) },
  ];

  // Blended benchmark name
  const bmName = benchmarks.length > 0
    ? benchmarks.map(b => `${b.display_name}${benchmarks.length > 1 ? ` (${b.weight}%)` : ''}`).join(' + ')
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Portfolio selector bar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Use for PDF:</span>
        {[
          { val: 'original',  label: '● Original',  color: 'var(--pos)' },
          { val: 'optimised', label: '◆ Optimised', color: 'var(--brand-primary)' },
        ].map(opt => (
          <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '5px 12px', border: `1.5px solid ${selectedPortfolio === opt.val ? opt.color : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: selectedPortfolio === opt.val ? 'rgba(0,0,0,.03)' : '#fff', opacity: opt.val === 'optimised' && !hasOpt ? 0.4 : 1 }}>
            <input type="radio" name="ptf-which" value={opt.val} checked={selectedPortfolio === opt.val} onChange={() => setSelectedPortfolio(opt.val)} disabled={opt.val === 'optimised' && !hasOpt} style={{ accentColor: opt.color }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: opt.color }}>{opt.label}</span>
          </label>
        ))}
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pos)' }}>✓ {selectedPortfolio === 'optimised' && hasOpt ? 'Optimised' : 'Original'} selected for proposal</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {hasOpt && <button className="btn btn-ghost" onClick={onBack} style={{ fontSize: 11 }}>← Re-optimise</button>}
          <button className="btn btn-primary" onClick={onGeneratePDF} style={{ fontSize: 11 }}>Generate proposal →</button>
        </div>
      </div>

      <div className="ptf-analytics">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 3 }}>
              {hasOpt ? 'Optimised vs original portfolio' : 'Portfolio metrics'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {hasOpt
                ? 'Side-by-side comparison of key metrics and weight changes after optimisation.'
                : 'Blended metrics for your current portfolio. Apply an optimisation strategy to compare.'}
            </div>
          </div>
          {bmName && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Benchmark: <strong>{bmName}</strong></div>}
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
          {kpiCards.map((c, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              <div style={{ background: 'var(--bg-secondary)', padding: '6px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{c.l}</div>
              <div style={{ display: 'grid', gridTemplateColumns: hasOpt ? '1fr 1fr' : '1fr' }}>
                <div style={{ padding: '10px 12px', borderRight: hasOpt ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Original</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>{c.o}</div>
                </div>
                {hasOpt && (
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 8, color: 'var(--brand-primary)', marginBottom: 3, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Optimised</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--brand-primary)' }}>{c.n}</div>
                  </div>
                )}
              </div>
              {hasOpt && <div style={{ padding: '5px 12px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', fontSize: 10, textAlign: 'center' }}>Change: {c.dv}</div>}
            </div>
          ))}
        </div>

        {/* Weight rebalancing — only show when optimised */}
        {hasOpt && (
          <div className="ptf-card" style={{ marginBottom: 14 }}>
            <div className="ptf-card-hd">Weight rebalancing — fund by fund</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="ptf-analytics-tbl">
                <thead><tr><th style={{ textAlign: 'left' }}>Fund</th><th>Original → Optimised</th><th>Change</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
                <tbody>
                  {funds.map(f => {
                    const ow = originalWeights[f.isin] || 0;
                    const nw = weights[f.isin] || 0;
                    const d = nw - ow;
                    const action = d > 8 ? { l: 'Increase', c: '#1A7A52', bg: '#E6F4ED' } : d > 2 ? { l: 'Trim up', c: '#1A7A52', bg: '#EDFBF0' } : d < -8 ? { l: 'Reduce', c: 'var(--brand-primary)', bg: 'rgba(145,47,99,.06)' } : d < -2 ? { l: 'Trim down', c: 'var(--brand-primary)', bg: '#FEF0F0' } : { l: 'Hold', c: 'var(--text-muted)', bg: 'var(--bg-secondary)' };
                    return (
                      <tr key={f.isin}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 3, height: 34, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                            <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                          </div>
                        </div></td>
                        <td style={{ minWidth: 140 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {[['Original', ow, 'var(--lav-grey,#A795AE)'], ['Optimised', nw, f.color]].map(([label, w, clr]) => (
                              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--text-muted)', width: 52, textAlign: 'right' }}>{label}</div>
                                <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', maxWidth: 80 }}>
                                  <div style={{ width: w + '%', height: '100%', background: clr, borderRadius: 3 }} />
                                </div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: clr, minWidth: 28 }}>{parseFloat(w).toFixed(1)}%</div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: d > 0 ? 'var(--pos)' : d < 0 ? 'var(--neg)' : 'var(--text-muted)' }}>{d > 0 ? '+' : ''}{parseFloat(d).toFixed(1)}%</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: action.bg, color: action.c }}>{action.l}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Full metric table */}
        <div className="ptf-card">
          <div className="ptf-card-hd">Full metric comparison
            {hasOpt && <div style={{ display: 'flex', gap: 16, fontSize: 9, color: 'var(--text-muted)' }}>
              <span>Original</span><span style={{ color: 'var(--brand-primary)' }}>Optimised</span><span>Δ</span>
            </div>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ptf-analytics-tbl">
              <thead><tr>
                <th style={{ textAlign: 'left' }}>Metric</th>
                <th>Original</th>
                {hasOpt && <><th>Optimised</th><th>Δ</th></>}
              </tr></thead>
              <tbody>
                {METRIC_ROWS.map((r, i) => r.section ? (
                  <tr key={i} style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
                    <td colSpan={hasOpt ? 4 : 2} style={{ padding: '6px 14px', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-primary)' }}>{r.section}</td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.l}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{r.o}</td>
                    {hasOpt && <><td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{r.n}</td><td>{r.dv}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}