import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import './NAVLineChart.css';

const PERIODS = [
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: '3Y', value: '3y' },
  { label: '5Y', value: '5y' },
  { label: '10Y', value: '10y' },
];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-date">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="tt-row">
          <span className="tt-dot" style={{ background: p.color }} />
          <span className="tt-name">{p.name}</span>
          <span className="tt-val">{p.value?.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export default function NAVLineChart({ fund, selectedDate }) {
  const [period, setPeriod] = useState('1y');
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [benchmarkName, setBenchmarkName] = useState(null);

  useEffect(() => {
    if (!fund?.amfi_code) return;
    setLoading(true);
    setWarning(null);
    setError(null);
    setPerformance(null);
    const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;
    const params = new URLSearchParams({
      amfi_code: fund.amfi_code,
      period,
      ...(fund.assetClass && { asset_class: fund.assetClass }),
      ...(fund.category   && { category: fund.category }),
      ...(dateStr         && { date: dateStr }),
    });
    fetch(`/api/performance/nav-chart?${params}`)
      .then(r => r.json())
      .then(d => {
        setChartData(d.data || []);
        setWarning(d.warning || null);
        setPerformance(d.performance || null);
        setBenchmarkName(d.benchmark_name || null);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load chart data.'); setLoading(false); });
  }, [fund, period]);

  const formatYAxis = (v) => `₹${Number(v).toFixed(0)}`;

  const formatXAxis = (d) => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    const periodDays = { '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 1095, '5y': 1825, '10y': 3650 };
    const days = periodDays[period] || 365;
    if (days <= 90) return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    if (days <= 365) return dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  };

  const getXAxisInterval = () => {
    if (!chartData.length) return 'preserveStartEnd';
    const periodDays = { '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 1095, '5y': 1825, '10y': 3650 };
    const days = periodDays[period] || 365;
    const n = chartData.length;
    if (days <= 30)  return Math.floor(n / 6);
    if (days <= 90)  return Math.floor(n / 6);
    if (days <= 180) return Math.floor(n / 5);
    if (days <= 365) return Math.floor(n / 6);
    if (days <= 1095) return Math.floor(n / 6);
    return Math.floor(n / 7);
  };

  const getYDomain = () => {
    if (!chartData.length) return ['auto', 'auto'];
    const allVals = chartData.flatMap(d => [d.fund_nav, d.benchmark_nav].filter(v => v != null));
    if (!allVals.length) return ['auto', 'auto'];
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const pad = (max - min) * 0.05;
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  };

  return (
    <div className="card nav-chart-card">
      <div className="chart-header">
        <div className="section-subtitle" style={{ margin: 0 }}>NAV Performance vs Benchmark</div>
        <div className="period-tabs">
          {PERIODS.map(p => (
            <button
              key={p.value}
              className={`period-tab ${period === p.value ? 'active' : ''}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {performance && !loading && (
        <div className="perf-banner">
          <span className="perf-item">
            <span className="perf-label">Start NAV</span>
            <span className="perf-value">₹{performance.start_nav}</span>
          </span>
          <span className="perf-arrow">→</span>
          <span className="perf-item">
            <span className="perf-label">End NAV</span>
            <span className="perf-value">₹{performance.end_nav}</span>
          </span>
          <span className="perf-divider" />
          <span className="perf-item">
            <span className="perf-label">Return</span>
            <span className={"perf-return " + (performance.absolute_return >= 0 ? "positive" : "negative")}>
              {performance.absolute_return >= 0 ? "+" : ""}{performance.absolute_return}%
              {performance.cagr !== null && (
                <span className="perf-cagr"> ({performance.cagr >= 0 ? "+" : ""}{performance.cagr}% CAGR)</span>
              )}
            </span>
          </span>
        </div>
      )}

      {benchmarkName && (
        <div style={{fontSize:'10px', color:'var(--text-muted)', marginBottom:'6px', fontStyle:'italic'}}>
          * Benchmark shows Price Return (PR) from Yahoo Finance. Morningstar uses Total Return (TR) which includes dividends — actual benchmark may differ slightly.
        </div>
      )}

      {warning && (
        <div className="chart-warning">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {warning}
        </div>
      )}

      {loading && (
        <div className="chart-loading">
          <div className="loading-shimmer" style={{ height: '300px', borderRadius: '8px' }} />
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}

      {!loading && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              interval={getXAxisInterval()}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={75}
              domain={getYDomain()}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: '12px' }}
              formatter={(v) => <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{v}</span>}
            />
            <Line
              type="monotone"
              dataKey="fund_nav"
              name={fund?.name || 'Fund'}
              stroke="var(--gold-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--gold-primary)' }}
            />
            <Line
              type="monotone"
              dataKey="benchmark_nav"
              name={benchmarkName || 'Benchmark'}
              stroke="#60A5FA"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
              activeDot={{ r: 3, fill: '#60A5FA' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {!loading && chartData.length === 0 && !error && (
        <div className="no-data-sm" style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          No chart data available for this period
        </div>
      )}
    </div>
  );
}