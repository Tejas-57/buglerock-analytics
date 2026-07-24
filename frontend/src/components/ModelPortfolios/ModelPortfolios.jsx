import React, { useState, useEffect } from 'react';
import './ModelPortfolios.css';

const API = process.env.REACT_APP_API_URL || '';

const RISK_COLORS = {
  1: { bg: '#E6F4ED', text: '#1A7A52', bar: '#1A7A52' },
  2: { bg: '#EBF4E8', text: '#3A7A30', bar: '#4C8C3C' },
  3: { bg: '#FBF4E0', text: '#7A5A10', bar: '#D97706' },
  4: { bg: '#FEF0E6', text: '#C2540A', bar: '#C2540A' },
  5: { bg: '#FDEAEF', text: '#912F63', bar: '#B91C1C' },
};

const ASSET_COLORS = {
  Equity: '#912F63',
  Debt:   '#3E3452',
  Hybrid: '#6D5479',
  Gold:   '#B8860B',
  Other:  '#A795AE',
};

function fmt(v, suffix = '', prefix = '') {
  if (v == null) return '—';
  const n = parseFloat(v);
  return `${prefix}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
}

function fmtPct(v, showSign = true) {
  if (v == null) return '—';
  const n = parseFloat(v);
  const sign = showSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtAum(v) {
  if (!v) return '—';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L Cr`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}k Cr`;
  return `₹${Math.round(v)} Cr`;
}

function ReturnPill({ value }) {
  if (value == null) return <span className="mp-return-null">—</span>;
  const n = parseFloat(value);
  return (
    <span className={`mp-return-pill ${n >= 0 ? 'pos' : 'neg'}`}>
      {n >= 0 ? '+' : ''}{n.toFixed(2)}%
    </span>
  );
}

function Stars({ rating }) {
  if (!rating) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const r = Math.round(rating);
  return (
    <span style={{ color: '#B8860B', letterSpacing: -1 }}>
      {'★'.repeat(r)}{'☆'.repeat(5 - r)}
    </span>
  );
}

function AssetMixBar({ mix }) {
  const keys = ['Equity', 'Hybrid', 'Debt', 'Gold', 'Other'];
  const total = keys.reduce((s, k) => s + (mix[k] || 0), 0) || 1;
  return (
    <div className="mp-asset-bar">
      {keys.filter(k => (mix[k] || 0) > 0.5).map(k => (
        <div
          key={k}
          className="mp-asset-segment"
          style={{ width: `${((mix[k] / total) * 100).toFixed(1)}%`, background: ASSET_COLORS[k] }}
          title={`${k}: ${mix[k].toFixed(0)}%`}
        />
      ))}
    </div>
  );
}

function AssetMixLegend({ mix }) {
  const keys = ['Equity', 'Hybrid', 'Debt', 'Gold', 'Other'];
  return (
    <div className="mp-asset-legend">
      {keys.filter(k => (mix[k] || 0) > 0.5).map(k => (
        <div key={k} className="mp-legend-item">
          <div className="mp-legend-dot" style={{ background: ASSET_COLORS[k] }} />
          <span className="mp-legend-label">{k}</span>
          <span className="mp-legend-value">{mix[k].toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function RiskSpectrum({ portfolios, selectedKey, onSelect }) {
  const riskBased = portfolios.filter(p => p.group === 'risk').sort((a, b) => a.risk_score - b.risk_score);
  return (
    <div className="mp-spectrum card">
      <div className="mp-spectrum-title">Risk spectrum</div>
      <div className="mp-spectrum-track">
        {riskBased.map((p, i) => {
          const rc = RISK_COLORS[p.risk_score] || RISK_COLORS[3];
          const isSelected = selectedKey === p.key;
          return (
            <button
              key={p.key}
              className={`mp-spectrum-node ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(p.key)}
              style={{ '--node-color': rc.bar }}
            >
              <div className="mp-spectrum-dot" style={{ background: rc.bar, borderColor: isSelected ? rc.bar : 'transparent' }} />
              <div className="mp-spectrum-label">{p.label}</div>
              <div className="mp-spectrum-horizon" style={{ color: rc.text }}>{p.horizon}</div>
              {p.blended?.return_1y != null && (
                <div className="mp-spectrum-ret" style={{ color: p.blended.return_1y >= 0 ? '#1A7A52' : '#912F63' }}>
                  {fmtPct(p.blended.return_1y)}
                </div>
              )}
            </button>
          );
        })}
        <div className="mp-spectrum-line" />
      </div>
    </div>
  );
}

