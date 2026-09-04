import React, { useState, useEffect } from 'react';
import { rtRunSimulation, rtFmt, rtFmtK, rtFmtCr, rtFmtA, rtFmtM } from './rtEngine';
import { rtBuildFullSections, rtOpenReport } from './rtReport';
import './RetirementPlanner.css';

// Indian number formatting utilities
function toIndianStr(val) {
  // Format a number with Indian comma separations (e.g. 10000000 → "1,00,00,000")
  if (val === '' || val === null || val === undefined) return '';
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(n)) return String(val);
  const parts = n.toFixed(0).split('');
  if (parts.length <= 3) return parts.join('');
  const last3 = parts.splice(-3).join('');
  const rest = parts.join('');
  // Group remaining in pairs of 2 from right
  const groups = [];
  let i = rest.length;
  while (i > 0) { groups.unshift(rest.slice(Math.max(0, i - 2), i)); i -= 2; }
  return groups.join(',') + ',' + last3;
}

function fromIndianStr(str) {
  // Parse Indian comma-formatted string to number
  if (str === '' || str === null || str === undefined) return '';
  const cleaned = String(str).replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? '' : n;
}

// Fields that use Indian comma formatting (absolute ₹ amounts)
const INDIAN_FMT_FIELDS = new Set([
  'corpus', 'epf', 'nps', 'onetime',   // lump sum amounts
  'sip', 'epfm', 'npsm',               // monthly contributions
  'expenses', 'otherinc',               // monthly income/expense fields
]);

/* ── Model portfolio presets — fallback values until API responds ── */
const MODEL_PRESETS_DEFAULT = {
  conservative:    { ret: 7.0,  vol: 5.5,  eq: 25,  debt: 60, label: 'Conservative' },
  modConservative: { ret: 8.5,  vol: 7.5,  eq: 38,  debt: 45, label: 'Moderately Conservative' },
  balanced:        { ret: 10.5, vol: 10.0, eq: 55,  debt: 25, label: 'Balanced' },
  modAggressive:   { ret: 12.5, vol: 13.5, eq: 72,  debt: 10, label: 'Moderately Aggressive' },
  aggressive:      { ret: 14.0, vol: 16.0, eq: 85,  debt: 5,  label: 'Aggressive' },
};
const SS_KEY = 'br_model_presets_v1';
const API = process.env.REACT_APP_API_URL || '';
const MODEL_PROFILES = [
  { key: 'conservative',    label: 'Conservative' },
  { key: 'modConservative', label: 'Mod Conservative' },
  { key: 'balanced',        label: 'Balanced' },
  { key: 'modAggressive',   label: 'Mod Aggressive' },
  { key: 'aggressive',      label: 'Aggressive' },
];

const DEFAULTS = {
  name: '', age: 35, retage: 60, lifeexp: 90, spouse: '', rm: 'BugleRock Capital',
  corpus: 5000000, sip: 50000, stepup: 8, sipuntil: 60,
  epf: 1500000, epfm: 12000, epfr: 8.1, nps: 800000, npsm: 10000, npsr: 10, annrate: 6,
  expenses: 100000, replace: 80,
  otherinc: 0, otherindexed: '1', onetime: 0, tax: 10,
  withdrawalStrategy: 'fixed', guardrailTrigger: 15, guardrailCut: 10,
  assumpMode: 'model', accumModel: 'modAggressive', drawdownModel: 'modConservative',
  preret: 12.5, prevol: 13.5, postret: 8.5, postvol: 7.5,
  lateret: 7.0, latevol: 5.5,
  inflation: 6, influnc: 1.5, sims: 500, targetconf: 85,
  crashSeverity: 30,
};
const DEFAULT_GOALS = [
  { name: "Child's Education", age: 48, amt: 4000000 },
  { name: "Child's Marriage", age: 55, amt: 2500000 },
];
const DEFAULT_LUMPS = [{ name: 'Property sale', age: 50, amt: 0 }];

const CHIPS = [
  ['A', 'Personal'], ['B', 'Corpus & SIP'], ['C', 'EPF / NPS'],
  ['D', 'Inflows'], ['E', 'Goals'], ['F', 'Income'], ['G', 'Assumptions'],
];

const LS_FORM    = 'br_rt_form';
const LS_GOALS   = 'br_rt_goals';
const LS_LUMPS   = 'br_rt_lumps';
const LS_RESULT  = 'br_rt_result';
const LS_STEP    = 'br_rt_step';

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function lsClear(...keys) {
  keys.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
}

