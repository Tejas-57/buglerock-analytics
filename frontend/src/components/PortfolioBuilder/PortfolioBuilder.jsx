import React, { useState, useEffect } from 'react';
import './PortfolioBuilder.css';
import ClientIPS from './steps/ClientIPS';
import BuildPortfolio from './steps/BuildPortfolio';
import Analyse from './steps/Analyse';
import Optimise from './steps/Optimise';
import Compare from './steps/Compare';
import PDFProposal from './steps/PDFProposal';

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
  benchmarks: [], maxFunds: '5', minAUM: '', maxER: '',
  constraints: '', existingHoldings: '',
  deploymentNotes: '', rebalancing: 'Annual rebalancing', adviserNotes: '',
  alloc: { eqMin: 60, eqMax: 100, lcMin: 30, lcMax: 70, mcMin: 15, mcMax: 40, scMin: 0, scMax: 25, intlMin: 0, intlMax: 15, debtMin: 0, debtMax: 30, goldMin: 0, goldMax: 10, cashMin: 0, cashMax: 10 },
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

export default function PortfolioBuilder({ selectedDate }) {
  const [activeStep, setActiveStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [ips, setIps] = useState(() => load('br_ptf_ips', DEFAULT_IPS));
  const [ipsSaved, setIpsSaved] = useState(false);
  const [funds, setFunds] = useState(() => load('br_ptf_funds', []));
  const [weights, setWeights] = useState(() => load('br_ptf_weights', {}));
  const [originalWeights, setOriginalWeights] = useState({});
  // Benchmarks now come from ips.benchmarks array (set in ClientIPS)
  const [selectedPortfolio, setSelectedPortfolio] = useState('original');
  const [snapshots, setSnapshots] = useState({});

  // Sync funds/weights to localStorage
  useEffect(() => { save('br_ptf_funds', funds); }, [funds]);
  useEffect(() => { save('br_ptf_weights', weights); }, [weights]);


  // Derive funds array from weights (keep only funds that have weights)
  const activeFunds = funds.filter(f => weights[f.isin] != null);

  function markDone(step) { setCompletedSteps(prev => new Set([...prev, step])); }

  function saveIPS() {
    save('br_ptf_ips', ips);
    markDone(1);
    setIpsSaved(true);
    // Benchmarks are stored in ips.benchmarks — no separate sync needed
    setActiveStep(2);
  }

  function skipIPS() { setActiveStep(2); }

  // IPS chips
  const ipsChips = ipsSaved && ips.name ? [
    { label: 'Client', val: ips.name },
    { label: 'Objective', val: ips.primaryObjective },
    { label: 'Tenure', val: ips.tenure?.split(' ')[0] },
    { label: 'Risk', val: ips.riskProfile },
    { label: 'Amount', val: ips.amount ? '₹' + ips.amount : '—' },
    { label: 'Benchmark', val: ips.benchmarks?.length > 0 ? ips.benchmarks.map(b => b.display_name).join(' + ') : 'Not set' },
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
                onClick={() => setActiveStep(s.id)}
              >
                <span className="ptf-snum">{completedSteps.has(s.id) ? '✓' : s.id}</span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="ptf-sep">›</span>}
            </React.Fragment>
          ))}
          <div className="ptf-rail-right">
            {ipsSaved && <span style={{ background: '#E6F4ED', color: '#1A7A52', fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid #1A7A52' }}>✓ IPS saved</span>}
            {Object.keys(originalWeights).length > 0 && <span style={{ background: 'rgba(145,47,99,.08)', color: 'var(--brand-primary)', fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--brand-primary)' }}>⚡ Optimised</span>}
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
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {activeStep === 1 && (
            <ClientIPS ips={ips} setIps={setIps} onSave={saveIPS} onSkip={skipIPS} selectedDate={selectedDate} />
          )}
          {activeStep === 2 && (
            <BuildPortfolio
              funds={activeFunds}
              weights={weights}
              setFunds={setFunds}
              setWeights={setWeights}
              snapshots={snapshots}
              setSnapshots={setSnapshots}
              benchmarks={ips.benchmarks || []}
              onAnalyse={() => { markDone(2); setActiveStep(3); }}
              ips={ips}
              selectedDate={selectedDate}
            />
          )}
          {activeStep === 3 && (
            <Analyse
              funds={activeFunds}
              weights={weights}
              snapshots={snapshots}
              benchmarks={ips.benchmarks || []}
              ips={ips}
              onEdit={() => setActiveStep(2)}
              onOptimise={() => { markDone(3); setActiveStep(4); }}
            />
          )}
          {activeStep === 4 && (
            <Optimise
              funds={activeFunds}
              weights={weights}
              setWeights={setWeights}
              setOriginalWeights={setOriginalWeights}
              benchmarks={ips.benchmarks || []}
              onBack={() => setActiveStep(3)}
              onCompare={() => { markDone(4); setActiveStep(5); }}
            />
          )}
          {activeStep === 5 && (
            <Compare
              funds={activeFunds}
              weights={weights}
              originalWeights={originalWeights}
              snapshots={snapshots}
              benchmarks={ips.benchmarks || []}
              onBack={() => setActiveStep(4)}
              onGeneratePDF={() => { markDone(5); setActiveStep(6); }}
              selectedPortfolio={selectedPortfolio}
              setSelectedPortfolio={setSelectedPortfolio}
            />
          )}
          {activeStep === 6 && (
            <PDFProposal
              funds={activeFunds}
              weights={weights}
              originalWeights={originalWeights}
              snapshots={snapshots}
              benchmarks={ips.benchmarks || []}
              ips={ips}
              selectedPortfolio={selectedPortfolio}
              setSelectedPortfolio={setSelectedPortfolio}
              onEditPortfolio={() => setActiveStep(2)}
              onCompare={() => setActiveStep(5)}
            />
          )}
        </div>
      </div>
    </div>
  );
}