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
  if (valid.length < 2) return vals.map(() => '');
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
  const [funds, setFunds] = useState([]);          // { isin, name, category, asset_class, color, data }
  const [activeTab, setActiveTab] = useState('returns');
  const [slotSearchQ, setSlotSearchQ] = useState(['', '', '', '']);
  const [slotResults, setSlotResults] = useState([[], [], [], []]);
  const [slotOpen, setSlotOpen] = useState([false, false, false, false]);
  const [slotLoading, setSlotLoading] = useState([false, false, false, false]);
  const [loadingIsins, setLoadingIsins] = useState(new Set());
  const slotRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;
  const MAX = 4;

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

  // Add from watchlist
  function addFromWatchlist() {
    try {
      const wl = JSON.parse(localStorage.getItem('buglerock_watchlist') || '[]');
      const usedIsins = funds.map(f => f.isin);
      const toAdd = wl.filter(f => !usedIsins.includes(f.isin)).slice(0, MAX - funds.length);
      if (!toAdd.length) return;
      toAdd.forEach(f => addFund(f));
    } catch {}
  }

  // ── Table helpers ──────────────────────────────────────────────────────────

  function Row({ label, vals, fmtFn, lowerBetter, showBar }) {
    const hl = highlight(vals, lowerBetter);
    const nums = vals.map(v => (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null);
    const maxAbs = Math.max(...nums.filter(v => v !== null && !isNaN(v)).map(Math.abs), 1);

    return (
      <tr style={{ borderBottom: '1px solid var(--border)' }}
        onMouseEnter={e => [...e.currentTarget.cells].forEach(c => c.style.background = 'var(--bg-secondary)')}
        onMouseLeave={e => [...e.currentTarget.cells].forEach(c => c.style.background = '')}
      >
        <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap', width: 160, minWidth: 160, background: '#fff' }}>{label}</td>
        {vals.map((v, i) => {
          const cls = hl[i];
          const bg = cls === 'best' ? 'rgba(16,185,129,0.08)' : cls === 'worst' ? 'rgba(239,68,68,0.08)' : '#fff';
          const color = cls === 'best' ? '#059669' : cls === 'worst' ? '#DC2626' : 'var(--text-primary)';
          const txt = fmtFn(v);
          const barW = (showBar && v !== null && v !== '-') ? (Math.abs(parseFloat(v)) / maxAbs * 100).toFixed(0) : 0;
          const barClr = cls === 'best' ? '#059669' : cls === 'worst' ? '#DC2626' : '#A795AE';
          return (
            <td key={i} style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, background: bg, color, borderLeft: '1px solid var(--border)', transition: 'background .1s' }}>
              {showBar && v !== null && v !== '-' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <div style={{ width: 40, height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{ width: `${barW}%`, height: '100%', background: barClr, borderRadius: 2 }} />
                  </div>
                  {txt}
                </div>
              ) : txt}
            </td>
          );
        })}
      </tr>
    );
  }

  function SectionHead({ label }) {
    return (
      <tr>
        <td style={{ padding: '7px 14px', fontSize: 9, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--brand-primary)', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>{label}</td>
        {funds.map((_, i) => (
          <td key={i} style={{ padding: '7px 14px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }} />
        ))}
      </tr>
    );
  }

  function FundHeader() {
    return (
      <tr style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', boxShadow: '0 1px 0 var(--border)' }}>
        <th style={{ padding: 0, width: 160, minWidth: 160, background: '#fff' }} />
        {funds.map((f, i) => (
          <th key={f.isin} style={{ padding: '12px 14px 10px', borderLeft: '1px solid var(--border)', borderTop: `3px solid ${f.color}`, verticalAlign: 'top', minWidth: 180, fontWeight: 'normal', background: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-dark)', lineHeight: 1.3, marginBottom: 4 }}>{f.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(145,47,99,0.08)', color: 'var(--brand-primary)', fontWeight: 500 }}>
                  {f.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}
                </span>
                {f.data?.fund_size && f.data.fund_size !== '-' && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(109,84,121,0.08)', color: 'var(--brand-mid)', fontWeight: 500, marginLeft: 4 }}>{fmtAum(f.data.fund_size)}</span>
                )}
              </div>
              <div style={{ marginTop: 2 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: f.color }}>
                  {f.data?.nav && f.data.nav !== '-' ? `₹${parseFloat(f.data.nav).toFixed(2)}` : '—'}
                </span>
                {f.data?.returns?.['1d'] && f.data.returns['1d'] !== '-' && (
                  <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 6, color: parseFloat(f.data.returns['1d']) >= 0 ? '#059669' : '#DC2626' }}>
                    {pct(f.data.returns['1d'])} today
                  </span>
                )}
              </div>
              {f.data?.morningstar_rating && f.data.morningstar_rating !== '-' && (
                <div style={{ fontSize: 12, color: '#B46B10', letterSpacing: -1 }}>{stars(f.data.morningstar_rating)}</div>
              )}
            </div>
          </th>
        ))}
      </tr>
    );
  }

  // ── Tally row for returns tab ──────────────────────────────────────────────
  function tallyWins() {
    const wins = funds.map(() => 0);
    const retKeys = ['1m', '3m', '6m', '1y', '2y', '3y', '5y', '10y', 'ytd', 'cy2025', 'cy2024', 'cy2023', 'cy2022', 'cy2021'];
    retKeys.forEach(k => {
      const vals = funds.map(f => f.data?.returns?.[k]);
      const nums = vals.map(v => (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null);
      const valid = nums.filter(v => v !== null && !isNaN(v));
      if (!valid.length) return;
      const best = Math.max(...valid);
      nums.forEach((v, i) => { if (v === best) wins[i]++; });
    });
    return wins;
  }

  // ── Render tabs ────────────────────────────────────────────────────────────
  function renderTable() {
    if (funds.length < 2) return null;
    const F = funds;

    if (activeTab === 'returns') {
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
              {/* Tally row */}
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
              <SectionHead label="3-year risk metrics" />
              <Row label="Sharpe ratio"   vals={F.map(f => f.data?.risk?.sharpe_ratio_3y)}   fmtFn={v => fmt(v)} showBar />
              <Row label="Sortino ratio"  vals={F.map(f => f.data?.risk?.sortino_ratio_3y)}  fmtFn={v => fmt(v)} showBar />
              <Row label="Alpha"          vals={F.map(f => f.data?.risk?.alpha_3y)}           fmtFn={pct}         showBar />
              <Row label="Beta"           vals={F.map(f => f.data?.risk?.beta_3y)}            fmtFn={v => fmt(v)} lowerBetter />
              <Row label="Up capture"     vals={F.map(f => f.data?.risk?.up_capture_3y)}      fmtFn={pctc} />
              <Row label="Down capture"   vals={F.map(f => f.data?.risk?.down_capture_3y)}    fmtFn={pctc} lowerBetter />
              <Row label="Std deviation"  vals={F.map(f => f.data?.risk?.std_dev_3y)}         fmtFn={pctc} lowerBetter />
              <SectionHead label="1-year risk metrics" />
              <Row label="Sharpe (1Y)"    vals={F.map(f => f.data?.risk?.sharpe_ratio_1y)}    fmtFn={v => fmt(v)} />
              <Row label="Alpha (1Y)"     vals={F.map(f => f.data?.risk?.alpha_1y)}            fmtFn={pct} />
              <Row label="Beta (1Y)"      vals={F.map(f => f.data?.risk?.beta_1y)}             fmtFn={v => fmt(v)} lowerBetter />
              <Row label="Up cap (1Y)"    vals={F.map(f => f.data?.risk?.up_capture_1y)}       fmtFn={pctc} />
              <Row label="Down cap (1Y)"  vals={F.map(f => f.data?.risk?.down_capture_1y)}     fmtFn={pctc} lowerBetter />
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

  const tabs = ['returns', 'risk', 'composition', 'info'];
  const tabLabels = { returns: 'Returns', risk: 'Risk metrics', composition: 'Composition', info: 'Fund info' };

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 3, letterSpacing: '-.02em' }}>Fund comparison</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Compare up to 4 funds across returns, risk, calendar years and composition</div>
        </div>
        <button onClick={addFromWatchlist} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 500, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          + From watchlist
        </button>
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
      {funds.length < 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: 'var(--text-muted)', textAlign: 'center', background: '#fff', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: 32, opacity: .25 }}>⊞</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)' }}>Add funds to compare</div>
          <div style={{ fontSize: 13, maxWidth: 240, color: 'var(--text-muted)' }}>
            {funds.length === 0 ? 'Search and add 2–4 funds using the input above.' : 'Add one more fund to start comparing.'}
          </div>
        </div>
      )}

      {/* Comparison table */}
      {funds.length >= 2 && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', background: '#fff' }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                padding: '10px 14px', fontSize: 12, fontWeight: activeTab === t ? 500 : 400,
                color: activeTab === t ? 'var(--brand-primary)' : 'var(--text-muted)',
                border: 'none', background: 'none', borderBottom: `2px solid ${activeTab === t ? 'var(--brand-primary)' : 'transparent'}`,
                cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap',
              }}>{tabLabels[t]}</button>
            ))}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            {renderTable()}
          </div>
        </div>
      )}
    </div>
  );
}