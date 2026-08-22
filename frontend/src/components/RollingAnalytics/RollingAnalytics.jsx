import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import './RollingAnalytics.css';

const API = process.env.REACT_APP_API_URL || '';
const LS  = 'rolling_cache_v1';

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

function FundSearchBar({ selectedDate, onSelect }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);

  const dateStr = selectedDate
    ? selectedDate.toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/search?q=${encodeURIComponent(query.trim())}&date=${dateStr}`)
        .then(r => r.json())
        .then(d => {
          setResults(d.funds || []);
          setOpen(true);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, dateStr]);

  const handleSelect = (fund) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(fund);
  };

  return (
    <div
      style={{ position: 'relative', width: 360 }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
    >
      <input
        type="text"
        placeholder="Search any fund, AMC or ISIN..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        style={{
          padding: '8px 12px 8px 34px', borderRadius: 8,
          border: '1px solid var(--border)', fontSize: 12, width: '100%',
          outline: 'none', background: '#fff', color: 'var(--text-primary)',
          boxSizing: 'border-box',
        }}
      />
      <svg
        style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      >
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      {loading && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-muted)' }}>...</span>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0,
          width: 'min(420px, calc(100vw - var(--nav-width) - 48px))',
          maxHeight: '60vh',
          overflowY: 'auto', background: '#fff', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000, marginTop: 4,
        }}>
          {results.map((fund, idx) => (
            <div
              key={fund.isin || fund.amfi_code || `s-${idx}`}
              tabIndex={0}
              onClick={() => handleSelect(fund)}
              onKeyDown={e => e.key === 'Enter' && handleSelect(fund)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                borderBottom: idx < results.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer', transition: 'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fund.name}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: 'var(--brand-mid)', background: 'rgba(109,84,121,0.08)', padding: '1px 5px', borderRadius: 3 }}>
                    {['Cat: India Fund Sector - Precious Metals-Gold','Cat: India Fund Sector - Precious Metals-Silver','India Fund Sector - Precious Metals','India ETF Sector - Precious Metals'].includes(fund.category)
                      ? 'Precious Metals'
                      : fund.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}
                  </span>
                </div>
              </div>
              {fund.ranking && fund.ranking !== '-' && fund.ranking !== '0' && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(16,185,129,0.1)', color: '#059669' }}>
                  {fund.ranking}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RollingAnalytics({ selectedDate }) {
  // ── Restore from localStorage on mount ───────────────────────────────────
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();

  const [fund, setFund]                   = useState(saved.fund         || null);
  const [rollingYears, setRollingYears]   = useState(saved.rollingYears || 1);
  const [startDate, setStartDate]         = useState(saved.startDate    || '');
  const [endDate, setEndDate]             = useState(saved.endDate      || '');
  const [result, setResult]               = useState(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [validationMsg, setValidationMsg] = useState(null);

  // ── Persist inputs to localStorage on every change ───────────────────────
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ fund, rollingYears, startDate, endDate })); }
    catch {}
  }, [fund, rollingYears, startDate, endDate]);

  const runAnalysis = useCallback((f, ry, sd, ed) => {
    if (!f || !sd || !ed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setValidationMsg(null);

    const params = new URLSearchParams({
      amfi_code: f.amfi_code,
      rolling_years: ry,
      start_date: sd,
      end_date: ed,
    });

    fetch(`${API}/api/rolling/analysis?${params}`)
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
  }, []);

  // ── Auto re-run on mount if complete saved inputs exist ───────────────────
  useEffect(() => {
    if (saved.fund && saved.startDate && saved.endDate) {
      runAnalysis(saved.fund, saved.rollingYears || 1, saved.startDate, saved.endDate);
    }
  }, []); // run once on mount

  const handleGo = () => runAnalysis(fund, rollingYears, startDate, endDate);

  const canGo = fund && startDate && endDate;

  return (
    <div className="rolling-page fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="section-title">Rolling Average Analytics</h1>
          <p className="page-desc">Analyse rolling CAGR distribution using daily historical NAV data.</p>
        </div>
        <FundSearchBar selectedDate={selectedDate} onSelect={f => { setFund(f); setResult(null); setError(null); setValidationMsg(null); }} />
      </div>

      {fund && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 14px', background: 'rgba(145,47,99,0.05)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2">
            <path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{fund.name}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fund.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</span>
          <button
            onClick={() => { setFund(null); setResult(null); setError(null); setValidationMsg(null); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            title="Clear fund"
          >×</button>
        </div>
      )}

      {!fund && (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/>
            </svg>
          </div>
          <p>Search for a fund above to begin.</p>
        </div>
      )}

      {fund && (
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