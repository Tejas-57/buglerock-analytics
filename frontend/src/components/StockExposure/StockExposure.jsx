import React, { useState, useRef, useEffect, useCallback } from 'react';
import './StockExposure.css';

const API = process.env.REACT_APP_API_URL || '';

const fmt = (v, d = 2) => (v == null ? '—' : parseFloat(v).toFixed(d));
const fmtAum = (v) => {
  if (v == null || v === 0) return '—';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k Cr`;
  return `₹${Math.round(v)} Cr`;
};

const RANK_ORDER = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 };
const RANK_COLORS = {
  R1: { bg: 'rgba(16,185,129,0.12)', color: '#059669', border: 'rgba(16,185,129,0.3)' },
  R2: { bg: 'rgba(16,185,129,0.08)', color: '#10B981', border: 'rgba(16,185,129,0.2)' },
  R3: { bg: 'rgba(109,84,121,0.1)',  color: '#6D5479', border: 'rgba(109,84,121,0.25)' },
  R4: { bg: 'rgba(245,158,11,0.1)',  color: '#D97706', border: 'rgba(245,158,11,0.25)' },
  R5: { bg: 'rgba(239,68,68,0.1)',   color: '#DC2626', border: 'rgba(239,68,68,0.25)' },
};
function RankBadge({ ranking }) {
  if (!ranking || ranking === '—') return null;
  const s = RANK_COLORS[ranking] || { bg: '#f5f5f5', color: '#999', border: '#ddd' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '2px 6px',
      borderRadius: 3, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {ranking}
    </span>
  );
}

// Sortable column header
function SortTh({ col, label, sort, onSort, align = 'center' }) {
  const active = sort.col === col;
  const dir = active ? sort.dir : null;
  return (
    <th
      onClick={() => onSort(col)}
      style={{ textAlign: align, cursor: 'pointer', userSelect: 'none',
        color: active ? 'var(--brand-primary)' : undefined }}
    >
      {label}{' '}
      <span style={{ opacity: active ? 1 : 0.3, fontSize: 9 }}>
        {dir === 'asc' ? '↑' : '↓'}
      </span>
    </th>
  );
}

function sortData(arr, sort, getValue) {
  return [...arr].sort((a, b) => {
    const va = getValue(a, sort.col);
    const vb = getValue(b, sort.col);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

function useSort(defaultCol, defaultDir = 'desc') {
  const [sort, setSort] = useState({ col: defaultCol, dir: defaultDir });
  const onSort = (col) => setSort(prev =>
    prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'desc' }
  );
  return [sort, onSort];
}

export default function StockExposure() {
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg]       = useState(false);
  const [whitelisted, setWhitelisted] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState(null);

  const [amcSort, onAmcSort]     = useSort('aum_exposed_cr', 'desc');
  const [fundSort, onFundSort]   = useSort('weight', 'desc');

  const debounceRef  = useRef(null);
  const inputRef     = useRef(null);
  const amcCardRef   = useRef(null);
  const fundScrollRef = useRef(null);

  // Sync fund table scroll height to AMC card height, min 260px (~5 rows)
  useEffect(() => {
    if (!result) return;
    const syncHeight = () => {
      if (amcCardRef.current && fundScrollRef.current) {
        const amcH = amcCardRef.current.offsetHeight;
        // Only subtract the fund card's title bar (se-card-hd) so bottoms align
        const fundCard = fundScrollRef.current.closest('.se-card');
        const cardHd = fundCard ? fundCard.querySelector('.se-card-hd')?.offsetHeight || 0 : 0;
        const minH = 260;
        const targetH = Math.max(amcH - cardHd, minH);
        fundScrollRef.current.style.maxHeight = targetH + 'px';
      }
    };
    syncHeight();
    window.addEventListener('resize', syncHeight);
    return () => window.removeEventListener('resize', syncHeight);
  }, [result]);

  // Typeahead
  const fetchSuggestions = useCallback((q) => {
    if (q.length < 2) { setSuggestions([]); return; }
    fetch(`${API}/api/holdings/stock-search?q=${encodeURIComponent(q)}&limit=12`)
      .then(r => r.json())
      .then(d => setSuggestions(d.results || []))
      .catch(() => setSuggestions([]));
  }, []);

  const handleInput = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 200);
    setShowSugg(true);
    if (!v) { setResult(null); setError(null); }
  };

  const runSearch = useCallback((stockName, wl) => {
    if (!stockName?.trim()) return;
    setLoading(true); setResult(null); setError(null); setShowSugg(false);
    const wlParam = wl !== undefined ? wl : whitelisted;
    fetch(`${API}/api/holdings/stock-exposure?stock=${encodeURIComponent(stockName)}&whitelisted=${wlParam}`)
      .then(r => r.json())
      .then(d => {
        if (!d.matched_name) setError(`No stock matching "${stockName}" found in holdings data.`);
        else setResult(d);
      })
      .catch(() => setError('Failed to fetch exposure data. Please try again.'))
      .finally(() => setLoading(false));
  }, [whitelisted]);

  const pickSuggestion = (name) => {
    setQuery(name); setSuggestions([]); setShowSugg(false);
    runSearch(name, whitelisted);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { setSuggestions([]); runSearch(query, whitelisted); }
    if (e.key === 'Escape') setShowSugg(false);
  };

  const toggleWhitelisted = (val) => {
    setWhitelisted(val);
    if (result) runSearch(result.matched_name, val);
  };

  // AMC table sort
  const sortedAmc = result ? sortData(result.amc_breakdown, amcSort, (r, col) => {
    if (col === 'amc') return r.amc;
    if (col === 'fund_count') return r.fund_count;
    if (col === 'avg_weight') return r.avg_weight;
    if (col === 'aum_exposed_cr') return r.aum_exposed_cr;
    return null;
  }) : [];

  // Fund table sort — rank uses numeric order R1=1...R5=5, unranked=99
  const sortedHolders = result ? sortData(result.holders, fundSort, (h, col) => {
    if (col === 'fund_name') return h.fund_name;
    if (col === 'rank') return RANK_ORDER[h.ranking] ?? 99;
    if (col === 'weight') return h.weight;
    if (col === 'aum_exposed_cr') return h.aum_exposed_cr;
    return null;
  }) : [];

  useEffect(() => {
    const handler = (e) => { if (!e.target.closest('.se-search-wrap')) setShowSugg(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const s = result?.summary;

  return (
    <div className="se-root">
      {/* Header */}
      <div className="se-header">
        <div>
          <h1 className="se-title">Stock Exposure Finder</h1>
          <div className="se-subtitle">Find every fund in the universe holding a given stock — weight, AUM exposure, and fund house breakdown</div>
        </div>
        {result && (
          <div className="se-portfolio-date">
            Holdings as of <strong>{result.portfolio_date}</strong>
          </div>
        )}
      </div>

      {/* Search bar + filter */}
      <div className="se-toolbar">
        <div className="se-search-wrap">
          <div className="se-search-box">
            <svg className="se-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              className="se-input"
              placeholder="Search a stock — e.g. HDFC Bank, Infosys, Reliance..."
              value={query}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length && setShowSugg(true)}
              autoComplete="off"
            />
            {query && (
              <button className="se-clear" onClick={() => { setQuery(''); setResult(null); setError(null); setSuggestions([]); inputRef.current?.focus(); }}>
                ×
              </button>
            )}
          </div>
          {showSugg && suggestions.length > 0 && (
            <div className="se-suggestions">
              {suggestions.map((s, i) => (
                <div key={i} className="se-suggestion" onClick={() => pickSuggestion(s.name)}>
                  <span className="se-sug-name">{s.name}</span>
                  <span className="se-sug-count">{s.fund_count} fund{s.fund_count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="se-filter-group">
          {[{ val: true, label: '★ Whitelisted' }, { val: false, label: 'All Funds' }].map(({ val, label }) => (
            <button
              key={String(val)}
              className={`se-filter-btn${whitelisted === val ? ' active' : ''}`}
              onClick={() => toggleWhitelisted(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <button className="se-search-btn" onClick={() => runSearch(query, whitelisted)} disabled={!query.trim() || loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Body */}
      <div className="se-body">
        {!result && !loading && !error && (
          <div className="se-empty">
            <div className="se-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <div className="se-empty-title">Search for a stock</div>
            <div className="se-empty-sub">Type a company name — e.g. 'HDFC Bank', 'Infosys', 'Reliance Industries' — to see which funds hold it, how much weight they give it, and which fund houses have the most exposure.</div>
          </div>
        )}

        {loading && (
          <div className="se-loading">
            <div className="se-spinner" />
            <div>Looking up holdings data…</div>
          </div>
        )}

        {error && !loading && (
          <div className="se-error">{error}</div>
        )}

        {result && !loading && (
          <>
            {/* Stock header */}
            <div className="se-stock-header">
              <div className="se-stock-name">{result.matched_name}</div>
              <div className="se-stock-meta">
                {result.sector && <span className="se-sector-chip">{result.sector}</span>}
                {result.stock_isin && <span className="se-isin-chip">{result.stock_isin}</span>}
              </div>
              <div className="se-stock-desc">
                Held by <strong>{s.fund_count} fund{s.fund_count !== 1 ? 's' : ''}</strong> across <strong>{s.amc_count} fund house{s.amc_count !== 1 ? 's' : ''}</strong>
                {s.top3_amc_share_pct > 0 && <> — top 3 fund houses account for <strong className="se-highlight">{s.top3_amc_share_pct}%</strong> of estimated AUM exposed</>}.
                {result.whitelisted && <span className="se-wl-note"> (Whitelisted R1/R2 funds only)</span>}
              </div>
            </div>

            {/* KPI chips */}
            <div className="se-kpis">
              {[
                { icon: '📂', val: s.fund_count, label: 'Funds holding it' },
                { icon: '🏢', val: s.amc_count, label: 'Fund houses' },
                { icon: '⚖️', val: `${fmt(s.avg_weight, 2)}%`, label: 'Avg weight among holders' },
                { icon: '💰', val: fmtAum(s.total_aum_exposed_cr), label: 'Est. AUM exposed' },
              ].map(({ icon, val, label }) => (
                <div key={label} className="se-kpi">
                  <div className="se-kpi-icon">{icon}</div>
                  <div className="se-kpi-val">{val}</div>
                  <div className="se-kpi-label">{label}</div>
                </div>
              ))}
            </div>

            {/* Two tables */}
            <div className="se-tables">
              {/* AMC breakdown */}
              <div className="se-card" ref={amcCardRef}>
                <div className="se-card-hd">🏢 By fund house</div>
                <div className="se-card-body">
                  <table className="se-table">
                    <thead>
                      <tr>
                        <SortTh col="amc"           label="AMC"      sort={amcSort} onSort={onAmcSort} align="left" />
                        <SortTh col="fund_count"    label="Funds"    sort={amcSort} onSort={onAmcSort} />
                        <SortTh col="avg_weight"    label="Avg wt."  sort={amcSort} onSort={onAmcSort} />
                        <SortTh col="aum_exposed_cr" label="Est. AUM" sort={amcSort} onSort={onAmcSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAmc.map((r, i) => (
                        <tr key={i}>
                          <td className="se-td-name">{r.amc}</td>
                          <td className="se-mono">{r.fund_count}</td>
                          <td className="se-mono">{fmt(r.avg_weight, 2)}%</td>
                          <td className="se-mono se-bold">{fmtAum(r.aum_exposed_cr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Fund breakdown */}
              <div className="se-card">
                <div className="se-card-hd">📋 By fund</div>
                <div className="se-card-body se-card-fund-scroll" ref={fundScrollRef}>
                  <table className="se-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', width: 28 }}>#</th>
                        <SortTh col="fund_name"     label="Fund"     sort={fundSort} onSort={onFundSort} align="left" />
                        <SortTh col="rank"          label="Rank"     sort={fundSort} onSort={onFundSort} />
                        <SortTh col="weight"        label="Weight"   sort={fundSort} onSort={onFundSort} />
                        <SortTh col="aum_exposed_cr" label="Est. AUM" sort={fundSort} onSort={onFundSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedHolders.map((h, i) => (
                        <tr key={h.isin}>
                          <td className="se-td-num se-mono">{i + 1}</td>
                          <td className="se-td-fund">
                            <div className="se-fund-name">{h.fund_name}</div>
                            <div className="se-fund-meta">{h.amc} · {h.category}</div>
                          </td>
                          <td><RankBadge ranking={h.ranking} /></td>
                          <td className="se-mono se-bold">{fmt(h.weight, 2)}%</td>
                          <td className="se-mono">{fmtAum(h.aum_exposed_cr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Methodology */}
            <div className="se-methodology">
              <span className="se-meth-label">ℹ Methodology</span>
              <span className="se-methodology-text">
                Holdings sourced from Morningstar. Data reflects each fund's latest disclosed portfolio — typically with 1 month lag. Only equity holdings are included. AUM exposure = fund AUM × holding weight.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}