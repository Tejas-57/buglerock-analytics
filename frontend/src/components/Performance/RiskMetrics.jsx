import React from 'react';
import './RiskMetrics.css';

const RISK_METRICS = [
  { key: 'std_dev',          label: 'Std Deviation',      desc: 'Volatility of returns',            suffix: '%' },
  { key: 'alpha',            label: 'Alpha',               desc: 'Excess return vs benchmark',       suffix: '' },
  { key: 'beta',             label: 'Beta',                desc: 'Market sensitivity',               suffix: '' },
  { key: 'sharpe_ratio',     label: 'Sharpe Ratio',        desc: 'Return per unit of risk',          suffix: '' },
  { key: 'sortino_ratio',    label: 'Sortino Ratio',       desc: 'Return per unit of downside risk', suffix: '' },
  { key: 'treynor_ratio',    label: 'Treynor Ratio',       desc: 'Return per unit of market risk',   suffix: '' },
  { key: 'information_ratio',label: 'Information Ratio',   desc: 'Consistency of outperformance',    suffix: '' },
  { key: 'up_capture',       label: 'Up Capture',          desc: 'Gain in up markets',               suffix: '%' },
  { key: 'down_capture',     label: 'Down Capture',        desc: 'Loss in down markets',             suffix: '%' },
];

function MetricCard({ label, desc, fundVal, bmVal, peerVal, suffix }) {
  const fmt = (v) => {
    if (v === null || v === undefined || v === '-') return '—';
    return `${parseFloat(v).toFixed(2)}${suffix}`;
  };

  const isMissing = (v) => v === null || v === undefined || v === '-';

  return (
    <div className="risk-card card">
      <div className="risk-label">{label}</div>
      <div className="risk-desc">{desc}</div>
      <div className="risk-values">
        <div className="risk-col">
          <div className="risk-col-label">Fund</div>
          <div className={`risk-value ${isMissing(fundVal) ? 'value-na' : ''}`}>
            {fmt(fundVal)}
          </div>
        </div>
        <div className="risk-divider" />
        <div className="risk-col">
          <div className="risk-col-label">Benchmark</div>
          <div className={`risk-value ${isMissing(bmVal) ? 'value-na' : ''}`}>
            {fmt(bmVal)}
          </div>
        </div>
        <div className="risk-divider" />
        <div className="risk-col">
          <div className="risk-col-label">Peer Avg</div>
          <div className={`risk-value ${isMissing(peerVal) ? 'value-na' : ''}`}>
            {fmt(peerVal)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RiskMetrics({ data }) {
  if (!data) return null;
  const { fund, benchmark, peer_avg } = data;

  return (
    <div className="risk-section">
      <div className="section-subtitle" style={{ marginBottom: 16 }}>Risk Metrics (3 Year)</div>
      <div className="risk-grid">
        {RISK_METRICS.map(({ key, label, desc, suffix }) => (
          <MetricCard
            key={key}
            label={label}
            desc={desc}
            suffix={suffix}
            fundVal={fund?.risk?.[key]}
            bmVal={benchmark?.risk?.[key]}
            peerVal={peer_avg?.risk?.[key]}
          />
        ))}
      </div>
    </div>
  );
}