export default function RetirementPlanner() {
  const [f, setF]         = useState(() => lsGet(LS_FORM,   { ...DEFAULTS }));
  const [goals, setGoals] = useState(() => lsGet(LS_GOALS,  DEFAULT_GOALS.map((g) => ({ ...g }))));
  const [lumps, setLumps] = useState(() => lsGet(LS_LUMPS,  DEFAULT_LUMPS.map((l) => ({ ...l }))));
  const [step, setStep]   = useState(() => lsGet(LS_STEP,   'input'));
  const [result, setResult] = useState(() => lsGet(LS_RESULT, null));
  const [running, setRunning] = useState(false);
  const [modelPresets, setModelPresets] = useState(() => {
    try {
      const cached = sessionStorage.getItem(SS_KEY);
      return cached ? JSON.parse(cached) : MODEL_PRESETS_DEFAULT;
    } catch { return MODEL_PRESETS_DEFAULT; }
  });

  // Fetch live model stats — one call per session, cached in sessionStorage
  useEffect(() => {
    if (sessionStorage.getItem(SS_KEY)) return; // already cached this session
    fetch(`${API}/api/models/portfolios`)
      .then(r => r.json())
      .then(({ portfolios }) => {
        if (!portfolios?.length) return;
        // Map backend keys (mod_conservative) → frontend keys (modConservative)
        const keyMap = { conservative: 'conservative', mod_conservative: 'modConservative', balanced: 'balanced', mod_aggressive: 'modAggressive', aggressive: 'aggressive' };
        const built = { ...MODEL_PRESETS_DEFAULT };
        portfolios.forEach(p => {
          const fkey = keyMap[p.key];
          if (!fkey) return;
          const ret3y = p.blended?.return_3y;
          const vol3y = p.blended?.std_dev_3y;
          const eq    = p.actual?.equity_pct;
          const debt  = p.actual?.debt_pct;
          if (ret3y != null && vol3y != null && eq != null && debt != null) {
            built[fkey] = {
              ...built[fkey],
              ret:  Math.round(ret3y * 10) / 10,
              vol:  Math.round(vol3y * 10) / 10,
              eq:   Math.round(eq),
              debt: Math.round(debt),
            };
          }
        });
        sessionStorage.setItem(SS_KEY, JSON.stringify(built));
        setModelPresets(built);
      })
      .catch(() => {}); // silently keep fallback on error
  }, []);

  // Migrate old localStorage: add new fields if missing
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_FORM);
      if (stored) {
        const parsed = JSON.parse(stored);
        let changed = false;
        const newFields = { withdrawalStrategy: 'fixed', guardrailTrigger: 15, guardrailCut: 10, lateret: 7.0, latevol: 5.5, influnc: 1.5, targetconf: 85, crashSeverity: 30, assumpMode: 'model', accumModel: 'modAggressive', drawdownModel: 'modConservative' };
        for (const [k, v] of Object.entries(newFields)) {
          if (!(k in parsed)) { parsed[k] = v; changed = true; }
        }
        if (changed) {
          localStorage.setItem(LS_FORM, JSON.stringify(parsed));
          setF(prev => ({ ...DEFAULTS, ...prev, ...Object.fromEntries(Object.entries(newFields).filter(([k]) => !(k in prev))) }));
        }
      }
    } catch {}
  }, []);

  // Persist every change
  useEffect(() => { lsSet(LS_FORM,   f);     }, [f]);
  useEffect(() => { lsSet(LS_GOALS,  goals);  }, [goals]);
  useEffect(() => { lsSet(LS_LUMPS,  lumps);  }, [lumps]);
  useEffect(() => { lsSet(LS_STEP,   step);   }, [step]);
  useEffect(() => { lsSet(LS_RESULT, result); }, [result]);

  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const num = (k) => (parseFloat(String(f[k] || '0').replace(/,/g, '')) || 0);

  const collectInputs = () => ({
    name: (f.name || '').trim(),
    age: Math.round(num('age')), retAge: Math.round(num('retage')), lifeExp: Math.round(num('lifeexp')),
    spouse: num('spouse') || null,
    corpus0: num('corpus') / 100000, sipM: num('sip'), stepUp: num('stepup') / 100, sipTill: Math.round(num('sipuntil')),
    epf: num('epf') / 100000, epfM: num('epfm'), epfR: num('epfr') / 100,
    nps: num('nps') / 100000, npsM: num('npsm'), npsR: num('npsr') / 100, annRate: num('annrate') / 100,
    expM: num('expenses'), replace: num('replace') / 100,
    otherIncM: num('otherinc'), otherIndexed: f.otherindexed === '1',
    oneTime: num('onetime') / 100000, tax: num('tax') / 100,
    withdrawalStrategy: f.withdrawalStrategy || 'fixed',
    guardrailTrigger: num('guardrailTrigger') / 100, guardrailCut: num('guardrailCut') / 100,
    preMu: num('preret') / 100, preSig: num('prevol') / 100,
    postMu: num('postret') / 100, postSig: num('postvol') / 100,
    lateMu: num('lateret') / 100, lateSig: num('latevol') / 100,
    infl: num('inflation') / 100, inflUnc: num('influnc') / 100,
    nSims: parseInt(f.sims, 10) || 500,
    targetConf: num('targetconf') || 85,
    crashSeverity: num('crashSeverity') / 100,
    goals: goals.map(g => ({ ...g, age: parseFloat(g.age) || 0, amt: (parseFloat(g.amt) || 0) / 100000 })),
    lumps: lumps.map(l => ({ ...l, age: parseFloat(l.age) || 0, amt: (parseFloat(l.amt) || 0) / 100000 })),
  });

  const run = () => {
    const IN = collectInputs();
    if (IN.retAge < IN.age) { alert('Retirement age must be greater than or equal to current age.'); return; }
    if (IN.lifeExp <= IN.retAge) { alert('Plan-till age must be greater than retirement age.'); return; }
    if (IN.postMu <= IN.infl) { alert(`Post-retirement return (${(IN.postMu*100).toFixed(1)}%) must exceed inflation (${(IN.infl*100).toFixed(1)}%).`); return; }
    setRunning(true);
    setTimeout(() => {
      const R = rtRunSimulation(IN, IN.nSims);
      setResult(R);
      setRunning(false);
      setStep('output');
    }, 30);
  };

  const reset = () => {
    lsClear(LS_FORM, LS_GOALS, LS_LUMPS, LS_RESULT, LS_STEP);
    setF({ ...DEFAULTS });
    setGoals(DEFAULT_GOALS.map((g) => ({ ...g })));
    setLumps(DEFAULT_LUMPS.map((l) => ({ ...l })));
    setResult(null);
    setStep('input');
  };

  return (
    <div className="rt-wrap">
      <div className="rt-hdr">
        <div>
          <div className="rt-title">Retirement Planner</div>
          <div className="rt-sub">Monte Carlo simulation — fill in the inputs, run the simulation, then review the results and download the full report</div>
        </div>
        <div className="rt-steps">
          <button className={`rt-step-tab ${step === 'input' ? 'active' : ''}`} onClick={() => setStep('input')}>① Input</button>
          <button className={`rt-step-tab ${step === 'output' ? 'active' : ''}`} onClick={() => result && setStep('output')} disabled={!result}>② Results</button>
        </div>
        <div className="rt-toolbar">
          <button className="rt-btn rt-btn-ghost" onClick={reset}>↺ Reset</button>
          <button className="rt-btn rt-btn-primary" onClick={run} disabled={running}>{running ? 'Running…' : '▶ Run simulation'}</button>
        </div>
      </div>

      {step === 'input' && (
        <InputForm f={f} set={set} setForm={setF} goals={goals} setGoals={setGoals} lumps={lumps} setLumps={setLumps} onRun={run} running={running} modelPresets={modelPresets} />
      )}
      {step === 'output' && result && (
        <Results R={result} onEdit={() => setStep('input')} />
      )}
    </div>
  );
}

