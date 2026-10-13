import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';

const API = process.env.REACT_APP_API_URL || '';

// Risk profile default bands — from models.py
const PROFILE_BANDS = {
  conservative:     { eq: [22,28],  debt: [62,73], gold: [5,5],   lc: [70,80], mc: [10,20], sc: [5,15], intl: [0,5],  cash: [0,10] },
  mod_conservative: { eq: [33,42],  debt: [52,62], gold: [5,5],   lc: [65,75], mc: [15,25], sc: [5,15], intl: [0,5],  cash: [0,10] },
  balanced:         { eq: [50,60],  debt: [40,50], gold: [6,6],   lc: [55,65], mc: [20,35], sc: [5,20], intl: [0,10], cash: [0,10] },
  mod_aggressive:   { eq: [68,76],  debt: [22,33], gold: [7,7],   lc: [45,55], mc: [22,32], sc: [18,28], intl: [0,10], cash: [0,5] },
  aggressive:       { eq: [80,87],  debt: [8,23],  gold: [8,8],   lc: [30,40], mc: [28,38], sc: [27,37], intl: [0,15], cash: [0,5] },
};

const REVIEW_OPTIONS = ['Monthly', 'Quarterly', 'Semi-annual', 'Annual'];
const REBALANCING_OPTIONS = [
  'Annual rebalancing', 'Semi-annual', 'Quarterly',
  'Threshold-based (±5%)', 'Threshold-based (±10%)', 'No automatic rebalancing',
];
const DEPLOYMENT_OPTIONS = [
  { value: 'lump_sum',   label: 'Lump sum — single tranche' },
  { value: 'stp3',       label: 'Lump sum — 3 tranches (STP)' },
  { value: 'stp6',       label: 'Lump sum — 6 tranches (STP)' },
  { value: 'sip',        label: 'SIP only' },
  { value: 'lump_sip',   label: 'Lump sum + SIP' },
];

function recommendBenchmark(riskProfile) {
  const map = {
    conservative:     'CRISIL Composite Bond Index',
    mod_conservative: 'Nifty Multi Asset 50:40:10',
    balanced:         'Nifty 500',
    mod_aggressive:   'Nifty 500',
    aggressive:       'Nifty Midcap 150',
  };
  return map[riskProfile] || null;
}

