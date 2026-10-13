import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useClient } from '../../context/ClientContext';
import './Client.css';

const RISK_TAXONOMY = {
  conservative:    { label: 'Conservative',         riskScore: 1, equityMin: 0,  equityMax: 28, color: '#1A7A52' },
  mod_conservative:{ label: 'Moderately Conservative', riskScore: 2, equityMin: 28, equityMax: 48, color: '#2563EB' },
  balanced:        { label: 'Balanced',             riskScore: 3, equityMin: 48, equityMax: 70, color: '#D97706' },
  mod_aggressive:  { label: 'Moderately Aggressive', riskScore: 4, equityMin: 70, equityMax: 90, color: '#EA580C' },
  aggressive:      { label: 'Aggressive',           riskScore: 5, equityMin: 80, equityMax: 90, color: '#912F63' },
};

const STATUS_META = {
  draft:      { label: 'Draft',       bg: '#F3F4F6', txt: '#6B7280' },
  indicative: { label: 'Indicative',  bg: '#FEF3C7', txt: '#92400E' },
  assessed:   { label: 'Assessed',    bg: '#D1FAE5', txt: '#065F46' },
  approved:   { label: 'Approved',    bg: '#D1FAE5', txt: '#065F46' },
  review_due: { label: 'Review Due',  bg: '#FEF3C7', txt: '#92400E' },
  expired:    { label: 'Expired',     bg: '#FEE2E2', txt: '#991B1B' },
};

const PIPELINE_STAGES = [
  { key: 'cip',                 label: 'Client Profile',     path: '/client/profile' },
  { key: 'retirement-planner',  label: 'Retirement Planner', path: '/retirement-planner' },
  { key: 'models',              label: 'Model Portfolios',   path: '/models' },
  { key: 'portfolio',           label: 'Portfolio Builder',  path: '/portfolio' },
];

function fmt(n) {
  if (!n) return '—';
  const num = typeof n === 'string' ? parseInt(n.replace(/,/g, ''), 10) : n;
  if (isNaN(num)) return '—';
  if (num >= 10000000) return '₹' + (num / 10000000).toFixed(1) + 'Cr';
  if (num >= 100000) return '₹' + (num / 100000).toFixed(1) + 'L';
  return '₹' + num.toLocaleString('en-IN');
}

