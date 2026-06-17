import React, { useState } from 'react';
import './PortfolioBuilder.css';
import ClientIPS from './steps/ClientIPS';

// Placeholder steps
function PlaceholderStep({ title, step }) {
  return (
    <div className="ptf-panel p-active" style={{ alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontSize: 32, opacity: .2 }}>◈</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--brand-dark)' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Step {step} — coming soon</div>
    </div>
  );
}

const STEPS = [
  { id: 1, label: 'Client & IPS' },
  { id: 2, label: 'Build portfolio' },
  { id: 3, label: 'Analyse' },
  { id: 4, label: 'Optimise' },
  { id: 5, label: 'Compare' },
  { id: 6, label: 'PDF Proposal' },
];

const DEFAULT_IPS = {
  name: '', pan: '', amount: '', rm: 'BugleRock Capital',
  email: '', taxStatus: 'Resident individual',
  proposalDate: new Date().toISOString().slice(0, 10), nextReviewDate: '',
  primaryObjective: 'Wealth creation', secondaryObjective: '—',
  tenure: 'Very long-term (7+ years)', targetReturn: '',
  deploymentMode: 'Lump sum — single tranche', monthlySIP: '',
  reviewFrequency: 'Quarterly', retirementAge: '',
  riskProfile: 'Moderate', riskScore: '', maxDrawdown: '10–20%',
  liquidity: 'Moderate (≤10% in 3 months)', experience: '3–7 years',
  sourceOfFunds: 'Salary / Business income', annualIncome: 'Below ₹10L', netWorth: 'Below ₹25L',
  benchmark: 'nifty50', maxFunds: '5', minAUM: '', maxER: '',
  constraints: '', existingHoldings: '',
  deploymentNotes: '', rebalancing: 'Annual rebalancing', adviserNotes: '',
  alloc: { eqMin: 60, eqMax: 100, lcMin: 30, lcMax: 70, mcMin: 15, mcMax: 40, scMin: 0, scMax: 25, intlMin: 0, intlMax: 15, debtMin: 0, debtMax: 30, goldMin: 0, goldMax: 10, cashMin: 0, cashMax: 10 },
};

export default function PortfolioBuilder() {
  const [activeStep, setActiveStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [ips, setIps] = useState(() => {
    try { return JSON.parse(localStorage.getItem('br_ptf_ips') || 'null') || DEFAULT_IPS; }
    catch { return DEFAULT_IPS; }
  });
  const [ipsSaved, setIpsSaved] = useState(false);

  function goStep(n) { setActiveStep(n); }

  function saveIPS() {
    try { localStorage.setItem('br_ptf_ips', JSON.stringify(ips)); } catch {}
    setCompletedSteps(prev => new Set([...prev, 1]));
    setIpsSaved(true);
    goStep(2);
  }

  function skipIPS() { goStep(2); }

  // IPS chips (summary bar after saving)
  const ipsChips = ipsSaved && ips.name ? [
    { label: 'Client', val: ips.name },
    { label: 'Objective', val: ips.primaryObjective },
    { label: 'Tenure', val: ips.tenure },
    { label: 'Risk', val: ips.riskProfile },
    { label: 'Amount', val: ips.amount ? `₹${ips.amount}` : '—' },
    { label: 'Benchmark', val: ips.benchmark?.toUpperCase() || 'Nifty 50' },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Page header */}
      <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 2 }}>Portfolio Builder</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Build, analyse and optimise client portfolios end-to-end</div>
      </div>

      <div className="ptf-wrap">

        {/* Step rail */}
        <div className="ptf-rail">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              <button
                className={`ptf-step-btn ${activeStep === s.id ? 'active' : ''} ${completedSteps.has(s.id) ? 'done' : ''}`}
                onClick={() => goStep(s.id)}
              >
                <span className="ptf-snum">{completedSteps.has(s.id) ? '✓' : s.id}</span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="ptf-sep">›</span>}
            </React.Fragment>
          ))}
          <div className="ptf-rail-right">
            {ipsSaved && (
              <span style={{ background: '#E6F4ED', color: '#1A7A52', fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid #1A7A52' }}>
                ✓ IPS saved
              </span>
            )}
          </div>
        </div>

        {/* IPS chips strip */}
        {ipsChips.length > 0 && (
          <div className="ptf-ips-strip">
            <div className="ptf-ips-chips">
              {ipsChips.map(c => (
                <div className="ptf-ips-chip" key={c.label}>
                  <span className="ptf-ips-chip-lbl">{c.label}</span>
                  <span className="ptf-ips-chip-val">{c.val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step panels */}
        {activeStep === 1 && (
          <ClientIPS ips={ips} setIps={setIps} onSave={saveIPS} onSkip={skipIPS} />
        )}
        {activeStep === 2 && <PlaceholderStep title="Build portfolio" step={2} />}
        {activeStep === 3 && <PlaceholderStep title="Analyse" step={3} />}
        {activeStep === 4 && <PlaceholderStep title="Optimise" step={4} />}
        {activeStep === 5 && <PlaceholderStep title="Compare" step={5} />}
        {activeStep === 6 && <PlaceholderStep title="PDF Proposal" step={6} />}

      </div>
    </div>
  );
}