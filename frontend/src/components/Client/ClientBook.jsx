import React, { useMemo, useState } from 'react';
import {
  fmtDate, fmtINR, daysFromToday, effectiveSuitability, RISK_TAXONOMY, STATUS_META,
} from './clientUtils';

// Most urgent first: expired / overdue, then due soon, then incomplete profiles, then the rest.
const LEVEL_RANK = { danger: 0, warn: 1, info: 2 };
const rankOf = (level) => (level in LEVEL_RANK ? LEVEL_RANK[level] : 3);

const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'attention',  label: 'Needs attention' },
  { key: 'incomplete', label: 'Draft / indicative' },
];

function reviewText(days) {
  if (days === null) return '—';
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'today';
  return `in ${days}d`;
}

// RM-level view of every client the user owns. Built from the client list already loaded in context.
export default function ClientBook({ clients, activeId, onOpen, onNew }) {
  const [filter, setFilter] = useState('all');

  const rows = useMemo(() => clients.map(c => {
    const suit = effectiveSuitability(c);
    return { c, suit, reviewDays: daysFromToday(c.next_review_date) };
  }), [clients]);

  const counts = useMemo(() => {
    const byRisk = {};
    let attention = 0;
    let incomplete = 0;
    rows.forEach(({ c, suit }) => {
      if (c.risk_profile) byRisk[c.risk_profile] = (byRisk[c.risk_profile] || 0) + 1;
      if (suit.level === 'danger' || suit.level === 'warn') attention += 1;
      if (suit.level === 'info') incomplete += 1;
    });
    return { byRisk, attention, incomplete };
  }, [rows]);

  const shown = useMemo(() => {
    const keep = rows.filter(({ suit }) => {
      if (filter === 'attention') return suit.level === 'danger' || suit.level === 'warn';
      if (filter === 'incomplete') return suit.level === 'info';
      return true;
    });
    return keep.sort((a, b) => {
      const r = rankOf(a.suit.level) - rankOf(b.suit.level);
      if (r !== 0) return r;
      const da = a.reviewDays === null ? Infinity : a.reviewDays;
      const db = b.reviewDays === null ? Infinity : b.reviewDays;
      return da - db;
    });
  }, [rows, filter]);

  return (
    <div className="client-book">
      <div className="client-kpi-strip">
        <div className="client-kpi">
          <div className="client-kpi-label">Clients</div>
          <div className="client-kpi-value">{clients.length}</div>
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Need attention</div>
          <div className="client-kpi-value" style={{ color: counts.attention ? '#DC2626' : undefined }}>{counts.attention}</div>
          <div className="client-kpi-sub">expired, overdue or due in 30 days</div>
        </div>
        <div className="client-kpi">
          <div className="client-kpi-label">Draft / indicative</div>
          <div className="client-kpi-value">{counts.incomplete}</div>
          <div className="client-kpi-sub">assessment not finalised</div>
        </div>
        <div className="client-kpi" style={{ flex: 2 }}>
          <div className="client-kpi-label">By risk profile</div>
          <div className="book-risk-chips">
            {Object.entries(RISK_TAXONOMY).map(([key, t]) => (
              counts.byRisk[key] ? (
                <span key={key} className="risk-pill" style={{ background: t.color + '18', color: t.color }}>
                  {t.label} · {counts.byRisk[key]}
                </span>
              ) : null
            ))}
            {Object.keys(counts.byRisk).length === 0 && <span className="client-kpi-sub">No risk profiles yet</span>}
          </div>
        </div>
      </div>

      <div className="book-toolbar">
        <div className="book-filters">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`book-filter ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={onNew}>+ New client</button>
      </div>

      <div className="client-section" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="rm-table book-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Risk profile</th>
              <th>Status</th>
              <th>Next review</th>
              <th>Valid to</th>
              <th className="r">Investment</th>
              <th className="r">SIP / month</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="book-empty">No clients match this filter.</td></tr>
            )}
            {shown.map(({ c, suit, reviewDays }) => {
              const risk = c.risk_profile ? RISK_TAXONOMY[c.risk_profile] : null;
              const sm = STATUS_META[suit.status] || STATUS_META.draft;
              return (
                <tr
                  key={c.id}
                  className={`book-row ${c.id === activeId ? 'active' : ''}`}
                  onClick={() => onOpen(c)}
                  title={suit.message || undefined}
                >
                  <td>
                    <div className="book-name">{c.name}</div>
                    {c.rm_name && <div className="book-sub">RM: {c.rm_name}</div>}
                  </td>
                  <td>
                    {risk
                      ? <span className="risk-pill" style={{ background: risk.color + '18', color: risk.color }}>{risk.label}</span>
                      : '—'}
                  </td>
                  <td><span className="status-pill" style={{ background: sm.bg, color: sm.txt }}>{sm.label}</span></td>
                  <td>
                    {fmtDate(c.next_review_date)}
                    {reviewDays !== null && (
                      <div className="book-sub" style={{ color: reviewDays < 0 ? '#DC2626' : undefined }}>
                        {reviewText(reviewDays)}
                      </div>
                    )}
                  </td>
                  <td>{fmtDate(c.valid_until)}</td>
                  <td className="r">{fmtINR(c.investment_amount)}</td>
                  <td className="r">{fmtINR(c.sip)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