// ══════════════ Field component — must be outside InputForm to keep stable identity ══════════════
function Field({ k, label, type = 'number', f, set, ...rest }) {
  const isNum = type === 'number';
  const useFmt = INDIAN_FMT_FIELDS.has(k);

  // For Indian-formatted fields: display formatted, store raw on blur
  const [display, setDisplay] = React.useState(
    useFmt ? (f[k] ? toIndianStr(f[k]) : '') : (f[k] ?? '')
  );

  // Sync display when f[k] changes externally (e.g. reset)
  React.useEffect(() => {
    if (useFmt) setDisplay(f[k] ? toIndianStr(f[k]) : '');
    else setDisplay(f[k] ?? '');
  }, [f[k]]);

  if (!useFmt) {
    return (
      <div className="rt-f">
        <label>{label}</label>
        <input
          type="text"
          inputMode={isNum ? 'decimal' : 'text'}
          value={f[k] ?? ''}
          onChange={set(k)}
          {...rest}
        />
      </div>
    );
  }

  // Indian comma formatted field
  return (
    <div className="rt-f">
      <label>{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => {
          // Allow only digits and commas while typing
          const raw = e.target.value.replace(/[^\d]/g, '');
          if (raw === '') { setDisplay(''); return; }
          const num = parseFloat(raw);
          if (!isNaN(num)) setDisplay(toIndianStr(num));
        }}
        onBlur={(e) => {
          // On blur: parse and store the raw number, reformat display
          const raw = e.target.value.replace(/,/g, '');
          const num = parseFloat(raw);
          const stored = isNaN(num) ? 0 : num;
          setDisplay(toIndianStr(stored));
          // Trigger state update with raw number string
          set(k)({ target: { value: String(stored) } });
        }}
        onFocus={(e) => {
          // On focus: show raw number without commas for easier editing
          const raw = String(f[k] || '').replace(/,/g, '');
          setDisplay(raw === '0' ? '' : raw);
        }}
        {...rest}
      />
    </div>
  );
}