function ComparisonTable({ portfolios, selectedKey, onSelect }) {
  const [sortKey, setSortKey] = useState('risk_score');
  const [sortDir, setSortDir] = useState('asc');

  function handleSort(k) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'expense_ratio' ? 'asc' : 'desc'); }
  }

  function arrow(k) { return sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''; }

  const sorted = [...portfolios].sort((a, b) => {
    let av, bv;
    if (sortKey === 'risk_score') { av = a.risk_score; bv = b.risk_score; }
    else if (sortKey === 'label') { av = a.label; bv = b.label; }
    else if (sortKey === 'fund_count') { av = a.fund_count; bv = b.fund_count; }
    else { av = a.blended?.[sortKey]; bv = b.blended?.[sortKey]; }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return sortDir === 'asc' ? c : -c;
  });

  function Th({ label, k, align = 'right' }) {
    return (
      <th
        className={`mp-th ${sortKey === k ? 'sorted' : ''}`}
        style={{ textAlign: align, cursor: 'pointer' }}
        onClick={() => handleSort(k)}
      >
        {label}{arrow(k)}
      </th>
    );
  }

  return (
    <div className="mp-table-wrap card">
      <div className="mp-card-hd">All model portfolios — click a row to view detail</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="mp-table">
          <thead>
            <tr>
              <Th label="Portfolio" k="label" align="left" />
              <th className="mp-th" style={{ textAlign: 'center' }}>Type</th>
              <Th label="Risk" k="risk_score" align="center" />
              <Th label="Horizon" k="risk_score" align="left" />
              <Th label="Funds" k="fund_count" align="right" />
              <Th label="1Y" k="return_1y" />
              <Th label="3Y CAGR" k="return_3y" />
              <Th label="Sharpe" k="sharpe_3y" />
              <Th label="ER" k="expense_ratio" />
              <th className="mp-th" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const rc = RISK_COLORS[p.risk_score] || RISK_COLORS[3];
              const isTheme = p.group === 'theme';
              const isSelected = selectedKey === p.key;
              return (
                <tr
                  key={p.key}
                  className={`mp-tr ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelect(p.key)}
                >
                  <td className="mp-td" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.label}</td>
                  <td className="mp-td" style={{ textAlign: 'center' }}>
                    <span className="mp-type-badge" style={{ background: isTheme ? '#0F6E5618' : '#912F6318', color: isTheme ? '#0F6E56' : '#912F63' }}>
                      {isTheme ? 'Theme' : 'Risk-based'}
                    </span>
                  </td>
                  <td className="mp-td" style={{ textAlign: 'center' }}>
                    <span className="mp-risk-badge" style={{ background: rc.bg, color: rc.text }}>{p.risk}</span>
                  </td>
                  <td className="mp-td" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{p.horizon}</td>
                  <td className="mp-td mp-num">{p.fund_count}</td>
                  <td className="mp-td mp-num" style={{ color: p.blended?.return_1y >= 0 ? '#1A7A52' : '#912F63', fontWeight: 600 }}>
                    {fmtPct(p.blended?.return_1y)}
                  </td>
                  <td className="mp-td mp-num" style={{ color: p.blended?.return_3y >= 0 ? '#1A7A52' : '#912F63' }}>
                    {fmtPct(p.blended?.return_3y)}
                  </td>
                  <td className="mp-td mp-num">{fmt(p.blended?.sharpe_3y)}</td>
                  <td className="mp-td mp-num">{p.blended?.expense_ratio != null ? `${p.blended.expense_ratio.toFixed(2)}%` : '—'}</td>
                  <td className="mp-td">
                    <button className="mp-view-btn" onClick={e => { e.stopPropagation(); onSelect(p.key); }}>
                      View →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PortfolioDetail({ portfolio, onBack }) {
  const rc = RISK_COLORS[portfolio.risk_score] || RISK_COLORS[3];
  const b = portfolio.blended || {};

  return (
    <div className="mp-detail fade-in">
      {/* Header */}
      <div className="mp-detail-hd card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span className="mp-risk-badge" style={{ background: rc.bg, color: rc.text, fontSize: 11 }}>{portfolio.risk}</span>
              <span className="mp-type-badge" style={{ background: portfolio.group === 'theme' ? '#0F6E5618' : '#912F6318', color: portfolio.group === 'theme' ? '#0F6E56' : '#912F63' }}>
                {portfolio.group === 'theme' ? 'Theme-based' : 'Risk-based'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Horizon: {portfolio.horizon}</span>
            </div>
            <div className="mp-detail-name">{portfolio.label}</div>
            <div className="mp-detail-suitability">{portfolio.suitability}</div>
          </div>
          <button className="mp-back-btn" onClick={onBack}>← All models</button>
        </div>

        {/* Blended metrics */}
        <div className="mp-metrics-row">
          {[
            { label: '1Y Return', value: fmtPct(b.return_1y), color: b.return_1y >= 0 ? '#1A7A52' : '#912F63' },
            { label: '3Y CAGR', value: fmtPct(b.return_3y), color: b.return_3y >= 0 ? '#1A7A52' : '#912F63' },
            { label: '5Y CAGR', value: fmtPct(b.return_5y), color: b.return_5y >= 0 ? '#1A7A52' : '#912F63' },
            { label: 'Sharpe (3Y)', value: fmt(b.sharpe_3y), color: 'var(--text-primary)' },
            { label: 'Alpha (3Y)', value: fmtPct(b.alpha_3y), color: 'var(--text-primary)' },
            { label: 'Std Dev (3Y)', value: fmtPct(b.std_dev_3y, false), color: 'var(--text-muted)' },
            { label: 'Expense Ratio', value: b.expense_ratio != null ? `${b.expense_ratio.toFixed(2)}%` : '—', color: 'var(--text-muted)' },
          ].map(m => (
            <div key={m.label} className="mp-metric-chip">
              <div className="mp-metric-label">{m.label}</div>
              <div className="mp-metric-value" style={{ color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Asset mix */}
        <div style={{ marginTop: 16 }}>
          <div className="mp-section-label">Asset allocation</div>
          <AssetMixBar mix={portfolio.asset_mix} />
          <AssetMixLegend mix={portfolio.asset_mix} />
        </div>
      </div>

      {/* Fund table */}
      <div className="card">
        <div className="mp-card-hd">Fund selection — {portfolio.fund_count} funds</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="mp-table">
            <thead>
              <tr>
                <th className="mp-th" style={{ textAlign: 'left', width: 30 }}>Wt%</th>
                <th className="mp-th" style={{ textAlign: 'left' }}>Fund</th>
                <th className="mp-th">NAV</th>
                <th className="mp-th">1Y</th>
                <th className="mp-th">3Y</th>
                <th className="mp-th">5Y</th>
                <th className="mp-th">Sharpe</th>
                <th className="mp-th">Alpha</th>
                <th className="mp-th">ER</th>
                <th className="mp-th">AUM</th>
                <th className="mp-th">Rating</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.funds.map((f, i) => (
                <tr key={f.isin} className="mp-tr">
                  <td className="mp-td">
                    <div className="mp-weight-cell">
                      <div className="mp-weight-bar" style={{ width: `${f.weight}%`, background: ASSET_COLORS[getAssetBucket(f)] }} />
                      <span className="mp-weight-num">{f.weight}%</span>
                    </div>
                  </td>
                  <td className="mp-td">
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>{f.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</div>
                  </td>
                  <td className="mp-td mp-num" style={{ fontSize: 11 }}>{f.nav ? `₹${f.nav.toFixed(2)}` : '—'}</td>
                  <td className="mp-td"><ReturnPill value={f.return_1y} /></td>
                  <td className="mp-td"><ReturnPill value={f.return_3y} /></td>
                  <td className="mp-td"><ReturnPill value={f.return_5y} /></td>
                  <td className="mp-td mp-num">{fmt(f.sharpe_3y)}</td>
                  <td className="mp-td mp-num" style={{ color: f.alpha_3y >= 0 ? '#1A7A52' : '#912F63' }}>{fmtPct(f.alpha_3y)}</td>
                  <td className="mp-td mp-num">{f.expense_ratio ? `${f.expense_ratio.toFixed(2)}%` : '—'}</td>
                  <td className="mp-td mp-num" style={{ fontSize: 11 }}>{fmtAum(f.aum_cr)}</td>
                  <td className="mp-td"><Stars rating={f.morningstar_rating} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mp-table-footer">
          Fund selection: highest Sharpe (3Y) → Morningstar rating → AUM within each category slice · Data as of {portfolio.data_date}
        </div>
      </div>
    </div>
  );
}

function getAssetBucket(f) {
  const ac = (f.asset_class || '').toLowerCase();
  const cat = (f.category || '').toLowerCase();
  if (ac.includes('debt') || ac.includes('bond')) return 'Debt';
  if (ac.includes('hybrid')) return 'Hybrid';
  if (cat.includes('precious') || cat.includes('gold') || cat.includes('silver')) return 'Gold';
  if (ac.includes('equity')) return 'Equity';
  return 'Other';
}

export default function ModelPortfolios({ selectedDate }) {
  const [portfolios, setPortfolios] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [filterGroup, setFilterGroup] = useState('all');

  const dateStr = selectedDate
    ? selectedDate.toISOString().split('T')[0]
    : null;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = `${API}/api/models/portfolios${dateStr ? `?date=${dateStr}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setPortfolios(d.portfolios || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [dateStr]);

  const selected = portfolios.find(p => p.key === selectedKey);

  const filtered = filterGroup === 'all'
    ? portfolios
    : portfolios.filter(p => p.group === filterGroup);

  if (loading) return (
    <div className="mp-page fade-in">
      <div className="mp-loading">
        <div className="mp-spinner" />
        <div>Building model portfolios from live fund universe…</div>
      </div>
    </div>
  );

  if (error) return (
    <div className="mp-page fade-in">
      <div className="error-msg">Failed to load model portfolios: {error}</div>
    </div>
  );

  return (
    <div className="mp-page fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="section-title">Model Portfolios</h1>
          <p className="page-desc">
            BugleRock standard model portfolios — built live from the fund universe. Best Sharpe → rating → AUM selected per slice.
          </p>
        </div>
        {selected && (
          <button className="mp-back-btn" onClick={() => setSelectedKey(null)}>← All models</button>
        )}
      </div>

      {!selected && (
        <>
          <RiskSpectrum portfolios={portfolios} selectedKey={selectedKey} onSelect={setSelectedKey} />

          {/* Filter tabs */}
          <div className="mp-filter-tabs">
            {[['all', 'All'], ['risk', 'Risk-based'], ['theme', 'Theme-based']].map(([g, l]) => (
              <button
                key={g}
                className={`mp-filter-tab ${filterGroup === g ? 'active' : ''}`}
                onClick={() => setFilterGroup(g)}
              >
                {l}
              </button>
            ))}
          </div>

          <ComparisonTable portfolios={filtered} selectedKey={selectedKey} onSelect={setSelectedKey} />
        </>
      )}

      {selected && (
        <PortfolioDetail portfolio={selected} onBack={() => setSelectedKey(null)} />
      )}
    </div>
  );
}