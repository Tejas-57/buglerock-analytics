import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClient } from '../../context/ClientContext';
import CIPStep1 from './CIPStep1';
import CIPStep2 from './CIPStep2';
import CIPStep3 from './CIPStep3';
import CIPStep4 from './CIPStep4';
import './Client.css';

const STEPS = [
  { id: 1, label: 'Client & Context' },
  { id: 2, label: 'Risk Assessment' },
  { id: 3, label: 'Constraints' },
  { id: 4, label: 'Suitability' },
  { id: 5, label: 'Choose Journey' },
];

export default function ClientInvestmentProfile() {
  const { activeClient } = useClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [profileMode, setProfileMode] = useState(null); // 'full' | 'existing' | 'indicative'

  // If editing existing client, load their mode
  useEffect(() => {
    if (activeClient?.profile_mode) {
      setProfileMode(activeClient.profile_mode);
    }
  }, [activeClient]);

  // Determine which steps are accessible based on profileMode
  const isStepAccessible = (stepId) => {
    if (stepId === 1) return true;
    if (!profileMode) return false; // must choose mode first
    if (profileMode === 'indicative') {
      return stepId !== 2; // skip risk assessment
    }
    return true;
  };

  const getVisibleSteps = () => {
    if (profileMode === 'indicative') {
      return STEPS.filter(s => s.id !== 2);
    }
    return STEPS;
  };

  const goNext = () => {
    const visible = getVisibleSteps();
    const currentIdx = visible.findIndex(s => s.id === step);
    if (currentIdx < visible.length - 1) {
      setStep(visible[currentIdx + 1].id);
    }
  };

  const goPrev = () => {
    const visible = getVisibleSteps();
    const currentIdx = visible.findIndex(s => s.id === step);
    if (currentIdx > 0) {
      setStep(visible[currentIdx - 1].id);
    }
  };

  const visibleSteps = getVisibleSteps();
  const currentVisibleIdx = visibleSteps.findIndex(s => s.id === step);
  const isFirst = currentVisibleIdx === 0;
  const isLast = currentVisibleIdx === visibleSteps.length - 1;

  return (
    <div className="cip-wrap">

      {/* ── Step rail ── */}
      <div className="cip-rail">
        {STEPS.map((s, i) => {
          if (profileMode === 'indicative' && s.id === 2) return null;
          const isActive = s.id === step;
          const isDone = visibleSteps.findIndex(vs => vs.id === s.id) < currentVisibleIdx;
          const accessible = isStepAccessible(s.id);
          return (
            <React.Fragment key={s.id}>
              <button
                className={`cip-step-btn ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                disabled={!accessible}
                onClick={() => accessible && setStep(s.id)}
              >
                <span className="cip-step-num">
                  {isDone ? '✓' : visibleSteps.findIndex(vs => vs.id === s.id) + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && !(profileMode === 'indicative' && s.id === 1) && (
                <span className="cip-step-sep">›</span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Step content ── */}
      <div className="cip-content">
        {step === 1 && (
          <CIPStep1
            profileMode={profileMode}
            setProfileMode={setProfileMode}
            onNext={goNext}
            isNewClient={!activeClient}
          />
        )}
        {step === 2 && profileMode !== 'indicative' && (
          <CIPStep2
            profileMode={profileMode}
            onNext={goNext}
            onBack={goPrev}
          />
        )}
        {step === 3 && (
          <CIPStep3
            onNext={goNext}
            onBack={goPrev}
          />
        )}
        {step === 4 && (
          <CIPStep4
            profileMode={profileMode}
            onNext={goNext}
            onBack={goPrev}
          />
        )}
        {step === 5 && (
          <Step5Placeholder
            client={activeClient}
            profileMode={profileMode}
            onBack={goPrev}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  );
}



/* ── Generic placeholder for steps not yet built ── */
function StepPlaceholder({ title, description, onNext, onBack, isFirst, isLast }) {
  return (
    <div className="cip-step-panel">
      <div className="cip-step-title">{title}</div>
      <div className="cip-step-desc">{description}</div>
      <div className="cip-coming-soon">
        <div className="cip-coming-soon-icon">🚧</div>
        <div className="cip-coming-soon-text">This step is coming soon.</div>
      </div>
      <div className="cip-nav-buttons">
        {!isFirst && (
          <button className="btn-outline" onClick={onBack}>← Back</button>
        )}
        {!isLast && (
          <button className="btn-primary" onClick={onNext}>Continue →</button>
        )}
      </div>
    </div>
  );
}

/* ── Step 5 — Choose Journey ── */
function Step5Placeholder({ client, profileMode, onBack, navigate }) {
  const JOURNEYS = [
    {
      key: 'retirement',
      title: 'Retirement Planner',
      blurb: 'Determine retirement corpus, contributions and investment requirements.',
      path: '/retirement-planner',
      cta: 'Open Retirement Planner →',
    },
    {
      key: 'models',
      title: 'Use a BugleRock Model Portfolio',
      blurb: "View the BugleRock Model Portfolio aligned with this client's risk profile.",
      path: '/models',
      cta: 'View Recommended Model →',
    },
    {
      key: 'portfolio',
      title: 'Build a Custom Portfolio',
      blurb: "Construct a portfolio within the client's approved investment mandate.",
      path: '/portfolio',
      cta: 'Open Portfolio Builder →',
    },
  ];

  return (
    <div className="cip-step-panel">
      <div className="cip-step-title">Choose Journey</div>
      <div className="cip-step-desc">
        The client profile is saved. Choose how you want to proceed.
      </div>
      {profileMode === 'indicative' && (
        <div className="cip-indicative-warn" style={{ marginBottom: 20 }}>
          Indicative profile — outputs will be marked "Indicative" and cannot be finalised as suitable.
        </div>
      )}
      <div className="cip-journey-cards">
        {JOURNEYS.map(j => (
          <div key={j.key} className="cip-journey-card">
            <div className="cip-journey-title">{j.title}</div>
            <div className="cip-journey-blurb">{j.blurb}</div>
            <button className="btn-primary" onClick={() => navigate(j.path)}>
              {j.cta}
            </button>
          </div>
        ))}
      </div>
      <div className="cip-nav-buttons">
        <button className="btn-outline" onClick={onBack}>← Back</button>
      </div>
    </div>
  );
}