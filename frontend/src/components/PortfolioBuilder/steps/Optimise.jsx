import React, { useState } from 'react';
import { BM_DATA, fp, f2 } from './BuildPortfolio';

const STRATS = [
  { id: 'sharpe', icon: '◈', name: 'Max Sharpe', sub: 'Best risk-adjusted return', detail: "Weights proportional to each fund's 3-year Sharpe ratio — concentrating on those with the highest return per unit of risk.", c: '#912F63', clt: '#F7EEF3', cbdr: '#EDD5E2', calc: (F) => norm(F.map(f => Math.max(f.sharpe_ratio_3y || 0, 0))) },
  { id: 'alpha',  icon: '↑', name: 'Max Alpha',  sub: 'Pure manager outperformance', detail: 'Weights proportional to positive 3-year alpha only. Zero exposure to funds that fail to beat their benchmark cost.', c: '#1A7A52', clt: '#E6F4ED', cbdr: '#B8DEC9', calc: (F) => norm(F.map(f => Math.max(f.alpha_3y || 0, 0))) },
  { id: 'risk',   icon: '↓', name: 'Min Risk',   sub: 'Strongest downside shield', detail: 'Inversely weights by down-capture ratio. Leans hardest on the funds that historically fall the least in market corrections.', c: '#6D5479', clt: '#EDE9F2', cbdr: '#CEC4D7', calc: (F) => norm(F.map(f => f.down_capture_3y != null ? 1 / Math.max(f.down_capture_3y, 0.1) : 0)) },
];

function norm(wts) {
  const s = wts.reduce((a, b) => a + b, 0) || 1;
  const out = wts.map(w => Math.round(w / s * 100));
  const d = 100 - out.reduce((a, b) => a + b, 0);
  if (out.length) out[0] += d;
  return out;
}

function blendW(F, wts) {
  const b = { return_3y: 0, return_1y: 0, sharpe_ratio_3y: 0, sortino_ratio_3y: 0, alpha_3y: 0, beta_3y: 0, down_capture_3y: 0, up_capture_3y: 0, expense_ratio: 0, std_dev_3y: 0 };
  F.forEach((f, i) => {
    const w = wts[i] / 100;
    Object.keys(b).forEach(k => { if (f[k] != null) b[k] += (f[k] || 0) * w; });
  });
  return b;
}