export default function ClientDashboard() {
  const { activeClient } = useClient();
  const navigate = useNavigate();

  if (!activeClient) {
    return (
      <div className="client-empty-state">
        <div className="client-empty-icon">👤</div>
        <div className="client-empty-title">No client loaded</div>
        <div className="client-empty-sub">
          Complete a Client Investment Profile to unlock the full lifecycle dashboard —
          risk profiling, portfolio tracking, drift alerts, and review scheduling.
        </div>
        <button className="btn-primary" onClick={() => navigate('/client/profile')}>
          Start Client Investment Profile →
        </button>
      </div>
    );
  }

  const c = activeClient;
  const riskTax = c.risk_profile ? RISK_TAXONOMY[c.risk_profile] : null;
  const sm = STATUS_META[c.suitability_status] || STATUS_META.draft;

  // Pipeline — CIP is done if status is not draft
  const cipDone = c.suitability_status && c.suitability_status !== 'draft';

  return (
    <div className="client-dashboard">

      {/* ── Header card ── */}
      <div className="client-hero-card">
        <div className="client-hero-left">
          <div className="client-avatar">{(c.name || '?')[0].toUpperCase()}</div>
          <div>
            <div className="client-hero-name">{c.name}</div>
            <div className="client-hero-meta">
              {c.pan && <span>{c.pan}</span>}
              {c.email && <span>{c.email}</span>}
              {c.rm_name && <span>RM: {c.rm_name}</span>}
            </div>
          </div>
        </div>
        <div className="client-hero-right">
          <span className="status-pill" style={{ background: sm.bg, color: sm.txt }}>
            {sm.label}
          </span>
          {riskTax && (
            <span className="risk-pill" style={{ background: riskTax.color + '18', color: riskTax.color }}>
              {riskTax.label}
            </span>
          )}
          <button className="btn-outline" onClick={() => navigate('/client/profile')}>
            Edit Profile
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="client-kpi-strip">
        <div className="client-kpi">
          <div className="client-kpi-label">Investment Amount</div>
          <div className="client-kpi-value">{fmt(c.investment_amount)}</div>
          {c.sip && <div className="client-kpi-sub">SIP: {fmt(c.sip)}/mo</div>}
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Risk Profile</div>
          <div className="client-kpi-value" style={{ color: riskTax?.color }}>
            {riskTax?.label || '—'}
          </div>
          {riskTax && (
            <div className="client-kpi-sub">{riskTax.equityMin}–{riskTax.equityMax}% equity</div>
          )}
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Objective</div>
          <div className="client-kpi-value">{c.objective || '—'}</div>
          {c.horizon && <div className="client-kpi-sub">Horizon: {c.horizon}</div>}
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Next Review</div>
          <div className="client-kpi-value">
            {c.next_review_date
              ? new Date(c.next_review_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
              : '—'}
          </div>
          {c.overall_score != null && (
            <div className="client-kpi-sub">Score: {c.overall_score}/100</div>
          )}
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Tax Status</div>
          <div className="client-kpi-value">{c.tax_status || '—'}</div>
          {c.source_of_funds && <div className="client-kpi-sub">{c.source_of_funds}</div>}
        </div>
      </div>

      {/* ── Build Pipeline ── */}
      <div className="client-section-title">Build Pipeline</div>
      <div className="client-pipeline">
        {PIPELINE_STAGES.map((stage, i) => {
          const isDone = stage.key === 'cip' ? cipDone : false;
          const isNext = !isDone && (i === 0 || PIPELINE_STAGES[i - 1].key === 'cip' ? cipDone : false);
          return (
            <React.Fragment key={stage.key}>
              <div
                className={`pipeline-card ${isDone ? 'done' : isNext ? 'next' : 'pending'}`}
                onClick={() => navigate(stage.path)}
              >
                <div className="pipeline-label">{stage.label}</div>
                <div className="pipeline-status">
                  {isDone ? '✓ Complete' : isNext ? '→ Next step' : 'Pending'}
                </div>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div className="pipeline-sep">›</div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Risk Assessment summary ── */}
      {(c.willingness_score != null || c.capacity_score != null) && (
        <div className="client-section">
          <div className="client-section-title">Risk Assessment</div>
          <div className="client-risk-scores">
            {c.willingness_score != null && (
              <div className="risk-score-card">
                <div className="risk-score-label">Risk Willingness</div>
                <div className="risk-score-bar-wrap">
                  <div className="risk-score-bar" style={{ width: `${c.willingness_score}%`, background: '#3E3452' }} />
                </div>
                <div className="risk-score-val">{c.willingness_score}<span>/100</span></div>
              </div>
            )}
            {c.capacity_score != null && (
              <div className="risk-score-card">
                <div className="risk-score-label">Risk Capacity</div>
                <div className="risk-score-bar-wrap">
                  <div className="risk-score-bar" style={{ width: `${c.capacity_score}%`, background: '#912F63' }} />
                </div>
                <div className="risk-score-val">{c.capacity_score}<span>/100</span></div>
              </div>
            )}
            {c.constrained_by && (
              <div className="risk-binding">
                Binding constraint: <strong>{c.constrained_by === 'capacity' ? 'Risk Capacity' : 'Risk Willingness'}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Constraints summary ── */}
      {c.constraints && Object.keys(c.constraints).length > 0 && (
        <div className="client-section">
          <div className="client-section-title">Investment Constraints</div>
          <div className="client-constraints-grid">
            {c.constraints.maxFundsInPortfolio && (
              <div className="constraint-item">
                <span className="constraint-label">Max funds</span>
                <span className="constraint-val">{c.constraints.maxFundsInPortfolio}</span>
              </div>
            )}
            {c.constraints.reviewFrequency && (
              <div className="constraint-item">
                <span className="constraint-label">Review</span>
                <span className="constraint-val">{c.constraints.reviewFrequency}</span>
              </div>
            )}
            {c.constraints.rebalancingPolicy && (
              <div className="constraint-item">
                <span className="constraint-label">Rebalancing</span>
                <span className="constraint-val">{c.constraints.rebalancingPolicy}</span>
              </div>
            )}
            {c.constraints.benchmark && (
              <div className="constraint-item">
                <span className="constraint-label">Benchmark</span>
                <span className="constraint-val">{c.constraints.benchmark}</span>
              </div>
            )}
            {c.constraints.excludedAmcs?.length > 0 && (
              <div className="constraint-item">
                <span className="constraint-label">Excluded AMCs</span>
                <span className="constraint-val">{c.constraints.excludedAmcs.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}