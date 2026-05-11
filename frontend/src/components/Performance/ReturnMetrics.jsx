import React from 'react';
import './ReturnMetrics.css';

const RETURN_PERIODS = [
  { key: '1d',    label: '1 Day' },
  { key: '1w',    label: '1 Week' },
  { key: '1m',    label: '1 Month' },
  { key: '3m',    label: '3 Months' },
  { key: '6m',    label: '6 Months' },
  { key: '1y',    label: '1 Year' },
  { key: '2y',    label: '2 Years' },
  { key: '3y',    label: '3 Years' },
  { key: '5y',    label: '5 Years' },
  { key: '7y',    label: '7 Years' },
  { key: '10y',   label: '10 Years' },
  { key: 'ytd',   label: 'YTD' },
  { key: 'cy2025', label: 'CY 2025' },
  { key: 'cy2024', label: 'CY 2024' },
  { key: 'cy2023', label: 'CY 2023' },
  { key: 'cy2022', label: 'CY 2022' },
  { key: 'cy2021', label: 'CY 2021' },
];

function ReturnCell({ value }) {
  if (value === null || value === undefined || value === '-') {
    return <td className="value-na">—</td>;
  }
  const num = parseFloat(value);
  const cls = num > 0 ? 'value-positive' : num < 0 ? 'value-negative' : '';
  return (
    <td className={cls}>
      {num > 0 ? '+' : ''}{num.toFixed(2)}%
    </td>
  );
}

export default function ReturnMetrics({ data, assetClass }) {
  if (!data) return null;
  const { fund, benchmark, peer_avg } = data;

  return (
    <div className="card">
      <div className="section-subtitle">Return Metrics</div>
      {benchmark?.name && (
        <div className="benchmark-tag tag" style={{ marginBottom: 16 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
          </svg>
          Benchmark: {benchmark.name}
        </div>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Fund</th>
              <th>Benchmark</th>
              <th>Peer Avg</th>
              <th>Outperformance</th>
            </tr>
          </thead>
          <tbody>
            {RETURN_PERIODS.map(({ key, label }) => {
              const fundVal = fund?.returns?.[key];
              const bmVal   = benchmark?.returns?.[key];
              const peerVal = peer_avg?.returns?.[key];
              const outperf = (fundVal != null && fundVal !== '-' && bmVal != null && bmVal !== '-')
                ? (parseFloat(fundVal) - parseFloat(bmVal)).toFixed(2)
                : null;
              return (
                <tr key={key}>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{label}</td>
                  <ReturnCell value={fundVal} />
                  <ReturnCell value={bmVal} />
                  <ReturnCell value={peerVal} />
                  <td>
                    {outperf !== null ? (
                      <span className={parseFloat(outperf) >= 0 ? 'value-positive' : 'value-negative'}>
                        {parseFloat(outperf) >= 0 ? '+' : ''}{outperf}%
                      </span>
                    ) : <span className="value-na">—</span>}
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