// ══════════════ Input Form ══════════════
function InputForm({ f, set, setForm, goals, setGoals, lumps, setLumps, onRun, running, modelPresets }) {

  return (
    <>
      <div className="rt-chips">
        {CHIPS.map(([code, label], i) => (
          <React.Fragment key={code}>
            <div
              className={`rt-chip ${i === 0 ? 'on' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const el = document.getElementById(`rt-section-${code}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            ><span>{code}</span> {label}</div>
            {i < CHIPS.length - 1 && <div className="rt-chip-sep">›</div>}
          </React.Fragment>
        ))}
      </div>

      {/* A — Personal */}
      <Section code="A" title="Personal details" sub="Client identity and retirement timeline">
        <div className="rt-grid rt-grid-5">
          <div className="rt-f" style={{ gridColumn: 'span 2' }}>
            <label>Client name</label>
            <input type="text" value={f.name} onChange={set('name')} placeholder="e.g. XXX" />
          </div>
          <Field f={f} set={set} k="age" label="Current age" min="18" max="70" />
          <Field f={f} set={set} k="retage" label="Retirement age" min="40" max="75" />
          <Field f={f} set={set} k="lifeexp" label="Plan till age" min="70" max="105" />
          <Field f={f} set={set} k="spouse" label="Spouse age (opt.)" placeholder="—" min="18" max="80" />
          <div className="rt-f">
            <label>Prepared by</label>
            <input type="text" value={f.rm} onChange={set('rm')} />
          </div>
        </div>
      </Section>

      {/* B — Corpus & SIP */}
      <Section code="B" title="Investment corpus & SIP" sub="Existing savings and ongoing contributions">
        <div className="rt-grid rt-grid-4">
          <Field f={f} set={set} k="corpus" label="Current corpus (₹)" min="0" />
          <Field f={f} set={set} k="sip" label="Monthly SIP (₹)" min="0" step="5000" />
          <Field f={f} set={set} k="stepup" label="Annual SIP step-up (%)" min="0" max="25" />
          <Field f={f} set={set} k="sipuntil" label="SIP continue until age" min="30" max="75" />
        </div>
      </Section>

      {/* C — EPF / NPS */}
      <Section code="C" title="EPF / PPF & NPS" sub="Provident fund and pension scheme details">
        <div className="rt-grid rt-grid-2">
          <div>
            <div className="rt-subgroup-label">EPF / PPF</div>
            <div className="rt-grid rt-grid-3">
              <Field f={f} set={set} k="epf" label="Current corpus (₹)" min="0" />
              <Field f={f} set={set} k="epfm" label="Monthly contribution (₹)" min="0" step="1000" />
              <Field f={f} set={set} k="epfr" label="Expected return (%)" min="5" max="10" step="0.1" />
            </div>
          </div>
          <div>
            <div className="rt-subgroup-label">NPS</div>
            <div className="rt-grid rt-grid-4">
              <Field f={f} set={set} k="nps" label="Current corpus (₹)" min="0" />
              <Field f={f} set={set} k="npsm" label="Monthly contribution (₹)" min="0" step="1000" />
              <Field f={f} set={set} k="npsr" label="Expected return (%)" min="6" max="14" step="0.5" />
              <Field f={f} set={set} k="annrate" label="Annuity rate (%)" min="4" max="8" step="0.5" />
            </div>
          </div>
        </div>
        <div className="rt-note">At retirement: EPF/PPF merges 100% into corpus. NPS: 60% becomes lump sum added to corpus; 40% is annuitised at the stated rate as a fixed annual income.</div>
      </Section>

      {/* D — Inflows */}
      <Section code="D" title="Expected lump sum inflows" sub="Bonus, inheritance, property sale, maturity proceeds — at face value at that age">
        <RowEditor rows={lumps} setRows={setLumps} kind="Inflow" placeholder="e.g. Bonus" defAge={45} emptyMsg="No inflows added. Click + Add inflow to record expected lump sums." addLabel="+ Add inflow" />
      </Section>

      {/* E — Goals */}
      <Section code="E" title="Financial goals" sub="Enter amounts in today's ₹ — each goal is auto-inflated to its target year">
        <RowEditor rows={goals} setRows={setGoals} kind="Goal" placeholder="e.g. Education" defAge={50} defAmt={10} emptyMsg="No goals added. Click + Add goal to define financial milestones." addLabel="+ Add goal" />
      </Section>

      {/* F — Income */}
      <Section code="F" title="Retirement income need" sub="Post-retirement expenses, income offsets and tax">
        <div className="rt-grid rt-grid-4">
          <Field f={f} set={set} k="expenses" label="Current monthly expenses (₹)" min="0" step="5000" />
          <Field f={f} set={set} k="replace" label="Replacement ratio (%)" min="30" max="120" step="5" />
          <Field f={f} set={set} k="otherinc" label="Pension / rental (₹/mo)" min="0" step="2500" />
          <div className="rt-f">
            <label>Other income indexed?</label>
            <select value={f.otherindexed} onChange={set('otherindexed')}>
              <option value="1">Yes — grows with inflation</option>
              <option value="0">No — fixed</option>
            </select>
          </div>
          <Field f={f} set={set} k="onetime" label="One-time expense at retirement (₹)" min="0" />
          <Field f={f} set={set} k="tax" label="Tax on withdrawals (%)" min="0" max="30" step="1" />
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="rt-subgroup-label">Withdrawal strategy</label>
          <div className="rt-wd-grid">
            <div className={`rt-wd-card ${f.withdrawalStrategy !== 'flexible' ? 'selected' : ''}`}
              onClick={() => setForm(p => ({ ...p, withdrawalStrategy: 'fixed' }))}>
              <div className="rt-wd-card-top">
                <div className="rt-wd-card-title" style={f.withdrawalStrategy !== 'flexible' ? { color: '#912F63' } : {}}>Fixed real withdrawal</div>
                <div className="rt-wd-card-radio"></div>
              </div>
              <div className="rt-wd-card-tag" style={f.withdrawalStrategy !== 'flexible' ? { color: '#912F63', background: '#f5e2ec' } : {}}>Default · Simple</div>
              <div className="rt-wd-card-desc">Withdrawal amount <strong>grows with inflation every year</strong>, regardless of how markets perform. Simple and predictable.</div>
            </div>
            <div className={`rt-wd-card ${f.withdrawalStrategy === 'flexible' ? 'selected' : ''}`}
              onClick={() => setForm(p => ({ ...p, withdrawalStrategy: 'flexible' }))}>
              <div className="rt-wd-card-top">
                <div className="rt-wd-card-title" style={f.withdrawalStrategy === 'flexible' ? { color: '#912F63' } : {}}>Flexible (guardrail)</div>
                <div className="rt-wd-card-radio"></div>
              </div>
              <div className="rt-wd-card-tag" style={f.withdrawalStrategy === 'flexible' ? { color: '#912F63', background: '#f5e2ec' } : {}}>Adaptive</div>
              <div className="rt-wd-card-desc">
                If the portfolio falls more than{' '}
                <span className="rt-wd-cut-inline" onClick={e => e.stopPropagation()}>
                  <input type="number" value={f.guardrailTrigger || 15} min="5" max="40" step="5"
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); setForm(p => ({ ...p, guardrailTrigger: e.target.value, withdrawalStrategy: 'flexible' })); }} />%
                </span>{' '}
                year-over-year, that year's withdrawal is temporarily cut by{' '}
                <span className="rt-wd-cut-inline" onClick={e => e.stopPropagation()}>
                  <input type="number" value={f.guardrailCut || 10} min="5" max="40" step="5"
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); setForm(p => ({ ...p, guardrailCut: e.target.value, withdrawalStrategy: 'flexible' })); }} />%
                </span>, then returns to normal once the decline eases.
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* G — Assumptions */}
      <Section code="G" title="Investment strategy & assumptions" sub="Choose model portfolios or enter custom return assumptions">
        {/* Mode toggle */}
        <div className="rt-mode-pill">
          <button
            className={`rt-mode-btn ${f.assumpMode !== 'custom' ? 'active' : ''}`}
            onClick={() => setForm(p => ({ ...p, assumpMode: 'model' }))}
          >FundIQ model portfolios</button>
          <button
            className={`rt-mode-btn ${f.assumpMode === 'custom' ? 'active' : ''}`}
            onClick={() => setForm(p => ({ ...p, assumpMode: 'custom' }))}
          >Custom assumptions</button>
        </div>

        {/* Panel A: Model portfolio mode */}
        {f.assumpMode !== 'custom' && (
          <div className="rt-model-panel">
            <div className="rt-model-panel-hd">
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-dark)', marginBottom: 3 }}>Link to FundIQ model portfolios</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Select accumulation and drawdown models. Return, volatility and equity glide path are auto-derived from the BL-posterior optimiser.</div>
              </div>
            </div>
            <div className="rt-model-selectors">
              <div className="rt-model-selector-box">
                <div className="rt-model-selector-label" style={{ color: 'var(--brand)' }}>Accumulation (pre-retirement)</div>
                <div className="rt-model-pills">
                  {MODEL_PROFILES.map(m => (
                    <button key={m.key}
                      className={`rt-model-pill ${(f.accumModel || 'modAggressive') === m.key ? 'active-berry' : ''}`}
                      onClick={() => {
                        const stats = modelPresets[m.key];
                        setForm(p => ({ ...p, accumModel: m.key, preret: stats.ret, prevol: stats.vol }));
                      }}
                    >{m.label}</button>
                  ))}
                </div>
                <div className="rt-model-stats">
                  {(() => { const s = modelPresets[f.accumModel || 'modAggressive']; return `${s.label} · Return ${s.ret}% · Vol ${s.vol}% · Equity ${s.eq}% · Debt ${s.debt}% (BL-posterior)`; })()}
                </div>
              </div>
              <div className="rt-model-selector-box">
                <div className="rt-model-selector-label" style={{ color: 'var(--brand-dark)' }}>Drawdown (post-retirement)</div>
                <div className="rt-model-pills">
                  {MODEL_PROFILES.map(m => (
                    <button key={m.key}
                      className={`rt-model-pill ${(f.drawdownModel || 'modConservative') === m.key ? 'active-plum' : ''}`}
                      onClick={() => {
                        const stats = modelPresets[m.key];
                        const late = modelPresets['conservative'];
                        setForm(p => ({ ...p, drawdownModel: m.key, postret: stats.ret, postvol: stats.vol, lateret: late.ret, latevol: late.vol }));
                      }}
                    >{m.label}</button>
                  ))}
                </div>
                <div className="rt-model-stats">
                  {(() => { const s = modelPresets[f.drawdownModel || 'modConservative']; return `${s.label} · Return ${s.ret}% · Vol ${s.vol}% · Equity ${s.eq}% · Debt ${s.debt}% (BL-posterior)`; })()}
                </div>
              </div>
            </div>
            <div className="rt-model-note">
              Return and volatility are derived automatically from FundIQ Model Portfolios. Switch to <strong>Custom assumptions</strong> to edit them manually.
            </div>
            <div className="rt-grid rt-grid-6" style={{ gap: 10, marginTop: 18 }}>
              <Field f={f} set={set} k="inflation" label="General inflation (%)" min="2" max="12" step="0.5" />
              <Field f={f} set={set} k="tax" label="Tax on withdrawal (%)" min="0" max="30" step="1" />
              <Field f={f} set={set} k="influnc" label="Infl. uncertainty (±%)" min="0" max="5" step="0.5" />
              <div className="rt-f">
                <label>Simulations</label>
                <select value={f.sims} onChange={set('sims')}>
                  <option>300</option><option>500</option><option>1000</option><option>2000</option><option>5000</option><option>10000</option>
                </select>
              </div>
              <div className="rt-f">
                <label>Target confidence</label>
                <select value={f.targetconf} onChange={set('targetconf')}>
                  <option value="80">80%</option>
                  <option value="85">85%</option>
                  <option value="90">90%</option>
                  <option value="95">95%</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Panel B: Custom assumptions */}
        {f.assumpMode === 'custom' && (
          <div>
            <div className="rt-fiq-defaults-row">
              <input type="checkbox" id="rt-usefiq" checked={!!f._fiqLocked}
                onChange={e => {
                  const locked = e.target.checked;
                  setForm(p => ({
                    ...p, _fiqLocked: locked,
                    ...(locked ? { preret: 12, prevol: 14, postret: 8, postvol: 7, lateret: 5.5, latevol: 5, inflation: 6, influnc: 1.5, tax: 10 } : {})
                  }));
                }}
              />
              <label htmlFor="rt-usefiq" style={{ fontWeight: 600, color: 'var(--brand-dark)', cursor: 'pointer', fontSize: 13 }}>Use FundIQ house assumptions</label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>12% pre-ret · 8% post-ret · 5.5% late-ret · 6% infl</span>
            </div>
            <div className="rt-grid rt-grid-2" style={{ gap: 18, marginTop: 16 }}>
              <div>
                <div className="rt-subgroup-label">Pre-retirement (accumulation)</div>
                <div className="rt-grid rt-grid-2">
                  <Field f={f} set={set} k="preret" label="Expected return (%)" min="4" max="20" step="0.5" disabled={!!f._fiqLocked} />
                  <Field f={f} set={set} k="prevol" label="Volatility / std dev (%)" min="2" max="30" disabled={!!f._fiqLocked} />
                </div>
              </div>
              <div>
                <div className="rt-subgroup-label">Post-retirement (drawdown)</div>
                <div className="rt-grid rt-grid-2">
                  <Field f={f} set={set} k="postret" label="Expected return (%)" min="3" max="15" step="0.5" disabled={!!f._fiqLocked} />
                  <Field f={f} set={set} k="postvol" label="Volatility / std dev (%)" min="1" max="20" disabled={!!f._fiqLocked} />
                </div>
              </div>
              <div>
                <div className="rt-subgroup-label">Late retirement (glide target)</div>
                <div className="rt-grid rt-grid-2">
                  <Field f={f} set={set} k="lateret" label="Expected return (%)" min="2" max="15" step="0.5" disabled={!!f._fiqLocked} />
                  <Field f={f} set={set} k="latevol" label="Volatility / std dev (%)" min="1" max="20" disabled={!!f._fiqLocked} />
                </div>
              </div>
              <div>
                <div className="rt-subgroup-label">Macro & simulation</div>
                <div className="rt-grid rt-grid-2">
                  <Field f={f} set={set} k="inflation" label="General inflation (%)" min="2" max="12" step="0.5" />
                  <Field f={f} set={set} k="influnc" label="Infl. uncertainty (±%)" min="0" max="5" step="0.5" />
                  <Field f={f} set={set} k="tax" label="Tax on withdrawals (%)" min="0" max="30" step="1" disabled={!!f._fiqLocked} />
                </div>
              </div>
            </div>
            <div className="rt-grid rt-grid-2" style={{ gap: 10, marginTop: 14 }}>
              <div className="rt-f">
                <label>No. of simulations</label>
                <select value={f.sims} onChange={set('sims')}>
                  <option>300</option><option>500</option><option>1000</option><option>2000</option><option>5000</option><option>10000</option>
                </select>
              </div>
              <div className="rt-f">
                <label>Target confidence (%)</label>
                <select value={f.targetconf} onChange={set('targetconf')}>
                  <option value="80">80% — flexible</option>
                  <option value="85">85% — BugleRock standard</option>
                  <option value="90">90% — conservative</option>
                  <option value="95">95% — highly conservative</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Crash strip — always visible */}
        <div className="rt-crash-strip">
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)' }}>Equity crash stress test</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Used in the “Equity crash at retirement” scenario — a sudden market drop forced in the first year of retirement, to test resilience against bad timing.</div>
          </div>
          <div className="rt-f" style={{ width: 130, flexShrink: 0 }}>
            <label>Crash severity (%)</label>
            <input type="text" inputMode="decimal" value={f.crashSeverity ?? 30} onChange={e => setForm(p => ({ ...p, crashSeverity: e.target.value }))} />
          </div>
        </div>
      </Section>

      {/* Run CTA */}
      <div className="rt-cta">
        <div>
          <div className="rt-cta-title">Ready to project the retirement plan?</div>
          <div className="rt-cta-sub">A Monte Carlo engine will run up to 5,000 scenarios and show the full 8-section report below.</div>
        </div>
        <button className="rt-cta-btn" onClick={onRun} disabled={running}>{running ? 'Running…' : '▶ Run simulation'}</button>
      </div>
    </>
  );
}

