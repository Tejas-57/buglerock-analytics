import React, { useState, useEffect, useMemo } from 'react';
import { fp, f2, COLORS } from './BuildPortfolio';

const API = process.env.REACT_APP_API_URL || '';
const BERRY = '#912F63', PLUM = '#3E3452', MUT = '#6D5479';
const POS = '#1A7A52', NEG = '#B91C1C', WARN = '#D97706';
const GR10 = '#F8F6FA', GR20 = '#E8E5EC', GR60 = '#A2A0A0', GR80 = '#374151';

const OBJECTIVES = [
  { id: 'max_sharpe',     label: 'Max Sharpe ratio', desc: 'Best return per unit of risk — the classic MVO objective.' },
  { id: 'max_return',    label: 'Max returns',      desc: 'Highest 3Y return, regardless of risk taken.' },
  { id: 'min_volatility', label: 'Min volatility',   desc: 'Lowest portfolio volatility — for conservative mandates.' },
];
const OBJ_COLOR = { max_sharpe: BERRY, max_return: PLUM, min_volatility: POS };

function NI({ value, onChange, placeholder = '—', min = 0, max = 100, step = 0.5, width = 70, disabled = false }) {
  const [local, setLocal] = React.useState(value === '' || value == null ? '' : String(value));

  // Sync local when parent value changes (e.g. IPS auto-fill)
  React.useEffect(() => {
    setLocal(value === '' || value == null ? '' : String(value));
  }, [value]);

  function handleChange(e) {
    const raw = e.target.value;
    // Allow empty, digits, single decimal point — no leading zeros except "0."
    if (raw === '' || raw === '-') { setLocal(raw); return; }
    if (/^0[0-9]/.test(raw)) { setLocal(raw.replace(/^0+/, '') || '0'); return; }
    setLocal(raw);
  }

  function handleBlur() {
    const n = parseFloat(local);
    if (local === '' || isNaN(n)) { onChange(''); }
    else { const clamped = Math.min(max, Math.max(min, n)); onChange(clamped); setLocal(String(clamped)); }
  }

  return (
    <input type="number" value={local} onChange={handleChange} onBlur={handleBlur}
      placeholder={placeholder} min={min} max={max} step={step} disabled={disabled}
      style={{ width, padding: '5px 7px', border: `1.5px solid ${GR20}`, borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', outline: 'none', background: disabled ? GR10 : '#fff', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'text' }} />
  );
}

function MinMax({ label, sub, minVal, maxVal, onMin, onMax, noMin }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: GR80, marginBottom: 5 }}>
        {label}{sub && <span style={{ fontSize: 9.5, fontWeight: 400, color: GR60 }}> — {sub}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: GR60, width: 22, opacity: noMin ? 0.4 : 1 }}>Min</span>
        <NI value={minVal} onChange={onMin} disabled={noMin} width={66} />
        <span style={{ fontSize: 10, color: GR60 }}>%</span>
        <span style={{ fontSize: 10, color: GR60, width: 26, textAlign: 'center' }}>Max</span>
        <NI value={maxVal} onChange={onMax} width={66} />
        <span style={{ fontSize: 10, color: GR60 }}>%</span>
      </div>
    </div>
  );
}

// Compute display metrics for a strategy using Morningstar snapshot data
// consistent with Compare tab — weighted avg rebased for null funds
function blendMetricsFromWeights(funds, wtMap, snapshots) {
  let ret3y = 0, std3y = 0, sharpe = 0;
  let wRet = 0, wStd = 0, wSh = 0;
  funds.forEach(f => {
    const w = (wtMap[f.isin] || 0) / 100;
    if (w <= 0) return;
    const s = snapshots[f.isin] || {};
    const r = s.risk || {};
    if (s.returns?.['3y'] != null && !isNaN(parseFloat(s.returns['3y']))) {
      ret3y += parseFloat(s.returns['3y']) * w; wRet += w;
    }
    if (r.std_dev_3y != null && !isNaN(parseFloat(r.std_dev_3y))) {
      std3y += parseFloat(r.std_dev_3y) * w; wStd += w;
    }
    if (r.sharpe_ratio_3y != null && !isNaN(parseFloat(r.sharpe_ratio_3y))) {
      sharpe += parseFloat(r.sharpe_ratio_3y) * w; wSh += w;
    }
  });
  return {
    ret3y:  wRet  > 0 ? ret3y  / wRet  : null,
    std3y:  wStd  > 0 ? std3y  / wStd  : null,
    sharpe: wSh   > 0 ? sharpe / wSh   : null,
  };
}

function blendMetrics(funds, weights, snapshots) {
  let std3y = 0, ret3y = 0, sharpe = 0, wused = 0;
  funds.forEach(f => {
    const w = (weights[f.isin] || 0) / 100;
    const s = snapshots[f.isin] || {};
    const r = s.risk || {};
    const v = r.std_dev_3y;
    if (v != null && !isNaN(parseFloat(v))) { std3y += parseFloat(v) * w; wused += w; }
    if (s.returns?.['3y'] != null) ret3y += parseFloat(s.returns['3y']) * w;
    if (r.sharpe_ratio_3y != null) sharpe += parseFloat(r.sharpe_ratio_3y) * w;
  });
  // Rebase std3y by wused so funds with null std_dev don't drag the number down
  return { std3y: wused > 0 ? std3y / wused : 0, ret3y, sharpe };
}

