import React, { useState, useEffect } from 'react';
import { fp, f2, COLORS } from './BuildPortfolio';

const API = process.env.REACT_APP_API_URL || '';

function MetricCard({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px 6px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: color || 'var(--brand-dark)', marginBottom: 1 }}>{value}</div>
      <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

function FrontierChart({ frontier, curve, strategies }) {
  if (!frontier || frontier.length === 0) return null;

  const allPts = [...(frontier || []), ...(curve || [])];
  const allVols = allPts.map(p => p[0]);
  const allRets = allPts.map(p => p[1]);
  const minVol = Math.min(...allVols), maxVol = Math.max(...allVols);
  const minRet = Math.min(...allRets), maxRet = Math.max(...allRets);
  const W = 340, H = 150, PAD = 24;

  function toX(v) { return PAD + ((v - minVol) / (maxVol - minVol || 1)) * (W - PAD * 2); }
  function toY(r) { return H - PAD - ((r - minRet) / (maxRet - minRet || 1)) * (H - PAD * 2); }

  const STRAT_STYLE = {
    max_sharpe:    { color: '#912F63', label: 'Max Sharpe', symbol: '★' },
    min_volatility:{ color: '#1A7A52', label: 'Min Volatility', symbol: '◆' },
    max_return:    { color: '#3E3452', label: 'Max Return', symbol: '▲' },
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Efficient Frontier</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff', padding: 12 }}>
        <svg width="100%" style={{ display: 'block', flex: 1 }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">

          {/* Frontier dots — coloured by Sharpe */}
          {(() => {
            const sharpes = frontier.map(x => x[2] ?? 0);
            const sMin = Math.min(...sharpes), sMax = Math.max(...sharpes);
            return frontier.map((p, i) => {
              const t = sMax > sMin ? ((p[2] ?? 0) - sMin) / (sMax - sMin) : 0.5;
              const r = Math.round(t * 255);
              const g = Math.round(180 + t * 75);
              const b = Math.round((1 - t) * 180);
              return <circle key={i} cx={toX(p[0])} cy={toY(p[1])} r={2} fill={`rgb(${r},${g},${b})`} opacity={0.75} />;
            });
          })()}
          {/* Strategy markers */}
          {strategies && Object.entries(strategies).map(([key, strat]) => {
            const style = STRAT_STYLE[key];
            if (!strat?.metrics) return null;
            const cx = toX(strat.metrics.volatility);
            const cy = toY(strat.metrics.return);
            return (
              <g key={key}>
                <circle cx={cx} cy={cy} r={7} fill={style.color} opacity={0.15} />
                <circle cx={cx} cy={cy} r={4} fill={style.color} />
                <text x={cx} y={cy - 7} textAnchor="middle" fontSize={5} fontWeight="600" fill={style.color}>{style.label}</text>
              </g>
            );
          })}
          {/* Axes labels */}
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={6} fill="#999">Volatility (%)</text>
          <text x={8} y={H / 2} textAnchor="middle" fontSize={6} fill="#999" transform={`rotate(-90, 8, ${H / 2})`}>Return (%)</text>
        </svg>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 6 }}>
          {Object.entries(STRAT_STYLE).map(([key, s]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Optimise({ funds, weights, snapshots = {}, setWeights, originalWeights = {}, setOriginalWeights, benchmarks = [], ips = {}, onBack, onCompare, selectedDate, savedResult = null, onSaveResult }) {
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(savedResult);
  const [error, setError]             = useState(null);
  const [selectedStrat, setSelectedStrat] = useState('max_sharpe');
  // Restore result from parent if returning to this step
  React.useEffect(() => { if (savedResult && !result) { setResult(savedResult); } }, [savedResult]);
  const [manualWeights, setManualWeights] = useState({});  // {isin: weight_pct}
  const [applied, setApplied]         = useState(false);

  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : (selectedDate || '');

  // Auto-populate manual weights for insufficient data funds when result arrives
  useEffect(() => {
    if (result?.insufficient_data?.length > 0) {
      const newManual = { ...manualWeights };
      result.insufficient_data.forEach(f => {
        if (!(f.isin in newManual)) {
          newManual[f.isin] = weights[f.isin] || 0;
        }
      });
      setManualWeights(newManual);
    }
  }, [result]);

  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);

  async function runOptimise() {
    setLoading(true);
    setError(null);
    setResult(null);
    setApplied(false);

    const payload = {
      funds: funds.map(f => ({
        isin:        f.isin,
        name:        f.name,
        weight:      weights[f.isin] || 0,
        category:    f.category || '',
        asset_class: f.asset_class || 'Equity',  // fallback to Equity if missing
        ranking:     f.ranking || null,
      })),
      ips: {
        riskProfile: ips.riskProfile || 'Moderate',
        equity:   { min: parseFloat(ips.alloc?.eqMin ?? 40),   max: parseFloat(ips.alloc?.eqMax ?? 60) },
        debt:     { min: parseFloat(ips.alloc?.debtMin ?? 0),  max: parseFloat(ips.alloc?.debtMax ?? 30) },
        largeCap: { min: parseFloat(ips.alloc?.lcMin ?? 30),   max: parseFloat(ips.alloc?.lcMax ?? 70) },
        midCap:   { min: parseFloat(ips.alloc?.mcMin ?? 15),   max: parseFloat(ips.alloc?.mcMax ?? 40) },
        smallCap: { min: parseFloat(ips.alloc?.scMin ?? 0),    max: parseFloat(ips.alloc?.scMax ?? 25) },
      },
      manual_weights: manualWeights,
      date: dateStr,
    };

    try {
      const res = await fetch(`${API}/api/portfolio/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        if (onSaveResult) onSaveResult(data);
        setSelectedStrat('max_sharpe');
      }
    } catch (e) {
      setError('Failed to connect to optimiser. Check backend is running.');
    } finally {
      setLoading(false);
    }
  }

  function updateManualWeight(isin, val) {
    const v = Math.max(0, Math.min(100, parseInt(val) || 0));
    setManualWeights(prev => ({ ...prev, [isin]: v }));
  }

  function applyStrategy() {
    if (!result?.strategies?.[selectedStrat]) return;
    const strat = result.strategies[selectedStrat];
    // Lock original weights from build portfolio on first apply only
    setOriginalWeights(prev => Object.keys(prev).length > 0 ? prev : { ...weights });
    const newWeights = {};
    funds.forEach(f => {
      newWeights[f.isin] = strat.weights[f.isin] ?? weights[f.isin] ?? 0;
    });
    setWeights(newWeights);
    setApplied(true);
    onCompare();
  }

  if (!funds.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 32, opacity: .3 }}>◈</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, color: 'var(--brand-dark)' }}>No portfolio to optimise</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 260 }}>Add at least two funds and set their weights in Step 2.</div>
      </div>
    );
  }

  const strat = result?.strategies?.[selectedStrat];
  const STRAT_OPTIONS = [
    { id: 'max_sharpe',    label: 'Max Sharpe',    icon: '◈', color: '#912F63', desc: 'Best risk-adjusted return' },
    { id: 'min_volatility',label: 'Min Volatility', icon: '↓', color: '#1A7A52', desc: 'Lowest portfolio volatility' },
    { id: 'max_return',    label: 'Max Return',     icon: '↑', color: '#3E3452', desc: 'Highest expected return' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600, color: 'var(--brand-dark)' }}>Optimise portfolio</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Monte Carlo · 10,000 simulations · {dateStr}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBack} style={{ padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 20, background: '#fff', fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)' }}>← Edit portfolio</button>
          <button onClick={runOptimise} disabled={loading || totalWeight !== 100}
            style={{ padding: '7px 18px', border: 'none', borderRadius: 20, background: loading || totalWeight !== 100 ? 'var(--border)' : 'var(--brand-primary)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: loading || totalWeight !== 100 ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Running...' : '▶ Run optimiser'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* Pre-flight checks */}
        {!result && !loading && (
          <div style={{ marginBottom: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>Pre-flight checks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: funds.length >= 2 ? 'var(--pos)' : 'var(--brand-primary)' }}>{funds.length >= 2 ? '✓' : '✗'}</span>
                <span>{funds.length} fund{funds.length !== 1 ? 's' : ''} in portfolio {funds.length < 2 ? '— add at least 2' : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: totalWeight === 100 ? 'var(--pos)' : 'var(--brand-primary)' }}>{totalWeight === 100 ? '✓' : '✗'}</span>
                <span>Weights sum to {totalWeight}% {totalWeight !== 100 ? '— must be 100%' : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--pos)' }}>✓</span>
                <span>IPS constraints: Equity {ips.alloc?.equity?.min || 40}–{ips.alloc?.equity?.max || 60}% · Debt {ips.alloc?.debt?.min || 30}–{ips.alloc?.debt?.max || 50}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: 14, background: 'rgba(145,47,99,.06)', border: '1px solid rgba(145,47,99,.2)', borderRadius: 8, marginBottom: 16, fontSize: 12, color: 'var(--brand-primary)' }}>
            ⚠ {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Running 10,000 Monte Carlo simulations…</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Insufficient data — manual weights */}
            {result.insufficient_data?.length > 0 && (
              <div style={{ marginBottom: 16, padding: 14, background: 'rgba(180,107,16,.06)', border: '1px solid rgba(180,107,16,.25)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#B46B10', marginBottom: 8, letterSpacing: '.04em', textTransform: 'uppercase' }}>⚠ Manual weight required</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>These funds have insufficient NAV history (&lt;1Y) and were excluded from optimisation. Enter weights manually — other funds will adjust automatically.</div>
                {result.insufficient_data.map(f => (
                  <div key={f.isin} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{f.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.weeks}w data</span>
                    <input type="number" min="0" max="100" value={manualWeights[f.isin] || 0}
                      onChange={e => updateManualWeight(f.isin, e.target.value)}
                      style={{ width: 52, padding: '3px 6px', border: '1px solid #B46B10', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textAlign: 'center' }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
                  </div>
                ))}
                <button onClick={runOptimise}
                  style={{ marginTop: 8, padding: '6px 14px', border: 'none', borderRadius: 20, background: '#B46B10', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Re-run with manual weights
                </button>
              </div>
            )}

            {/* Ranking flags */}
            {result.ranking_flags?.length > 0 && (
              <div style={{ marginBottom: 16, padding: 14, background: 'rgba(109,84,121,.05)', border: '1px solid rgba(109,84,121,.2)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-mid)', marginBottom: 8, letterSpacing: '.04em', textTransform: 'uppercase' }}>Fund quality flags</div>
                {result.ranking_flags.map(flag => (
                  <div key={flag.isin} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                      ⚠ <strong>{flag.name}</strong> — {flag.ranking ? `Ranked ${flag.ranking}` : 'Unranked'}
                    </div>
                    {flag.suggestions.length > 0 && (
                      <div style={{ paddingLeft: 16 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Suggested R1/R2 alternatives:</div>
                        {flag.suggestions.map(s => (
                          <div key={s.isin} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
                            {s.ranking} · {s.name} · 1Y {s.return_1y != null ? fp(s.return_1y) : '—'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.sleeve_warnings?.length > 0 && (
              <div style={{ marginBottom: 16, padding: 14, background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.3)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92700A', marginBottom: 8, letterSpacing: '.04em', textTransform: 'uppercase' }}>Sleeve cap warnings</div>
                {result.sleeve_warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#92700A', marginBottom: 4 }}>
                    ⚠ {w.message}
                  </div>
                ))}
              </div>
            )}

            {/* Efficient frontier + strategy selector side by side */}
            {(() => {
              const frontier = result.frontier || [];
              const allPts = [...frontier, ...(result.curve || [])];
              const allVols = allPts.map(p => p[0]);
              const allRets = allPts.map(p => p[1]);
              const minVol = Math.min(...allVols), maxVol = Math.max(...allVols);
              const minRet = Math.min(...allRets), maxRet = Math.max(...allRets);
              const W = 400, H = 200, PAD = 28;
              const toX = v => PAD + ((v - minVol) / (maxVol - minVol || 1)) * (W - PAD * 2);
              const toY = r => H - PAD - ((r - minRet) / (maxRet - minRet || 1)) * (H - PAD * 2);
              const SCOL = { max_sharpe: '#912F63', min_volatility: '#1A7A52', max_return: '#3E3452' };
              const SLBL = { max_sharpe: 'Max Sharpe', min_volatility: 'Min Volatility', max_return: 'Max Return' };
              return (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'stretch' }}>
                  {/* Left — frontier chart 70% */}
                  <div style={{ flex: 7, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Efficient Frontier</div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: '#fff', padding: 10, flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <svg width="100%" style={{ display: 'block', flex: 1 }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
                        {/* Frontier dots — coloured by Sharpe (teal=low, yellow=high) */}
                        {(() => {
                          const sharpes = frontier.map(x => x[2] ?? 0);
                          const sMin = Math.min(...sharpes), sMax = Math.max(...sharpes);
                          return frontier.map((p, i) => {
                            const t = sMax > sMin ? ((p[2] ?? 0) - sMin) / (sMax - sMin) : 0.5;
                            const r = Math.round(t * 255);
                            const g = Math.round(180 + t * 75);
                            const b = Math.round((1 - t) * 180);
                            return <circle key={i} cx={toX(p[0])} cy={toY(p[1])} r={2} fill={`rgb(${r},${g},${b})`} opacity={0.75} />;
                          });
                        })()}

                        {Object.entries(result.strategies || {}).map(([key, strat]) => {
                          if (!strat?.metrics) return null;
                          const cx = toX(strat.metrics.volatility), cy = toY(strat.metrics.return);
                          return <g key={key}>
                            <circle cx={cx} cy={cy} r={8} fill={SCOL[key]} opacity={0.15} />
                            <circle cx={cx} cy={cy} r={4} fill={SCOL[key]} />
                            <text x={cx} y={cy - 9} textAnchor="middle" fontSize={6} fontWeight="700" fill={SCOL[key]}>{SLBL[key]}</text>
                          </g>;
                        })}
                        <text x={W/2} y={H-6} textAnchor="middle" fontSize={6} fill="#aaa">Volatility (%)</text>
                        <text x={10} y={H/2} textAnchor="middle" fontSize={6} fill="#aaa" transform={`rotate(-90,10,${H/2})`}>Return (%)</text>
                      </svg>
                      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 4 }}>
                        {Object.entries(SCOL).map(([k, c]) => (
                          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text-muted)' }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />{SLBL[k]}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* Right — strategy cards 30% */}
                  <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                {STRAT_OPTIONS.map(opt => {
                  const s = result.strategies?.[opt.id];
                  const sel = selectedStrat === opt.id;
                  return (
                    <div key={opt.id} onClick={() => setSelectedStrat(opt.id)}
                      style={{ border: `2px solid ${sel ? opt.color : 'var(--border)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', background: sel ? `${opt.color}08` : '#fff', transition: 'all .15s', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: opt.color }}>{opt.icon}</span>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: opt.color }}>{opt.label}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{opt.desc}</div>
                        </div>
                      </div>
                      {s?.metrics ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>
                          <MetricCard label="Return" value={`${s.metrics.return >= 0 ? '+' : ''}${s.metrics.return}%`} color={s.metrics.return >= 0 ? 'var(--pos)' : 'var(--neg)'} />
                          <MetricCard label="Volatility" value={`${s.metrics.volatility}%`} />
                          <MetricCard label="Sharpe" value={f2(s.metrics.sharpe)} color={s.metrics.sharpe >= 0.5 ? 'var(--pos)' : 'var(--text-muted)'} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Not available</div>
                      )}
                    </div>
                  );
                })}
                  </div>
                </div>
              );
            })()}

            {/* Weight comparison table */}
            {strat && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Weight rebalancing — {strat.name}</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Fund</th>
                        <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Current</th>
                        <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)' }}>Optimised</th>
                        <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funds.map((f, idx) => {
                        // Current = original build portfolio weights (never the optimised ones)
                        const baseWeights = Object.keys(originalWeights).length > 0 ? originalWeights : weights;
                        const cur = baseWeights[f.isin] || 0;
                        const opt = parseFloat((strat.weights[f.isin] ?? cur).toFixed(1));
                        const diff = opt - cur;
                        return (
                          <tr key={f.isin} style={{ borderBottom: idx < funds.length - 1 ? '1px solid var(--border)' : 'none' }}>
                            <td style={{ padding: '10px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 3, height: 28, borderRadius: 2, background: f.color || COLORS[idx % COLORS.length], flexShrink: 0 }} />
                                <div>
                                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{f.name}</div>
                                  <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 10, color: 'var(--text-muted)' }}>{f.category}</span>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{cur}%</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--brand-primary)' }}>{opt}%</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: diff > 0 ? 'var(--pos)' : diff < 0 ? 'var(--brand-primary)' : 'var(--text-muted)' }}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 }}>
              <strong>Disclaimer:</strong> These optimised weights are generated using Monte Carlo simulation based on historical NAV data. Past performance is not indicative of future returns. This is for illustrative purposes only and does not constitute investment advice. BugleRock Capital does not guarantee the accuracy or completeness of this analysis.
            </div>

            {/* Apply button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={onBack} style={{ padding: '8px 18px', border: '1px solid var(--border)', borderRadius: 20, background: '#fff', fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>← Back</button>
              <button onClick={applyStrategy} disabled={!strat}
                style={{ padding: '8px 22px', border: 'none', borderRadius: 20, background: strat ? 'var(--brand-primary)' : 'var(--border)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: strat ? 'pointer' : 'not-allowed' }}>
                Apply {strat?.name} → Compare
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}