// ── BenchmarkPicker (same as ClientIPS) ──────────────────────────────────────
function BenchmarkPicker({ value, onChange }) {
  const [allBMs, setAllBMs] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    fetch(`${API}/api/benchmarks/returns`)
      .then(r => r.json())
      .then(d => setAllBMs((d.benchmarks || []).map(b => ({
        name: b.index_name, display_name: b.index_name,
        return_1y: b.return_1y, return_3y: b.return_3y,
        return_1m: b.return_1m, return_6m: b.return_6m,
        return_ytd: b.return_ytd,
      }))))
      .catch(() => {});
  }, []);

  const selected = value || [];

  function toggleBM(bm) {
    const exists = selected.find(s => s.name === bm.name);
    if (exists) {
      const remaining = selected.filter(s => s.name !== bm.name);
      if (remaining.length > 0) {
        const eq = Math.floor(100 / remaining.length);
        onChange(remaining.map((s, i) => ({ ...s, weight: i === remaining.length - 1 ? 100 - eq * (remaining.length - 1) : eq })));
      } else onChange([]);
    } else {
      const newSel = [...selected, { ...bm, weight: 0 }];
      const eq = Math.floor(100 / newSel.length);
      onChange(newSel.map((s, i) => ({ ...s, weight: i === newSel.length - 1 ? 100 - eq * (newSel.length - 1) : eq })));
    }
  }

  function updateWeight(name, w) {
    const v = Math.max(0, Math.min(100, parseInt(w) || 0));
    onChange(selected.map(s => s.name === name ? { ...s, weight: v } : s));
  }

  const totalW = selected.reduce((s, b) => s + (b.weight || 0), 0);

  return (
    <div style={{ position: 'relative' }}>
      {selected.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {selected.map(bm => (
            <div key={bm.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: '#3E3452' }}>{bm.display_name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" min="0" max="100" value={bm.weight || 0} onChange={e => updateWeight(bm.name, e.target.value)}
                  style={{ width: 52, padding: '3px 6px', border: `1px solid ${totalW === 100 ? 'var(--border)' : '#912F63'}`, borderRadius: 6, fontSize: 12, fontWeight: 600, textAlign: 'center' }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
              </div>
              <button onClick={() => toggleBM(bm)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '0 2px' }}>✕</button>
            </div>
          ))}
          <div style={{ fontSize: 10, color: totalW === 100 ? '#059669' : '#912F63', fontWeight: 600, paddingLeft: 4 }}>
            {totalW === 100 ? '✓ Weights sum to 100%' : `⚠ Weights sum to ${totalW}% — must equal 100%`}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(v => !v)}
        style={{ padding: '6px 12px', border: '1px dashed #912F63', borderRadius: 8, background: 'rgba(145,47,99,.04)', color: '#912F63', fontSize: 11, fontWeight: 500, cursor: 'pointer', width: '100%' }}>
        {open ? '✕ Close' : `+ Add benchmark${selected.length > 0 ? ' / change' : ''}`}
        {allBMs.length > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>({allBMs.length} available)</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(62,52,82,.12)', maxHeight: 280, overflowY: 'auto', marginTop: 4 }}>
          {allBMs.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>Loading benchmarks…</div>
          ) : allBMs.map(bm => {
            const isSel = selected.some(s => s.name === bm.name);
            return (
              <div key={bm.name} onClick={() => toggleBM(bm)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: isSel ? 'rgba(145,47,99,.04)' : '#fff' }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${isSel ? '#912F63' : 'var(--border)'}`, background: isSel ? '#912F63' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {isSel && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: '#3E3452' }}>{bm.display_name}</div>
                {bm.return_1y != null && (
                  <div style={{ fontSize: 10, color: bm.return_1y >= 0 ? '#059669' : '#DC2626', fontWeight: 600 }}>
                    {bm.return_1y >= 0 ? '+' : ''}{bm.return_1y?.toFixed(1)}% 1Y
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── AllocBand row — matches ClientIPS alloc-row style ───────────────────────
function AllocRow({ label, minK, maxK, defMin, defMax, values, onChange }) {
  return (
    <div className="cip-alloc-row">
      <div className="cip-alloc-lbl">{label}</div>
      <div className="cip-alloc-inputs">
        <input className="cip-alloc-in" type="number" min="0" max="100"
          value={values[minK] ?? ''} placeholder={String(defMin)}
          onChange={e => onChange(minK, e.target.value)} />
        <span className="cip-alloc-sep">–</span>
        <input className="cip-alloc-in" type="number" min="0" max="100"
          value={values[maxK] ?? ''} placeholder={String(defMax)}
          onChange={e => onChange(maxK, e.target.value)} />
        <span className="cip-alloc-pct">%</span>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="cip-field">
      <label className="cip-field-label">{label}</label>
      {children}
    </div>
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select className="cip-select" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">— Select —</option>
      {options.map(o => typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input className="cip-input" type={type} value={value || ''} placeholder={placeholder || ''}
      onChange={e => onChange(e.target.value)} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CIPStep3({ onNext, onBack }) {
  const { activeClient, updateClient } = useClient();
  const [saving, setSaving] = useState(false);

  const recommended = recommendBenchmark(activeClient?.risk_profile);
  const profileBands = activeClient?.risk_profile ? PROFILE_BANDS[activeClient.risk_profile] : null;



  // Asset allocation bands
  const [alloc, setAlloc] = useState({});

  // Deployment
  const [deploymentStrategy, setDeploymentStrategy] = useState('');
  const [deploymentNotes, setDeploymentNotes] = useState('');
  const [proposalDate, setProposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  // Benchmark & review
  const [benchmarks, setBenchmarks] = useState(
    recommended ? [{ name: recommended, display_name: recommended, weight: 100 }] : []
  );
  const [reviewFrequency, setReviewFrequency] = useState('Quarterly');
  const [rebalancingPolicy, setRebalancingPolicy] = useState('Annual rebalancing');

  // Load from existing client
  useEffect(() => {
    if (!activeClient?.constraints) return;
    const c = activeClient.constraints;

    setAlloc(c.alloc || {});
    setDeploymentStrategy(c.deploymentStrategy || '');
    setDeploymentNotes(c.deploymentNotes || '');
    setProposalDate(c.proposalDate || new Date().toISOString().slice(0, 10));
    setNotes(c.notes || '');
    if (c.benchmarks?.length > 0) setBenchmarks(c.benchmarks);
    setReviewFrequency(c.reviewFrequency || 'Quarterly');
    setRebalancingPolicy(c.rebalancingPolicy || 'Annual rebalancing');
  }, [activeClient]);

  function updateAlloc(key, val) {
    setAlloc(prev => ({ ...prev, [key]: val }));
  }

  const handleSaveAndContinue = async () => {
    setSaving(true);
    try {
      if (activeClient) {
        await updateClient(activeClient.id, {
          constraints: {
            alloc,
            deploymentStrategy:   deploymentStrategy || null,
            deploymentNotes:      deploymentNotes   || null,
            proposalDate:         proposalDate      || null,
            notes:                notes             || null,
            benchmarks,
            benchmark:            benchmarks?.[0]?.name || null,
            reviewFrequency:      reviewFrequency,
            rebalancingPolicy:    rebalancingPolicy,
          },
        });
      }
      onNext();
    } catch (e) {
      console.error('Save failed', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cip-step-panel">
      <div className="cip-step-title">Investment Mandate</div>
      <div className="cip-step-desc">
        Define the portfolio construction rules and allocation guidelines for this client.
      </div>

      {/* ── Section D: Target Asset Allocation ── */}
      <div className="cip-form-section">
        <div className="cip-section-hd">
          <span className="cip-section-num">D</span>
          TARGET ASSET ALLOCATION
        </div>

        {profileBands ? (
          <div className="cip-info-note" style={{ marginBottom: 16 }}>
            Placeholder values below are the <strong>BugleRock standard guardrails</strong> for a{' '}
            <strong style={{ textTransform: 'capitalize' }}>{activeClient.risk_profile?.replace(/_/g, ' ')}</strong> profile.
            Leave fields blank to use these defaults. Customising these bands will cause the
            portfolio to deviate from the approved risk profile — use only where the client's
            situation genuinely requires it.
          </div>
        ) : (
          <div className="cip-indicative-warn" style={{ marginBottom: 16 }}>
            No risk profile identified yet — placeholder values shown are generic defaults,
            not profile-specific guardrails. This is expected for an indicative profile.
          </div>
        )}

        <div className="cip-alloc-grid">
          {/* Equity column */}
          <div>
            <div className="cip-alloc-sub">Equity</div>
            {[
              ['Total equity',  'eqMin',   'eqMax',   profileBands?.eq[0]   ?? 60,  profileBands?.eq[1]   ?? 100],
              ['Large cap',     'lcMin',   'lcMax',   profileBands?.lc[0]   ?? 30,  profileBands?.lc[1]   ?? 70 ],
              ['Mid cap',       'mcMin',   'mcMax',   profileBands?.mc[0]   ?? 15,  profileBands?.mc[1]   ?? 40 ],
              ['Small cap',     'scMin',   'scMax',   profileBands?.sc[0]   ?? 0,   profileBands?.sc[1]   ?? 25 ],
              ['International', 'intlMin', 'intlMax', profileBands?.intl?.[0] ?? 0, profileBands?.intl?.[1] ?? 15],
            ].map(([label, minK, maxK, defMin, defMax]) => (
              <AllocRow key={label} label={label} minK={minK} maxK={maxK}
                defMin={defMin} defMax={defMax} values={alloc} onChange={updateAlloc} />
            ))}
          </div>

          {/* Debt & alternatives column */}
          <div>
            <div className="cip-alloc-sub">Debt &amp; alternatives</div>
            {[
              ['Debt / Bonds',  'debtMin', 'debtMax', profileBands?.debt[0] ?? 0,  profileBands?.debt[1] ?? 30],
              ['Gold / Alt',    'goldMin', 'goldMax', profileBands?.gold[0] ?? 0,  profileBands?.gold[1] ?? 10],
              ['Cash / Liquid', 'cashMin', 'cashMax', profileBands?.cash?.[0] ?? 0, profileBands?.cash?.[1] ?? 10],
            ].map(([label, minK, maxK, defMin, defMax]) => (
              <AllocRow key={label} label={label} minK={minK} maxK={maxK}
                defMin={defMin} defMax={defMax} values={alloc} onChange={updateAlloc} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Section E: Benchmark & Review ── */}
      <div className="cip-form-section">
        <div className="cip-section-hd">
          <span className="cip-section-num">E</span>
          BENCHMARK &amp; REVIEW
        </div>
        {recommended && (
          <div className="cip-info-note" style={{ marginBottom: 14 }}>
            Recommended for this profile: <strong>{recommended}</strong>. Override below if needed.
          </div>
        )}
        <div className="cip-field" style={{ marginBottom: 16 }}>
          <label className="cip-field-label">
            Portfolio Benchmark
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              (select one or more, assign weights)
            </span>
          </label>
          <BenchmarkPicker value={benchmarks} onChange={setBenchmarks} />
        </div>
        <div className="cip-form-grid">
          <Field label="Review Frequency">
            <SelectInput value={reviewFrequency} onChange={setReviewFrequency} options={REVIEW_OPTIONS} />
          </Field>
          <Field label="Rebalancing Policy">
            <SelectInput value={rebalancingPolicy} onChange={setRebalancingPolicy} options={REBALANCING_OPTIONS} />
          </Field>
        </div>
      </div>

      {/* ── Section G: Deployment & Notes ── */}
      <div className="cip-form-section">
        <div className="cip-section-hd">
          <span className="cip-section-num">F</span>
          DEPLOYMENT &amp; NOTES
        </div>
        <div className="cip-form-grid">
          <Field label="Deployment Strategy">
            <SelectInput value={deploymentStrategy} onChange={setDeploymentStrategy} options={DEPLOYMENT_OPTIONS} />
          </Field>
          <Field label="Proposal Date">
            <input className="cip-input" type="date" value={proposalDate}
              onChange={e => setProposalDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Deployment Notes">
          <textarea className="cip-textarea" value={deploymentNotes}
            onChange={e => setDeploymentNotes(e.target.value)}
            placeholder="e.g. Deploy ₹50L immediately, balance over 3 months via STP" rows={2} />
        </Field>
        <Field label="General Notes / Special Instructions">
          <textarea className="cip-textarea" value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any other instructions or notes for this mandate" rows={2} />
        </Field>
      </div>

      {/* ── Nav buttons ── */}
      <div className="cip-nav-buttons">
        <button className="btn-outline" onClick={onBack}>← Back</button>
        <button className="btn-primary" onClick={handleSaveAndContinue} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Continue →'}
        </button>
      </div>
    </div>
  );
}