import React from 'react';
import { useClient } from '../../context/ClientContext';

const RISK_META = {
  conservative:     { label: 'Conservative',           color: '#1A7A52', equityMin: 0,  equityMax: 28  },
  mod_conservative: { label: 'Moderately Conservative', color: '#2563EB', equityMin: 28, equityMax: 48  },
  balanced:         { label: 'Balanced',                color: '#D97706', equityMin: 48, equityMax: 70  },
  mod_aggressive:   { label: 'Moderately Aggressive',   color: '#EA580C', equityMin: 70, equityMax: 90  },
  aggressive:       { label: 'Aggressive',              color: '#912F63', equityMin: 80, equityMax: 100 },
};

const STATUS_META = {
  draft:      { label: 'Draft',      color: '#6B7280' },
  indicative: { label: 'Indicative', color: '#D97706' },
  assessed:   { label: 'Assessed',   color: '#059669' },
  approved:   { label: 'Approved',   color: '#059669' },
  review_due: { label: 'Review Due', color: '#D97706' },
  expired:    { label: 'Expired',    color: '#B91C1C' },
};

function buildWhyPoints(client) {
  const points = [];

  if (client.constrained_by) {
    const binding = client.constrained_by === 'capacity' ? 'Risk Capacity' : 'Risk Willingness';
    const other   = client.constrained_by === 'capacity' ? 'willingness'   : 'capacity';
    points.push(`${binding}, rather than ${other}, is the binding constraint on this profile.`);
  }

  if (client.horizon === 'veryLong' || client.horizon === 'long') {
    points.push('Long investment horizon supports meaningful equity exposure.');
  } else if (client.horizon === 'short') {
    points.push('Short investment horizon limits allowable equity exposure and illiquidity.');
  }

  const liq = client.liquidity_need || '';
  if (liq.startsWith('High')) {
    points.push('High liquidity requirement reduces allowable illiquidity/concentration.');
  } else if (liq.startsWith('Moderate')) {
    points.push('Moderate liquidity requirement moderately constrains illiquid/concentrated positions.');
  } else if (liq === 'None' || liq.startsWith('Low')) {
    points.push('Low liquidity requirement allows fuller use of the suitable equity range.');
  }

  if (!points.length) {
    points.push('Profile derived from the answered risk willingness and capacity questions.');
  }
  return points;
}

