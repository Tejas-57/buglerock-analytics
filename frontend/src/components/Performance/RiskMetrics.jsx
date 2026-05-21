import React, { useState } from 'react';
import './RiskMetrics.css';

const RISK_METRICS = [
  { key: 'std_dev',          label: 'Std Deviation',    desc: 'Volatility of returns',            suffix: '%' },
  { key: 'alpha',            label: 'Alpha',             desc: 'Excess return vs benchmark',       suffix: '' },
  { key: 'beta',             label: 'Beta',              desc: 'Market sensitivity',               suffix: '' },
  { key: 'sharpe_ratio',     label: 'Sharpe Ratio',      desc: 'Return per unit of risk',          suffix: '' },
  { key: 'sortino_ratio',    label: 'Sortino Ratio',     desc: 'Return per unit of downside risk', suffix: '' },
  { key: 'treynor_ratio',    label: 'Treynor Ratio',     desc: 'Return per unit of market risk',   suffix: '' },
  { key: 'information_ratio',label: 'Information Ratio', desc: 'Consistency of outperformance',    suffix: '' },
  { key: 'up_capture',       label: 'Up Capture',        desc: 'Gain in up markets',               suffix: '%' },
  { key: 'down_capture',     label: 'Down Capture',      desc: 'Loss in down markets',             suffix: '%' },
];

function MetricCard({ label, desc, fundVal, peerVal, suffix }) {
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
          <div className={`risk-value ${isMissing(fundVal) ? 'value-na' : ''}`}>{fmt(fundVal)}</div>
        </div>
        <div className="risk-divider" />
        <div className="risk-col">
          <div className="risk-col-label">Peer Avg</div>
          <div className={`risk-value ${isMissing(peerVal) ? 'value-na' : ''}`}>{fmt(peerVal)}</div>
        </div>
      </div>
    </div>
  );
}

export default function RiskMetrics({ data }) {
  const [tf, setTf] = useState('3y');
  if (!data) return null;
  const { fund, peer_avg } = data;

  return (
    <div className="risk-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="section-subtitle" style={{ margin: 0 }}>Risk Metrics</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['3y', '5y'].map(t => (
            <button
              key={t}
              onClick={() => setTf(t)}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: '1px solid',
                borderColor: tf === t ? 'var(--brand-primary)' : 'var(--border)',
                background: tf === t ? 'var(--brand-primary)' : 'transparent',
                color: tf === t ? '#fff' : 'var(--text-muted)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: '0.05em',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="risk-grid">
        {RISK_METRICS.map(({ key, label, desc, suffix }) => (
          <MetricCard
            key={key}
            label={label}
            desc={desc}
            suffix={suffix}
            fundVal={fund?.risk?.[`${key}_${tf}`]}
            peerVal={peer_avg?.risk?.[`${key}_${tf}`]}
          />
        ))}
      </div>
    </div>
  );
}