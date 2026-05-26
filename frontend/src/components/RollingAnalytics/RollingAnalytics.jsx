import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import './RollingAnalytics.css';

const ROLLING_PERIODS = [
  { label: '1 Year', value: 1 },
  { label: '3 Years', value: 3 },
  { label: '5 Years', value: 5 },
];

function StatCard({ label, value, suffix = '%' }) {
  if (value === null || value === undefined) return (
    <div className="stat-card card"><div className="stat-label">{label}</div><div className="value-na">—</div></div>
  );
  const n = parseFloat(value);
  return (
    <div className="stat-card card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${n > 0 ? 'value-positive' : n < 0 ? 'value-negative' : ''}`}>
        {n > 0 && suffix === '%' ? '+' : ''}{n.toFixed(2)}{suffix}
      </div>
    </div>
  );
}

export default function RollingAnalytics({ selectedFund }) {
  const [rollingYears, setRollingYears] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [validationMsg, setValidationMsg] = useState(null);

  const handleGo = () => {
    if (!selectedFund || !startDate || !endDate) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setResult(null);
    setValidationMsg(null);

    const params = new URLSearchParams({
      amfi_code: selectedFund.amfi_code,
      rolling_years: rollingYears,
      start_date: startDate,
      end_date: endDate,
    });

    fetch(`${process.env.REACT_APP_API_URL || ''}/api/rolling/analysis?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === 'insufficient_data') {
          setValidationMsg(d.message);
        } else {
          setResult(d);
        }
        setLoading(false);
      })
      .catch(() => { setError('Analysis failed. Please check inputs.'); setLoading(false); });
  };

  const canGo = selectedFund && startDate && endDate;

  return (
    <div className="rolling-page fade-in">
      <div className="page-header">
        <h1 className="section-title">Rolling Average Analytics</h1>
        <p className="page-desc">Analyse rolling CAGR distribution using daily historical NAV data.</p>
      </div>

      {!selectedFund && (
        <div className="empty-state">
          <p>No fund selected. Please select a fund from the Home tab.</p>
          <button className="btn-primary" style={{ marginTop: '16px' }} onClick={() => navigate('/home')}>
            Go to Home
          </button>
        </div>
      )}

      {selectedFund && (
        <div className="card rolling-inputs">
          <div className="section-subtitle">Analysis Parameters</div>
          <div className="rolling-form">
            <div className="input-group">
              <label className="input-label">Rolling Period</label>
              <div className="period-toggle">
                {ROLLING_PERIODS.map(p => (
                  <button
                    key={p.value}
                    className={`mode-btn ${rollingYears === p.value ? 'active' : ''}`}
                    onClick={() => setRollingYears(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="period-hint">
                Min range required: {rollingYears * 2} years ({rollingYears * 2 * 252} trading days)
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Start Date</label>
              <input type="date" className="input-field" value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate || new Date().toISOString().split('T')[0]} />
            </div>

            <div className="input-group">
              <label className="input-label">End Date</label>
              <input type="date" className="input-field" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} max={new Date().toISOString().split('T')[0]} />
            </div>

            <div className="input-group go-group">
              <button className="btn-primary" onClick={handleGo} disabled={!canGo || loading}>
                {loading ? 'Calculating…' : 'GO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {validationMsg && (
        <div className="validation-msg card">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <div className="validation-title">Date Range Insufficient</div>
            <div className="validation-body">{validationMsg}</div>
          </div>
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}
      {warning && <div className="warning-msg">⚠ {warning}</div>}

      {result && !loading && (
        <div className="rolling-results fade-in">
          <div className="rolling-summary">
            <div className="summary-header">
              <div>
                <div className="section-subtitle" style={{ margin: 0 }}>
                  {rollingYears}Y Rolling CAGR — {result.total_points} daily data points
                </div>
                <div className="summary-range">{startDate} to {endDate}</div>
              </div>
            </div>
          </div>

          {/* Stat cards */}
          <div className="stats-grid">
            <StatCard label="Average Rolling CAGR" value={result.stats?.avg_cagr} />
            <StatCard label="Median Rolling CAGR" value={result.stats?.median_cagr} />
            <StatCard label="Best Period CAGR" value={result.stats?.best_cagr} />
            <StatCard label="Worst Period CAGR" value={result.stats?.worst_cagr} />
            <StatCard label="% Periods Positive" value={result.stats?.pct_positive} />
            <StatCard label="% Periods > 12%" value={result.stats?.pct_above_12} />
            <StatCard label="Std Dev of CAGR" value={result.stats?.std_dev_cagr} />
            <StatCard label="Total Data Points" value={result.total_points} suffix="" />
          </div>

          {/* Rolling CAGR chart */}
          {result.chart_data?.length > 0 && (
            <div className="card">
              <div className="section-subtitle">Daily Rolling {rollingYears}Y CAGR</div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={result.chart_data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip
                    formatter={(v) => [`${parseFloat(v).toFixed(2)}%`, `${rollingYears}Y CAGR`]}
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '6px', fontSize: '12px' }}
                    labelStyle={{ color: 'var(--text-muted)', marginBottom: '4px' }}
                  />
                  <ReferenceLine y={0} stroke="var(--border-light)" strokeDasharray="4 2" />
                  <ReferenceLine y={12} stroke="var(--gold-dim)" strokeDasharray="4 2" label={{ value: '12%', position: 'right', fill: 'var(--gold-dim)', fontSize: 10 }} />
                  <Line type="monotone" dataKey="cagr" name={`${rollingYears}Y CAGR`} stroke="var(--gold-primary)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}