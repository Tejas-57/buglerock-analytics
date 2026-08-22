import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import './Simulator.css';

const API = process.env.REACT_APP_API_URL || '';
const LS  = 'sim_cache_v1';

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

function FundSearchBar({ selectedDate, onSelect }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);

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
      fetch(`${API}/api/funds/search?q=${encodeURIComponent(query.trim())}&date=${dateStr}`)
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

export default function Simulator({ selectedDate }) {
  // ── Restore from localStorage on mount ───────────────────────────────────
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();

  const [fund, setFund]           = useState(saved.fund      || null);
  const [mode, setMode]           = useState(saved.mode      || 'lumpsum');
  const [amount, setAmount]       = useState(saved.amount    || '100000');
  const [startDate, setStartDate] = useState(saved.startDate || '');
  const [endDate, setEndDate]     = useState(saved.endDate   || '');
  const [sipDate, setSipDate]     = useState(saved.sipDate   || '1');
  const [result, setResult]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  // ── Persist inputs to localStorage on every change ───────────────────────
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ fund, mode, amount, startDate, endDate, sipDate })); }
    catch {}
  }, [fund, mode, amount, startDate, endDate, sipDate]);

  const runSimulation = useCallback((f, m, amt, sd, ed, sipD) => {
    if (!f || !amt || !sd || !ed) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const params = new URLSearchParams({
      amfi_code: f.amfi_code,
      mode: m,
      amount: amt,
      start_date: sd,
      end_date: ed,
      ...(m === 'sip' ? { sip_date: sipD } : {}),
    });

    fetch(`${API}/api/simulator/run?${params}`)
      .then(r => r.json())
      .then(d => { setResult(d); setLoading(false); })
      .catch(() => { setError('Simulation failed. Please check inputs.'); setLoading(false); });
  }, []);

  // ── Auto re-run on mount if complete saved inputs exist ───────────────────
  useEffect(() => {
    if (saved.fund && saved.startDate && saved.endDate && saved.amount) {
      runSimulation(saved.fund, saved.mode || 'lumpsum', saved.amount, saved.startDate, saved.endDate, saved.sipDate || '1');
    }
  }, []); // run once on mount

  const handleGo = () => runSimulation(fund, mode, amount, startDate, endDate, sipDate);

  const canGo = fund && amount && startDate && endDate;

  return (
    <div className="simulator-page fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="section-title">Simulator</h1>
          <p className="page-desc">Backtest SIP or Lumpsum investment using historical NAV data.</p>
        </div>
        <FundSearchBar selectedDate={selectedDate} onSelect={f => { setFund(f); setResult(null); setError(null); }} />
      </div>

      {fund && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 14px', background: 'rgba(145,47,99,0.05)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{fund.name}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fund.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</span>
          <button
            onClick={() => { setFund(null); setResult(null); setError(null); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            title="Clear fund"
          >×</button>
        </div>
      )}

      {!fund && (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <p>Search for a fund above to begin.</p>
        </div>
      )}

      {fund && (
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
      )}

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