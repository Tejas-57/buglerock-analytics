import React, { useState, useEffect, useRef } from 'react';

const CMP_COLORS = ['#912F63', '#3E3452', '#0F6E56', '#B46B10', '#1558A8'];

function fmt(v, decimals = 2) {
  if (v === null || v === undefined || v === '-') return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function pct(v) {
  if (v === null || v === undefined || v === '-') return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function pctc(v) {
  if (v === null || v === undefined || v === '-') return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toFixed(2) + '%';
}

function fmtAum(v) {
  if (!v || v === '-') return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (n >= 10000) return '₹' + (n / 1000).toFixed(0) + 'K Cr';
  return '₹' + n.toFixed(0) + ' Cr';
}

function stars(r) {
  const n = Math.round(parseFloat(r));
  if (isNaN(n)) return '';
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function highlight(vals, lowerBetter = false) {
  const nums = vals.map(v => (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null);
  const valid = nums.filter(v => v !== null && !isNaN(v));
  if (valid.length < 2) return vals.map(() => ''); // no highlighting for single fund
  const best = lowerBetter ? Math.min(...valid) : Math.max(...valid);
  const worst = lowerBetter ? Math.max(...valid) : Math.min(...valid);
  return nums.map(v => {
    if (v === null || isNaN(v)) return '';
    if (v === best && best !== worst) return 'best';
    if (v === worst && best !== worst) return 'worst';
    return '';
  });
}

export default function CompareFunds({ selectedDate }) {
  const [funds, setFunds] = useState(() => {
    try {
      const saved = localStorage.getItem('compareFunds_state');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('br_compare_tab') || 'returns'; } catch { return 'returns'; }
  });
  function setActiveTabPersist(tab) {
    try { localStorage.setItem('br_compare_tab', tab); } catch {}
    setActiveTab(tab);
  }
  const [slotSearchQ, setSlotSearchQ] = useState(['', '', '', '']);
  const [slotResults, setSlotResults] = useState([[], [], [], []]);
  const [slotOpen, setSlotOpen] = useState([false, false, false, false]);
  const [slotLoading, setSlotLoading] = useState([false, false, false, false]);
  const [loadingIsins, setLoadingIsins] = useState(new Set());
  const [wlDropdownOpen, setWlDropdownOpen] = useState(false);
  const [watchlistFunds, setWatchlistFunds] = useState([]);
  const wlRef = useRef(null);
  const [overlapData, setOverlapData] = useState(null);
  const [overlapLoading, setOverlapLoading] = useState(false);
  const [overlapError, setOverlapError] = useState(null);
  const slotRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;
  const MAX = 4;


  // Persist funds to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem('compareFunds_state', JSON.stringify(funds));
    } catch {}
  }, [funds]);

  // Load funds passed from Watchlist via sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem('compareFunds');
    if (stored) {
      try {
        const preselected = JSON.parse(stored);
        sessionStorage.removeItem('compareFunds');
        setFunds([]); // clear existing before loading watchlist selection
        preselected.slice(0, MAX).forEach((fund, idx) => {
          fetchFundData(fund.isin).then(data => {
            const color = CMP_COLORS[idx % CMP_COLORS.length];
            setFunds(prev => {
              if (prev.find(f => f.isin === fund.isin)) return prev;
              return [...prev, { ...fund, color, data }];
            });
          });
        });
      } catch {}
    }
  }, []);

  // Close dropdown only when focus leaves the entire slot wrapper
  function handleSlotBlur(idx, e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setSlotOpen(prev => { const s = [...prev]; s[idx] = false; return s; });
    }
  }

  // Per-slot search
  function handleSlotSearch(idx, q) {
    setSlotSearchQ(prev => { const s = [...prev]; s[idx] = q; return s; });
    // Clear results immediately so stale results don't show while new query loads
    setSlotResults(prev => { const s = [...prev]; s[idx] = []; return s; });
    setSlotOpen(prev => { const s = [...prev]; s[idx] = false; return s; });
    if (!q.trim() || q.trim().length < 2) return;
    setSlotLoading(prev => { const s = [...prev]; s[idx] = true; return s; });
    clearTimeout(window[`_slotTimer${idx}`]);
    window[`_slotTimer${idx}`] = setTimeout(() => {
      fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/search?q=${encodeURIComponent(q.trim())}&date=${dateStr}`)
        .then(r => r.json())
        .then(d => {
          setSlotResults(prev => { const s = [...prev]; s[idx] = d.funds || []; return s; });
          setSlotOpen(prev => { const s = [...prev]; s[idx] = true; return s; });
          setSlotLoading(prev => { const s = [...prev]; s[idx] = false; return s; });
        })
        .catch(() => setSlotLoading(prev => { const s = [...prev]; s[idx] = false; return s; }));
    }, 300);
  }

  // Fetch full snapshot for a fund
  async function fetchFundData(isin) {
    const r = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/home/snapshot?isin=${isin}&date=${dateStr}`);
    const d = await r.json();
    return d;
  }

  async function addFund(fund, slotIdx) {
    if (funds.length >= MAX) return;
    if (funds.find(f => f.isin === fund.isin)) return;
    setLoadingIsins(prev => new Set([...prev, fund.isin]));
    const data = await fetchFundData(fund.isin);
    const color = CMP_COLORS[funds.length % CMP_COLORS.length];
    setFunds(prev => [...prev, { ...fund, color, data }]);
    setLoadingIsins(prev => { const s = new Set(prev); s.delete(fund.isin); return s; });
    if (slotIdx !== undefined) {
      setSlotSearchQ(prev => { const s = [...prev]; s[slotIdx] = ''; return s; });
      setSlotOpen(prev => { const s = [...prev]; s[slotIdx] = false; return s; });
    }
  }

  function removeFund(isin) {
    setFunds(prev => prev.filter(f => f.isin !== isin));
  }

  // Load watchlist for dropdown
  function openWlDropdown() {
    try {
      const wl = JSON.parse(localStorage.getItem('watchlist_default') || '[]');
      setWatchlistFunds(wl);
      setWlDropdownOpen(true);
    } catch {}
  }

  // Close watchlist dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (wlRef.current && !wlRef.current.contains(e.target)) {
        setWlDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // ── Table helpers ──────────────────────────────────────────────────────────

  function Row({ label, vals, fmtFn, lowerBetter, showBar }) {
    const hl = highlight(vals, lowerBetter);
    const maxAbs = showBar ? Math.max(...vals.map(v => Math.abs(parseFloat(v) || 0))) : 0;
    return (
      <tr>
        <td style={{ padding: '7px 14px', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{label}</td>
        {vals.map((v, i) => {
          const num = parseFloat(v);
          const barW = showBar && maxAbs > 0 ? Math.abs(num) / maxAbs * 100 : 0;
          const isPos = num >= 0;
          return (
            <td key={i} style={{ padding: '7px 14px', textAlign: 'right', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', background: hl[i] === 'best' ? 'rgba(145,47,99,0.04)' : hl[i] === 'worst' ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
              {showBar && !isNaN(num) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <div style={{ width: 60, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${barW}%`, height: '100%', background: isPos ? 'var(--brand-primary)' : 'var(--neg)', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: hl[i] === 'best' ? 'var(--brand-primary)' : hl[i] === 'worst' ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: hl[i] === 'best' ? 600 : 400 }}>{fmtFn ? fmtFn(v) : v ?? '—'}</span>
                </div>
              )}
              {!showBar && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: hl[i] === 'best' ? 'var(--brand-primary)' : hl[i] === 'worst' ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: hl[i] === 'best' ? 600 : 400 }}>{fmtFn ? fmtFn(v) : v ?? '—'}</span>}
            </td>
          );
        })}
      </tr>
    );
  }

  function SectionHead({ label }) {
    return (
      <tr>
        <td colSpan={funds.length + 1} style={{ padding: '8px 14px 4px', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-primary)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>{label}</td>
      </tr>
    );
  }

  function FundHeader() {
    return (
      <tr style={{ background: 'var(--bg-secondary)' }}>
        <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', minWidth: 140 }}>Metric</th>
        {funds.map((f, i) => (
          <th key={i} style={{ padding: '10px 14px', textAlign: 'right', borderBottom: '2px solid var(--border)', borderLeft: '1px solid var(--border)', minWidth: 110 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.color }} />
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)', lineHeight: 1.3, textAlign: 'right' }}>{f.name?.split(' ').slice(0, 4).join(' ')}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{f.category?.replace(/^(India Fund |India OE |Cat: )/, '')?.slice(0, 22)}</div>
            </div>
          </th>
        ))}
      </tr>
    );
  }

  // ── Overlap helpers ────────────────────────────────────────────────────────

  // Shorten fund name by removing trailing noise words, not by cutting word count
  function shortFundName(name) {
    if (!name) return '';
    // Remove common noise suffixes — order matters (longer phrases first)
    const noiseTerms = ['Reg Gr', 'Dir Gr', 'Direct Gr', 'Regular Gr', 'Growth Plan', 'Direct Plan',
      'Regular Plan', 'Direct Growth', 'Regular Growth', 'Growth', 'Regular', 'Direct',
      'Reg', 'Dir', 'Gr', 'Fund', 'Scheme', 'Plan', 'Option', 'IDCW'];
    let result = name;
    for (const term of noiseTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp('(^|\\s)' + escaped + '(\\s|$)', 'gi'), ' ');
    }
    return result.replace(/\s+/g, ' ').trim();
  }

  // Shared table styles for consistent column widths across all overlap tables
  const TBL = { width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' };
  const COL_STOCK  = { width: '38%' };
  const COL_SECTOR = { width: '22%' };
  const COL_WEIGHT = { width: '20%' }; // per fund weight column
  const TH = (extra) => ({ padding: '8px 12px', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', ...extra });
  const TD = (extra) => ({ padding: '7px 12px', borderBottom: '1px solid var(--border)', ...extra });

  // Only active equity mutual funds qualify for overlap
  function isActiveEquityFund(f) {
    const ac = (f.data?.asset_class || f.asset_class || '').toLowerCase();
    const cat = (f.data?.category || f.category || '').toLowerCase();
    // Must be equity asset class, not ETF or index (ETFs have very low expense ratio and specific categories)
    const isEquity = ac === 'equity';
    const isIndex = cat.includes('index') || cat.includes('etf') || (f.data?.expense_ratio && f.data.expense_ratio < 0.5);
    return isEquity && !isIndex;
  }

  const equityFunds = funds.filter(isActiveEquityFund);

  async function fetchOverlap() {
    if (equityFunds.length < 2) return;
    const API = process.env.REACT_APP_API_URL || '';
    setOverlapLoading(true);
    setOverlapError(null);
    setOverlapData(null);

    try {
      const isins = equityFunds.map(f => f.isin).join(',');

      // First pass — check which funds are missing holdings
      const firstR = await fetch(`${API}/api/holdings/overlap?isins=${isins}`);
      if (!firstR.ok) throw new Error('Could not calculate overlap');
      const firstD = await firstR.json();

      // Auto-fetch any funds with 0 holdings
      const missing = equityFunds.filter(f => (firstD.fund_holdings_counts?.[f.isin] ?? -1) === 0);
      if (missing.length > 0) {
        setOverlapError(`Fetching holdings for ${missing.map(f => shortFundName(f.name)).join(', ')}...`);
        await Promise.all(missing.map(f =>
          fetch(`${API}/api/holdings/fetch/${f.isin}`, { method: 'POST' })
        ));
        // Wait for background fetches to complete (poll up to 60s)
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(res => setTimeout(res, 2000));
          const checkR = await fetch(`${API}/api/holdings/overlap?isins=${isins}`);
          if (checkR.ok) {
            const checkD = await checkR.json();
            const stillMissing = equityFunds.filter(f => (checkD.fund_holdings_counts?.[f.isin] ?? -1) === 0);
            if (stillMissing.length === 0) {
              setOverlapError(null);
              setOverlapData(checkD);
              return;
            }
          }
        }
        throw new Error('Holdings fetch timed out — please try again');
      }

      setOverlapData(firstD);
    } catch (e) {
      setOverlapError(e.message);
    } finally {
      setOverlapLoading(false);
    }
  }

  // Auto-fetch overlap whenever tab is overlap OR funds change while on overlap tab
  useEffect(() => {
    if (activeTab === 'overlap' && equityFunds.length >= 2) {
      fetchOverlap();
    } else if (activeTab === 'overlap' && equityFunds.length < 2) {
      setOverlapData(null);
      setOverlapError(null);
    }
  }, [activeTab, funds.map(f => f.isin).join(',')]);

  function renderOverlap() {
    const nonEquity = funds.filter(f => !isActiveEquityFund(f));

    return (
      <div style={{ padding: '0 2px' }}>

        {/* Non-equity warning */}
        {nonEquity.length > 0 && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.3)', borderRadius: 8, fontSize: 12, color: '#92700A' }}>
            ⚠ Overlap is only for active equity funds.{' '}
            <strong>{nonEquity.map(f => shortFundName(f.name)).join(', ')}</strong> excluded.
          </div>
        )}

        {equityFunds.length < 2 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Add at least 2 active equity mutual funds to see overlap.
          </div>
        )}

        {equityFunds.length >= 2 && overlapLoading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {overlapError || 'Calculating overlap...'}
            {overlapError && <div style={{ fontSize: 11, marginTop: 6 }}>Fetching from Morningstar, please wait...</div>}
          </div>
        )}

        {equityFunds.length >= 2 && overlapError && !overlapLoading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--neg)', fontSize: 13 }}>{overlapError}</div>
        )}

        {equityFunds.length >= 2 && overlapData && !overlapLoading && (() => {
          const { pairwise_matrix, common_all, pair_details, fund_holdings_counts } = overlapData;
          const pairs = Object.values(pairwise_matrix);
          const fundMap = Object.fromEntries(equityFunds.map(f => [f.isin, f]));

          // No data check
          const fundsWithNoData = equityFunds.filter(f => (fund_holdings_counts?.[f.isin] ?? -1) === 0);
          if (fundsWithNoData.length > 0) {
            return (
              <div style={{ padding: 24, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                <div style={{ marginBottom: 8, fontWeight: 500, color: 'var(--text-body)' }}>Holdings data not available for:</div>
                <div style={{ marginBottom: 12 }}>{fundsWithNoData.map(f => f.name).join(', ')}</div>
                <div style={{ fontSize: 11 }}>Holdings are fetched on demand. Contact admin to run fetch for these funds.</div>
              </div>
            );
          }

          // ── Summary stats ──────────────────────────────────────────────────
          // Avg overlap across all pairs
          const avgOverlap = pairs.length
            ? (pairs.reduce((s, p) => s + p.overlap_pct, 0) / pairs.length).toFixed(1)
            : 0;

          // Highest overlap pair
          const highestPair = pairs.reduce((best, p) => p.overlap_pct > (best?.overlap_pct || 0) ? p : best, null);

          // Unique stocks: sum of all equity holdings across all funds minus overlaps
          // Best approximation from available data: total unique ISINs across all holdings
          // Backend returns fund_holdings_counts = {isin: count} — use union estimate
          // More accurate: collect all unique holding ISINs from common_all + pair details
          const allStockISINs = new Set();
          common_all.forEach(h => allStockISINs.add(h.holding_isin));
          pairs.forEach(p => {
            const pd = pair_details[`${p.fund_a}|${p.fund_b}`];
            if (pd?.shared) pd.shared.forEach(h => { if (h.holding_isin) allStockISINs.add(h.holding_isin); });
            if (pd?.only_a) pd.only_a.forEach(h => { if (h.name) allStockISINs.add(h.name); });
            if (pd?.only_b) pd.only_b.forEach(h => { if (h.name) allStockISINs.add(h.name); });
          });
          // True unique stock count from backend (union of all holding ISINs)
          const totalUniqueStocks = overlapData.unique_stock_count || '—';

          // Held by every fund — count and top name
          const heldByAllCount = common_all.length;
          const heldByAllName = common_all.length > 0 ? common_all[0].name : '—';

          const statCard = (value, label, sub, color) => (
            <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 10, padding: '16px 20px', textAlign: 'center', minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
              {sub && <div style={{ fontSize: 11, color: 'var(--text-body)', marginTop: 3 }}>{sub}</div>}
            </div>
          );

          const overlapColor = (pct) =>
            pct >= 35 ? '#C0392B' : pct >= 25 ? '#E67E22' : pct >= 15 ? '#F39C12' : pct >= 5 ? '#27AE60' : '#A0A0A0';
          const overlapLabel = (pct) =>
            pct >= 35 ? 'Very High Overlap' : pct >= 25 ? 'High Overlap' : pct >= 15 ? 'Moderate Overlap' : pct >= 5 ? 'Low Overlap' : 'Negligible Overlap';

          return (
            <div>
              {/* ── 4 summary stat cards ── */}
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                {statCard(`${avgOverlap}%`, 'Avg Holdings Overlap', `${equityFunds.length} funds · ${pairs.length} pairs`)}
                {statCard(
                  highestPair ? `${highestPair.overlap_pct.toFixed(1)}%` : '—',
                  'Highest Overlap Pair',
                  highestPair ? `${shortFundName(fundMap[highestPair.fund_a]?.name)} ↔ ${shortFundName(fundMap[highestPair.fund_b]?.name)}` : '',
                  overlapColor(highestPair?.overlap_pct || 0)
                )}
                {statCard(totalUniqueStocks || '—', 'Unique Stocks Across Set', `${equityFunds.length} funds combined`)}
                {statCard(
                  heldByAllCount > 0 ? heldByAllCount : '0',
                  'Held By Every Fund',
                  heldByAllCount > 0 ? `Top stock by weight: ${heldByAllName}` : 'None in common',
                  heldByAllCount > 0 ? 'var(--brand-primary)' : 'var(--text-muted)'
                )}
              </div>
              </div>{/* end stat cards box */}

              {/* ── Overlap matrix (centred) ── */}
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', padding: '20px', marginBottom: 16 }}>
              <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)', marginBottom: 16, alignSelf: 'flex-start' }}>Overlap matrix</div>
                <table style={{ borderCollapse: 'separate', borderSpacing: 6, margin: '0 auto' }}>
                  <thead>
                    <tr>
                      <td style={{ width: 140 }} />
                      {equityFunds.map(f => (
                        <th key={f.isin} style={{ textAlign: 'center', padding: '0 4px 8px', fontSize: 11, fontWeight: 500, color: 'var(--text-body)', width: 100 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: f.color }} />
                            <div style={{ maxWidth: 90, textAlign: 'center', lineHeight: 1.3 }}>{shortFundName(f.name)}</div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {equityFunds.map((fa, i) => (
                      <tr key={fa.isin}>
                        <td style={{ textAlign: 'right', padding: '4px 10px 4px 0', fontSize: 11, fontWeight: 500, color: 'var(--text-body)', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: fa.color, marginRight: 6, verticalAlign: 'middle' }} />
                          {shortFundName(fa.name)}
                        </td>
                        {equityFunds.map((fb, j) => {
                          if (i === j) return (
                            <td key={fb.isin} style={{ width: 100, height: 60, background: '#f4f4f4', borderRadius: 8, textAlign: 'center', fontSize: 18, color: '#ccc' }}>—</td>
                          );
                          const key = i < j ? `${fa.isin}|${fb.isin}` : `${fb.isin}|${fa.isin}`;
                          const p = pairwise_matrix[key];
                          const pct = p?.overlap_pct || 0;
                          const bg = pct >= 35 ? 'rgba(192,57,43,.10)' : pct >= 25 ? 'rgba(230,126,34,.10)' : pct >= 15 ? 'rgba(243,156,18,.10)' : pct >= 5 ? 'rgba(39,174,96,.10)' : '#f4f4f4';
                          const clr = overlapColor(pct);
                          return (
                            <td key={fb.isin} style={{ width: 100, height: 60, background: bg, borderRadius: 8, textAlign: 'center', verticalAlign: 'middle' }}>
                              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: clr }}>{pct.toFixed(0)}%</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--text-muted)', justifyContent: 'center' }}>
                  <span><span style={{ color: '#A0A0A0' }}>●</span> &lt;5% Negligible</span>
                  <span><span style={{ color: '#27AE60' }}>●</span> 5–15% Low</span>
                  <span><span style={{ color: '#F39C12' }}>●</span> 15–25% Moderate</span>
                  <span><span style={{ color: '#E67E22' }}>●</span> 25–35% High</span>
                  <span><span style={{ color: '#C0392B' }}>●</span> &gt;35% Very high</span>
                </div>
              </div>



              </div>{/* end matrix box */}

              {/* ── Pairwise cards ── */}
              {pairs.map((p, pi) => {
                const fa = fundMap[p.fund_a];
                const fb = fundMap[p.fund_b];
                const pd = pair_details[`${p.fund_a}|${p.fund_b}`] || {};
                const shared = pd.shared || [];
                const onlyA = pd.only_a || [];
                const onlyB = pd.only_b || [];
                const pct = p.overlap_pct;
                const clr = overlapColor(pct);
                const lbl = overlapLabel(pct);
                const rows = Math.max(onlyA.length, onlyB.length, 1);
                const nameA = shortFundName(fa?.name);
                const nameB = shortFundName(fb?.name);

                return (
                  <div key={`${p.fund_a}|${p.fund_b}`} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
                    {/* Card header — colour-coded by overlap level */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', background: `${clr}12`, borderBottom: `1px solid ${clr}30`, gap: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-dark)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{pi + 1}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: fa?.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-body)' }}>{shortFundName(fa?.name)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, flexShrink: 0 }}>vs</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-body)' }}>{shortFundName(fb?.name)}</span>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: fb?.color, flexShrink: 0 }} />
                      </div>
                      <div style={{ marginLeft: 16, background: `${clr}18`, border: `1px solid ${clr}44`, borderRadius: 8, padding: '6px 14px', textAlign: 'center', minWidth: 90, flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: clr }}>{pct.toFixed(1)}%</div>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: clr }}>{lbl}</div>
                      </div>
                    </div>

                    <div style={{ padding: '16px 20px' }}>
                      {/* Shared holdings */}
                      {shared.length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#E67E22', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 10 }}>
                            Shared Holdings ({shared.length})
                          </div>
                          {/* Column headers */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: '0 8px', marginBottom: 4 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Stock</div>
                            <div style={{ fontSize: 10, color: fa?.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'right' }}>{shortFundName(fa?.name).split(' ')[0]}</div>
                            <div style={{ fontSize: 10, color: fb?.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'right' }}>{shortFundName(fb?.name).split(' ')[0]}</div>
                          </div>
                          {shared.map(h => (
                            <div key={h.holding_isin} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: '0 8px', padding: '7px 10px', alignItems: 'center', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: 4 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                                {h.name}
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#E67E22', letterSpacing: '.04em' }}>● SHARED</span>
                              </div>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right', color: fa?.color }}>{h.weight_a.toFixed(1)}%</div>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'right', color: fb?.color }}>{h.weight_b.toFixed(1)}%</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Only-in columns */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                        {/* Only in Fund A */}
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 10 }}>
                            Only in {shortFundName(fa?.name)}
                          </div>
                          {Array.from({ length: 10 }).map((_, idx) => {
                            const h = onlyA[idx];
                            return (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 16px', padding: '5px 0', opacity: h ? 1 : 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-body)' }}>{h ? h.name : '·'}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: fa?.color, textAlign: 'right' }}>{h ? `${h.weight.toFixed(1)}%` : ''}</div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Only in Fund B */}
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 10 }}>
                            Only in {shortFundName(fb?.name)}
                          </div>
                          {Array.from({ length: 10 }).map((_, idx) => {
                            const h = onlyB[idx];
                            return (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0 16px', padding: '5px 0', opacity: h ? 1 : 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-body)' }}>{h ? h.name : '·'}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: fb?.color, textAlign: 'right' }}>{h ? `${h.weight.toFixed(1)}%` : ''}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  }


  function renderTable() {
    if (activeTab === 'overlap') return renderOverlap();
    if (funds.length < 1) return null;
    const F = funds;

    if (activeTab === 'returns') {
      // Count how many return periods each fund has the best value
      function tallyWins() {
        const returnKeys = ['1m','3m','6m','1y','2y','3y','5y','10y','ytd','cy2025','cy2024','cy2023','cy2022','cy2021'];
        const counts = F.map(() => 0);
        returnKeys.forEach(k => {
          const vals = F.map(f => {
            const v = f.data?.returns?.[k];
            return (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null;
          });
          const valid = vals.filter(v => v !== null && !isNaN(v));
          if (valid.length < 2) return;
          const best = Math.max(...valid);
          vals.forEach((v, i) => { if (v === best) counts[i]++; });
        });
        return counts;
      }
      const wins = tallyWins();
      const maxWins = Math.max(...wins);
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><FundHeader /></thead>
            <tbody>
              <SectionHead label="Return periods" />
              <Row label="1 month"  vals={F.map(f => f.data?.returns?.['1m'])}    fmtFn={pct}  showBar />
              <Row label="3 months" vals={F.map(f => f.data?.returns?.['3m'])}    fmtFn={pct}  showBar />
              <Row label="6 months" vals={F.map(f => f.data?.returns?.['6m'])}    fmtFn={pct}  showBar />
              <Row label="1 year"   vals={F.map(f => f.data?.returns?.['1y'])}    fmtFn={pct}  showBar />
              <Row label="2 year"   vals={F.map(f => f.data?.returns?.['2y'])}    fmtFn={pct}  showBar />
              <Row label="3Y CAGR"  vals={F.map(f => f.data?.returns?.['3y'])}    fmtFn={pct}  showBar />
              <Row label="5Y CAGR"  vals={F.map(f => f.data?.returns?.['5y'])}    fmtFn={pct}  showBar />
              <Row label="10Y CAGR" vals={F.map(f => f.data?.returns?.['10y'])}   fmtFn={pct}  showBar />
              <Row label="YTD 2026" vals={F.map(f => f.data?.returns?.['ytd'])}   fmtFn={pct}  showBar />
              <SectionHead label="Calendar year returns" />
              <Row label="CY 2025"  vals={F.map(f => f.data?.returns?.['cy2025'])} fmtFn={pct} showBar />
              <Row label="CY 2024"  vals={F.map(f => f.data?.returns?.['cy2024'])} fmtFn={pct} showBar />
              <Row label="CY 2023"  vals={F.map(f => f.data?.returns?.['cy2023'])} fmtFn={pct} showBar />
              <Row label="CY 2022"  vals={F.map(f => f.data?.returns?.['cy2022'])} fmtFn={pct} showBar />
              <Row label="CY 2021"  vals={F.map(f => f.data?.returns?.['cy2021'])} fmtFn={pct} showBar />
              {/* Tally row - only when 2+ funds */}
              {F.length >= 2 && (
              <tr>
                <td style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderTop: '2px solid var(--border)', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)' }}>Periods won</td>
                {wins.map((w, i) => {
                  const isTop = w === maxWins;
                  return (
                    <td key={i} style={{ padding: '10px 14px', textAlign: 'right', background: isTop ? 'rgba(145,47,99,0.06)' : 'var(--bg-secondary)', borderTop: '2px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
                      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, display: 'block', color: isTop ? 'var(--brand-primary)' : 'var(--text-primary)' }}>{w}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{isTop ? '★ leading' : 'periods'}</span>
                    </td>
                  );
                })}
              </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (activeTab === 'risk') {
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><FundHeader /></thead>
            <tbody>
              <SectionHead label="1-year risk metrics" />
              <Row label="Sharpe (1Y)"    vals={F.map(f => f.data?.risk?.sharpe_ratio_1y)}    fmtFn={v => fmt(v)} showBar />
              <Row label="Alpha (1Y)"     vals={F.map(f => f.data?.risk?.alpha_1y)}            fmtFn={pct} showBar />
              <Row label="Beta (1Y)"      vals={F.map(f => f.data?.risk?.beta_1y)}             fmtFn={v => fmt(v)} lowerBetter />
              <Row label="Up cap (1Y)"    vals={F.map(f => f.data?.risk?.up_capture_1y)}       fmtFn={pctc} />
              <Row label="Down cap (1Y)"  vals={F.map(f => f.data?.risk?.down_capture_1y)}     fmtFn={pctc} lowerBetter />
              <SectionHead label="3-year risk metrics" />
              <Row label="Sharpe ratio"   vals={F.map(f => f.data?.risk?.sharpe_ratio_3y)}   fmtFn={v => fmt(v)} showBar />
              <Row label="Sortino ratio"  vals={F.map(f => f.data?.risk?.sortino_ratio_3y)}  fmtFn={v => fmt(v)} showBar />
              <Row label="Alpha"          vals={F.map(f => f.data?.risk?.alpha_3y)}           fmtFn={pct}         showBar />
              <Row label="Beta"           vals={F.map(f => f.data?.risk?.beta_3y)}            fmtFn={v => fmt(v)} lowerBetter />
              <Row label="Up capture"     vals={F.map(f => f.data?.risk?.up_capture_3y)}      fmtFn={pctc} />
              <Row label="Down capture"   vals={F.map(f => f.data?.risk?.down_capture_3y)}    fmtFn={pctc} lowerBetter />
              <Row label="Std deviation"  vals={F.map(f => f.data?.risk?.std_dev_3y)}         fmtFn={pctc} lowerBetter />
              <SectionHead label="Cost & rating" />
              <Row label="Expense ratio"  vals={F.map(f => f.data?.expense_ratio)}             fmtFn={pctc} lowerBetter showBar />
              <Row label="Morningstar ★"  vals={F.map(f => f.data?.morningstar_rating)}        fmtFn={v => (v && v !== '-') ? `${Math.round(parseFloat(v))} ★` : '—'} />
            </tbody>
          </table>
        </div>
      );
    }

    if (activeTab === 'composition') {
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><FundHeader /></thead>
            <tbody>
              <SectionHead label="Market cap split" />
              <Row label="Large cap"   vals={F.map(f => f.data?.large_cap)}   fmtFn={pctc} showBar />
              <Row label="Mid cap"     vals={F.map(f => f.data?.mid_cap)}     fmtFn={pctc} showBar />
              <Row label="Small cap"   vals={F.map(f => f.data?.small_cap)}   fmtFn={pctc} showBar />
              <SectionHead label="Asset allocation" />
              <Row label="Equity"      vals={F.map(f => f.data?.equity_pct)}  fmtFn={pctc} showBar />
              <Row label="Bonds"       vals={F.map(f => f.data?.bond_pct)}    fmtFn={pctc} showBar />
              <Row label="Cash"        vals={F.map(f => f.data?.cash_pct)}    fmtFn={pctc} showBar />
              <SectionHead label="Valuation metrics" />
              <Row label="P/E ratio"   vals={F.map(f => f.data?.pe_ratio)}    fmtFn={v => fmt(v)} />
              <Row label="P/B ratio"   vals={F.map(f => f.data?.pb_ratio)}    fmtFn={v => fmt(v)} />
            </tbody>
          </table>
        </div>
      );
    }

    if (activeTab === 'info') {
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><FundHeader /></thead>
            <tbody>
              <SectionHead label="Fund details" />
              <Row label="Fund house"    vals={F.map(f => f.data?.name?.split(' ')[0] || '—')}   fmtFn={v => v} />
              <Row label="Category"      vals={F.map(f => f.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '') || '—')} fmtFn={v => v} />
              <Row label="AUM"           vals={F.map(f => f.data?.fund_size)}                    fmtFn={fmtAum} />
              <Row label="Expense ratio" vals={F.map(f => f.data?.expense_ratio)}                fmtFn={pctc} lowerBetter />
              <Row label="Inception"     vals={F.map(f => f.data?.inception_date || '—')}        fmtFn={v => v} />
              <Row label="Fund manager"  vals={F.map(f => f.data?.manager_name || '—')}          fmtFn={v => v} />
              <Row label="52W high"      vals={F.map(f => f.data?.nav_52w_high)}                 fmtFn={v => (v && v !== '-') ? `₹${fmt(v)}` : '—'} />
              <Row label="52W low"       vals={F.map(f => f.data?.nav_52w_low)}                  fmtFn={v => (v && v !== '-') ? `₹${fmt(v)}` : '—'} />
              <Row label="ISIN"          vals={F.map(f => f.isin || '—')}                        fmtFn={v => v} />
              <SectionHead label="Exit load" />
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, verticalAlign: 'top', width: 160 }}>Details</td>
                {F.map((f, i) => (
                  <td key={i} style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-secondary)', borderLeft: '1px solid var(--border)', verticalAlign: 'top', lineHeight: 1.6, textAlign: 'left' }}>
                    {f.data?.exit_load && f.data.exit_load !== '-' ? f.data.exit_load : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      );
    }
  }

  const tabs = ['returns', 'risk', 'composition', 'info', 'overlap'];
  const tabLabels = { returns: 'Returns', risk: 'Risk metrics', composition: 'Composition', info: 'Fund info', overlap: 'Overlap' };

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 3, letterSpacing: '-.02em' }}>Fund comparison</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Compare up to 4 funds across returns, risk, calendar years and composition</div>
        </div>
        <div ref={wlRef} style={{ position: 'relative' }}>
          <button onClick={openWlDropdown} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 500, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            + From watchlist
          </button>
          {wlDropdownOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, width: 320, maxHeight: 320, overflowY: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000, marginTop: 4 }}>
              {watchlistFunds.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Your watchlist is empty</div>
              ) : (
                watchlistFunds.map((wf, idx) => {
                  const alreadyIn = funds.some(f => f.isin === wf.isin);
                  const isFull = funds.length >= MAX;
                  return (
                    <div key={wf.isin} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: idx < watchlistFunds.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--brand-mid)', marginTop: 2 }}>{wf.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</div>
                      </div>
                      <button
                        onClick={() => {
                          if (alreadyIn || isFull) return;
                          addFund(wf);
                          setWlDropdownOpen(false);
                        }}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: 'none',
                          cursor: alreadyIn || isFull ? 'default' : 'pointer',
                          background: alreadyIn ? 'rgba(16,185,129,0.1)' : isFull ? 'var(--bg-secondary)' : 'var(--brand-primary)',
                          color: alreadyIn ? '#059669' : isFull ? 'var(--text-muted)' : '#fff',
                          whiteSpace: 'nowrap', flexShrink: 0,
                        }}
                      >
                        {alreadyIn ? '✓ Added' : isFull ? 'Full' : '+ Compare'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

            {/* 4-slot fund boxes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {[0, 1, 2, 3].map(idx => {
          const fund = funds[idx];
          const color = fund?.color || CMP_COLORS[idx];
          const isLoading = fund && loadingIsins.has(fund.isin);
          return (
            <div key={idx} ref={slotRefs[idx]} style={{ position: 'relative' }} onBlur={e => handleSlotBlur(idx, e)}>
              {fund ? (
                // Filled slot
                <div style={{ padding: '14px', borderRadius: 10, border: `1px solid var(--border)`, borderTop: `3px solid ${color}`, background: '#fff', boxShadow: 'var(--shadow-card)', minHeight: 100 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-dark)', lineHeight: 1.3, marginBottom: 4 }}>{fund.name}</div>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(145,47,99,0.08)', color: 'var(--brand-primary)', fontWeight: 500 }}>
                        {fund.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}
                      </span>
                    </div>
                    <button onClick={() => removeFund(fund.isin)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 0 0 8px', flexShrink: 0 }}>×</button>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color }}>
                      {fund.data?.nav && fund.data.nav !== '-' ? `₹${parseFloat(fund.data.nav).toFixed(2)}` : '—'}
                    </span>
                    {fund.data?.returns?.['1y'] && fund.data.returns['1y'] !== '-' && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: parseFloat(fund.data.returns['1y']) >= 0 ? '#059669' : '#DC2626' }}>
                        {pct(fund.data.returns['1y'])} 1Y
                      </span>
                    )}
                  </div>
                  {fund.data?.morningstar_rating && fund.data.morningstar_rating !== '-' && (
                    <div style={{ fontSize: 11, color: '#B46B10', letterSpacing: -1, marginTop: 4 }}>{stars(fund.data.morningstar_rating)}</div>
                  )}
                </div>
              ) : (
                // Empty slot with search
                <div style={{ borderRadius: 10, border: '1px dashed var(--border)', background: 'var(--bg-secondary)', minHeight: 100, padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>Fund {idx + 1}</div>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={slotSearchQ[idx]}
                      onChange={e => handleSlotSearch(idx, e.target.value)}
                      onFocus={() => { if (slotResults[idx].length > 0) setSlotOpen(prev => { const s = [...prev]; s[idx] = true; return s; }); }}
                      placeholder="Search fund, AMC or ISIN…"
                      style={{ width: '100%', padding: '7px 28px 7px 10px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff' }}
                    />
                    {slotLoading[idx] && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-muted)' }}>...</span>}
                    {slotSearchQ[idx] && !slotLoading[idx] && (
                      <span onClick={() => handleSlotSearch(idx, '')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1 }}>×</span>
                    )}
                  </div>
                  {slotOpen[idx] && slotResults[idx].length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 280, overflowY: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000, marginTop: 2 }}>
                      {slotResults[idx].filter(r => !funds.find(f => f.isin === r.isin)).map((result, ri, arr) => (
                        <div key={result.isin}
                          onClick={() => addFund(result, idx)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: ri < arr.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
                          tabIndex={0}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.name}</div>
                            <span style={{ fontSize: 10, color: 'var(--brand-mid)', background: 'rgba(109,84,121,0.08)', padding: '1px 5px', borderRadius: 3 }}>
                              {result.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}
                            </span>
                          </div>
                          {result.return_1y !== null && result.return_1y !== undefined && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: result.return_1y >= 0 ? '#059669' : '#DC2626', flexShrink: 0, textAlign: 'right' }}>
                              {pct(result.return_1y)}<div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>1Y</div>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {funds.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: 'var(--text-muted)', textAlign: 'center', background: '#fff', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: 32, opacity: .25 }}>⊞</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)' }}>Add funds to compare</div>
          <div style={{ fontSize: 13, maxWidth: 240, color: 'var(--text-muted)' }}>
            'Search and add 2–4 funds using the input above.'
          </div>
        </div>
      )}

      {/* Comparison table */}
      {funds.length >= 1 && (
        <div style={activeTab === 'overlap' ? {} : { background: '#fff', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', background: '#fff', borderRadius: activeTab === 'overlap' ? '12px 12px 0 0' : 0 }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setActiveTabPersist(t)} style={{
                padding: '10px 14px', fontSize: 12, fontWeight: activeTab === t ? 500 : 400,
                color: activeTab === t ? 'var(--brand-primary)' : 'var(--text-muted)',
                border: 'none', background: 'none', borderBottom: `2px solid ${activeTab === t ? 'var(--brand-primary)' : 'transparent'}`,
                cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap',
              }}>{tabLabels[t]}</button>
            ))}
          </div>

          {/* Table */}
          <div style={activeTab === 'overlap' ? { padding: '16px 0' } : { overflowX: 'auto' }}>
            {renderTable()}
          </div>
        </div>
      )}
    </div>
  );
}