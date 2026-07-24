import React, { useState, useEffect, useMemo } from 'react';
import './PeerGroupAnalytics.css';

const API = process.env.REACT_APP_API_URL || '';

const Q_COLORS = {
  1: { bg: '#E6F4ED', text: '#1A7A52', label: 'Q1' },
  2: { bg: '#EBF4E8', text: '#3A7A30', label: 'Q2' },
  3: { bg: '#FBF4E0', text: '#7A5A10', label: 'Q3' },
  4: { bg: '#FDEAEF', text: '#912F63', label: 'Q4' },
};


function fmt(v, suffix = '', prefix = '', dec = 2) {
  if (v == null) return '—';
  const n = parseFloat(v);
  return `${prefix}${n.toFixed(dec)}${suffix}`;
}

function fmtPct(v, showSign = true) {
  if (v == null) return '—';
  const n = parseFloat(v);
  return `${showSign && n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtAum(v) {
  if (!v) return '—';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L Cr`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(0)}k Cr`;
  return `₹${Math.round(v)} Cr`;
}

function ReturnCell({ value, quartile, showQ = false }) {
  if (value == null) return <span className="pga-null">—</span>;
  const n = parseFloat(value);
  const color = n >= 0 ? '#1A7A52' : '#B91C1C';
  const qc = showQ && quartile ? Q_COLORS[quartile] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      {qc && (
        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: qc.bg, color: qc.text }}>
          {qc.label}
        </span>
      )}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color }}>{fmtPct(n)}</span>
    </div>
  );
}

function DistBar({ stats, label }) {
  if (!stats) return null;
  const range = stats.max - stats.min;
  if (range === 0) return null;
  const pos = v => `${((v - stats.min) / range) * 100}%`;
  return (
    <div className="pga-dist-bar">
      <div className="pga-dist-label">{label}</div>
      <div className="pga-dist-track">
        <div className="pga-dist-iqr" style={{ left: pos(stats.p25), width: `${((stats.p75 - stats.p25) / range) * 100}%` }} />
        <div className="pga-dist-median" style={{ left: pos(stats.median) }} title={`Median: ${stats.median?.toFixed(2)}%`} />
        <div className="pga-dist-avg" style={{ left: pos(stats.avg) }} title={`Avg: ${stats.avg?.toFixed(2)}%`} />
      </div>
      <div className="pga-dist-labels">
        <span>{stats.min?.toFixed(1)}%</span>
        <span className="pga-dist-mid">P25: {stats.p25?.toFixed(1)}% · Med: {stats.median?.toFixed(1)}% · P75: {stats.p75?.toFixed(1)}%</span>
        <span>{stats.max?.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div className="pga-stat-chip">
      <div className="pga-stat-value" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      <div className="pga-stat-label">{label}</div>
    </div>
  );
}

const SORT_KEYS = [
  { key: 'peer_rank_1y', label: 'Rank' },
  { key: 'return_1y',    label: '1Y Return' },
  { key: 'return_3y',    label: '3Y CAGR' },
  { key: 'return_5y',    label: '5Y CAGR' },
  { key: 'sharpe_ratio_3y', label: 'Sharpe' },
  { key: 'alpha_3y',    label: 'Alpha' },
  { key: 'fund_size',   label: 'AUM' },
  { key: 'expense_ratio', label: 'ER' },
];

export default function PeerGroupAnalytics({ selectedDate }) {
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [maxEr, setMaxEr] = useState(99);

  // Sort state
  const [sortKey, setSortKey] = useState('peer_rank_1y');
  const [sortDir, setSortDir] = useState('asc');

  const dateStr = selectedDate ? selectedDate.toISOString().split('T')[0] : null;

  // Load category list
  useEffect(() => {
    fetch(`${API}/api/peer/categories`)
      .then(r => r.json())
      .then(d => {
        setCategories(d.groups || []);
        // Auto-select first category
        if (d.groups?.length && d.groups[0].categories?.length) {
          setSelectedCat(d.groups[0].categories[0].label);
        }
      })
      .catch(() => {});
  }, []);

  // Load category data when selection changes
  useEffect(() => {
    if (!selectedCat) return;
    setLoading(true);
    setError(null);
    setData(null);
    setSearch('');
    setMinRating(0);
    setMaxEr(99);
    setSortKey('peer_rank_1y');
    setSortDir('asc');
    const url = `${API}/api/peer/category?category=${encodeURIComponent(selectedCat)}${dateStr ? `&date=${dateStr}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [selectedCat, dateStr]);

  // Filter + sort funds
  const filteredFunds = useMemo(() => {
    if (!data?.funds) return [];
    let funds = data.funds.filter(f => {
      if (search) {
        const q = search.toLowerCase();
        if (!f.name?.toLowerCase().includes(q) && !f.amc?.toLowerCase().includes(q)) return false;
      }
      if (minRating > 0 && (f.morningstar_rating == null || f.morningstar_rating < minRating)) return false;
      if (maxEr < 99 && f.expense_ratio != null && f.expense_ratio > maxEr) return false;
      return true;
    });

    funds.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return funds;
  }, [data, search, minRating, maxEr, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(key === 'expense_ratio' || key === 'peer_rank_1y' ? 'asc' : 'desc');
    }
  }

  function SortTh({ sk, label, align = 'right' }) {
    const active = sortKey === sk;
    return (
      <th className={`pga-th ${active ? 'sorted' : ''}`} style={{ textAlign: align, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => handleSort(sk)}>
        {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    );
  }

  const stats = data?.stats;
  const dist  = data?.distribution;
  const filtersActive = search || minRating > 0 || maxEr < 99;

  return (
    <div className="pga-page fade-in">
      <div className="page-header">
        <h1 className="section-title">Peer Group Analytics</h1>
        <p className="page-desc">Full peer distribution — see where any fund sits within its category.</p>
      </div>

      <div className="pga-layout">
        {/* Left: category sidebar */}
        <div className="pga-sidebar card">
          {categories.map(grp => (
            <div key={grp.group} className="pga-group">
              <div className="pga-group-label">{grp.group}</div>
              {grp.categories.map(c => (
                <button
                  key={c.label}
                  className={`pga-cat-btn ${selectedCat === c.label ? 'active' : ''}`}
                  onClick={() => setSelectedCat(c.label)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right: content */}
        <div className="pga-content">
          {loading && (
            <div className="pga-loading">
              <div className="mp-spinner" />
              <div>Loading {selectedCat} peer group…</div>
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          {data && !loading && (
            <>
              {/* Category header */}
              <div className="card pga-header-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div className="pga-cat-title">{data.category}</div>
                      <span className="pga-fund-count">{stats?.fund_count} funds</span>
                      {filtersActive && <span className="pga-fund-count" style={{ background: 'rgba(145,47,99,.1)', color: 'var(--brand-primary)' }}>{filteredFunds.length} shown</span>}
                    </div>
                    <div className="pga-desc">{data.description}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Data: {data.data_date}</div>
                </div>

                {/* Peer stats */}
                <div className="pga-stats-row">
                  <StatChip label="Avg 1Y" value={stats?.avg_return_1y != null ? fmtPct(stats.avg_return_1y) : '—'} color={stats?.avg_return_1y >= 0 ? '#1A7A52' : '#B91C1C'} />
                  <StatChip label="Avg 3Y CAGR" value={stats?.avg_return_3y != null ? fmtPct(stats.avg_return_3y) : '—'} color={stats?.avg_return_3y >= 0 ? '#1A7A52' : '#B91C1C'} />
                  <StatChip label="Avg Sharpe" value={fmt(stats?.avg_sharpe)} />
                  <StatChip label="Avg ER" value={stats?.avg_er != null ? `${stats.avg_er.toFixed(2)}%` : '—'} />
                  <StatChip label="Avg AUM" value={fmtAum(stats?.avg_aum)} />
                </div>

                {/* Distribution bars */}
                {dist && (
                  <div className="pga-dist-section">
                    <div className="mp-section-label" style={{ marginBottom: 8 }}>Peer distribution</div>
                    <DistBar stats={dist.return_1y}       label="1Y Return" />
                    <DistBar stats={dist.return_3y}       label="3Y CAGR" />
                    <DistBar stats={dist.sharpe_ratio_3y} label="Sharpe (3Y)" />
                  </div>
                )}
              </div>

              {/* Filter bar */}
              <div className="card pga-filter-bar">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <input
                      type="text"
                      placeholder="Search fund or AMC…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pga-search"
                    />
                    <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                  </div>
                  <select className="pga-select" value={minRating} onChange={e => setMinRating(Number(e.target.value))}>
                    <option value={0}>Any rating</option>
                    <option value={3}>3★ and above</option>
                    <option value={4}>4★ and above</option>
                    <option value={5}>5★ only</option>
                  </select>
                  <select className="pga-select" value={maxEr} onChange={e => setMaxEr(Number(e.target.value))}>
                    <option value={99}>Any ER</option>
                    <option value={1}>ER ≤ 1%</option>
                    <option value={1.5}>ER ≤ 1.5%</option>
                    <option value={2}>ER ≤ 2%</option>
                  </select>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                    Sort:
                    {SORT_KEYS.map(s => (
                      <button key={s.key} className={`pga-sort-btn ${sortKey === s.key ? 'active' : ''}`} onClick={() => handleSort(s.key)}>{s.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fund table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="pga-table">
                    <thead>
                      <tr>
                        <SortTh sk="peer_rank_1y" label="#" align="center" />
                        <th className="pga-th" style={{ textAlign: 'left' }}>Fund</th>
                        <th className="pga-th" style={{ textAlign: 'center' }}>BR Rank</th>
                        <SortTh sk="return_1y"    label="1Y" />
                        <SortTh sk="return_3y"    label="3Y" />
                        <SortTh sk="return_5y"    label="5Y" />
                        <SortTh sk="sharpe_ratio_3y" label="Sharpe" />
                        <SortTh sk="alpha_3y"     label="Alpha" />
                        <SortTh sk="std_dev_3y"   label="Std Dev" />
                        <SortTh sk="expense_ratio" label="ER" />
                        <SortTh sk="fund_size"    label="AUM" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFunds.length === 0 ? (
                        <tr>
                          <td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
                            No funds match the current filters.
                          </td>
                        </tr>
                      ) : filteredFunds.map((f, i) => {
                        const qc = Q_COLORS[f.quartile_1y] || Q_COLORS[4];
                        return (
                          <tr key={f.isin} className="pga-tr">
                            <td className="pga-td" style={{ textAlign: 'center' }}>
                              <span className="pga-rank-pill" style={{ background: qc.bg, color: qc.text }}>
                                {f.peer_rank_1y}
                              </span>
                            </td>
                            <td className="pga-td">
                              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', marginBottom: 1 }}>{f.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {f.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}
                              </div>
                            </td>
                            <td className="pga-td" style={{ textAlign: 'center' }}>
                              {f.ranking
                                ? <span className={`pga-br-rank pga-br-${f.ranking}`}>{f.ranking}</span>
                                : <span className="pga-null">—</span>}
                            </td>
                            <td className="pga-td">
                              <ReturnCell value={f.return_1y} quartile={f.quartile_1y} showQ />
                            </td>
                            <td className="pga-td">
                              <ReturnCell value={f.return_3y} />
                            </td>
                            <td className="pga-td">
                              <ReturnCell value={f.return_5y} />
                            </td>
                            <td className="pga-td pga-num">{fmt(f.sharpe_ratio_3y)}</td>
                            <td className="pga-td pga-num" style={{ color: f.alpha_3y >= 0 ? '#1A7A52' : '#B91C1C' }}>
                              {fmtPct(f.alpha_3y)}
                            </td>
                            <td className="pga-td pga-num">{fmt(f.std_dev_3y, '%', '', 1)}</td>
                            <td className="pga-td pga-num">{f.expense_ratio != null ? `${f.expense_ratio.toFixed(2)}%` : '—'}</td>
                            <td className="pga-td pga-num" style={{ fontSize: 11 }}>{fmtAum(f.fund_size)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredFunds.length > 0 && (
                  <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                    Quartile (Q1–Q4) based on 1Y return rank within category · Data as of {data.data_date}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}