import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClient } from '../../context/ClientContext';
import ClientBook from './ClientBook';
import PortfolioCards from './PortfolioCards';
import {
  maskPan, fmtDate, fmtINR as fmt, effectiveSuitability, HORIZON_META, RISK_TAXONOMY, STATUS_META,
} from './clientUtils';
import './Client.css';

function ViewTabs({ view, setView, count }) {
  return (
    <div className="client-view-tabs">
      <button className={`client-view-tab ${view === 'client' ? 'active' : ''}`} onClick={() => setView('client')}>
        This client
      </button>
      <button className={`client-view-tab ${view === 'book' ? 'active' : ''}`} onClick={() => setView('book')}>
        All clients ({count})
      </button>
    </div>
  );
}

export default function ClientDashboard() {
  const { activeClient, clients, setActiveClient } = useClient();
  const navigate = useNavigate();
  const [view, setView] = useState('client');

  function openClient(client) {
    setActiveClient(client);
    setView('client');
  }

  function newClient() {
    setActiveClient(null);
    navigate('/client/profile');
  }

  // No client selected: show the book if there are clients to pick from
  if (!activeClient && clients.length > 0) {
    return (
      <div className="client-dashboard">
        <ClientBook clients={clients} activeId={null} onOpen={openClient} onNew={newClient} />
      </div>
    );
  }

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

  if (view === 'book') {
    return (
      <div className="client-dashboard">
        <ViewTabs view={view} setView={setView} count={clients.length} />
        <ClientBook clients={clients} activeId={activeClient.id} onOpen={openClient} onNew={newClient} />
      </div>
    );
  }

  const c = activeClient;
  const riskTax = c.risk_profile ? RISK_TAXONOMY[c.risk_profile] : null;
  const suit = effectiveSuitability(c);
  const sm = STATUS_META[suit.status] || STATUS_META.draft;
  const horizonLabel = HORIZON_META[c.horizon]?.label || c.horizon;
  const summary = [riskTax?.label, HORIZON_META[c.horizon]?.label, c.objective].filter(Boolean).join(' · ');

  return (
    <div className="client-dashboard">
      <ViewTabs view={view} setView={setView} count={clients.length} />

      {/* ── Header card ── */}
      <div className="client-hero-card">
        <div className="client-hero-left">
          <div className="client-avatar">{(c.name || '?')[0].toUpperCase()}</div>
          <div>
            <div className="client-hero-name">{c.name}</div>
            <div className="client-hero-meta">
              {c.pan && <span>{maskPan(c.pan)}</span>}
              {c.email && <span>{c.email}</span>}
              {c.rm_name && <span>RM: {c.rm_name}</span>}
              {c.updated_at && <span>Updated {fmtDate(c.updated_at)}</span>}
            </div>
            {summary && <div className="client-hero-summary">{summary}</div>}
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

      {/* ── Action banner (computed from valid_until / next_review_date) ── */}
      {suit.level && (
        <div className={`client-banner ${suit.level}`}>
          <span>{suit.message}</span>
          <button className="btn-outline" onClick={() => navigate('/client/profile')}>
            {suit.status === 'draft' || suit.status === 'indicative' ? 'Complete profile' : 'Update profile'}
          </button>
        </div>
      )}

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
          {c.horizon && <div className="client-kpi-sub">Horizon: {horizonLabel}</div>}
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Next Review</div>
          <div className="client-kpi-value">{fmtDate(c.next_review_date)}</div>
          {c.valid_until && <div className="client-kpi-sub">Assessment valid to {fmtDate(c.valid_until)}</div>}
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

      {/* ── Portfolios saved against this client ── */}
      <PortfolioCards clientId={c.id} />

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
                {c.willingness_score != null && c.capacity_score != null && riskTax && (
                  <>
                    {' — '}
                    {c.willingness_score === c.capacity_score
                      ? `willingness and capacity are level at ${c.capacity_score}; capacity is treated as binding on a tie. The profile is ${riskTax.label}.`
                      : c.constrained_by === 'capacity'
                        ? `capacity (${c.capacity_score}) is lower than willingness (${c.willingness_score}), so the client can afford less risk than they are comfortable with. The profile is held at ${riskTax.label}.`
                        : `willingness (${c.willingness_score}) is lower than capacity (${c.capacity_score}), so the client could afford more risk than they are comfortable with. The profile is held at ${riskTax.label}.`}
                  </>
                )}
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