function Section({ code, title, sub, children }) {
  return (
    <div id={`rt-section-${code}`} className="rt-card">
      <div className="rt-card-hd">
        <div className="rt-card-badge">{code}</div>
        <div>
          <div className="rt-card-hd-title">{title}</div>
          <div className="rt-card-hd-sub">{sub}</div>
        </div>
      </div>
      <div className="rt-card-body">{children}</div>
    </div>
  );
}

function RowEditor({ rows, setRows, kind, placeholder, defAge, defAmt = 0, emptyMsg, addLabel }) {
  const update = (i, key, val) => setRows(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  const add = () => setRows([...rows, { name: '', age: defAge, amt: defAmt }]);
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i));

  return (
    <>
      {rows.length === 0 ? (
        <div className="rt-empty">{emptyMsg}</div>
      ) : (
        <div className="rt-rows">
          {rows.map((r, i) => (
            <div className="rt-row" key={i}>
              <div className="rt-f" style={{ flex: 3, minWidth: 0 }}>
                <label>{kind}</label>
                <input type="text" value={r.name} placeholder={placeholder} onChange={(e) => update(i, 'name', e.target.value)} />
              </div>
              <div className="rt-f" style={{ width: 68 }}>
                <label>Age</label>
                <input type="text" inputMode="numeric" value={r.age} min="25" max="95" onChange={(e) => update(i, 'age', e.target.value)} onBlur={(e) => { if (!e.target.value) update(i, 'age', defAge); }} />
              </div>
              <div className="rt-f" style={{ width: 120 }}>
                <label>₹</label>
                <input type="text" inputMode="numeric"
                  value={r.amt ? toIndianStr(r.amt) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '');
                    update(i, 'amt', raw === '' ? 0 : parseFloat(raw) || 0);
                  }}
                  onBlur={(e) => {
                    const raw = e.target.value.replace(/,/g, '');
                    const n = parseFloat(raw) || 0;
                    update(i, 'amt', n);
                  }}
                />
              </div>
              <button className="rt-row-rm" onClick={() => remove(i)} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}
      <button className="rt-add-btn" onClick={add}>{addLabel}</button>
    </>
  );
}

// ══════════════ Results ══════════════
function Results({ R, onEdit }) {
  const POS = '#1A7A52', NEG = '#B71C1C', WARN = '#D97706', BERRY = '#912F63', PLUM = '#3E3452';
  const vc = R.successRate >= 85 ? POS : R.successRate >= 65 ? WARN : NEG;
  const vt = R.successRate >= 85 ? 'On track' : R.successRate >= 65 ? 'Needs attention' : 'At risk';
  const vbg = R.successRate >= 85 ? 'var(--green-dim)' : R.successRate >= 65 ? '#FEF9EC' : 'var(--red-dim)';
  const failCount = Math.round((100 - R.successRate) / 100 * R.NSIM);

  const atRet = { p10: R.P10[R.yearsToRet], p50: R.P50[R.yearsToRet], p90: R.P90[R.yearsToRet] };
  const rangeMin = atRet.p10 || 0;
  const rangeMax = atRet.p90 || 1;
  const rangeSpan = rangeMax - rangeMin || 1;
  const pct10 = 0;
  const pct50 = Math.max(0, Math.min(100, (atRet.p50 - rangeMin) / rangeSpan * 100));
  const pct90 = 100;

  const glossary = [
    ['Success rate', `The % of simulated futures (out of ${R.NSIM}) where the money lasted the whole plan without running out. Not a prediction — a range of "what could happen."`],
    ['Monte Carlo simulation', 'A technique that runs the plan through hundreds of randomly-generated market paths (some good years, some bad, in different orders) instead of assuming one fixed return every year.'],
    ['Percentile (P10 / P50 / P90)', 'P50 is the "middle" or most typical outcome — half the simulations did better, half did worse. P10 is a pessimistic-but-realistic outcome (only 10% did worse). P90 is optimistic-but-realistic (only 10% did better).'],
    ['Corpus needed', "The lump sum the plan calculates you'll need saved up by retirement age, based on your expenses, other income and how long you expect it to last."],
    ['Depletion age', "If a simulation ran out of money before the plan's end age, this is the age at which it happened, on average across the failed simulations."],
  ];

  const B = rtBuildFullSections(R);

  return (
    <>
      <div className="rt-out-hd">
        <div>
          <div className="rt-out-title">{R.IN.name ? `${R.IN.name}'s retirement plan` : 'Simulation results'}</div>
          <div className="rt-out-sub">Based on {R.NSIM} simulated market scenarios, from age {R.IN.age} to {R.IN.lifeExp}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="rt-btn" onClick={onEdit}>← Edit inputs</button>
          <button className="rt-btn rt-btn-primary" onClick={() => rtOpenReport(R)}>⬇ Download full report</button>
        </div>
      </div>

      {/* Verdict banner */}
      <div className="rt-verdict" style={{ background: vbg, borderLeftColor: vc }}>
        <div className="rt-verdict-pct" style={{ color: vc }}>{R.successRate}%</div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="rt-verdict-label" style={{ color: vc }}>{vt}</div>
          <div className="rt-verdict-text">
            We ran {R.NSIM} different possible market paths from today until age {R.IN.lifeExp}. In <strong>{R.successRate}%</strong> of them, the plan's savings lasted the whole way without running out
            {failCount > 0 ? ` — in the other ${failCount} scenario${failCount > 1 ? 's' : ''} out of ${R.NSIM}, money ran out${R.medianDepAge ? ` around age ${R.medianDepAge} on average` : ''}.` : '.'}
          </div>
        </div>
      </div>

      {/* Plan score */}
      {R.score && (
        <div className="rt-score-badge">
          <div>
            <div className="rt-score-big" style={{ color: R.score.composite >= 80 ? POS : R.score.composite >= 60 ? WARN : NEG }}>{R.score.composite}</div>
            <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>/ 100</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Retirement readiness score — composite of 5 dimensions</div>
            {R.score.components.map((c, i) => {
              const sc = parseFloat(c.score);
              const cc = sc >= 80 ? POS : sc >= 60 ? WARN : NEG;
              return (
                <div className="rt-score-row" key={i}>
                  <div className="rt-score-lbl">{c.label}</div>
                  <div className="rt-score-wt">{c.weight}</div>
                  <div className="rt-score-bar"><div className="rt-score-fill" style={{ width: `${c.score}%`, background: cc }} /></div>
                  <div className="rt-score-num" style={{ color: cc }}>{c.score}</div>
                </div>
              );
            })}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6 }}>Score = Funding probability (35%) + Corpus buffer (30%) + Downside resilience (22%) + Goal coverage (13%). BugleRock house methodology.</div>
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div className="rt-kpi-grid">
        <Kpi val={rtFmt(R.P50[R.yearsToRet])} lbl="Median corpus at retirement" note={`In half the simulations, you'd have more than this by age ${R.IN.retAge}; in half, less.`} color={BERRY} />
        <Kpi val={rtFmt(R.corpusNeeded)} lbl="Corpus needed at retirement" note={`What the plan calculates you'll actually need saved up by age ${R.IN.retAge}.`} color={PLUM} />
        <Kpi val={`₹${Math.round(R.incomeAtRet / 1000)}K/mo`} lbl="Monthly income needed" note={`Estimated monthly spending needed starting at age ${R.IN.retAge}, after other income and any NPS annuity.`} color={vc} />
      </div>

      {/* Range bar */}
      <div className="rt-box">
        <div className="rt-box-hd">How much could you actually have at retirement?</div>
        <div className="rt-box-body">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Corpus at age {R.IN.retAge}</div>
          <div className="rt-range-track">
            <div className="rt-range-band" style={{ left: `${pct10}%`, width: `${pct90 - pct10}%` }} />
            <div className="rt-range-median" style={{ left: `${pct50}%` }} />
          </div>
          <div className="rt-range-legend">
            <span>Worst realistic (1-in-10 worse): <strong style={{ color: NEG }}>{rtFmt(atRet.p10)}</strong></span>
            <span style={{ fontWeight: 700, color: PLUM }}>Most likely: {rtFmt(atRet.p50)}</span>
            <span>Best realistic (1-in-10 better): <strong style={{ color: POS }}>{rtFmt(atRet.p90)}</strong></span>
          </div>
        </div>
        <div className="rt-box-note">The shaded band shows the realistic range across all simulated market paths — not one guaranteed number. Think of it as "somewhere in this range," not "exactly this."</div>
      </div>

      {/* Glossary */}
      <div className="rt-box">
        <div className="rt-box-hd">Terms used on this page, in plain English</div>
        <div className="rt-box-body">
          {glossary.map((g, i) => (
            <div className="rt-gloss-item" key={i}>
              <div className="rt-gloss-term">{g[0]}</div>
              <div className="rt-gloss-def">{g[1]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Full detailed report */}
      <div className="rt-divider">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 4 }}>Full detailed report</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Fan chart, percentile table, retirement income sources, sensitivity, goals, year-by-year cash flow and assumptions.</div>
      </div>
      <div className="rt-report" dangerouslySetInnerHTML={{ __html: B.sectionsHtml }} />
    </>
  );
}

function Kpi({ val, lbl, note, color }) {
  return (
    <div className="rt-kpi">
      <div className="rt-kpi-val" style={{ color }}>{val}</div>
      <div className="rt-kpi-lbl">{lbl}</div>
      <div className="rt-kpi-note">{note}</div>
    </div>
  );
}