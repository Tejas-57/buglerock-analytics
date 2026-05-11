import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import './Simulator.css';

function fmt(v, prefix = '', suffix = '') {
  if (v == null) return '—';
  return `${prefix}${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
}

function ResultCard({ label, value, sub }) {
  return (
    <div className="result-card card">
      <div className="result-label">{label}</div>
      <div className="result-value">{value}</div>
      {sub && <div className="result-sub">{sub}</div>}
    </div>
  );
}

export default function Simulator({ selectedFund }) {
  const [mode, setMode] = useState('lumpsum');
  const [amount, setAmount] = useState('100000');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sipDate, setSipDate] = useState('1');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleGo = () => {
    if (!selectedFund || !amount || !startDate || !endDate) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const params = new URLSearchParams({
      amfi_code: selectedFund.amfi_code,
      mode,
      amount,
      start_date: startDate,
      end_date: endDate,
      ...(mode === 'sip' ? { sip_date: sipDate } : {}),
    });

    fetch(`/api/simulator/run?${params}`)
      .then(r => r.json())
      .then(d => { setResult(d); setLoading(false); })
      .catch(() => { setError('Simulation failed. Please check inputs.'); setLoading(false); });
  };

  const canGo = selectedFund && amount && startDate && endDate;

  if (!selectedFund) {
    return (
      <div className="simulator-page fade-in">
        <div className="page-header">
          <h1 className="section-title">Simulator</h1>
          <p className="page-desc">Backtest SIP or Lumpsum investment using historical NAV data.</p>
        </div>
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <p>No fund selected. Please select a fund from the Home tab.</p>
          <button className="btn-primary" style={{ marginTop: '16px' }} onClick={() => navigate('/home')}>
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="simulator-page fade-in">
      <div className="page-header">
        <h1 className="section-title">Simulator</h1>
        <p className="page-desc">
          Simulating: <span style={{ color: 'var(--gold)' }}>{selectedFund.name}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{selectedFund.category}</span>
        </p>
      </div>

      <div className="card sim-inputs">
        <div className="section-subtitle">Simulation Parameters</div>
        <div className="sim-form">
          <div className="input-group">
            <label className="input-label">Investment Type</label>
            <div className="mode-toggle">
              <button className={`mode-btn ${mode === 'lumpsum' ? 'active' : ''}`} onClick={() => setMode('lumpsum')}>Lumpsum</button>
              <button className={`mode-btn ${mode === 'sip' ? 'active' : ''}`} onClick={() => setMode('sip')}>SIP</button>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">{mode === 'sip' ? 'Monthly SIP Amount (₹)' : 'Investment Amount (₹)'}</label>
            <input
              type="number"
              className="input-field"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 100000"
              min="1"
            />
          </div>

          {mode === 'sip' && (
            <div className="input-group">
              <label className="input-label">SIP Date (day of month)</label>
              <select className="input-field" value={sipDate} onChange={e => setSipDate(e.target.value)}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

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
              {loading ? 'Simulating…' : 'GO'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {result?.warning && <div className="warning-msg">⚠ {result.warning}</div>}

      {result && !loading && (
        <div className="sim-results fade-in">
          <div className="results-grid">
            <ResultCard label="Total Invested" value={fmt(result.total_invested, '₹')} />
            <ResultCard
              label="Current Value"
              value={fmt(result.current_value, '₹')}
              sub={result.current_value > result.total_invested ? '▲ Profit' : '▼ Loss'}
            />
            <ResultCard label="Absolute Return" value={fmt(result.absolute_return, '', '%')} />
            <ResultCard
              label={mode === 'sip' ? 'XIRR' : 'CAGR'}
              value={fmt(result.cagr_or_xirr, '', '%')}
              sub={mode === 'sip' ? 'Annualised Return' : 'Compound Annual Growth'}
            />
            {mode === 'sip' && (
              <ResultCard label="Total Instalments" value={result.total_instalments} />
            )}
            <ResultCard
              label="Investment Period"
              value={`${result.years?.toFixed(1)} yrs`}
              sub={`${result.start_date} to ${result.end_date}`}
            />
          </div>

          {result.chart_data?.length > 0 && (
            <div className="card">
              <div className="section-subtitle">Portfolio Growth</div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={result.chart_data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={65} />
                  <Tooltip
                    formatter={(v, n) => [`₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, n]}
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: '6px', fontSize: '12px' }}
                    labelStyle={{ color: 'var(--text-muted)', marginBottom: '4px' }}
                  />
                  <Legend formatter={v => <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{v}</span>} />
                  <Line type="monotone" dataKey="portfolio_value" name="Portfolio Value" stroke="var(--gold-primary)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="invested_value" name="Invested Amount" stroke="#60A5FA" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}