export default function Optimise({ funds, weights, snapshots = {}, setSnapshots, setWeights, originalWeights = {}, setOriginalWeights, benchmarks = [], ips = {}, onBack, onCompare, selectedDate, savedResult = null, onSaveResult }) {
  const [activeTab, setActiveTab]       = useState('configure');
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState(savedResult);
  const [error, setError]               = useState(null);
  const [selectedStrat, setSelectedStrat] = useState('max_sharpe');
  const [manualWeights, setManualWeights] = useState({});

  const [objective, setObjective]         = useState('max_sharpe');
  const [nSims, setNSims]                 = useState(5000);
  const [respectIPS, setRespectIPS]       = useState(true);
  const [minW, setMinW]                   = useState(5);
  const [maxW, setMaxW]                   = useState(15);
  const [minEq, setMinEq]                 = useState('');
  const [maxEq, setMaxEq]                 = useState('');
  const [minDebt, setMinDebt]             = useState('');
  const [maxDebt, setMaxDebt]             = useState('');
  const [minComm, setMinComm]             = useState('');
  const [maxComm, setMaxComm]             = useState('');
  const [maxSc, setMaxSc]                 = useState('');
  const [minIntl, setMinIntl]             = useState('');
  const [maxIntl, setMaxIntl]             = useState('');
  const [maxVol, setMaxVol]               = useState('');
  const [capPreciousMetals, setCapPreciousMetals] = useState(10);
  const [capPassive, setCapPassive]               = useState(10);
  const [capInternational, setCapInternational]   = useState(10);
  const [capThematic, setCapThematic]             = useState(10);

  const dateStr     = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : (selectedDate || '');
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);

  useEffect(() => {
    if (respectIPS && ips.alloc) {
      setMinEq(ips.alloc.eqMin ?? ''); setMaxEq(ips.alloc.eqMax ?? '');
      setMinDebt(ips.alloc.debtMin ?? ''); setMaxDebt(ips.alloc.debtMax ?? '');
      setMaxSc(ips.alloc.scMax ?? '');
      setMinIntl(ips.alloc.intlMin ?? ''); setMaxIntl(ips.alloc.intlMax ?? '');
    } else if (!respectIPS) {
      setMinEq(''); setMaxEq(''); setMinDebt(''); setMaxDebt('');
      setMaxSc(''); setMinIntl(''); setMaxIntl('');
    }
  }, [respectIPS]);

  useEffect(() => { if (savedResult && !result) { setResult(savedResult); setActiveTab('results'); } }, [savedResult]);

  // Fetch missing snapshots — in case user reached Optimise without visiting Analyse
  useEffect(() => {
    const missing = funds.filter(f => !snapshots[f.isin]);
    if (missing.length === 0 || !setSnapshots) return;
    const dateStr2 = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : (selectedDate || '');
    missing.forEach(f => {
      fetch(`${API}/api/home/snapshot?isin=${f.isin}&date=${dateStr2}`)
        .then(r => r.json())
        .then(data => { if (data && !data.error) setSnapshots(prev => ({ ...prev, [f.isin]: data })); })
        .catch(() => {});
    });
  }, [funds.map(f => f.isin).join(',')]);
  useEffect(() => {
    if (result?.insufficient_data?.length > 0) {
      const m = { ...manualWeights };
      result.insufficient_data.forEach(f => { if (!(f.isin in m)) m[f.isin] = weights[f.isin] || 0; });
      setManualWeights(m);
    }
  }, [result]);

  const currM = useMemo(() => blendMetrics(funds, weights, snapshots), [funds, weights, snapshots]);
  const volColor = currM.std3y <= 13 ? POS : currM.std3y <= 20 ? WARN : NEG;
  const volLabel = currM.std3y <= 10 ? 'Low — conservative-grade.'
    : currM.std3y <= 13 ? 'Mod-conservative range.'
    : currM.std3y <= 16 ? 'Moderate — typical diversified equity.'
    : currM.std3y <= 20 ? 'Mod-aggressive — elevated but typical for equity-heavy.'
    : 'High volatility — aggressive portfolio.';

  const violations = [];
  if (minW * funds.length > 100) violations.push(`Min weight × ${funds.length} funds = ${minW * funds.length}%`);
  if (maxVol !== '' && currM.std3y > maxVol) violations.push(`Current vol ${currM.std3y.toFixed(1)}% > cap ${maxVol}%`);

  async function runOptimise() {
    setLoading(true); setError(null); setActiveTab('results');
    const payload = {
      funds: funds.map(f => { const s = snapshots[f.isin] || {}; return { isin: f.isin, name: f.name, weight: weights[f.isin] || 0, category: f.category || '', asset_class: f.asset_class || 'Equity', ranking: f.ranking || null, small_cap_pct: s.small_cap != null ? parseFloat(s.small_cap) || null : null, mid_cap_pct: s.mid_cap != null ? parseFloat(s.mid_cap) || null : null, large_cap_pct: s.large_cap != null ? parseFloat(s.large_cap) || null : null }; }),
      ips: {
        riskProfile: ips.riskProfile || 'Moderate',
        equity:   { min: +minEq || 0,  max: +maxEq || 100 },
        debt:     { min: +minDebt || 0, max: +maxDebt || 100 },
        largeCap: { min: +(ips.alloc?.lcMin ?? 0), max: +(ips.alloc?.lcMax ?? 100) },
        midCap:   { min: +(ips.alloc?.mcMin ?? 0), max: +(ips.alloc?.mcMax ?? 100) },
        smallCap: { min: 0, max: +maxSc || 100 },
      },
      config: { objective, nSims, respectIPS, minW, maxW, maxVol: maxVol || null, minComm: minComm || null, maxComm: maxComm || null, maxSc: maxSc || null, minIntl: minIntl || null, maxIntl: maxIntl || null, capPreciousMetals, capPassive, capInternational, capThematic },
      manual_weights: manualWeights,
      date: dateStr,
    };
    try {
      const res = await fetch(`${API}/api/portfolio/optimise`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else { setResult(data); if (onSaveResult) onSaveResult(data); setSelectedStrat(objective); }
    } catch { setError('Failed to connect to optimiser.'); }
    finally { setLoading(false); }
  }

  function applyStrategy() {
    const strat = result?.strategies?.[selectedStrat];
    if (!strat) return;
    // Save original weights before overwriting
    setOriginalWeights(prev => Object.keys(prev).length > 0 ? prev : { ...weights });
    // Build optimised weight map
    const newW = {};
    funds.forEach(f => { newW[f.isin] = strat.weights[f.isin] ?? weights[f.isin] ?? 0; });
    // Normalize to exactly 100% to avoid floating point drift
    const total = Object.values(newW).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 100) > 0.01) {
      const isins = Object.keys(newW);
      const scale = 100 / total;
      let normalized = 0;
      isins.forEach((isin, i) => {
        if (i === isins.length - 1) {
          newW[isin] = parseFloat((100 - normalized).toFixed(2));
        } else {
          newW[isin] = parseFloat((newW[isin] * scale).toFixed(2));
          normalized += newW[isin];
        }
      });
    }
    setWeights(newW);
    onCompare();
  }

  if (!funds.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, padding: '60px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 32, opacity: .3 }}>◈</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, color: 'var(--brand-dark)' }}>No portfolio to optimise</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 260 }}>Add at least two funds and set their weights in Step 2.</div>
    </div>
  );

  const strat = result?.strategies?.[selectedStrat];

  function TabStrip() {
    const tabs = [
      { id: 'configure', label: '⚙ Configure', desc: 'Set constraints & objective' },
      { id: 'results',   label: '◈ Optimised results', desc: result ? 'Frontier, strategies & weights' : 'Run optimisation first', disabled: !result && !loading },
    ];
    return (
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: `2px solid ${GR20}`, background: '#fff', padding: '0 20px', gap: 2, flexShrink: 0 }}>
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => !t.disabled && setActiveTab(t.id)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              padding: '10px 16px', border: 'none', background: 'none', cursor: t.disabled ? 'not-allowed' : 'pointer',
              borderBottom: `3px solid ${activeTab === t.id ? BERRY : 'transparent'}`,
              opacity: t.disabled ? 0.4 : 1, transition: 'all .12s', marginBottom: -2,
            }}>
            <span style={{ fontSize: 12, fontWeight: activeTab === t.id ? 700 : 500, color: activeTab === t.id ? BERRY : GR80 }}>{t.label}</span>
            <span style={{ fontSize: 9.5, color: GR60, marginTop: 1 }}>{t.desc}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {result && (
            <span style={{ fontSize: 10, color: POS, fontWeight: 600 }}>
              ✓ Last run: {nSims.toLocaleString()} sims · {OBJECTIVES.find(o => o.id === selectedStrat)?.label}
            </span>
          )}
          <button onClick={runOptimise} disabled={loading || Math.abs(totalWeight - 100) > 0.1}
            style={{ padding: '7px 20px', border: 'none', borderRadius: 20, background: loading || Math.abs(totalWeight - 100) > 0.1 ? GR20 : BERRY, color: loading || Math.abs(totalWeight - 100) > 0.1 ? GR60 : '#fff', fontSize: 12, fontWeight: 600, cursor: loading || Math.abs(totalWeight - 100) > 0.1 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? '⏳ Running…' : result ? 'Run Optimizer ⚡' : '⚡ Run optimisation'}
          </button>
        </div>
      </div>
    );
  }

  function ConfigureTab() {
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ background: GR10, borderBottom: `1px solid ${GR20}`, padding: '10px 20px', display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 210 }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: GR60, marginBottom: 4 }}>Optimisation objective</div>
            <select value={objective} onChange={e => setObjective(e.target.value)}
              style={{ padding: '7px 10px', border: `1.5px solid ${GR20}`, borderRadius: 8, fontSize: 12, background: '#fff', outline: 'none', color: GR80, width: '100%' }}>
              {OBJECTIVES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <div style={{ fontSize: 10, color: GR60, marginTop: 3 }}>{OBJECTIVES.find(o => o.id === objective)?.desc}</div>
          </div>
          <div style={{ minWidth: 170 }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: GR60, marginBottom: 4 }}>Monte Carlo simulations</div>
            <select value={nSims} onChange={e => setNSims(+e.target.value)}
              style={{ padding: '7px 10px', border: `1.5px solid ${GR20}`, borderRadius: 8, fontSize: 12, background: '#fff', outline: 'none', color: GR80, width: '100%' }}>
              <option value={1000}>1,000 — Fast</option>
              <option value={3000}>3,000</option>
              <option value={5000}>5,000 — Default</option>
              <option value={10000}>10,000 — Deep</option>
            </select>
            <div style={{ fontSize: 10, color: GR60, marginTop: 3 }}>Feasible portfolios sampled per run.</div>
          </div>
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: GR60, marginBottom: 4 }}>IPS constraints</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '7px 12px', border: `1.5px solid ${respectIPS ? BERRY : GR20}`, borderRadius: 8, background: respectIPS ? 'rgba(145,47,99,.06)' : '#fff', fontSize: 12, color: GR80 }}>
              <input type="checkbox" checked={respectIPS} onChange={e => setRespectIPS(e.target.checked)} style={{ accentColor: BERRY, width: 14, height: 14 }} />
              <span style={{ fontWeight: 500 }}>Honour IPS</span>
              {ips.riskProfile && <span style={{ fontSize: 9.5, color: BERRY, background: '#fff', padding: '1px 7px', borderRadius: 12, border: `1px solid ${BERRY}` }}>{ips.riskProfile}</span>}
            </label>
            <div style={{ fontSize: 10, color: GR60, marginTop: 3 }}>
              {respectIPS && ips.alloc ? <span style={{ color: POS }}>✓ IPS targets imported — override any field below.</span>
                : respectIPS && !ips.alloc ? <span style={{ color: WARN }}>⚠ No IPS allocation set. Fill Section D or enter manually.</span>
                : 'Leave blank = unconstrained.'}
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="ptf-card" style={{ marginBottom: 0 }}>
            <div className="ptf-card-hd">Position constraints</div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: GR80, marginBottom: 5 }}>Min weight per fund</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <NI value={minW} onChange={setMinW} min={0} max={20} step={0.5} width={66} />
                  <span style={{ fontSize: 11, color: GR60 }}>%</span>
                </div>
                <div style={{ fontSize: 10, color: GR60, marginTop: 4, lineHeight: 1.5 }}>Floor — prevents holdings collapsing to zero. Typical: 5%.</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: GR80, marginBottom: 5 }}>Max weight per fund</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <NI value={maxW} onChange={setMaxW} min={5} max={100} step={1} width={66} />
                  <span style={{ fontSize: 11, color: GR60 }}>%</span>
                </div>
                <div style={{ fontSize: 10, color: GR60, marginTop: 4, lineHeight: 1.5 }}>Ceiling — prevents single-fund dominance. Typical: 15–25%.</div>
              </div>
            </div>
          </div>

          <div className="ptf-card" style={{ marginBottom: 0 }}>
            <div className="ptf-card-hd">
              Asset class exposure
              {respectIPS && ips.alloc && (
                <span style={{ fontSize: 9, color: BERRY, background: 'rgba(145,47,99,.06)', border: `1px solid rgba(145,47,99,.2)`, borderRadius: 10, padding: '2px 8px', fontWeight: 600 }}>
                  ✓ From IPS — editable
                </span>
              )}
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MinMax label="Equity" minVal={minEq} maxVal={maxEq} onMin={setMinEq} onMax={setMaxEq} />
              <div style={{ fontSize: 9.5, color: GR60, marginTop: -6 }}>Domestic equity (all caps) + international equity funds.</div>
              <MinMax label="Debt" minVal={minDebt} maxVal={maxDebt} onMin={setMinDebt} onMax={setMaxDebt} />
              <div style={{ fontSize: 9.5, color: GR60, marginTop: -6 }}>Bonds, gilt, liquid, credit risk, duration funds.</div>
              <MinMax label="Commodities" minVal={minComm} maxVal={maxComm} onMin={setMinComm} onMax={setMaxComm} />
              <div style={{ fontSize: 9.5, color: GR60, marginTop: -6 }}>Gold ETFs, silver, multi-commodity funds.</div>
              <MinMax label="Small cap" sub="within equity" minVal="" maxVal={maxSc} onMin={() => {}} onMax={setMaxSc} noMin />
              <div style={{ fontSize: 9.5, color: GR60, marginTop: -6 }}>Guide: Conservative 15% · Moderate 28% · Aggressive 40%.</div>
              <MinMax label="Global allocation" sub="within equity" minVal={minIntl} maxVal={maxIntl} onMin={setMinIntl} onMax={setMaxIntl} />
              <div style={{ fontSize: 9.5, color: GR60, marginTop: -6 }}>International, global, US, EM, and overseas equity funds.</div>
              <div style={{ fontSize: 9.5, color: GR60 }}>Leave blank = unconstrained.</div>
            </div>
          </div>

          <div className="ptf-card" style={{ marginBottom: 0 }}>
            <div className="ptf-card-hd">Portfolio risk guardrail</div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: GR80, marginBottom: 5 }}>Max portfolio std deviation</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <NI value={maxVol} onChange={setMaxVol} min={1} max={50} step={0.5} width={66} />
                  <span style={{ fontSize: 11, color: GR60 }}>% annualised</span>
                </div>
                <div style={{ fontSize: 10, color: GR60, marginTop: 6, lineHeight: 1.6 }}>
                  Hard ceiling on 3Y annualised std dev.<br /><br />
                  <span style={{ color: GR80, fontWeight: 500 }}>Risk profile benchmarks:</span><br />
                  Conservative: ≤ 10% · Mod-conservative: ≤ 13%<br />
                  Moderate: ≤ 16% · Mod-aggressive: ≤ 20%<br />
                  Aggressive: ≤ 25% · Blank: unconstrained
                </div>
              </div>
              {currM.std3y > 0 && (
                <div style={{ background: GR10, border: `1px solid ${GR20}`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GR60, marginBottom: 6 }}>Current portfolio</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 700, color: volColor }}>{currM.std3y.toFixed(1)}%</span>
                    <span style={{ fontSize: 10, color: GR60 }}>3Y std dev</span>
                  </div>
                  <div style={{ height: 5, background: GR20, borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ width: Math.min(100, currM.std3y / 30 * 100).toFixed(0) + '%', height: '100%', background: volColor, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10, color: GR60 }}>{volLabel}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '0 16px 14px' }}>
          <div className="ptf-card">
            <div className="ptf-card-hd">
              Internal sleeve caps
              <span style={{ fontSize: 9, fontWeight: 400, color: GR60, textTransform: 'none', letterSpacing: 0 }}>each capped at 10% by default; adjust as needed</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                ['Precious metals / alternatives', capPreciousMetals, setCapPreciousMetals, 'Gold ETFs, silver, multi-commodity'],
                ['Equity passive (index / ETF)',   capPassive,        setCapPassive,        'Index funds, ETFs tracking benchmarks'],
                ['Thematic funds',                 capThematic,       setCapThematic,       'Sector, ESG, smart-beta funds'],
              ].map(([label, val, setter, hint]) => (
                <div key={label}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: GR80, marginBottom: 4 }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: GR60 }}>Max</span>
                    <NI value={val} onChange={setter} min={0} max={100} step={1} width={58} />
                    <span style={{ fontSize: 10, color: GR60 }}>%</span>
                  </div>
                  <div style={{ fontSize: 9, color: GR60, marginTop: 3 }}>{hint}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: '9px 20px', background: violations.length === 0 ? '#E8F5EE' : '#FEF3C7', borderTop: `1px solid ${GR20}`, borderBottom: `1px solid ${GR20}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13 }}>{violations.length === 0 ? '✅' : '⚠️'}</span>
          <div style={{ flex: 1, fontSize: 11, lineHeight: 1.55, color: GR80 }}>
            {violations.length === 0
              ? <span><strong style={{ color: POS }}>Ready to optimise</strong> — all constraints are valid. Click <strong>⚡ Run optimisation</strong> above.</span>
              : <span><strong style={{ color: WARN }}>{violations.join(' · ')}</strong> — adjust constraints before running.</span>}
          </div>
          {Math.abs(totalWeight - 100) > 0.1 && <span style={{ fontSize: 11, color: WARN, fontWeight: 600 }}>Weights sum to {totalWeight}% — must be 100%</span>}
        </div>
      </div>
    );
  }

  function ResultsTab() {
    if (loading) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', border: `3px solid ${GR20}`, borderTopColor: BERRY, animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: GR80 }}>Running Monte Carlo simulations…</div>
            <div style={{ fontSize: 12, color: GR60 }}>Sampling feasible portfolios · Filtering by constraints · Building efficient frontier</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );

    if (error) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
        <div style={{ fontSize: 28, opacity: .4 }}>⚠</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: BERRY }}>{error}</div>
        <button onClick={() => setActiveTab('configure')}
          style={{ padding: '8px 20px', border: `1px solid ${GR20}`, borderRadius: 20, background: '#fff', fontSize: 12, cursor: 'pointer', color: GR80 }}>
          ← Back to configure
        </button>
      </div>
    );

    if (!result) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 32, opacity: .2 }}>◈</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: GR80 }}>No results yet</div>
        <div style={{ fontSize: 12, color: GR60 }}>Configure your constraints and click Run optimisation.</div>
        <button onClick={() => setActiveTab('configure')}
          style={{ padding: '8px 20px', border: `1px solid ${GR20}`, borderRadius: 20, background: '#fff', fontSize: 12, cursor: 'pointer', color: GR80 }}>
          ← Go to configure
        </button>
      </div>
    );

    const frontier = result.frontier || [];
    const allVols = frontier.map(p => p[0]);
    const allRets = frontier.map(p => p[1]);
    // Include strategy dot positions in range so they're always inside bounds
    Object.values(result.strategies || {}).forEach(s => {
      if (s?.metrics) { allVols.push(s.metrics.volatility); allRets.push(s.metrics.return); }
    });
    const vMin = Math.min(...allVols), vMax = Math.max(...allVols);
    const rMin = Math.min(...allRets), rMax = Math.max(...allRets);
    const W = 500, H = 240, PAD = 55;
    const toX = v => PAD + ((v - vMin) / (vMax - vMin || 1)) * (W - PAD * 2);
    const toY = r => H - PAD - ((r - rMin) / (rMax - rMin || 1)) * (H - PAD * 2);

    try { return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: GR60, textTransform: 'uppercase', letterSpacing: '.06em' }}>Run with:</span>
          {[
            `${nSims.toLocaleString()} sims`,
            OBJECTIVES.find(o => o.id === selectedStrat)?.label || selectedStrat,
            `Min ${minW}% · Max ${maxW}% per fund`,
            maxVol ? `Vol cap ${maxVol}%` : null,
            respectIPS && ips.alloc ? `IPS: ${ips.riskProfile}` : null,
          ].filter(Boolean).map(chip => (
            <span key={chip} style={{ fontSize: 10, padding: '2px 10px', borderRadius: 12, background: GR10, border: `1px solid ${GR20}`, color: GR80 }}>{chip}</span>
          ))}
          <button onClick={() => setActiveTab('configure')}
            style={{ marginLeft: 'auto', padding: '4px 12px', border: `1px solid ${GR20}`, borderRadius: 20, background: '#fff', fontSize: 11, cursor: 'pointer', color: GR60 }}>
            ← Adjust constraints
          </button>
        </div>

        {result.constraint_warnings?.length > 0 && (
          <div style={{ padding: 14, background: 'rgba(180,107,16,.08)', border: '1.5px solid rgba(180,107,16,.35)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: WARN, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              ⚠ Constraints auto-relaxed — results shown with adjusted limits
            </div>
            {result.constraint_warnings.map((cw, i) => (
              <div key={i} style={{ marginBottom: i < result.constraint_warnings.length - 1 ? 10 : 0, paddingBottom: i < result.constraint_warnings.length - 1 ? 10 : 0, borderBottom: i < result.constraint_warnings.length - 1 ? '1px solid rgba(180,107,16,.2)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: GR80 }}>{cw.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, background: 'rgba(180,107,16,.12)', padding: '2px 8px', borderRadius: 10, color: WARN }}>
                    Requested {cw.requested}% → Auto-relaxed to {cw.relaxed_to}%
                  </span>
                </div>
                <div style={{ fontSize: 11, color: GR60, lineHeight: 1.6 }}>{cw.message}</div>
              </div>
            ))}
          </div>
        )}

        {result.insufficient_data?.length > 0 && (
          <div style={{ padding: 14, background: 'rgba(180,107,16,.06)', border: `1px solid rgba(180,107,16,.25)`, borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: WARN, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>⚠ Manual weight required</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>These funds have insufficient NAV history. Set weights manually and re-run.</div>
            {result.insufficient_data.map(f => (
              <div key={f.isin} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{f.name}</span>
                <span style={{ fontSize: 10, color: GR60 }}>{f.weeks}w data</span>
                <input type="number" min="0" max="100" value={manualWeights[f.isin] || 0}
                  onChange={e => setManualWeights(prev => ({ ...prev, [f.isin]: Math.max(0, Math.min(100, +e.target.value || 0)) }))}
                  style={{ width: 52, padding: '3px 6px', border: `1px solid ${WARN}`, borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, textAlign: 'center' }} />
                <span style={{ fontSize: 11, color: GR60 }}>%</span>
              </div>
            ))}
            <button onClick={runOptimise} style={{ marginTop: 8, padding: '6px 14px', border: 'none', borderRadius: 20, background: WARN, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Re-run with manual weights</button>
          </div>
        )}

        {result.ranking_flags?.length > 0 && (
          <div style={{ padding: 14, background: 'rgba(109,84,121,.05)', border: '1px solid rgba(109,84,121,.2)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUT, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Fund quality flags</div>
            {result.ranking_flags.map(flag => (
              <div key={flag.isin} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>⚠ <strong>{flag.name}</strong> — {flag.ranking || 'Unranked'}</div>
                {flag.suggestions?.length > 0 && (
                  <div style={{ paddingLeft: 16 }}>
                    <div style={{ fontSize: 10, color: GR60, marginBottom: 3 }}>Suggested R1/R2 alternatives:</div>
                    {flag.suggestions.map(s => <div key={s.isin} style={{ fontSize: 11, color: GR80, marginBottom: 2 }}>{s.ranking} · {s.name} · 1Y {s.return_1y != null ? fp(s.return_1y) : '—'}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {result.frontier?.length > 0 && <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          <div style={{ flex: 7, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GR60, marginBottom: 6 }}>Efficient Frontier</div>
            <div style={{ border: `1px solid ${GR20}`, borderRadius: 10, background: '#fff', padding: 12, overflow: 'hidden' }}>
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', overflow: 'hidden' }}>
                {(() => {
                  const sharpes = frontier.map(x => x[2] ?? 0);
                  const sMin = Math.min(...sharpes), sMax = Math.max(...sharpes);
                  return frontier.map((p, i) => {
                    const t = sMax > sMin ? ((p[2] ?? 0) - sMin) / (sMax - sMin) : 0.5;
                    return <circle key={i} cx={toX(p[0])} cy={toY(p[1])} r={2.5}
                      fill={`rgb(${Math.round(t*255)},${Math.round(180+t*75)},${Math.round((1-t)*180)})`} opacity={0.7} />;
                  });
                })()}
                {Object.entries(result.strategies || {}).map(([key, s]) => {
                  if (!s?.metrics) return null;
                  const color = OBJ_COLOR[key] || BERRY;
                  const label = OBJECTIVES.find(o => o.id === key)?.label || key;
                  const cx = toX(s.metrics.volatility), cy = toY(s.metrics.return);
                  const labelY = cy < 30 ? cy + 18 : cy - 12;
                  const labelX = Math.max(60, Math.min(W - 60, cx));
                  return (
                    <g key={key}>
                      <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.15} />
                      <circle cx={cx} cy={cy} r={5} fill={color} />
                      <text x={labelX} y={labelY} textAnchor="middle" fontSize={7.5} fontWeight="700" fill={color}>{label}</text>
                    </g>
                  );
                })}
                <text x={W/2} y={H-4} textAnchor="middle" fontSize={8} fill="#bbb">Volatility</text>
                <text x={10} y={H/2} textAnchor="middle" fontSize={8} fill="#bbb" transform={`rotate(-90,10,${H/2})`}>Returns</text>
              </svg>
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 6 }}>
                {OBJECTIVES.map(o => (
                  <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: GR60 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: OBJ_COLOR[o.id] }} />{o.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            {OBJECTIVES.map(opt => {
              const s = result.strategies?.[opt.id];
              const sel = selectedStrat === opt.id;
              const color = OBJ_COLOR[opt.id];
              return (
                <div key={opt.id} onClick={() => setSelectedStrat(opt.id)}
                  style={{ border: `2px solid ${sel ? color : GR20}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', background: sel ? `${color}08` : '#fff', transition: 'all .15s', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color }}>{opt.label}</div>
                    <div style={{ fontSize: 9, color: GR60 }}>{opt.desc}</div>
                  </div>
                  {s?.weights ? (() => {
                    const m = blendMetricsFromWeights(funds, s.weights, snapshots);
                    const ret = m.ret3y, vol = m.std3y, sh = m.sharpe;
                    if (ret == null && vol == null) return <div style={{ fontSize: 10, color: GR60, fontStyle: 'italic' }}>Visit Analyse tab to load fund data</div>;
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
                        {[['Return', ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%` : '—', ret != null ? (ret >= 0 ? POS : NEG) : GR60],
                          ['Vol',    vol != null ? `${vol.toFixed(2)}%` : '—', GR80],
                          ['Sharpe', sh  != null ? f2(sh) : '—', sh != null && sh >= 0.5 ? POS : GR60]].map(([lbl, val, clr]) => (
                          <div key={lbl} style={{ textAlign: 'center', padding: '5px 4px', background: GR10, borderRadius: 6, border: `1px solid ${GR20}` }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: clr }}>{val}</div>
                            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: GR60 }}>{lbl}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })() : <div style={{ fontSize: 10, color: GR60, fontStyle: 'italic' }}>Not available</div>}
                </div>
              );
            })}
          </div>
        </div>}

        {/* Asset class & market cap comparison */}
        {strat && (() => {
          const baseW = Object.keys(originalWeights).length > 0 ? originalWeights : weights;
          const optW = {};
          funds.forEach(f => { optW[f.isin] = strat.weights[f.isin] ?? baseW[f.isin] ?? 0; });

          function blend(wts) {
            // Asset class via fund asset_class field (gold → Commodities, not Equity)
            const wtMap = {};
            funds.forEach(f => { wtMap[f.isin] = (wts[f.isin] || 0); });
            let equity=0, debt=0, cash=0, commodity=0, totalW=0, capW=0;
            let lc=0, mc=0, sc=0;
            funds.forEach(f => {
              const w = (wts[f.isin] || 0) / 100;
              if (w <= 0) return;
              const s = snapshots[f.isin] || {};
              const ac = (s.asset_class || f.asset_class || '').toLowerCase();
              const isPM = ac === 'precious metals';
              const isDebt = ac === 'debt' || ac === 'bond';
              const isHybrid = ac === 'hybrid' || ac === 'allocation' || ac === 'multi-asset';
              const eqPct=parseFloat(s.equity_pct)||0, bdPct=parseFloat(s.bond_pct)||0;
              const cashPct=parseFloat(s.cash_pct)||0, otherPct=parseFloat(s.other_pct)||0;
              const tot=eqPct+bdPct+cashPct+otherPct||100;
              if (isPM) { commodity += w * 100; }
              else if (isDebt) { debt += (bdPct/tot*100)*w; cash += (cashPct/tot*100)*w; debt += (1-(bdPct+cashPct+otherPct)/tot)*w*100; }
              else if (isHybrid) { equity += (eqPct/tot*100)*w; debt += (bdPct/tot*100)*w; cash += (cashPct/tot*100)*w; }
              else { equity += (eqPct>0?eqPct/tot*100:100)*w; debt += (bdPct/tot*100)*w; cash += (cashPct/tot*100)*w; }
              totalW += w;
              // Market cap
              const rawLc=parseFloat(s.large_cap), rawMc=parseFloat(s.mid_cap), rawSc=parseFloat(s.small_cap);
              if (!isNaN(rawLc) && !isNaN(rawMc) && !isNaN(rawSc)) { lc+=rawLc*w; mc+=rawMc*w; sc+=rawSc*w; capW+=w; }
            });
            const capNorm = v => capW > 0 ? v / capW : 0;
            return {
              eq: totalW>0?equity/totalW:0, debt: totalW>0?debt/totalW:0,
              cash: totalW>0?cash/totalW:0, commodity: totalW>0?commodity/totalW:0,
              lc: capNorm(lc), mc: capNorm(mc), sc: capNorm(sc), hasCapData: capW > 0,
            };
          }

          const orig = blend(baseW);
          const opt  = blend(optW);

          const rows = [
            { section: 'Asset class', items: [
              { label: 'Equity',        origV: orig.eq,        optV: opt.eq,        color: BERRY },
              { label: 'Bonds / Debt',  origV: orig.debt,      optV: opt.debt,      color: PLUM  },
              { label: 'Cash / Liquid', origV: orig.cash,      optV: opt.cash,      color: GR60  },
              ...(Math.max(orig.commodity||0, opt.commodity||0) > 0.5 ? [{ label: 'Commodities', origV: orig.commodity, optV: opt.commodity, color: '#D97706' }] : []),
            ]},
            { section: 'Market cap (equity portion)', items: orig.hasCapData ? [
              { label: 'Large cap',  origV: orig.lc, optV: opt.lc, color: BERRY },
              { label: 'Mid cap',    origV: orig.mc, optV: opt.mc, color: MUT   },
              { label: 'Small cap',  origV: orig.sc, optV: opt.sc, color: WARN  },
            ] : [] },
          ];

          // Check if we have any snapshot data at all
          const hasSnapData = funds.some(f => {
            const s = snapshots[f.isin] || {};
            return s.equity_pct != null || s.bond_pct != null;
          });

          if (!hasSnapData) return (
            <div className="ptf-card">
              <div className="ptf-card-hd">Portfolio composition — original vs optimised</div>
              <div style={{ padding: '16px', fontSize: 12, color: GR60 }}>
                Visit the <strong>Analyse</strong> tab first to load fund composition data, then re-run the optimiser.
              </div>
            </div>
          );

          return (
            <div className="ptf-card">
              <div className="ptf-card-hd">Portfolio composition — original vs optimised</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: GR10, borderBottom: `1px solid ${GR20}` }}>
                    <th style={{ padding: '7px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GR60 }}>Metric</th>
                    <th style={{ padding: '7px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GR60 }}>Original</th>
                    <th style={{ padding: '7px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: BERRY }}>Optimised</th>
                    <th style={{ padding: '7px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GR60 }}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ section, items }) => items.length === 0 ? null : (
                    <React.Fragment key={section}>
                      <tr style={{ background: GR10 }}>
                        <td colSpan={4} style={{ padding: '5px 14px', fontSize: 9, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: BERRY }}>{section}</td>
                      </tr>
                      {items.map(({ label, origV, optV, color }) => {
                        const diff = optV - origV;
                        return (
                          <tr key={label} style={{ borderBottom: `1px solid ${GR20}` }}>
                            <td style={{ padding: '8px 14px', color: GR80, fontWeight: 500 }}>{label}</td>
                            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: GR60 }}>{origV.toFixed(1)}%</td>
                            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color }}>{optV.toFixed(1)}%</td>
                            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, color: diff > 0.5 ? POS : diff < -0.5 ? NEG : GR60 }}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {strat && (
          <div style={{ borderRadius: 10, border: `1px solid ${GR20}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: PLUM, color: '#fff' }}>
              <span style={{ fontSize: 14 }}>⚖</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>Weight rebalancing — {strat.name}</div>
                <div style={{ fontSize: 9, opacity: .7, marginTop: 1 }}>Optimised vs current portfolio weights</div>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
              <thead>
                <tr style={{ background: GR10, borderBottom: `1px solid ${GR20}` }}>
                  {[['Fund', 'left'], ['Current', 'right'], ['Optimised', 'right'], ['Change', 'right']].map(([h, align], i) => (
                    <th key={h} style={{ padding: '8px 14px', textAlign: align, fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: i === 2 ? BERRY : GR60 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funds.map((f, idx) => {
                  const baseW = Object.keys(originalWeights).length > 0 ? originalWeights : weights;
                  const cur = baseW[f.isin] || 0;
                  const opt = parseFloat((strat.weights[f.isin] ?? cur).toFixed(1));
                  const diff = opt - cur;
                  return (
                    <tr key={f.isin} style={{ borderBottom: idx < funds.length - 1 ? `1px solid ${GR20}` : 'none' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 3, height: 28, borderRadius: 2, background: f.color || COLORS[idx % COLORS.length], flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{f.name}</div>
                            <span style={{ fontSize: 9, background: GR10, padding: '1px 5px', borderRadius: 10, color: GR60 }}>{f.category}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: GR60 }}>{cur}%</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: BERRY }}>{opt}%</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: diff > 0 ? POS : diff < 0 ? NEG : GR60 }}>
                        {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '10px 14px', background: GR10, borderRadius: 8, border: `1px solid ${GR20}`, fontSize: 10, color: GR60, lineHeight: 1.6 }}>
          <strong>Disclaimer:</strong> Optimised weights are generated using Monte Carlo simulation on historical NAV data. Past performance is not indicative of future returns. For illustrative purposes only — not investment advice. BugleRock Capital does not guarantee accuracy or completeness of this analysis.
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ padding: '8px 18px', border: `1px solid ${GR20}`, borderRadius: 20, background: '#fff', fontSize: 12, cursor: 'pointer', color: GR60 }}>← Edit portfolio</button>
          <button onClick={applyStrategy} disabled={!strat}
            style={{ padding: '9px 24px', border: 'none', borderRadius: 20, background: strat ? BERRY : GR20, color: strat ? '#fff' : GR60, fontSize: 13, fontWeight: 600, cursor: strat ? 'pointer' : 'not-allowed' }}>
            Apply {strat?.name} → Compare
          </button>
        </div>
      </div>
    ); } catch(e) { return (
      <div style={{ padding: 20, color: '#B91C1C', fontSize: 13, background: '#FEF2F2', borderRadius: 8, margin: 16 }}>
        <strong>Render error in Results tab:</strong> {e.message}<br/>
        <pre style={{ fontSize: 11, marginTop: 8, whiteSpace: 'pre-wrap' }}>{e.stack?.slice(0,500)}</pre>
      </div>
    ); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TabStrip />
      {activeTab === 'configure' ? <ConfigureTab /> : <ResultsTab />}
    </div>
  );
}