function StatCard({ label, value, color }) {
  return (
    <div className="cip-stat-card">
      <div className="cip-stat-label">{label}</div>
      <div className="cip-stat-value" style={{ color: color || '#3E3452' }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="cip-info-row">
      <span className="cip-info-row-label">{label}</span>
      <span className="cip-info-row-value">{value || '—'}</span>
    </div>
  );
}

export default function CIPStep4({ profileMode, onNext, onBack }) {
  const { activeClient: client } = useClient();

  const riskMeta   = client?.risk_profile ? RISK_META[client.risk_profile] : null;
  const statusMeta = client?.suitability_status ? STATUS_META[client.suitability_status] : STATUS_META.draft;

  // No risk profile — indicative mode without a profile selection
  if (!riskMeta) {
    return (
      <div className="cip-step-panel">
        <div className="cip-step-title">Suitability Decision Card</div>
        <div className="cip-indicative-warn" style={{ marginBottom: 20 }}>
          <strong>Indicative profile — no formal risk assessment completed.</strong>
          {' '}This profile is for proposal preparation only and cannot be finalised
          as a suitable recommendation.
        </div>
        <div className="cip-info-note" style={{ marginBottom: 20 }}>
          No risk profile has been identified. The portfolio will be built without
          a risk-profile constraint — the RM is responsible for ensuring the
          resulting portfolio is appropriate for this client.
        </div>
        <div className="cip-nav-buttons">
          <button className="btn-outline" onClick={onBack}>← Back</button>
          <button className="btn-primary" onClick={onNext}>Continue to Choose Journey →</button>
        </div>
      </div>
    );
  }

  const whyPoints = buildWhyPoints(client);
  const isIndicative = profileMode === 'indicative' || client.suitability_status === 'indicative';
  const constraints = client.constraints || {};

  const decisionRows = [
    ['Overall Suitability',   ['assessed','approved'].includes(client.suitability_status) ? 'Suitable' : statusMeta.label],
    ['Risk Profile',          riskMeta.label],
    ['Maximum Approved Risk', riskMeta.label],
    ['Liquidity Constraint',  client.liquidity_need || '—'],
    ['Valid Until',           client.valid_until || client.next_review_date || '—'],
  ];

  const contextRows = [
    ['Investment Amount',        client.investment_amount ? `₹${Number(client.investment_amount).toLocaleString('en-IN')}` : '—'],
    ['Horizon',                  client.horizon || '—'],
    ['Primary Objective',        client.objective || '—'],
    ['Income Requirement',       client.income_requirement || '—'],
    ['Portfolio Concentration',  Object.keys(constraints).length > 2 ? 'Customised' : 'BR Standard'],
    ['Investment Restrictions',  constraints.excludedAmcs?.length
      ? `${constraints.excludedAmcs.length} AMC(s) excluded${constraints.otherRestrictions ? '; see notes' : ''}`
      : 'None'],
    ['Benchmark',                constraints.benchmarks?.length
      ? constraints.benchmarks.map(b => `${b.name} (${b.weight}%)`).join(', ')
      : (constraints.benchmark || '—')],
    ['Review Frequency',         constraints.reviewFrequency || '—'],
    ['Rebalancing Policy',       constraints.rebalancingPolicy || '—'],
  ];

  return (
    <div className="cip-step-panel">
      <div className="cip-step-title">Suitability Decision Card</div>

      {/* Indicative banner */}
      {isIndicative && (
        <div className="cip-indicative-warn" style={{ marginBottom: 20 }}>
          <strong>Indicative</strong> — formal risk assessment not completed. This profile is for
          proposal preparation only; it cannot be finalised as a suitable recommendation until a
          full assessment is done.
        </div>
      )}

      {/* ── Hero card ── */}
      <div className="cip-suitability-hero" style={{ borderColor: riskMeta.color + '40' }}>
        <div className="cip-suitability-hero-left">
          <div className="cip-suitability-hero-sub">Client Investment Profile</div>
          <div className="cip-suitability-hero-profile" style={{ color: riskMeta.color }}>
            {riskMeta.label}
            {isIndicative && <span className="cip-suitability-indicative-tag">(Indicative)</span>}
          </div>
          <div className="cip-suitability-hero-status" style={{ color: statusMeta.color }}>
            {statusMeta.label}
          </div>
          <div className="cip-suitability-hero-score">
            Risk Score {client.overall_score != null ? `${client.overall_score}/100` : '—'}
            {client.constrained_by && (
              <span> · Binding factor: {client.constrained_by === 'capacity' ? 'Risk Capacity' : 'Risk Willingness'}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="cip-stat-grid">
        <StatCard
          label="Willingness"
          value={client.willingness_score != null ? `${client.willingness_score}/100` : '—'}
          color="#3E3452"
        />
        <StatCard
          label="Capacity"
          value={client.capacity_score != null ? `${client.capacity_score}/100` : '—'}
          color="#912F63"
        />
        <StatCard
          label="Binding Factor"
          value={client.constrained_by
            ? (client.constrained_by === 'capacity' ? 'Capacity' : 'Willingness')
            : '—'}
          color="#912F63"
        />
        <StatCard
          label="Equity Band"
          value={`${riskMeta.equityMin}–${riskMeta.equityMax}%`}
          color={riskMeta.color}
        />
      </div>

      {/* ── Why this profile ── */}
      <div className="cip-why-section">
        <div className="cip-why-title">Why this profile?</div>
        <ul className="cip-why-list">
          {whyPoints.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </div>

      {/* ── Decision card rows ── */}
      <div className="cip-info-grid">
        <div className="cip-info-grid-title">Suitability Summary</div>
        {decisionRows.map(([label, value]) => (
          <InfoRow key={label} label={label} value={value} />
        ))}
      </div>

      {/* ── Context rows ── */}
      <div className="cip-info-grid" style={{ marginTop: 12 }}>
        <div className="cip-info-grid-title">Client Context</div>
        {contextRows.map(([label, value]) => (
          <InfoRow key={label} label={label} value={value} />
        ))}
      </div>

      {/* ── Nav buttons ── */}
      <div className="cip-nav-buttons">
        <button className="btn-outline" onClick={onBack}>← Back</button>
        <button className="btn-primary" onClick={onNext}>Continue to Choose Journey →</button>
      </div>
    </div>
  );
}