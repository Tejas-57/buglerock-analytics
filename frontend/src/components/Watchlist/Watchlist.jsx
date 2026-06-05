import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API = process.env.REACT_APP_API_URL || '';

// ── Watchlist storage — keyed by userId for future multi-user support ─────────
const USER_ID = 'default'; // will be replaced with real userId when auth is built
const STORAGE_KEY = `watchlist_${USER_ID}`;

export function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
export function saveWatchlist(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}
export function addToWatchlist(fund) {
  const list = loadWatchlist();
  if (!list.find(f => f.isin === fund.isin)) {
    saveWatchlist([...list, fund]);
    return true;
  }
  return false; // already exists
}
export function removeFromWatchlist(isin) {
  saveWatchlist(loadWatchlist().filter(f => f.isin !== isin));
}
export function isInWatchlist(isin) {
  return loadWatchlist().some(f => f.isin === isin);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v, d = 2) {
  if (v == null || v === '-') return '—';
  return parseFloat(v).toFixed(d);
}
function pct(v) {
  if (v == null || v === '-') return '—';
  const n = parseFloat(v);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}
function col(v) {
  if (v == null || v === '-') return 'var(--text-muted)';
  return parseFloat(v) >= 0 ? '#1A7A52' : '#912F63';
}
function stars(n) {
  if (!n || n === '-') return null;
  const r = parseInt(n);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

// ── Mini sparkline chart ──────────────────────────────────────────────────────
function MiniChart({ amfi_code, dateStr }) {
  const [pts, setPts] = useState([]);
  const [positive, setPositive] = useState(true);

  useEffect(() => {
    if (!amfi_code) return;
    fetch(`${API}/api/performance/nav-chart?amfi_code=${amfi_code}&period=1y&date=${dateStr}`)
      .then(r => r.json())
      .then(d => {
        const data = (d.data || []).filter(p => p.fund_nav != null);
        if (data.length < 2) return;
        const vals = data.map(p => p.fund_nav);
        setPositive(vals[vals.length - 1] >= vals[0]);
        const min = Math.min(...vals) * 0.998, max = Math.max(...vals) * 1.002;
        const W = 100, H = 36;
        setPts(data.map((p, i) => ({
          x: (i / (data.length - 1)) * W,
          y: H - ((p.fund_nav - min) / (max - min || 1)) * H,
        })));
      }).catch(() => {});
  }, [amfi_code, dateStr]);

  if (!pts.length) return <div style={{ height: 36, background: 'var(--bg-secondary)', borderRadius: 4 }} />;
  const c = positive ? '#1A7A52' : '#912F63';
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg width="100%" height="36" viewBox="0 0 100 36" preserveAspectRatio="none">
      <path d={pathD} fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Fund card ─────────────────────────────────────────────────────────────────
function FundCard({ fund, data, onRemove, onSelect, selected, onToggleSelect, dateStr }) {
  const f = data;
  const r = f?.returns || {};
  const risk = f?.risk || {};

  const aboveAvg = r['1y'] != null && r['1y'] !== '-';

  return (
    <div style={{
      border: `1.5px solid ${selected ? 'var(--brand-primary)' : 'var(--border)'}`,
      borderRadius: 12, background: '#fff', padding: 16, position: 'relative',
      boxShadow: 'var(--shadow-card)', cursor: 'pointer',
      transition: 'border-color .15s, box-shadow .15s',
    }}>
      {/* Checkbox */}
      <div style={{ position: 'absolute', top: 12, left: 12 }}
        onClick={e => { e.stopPropagation(); onToggleSelect(fund.isin); }}>
        <div style={{
          width: 16, height: 16, borderRadius: 3,
          border: `1.5px solid ${selected ? 'var(--brand-primary)' : 'var(--border)'}`,
          background: selected ? 'var(--brand-primary)' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
      </div>

      {/* Remove */}
      <button onClick={e => { e.stopPropagation(); onRemove(fund.isin); }}
        style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>

      {/* Fund name */}
      <div onClick={() => onSelect(fund)} style={{ paddingLeft: 24, paddingRight: 20, marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 600, color: 'var(--brand-dark)', lineHeight: 1.3, marginBottom: 5 }}>{fund.name}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {fund.category && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'rgba(145,47,99,0.08)', color: 'var(--brand-primary)', fontWeight: 500 }}>{fund.category.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</span>}
          {f?.morningstar_rating && f.morningstar_rating !== '-' && <span style={{ fontSize: 11, color: '#B46B10', letterSpacing: -1 }}>{stars(f.morningstar_rating)}</span>}

        </div>
      </div>

      {/* Return pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 2, marginBottom: 10, borderTop: '1px solid var(--bg-secondary)', paddingTop: 8 }}>
        {[['1M', r['1m']], ['3M', r['3m']], ['6M', r['6m']], ['1Y', r['1y']], ['3Y', r['3y']], ['5Y', r['5y']]].map(([p, v]) => (
          <div key={p} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>{p}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: col(v), fontFamily: 'var(--font-mono)' }}>{pct(v)}</div>
          </div>
        ))}
      </div>

      {/* Risk metrics */}
      {f && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 2, marginBottom: 10, padding: '6px 0', borderTop: '1px solid var(--bg-secondary)' }}>
          {[
            ['SHARPE', risk?.sharpe_ratio_3y],
            ['ALPHA', risk?.alpha_3y],
            ['DN CAP', risk?.down_capture_3y],
            ['TER', f.expense_ratio],
          ].map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{val != null && val !== '-' ? fmt(val) : '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* 52W position */}
      {f?.nav && f?.nav_52w_high && f?.nav_52w_low && f.nav !== '-' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>52W position</div>
          {(() => {
            const lo = parseFloat(f.nav_52w_low), hi = parseFloat(f.nav_52w_high), cur = parseFloat(f.nav);
            const pct = Math.min(100, Math.max(0, ((cur - lo) / (hi - lo || 1)) * 100));
            return (
              <div style={{ height: 3, background: 'var(--bg-secondary)', borderRadius: 2, position: 'relative' }}>
                <div style={{ height: '100%', width: `${pct.toFixed(1)}%`, background: 'linear-gradient(to right,#C46985,#912F63)', borderRadius: 2 }} />
                <div style={{ position: 'absolute', top: -3, left: `${pct.toFixed(1)}%`, width: 9, height: 9, borderRadius: '50%', background: 'var(--brand-dark)', border: '1.5px solid #fff', transform: 'translateX(-50%)' }} />
              </div>
            );
          })()}
        </div>
      )}


      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--bg-secondary)' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {fund.name.split(' ')[0]} · {f?.nav != null && f.nav !== '-' ? `₹${fmt(f.nav)}` : '—'}
        </span>
<div />
      </div>
    </div>
  );
}

// ── Main Watchlist component ──────────────────────────────────────────────────
export default function Watchlist({ selectedDate, setSelectedFund }) {
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState(() => loadWatchlist());
  const [view, setView] = useState('cards'); // 'cards' | 'table'
  const [fundData, setFundData] = useState({}); // isin → snapshot
  const [sortKey, setSortKey] = useState('1y');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;

  // Fetch snapshots for all watchlist funds
  useEffect(() => {
    if (!watchlist.length || !dateStr) return;
    setLoading(true);
    Promise.all(
      watchlist.map(f =>
        fetch(`${API}/api/home/snapshot?isin=${f.isin}&date=${dateStr}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ).then(results => {
      const map = {};
      watchlist.forEach((f, i) => { if (results[i]) map[f.isin] = results[i]; });
      setFundData(map);
      setLoading(false);
    });
  }, [watchlist, dateStr]);

  const refresh = () => setWatchlist(loadWatchlist());

  const handleRemove = (isin) => {
    removeFromWatchlist(isin);
    setSelected(s => { const n = new Set(s); n.delete(isin); return n; });
    refresh();
  };

  const handleSelect = (fund) => {
    setSelectedFund({ isin: fund.isin, name: fund.name, ranking: fund.ranking, amfi_code: fund.amfi_code, category: fund.category, assetClass: fund.assetClass });
    navigate('/home');
  };

  const toggleSelect = (isin) => {
    setSelected(s => { const n = new Set(s); n.has(isin) ? n.delete(isin) : n.add(isin); return n; });
  };

  const toggleAll = () => {
    if (selected.size === watchlist.length) setSelected(new Set());
    else setSelected(new Set(watchlist.map(f => f.isin)));
  };

  const clearAll = () => {
    saveWatchlist([]);
    refresh();
    setSelected(new Set());
  };

  // Sort + filter
  const SORT_KEYS = {
    '1m': f => parseFloat(fundData[f.isin]?.returns?.['1m'] || -999),
    '3m': f => parseFloat(fundData[f.isin]?.returns?.['3m'] || -999),
    '6m': f => parseFloat(fundData[f.isin]?.returns?.['6m'] || -999),
    '5y': f => parseFloat(fundData[f.isin]?.returns?.['5y'] || -999),
    'aum': f => parseFloat(fundData[f.isin]?.fund_size || -999),
    'ter': f => parseFloat(fundData[f.isin]?.expense_ratio || -999),
    '1y': f => parseFloat(fundData[f.isin]?.returns?.['1y'] || -999),
    '3y': f => parseFloat(fundData[f.isin]?.returns?.['3y'] || -999),
  };

  const displayList = watchlist
    .filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()) || f.isin?.includes(search))
    .sort((a, b) => sortDir === 'desc' ? (SORT_KEYS[sortKey]?.(b) || 0) - (SORT_KEYS[sortKey]?.(a) || 0) : (SORT_KEYS[sortKey]?.(a) || 0) - (SORT_KEYS[sortKey]?.(b) || 0));

  // Summary stats
  const allReturns1y = watchlist.map(f => parseFloat(fundData[f.isin]?.returns?.['1y'])).filter(v => !isNaN(v));
  const allReturns3y = watchlist.map(f => parseFloat(fundData[f.isin]?.returns?.['3y'])).filter(v => !isNaN(v));
  const avg1y = allReturns1y.length ? (allReturns1y.reduce((a, b) => a + b, 0) / allReturns1y.length) : null;
  const avg3y = allReturns3y.length ? (allReturns3y.reduce((a, b) => a + b, 0) / allReturns3y.length) : null;
  const allReturns6m = watchlist.map(f => parseFloat(fundData[f.isin]?.returns?.['6m'])).filter(v => !isNaN(v));
  const avg6m = allReturns6m.length ? (allReturns6m.reduce((a, b) => a + b, 0) / allReturns6m.length) : null;


  if (!watchlist.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: .3 }}>★</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 8 }}>Your watchlist is empty</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>Add funds from Fund Detail to track them here.</div>
        <button onClick={() => navigate('/fund-explorer')} style={{ padding: '8px 20px', background: 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>← Browse Fund Explorer</button>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 3, letterSpacing: '-.02em' }}>Watchlist</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tracking {watchlist.length} fund{watchlist.length !== 1 ? 's' : ''} · {dateStr}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {[['cards', '⊞ Cards'], ['table', '≡ Table']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer', background: view === v ? 'var(--brand-primary)' : '#fff', color: view === v ? '#fff' : 'var(--text-secondary)', transition: 'all .15s' }}>{l}</button>
            ))}
          </div>
          <button onClick={() => navigate('/peer-comparison')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>Compare ↗</button>
          <button onClick={() => navigate('/simulator')} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--brand-primary)', cursor: 'pointer', color: '#fff' }}>✦ Build portfolio ↗</button>
        </div>
      </div>

      {/* Search + sort */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search fund, AMC or ISIN..."
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, width: 220, outline: 'none' }}
        />
        <button onClick={clearAll} style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-muted)' }}>Clear all</button>
      </div>

      {/* Summary bar */}
      {Object.keys(fundData).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, marginBottom: 16, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-card)' }}>
          {[
            { label: 'Funds tracked', value: watchlist.length, sub: '', mono: false },
            { label: 'Avg 6M return', value: avg6m != null ? (avg6m >= 0 ? '+' : '') + avg6m.toFixed(2) + '%' : '—', sub: '', color: avg6m != null ? col(avg6m) : undefined },
            { label: 'Avg 1Y return', value: avg1y != null ? (avg1y >= 0 ? '+' : '') + avg1y.toFixed(2) + '%' : '—', sub: '', color: avg1y != null ? col(avg1y) : undefined },
            { label: 'Avg 3Y CAGR', value: avg3y != null ? (avg3y >= 0 ? '+' : '') + avg3y.toFixed(2) + '%' : '—', sub: '', color: avg3y != null ? col(avg3y) : undefined },
  
          ].filter(Boolean).map((item, i) => (
            <div key={i} style={{ padding: '12px 16px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: item.color || 'var(--brand-dark)', letterSpacing: '-.02em', lineHeight: 1, marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cards view */}
      {view === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {displayList.map(fund => (
            <FundCard
              key={fund.isin}
              fund={fund}
              data={fundData[fund.isin]}
              onRemove={handleRemove}
              onSelect={handleSelect}
              selected={selected.has(fund.isin)}
              onToggleSelect={toggleSelect}
              dateStr={dateStr}
            />
          ))}
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-card)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 8px', width: 20 }}>
                  <div onClick={toggleAll} style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${selected.size === watchlist.length ? 'var(--brand-primary)' : 'var(--border)'}`, background: selected.size === watchlist.length ? 'var(--brand-primary)' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {selected.size === watchlist.length && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                </th>
                {[
                  ['FUND', 'left', null],
                  ['NAV', 'right', null],
                  ['1M', 'right', '1m'],
                  ['3M', 'right', '3m'],
                  ['6M', 'right', '6m'],
                  ['1Y', 'right', '1y'],
                  ['3Y CAGR', 'right', '3y'],
                  ['5Y CAGR', 'right', '5y'],
                  ['AUM', 'right', 'aum'],
                  ['TER', 'right', 'ter'],
                  ['RATING', 'right', null],
                  ['', 'right', null],
                ].map(([h, align, sk]) => (
                  <th key={h} onClick={sk ? () => { if (sortKey === sk) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(sk); setSortDir('desc'); } } : undefined}
                    style={{ padding: '10px 8px', textAlign: align, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: sk && sortKey === sk ? 'var(--brand-primary)' : 'var(--text-muted)', cursor: sk ? 'pointer' : 'default', whiteSpace: 'nowrap', background: sk && sortKey === sk ? 'rgba(145,47,99,0.04)' : 'transparent' }}>
                    {h}{sk && sortKey === sk ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayList.map((fund, idx) => {
                const f = fundData[fund.isin];
                const r = f?.returns || {};
                const risk = f?.risk || {};
                return (
                  <tr key={fund.isin} style={{ borderBottom: '1px solid var(--bg-secondary)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 8px' }}>
                      <div onClick={e => { e.stopPropagation(); toggleSelect(fund.isin); }}
                        style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${selected.has(fund.isin) ? 'var(--brand-primary)' : 'var(--border)'}`, background: selected.has(fund.isin) ? 'var(--brand-primary)' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {selected.has(fund.isin) && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px' }} onClick={() => handleSelect(fund)}>
                      <div style={{ fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 2 }}>{fund.name}</div>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: 'rgba(145,47,99,0.08)', color: 'var(--brand-primary)' }}>{fund.category?.replace(/^(India Fund |India OE |Cat: )/, '')}</span>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{f?.nav && f.nav !== '-' ? `₹${fmt(f.nav)}` : '—'}</td>
                    {[r['1m'], r['3m'], r['6m'], r['1y'], r['3y'], r['5y']].map((v, i) => (
                      <td key={i} style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 400, color: col(v) }}>{pct(v)}</td>
                    ))}
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{f?.fund_size != null && f.fund_size !== '-' ? '₹' + parseFloat(f.fund_size).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr' : '—'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{f?.expense_ratio != null && f.expense_ratio !== '-' ? fmt(f.expense_ratio) + '%' : '—'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: 13, color: '#B46B10', letterSpacing: -1 }}>{f?.morningstar_rating && f.morningstar_rating !== '-' ? stars(f.morningstar_rating) : '—'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <button onClick={e => { e.stopPropagation(); handleRemove(fund.isin); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}