export default function Optimise({ funds, weights, setWeights, setOriginalWeights, benchmark, onBack, onCompare }) {
  const [activeStratId, setActiveStratId] = useState('sharpe');
  const [optimised, setOptimised] = useState(false);
  const [activeTab, setActiveTab] = useState('strategy');
  const bm = BM_DATA[benchmark] || BM_DATA['nifty50'];

  if (!funds.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, opacity: .5 }}>★</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, color: 'var(--brand-dark)' }}>No portfolio to optimise</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 260, lineHeight: 1.6 }}>Add at least two funds and set their weights in Step 2.</div>
      </div>
    );
  }

  const AS = STRATS.find(s => s.id === activeStratId) || STRATS[0];
  const AW = AS.calc(funds);
  const AB = blendW(funds, AW);
  const CB = blendW(funds, funds.map(f => weights[f.isin] || 0));

  // EF simulation
  const sims = Array.from({ length: 80 }, () => {
    const rr = funds.map(() => Math.random());
    const rs = rr.reduce((a, b) => a + b, 0) || 1;
    const ww = norm(rr.map(v => Math.round(v / rs * 100)));
    return blendW(funds, ww);
  });
  const allSP = STRATS.map(s => ({ s, b: blendW(funds, s.calc(funds)) }));
  const allX = sims.map(p => p.std3y).concat(allSP.map(p => p.b.std_dev_3y)).concat([CB.std_dev_3y]).filter(v => v > 0);
  const allY = sims.map(p => p.ret3y).concat(allSP.map(p => p.b.return_3y)).concat([CB.return_3y]);
  const mnX = Math.min(...allX) || 0, mxX = Math.max(...allX) || 20;
  const mnY = Math.min(...allY) || 0, mxY = Math.max(...allY) || 25;
  const rX = mxX - mnX || 1, rY = mxY - mnY || 1;
  const EW = 340, EH = 170, PD = 20;
  const ex = v => ((PD + (v - mnX) / rX * (EW - PD * 2))).toFixed(1);
  const ey = v => ((EH - PD - (v - mnY) / rY * (EH - PD * 2))).toFixed(1);

  function applyWeights() {
    const newW = {};
    funds.forEach((f, i) => { newW[f.isin] = AW[i] || 0; });
    setOriginalWeights({ ...weights });
    setWeights(newW);
    setOptimised(true);
    setActiveTab('result');
  }

  // Rebalancing table
  const CW = funds.map(f => weights[f.isin] || 0);
  function actionTag(d) {
    if (d > 8) return { l: 'Increase', c: '#1A7A52', bg: '#E6F4ED' };
    if (d > 2) return { l: 'Trim up', c: '#1A7A52', bg: '#EDFBF0' };
    if (d < -8) return { l: 'Reduce', c: '#912F63', bg: 'rgba(145,47,99,.06)' };
    if (d < -2) return { l: 'Trim down', c: '#912F63', bg: '#FEF0F0' };
    return { l: 'Hold', c: 'var(--text-muted)', bg: 'var(--bg-secondary)' };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="ptf-tab-bar">
        <button className={`ptf-tab ${activeTab === 'strategy' ? 'active' : ''}`} onClick={() => setActiveTab('strategy')}>★ Choose strategy</button>
        <button className={`ptf-tab ${activeTab === 'result' ? 'active' : ''}`} onClick={() => setActiveTab('result')} style={{ opacity: optimised ? 1 : .35, pointerEvents: optimised ? 'auto' : 'none' }}>Optimised analytics</button>
        <div className="ptf-tab-actions">
          <button className="btn btn-ghost" onClick={onBack} style={{ fontSize: 11 }}>← Analysis</button>
          <button className="btn btn-primary" onClick={onCompare} style={{ fontSize: 11, opacity: optimised ? 1 : .3, pointerEvents: optimised ? 'auto' : 'none' }}>Compare →</button>
        </div>
      </div>

      <div className="ptf-analytics">
        {activeTab === 'strategy' && (
          <div>
            {/* Strategy cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
              {STRATS.map(s => {
                const b = blendW(funds, s.calc(funds));
                const active = s.id === activeStratId;
                return (
                  <div key={s.id} onClick={() => setActiveStratId(s.id)} style={{ border: `1.5px solid ${active ? s.c : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 16px', cursor: 'pointer', background: active ? s.clt : '#fff', transition: 'all .15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.c, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{s.icon}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: active ? s.c : 'var(--brand-dark)' }}>{s.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.sub}</div>
                      </div>
                      {active && <div style={{ marginLeft: 'auto', width: 16, height: 16, borderRadius: '50%', background: s.c, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>✓</div>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>{s.detail}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                      {[['3Y CAGR', fp(b.return_3y)], ['Sharpe', f2(b.sharpe_ratio_3y)], ['Alpha', fp(b.alpha_3y)]].map(([l, v]) => (
                        <div key={l} style={{ textAlign: 'center', background: active ? 'rgba(255,255,255,.6)' : 'var(--bg-secondary)', borderRadius: 6, padding: '6px 4px' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: s.c }}>{v}</div>
                          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* EF chart + rebalancing table */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div className="ptf-card">
                <div className="ptf-card-hd">Efficient frontier simulation</div>
                <div style={{ padding: '14px 16px' }}>
                  <svg width="100%" viewBox={`0 0 ${EW} ${EH}`} style={{ overflow: 'visible', display: 'block' }}>
                    <line x1={PD} y1={PD} x2={PD} y2={EH - PD} stroke="var(--border)" strokeWidth="1" />
                    <line x1={PD} y1={EH - PD} x2={EW - PD} y2={EH - PD} stroke="var(--border)" strokeWidth="1" />
                    {sims.filter(p => p.std3y > 0).map((p, i) => <circle key={i} cx={ex(p.std3y)} cy={ey(p.ret3y)} r="3.5" fill="#E4E0EA" opacity=".55" />)}
                    {STRATS.filter(s => s.id !== activeStratId).map(s => {
                      const b = blendW(funds, s.calc(funds));
                      return <g key={s.id}>
                        <circle cx={ex(b.std_dev_3y)} cy={ey(b.return_3y)} r="6" fill={s.c} stroke="white" strokeWidth="1.5" opacity=".6" />
                        <text x={ex(b.std_dev_3y)} y={+ey(b.return_3y) - 11} textAnchor="middle" fontSize="8" fill={s.c} fontFamily="sans-serif" fontWeight="500" opacity=".7">{s.name}</text>
                      </g>;
                    })}
                    <circle cx={ex(AB.std3y)} cy={ey(AB.return_3y)} r="15" fill={AS.c} opacity=".12" />
                    <circle cx={ex(AB.std3y)} cy={ey(AB.return_3y)} r="8" fill={AS.c} stroke="white" strokeWidth="2" />
                    <text x={ex(AB.std3y)} y={+ey(AB.return_3y) - 14} textAnchor="middle" fontSize="9" fontWeight="700" fill={AS.c} fontFamily="sans-serif">{AS.name}</text>
                    {CB.std_dev_3y > 0 && <>
                      <circle cx={ex(CB.std_dev_3y)} cy={ey(CB.return_3y)} r="6" fill="#3E3452" stroke="white" strokeWidth="2" />
                      <text x={ex(CB.std_dev_3y)} y={+ey(CB.return_3y) - 11} textAnchor="middle" fontSize="8" fill="#3E3452" fontFamily="sans-serif" fontWeight="600">Current</text>
                    </>}
                    <text x={EW / 2} y={EH + 14} textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="sans-serif">Std deviation % (risk) →</text>
                    <text x={-EH / 2} y="8" textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="sans-serif" transform="rotate(-90)">← 3Y CAGR %</text>
                  </svg>
                </div>
              </div>

              <div className="ptf-card">
                <div className="ptf-card-hd">Proposed weight rebalancing</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="ptf-analytics-tbl">
                    <thead><tr><th style={{ textAlign: 'left' }}>Fund</th><th>Current</th><th>Proposed</th><th>Action</th></tr></thead>
                    <tbody>
                      {funds.map((f, i) => {
                        const cw = CW[i], nw = AW[i] || 0, d = nw - cw;
                        const action = actionTag(d);
                        return (
                          <tr key={f.isin}>
                            <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 3, height: 28, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                              <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 140 }}>{f.name}</div>
                            </div></td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{cw}%</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: AS.c }}>{nw}%</td>
                            <td><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: action.bg, color: action.c }}>{action.l}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Apply button */}
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <button className="btn btn-primary" onClick={applyWeights} style={{ padding: '11px 32px', fontSize: 13 }}>
                ⚡ Apply {AS.name} weights
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Original weights will be saved for comparison in Step 5.</div>
            </div>
          </div>
        )}

        {activeTab === 'result' && optimised && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 4 }}>Optimised portfolio applied ✓</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Strategy: <strong style={{ color: AS.c }}>{AS.name}</strong>. Go to Compare to see side-by-side with original.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
              {[['3Y CAGR', fp(AB.return_3y)], ['Sharpe', f2(AB.sharpe_ratio_3y)], ['Alpha', fp(AB.alpha_3y)], ['Down cap', f2(AB.down_capture_3y) + '%'], ['Blended ER', f2(AB.expense_ratio) + '%'], ['Beta', f2(AB.beta_3y)]].map(([l, v]) => (
                <div key={l} className="ptf-kpi">
                  <div className="ptf-kpi-val" style={{ color: 'var(--brand-primary)' }}>{v}</div>
                  <div className="ptf-kpi-lbl">{l}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button className="btn btn-primary" onClick={onCompare} style={{ fontSize: 12 }}>View full comparison →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}