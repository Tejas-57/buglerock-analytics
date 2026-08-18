import React, { useState, useEffect } from 'react';
import { fp, f2 } from './BuildPortfolio';
import AIDoctor from './analyseTabs/AIDoctor.jsx';
import PortfolioXRay from './analyseTabs/PortfolioXRay.jsx';

const API = process.env.REACT_APP_API_URL || '';

const TABS = [
  { id: 'doctor',   label: 'AI Doctor',             hidden: true },
  { id: 'xray',     label: 'Portfolio X-Ray',        sep_after: true },
  { id: 'overview', label: 'Overview' },
  { id: 'returns',  label: 'Returns & projections' },
  { id: 'risk',     label: 'Risk metrics',           sep_after: true },
  { id: 'correlation', label: 'Correlation' },
  { id: 'overlap',  label: 'Overlap' },
  { id: 'drift',    label: 'Style & drift',          sep_after: true },
  { id: 'stress',   label: 'Stress test' },
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'whatif',   label: 'What-If',               sep_after: true },
  { id: 'funds',    label: 'Fund details' },
].filter(t => !t.hidden);

function blendFromSnaps(funds, weights, snapshots) {
  function get(isin, getter) {
    const snap = snapshots[isin];
    if (!snap) return null;
    const v = getter(snap);
    if (v==null||v==='-'||v===''||isNaN(parseFloat(v))) return null;
    return parseFloat(v);
  }

  // Build category avg for each metric from all available snapshots
  // Used as proxy when a specific fund lacks a metric (e.g. new fund with no 3Y history)
  function catAvg(category, getter) {
    const vals = Object.values(snapshots)
      .filter(s => s && s.category === category)
      .map(s => { const v = getter(s); return v==null||v==='-'||v===''||isNaN(parseFloat(v)) ? null : parseFloat(v); })
      .filter(v => v != null);
    return vals.length > 0 ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
  }

  function wblend(getter) {
    let val=0, cov=0;
    funds.forEach(f => {
      const w = weights[f.isin] || 0;
      if (!w) return;
      let v = get(f.isin, getter);
      // Fallback to category avg if fund metric is missing
      if (v == null) {
        const cat = snapshots[f.isin]?.category;
        if (cat) v = catAvg(cat, getter);
      }
      if (v == null || isNaN(v)) return;
      val += v * w; cov += w;
    });
    return cov > 0 ? val / cov : null;
  }
  return {
    return_1y:       wblend(s=>s.returns?.['1y']),
    return_3y:       wblend(s=>s.returns?.['3y']),
    return_5y:       wblend(s=>s.returns?.['5y']),
    return_1m:       wblend(s=>s.returns?.['1m']),
    return_3m:       wblend(s=>s.returns?.['3m']),
    return_6m:       wblend(s=>s.returns?.['6m']),
    return_ytd:      wblend(s=>s.returns?.['ytd']),
    return_cy2025:   wblend(s=>s.returns?.['cy2025']),
    return_cy2024:   wblend(s=>s.returns?.['cy2024']),
    return_cy2023:   wblend(s=>s.returns?.['cy2023']),
    return_cy2022:   wblend(s=>s.returns?.['cy2022']),
    return_cy2021:   wblend(s=>s.returns?.['cy2021']),
    sharpe_ratio_3y: wblend(s=>s.risk?.sharpe_ratio_3y),
    sortino_ratio_3y:wblend(s=>s.risk?.sortino_ratio_3y),
    alpha_3y:        wblend(s=>s.risk?.alpha_3y),
    beta_3y:         wblend(s=>s.risk?.beta_3y),
    down_capture_3y: wblend(s=>s.risk?.down_capture_3y),
    up_capture_3y:   wblend(s=>s.risk?.up_capture_3y),
    std_dev_3y:      wblend(s=>s.risk?.std_dev_3y),
    expense_ratio:   wblend(s=>s.expense_ratio),
    large_cap:       wblend(s=>s.large_cap),
    mid_cap:         wblend(s=>s.mid_cap),
    small_cap:       wblend(s=>s.small_cap),
    equity_pct:      wblend(s=>s.equity_pct),
    bond_pct:        wblend(s=>s.bond_pct),
    cash_pct:        wblend(s=>s.cash_pct),
    other_pct:       wblend(s=>s.other_pct),
    pe_ratio:        wblend(s=>s.pe_ratio),
    pb_ratio:        wblend(s=>s.pb_ratio),
    expense_ratio:   wblend(s=>s.expense_ratio),
    fund_size:       wblend(s=>s.fund_size),
  };
}
function blend(funds, weights, keys) { return {}; } // legacy stub

/**
 * blendAssetClass — computes asset class exposure by fund asset_class field.
 * Gold/silver ETFs (Precious Metals) are separated from Equity.
 * Hybrid funds are split by their equity_pct/bond_pct breakdown.
 * Returns: { equity, debt, cash, commodity, other } — all as portfolio-level % (0-100).
 */
function blendAssetClass(funds, weights, snapshots) {
  let equity=0, debt=0, cash=0, commodity=0, other=0, totalW=0;
  funds.forEach(f => {
    const w = weights[f.isin] || 0;
    if (!w) return;
    const s = snapshots[f.isin] || {};
    const ac = (s.asset_class || f.asset_class || '').toLowerCase();
    const isPM = ac === 'precious metals';
    const isDebt = ac === 'debt' || ac === 'bond';
    const isHybrid = ac === 'hybrid' || ac === 'allocation' || ac === 'multi-asset';

    const eqPct   = parseFloat(s.equity_pct)  || 0;
    const bdPct   = parseFloat(s.bond_pct)    || 0;
    const cashPct = parseFloat(s.cash_pct)    || 0;
    const otherPct= parseFloat(s.other_pct)   || 0;
    const tot = eqPct + bdPct + cashPct + otherPct || 100;

    if (isPM) {
      commodity += w;
    } else if (isDebt) {
      debt   += (bdPct/tot*100) * w / 100;
      cash   += (cashPct/tot*100) * w / 100;
      other  += (otherPct/tot*100) * w / 100;
      // remaining as debt
      const rem = 1 - (bdPct+cashPct+otherPct)/tot;
      debt += rem * w;
    } else if (isHybrid) {
      equity += (eqPct/tot*100) * w / 100;
      debt   += (bdPct/tot*100) * w / 100;
      cash   += (cashPct/tot*100) * w / 100;
      other  += (otherPct/tot*100) * w / 100;
    } else {
      // Pure equity — use equity_pct if available, else 100% equity
      equity += (eqPct > 0 ? eqPct/tot*100 : 100) * w / 100;
      debt   += (bdPct/tot*100) * w / 100;
      cash   += (cashPct/tot*100) * w / 100;
      other  += (otherPct/tot*100) * w / 100;
    }
    totalW += w;
  });
  if (!totalW) return { equity:0, debt:0, cash:0, commodity:0, other:0 };
  return {
    equity:    equity    / totalW * 100,
    debt:      debt      / totalW * 100,
    cash:      cash      / totalW * 100,
    commodity: commodity / totalW * 100,
    other:     other     / totalW * 100,
  };
}


// Dynamic calendar year keys — last 5 completed years only
const _CUR_YEAR = new Date().getFullYear();
const _CY_YEARS = [_CUR_YEAR-5, _CUR_YEAR-4, _CUR_YEAR-3, _CUR_YEAR-2, _CUR_YEAR-1];
const CY_KEYS = _CY_YEARS.map(y => 'cy'+y);
const CY_LBL  = _CY_YEARS.map(y => String(y));

function pearson(a, b) {
  const pairs = a.map((v, i) => [v, b[i]]).filter(p => p[0] != null && p[1] != null);
  if (pairs.length < 2) return null;
  const n = pairs.length;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
  const num = pairs.reduce((s, p) => s + (p[0] - ma) * (p[1] - mb), 0);
  const da = Math.sqrt(pairs.reduce((s, p) => s + Math.pow(p[0] - ma, 2), 0));
  const db = Math.sqrt(pairs.reduce((s, p) => s + Math.pow(p[1] - mb, 2), 0));
  if (da === 0 || db === 0) return null;
  return num / (da * db);
}

function corrColor(v) {
  if (v == null) return { bg: '#f5f5f5', color: '#999' };
  if (v >= 0.9) return { bg: '#fde8ee', color: '#912F63' };
  if (v >= 0.7) return { bg: '#fef3e2', color: '#D97706' };
  if (v >= 0.5) return { bg: '#f0f9f5', color: '#1A7A52' };
  return { bg: '#eef0f7', color: '#3E3452' };
}

function fmtL(v) { return v >= 100000 ? '₹' + (v / 100000).toFixed(2) + 'L' : '₹' + (v / 1000).toFixed(1) + 'K'; }

export default function Analyse({ funds, weights, snapshots={}, benchmarks=[], ips, onEdit, onOptimise, onDataUpdate, setWeights, setFunds, setSnapshots, selectedDate, onBackToBuild }) {
  const [activeTab, setActiveTab] = useState('xray');

  // Sensitivity tab sliders
  const [sensMarket, setSensMarket] = useState(0);
  const [histVar, setHistVar] = useState(null);
  const [histVarLoading, setHistVarLoading] = useState(false);

  // Fetch histVar when sensitivity or xray tab is active
  React.useEffect(() => {
    if ((activeTab !== 'sensitivity' && activeTab !== 'xray') || histVar || histVarLoading || !funds.length) return;
    const isins = funds.map(f=>f.isin).join(',');
    const ws    = funds.map(f=>weights[f.isin]||0).join(',');
    const cats  = funds.map(f=>snapshots[f.isin]?.category||'').join(',');
    const acs   = funds.map(f=>snapshots[f.isin]?.asset_class||'').join(',');
    const sds   = funds.map(f=>{ const s=snapshots[f.isin]?.risk?.std_dev_3y; const v=s&&s!=='-'?parseFloat(s):-1; return isNaN(v)?-1:v; }).join(',');
    const url = API+'/api/holdings/historical-var'
      +'?isins='+encodeURIComponent(isins)
      +'&weights='+encodeURIComponent(ws)
      +'&categories='+encodeURIComponent(cats)
      +'&asset_classes='+encodeURIComponent(acs)
      +'&std_devs='+encodeURIComponent(sds);
    setHistVarLoading(true);
    fetch(url)
      .then(r=>r.json()).then(d=>{ setHistVar(d); setHistVarLoading(false); })
      .catch(()=>setHistVarLoading(false));
  }, [activeTab, funds.map(f=>f.isin).join(','), Object.keys(snapshots).length]);


  const [sensRate, setSensRate] = useState(0);

  // What-If tab state
  const [wiFromIsin, setWiFromIsin] = useState('');
  const [wiSwaps, setWiSwaps] = useState(() => {
    try {
      const saved = localStorage.getItem('buglerock_wi_swaps');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [{ from: '', to: '' }];
  });
  // Persist wiSwaps to localStorage whenever it changes
  React.useEffect(() => {
    try { localStorage.setItem('buglerock_wi_swaps', JSON.stringify(wiSwaps)); } catch {}
  }, [JSON.stringify(wiSwaps)]);
  const [wiSwapSnaps, setWiSwapSnaps] = useState({});  // snapshots for candidate funds fetched on-demand
  const [wiCandidates, setWiCandidates] = useState([]);
  const [wiSearchQ, setWiSearchQ] = useState('');
  const [wiSearchResults, setWiSearchResults] = useState([]);
  const [wiSearching, setWiSearching] = useState(false);
  const [wiSwapQ, setWiSwapQ] = useState(['', '', '']);        // search query per swap slot
  const [wiSwapRes, setWiSwapRes] = useState([[], [], []]);    // search results per swap slot
  const [wiSwapLoading, setWiSwapLoading] = useState([false, false, false]);

  // Fetch snapshot on-demand for any 'to' fund selected in swap rows
  useEffect(() => {
    const toIsins = wiSwaps.map(s => s.to).filter(Boolean);
    const missing = toIsins.filter(isin => !wiSwapSnaps[isin] && !snapshots[isin]);
    if (missing.length === 0) return;
    const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().slice(0,10) : selectedDate;
    if (!dateStr) return;
    Promise.allSettled(
      missing.map(isin =>
        fetch(`${API}/api/home/snapshot?isin=${isin}&date=${dateStr}`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      )
    ).then(results => {
      const newSnaps = { ...wiSwapSnaps };
      missing.forEach((isin, i) => {
        if (results[i].status === 'fulfilled' && results[i].value) newSnaps[isin] = results[i].value;
      });
      setWiSwapSnaps(newSnaps);
    });
  }, [wiSwaps.map(s => s.to).join(','), selectedDate]);

  // Fetch R1/R2 candidates for whichever fund was last selected in swaps
  useEffect(() => {
    const lastFrom = [...wiSwaps].reverse().find(s => s.from)?.from;
    if (!lastFrom) { setWiCandidates([]); return; }
    const fromFund = funds.find(f => f.isin === lastFrom);
    const fromCategory = fromFund?.category || snapshots[lastFrom]?.category || '';
    if (!fromCategory) return;
    fetch(`${API}/api/funds/peers?category=${encodeURIComponent(fromCategory)}&rankings=R1,R2&exclude=${lastFrom}`)
      .then(r => r.json())
      .then(d => setWiCandidates(d.funds || []))
      .catch(() => setWiCandidates([]));
  }, [wiSwaps.map(s => s.from).join(','), funds.map(f=>f.isin).join(',')]);
  const [wiShift, setWiShift] = useState(() => {
    try { const s = localStorage.getItem('buglerock_wi_shift'); return s ? parseFloat(s) : 0; } catch { return 0; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('buglerock_wi_shift', String(wiShift)); } catch {}
  }, [wiShift]);
  const [prevWeights, setPrevWeights] = useState(() => {
    try { const s = localStorage.getItem('buglerock_prev_weights'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  React.useEffect(() => {
    try {
      if (prevWeights) localStorage.setItem('buglerock_prev_weights', JSON.stringify(prevWeights));
      else localStorage.removeItem('buglerock_prev_weights');
    } catch {}
  }, [JSON.stringify(prevWeights)]);
  const [wiLump, setWiLump] = useState(10000000);   // 1 crore default (or IPS amount)
  const [wiSip, setWiSip] = useState(100000);        // 1 lakh default
  const [wiYears, setWiYears] = useState(10);
  const [wiInflation, setWiInflation] = useState(6);
  const [wiTarget, setWiTarget] = useState(50000000);

  // ── Overlap state & helpers ─────────────────────────────────────────────
  const [overlapData, setOverlapData] = useState(null);
  const [overlapLoading, setOverlapLoading] = useState(false);
  const [overlapError, setOverlapError] = useState(null);

  function shortFundName(name) {
    if (!name) return '';
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

  function isActiveEquityFund(f) {
    const snap = snapshots[f.isin];
    const ac  = (f.asset_class || snap?.asset_class || '').toLowerCase();
    const cat = (f.category || snap?.category || '').toLowerCase();
    return !(ac === 'debt' || ac === 'bond' || ac === 'precious metals' ||
      cat.includes('liquid') || cat.includes('overnight') ||
      cat.includes('money market') || cat.includes('gilt') ||
      cat.includes('ultra short') || cat.includes('low duration') ||
      cat.includes('corporate bond') || cat.includes('credit risk') ||
      cat.includes('banking and psu') || cat.includes('duration') ||
      cat.includes('floater') || cat.includes('fixed maturity') ||
      cat.includes('india oe') || cat.includes('gold') || cat.includes('silver') ||
      cat.includes('precious metal') ||
      (ac === '' && cat === ''));
  }

  const equityFundsForOverlap = funds.filter(isActiveEquityFund).map(f => ({
    ...f,
    color: f.color,
    data: snapshots[f.isin] || {},
  }));

  async function fetchOverlap() {
    if (equityFundsForOverlap.length < 2) return;
    const API = process.env.REACT_APP_API_URL || '';
    setOverlapLoading(true);
    setOverlapError(null);
    setOverlapData(null);
    try {
      const isins = equityFundsForOverlap.map(f => f.isin).join(',');
      const firstR = await fetch(`${API}/api/holdings/overlap?isins=${isins}`);
      if (!firstR.ok) throw new Error('Could not calculate overlap');
      const firstD = await firstR.json();
      const missing = equityFundsForOverlap.filter(f => (firstD.fund_holdings_counts?.[f.isin] ?? -1) === 0);
      if (missing.length > 0) {
        setOverlapError(`Fetching holdings for ${missing.map(f => shortFundName(f.name)).join(', ')}...`);
        await Promise.all(missing.map(f => fetch(`${API}/api/holdings/fetch/${f.isin}`, { method: 'POST' })));
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(res => setTimeout(res, 2000));
          const checkR = await fetch(`${API}/api/holdings/overlap?isins=${isins}`);
          if (checkR.ok) {
            const checkD = await checkR.json();
            if (equityFundsForOverlap.filter(f => (checkD.fund_holdings_counts?.[f.isin] ?? -1) === 0).length === 0) {
              setOverlapError(null); setOverlapData(checkD); return;
            }
          }
        }
        throw new Error('Holdings fetch timed out — please try again');
      }
      setOverlapData(firstD);
    } catch (e) { setOverlapError(e.message); }
    finally { setOverlapLoading(false); }
  }

  useEffect(() => {
    if ((activeTab === 'overlap' || activeTab === 'doctor' || activeTab === 'xray') && equityFundsForOverlap.length >= 2) fetchOverlap();
    else if (activeTab === 'overlap' && equityFundsForOverlap.length < 2) { setOverlapData(null); setOverlapError(null); }
  }, [activeTab, funds.map(f => f.isin).join(',')]);

  // ── Stress test state ────────────────────────────────────────────────────
  const [stressData, setStressData] = useState(null);
  const [stressLoading, setStressLoading] = useState(false);
  const [stressError, setStressError] = useState(null);
  const [bmStress, setBmStress] = useState(null);

  useEffect(() => {
    if (activeTab !== 'stress' || funds.length === 0) return;
    setStressLoading(true); setStressError(null); setStressData(null);
    const API = process.env.REACT_APP_API_URL || '';
    const isins = funds.map(f => f.isin).join(',');
    const wts = funds.map(f => (weights[f.isin] || 0)).join(',');
    fetch(`${API}/api/nav/stress-test?isins=${isins}&weights=${wts}`)
      .then(r => r.json())
      .then(d => { setStressData(d); setStressLoading(false); })
      .catch(e => { setStressError('Failed to load stress test data.'); setStressLoading(false); });

    // Fetch blended benchmark stress returns if benchmarks set
    if (benchmarks && benchmarks.length > 0) {
      const bmNames = benchmarks.map(b => b.name || b.display_name).join(',');
      const bmWts   = benchmarks.map(b => b.weight || 0).join(',');
      fetch(`${API}/api/benchmarks/stress-returns?index_names=${encodeURIComponent(bmNames)}&weights=${encodeURIComponent(bmWts)}`)
        .then(r => r.json()).then(d => setBmStress(d)).catch(() => setBmStress(null));
    } else { setBmStress(null); }
  }, [activeTab, funds.map(f => f.isin).join(','), JSON.stringify(weights)]);

  // ── Rolling returns state & fetch (daily-NAV based) ─────────────────────
  const [rollingData, setRollingData] = useState(null);
  const [rollingLoading, setRollingLoading] = useState(false);
  const [rollingError, setRollingError] = useState(null);
  const [bmRolling, setBmRolling] = useState(null);

  useEffect(() => {
    if (activeTab !== 'returns' || funds.length === 0) return;
    const API = process.env.REACT_APP_API_URL || '';
    const isins = funds.map(f => f.isin).join(',');
    setRollingLoading(true);
    setRollingError(null);
    fetch(`${API}/api/nav/rolling-metrics?isins=${isins}`)
      .then(r => { if (!r.ok) throw new Error('Failed to compute rolling metrics'); return r.json(); })
      .then(d => { setRollingData(d.funds || {}); setRollingLoading(false); })
      .catch(e => { setRollingError(e.message); setRollingLoading(false); });

    // Fetch benchmark rolling metrics if benchmarks are set
    if (benchmarks && benchmarks.length > 0) {
      const bmNames = benchmarks.map(b => b.name || b.display_name).join(',');
      const bmWts   = benchmarks.map(b => b.weight || 0).join(',');
      fetch(`${API}/api/benchmarks/rolling-metrics?index_names=${encodeURIComponent(bmNames)}&weights=${encodeURIComponent(bmWts)}`)
        .then(r => r.json())
        .then(d => setBmRolling(d))
        .catch(() => setBmRolling(null));
    } else {
      setBmRolling(null);
    }
  }, [activeTab, funds.map(f => f.isin).join(',')]);

  // Compute blended benchmark from benchmarks array (manual weights)
  const totalBmW = benchmarks.reduce((s, b) => s + (b.weight || 0), 0) || 1;
  // Returns { value, partial, missing[] } for a given getter across all benchmarks
  function blendBmMeta(getter) {
    let val = 0, cov = 0;
    const missing = [];
    benchmarks.forEach(b => {
      const v = getter(b);
      if (v == null || isNaN(parseFloat(v))) { missing.push(b.display_name); return; }
      val += parseFloat(v) * (b.weight || 0);
      cov += (b.weight || 0);
    });
    return {
      value:   cov > 0 ? val / cov : null,
      partial: missing.length > 0 && missing.length < benchmarks.length,
      missing,
    };
  }
  function blendBm(getter) { return blendBmMeta(getter).value; }

  // Collect all missing-data notes across all periods
  const BM_PERIOD_MAP = [
    ['1M',    b => b.return_1m],
    ['3M',    b => b.return_3m],
    ['6M',    b => b.return_6m],
    ['YTD',   b => b.return_ytd],
    ['1Y',    b => b.return_1y],
    ['3Y',    b => b.return_3y],
    ['5Y',    b => b.return_5y],
    ['CY2025',b => b.return_cy2025],
    ['CY2024',b => b.return_cy2024],
    ['CY2023',b => b.return_cy2023],
    ['CY2022',b => b.return_cy2022],
    ['CY2021',b => b.return_cy2021],
  ];
  // Build per-period meta
  const bmMeta = {};
  BM_PERIOD_MAP.forEach(([k, g]) => { bmMeta[k] = blendBmMeta(g); });

  // Collect unique missing notes: "Nifty Midcap 150 missing: 1M, 3M"
  const bmMissingNotes = (() => {
    const byBm = {};
    BM_PERIOD_MAP.forEach(([k, _]) => {
      bmMeta[k].missing.forEach(name => {
        if (!byBm[name]) byBm[name] = [];
        byBm[name].push(k);
      });
    });
    return Object.entries(byBm).map(([name, periods]) =>
      `${name}: missing ${periods.join(', ')}`
    );
  })();

  const isMultiBm = benchmarks.length > 1;
  const bmDisplayName = isMultiBm
    ? 'Blended Benchmark'
    : (benchmarks[0]?.display_name || 'Benchmark');
  const bmComposition = isMultiBm
    ? benchmarks.map(b => `${b.display_name} ${b.weight}%`).join(' + ')
    : null;

  // fp with ~ prefix for partial data
  function fpBm(key, getter) {
    const meta = blendBmMeta(getter);
    if (meta.value == null) return '—';
    const s = (parseFloat(meta.value) >= 0 ? '+' : '') + parseFloat(meta.value).toFixed(2) + '%';
    return meta.partial ? '~' + s : s;
  }

  const bm = benchmarks.length > 0 ? {
    name: benchmarks.length === 1
      ? benchmarks[0].display_name
      : benchmarks.map(b => `${b.display_name} (${b.weight}%)`).join(' + '),
    rets: {
      r1m:  blendBm(b => b.return_1m),
      r3m:  blendBm(b => b.return_3m),
      r6m:  blendBm(b => b.return_6m),
      ytd:  blendBm(b => b.return_ytd),
      r1y:  blendBm(b => b.return_1y),
      r3y:  blendBm(b => b.return_3y),
      r5y:  blendBm(b => b.return_5y),
      cy25: blendBm(b => b.return_cy2025),
      cy24: blendBm(b => b.return_cy2024),
      cy23: blendBm(b => b.return_cy2023),
      cy22: blendBm(b => b.return_cy2022),
      cy21: blendBm(b => b.return_cy2021),
    }
  } : {
    name: 'No benchmark selected',
    rets: { r1m: null, r3m: null, r6m: null, r1y: null, r3y: null, r5y: null, ytd: null, cy25: null, cy24: null, cy23: null, cy22: null, cy21: null }
  };
  const B = blendFromSnaps(funds, weights, snapshots);
  const AC = blendAssetClass(funds, weights, snapshots);
  const total = funds.reduce((s, f) => s + (weights[f.isin] || 0), 0);

  const investAmt = ips?.amount ? parseFloat(ips.amount.replace(/[^0-9.]/g, '')) : 1000000;
  const sipAmt = ips?.monthlySIP ? parseFloat(ips.monthlySIP.replace(/[^0-9.]/g, '')) : 10000;

  function sipFV(m, r, y) { const mo = r / 100 / 12; if (mo === 0) return m * 12 * y; return m * ((Math.pow(1 + mo, 12 * y) - 1) / mo) * (1 + mo); }

  const MUT_C='#6D5479',GR60_C='#A2A0A0',GR80_C='#374151',GR20_C='#E8E5EC',GR10_C='#F8F6FA',POS_C='#1A7A52',NEG_C='#B91C1C',WARN_C='#D97706',LAV_C='#A795AE',PLUM_C='#3E3452',BERRY_C='#912F63';

  // Asset class classification helpers — used in Sensitivity and What-If tabs
  function isEquityLike(fsnap, f) {
    const ac = (fsnap?.asset_class || f?.asset_class || '').toLowerCase();
    return ac.includes('equity') || ac.includes('etf') || ac.includes('index') || ac.includes('international');
  }
  function isDebtLike(fsnap, f) {
    const ac = (fsnap?.asset_class || f?.asset_class || '').toLowerCase();
    return ac.includes('debt');
  }
  function isHybrid(fsnap, f) {
    const ac = (fsnap?.asset_class || f?.asset_class || '').toLowerCase();
    return ac.includes('hybrid') || ac.includes('balanced') || ac.includes('allocation') || ac.includes('conservative') || ac.includes('aggressive');
  }

  const RISK_METRICS = [
    { k: 'sharpe_ratio_3y',  l: 'Sharpe (3Y)',  good: 0.6,  lb: false, fmt: v => f2(v),        sig: v => v > 0.7 ? ['Strong','pos'] : v > 0.4 ? ['Adequate','warn'] : ['Weak','neg'] },
    { k: 'sortino_ratio_3y', l: 'Sortino (3Y)', good: 0.8,  lb: false, fmt: v => f2(v),        sig: v => v > 1.0 ? ['Strong','pos'] : v > 0.6 ? ['Moderate','warn'] : ['Weak','neg'] },
    { k: 'alpha_3y',   l: 'Alpha (3Y)',   good: 0,    lb: false, fmt: v => fp(v),        sig: v => v > 2 ? ['Outperform','pos'] : v > 0 ? ['Positive','pos'] : ['Lagging','neg'] },
    { k: 'beta_3y',    l: 'Beta (3Y)',    good: 1.1,  lb: true,  fmt: v => f2(v),        sig: v => v < 0.8 ? ['Defensive','pos'] : v < 1.1 ? ['Mkt-like','pos'] : ['Aggressive','neg'] },
    { k: 'up_capture_3y',   l: 'Up capture',  good: 95,   lb: false, fmt: v => f2(v) + '%',  sig: v => v > 105 ? ['High','pos'] : v > 95 ? ['On par','pos'] : ['Low','warn'] },
    { k: 'down_capture_3y',   l: 'Dn capture',  good: 100,  lb: true,  fmt: v => f2(v) + '%',  sig: v => v < 90 ? ['Protected','pos'] : v < 100 ? ['Moderate','warn'] : ['Exposed','neg'] },
    { k: 'std_dev_3y',   l: 'Std dev (3Y)', good: 16,  lb: true,  fmt: v => f2(v) + '%',  sig: v => v < 12 ? ['Low vol','pos'] : v < 18 ? ['Moderate','warn'] : ['High vol','neg'] },
  ];
  const SIG_COL = { pos: 'var(--pos)', warn: '#D97706', neg: 'var(--brand-primary)' };
  const SIG_BG  = { pos: '#E6F4ED',    warn: '#FEF9EC', neg: 'rgba(145,47,99,.06)' };

  // Correlation matrix — fetched from backend using 3Y daily NAV returns
  const [corrData, setCorrData] = React.useState(null);
  const [corrLoading, setCorrLoading] = React.useState(false);

  // Lift computed data up to PortfolioBuilder for PDF export
  React.useEffect(() => {
    if (onDataUpdate) onDataUpdate({ stressData, overlapData, corrData });
  }, [stressData, overlapData, corrData]);

  React.useEffect(() => {
    if (activeTab !== 'correlation' || funds.length < 2) return;
    const API = process.env.REACT_APP_API_URL || '';
    const isins = funds.map(f => f.isin).join(',');
    setCorrLoading(true);
    fetch(`${API}/api/nav/correlation?isins=${isins}`)
      .then(r => r.json())
      .then(d => { setCorrData(d); setCorrLoading(false); })
      .catch(() => setCorrLoading(false));
  }, [activeTab, funds.map(f => f.isin).join(',')]);

  // Build corrMatrix from API response — align to current funds order
  const corrMatrix = funds.map(fi => funds.map(fj => {
    if (!corrData?.matrix || !corrData.included) return null;
    if (fi.isin === fj.isin) return 1.0;
    const ri = corrData.included.indexOf(fi.isin);
    const rj = corrData.included.indexOf(fj.isin);
    if (ri === -1 || rj === -1) return null;
    return corrData.matrix[ri][rj];
  }));

  // ── Export Overlap Report (mirrors Overlap tab styling exactly) ────────
  function generateOverlapPDF() {
    if (!overlapData) return;
    const funds2 = equityFundsForOverlap;
    const { pairwise_matrix, common_all, pair_details } = overlapData;
    const fundMap = Object.fromEntries(funds2.map(f => [f.isin, f]));
    const pairs = Object.values(pairwise_matrix);
    const overlapColor = (pct) => pct >= 35 ? '#C0392B' : pct >= 25 ? '#E67E22' : pct >= 15 ? '#F39C12' : pct >= 5 ? '#27AE60' : '#A0A0A0';
    const overlapLabel = (pct) => pct >= 35 ? 'Very High' : pct >= 25 ? 'High' : pct >= 15 ? 'Moderate' : pct >= 5 ? 'Low' : 'Negligible';
    const overlapBg = (pct) => pct >= 35 ? 'rgba(192,57,43,.10)' : pct >= 25 ? 'rgba(230,126,34,.10)' : pct >= 15 ? 'rgba(243,156,18,.10)' : pct >= 5 ? 'rgba(39,174,96,.10)' : '#f4f4f4';

    const avgOverlap = pairs.length ? (pairs.reduce((s, p) => s + p.overlap_pct, 0) / pairs.length).toFixed(1) : 0;
    const highestPair = pairs.reduce((best, p) => p.overlap_pct > (best?.overlap_pct || 0) ? p : best, null);
    const totalUniqueStocks = overlapData.unique_stock_count || '—';
    const heldByAllCount = common_all.length;
    const heldByAllName = common_all.length > 0 ? common_all[0].name : '—';

    const clientName = ips?.name || 'Client';
    const preparedBy = ips?.rm || 'BugleRock Capital';
    const refDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const PLUM = '#3E3452', BERRY = '#912F63';

    const statCardHtml = (value, label, sub, color) => `
      <div style="flex:1;background:#F7F5F3;border-radius:10px;padding:14px 16px;text-align:center;min-width:0">
        <div style="font-size:22px;font-weight:700;color:${color || BERRY};font-family:'DM Mono',monospace">${value}</div>
        <div style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8A8790;margin-top:4px">${label}</div>
        ${sub ? `<div style="font-size:10px;color:#4A4750;margin-top:3px">${sub}</div>` : ''}
      </div>`;

    const matrixHtml = `
      <table style="border-collapse:separate;border-spacing:5px;margin:0 auto">
        <thead><tr>
          <td style="width:110px"></td>
          ${funds2.map(f => `<th style="text-align:center;padding:0 3px 8px;font-size:9px;font-weight:500;width:74px">
            <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
              <div style="width:8px;height:8px;border-radius:2px;background:${f.color}"></div>
              <div style="max-width:70px;text-align:center;line-height:1.3">${shortFundName(f.name)}</div>
            </div>
          </th>`).join('')}
        </tr></thead>
        <tbody>
          ${funds2.map((fa, i) => `<tr>
            <td style="text-align:right;padding:3px 8px 3px 0;font-size:9px;font-weight:500;white-space:nowrap">
              <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${fa.color};margin-right:5px;vertical-align:middle"></span>${shortFundName(fa.name)}
            </td>
            ${funds2.map((fb, j) => {
              if (i === j) return `<td style="width:74px;height:46px;background:#f4f4f4;border-radius:7px;text-align:center;font-size:15px;color:#ccc">—</td>`;
              const key = i < j ? `${fa.isin}|${fb.isin}` : `${fb.isin}|${fa.isin}`;
              const p = pairwise_matrix[key]; const pct = p?.overlap_pct || 0;
              return `<td style="width:74px;height:46px;background:${overlapBg(pct)};border-radius:7px;text-align:center;vertical-align:middle">
                <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:15px;color:${overlapColor(pct)}">${pct.toFixed(0)}%</div>
              </td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:14px;margin-top:10px;font-size:9px;color:#8A8790;justify-content:center">
        <span><span style="color:#A0A0A0">●</span> &lt;5% Negligible</span>
        <span><span style="color:#27AE60">●</span> 5–15% Low</span>
        <span><span style="color:#F39C12">●</span> 15–25% Moderate</span>
        <span><span style="color:#E67E22">●</span> 25–35% High</span>
        <span><span style="color:#C0392B">●</span> &gt;35% Very high</span>
      </div>`;

    const pairCardsHtml = pairs.map(p => {
      const fa = fundMap[p.fund_a], fb = fundMap[p.fund_b];
      const pd = pair_details[`${p.fund_a}|${p.fund_b}`] || {};
      const shared = pd.shared || [], onlyA = pd.only_a || [], onlyB = pd.only_b || [];
      const pct = p.overlap_pct; const clr = overlapColor(pct); const lbl = overlapLabel(pct);
      const nameA = shortFundName(fa?.name), nameB = shortFundName(fb?.name);
      const rows10 = (list, fund) => Array.from({ length: 10 }).map((_, idx) => {
        const h = list[idx];
        return `<div style="font-size:11px;padding:4px 0;color:${h ? '#2C2A30' : 'transparent'}">${h ? h.name : '·'}</div>
                <div style="font-family:'DM Mono',monospace;font-size:11px;text-align:right;padding:4px 0;color:${h ? fund?.color : 'transparent'}">${h ? h.weight.toFixed(1) + '%' : ''}</div>`;
      }).join('');
      return `<div class="avoid-break" style="background:#fff;border:1px solid #E8E5EC;border-radius:12px;margin-bottom:14px;overflow:hidden">
        <div style="display:flex;align-items:center;padding:12px 18px;background:${clr}12;border-bottom:1px solid ${clr}30;gap:10px">
          <div style="display:flex;align-items:center;gap:7px;flex:1">
            <div style="width:9px;height:9px;border-radius:2px;background:${fa?.color}"></div>
            <span style="font-weight:600;font-size:11px;color:#2C2A30">${nameA}</span>
          </div>
          <div style="font-size:9px;color:#8A8790">vs</div>
          <div style="display:flex;align-items:center;gap:7px;flex:1;justify-content:flex-end">
            <span style="font-weight:600;font-size:11px;color:#2C2A30">${nameB}</span>
            <div style="width:9px;height:9px;border-radius:2px;background:${fb?.color}"></div>
          </div>
          <div style="margin-left:14px;background:${clr}18;border:1px solid ${clr}44;border-radius:7px;padding:5px 12px;text-align:center;min-width:76px">
            <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:15px;color:${clr}">${pct.toFixed(1)}%</div>
            <div style="font-size:8px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${clr}">${lbl}</div>
          </div>
        </div>
        <div style="padding:14px 18px">
          ${shared.length > 0 ? `<div style="margin-bottom:16px">
            <div style="font-size:9px;font-weight:700;color:#E67E22;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Shared Holdings (${shared.length})</div>
            <div style="display:grid;grid-template-columns:1fr 70px 70px;gap:0 16px;margin-bottom:4px">
              <div style="font-size:9px;color:#8A8790;font-weight:600;text-transform:uppercase">Stock</div>
              <div style="font-size:9px;color:${fa?.color};font-weight:700;text-transform:uppercase;text-align:right">${nameA.split(' ')[0]}</div>
              <div style="font-size:9px;color:${fb?.color};font-weight:700;text-transform:uppercase;text-align:right">${nameB.split(' ')[0]}</div>
            </div>
            ${shared.map(h => `<div style="display:grid;grid-template-columns:1fr 70px 70px;gap:0 16px;padding:5px 8px;align-items:center;background:#F7F5F3;border-radius:5px;margin-bottom:3px">
              <div style="font-size:11px;font-weight:500">${h.name}</div>
              <div style="font-family:'DM Mono',monospace;font-size:11px;text-align:right;color:${fa?.color}">${h.weight_a.toFixed(1)}%</div>
              <div style="font-family:'DM Mono',monospace;font-size:11px;text-align:right;color:${fb?.color}">${h.weight_b.toFixed(1)}%</div>
            </div>`).join('')}
          </div>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
            <div>
              <div style="font-size:9px;font-weight:700;color:#8A8790;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Only in ${nameA}</div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:0 14px">${rows10(onlyA, fa)}</div>
            </div>
            <div>
              <div style="font-size:9px;font-weight:700;color:#8A8790;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Only in ${nameB}</div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:0 14px">${rows10(onlyB, fb)}</div>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Overlap Analysis — ${clientName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;background:#fff;color:#2C2A30;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{margin:14mm;size:A4}
      @media print{.no-print{display:none!important}.avoid-break{page-break-inside:avoid}}
      .container{max-width:760px;margin:0 auto;padding:20px}
    </style></head><body><div class="container">

    <div style="background:${PLUM};padding:24px 28px;border-radius:12px;margin-bottom:20px;color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;letter-spacing:-.02em;margin-bottom:4px">Portfolio Overlap Analysis</div>
          <div style="font-size:12px;opacity:.7">${refDate} · Prepared by ${preparedBy}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:600">BügleRock Capital</div>
          <div style="font-size:10px;opacity:.6;margin-top:2px">Sound of Clarity</div>
        </div>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;color:#EDD5E2;margin-top:14px">Prepared for: ${clientName}</div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:20px">
      ${statCardHtml(`${avgOverlap}%`, 'Avg Overlap', `${funds2.length} funds · ${pairs.length} pairs`)}
      ${statCardHtml(highestPair ? `${highestPair.overlap_pct.toFixed(1)}%` : '—', 'Highest Pair', highestPair ? `${shortFundName(fundMap[highestPair.fund_a]?.name)} ↔ ${shortFundName(fundMap[highestPair.fund_b]?.name)}` : '', highestPair ? overlapColor(highestPair.overlap_pct) : null)}
      ${statCardHtml(totalUniqueStocks, 'Unique Stocks', `${funds2.length} funds combined`)}
      ${statCardHtml(heldByAllCount > 0 ? heldByAllCount : '0', 'Held By Every Fund', heldByAllCount > 0 ? `Top by weight: ${heldByAllName}` : 'None in common', heldByAllCount > 0 ? BERRY : '#8A8790')}
    </div>

    <div class="avoid-break" style="margin-bottom:20px;background:#fff;border:1px solid #E8E5EC;border-radius:12px;padding:16px 18px">
      <div style="font-size:12px;font-weight:600;color:#2C2A30;margin-bottom:14px">Overlap matrix</div>
      ${matrixHtml}
    </div>

    ${pairCardsHtml}

    <div style="margin-top:20px;padding-top:14px;border-top:1px solid #E8E5EC;font-size:8px;color:#8A8790;line-height:1.5">
      Overlap is calculated on equity holdings only, using each fund's latest available portfolio disclosure. BugleRock Capital does not guarantee the accuracy or completeness of underlying holdings data sourced from Morningstar. For internal/client discussion use.
    </div>

    <div class="no-print" style="text-align:center;margin:24px 0">
      <button onclick="window.print()" style="padding:10px 24px;background:${BERRY};color:#fff;border:none;border-radius:8px;font:600 13px 'DM Sans',sans-serif;cursor:pointer">⬇ Print / Save PDF</button>
    </div>
    </div></body></html>`);
    w.document.close();
  }

  // inr formatter and growth projection calcs — component level for use in Returns tab
  function inr(v){ if(v==null) return '—'; const s=v<0?'−':''; v=Math.abs(Math.round(v)); if(v>=10000000) return s+'₹'+(v/10000000).toFixed(2)+' Cr'; if(v>=100000) return s+'₹'+(v/100000).toFixed(2)+' L'; return s+'₹'+v.toLocaleString('en-IN'); }
  const _gR3y=B.return_3y, _gRate=(_gR3y!=null?_gR3y:12)/100, _gMoRate=Math.pow(1+_gRate,1/12)-1, _gMonths=wiYears*12, _gInfl=wiInflation/100;
  const lumpFuture=wiLump*Math.pow(1+_gRate,wiYears);
  const sipFuture=wiSip*(_gMoRate>0?((Math.pow(1+_gMoRate,_gMonths)-1)/_gMoRate)*(1+_gMoRate):_gMonths);
  const totalFuture=lumpFuture+sipFuture, totalInvested=wiLump+wiSip*_gMonths, gains=totalFuture-totalInvested;
  const realValue=totalFuture/Math.pow(1+_gInfl,wiYears);
  const targetMinusLump=wiTarget-lumpFuture;
  const requiredSip=targetMinusLump>0&&_gMoRate>0?targetMinusLump/(((Math.pow(1+_gMoRate,_gMonths)-1)/_gMoRate)*(1+_gMoRate)):null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Tab bar */}
      <div className="ptf-tab-bar">
        {TABS.map((t, i) => (
          <React.Fragment key={t.id}>
            <button className={`ptf-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
            {t.sep_after && i < TABS.length - 1 && (
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '6px 4px', flexShrink: 0 }} />
            )}
          </React.Fragment>
        ))}
        <div className="ptf-tab-actions">
          {activeTab === 'overlap' && overlapData && (
            <button onClick={generateOverlapPDF} style={{ fontSize: 11, padding: '7px 16px', background: 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 20, fontFamily: 'var(--font-body)', fontWeight: 600, cursor: 'pointer' }}>⬇ Export Overlap Report</button>
          )}
          <button className="btn btn-ghost" onClick={onEdit} style={{ fontSize: 11 }}>← Edit portfolio</button>
          <button className="btn btn-primary" onClick={onOptimise} style={{ fontSize: 11, borderRadius: 20, padding: '7px 16px', letterSpacing: 'normal', textTransform: 'none' }}>Optimise →</button>
        </div>
      </div>

      <div className="ptf-analytics">

        {/* ── AI DOCTOR ── */}
        {activeTab === 'doctor' && (
          <AIDoctor
            B={B}
            funds={funds}
            weights={weights}
            snapshots={snapshots}
            ips={ips}
            overlapData={overlapData}
          />
        )}

        {/* ── PORTFOLIO X-RAY ── */}
        {activeTab === 'xray' && (
          <PortfolioXRay
            B={B}
            AC={AC}
            funds={funds}
            weights={weights}
            snapshots={snapshots}
            benchmarks={benchmarks}
            bmRets={bm?.rets}
            ips={ips}
            overlapData={overlapData}
            histVar={histVar}
            histVarLoading={histVarLoading}
          />
        )}

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div>
            {/* KPI strip */}
            <div className="ptf-kpi-row" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))', marginBottom: 14 }}>
              {[
                { v: fp(B.return_1y), l: '1Y Return', pos: B.return_1y >= 0 },
                { v: fp(B.return_3y), l: '3Y CAGR', pos: B.return_3y >= 0 },
                { v: fp(B.return_5y), l: '5Y CAGR', pos: B.return_5y >= 0 },
                { v: f2(B.sharpe_ratio_3y), l: 'Sharpe (3Y)', pos: B.sharpe_ratio_3y >= 0.5 },
                { v: fp(B.alpha_3y), l: 'Alpha (3Y)', pos: B.alpha_3y >= 0 },
                { v: f2(B.expense_ratio) + '%', l: 'Blended ER', pos: B.expense_ratio <= 1 },
              ].map((k, i) => (
                <div key={i} className="ptf-kpi">
                  <div className="ptf-kpi-val" style={{ color: k.pos ? 'var(--pos)' : 'var(--brand-primary)' }}>{k.v}</div>
                  <div className="ptf-kpi-lbl">{k.l}</div>
                </div>
              ))}
            </div>

            {/* Allocation + cap split */}
            <div className="ptf-2col">
              <div className="ptf-card">
                <div className="ptf-card-hd">Fund allocation</div>
                <div style={{ padding: '12px 14px' }}>
                  {/* Allocation bar */}
                  <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', gap: 2, marginBottom: 12 }}>
                    {funds.map((f, i) => <div key={f.isin} style={{ flex: weights[f.isin] || 0, background: f.color }} />)}
                  </div>
                  {funds.map((f, i) => {
                    const fsnap = snapshots[f.isin];
                    return (
                    <div key={f.isin} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                      <div style={{ width: 3, height: 30, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{f.name}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{f.category}{fsnap?.returns?.['3y'] != null && fsnap.returns['3y'] !== '-' ? ' · 3Y ' + fp(fsnap.returns['3y']) : ''}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: f.color }}>{weights[f.isin] || 0}%</div>
                    </div>
                    );
                  })}
                </div>
              </div>
              <div className="ptf-card">
                <div className="ptf-card-hd">Asset class exposure</div>
                <div style={{ padding: '12px 14px' }}>
                  {[
                    [AC.equity,    'Equity',       'var(--brand-primary)'],
                    [AC.debt,      'Bonds/Debt',   'var(--lav-grey,#A795AE)'],
                    [AC.cash,      'Cash/Liquid',  'var(--text-muted)'],
                    [AC.commodity, 'Commodities',  '#D97706'],
                    [AC.other,     'REITs/Other',        '#6D5479'],
                  ].filter(r => (r[0] || 0) > 0.5).map(([v, lbl, clr], i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, textAlign: 'right', flexShrink: 0 }}>{lbl}</div>
                      <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: Math.min(v || 0, 100).toFixed(1) + '%', height: '100%', background: clr, borderRadius: 4 }} />
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: clr, minWidth: 36, textAlign: 'right' }}>{(v || 0).toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="ptf-card">
                <div className="ptf-card-hd">Market cap mix</div>
                <div style={{ padding: '12px 14px' }}>
                  {[
                    [B.large_cap, 'Large cap', 'var(--brand-primary)'],
                    [B.mid_cap,   'Mid cap',   'var(--muted-pur,#6D5479)'],
                    [B.small_cap, 'Small cap', '#C46985'],
                  ].filter(r => (r[0] || 0) > 0.1).map(([v, lbl, clr], i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, textAlign: 'right', flexShrink: 0 }}>{lbl}</div>
                      <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: Math.min(v || 0, 100).toFixed(1) + '%', height: '100%', background: clr, borderRadius: 4 }} />
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: clr, minWidth: 36, textAlign: 'right' }}>{(v || 0).toFixed(1)}%</div>
                    </div>
                  ))}
                  {B.pe_ratio > 0 || B.pb_ratio > 0 ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      {B.pe_ratio > 0 && <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)' }}>{f2(B.pe_ratio)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>P/E ratio</div>
                      </div>}
                      {B.pb_ratio > 0 && <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--brand-dark)' }}>{f2(B.pb_ratio)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>P/B ratio</div>
                      </div>}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Calendar year chart */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Calendar year performance vs {bmDisplayName}</div>
              <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                <svg width="100%" height="240" viewBox="0 0 560 240" preserveAspectRatio="xMidYMid meet">
                  {(() => {
                    const cyV = CY_KEYS.map(k => B['return_'+k]); // e.g. return_cy2021
                    const bmV = _CY_YEARS.map(y => bm.rets['cy'+String(y).slice(2)]);
                    const mx = Math.max(...cyV.concat(bmV).filter(v => v != null).map(Math.abs).concat([5]));
                    const TOP = 30; const PH = 185; const BASE = TOP + PH;
                    return CY_KEYS.map((k, i) => {
                      const fv = cyV[i], bv = bmV[i];
                      const x = i * 108 + 8, bw = 44, gp = 5;
                      const fh = fv != null ? Math.max(2, Math.abs(fv) / mx * PH) : 0;
                      const bh = bv != null ? Math.max(2, Math.abs(bv) / mx * PH) : 0;
                      const diff = fv != null && bv != null ? fv - bv : null;
                      return (
                        <g key={k}>
                          {diff != null && <text x={x + bw} y={Math.max(14, BASE - Math.max(fh, bh) - 8)} textAnchor="middle" fontSize="12" fontWeight="700" fill={diff >= 0 ? 'var(--pos)' : 'var(--brand-primary)'} fontFamily="sans-serif">{diff >= 0 ? '+' : ''}{diff.toFixed(1)}%</text>}
                          {fv != null && <rect x={x} y={BASE - fh} width={bw} height={fh} fill={fv >= 0 ? 'var(--brand-primary)' : '#C46985'} rx="2" />}
                          {bv != null && <rect x={x + bw + gp} y={BASE - bh} width={bw - 4} height={bh} fill="var(--lav-grey,#A795AE)" rx="2" opacity=".8" />}
                          <text x={x + bw} y={BASE + 18} textAnchor="middle" fontSize="13" fill="var(--text-muted)" fontFamily="sans-serif">{CY_LBL[i]}</text>
                        </g>
                      );
                    });
                  })()}
                  <line x1="0" y1="215" x2="560" y2="215" stroke="var(--border)" strokeWidth="1" />
                </svg>
                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--brand-primary)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Portfolio</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lav-grey,#A795AE)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle', opacity: .8 }}></span>{bmDisplayName}</span>
                  <span style={{ fontStyle: 'italic' }}>Δ above bars = outperformance</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── RETURNS & PROJECTIONS ── */}
        {activeTab === 'returns' && (
          <div>
            {/* Return pills */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
              {[
                { v: fp(B.return_1m), l: '1M Return' },
                { v: fp(B.return_3m), l: '3M Return' },
                { v: fp(B.return_1y), l: '1Y Return' },
                { v: fp(B.return_3y), l: '3Y CAGR' },
                { v: fp(B.return_5y), l: '5Y CAGR' },
                { v: fp(B.return_ytd), l: 'YTD' },
                { v: fp(B.return_cy2025), l: 'CY 2025' },
                { v: fp(B.return_cy2024), l: 'CY 2024' },
              ].map((p, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '11px 10px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1, marginBottom: 3, color: (parseFloat(p.v) || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{p.v}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{p.l}</div>
                </div>
              ))}
            </div>

            {/* Per-fund return table */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Return contribution per fund</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr><th style={{ textAlign: 'left' }}>Fund</th><th>Weight</th><th>1M</th><th>3M</th><th>6M</th><th>1Y</th><th>3Y CAGR</th><th>5Y CAGR</th><th>YTD</th><th>1Y contrib</th></tr></thead>
                  <tbody>
                    {funds.map(f => {
                      const w = weights[f.isin] || 0;
                      const fsnap = snapshots[f.isin];
                      return (
                        <tr key={f.isin}>
                          <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 3, height: 34, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                              <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                            </div>
                          </div></td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{w}%</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['1m'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['1m'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['3m'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['3m'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['6m'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['6m'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: (fsnap?.returns?.['1y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['1y'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['3y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['3y'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['5y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['5y'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(fsnap?.returns?.['ytd'])}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--pos)' }}>{snapshots[f.isin]?.returns?.['1y'] != null ? fp(snapshots[f.isin]?.returns?.['1y'] * w / 100) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Blended portfolio</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{total >= 99.8 ? Math.round(total) : total.toFixed(2)}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_1m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_3m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_6m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_ytd)}</td>
                      <td>—</td>
                    </tr>
                    <tr style={{ background: 'var(--brand-dark)' }}>
                      <td style={{ fontWeight: 600, color: '#fff' }}>{bmDisplayName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>BM</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{bmMeta['1M'].partial ? '~' : ''}{fp(bm.rets.r1m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{bmMeta['3M'].partial ? '~' : ''}{fp(bm.rets.r3m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{bmMeta['6M'].partial ? '~' : ''}{fp(bm.rets.r6m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{bmMeta['1Y'].partial ? '~' : ''}{fp(bm.rets.r1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{bmMeta['3Y'].partial ? '~' : ''}{fp(bm.rets.r3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{bmMeta['5Y'].partial ? '~' : ''}{fp(bm.rets.r5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{bmMeta['YTD'].partial ? '~' : ''}{fp(bm.rets.ytd)}</td>
                      <td style={{ color: '#fff' }}>—</td>
                    </tr>
                  </tfoot>
                </table>
                {/* Benchmark footnote */}
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Benchmark:</strong>{' '}
                  {isMultiBm
                    ? <>{bmComposition} · Blended returns weighted by IPS allocation</>
                    : benchmarks[0]?.display_name}
                  {bmMissingNotes.length > 0 && (
                    <><br/><span style={{ color: 'var(--warn, #D97706)' }}>~ Partial data — {bmMissingNotes.join('; ')}</span></>
                  )}
                </div>
              </div>
            </div>
            {/* Projection cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div className="ptf-card">
                <div className="ptf-card-hd">Lump sum projection — {fmtL(investAmt)}</div>
                <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                  <table className="ptf-analytics-tbl">
                    <thead><tr><th style={{ textAlign: 'left' }}>Horizon</th><th>Portfolio</th><th>{bmDisplayName}</th><th>Gain</th></tr></thead>
                    <tbody>
                      {[3, 5, 10].map(y => {
                        const ptfR = y === 3 ? (B.return_3y || 0) : (B.return_5y || B.return_3y || 0);
                        const bmR  = y === 3 ? bm.rets.r3y : (bm.rets.r5y || bm.rets.r3y);
                        const ptfV = investAmt * Math.pow(1 + ptfR / 100, y);
                        const bmV  = bmR != null ? investAmt * Math.pow(1 + bmR / 100, y) : null;
                        return (
                          <tr key={y}>
                            <td>{y} yrs <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>@ {ptfR.toFixed(1)}%</span></td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{fmtL(ptfV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{bmV != null ? fmtL(bmV) : '—'}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: bmV != null ? (ptfV >= bmV ? 'var(--pos)' : 'var(--brand-primary)') : 'var(--text-muted)' }}>
                              {bmV != null ? (ptfV >= bmV ? '+' : '-') + fmtL(Math.abs(ptfV - bmV)) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="ptf-card">
                <div className="ptf-card-hd">SIP projection — ₹{sipAmt.toLocaleString('en-IN')}/month</div>
                <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                  <table className="ptf-analytics-tbl">
                    <thead><tr><th style={{ textAlign: 'left' }}>Horizon</th><th>Invested</th><th>Portfolio</th><th>vs BM</th></tr></thead>
                    <tbody>
                      {[5, 10].map(y => {
                        const ptfR = B.return_5y || B.return_3y || 0;
                        const bmR  = bm.rets.r5y || bm.rets.r3y;
                        const ptfV = sipFV(sipAmt, ptfR, y);
                        const bmV  = bmR != null ? sipFV(sipAmt, bmR, y) : null;
                        const invested = sipAmt * 12 * y;
                        return (
                          <tr key={y}>
                            <td>{y} yrs <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>@ {ptfR.toFixed(1)}%</span></td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtL(invested)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{fmtL(ptfV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: bmV != null ? (ptfV >= bmV ? 'var(--pos)' : 'var(--brand-primary)') : 'var(--text-muted)' }}>
                              {bmV != null ? (ptfV >= bmV ? '+' : '') + (((ptfV - bmV) / bmV) * 100).toFixed(1) + '%' : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                    Based on blended 5Y CAGR ({(B.return_5y || B.return_3y || 0).toFixed(2)}% p.a.) vs {bmDisplayName} ({(bm.rets.r5y || bm.rets.r3y || 0).toFixed(2)}% p.a.). Lump sum uses 3Y CAGR for 3yr horizon, 5Y CAGR for 5yr and 10yr. Illustrative only — not a guarantee of future returns.
                    {bmComposition && <><br/><strong>Benchmark:</strong> {bmComposition}</>}
                    {bmMissingNotes.length > 0 && <><br/><span style={{ color: 'var(--warn, #D97706)' }}>~ Partial data — {bmMissingNotes.join('; ')}</span></>}
                  </div>
                </div>
              </div>
            </div>


            {/* Growth projection */}
            <div style={{ marginBottom:18, border:'1px solid '+GR20_C, borderRadius:8, overflow:'hidden', background:'#fff' }}>
              <div style={{ padding:'10px 16px', fontSize:9.5, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:BERRY_C, background:GR10_C, borderBottom:'1px solid '+GR20_C }}>Growth projection — what if you invested for the long term?</div>
              <div style={{ padding:'16px 20px' }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:14 }}>
                  <div>
                    <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT_C }}>Lump sum (₹)</label>
                    <input type="number" value={wiLump} onChange={e=>setWiLump(parseFloat(e.target.value)||0)} style={{ width:'100%', marginTop:4, padding:'7px 9px', border:'1px solid '+GR20_C, borderRadius:6, fontSize:12.5 }}/>
                  </div>
                  <div>
                    <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT_C }}>Monthly SIP (₹)</label>
                    <input type="number" value={wiSip} onChange={e=>setWiSip(parseFloat(e.target.value)||0)} style={{ width:'100%', marginTop:4, padding:'7px 9px', border:'1px solid '+GR20_C, borderRadius:6, fontSize:12.5 }}/>
                  </div>
                  <div>
                    <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT_C }}>Horizon: {wiYears} years</label>
                    <input type="range" min={1} max={30} value={wiYears} onChange={e=>setWiYears(parseInt(e.target.value))} style={{ width:'100%', marginTop:9 }}/>
                  </div>
                  <div>
                    <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT_C }}>Inflation (%)</label>
                    <input type="number" value={wiInflation} step={0.5} onChange={e=>setWiInflation(parseFloat(e.target.value)||0)} style={{ width:'100%', marginTop:4, padding:'7px 9px', border:'1px solid '+GR20_C, borderRadius:6, fontSize:12.5 }}/>
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
                  <div style={{ background:GR10_C, borderRadius:8, padding:12 }}>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', color:MUT_C, marginBottom:4 }}>Future value (nominal)</div>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color:PLUM_C }}>{inr(totalFuture)}</div>
                  </div>
                  <div style={{ background:GR10_C, borderRadius:8, padding:12 }}>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', color:MUT_C, marginBottom:4 }}>Real value (today's ₹)</div>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color:PLUM_C }}>{inr(realValue)}</div>
                  </div>
                  <div style={{ background:GR10_C, borderRadius:8, padding:12 }}>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', color:MUT_C, marginBottom:4 }}>Total invested</div>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color:GR80_C }}>{inr(totalInvested)}</div>
                  </div>
                  <div style={{ background:'#F0F9F5', borderRadius:8, padding:12 }}>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', color:MUT_C, marginBottom:4 }}>Estimated gains</div>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color:POS_C }}>{inr(gains)}</div>
                  </div>
                </div>
                <div style={{ fontSize:10.5, color:GR60_C, marginTop:10 }}>Using portfolio's 3Y CAGR ({_gR3y!=null?_gR3y.toFixed(1):'—'}%) as the annual growth assumption. Real value discounts nominal by inflation at {wiInflation}%.</div>

                {/* Reverse calculator */}
                <div style={{ borderTop:'1px solid '+GR20_C, marginTop:16, paddingTop:14 }}>
                  <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT_C, marginBottom:8 }}>Reverse calculator — what SIP do you need to hit a target?</div>
                  <div style={{ display:'flex', gap:14, alignItems:'flex-end', flexWrap:'wrap' }}>
                    <div>
                      <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT_C }}>Target corpus (₹)</label>
                      <input type="number" value={wiTarget} onChange={e=>setWiTarget(parseFloat(e.target.value)||0)} style={{ width:180, marginTop:4, padding:'7px 9px', border:'1px solid '+GR20_C, borderRadius:6, fontSize:12.5 }}/>
                    </div>
                    <div style={{ flex:1, minWidth:220, background:GR10_C, borderRadius:8, padding:12 }}>
                      <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', color:MUT_C, marginBottom:4 }}>Required monthly SIP</div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color:PLUM_C }}>{requiredSip!=null && requiredSip>0 ? inr(requiredSip) : (targetMinusLump <= 0 ? 'Lump sum alone suffices' : '—')}</div>
                      <div style={{ fontSize:10, color:GR60_C, marginTop:2 }}>To reach {inr(wiTarget)} in {wiYears} years alongside {inr(wiLump)} lump sum</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>



            {/* Rolling returns — moved from Rolling tab */}
      {(() => {
          if (funds.length === 0) {
            return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Add funds to the portfolio to see rolling returns.</div>;
          }
          if (rollingLoading) {
            return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Computing rolling returns from daily NAV history...</div>;
          }
          if (rollingError) {
            return <div style={{ padding: 32, textAlign: 'center', color: 'var(--neg)', fontSize: 13 }}>{rollingError}</div>;
          }
          if (!rollingData) return null;

          const rows = funds.map(f => {
            const d = rollingData[f.isin] || {};
            return {
              f,
              w: weights[f.isin] || 0,
              r3m: d.rolling_3m_avg_1y != null ? d.rolling_3m_avg_1y : null,
              r3mN: d.rolling_3m_window_count || 0,
              r1y: d.rolling_1y_avg_3y != null ? d.rolling_1y_avg_3y : null,
              r1yN: d.rolling_1y_window_count || 0,
              r3y: d.rolling_3y_cagr_avg_5y != null ? d.rolling_3y_cagr_avg_5y : null,
              r3yN: d.rolling_3y_window_count || 0,
              years: d.years_available || 0,
            };
          });

          function weightedAvg(getter) {
            let wSum = 0, wTotal = 0;
            rows.forEach(row => {
              const v = getter(row);
              if (v == null) return;
              wSum += v * row.w; wTotal += row.w;
            });
            return wTotal > 0 ? wSum / wTotal : null;
          }
          const port3m = weightedAvg(r => r.r3m);
          const port1y = weightedAvg(r => r.r1y);
          const port3y = weightedAvg(r => r.r3y);

          const colorFor = (v) => v == null ? 'var(--text-muted)' : v >= 12 ? 'var(--pos)' : v >= 6 ? '#D97706' : 'var(--neg)';
          const colorFor3m = (v) => v == null ? 'var(--text-muted)' : v >= 4 ? 'var(--pos)' : v >= 0 ? '#D97706' : 'var(--neg)';

          return (
            <div>
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Computed from each fund's daily NAV history. <strong>3M rolling return</strong> is the average of all overlapping 3-month (63 trading-day) return windows over the trailing 1 year. <strong>1Y rolling return</strong> is the average of all overlapping 1-year (252 trading-day) return windows over the trailing 3 years. <strong>3Y rolling CAGR</strong> is the average of all overlapping 3-year CAGR windows over the trailing 5 years. Funds with less history than required show "—".
              </div>
              <div className="ptf-card">
                <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>Rolling return consistency by fund</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>Fund</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>Weight</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>3M Rolling Return — Avg (1Y)</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>1Y Rolling Return — Avg (3Y)</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>3Y Rolling CAGR — Avg (5Y)</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>NAV History</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, fi) => (
                        <tr key={row.f.isin} style={{ background: fi % 2 === 0 ? 'var(--bg-secondary)' : '#fff' }}>
                          <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'left' }}>
                            <span style={{ display: 'inline-block', width: 3, height: 20, background: row.f.color, borderRadius: 2, marginRight: 8, verticalAlign: 'middle' }} />
                            {row.f.name}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{f2(row.w)}%</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: colorFor3m(row.r3m) }}>
                            {row.r3m != null ? (row.r3m >= 0 ? '+' : '') + row.r3m.toFixed(1) + '%' : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: colorFor(row.r1y) }}>
                            {row.r1y != null ? (row.r1y >= 0 ? '+' : '') + row.r1y.toFixed(1) + '%' : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: colorFor(row.r3y) }}>
                            {row.r3y != null ? (row.r3y >= 0 ? '+' : '') + row.r3y.toFixed(1) + '%' : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{row.years ? `${row.years}Y` : '—'}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(145,47,99,.06)' }}>
                        <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: 'var(--brand-dark)', textAlign: 'left' }}>Blended portfolio</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{f2(rows.reduce((s, r) => s + r.w, 0))}%</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--brand-dark)' }}>
                          {port3m != null ? (port3m >= 0 ? '+' : '') + port3m.toFixed(1) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--brand-dark)' }}>
                          {port1y != null ? (port1y >= 0 ? '+' : '') + port1y.toFixed(1) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--brand-dark)' }}>
                          {port3y != null ? (port3y >= 0 ? '+' : '') + port3y.toFixed(1) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 12px' }} />
                      </tr>
                      {bmRolling && !bmRolling.error && (
                        <tr style={{ borderTop: '1px solid var(--border)', background: '#1E2A3A' }}>
                          <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'left' }}>
                            {bmDisplayName}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>BM</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                            {bmRolling.rolling_3m_avg_1y != null ? (bmRolling.rolling_3m_avg_1y >= 0 ? '+' : '') + bmRolling.rolling_3m_avg_1y.toFixed(1) + '%' : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                            {bmRolling.rolling_1y_avg_3y != null ? (bmRolling.rolling_1y_avg_3y >= 0 ? '+' : '') + bmRolling.rolling_1y_avg_3y.toFixed(1) + '%' : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                            {bmRolling.rolling_3y_cagr_avg_5y != null ? (bmRolling.rolling_3y_cagr_avg_5y >= 0 ? '+' : '') + bmRolling.rolling_3y_cagr_avg_5y.toFixed(1) + '%' : '—'}
                          </td>
                          <td style={{ padding: '8px 12px' }} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {bmRolling && !bmRolling.error && (
                  <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>
                    Benchmark: {bmRolling.benchmark_label} · Same lookback windows as fund rolling returns (3M avg 1Y, 1Y avg 3Y, 3Y CAGR avg 5Y) · {bmRolling.common_days} common trading days available
                  </div>
                )}
                {benchmarks && benchmarks.length > 0 && !bmRolling && (
                  <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                    Computing benchmark rolling returns…
                  </div>
                )}
                {(!benchmarks || benchmarks.length === 0) && (
                  <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>
                    No benchmark set — configure in Client &amp; IPS → Section E to compare against benchmark rolling returns.
                  </div>
                )}
              </div>
            </div>
          );
        })()}

          </div>
        )}

        {/* ── RISK METRICS ── */}
        {activeTab === 'risk' && (
          <div>
            <div className="ptf-kpi-row" style={{ gridTemplateColumns: 'repeat(7,minmax(0,1fr))', marginBottom: 14 }}>
              {RISK_METRICS.map(m => {
                const v = B[m.k];
                if (v == null) return <div key={m.k} className="ptf-kpi"><div className="ptf-kpi-val" style={{ color: 'var(--text-muted)' }}>—</div><div className="ptf-kpi-lbl">{m.l}</div></div>;
                const s = m.sig(v);
                return (
                  <div key={m.k} className="ptf-kpi" style={{ background: SIG_BG[s[1]] }}>
                    <div className="ptf-kpi-val" style={{ color: SIG_COL[s[1]] }}>{m.fmt(v)}</div>
                    <div className="ptf-kpi-lbl">{m.l}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: SIG_COL[s[1]] }}>{s[0]}</div>
                  </div>
                );
              })}
            </div>

            <div className="ptf-card">
              <div className="ptf-card-hd">Risk metrics per fund</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr>
                    <th style={{ textAlign: 'left' }}>Fund</th>
                    <th>Weight</th>
                    {RISK_METRICS.map(m => <th key={m.k}>{m.l}</th>)}
                  </tr></thead>
                  <tbody>
                    {funds.map(f => {
                      const fsnap = snapshots[f.isin];
                      return (<tr key={f.isin}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 3, height: 32, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                            <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                          </div>
                        </div></td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, textAlign: 'center' }}>{weights[f.isin] || 0}%</td>
                        {RISK_METRICS.map(m => {
                          const riskMap = {
                            sharpe_ratio_3y:  fsnap?.risk?.sharpe_ratio_3y,
                            sortino_ratio_3y: fsnap?.risk?.sortino_ratio_3y,
                            alpha_3y:         fsnap?.risk?.alpha_3y,
                            beta_3y:          fsnap?.risk?.beta_3y,
                            up_capture_3y:    fsnap?.risk?.up_capture_3y,
                            down_capture_3y:  fsnap?.risk?.down_capture_3y,
                            std_dev_3y:       fsnap?.risk?.std_dev_3y,
                          };
                          const raw = riskMap[m.k];
                          const v = (raw == null || raw === '-') ? null : parseFloat(raw);
                          if (v == null || isNaN(v)) return <td key={m.k} style={{ color: 'var(--text-muted)', textAlign: 'right' }}>—</td>;
                          const s = m.sig(v);
                          return <td key={m.k} style={{ fontFamily: 'var(--font-mono)', color: SIG_COL[s[1]], textAlign: 'right' }}>{m.fmt(v)}</td>;
                        })}
                      </tr>);
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Blended portfolio</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>100%</td>
                      {RISK_METRICS.map(m => {
                        const v = B[m.k];
                        return (
                          <td key={m.k} style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {v != null && !isNaN(v) ? m.fmt(v) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Risk alerts */}
          </div>
        )}

        {/* ── SENSITIVITY ── */}
        {activeTab === 'sensitivity' && (() => {
          const BERRY='#912F63', PLUM='#3E3452', MUT='#6D5479', GR60='#A2A0A0', GR80='#374151', GR20='#E8E5EC', GR10='#F8F6FA', POS='#1A7A52', NEG='#B91C1C', WARN='#D97706', LAV='#A795AE';

          if (!funds.length) {
            return <div style={{ padding:40, textAlign:'center', color:GR60 }}><div style={{ fontSize:32, opacity:.2, marginBottom:12 }}>⚖</div><div style={{ fontFamily:'var(--font-serif)', fontSize:17, color:PLUM, marginBottom:6 }}>Add funds to the portfolio</div><div style={{ fontSize:13 }}>Sensitivity analysis needs at least one fund in the portfolio.</div></div>;
          }

          const DURATION_MAP = {
            // Pure debt — standard categories
            'Overnight':0.01, 'Liquid':0.16, 'Ultra Short Duration':0.44,
            'Money Market':0.52, 'Floating Rate':2.23, 'Low Duration':0.88,
            'Short Duration':2.4, 'Banking & PSU':2.5, 'Corporate Bond':2.7,
            'Medium Duration':3.25, 'Credit Risk':2.02, 'Fund of Funds':3.05,
            'Dynamic Bond':5.03, 'Medium to Long Duration':5.76,
            'Government Bond':8.39, '10 yr Government Bond':6.88,
            'Long Duration':10.64, 'Gilt':8,
            // ETF debt — use avg of present where available, else by mandate
            'ETF Government Bond':5.42, 'ETF 10 yr Government Bond':7,
            'ETF Long Duration':4.4, 'ETF Medium to Long Duration':3.28,
            'Index Funds - Fixed Income':1.92,
            // Hybrid — arbitrage is near-cash, others by avg of present
            'Arbitrage':0.42, 'Arbitrage Fund':0.42,
            'Conservative Allocation':3.19, 'Balanced Allocation':3.36,
            'Aggressive Allocation':2.74, 'Dynamic Asset Allocation':2.33,
            'Multi Asset Allocation':1.96, 'Equity Savings':2.2,
            'Retirement':5.29, 'Children':2.98,
          };

          // isEquityLike, isDebtLike, isHybrid defined at component level
          function categoryDuration(cat){
            if (!cat) return 3;
            for (const k in DURATION_MAP) if (cat.toLowerCase().includes(k.toLowerCase())) return DURATION_MAP[k];
            return 3;
          }
          function safeFloat(v){ if (v == null || v === '-') return null; const p = parseFloat(v); return isNaN(p) ? null : p; }

          // Build category avg beta from all funds in snapshots (for fallback)
          const catBetaMap = {};
          const catBetaCount = {};
          Object.values(snapshots).forEach(s => {
            const cat = s?.category;
            const beta = safeFloat(s?.risk?.beta_3y);
            if (cat && beta != null && beta > 0) {
              catBetaMap[cat] = (catBetaMap[cat] || 0) + beta;
              catBetaCount[cat] = (catBetaCount[cat] || 0) + 1;
            }
          });
          function categoryBeta(cat){
            if (!cat || !catBetaMap[cat]) return null;
            return catBetaMap[cat] / catBetaCount[cat];
          }

          // Accumulate equity sleeve (Equity + Hybrid) and debt sleeve (Debt + Hybrid look-through)
          let eqW=0, eqBetaSum=0;
          let debtW=0, debtDurSum=0, debtYtmSum=0, debtYtmW=0;

          funds.forEach(f => {
            const w = weights[f.isin] || 0;
            if (!w) return;
            const fsnap = snapshots[f.isin];
            const cat   = f.category || fsnap?.category || '';

            // ── Equity sleeve: Equity + ETF + International + Hybrid ─────────
            if (isEquityLike(fsnap, f) || isHybrid(fsnap, f)) {
              // Beta: use fund beta, fallback to category avg
              const betaRaw = safeFloat(fsnap?.risk?.beta_3y);
              const beta = betaRaw != null ? betaRaw : categoryBeta(cat);
              if (beta != null) { eqW += w; eqBetaSum += beta * w; }
            }

            // ── Debt sleeve: Debt funds fully + Hybrid look-through via bond_pct ──
            if (isDebtLike(fsnap, f)) {
              // Full weight for pure debt funds
              const durRaw = safeFloat(fsnap?.modified_duration);
              const dur = durRaw != null ? durRaw : categoryDuration(cat);
              debtW += w; debtDurSum += dur * w;
              const ytm = safeFloat(fsnap?.ytm);
              if (ytm != null && ytm > 0) { debtYtmSum += ytm * w; debtYtmW += w; }

            } else if (isHybrid(fsnap, f)) {
              // Look-through for hybrid funds using bond_pct
              const bondPctRaw = safeFloat(fsnap?.bond_pct);
              const bondPct = (bondPctRaw != null && bondPctRaw > 0) ? bondPctRaw / 100 : null;
              if (bondPct != null) {
                const effectiveDebtW = w * bondPct;
                const durRaw = safeFloat(fsnap?.modified_duration);
                const dur = durRaw != null ? durRaw : categoryDuration(cat);
                debtW += effectiveDebtW; debtDurSum += dur * effectiveDebtW;
                const ytm = safeFloat(fsnap?.ytm);
                if (ytm != null && ytm > 0) { debtYtmSum += ytm * effectiveDebtW; debtYtmW += effectiveDebtW; }
              }
            }
          });

          const avgEqBeta   = eqW > 0 ? eqBetaSum / eqW : null;
          const avgDuration = debtW > 0 ? debtDurSum / debtW : null;
          // Weighted avg YTM — fallback to 7% if not available
          const avgYtm = debtYtmW > 0 ? debtYtmSum / debtYtmW / 100 : 0.07;
          // Convexity = Dmod² + Dmod/(1+y) — correct formula using modified duration + YTM
          const avgConvexity = avgDuration != null ? (avgDuration * avgDuration) + (avgDuration / (1 + avgYtm)) : null;
          const baseRet1y = B.return_1y;
          const annualStd = B.std_dev_3y;
          const monthlyStd = annualStd != null ? annualStd / Math.sqrt(12) : null;

          let notional = 10000000, notionalIsClient = false;
          if (ips?.amount) {
            const parsed = parseFloat(String(ips.amount).replace(/[^0-9.]/g, ''));
            if (parsed > 0) { notional = parsed; notionalIsClient = true; }
          }
          function inr(v){ if(v==null) return '—'; const s=v<0?'−':''; v=Math.abs(Math.round(v)); if(v>=10000000) return s+'₹'+(v/10000000).toFixed(2)+' Cr'; if(v>=100000) return s+'₹'+(v/100000).toFixed(2)+' L'; return s+'₹'+v.toLocaleString('en-IN'); }



          // Composite risk posture
          const betaScore = avgEqBeta != null ? Math.min(100, Math.max(0, (avgEqBeta/1.3)*60*(eqW/100) + ((100-eqW)/100)*10)) : (eqW>0?40:0);
          const durScore = avgDuration != null ? Math.min(100, (avgDuration/8)*100) : 0;
          const volScore = annualStd != null ? Math.min(100, (annualStd/25)*100) : 50;
          const riskComposite = betaScore*0.45 + volScore*0.35 + Math.min(durScore, 40)*0.20;
          const riskLabel = riskComposite>=65?'Aggressive':riskComposite>=45?'Moderately Aggressive':riskComposite>=28?'Balanced':riskComposite>=14?'Moderately Conservative':'Conservative';
          const riskClr = riskComposite>=65?NEG:riskComposite>=45?WARN:riskComposite>=28?'#B8860B':riskComposite>=14?'#4C8C3C':POS;
          // Remap composite score to visual bar position so label zones align with bar zones
          // Conservative=0-20%, ModCons=20-40%, Balanced=40-60%, ModAgg=60-80%, Aggressive=80-100%
          const riskBarPct = riskComposite<14 ? (riskComposite/14)*20 :
                             riskComposite<28 ? 20 + ((riskComposite-14)/14)*20 :
                             riskComposite<45 ? 40 + ((riskComposite-28)/17)*20 :
                             riskComposite<65 ? 60 + ((riskComposite-45)/20)*20 :
                                               80 + ((riskComposite-65)/35)*20;

          // Interactive calculator live values
          const eqContrib = avgEqBeta != null ? (eqW/100) * avgEqBeta * sensMarket : 0;
          // Rate impact with convexity correction:
          // ΔP/P = −Dmod × Δy + 0.5 × Convexity × Δy²
          // where Convexity = Dmod² + Dmod/(1+y)
          const deltaY = sensRate / 10000;  // convert bp to decimal (e.g. 100bp = 0.01)
          const rateContrib = avgDuration != null
            ? (debtW/100) * ((-avgDuration * deltaY) + (0.5 * avgConvexity * deltaY * deltaY)) * 100
            : 0;
          const totalImpact = eqContrib + rateContrib;
          const totalValue = notional * totalImpact / 100;

          // VaR/ES
          const horizons = [{l:'1 day',days:1},{l:'1 week',days:5},{l:'1 month',days:21},{l:'1 year',days:252}];
          // Standard normal distribution critical values
          const Z = {95:1.6449, 99:2.3263};
          const ES_MULT = {95:2.063, 99:2.665};
          const dailyStd = annualStd != null ? annualStd/Math.sqrt(252) : null;
          const varRows = dailyStd != null ? horizons.map(h => {
            const periodStd = dailyStd*Math.sqrt(h.days);
            return { l:h.l, periodStd, var95:Z[95]*periodStd, es95:ES_MULT[95]*periodStd, var99:Z[99]*periodStd, es99:ES_MULT[99]*periodStd };
          }) : [];

          // Diverging bar
          function DivBar({value, maxAbs}){
            const pct = Math.min(100, Math.abs(value)/maxAbs*50);
            const clr = value>=0?POS:NEG;
            return <div style={{ position:'relative', height:16, background:GR10, borderRadius:4, minWidth:120 }}>
              <div style={{ position:'absolute', top:0, bottom:0, left:'50%', width:1, background:GR20 }}/>
              <div style={{ position:'absolute', top:1, bottom:1, ...(value>=0?{left:'50%'}:{right:'50%'}), width:pct+'%', background:clr, borderRadius:3 }}/>
            </div>;
          }

          // Market reference scenarios
          const marketShocks = [-20,-10,-5,5,10,20];
          const marketMax = avgEqBeta != null ? (Math.max(...marketShocks.map(s => Math.abs((eqW/100)*avgEqBeta*s))) || 1) : 1;

          // Rate reference scenarios
          const rateShocks = [-100,-50,50,100,200];
          function rateImpact(bps) {
            if (avgDuration == null) return 0;
            const dy = bps / 10000;
            return (debtW/100) * ((-avgDuration * dy) + (0.5 * avgConvexity * dy * dy)) * 100;
          }
          const rateMax = Math.max(...rateShocks.map(bps => Math.abs(rateImpact(bps))), 0.01);

          // Combined scenario matrix
          const mAxis = [-20,-10,0,10,20], rAxis = [-100,0,100];
          function combinedImpact(m, r){
            const e  = avgEqBeta != null ? (eqW/100)*avgEqBeta*m : 0;
            const rr = rateImpact(r);  // r is already in bps
            return e + rr;
          }
          const matrixVals = mAxis.flatMap(m => rAxis.map(r => Math.abs(combinedImpact(m, r))));
          const matrixMax = Math.max(...matrixVals, 0.01);

          // Risk contribution
          const riskContrib = funds.map(f => {
            const w = (weights[f.isin]||0)/100;
            const raw = snapshots[f.isin]?.risk?.std_dev_3y;
            const std = raw != null && raw !== '-' ? parseFloat(raw) : null;
            if (std == null || isNaN(std) || std <= 0) return null;
            return { f, w:weights[f.isin]||0, contrib: w*std };
          }).filter(Boolean).sort((a,b) => b.contrib - a.contrib);
          const totalContrib = riskContrib.reduce((s,r) => s+r.contrib, 0) || 1;

          const cardHdStyle = { padding:'10px 16px', fontSize:9.5, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:MUT, background:GR10, borderBottom:'1px solid '+GR20 };
          const cardStyle = { marginBottom:16, border:'1px solid '+GR20, borderRadius:8, overflow:'hidden', background:'#fff' };

          return <div>
            <div style={{ fontFamily:'var(--font-serif)', fontSize:15, fontWeight:600, color:PLUM, marginBottom:4 }}>Sensitivity analysis</div>
            <div style={{ fontSize:12, color:GR60, marginBottom:16 }}>How this portfolio's value would move under market, rate and allocation shifts</div>

            {/* Overall posture banner */}
            <div style={{ background:'linear-gradient(135deg,'+GR10+' 0%,#fff 100%)', border:'1px solid '+GR20, borderRadius:12, padding:'18px 22px', marginBottom:18, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
              <div>
                <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:MUT, marginBottom:4 }}>Overall sensitivity posture</div>
                <div style={{ fontFamily:'var(--font-serif)', fontSize:22, fontWeight:700, color:riskClr }}>{riskLabel}</div>
                <div style={{ fontSize:11.5, color:GR60, marginTop:2 }}>Composite of equity beta, portfolio volatility and rate duration</div>
              </div>
              <div style={{ flex:1, minWidth:220, maxWidth:320 }}>
                <div style={{ background:GR20, borderRadius:6, height:10, position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:0, bottom:0, left:0, width:riskBarPct.toFixed(0)+'%', background:'linear-gradient(90deg,'+POS+','+WARN+','+NEG+')', borderRadius:6 }}/>

                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:GR60, marginTop:4 }}><span>Conservative</span><span>Balanced</span><span>Aggressive</span></div>
              </div>
            </div>

            {/* Risk factor exposures */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>Risk factor exposures</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    {['Factor','Exposure','Sleeve / basis','Interpretation'].map((h,i) => <th key={i} style={{ textAlign:i===1?'right':'left', padding:'7px 14px', fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, background:GR10, borderBottom:'1px solid '+GR20 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[
                      { f:'Equity beta', v:avgEqBeta!=null?avgEqBeta.toFixed(2):'—', ex:eqW.toFixed(0)+'% (equity + hybrid)', note:avgEqBeta!=null?(avgEqBeta>=1.05?'More volatile than the broad market':(avgEqBeta<=0.9?'Less volatile than the broad market':'Roughly in line with the broad market')):'No equity beta data available' },
                      { f:'Rate duration / convexity', v:avgDuration!=null?avgDuration.toFixed(1)+'y / '+(avgConvexity!=null?avgConvexity.toFixed(1):'—'):'—', ex:debtW.toFixed(1)+'% (debt + hybrid bond)', note:(() => {
                        if (avgDuration==null) return 'No debt holdings';
                        // Check if debt sleeve is dominated by short-duration/arbitrage
                        let shortDurW = 0, totalDebtW = 0;
                        funds.forEach(f => {
                          const w = weights[f.isin] || 0;
                          if (!isDebtLike(snapshots[f.isin], f) && !isHybrid(snapshots[f.isin], f)) return;
                          totalDebtW += w;
                          const cat = (f.category || snapshots[f.isin]?.category || '').toLowerCase();
                          if (cat.includes('arbitrage') || cat.includes('overnight') || cat.includes('liquid') || cat.includes('money market') || cat.includes('ultra short')) shortDurW += w;
                        });
                        const shortDominated = totalDebtW > 0 && shortDurW / totalDebtW > 0.6;
                        if (shortDominated) return 'Debt sleeve is dominated by short-duration/arbitrage holdings — rate sensitivity is minimal despite the duration figure';
                        if (avgDuration >= 6) return 'Very high rate sensitivity — long-duration debt, significant impact from rate moves';
                        if (avgDuration >= 4) return 'High rate sensitivity — medium-to-long duration debt';
                        if (avgDuration >= 2) return 'Moderate rate sensitivity — typical for corporate bond and medium duration funds';
                        if (avgDuration >= 0.5) return 'Low rate sensitivity — short-duration debt';
                        return 'Minimal rate sensitivity — near-cash or arbitrage dominated';
                      })() },
                      { f:'Annualised volatility', v:annualStd!=null?annualStd.toFixed(1)+'%':'—', ex:'blended, 3Y', note:annualStd!=null?(annualStd>=18?'High — expect large swings in value':(annualStd<=8?'Low — relatively stable':'Moderate variability year to year')):'Insufficient data' }
                    ].map((r,i) => <tr key={i} style={{ borderBottom:'1px solid '+GR20 }}>
                      <td style={{ padding:'8px 14px', fontSize:12, fontWeight:600, color:GR80 }}>{r.f}</td>
                      <td style={{ padding:'8px 14px', textAlign:'right', fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:PLUM }}>{r.v}</td>
                      <td style={{ padding:'8px 14px', fontSize:11, color:GR60 }}>{r.ex}</td>
                      <td style={{ padding:'8px 14px', fontSize:11.5, color:GR80 }}>{r.note}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>

            {/* VaR & ES — Historical Simulation */}
            {(() => {
              const hRows = histVar?.var || [];
              const showHist = hRows.length > 0 && hRows.some(r => r.var_95 != null);
              if (!showHist && !histVarLoading) return null;
              return <div style={cardStyle}>
                <div style={cardHdStyle}>
                  Value-at-Risk &amp; Expected Shortfall — Historical Simulation
                  {histVarLoading && <span style={{ fontWeight:400, color:GR60, marginLeft:8 }}>Computing…</span>}
                </div>
                {showHist && <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ background:'#F0F9F5', borderBottom:'1px solid '+GR20 }}>
                        <th style={{ textAlign:'left', padding:'7px 14px', fontSize:9, fontWeight:700, color:MUT }}>Horizon</th>
                        {['95% VaR','95% ES','99% VaR','99% ES'].map((h,i) => <th key={i} style={{ textAlign:'right', padding:'7px 12px', fontSize:9, color:'#1A5C3A', fontWeight:600 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {hRows.map((r,i) => <tr key={i} style={{ borderBottom:'1px solid '+GR20 }}>
                        <td style={{ padding:'9px 14px', fontSize:12, fontWeight:600, color:GR80 }}>{r.horizon}</td>
                        {[r.var_95, r.es_95, r.var_99, r.es_99].map((v,j) => <td key={j} style={{ textAlign:'right', padding:'9px 12px' }}>
                          {v!=null ? <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:NEG }}>−{v.toFixed(1)}%</span> : <span style={{ color:GR60 }}>—</span>}
                        </td>)}
                      </tr>)}
                    </tbody>
                  </table>
                </div>}
                <div style={{ padding:'10px 14px', fontSize:10.5, color:GR60, borderTop:'1px solid '+GR20, lineHeight:1.7 }}>
                  Historical simulation — overlapping period returns from actual NAV history.
                  {histVar?.parametric_funds?.length > 0 && <span style={{ color:WARN }}> {histVar.parametric_funds.length} fund(s) with insufficient NAV history used parametric fallback.</span>}
                </div>
              </div>;
            })()}

            {/* Interactive calculator */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>Sensitivity calculator — model a scenario</div>
              <div style={{ padding:'16px 20px' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, marginBottom:16 }}>
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11.5, marginBottom:6 }}>
                      <span style={{ fontWeight:700, color:GR80 }}>Market move</span>
                      <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, color:PLUM }}>{sensMarket>=0?'+':''}{sensMarket}%</span>
                    </div>
                    <input type="range" min={-30} max={30} value={sensMarket} step={1} onChange={e=>setSensMarket(parseInt(e.target.value))} style={{ width:'100%' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:GR60 }}><span>−30%</span><span>+30%</span></div>
                  </div>
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11.5, marginBottom:6 }}>
                      <span style={{ fontWeight:700, color:GR80 }}>Interest rate move</span>
                      <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, color:PLUM }}>{sensRate>=0?'+':''}{sensRate}bp</span>
                    </div>
                    <input type="range" min={-200} max={200} value={sensRate} step={10} onChange={e=>setSensRate(parseInt(e.target.value))} style={{ width:'100%' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:GR60 }}><span>−200bp</span><span>+200bp</span></div>
                  </div>
                </div>
                <div style={{ background:PLUM, borderRadius:12, padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-around', flexWrap:'wrap', gap:12 }}>
                  <div style={{ textAlign:'center' }}><div style={{ fontFamily:'var(--font-mono)', fontSize:16, fontWeight:700, color:'#fff' }}>{eqContrib>=0?'+':''}{eqContrib.toFixed(1)}%</div><div style={{ fontSize:9, color:'rgba(255,255,255,.6)', textTransform:'uppercase', letterSpacing:'.04em' }}>From equity sleeve</div></div>
                  <div style={{ fontSize:20, color:'rgba(255,255,255,.4)' }}>+</div>
                  <div style={{ textAlign:'center' }}><div style={{ fontFamily:'var(--font-mono)', fontSize:16, fontWeight:700, color:'#fff' }}>{rateContrib>=0?'+':''}{rateContrib.toFixed(1)}%</div><div style={{ fontSize:9, color:'rgba(255,255,255,.6)', textTransform:'uppercase', letterSpacing:'.04em' }}>From debt sleeve</div></div>
                  <div style={{ fontSize:20, color:'rgba(255,255,255,.4)' }}>=</div>
                  <div style={{ textAlign:'center' }}><div style={{ fontFamily:'var(--font-serif)', fontSize:28, fontWeight:700, color:'#fff' }}>{totalImpact>=0?'+':''}{totalImpact.toFixed(1)}%</div><div style={{ fontSize:9, color:'rgba(255,255,255,.6)', textTransform:'uppercase', letterSpacing:'.04em' }}>Estimated portfolio impact</div></div>

                </div>
              </div>
            </div>

            {/* Market reference */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>{avgEqBeta!=null ? 'Market sensitivity — reference scenarios (β='+avgEqBeta.toFixed(2)+', '+eqW.toFixed(0)+'% equity weight)' : 'Market sensitivity'}</div>
              {avgEqBeta!=null ? <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    <th style={{ textAlign:'left', padding:'7px 14px', fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, background:GR10 }}>Market move</th>
                    <th style={{ padding:'7px 14px', background:GR10 }}></th>
                    <th style={{ textAlign:'right', padding:'7px 14px', fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, background:GR10 }}>Est. impact</th>
                  </tr></thead>
                  <tbody>
                    {marketShocks.map(s => { const v = (eqW/100)*avgEqBeta*s; return <tr key={s} style={{ borderBottom:'1px solid '+GR20 }}>
                      <td style={{ padding:'7px 14px', fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600, color:GR80 }}>{s>=0?'+':''}{s}%</td>
                      <td style={{ padding:'7px 14px' }}><DivBar value={v} maxAbs={marketMax}/></td>
                      <td style={{ padding:'7px 14px', textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12.5, fontWeight:700, color:v>=0?POS:NEG }}>{v>=0?'+':''}{v.toFixed(1)}%</td>
                    </tr>; })}
                  </tbody>
                </table>
              </div> : <div style={{ padding:20, textAlign:'center', color:GR60, fontSize:11.5 }}>No equity holdings with beta data — market sensitivity cannot be estimated.</div>}
            </div>

            {/* Rate reference */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>{avgDuration!=null ? 'Interest rate sensitivity — reference scenarios (duration='+avgDuration.toFixed(1)+'y, '+debtW.toFixed(0)+'% debt weight)' : 'Interest rate sensitivity'}</div>
              {avgDuration!=null ? <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>
                    <th style={{ textAlign:'left', padding:'7px 14px', fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, background:GR10 }}>Rate move</th>
                    <th style={{ padding:'7px 14px', background:GR10 }}></th>
                    <th style={{ textAlign:'right', padding:'7px 14px', fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, background:GR10 }}>Est. impact</th>
                  </tr></thead>
                  <tbody>
                    {rateShocks.map(bps => { const v = rateImpact(bps); return <tr key={bps} style={{ borderBottom:'1px solid '+GR20 }}>
                      <td style={{ padding:'7px 14px', fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600, color:GR80 }}>{bps>=0?'+':''}{bps}bp</td>
                      <td style={{ padding:'7px 14px' }}><DivBar value={v} maxAbs={rateMax}/></td>
                      <td style={{ padding:'7px 14px', textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12.5, fontWeight:700, color:v>=0?POS:NEG }}>{v>=0?'+':''}{v.toFixed(1)}%</td>
                    </tr>; })}
                  </tbody>
                </table>
              </div> : <div style={{ padding:20, textAlign:'center', color:GR60, fontSize:11.5 }}>No debt holdings in this portfolio — rate sensitivity is not applicable.</div>}
            </div>

            {/* Combined matrix */}
            {(avgEqBeta!=null || avgDuration!=null) && <div style={cardStyle}>
              <div style={cardHdStyle}>Combined scenarios — market move × rate move</div>
              <div style={{ padding:'14px 18px', overflowX:'auto' }}>
                <table style={{ borderCollapse:'collapse', margin:'0 auto' }}>
                  <tbody>
                    <tr><td style={{ width:90 }}></td>{rAxis.map(r => <td key={r} style={{ textAlign:'center', padding:4, fontSize:9.5, fontWeight:700, color:MUT }}>Rates {r>=0?'+':''}{r}bp</td>)}</tr>
                    {mAxis.map(m => <tr key={m}>
                      <td style={{ textAlign:'right', padding:'4px 10px', fontSize:10.5, fontWeight:700, color:GR80, whiteSpace:'nowrap' }}>Market {m>=0?'+':''}{m}%</td>
                      {rAxis.map(r => {
                        const v = combinedImpact(m,r);
                        const mag = Math.min(Math.abs(v)/matrixMax, 1);
                        const bg = v>=0 ? 'rgba(26,122,82,'+(0.12+mag*0.55).toFixed(2)+')' : 'rgba(185,28,28,'+(0.12+mag*0.55).toFixed(2)+')';
                        const txt = mag>0.55 ? '#fff' : (v>=0?POS:NEG);
                        return <td key={r} style={{ padding:4 }}><div style={{ height:34, borderRadius:6, background:bg, display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{ fontFamily:'var(--font-mono)', fontSize:11.5, fontWeight:700, color:txt }}>{v>=0?'+':''}{v.toFixed(1)}%</span></div></td>;
                      })}
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>}

            {/* Risk contribution */}
            {riskContrib.length > 0 && <div style={cardStyle}>
              <div style={cardHdStyle}>Risk contribution by holding — where today's volatility actually comes from</div>
              <div style={{ padding:'14px 18px' }}>
                <div style={{ fontSize:11.5, color:GR60, marginBottom:12 }}>Each holding's share of total blended volatility (weight × its own 3Y std deviation, normalised to 100%). This is diagnostic — it shows where risk is concentrated <em>today</em>, not a hypothetical change. To model a change, use the What-If tab.</div>
                {riskContrib.slice(0,10).map(r => { const pct = r.contrib/totalContrib*100; return <div key={r.f.isin} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:7 }}>
                  <div style={{ width:200, flexShrink:0, textAlign:'right', fontSize:11, color:GR80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.f.name}>{r.f.name}</div>
                  <div style={{ flex:1, position:'relative', height:16, background:GR10, borderRadius:4, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:pct.toFixed(1)+'%', background:BERRY, borderRadius:4 }}/>
                  </div>
                  <div style={{ width:96, flexShrink:0, fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700, color:PLUM, whiteSpace:'nowrap' }}>{pct.toFixed(1)}% of risk</div>
                  <div style={{ width:52, flexShrink:0, fontSize:10, color:GR60, whiteSpace:'nowrap' }}>({r.w}% wt)</div>
                </div>; })}
              </div>
            </div>}

            {/* Methodology */}
            <div style={{ marginTop:8, border:'1px solid '+GR20, borderRadius:12, overflow:'hidden' }}>
              <div style={cardHdStyle}>Methodology & limitations</div>
              <div style={{ padding:'14px 18px', fontSize:11.5, color:GR80, lineHeight:1.85 }}>
                <strong style={{ color:MUT }}>Beta & duration:</strong> equity beta is each fund's disclosed 3Y beta, weighted by portfolio allocation. Debt duration uses each fund's actual modified duration from the daily Morningstar data where available, falling back to a category-level proxy (e.g. Overnight ≈ 0.01yr, Corporate Bond ≈ 3.5yr, Long Duration ≈ 8yr) only when missing.
                <br/><br/><strong style={{ color:MUT }}>VaR & Expected Shortfall:</strong> parametric estimates assuming normally-distributed returns, scaled from the portfolio's blended 3Y annualised volatility by √time. Expected Shortfall (CVaR) is the average loss conditional on breaching VaR — real return distributions typically have fatter tails than the normal assumption, so actual worst-case losses can exceed these estimates.
                <br/><br/><strong style={{ color:MUT }}>All estimates are linear approximations</strong> for illustration and directional understanding — not a precise forecast or a substitute for a full risk model.
              </div>
            </div>
          </div>;
        })()}

        {/* ── WHAT-IF ── */}
        {activeTab === 'whatif' && (() => {
          const BERRY='#912F63', PLUM='#3E3452', MUT='#6D5479', GR60='#A2A0A0', GR80='#374151', GR20='#E8E5EC', GR10='#F8F6FA', POS='#1A7A52', NEG='#B91C1C', WARN='#D97706', LAV='#A795AE';

          if (!funds.length) {
            return <div style={{ padding:40, textAlign:'center', color:GR60 }}><div style={{ fontSize:32, opacity:.2, marginBottom:12 }}>🔀</div><div style={{ fontFamily:'var(--font-serif)', fontSize:17, color:PLUM, marginBottom:6 }}>Add funds to the portfolio</div><div style={{ fontSize:13 }}>What-if analysis needs at least one fund in the portfolio.</div></div>;
          }
          function inr(v){ if(v==null) return '—'; const s=v<0?'−':''; v=Math.abs(Math.round(v)); if(v>=10000000) return s+'₹'+(v/10000000).toFixed(2)+' Cr'; if(v>=100000) return s+'₹'+(v/100000).toFixed(2)+' L'; return s+'₹'+v.toLocaleString('en-IN'); }

          function fundBucket(f, fsnap){
            if (isDebtLike(fsnap, f)) return 'debt';
            if (isEquityLike(fsnap, f)) return 'equity';
            if (isHybrid(fsnap, f)) return 'hybrid';
            return 'other';
          }

          let eqW=0, debtW=0;
          funds.forEach(f => {
            const w = weights[f.isin] || 0;
            const bucket = fundBucket(f, snapshots[f.isin]);
            if (bucket==='equity') eqW += w; else if (bucket==='debt') debtW += w;
          });

          const cardHdStyle = { padding:'10px 16px', fontSize:9.5, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:MUT, background:GR10, borderBottom:'1px solid '+GR20 };
          const cardStyle = { marginBottom:18, border:'1px solid '+GR20, borderRadius:8, overflow:'hidden', background:'#fff' };

          // Fund substitution — multi-swap (up to 3)
          const safeSnap = (s, path) => {
            if (!s) return null;
            const v = path.split('.').reduce((o, k) => o?.[k], s);
            if (v == null || v === '-') return null;
            const p = parseFloat(v);
            return isNaN(p) ? null : p;
          };
          const getSnap = isin => wiSwapSnaps[isin] || snapshots[isin];  // combine both sources



          function updateSwap(idx, field, value) {
            setWiSwaps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
          }
          function addSwapRow() {
            setWiSwaps(prev => prev.length < 3 ? [...prev, { from: '', to: '' }] : prev);
          }
          function removeSwapRow(idx) {
            setWiSwaps(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
          }
          function handleSwapSearch(idx, q) {
            // Update query immediately so input feels responsive
            setWiSwapQ(prev => { const a=[...prev]; a[idx]=q; return a; });
            if (q.length < 2) {
              setWiSwapRes(prev => { const a=[...prev]; a[idx]=[]; return a; });
              setWiSwapLoading(prev => { const a=[...prev]; a[idx]=false; return a; });
              return;
            }
            setWiSwapLoading(prev => { const a=[...prev]; a[idx]=true; return a; });
            fetch(`${API}/api/funds/search?q=${encodeURIComponent(q)}&limit=20`)
              .then(r => r.json())
              .then(d => {
                // Sort by relevance: exact name match first, then starts-with, then contains
                const qL = q.toLowerCase();
                const sorted = (d.funds || []).slice().sort((a, b) => {
                  const aL = (a.name||'').toLowerCase();
                  const bL = (b.name||'').toLowerCase();
                  const aStart = aL.startsWith(qL) ? 0 : aL.includes(qL) ? 1 : 2;
                  const bStart = bL.startsWith(qL) ? 0 : bL.includes(qL) ? 1 : 2;
                  return aStart - bStart;
                });
                setWiSwapRes(prev => { const a=[...prev]; a[idx]=sorted; return a; });
                setWiSwapLoading(prev => { const a=[...prev]; a[idx]=false; return a; });
              })
              .catch(() => setWiSwapLoading(prev => { const a=[...prev]; a[idx]=false; return a; }));
          }
          function selectSwapTo(idx, isin) {
            updateSwap(idx, 'to', isin);
            setWiSwapQ(prev => { const a=[...prev]; a[idx]=''; return a; });
            setWiSwapRes(prev => { const a=[...prev]; a[idx]=[]; return a; });
            // Eagerly fetch snapshot if not already available
            if (!wiSwapSnaps[isin] && !snapshots[isin]) {
              const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().slice(0,10) : selectedDate;
              if (dateStr) {
                fetch(`${API}/api/home/snapshot?isin=${isin}&date=${dateStr}`)
                  .then(r => r.ok ? r.json() : null)
                  .then(data => { if (data) setWiSwapSnaps(prev => ({ ...prev, [isin]: data })); })
                  .catch(() => {});
              }
            }
          }

          // Compute combined delta across ALL swaps
          function combinedSwapDelta(getter) {
            let delta = 0;
            let hasAny = false;
            for (const s of wiSwaps) {
              if (!s.from || !s.to) continue;
              const w = (weights[s.from] || 0) / 100;
              const fromVal = getter(getSnap(s.from));
              const toVal = getter(getSnap(s.to));
              if (fromVal == null || toVal == null) continue;
              delta += (toVal - fromVal) * w;
              hasAny = true;
            }
            return hasAny ? delta : null;
          }
          const dR6m  = combinedSwapDelta(s => safeSnap(s, 'returns.6m'));
          const dR1y  = combinedSwapDelta(s => safeSnap(s, 'returns.1y'));
          const dR3y  = combinedSwapDelta(s => safeSnap(s, 'returns.3y'));
          const dStd  = combinedSwapDelta(s => safeSnap(s, 'risk.std_dev_3y'));
          const dSh   = combinedSwapDelta(s => safeSnap(s, 'risk.sharpe_ratio_3y'));
          const dTr   = combinedSwapDelta(s => safeSnap(s, 'risk.treynor_ratio_3y'));
          const dUpC  = combinedSwapDelta(s => safeSnap(s, 'risk.up_capture_3y'));
          const dDnC  = combinedSwapDelta(s => safeSnap(s, 'risk.down_capture_3y'));

          const validSwaps = wiSwaps.filter(s => s.from && s.to && s.from !== s.to);
          const canApply = validSwaps.length > 0;

          function applyAllSwaps() {
            if (!canApply) return;
            let newFunds = [...funds];
            let newWeights = { ...weights };
            for (const s of validSwaps) {
              // Build toData from any available source — snapshot is most reliable
              const snap = getSnap(s.to);
              const toData = snap
                ? { isin: s.to, name: snap.name || s.to, category: snap.category || '' }
                : wiCandidates.find(f => f.isin === s.to)
                || (wiSwapRes || []).flat().find(f => f.isin === s.to)
                || { isin: s.to, name: s.to, category: '' };  // fallback — always apply, never skip
              newFunds = newFunds.map(f => f.isin === s.from
                ? { ...f, isin: s.to, name: toData.name, category: toData.category }
                : f);
              newWeights[s.to] = newWeights[s.from] || 0;
              delete newWeights[s.from];
            }
            setFunds(newFunds);
            setWeights(newWeights);
            setWiSwaps([{ from: '', to: '' }]);
            try { localStorage.removeItem('buglerock_wi_swaps'); } catch {}
            setWiSwapQ(['', '', '']);
            setWiSwapRes([[], [], []]);
            if (onBackToBuild) onBackToBuild();
          }

          // Base blended metrics
          // ── Allocation shift (Option D) ──
          // Only pure equity/debt funds are scaled. Hybrids/gold/international unchanged.
          // This keeps the shift transparent and auditable.
          const safeF2 = (s, v) => { const p = parseFloat(v); return isNaN(p) || v==='-' ? null : p; };
          function fundShiftBucket(f, s) {
            const eqPct  = safeF2(s, s?.equity_pct);
            const bndPct = safeF2(s, s?.bond_pct);
            if (eqPct != null && bndPct != null) {
              if (eqPct >= 80) return 'equity';
              if (bndPct >= 80) return 'debt';
              return 'hybrid';
            }
            if (isEquityLike(s, f)) return 'equity';
            if (isDebtLike(s, f)) return 'debt';
            return 'hybrid';
          }
          let pureEqW = 0, pureDebtW = 0;
          funds.forEach(f => {
            const w = weights[f.isin] || 0;
            const bucket = fundShiftBucket(f, snapshots[f.isin]);
            if (bucket === 'equity') pureEqW   += w;
            if (bucket === 'debt')   pureDebtW += w;
          });
          // Full effective sleeve totals for display (includes hybrids via look-through)
          let eqEff = 0, debtEff = 0;
          funds.forEach(f => {
            const w = weights[f.isin] || 0;
            const s = snapshots[f.isin];
            const ep = safeF2(s, s?.equity_pct) ?? (isEquityLike(s,f) ? 100 : 0);
            const bp = safeF2(s, s?.bond_pct)   ?? (isDebtLike(s,f)   ? 100 : 0);
            eqEff   += w * ep / 100;
            debtEff += w * bp / 100;
          });
          const shiftLimit = Math.min(pureEqW, pureDebtW, 30);

          function scaledBlend(shiftVal){
            const eqScale   = pureEqW   > 0 ? (pureEqW   - shiftVal) / pureEqW   : 1;
            const debtScale = pureDebtW > 0 ? (pureDebtW + shiftVal) / pureDebtW : 1;
            const b = { r1y:0, r3y:0, std:0, sharpe:0, treynor:0, er:0, sumW:0 };
            funds.forEach(f => {
              const w = weights[f.isin] || 0;
              const s = snapshots[f.isin];
              const safeF = v => { const p = parseFloat(v); return isNaN(p) || v==='-' ? null : p; };
              const bucket = fundShiftBucket(f, s);
              const wf = bucket === 'equity' ? w * eqScale
                       : bucket === 'debt'   ? w * debtScale
                       : w;  // hybrids/gold/other unchanged
              if (s) {
                const r1y = safeF(s.returns?.['1y']); if (r1y!=null) { b.r1y += r1y * wf/100; }
                const r3y = safeF(s.returns?.['3y']); if (r3y!=null) { b.r3y += r3y * wf/100; }
                const std = safeF(s.risk?.std_dev_3y); if (std!=null) { b.std += std * wf/100; }
                const sh  = safeF(s.risk?.sharpe_ratio_3y); if (sh!=null) { b.sharpe += sh * wf/100; }
                const tr  = safeF(s.risk?.treynor_ratio_3y); if (tr!=null) { b.treynor += tr * wf/100; }
                const er  = safeF(s.expense_ratio); if (er!=null) { b.er += er * wf/100; }
                b.sumW += wf;
              }
            });
            return b;
          }
          // Use scaledBlend(0) as base so delta is exactly zero at no shift
          const _base = scaledBlend(0);
          const baseR1y = _base.r1y || B.return_1y;
          const baseR3y = _base.r3y || B.return_3y;
          const baseStd = _base.std || B.std_dev_3y;
          const baseSharpe = _base.sharpe || B.sharpe_ratio_3y;
          const baseTreynor = _base.treynor || B.treynor_ratio_3y;
          const baseEr = _base.er || B.expense_ratio;
          const shiftedBlend = scaledBlend(wiShift);
          function delta(cur, base, fmt='pct'){
            if (cur==null || base==null) return null;
            const d = cur - base;
            return { val:d, str: (d>=0?'+':'')+d.toFixed(2)+(fmt==='pct'?'%':'') };
          }

          function applyShift(){
            if (!setWeights || !wiShift) return;
            setPrevWeights({ ...weights });  // snapshot current weights for revert
            try { localStorage.setItem('buglerock_prev_weights', JSON.stringify(weights)); } catch {}
            // Option D: only scale pure equity and pure debt funds, hybrids unchanged
            const eqScale   = pureEqW   > 0 ? (pureEqW   - wiShift) / pureEqW   : 1;
            const debtScale = pureDebtW > 0 ? (pureDebtW + wiShift) / pureDebtW : 1;
            const nw = { ...weights };
            funds.forEach(f => {
              const w = weights[f.isin] || 0;
              const bucket = fundShiftBucket(f, snapshots[f.isin]);
              if (bucket === 'equity') nw[f.isin] = parseFloat((w * eqScale).toFixed(2));
              else if (bucket === 'debt') nw[f.isin] = parseFloat((w * debtScale).toFixed(2));
              // hybrids and others: unchanged
            });
            // Normalise to exactly 100
            const total = Object.values(nw).reduce((s, v) => s + v, 0);
            if (total > 0) Object.keys(nw).forEach(k => nw[k] = parseFloat((nw[k] / total * 100).toFixed(2)));
            setWeights(nw);
            // Do NOT reset wiShift — keep slider position so user can see what was applied
            if (onBackToBuild) onBackToBuild();
          }

          function revertShift() {
            if (!prevWeights) return;
            setWeights(prevWeights);
            setPrevWeights(null);
            setWiShift(0);  // reset slider only on revert
            try { localStorage.removeItem('buglerock_prev_weights'); localStorage.removeItem('buglerock_wi_shift'); } catch {}
            if (onBackToBuild) onBackToBuild();
          }

          // ── Growth projection ──
          const growthRate = (baseR3y != null ? baseR3y : 12) / 100;
          const infl = wiInflation / 100;
          const months = wiYears * 12;
          const monthlyRate = Math.pow(1 + growthRate, 1/12) - 1;
          const lumpFuture = wiLump * Math.pow(1 + growthRate, wiYears);
          const sipFuture = wiSip * (monthlyRate > 0 ? ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate) : months);
          const totalFuture = lumpFuture + sipFuture;
          const totalInvested = wiLump + wiSip * months;
          const gains = totalFuture - totalInvested;
          const realValue = totalFuture / Math.pow(1 + infl, wiYears);

          // Reverse SIP calculator
          const targetMinusLump = wiTarget - lumpFuture;
          const requiredSip = targetMinusLump > 0 && monthlyRate > 0
            ? targetMinusLump / (((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate))
            : null;

          return <div>
            <div style={{ fontFamily:'var(--font-serif)', fontSize:15, fontWeight:600, color:PLUM, marginBottom:4 }}>What-if analysis</div>
            <div style={{ fontSize:12, color:GR60, marginBottom:16 }}>Model concrete changes to this portfolio — allocation shifts and growth paths — before committing to anything</div>

            {/* Fund substitution — multi-swap up to 3 */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>Fund substitution — what if you swapped a holding?</div>
              <div style={{ padding:'16px 20px' }}>
                {wiSwaps.map((swap, idx) => {
                  const swapFromFund = funds.find(f => f.isin === swap.from);
                  const swapCat = swapFromFund?.category || snapshots[swap.from]?.category || '';
                  const swapCandidates = swap.from ? wiCandidates.filter(f => f.isin !== swap.from) : [];
                  const swapSearchQ = wiSwapQ[idx] || '';
                  const swapSearchRes = wiSwapRes[idx] || [];
                  const swapSearching = wiSwapLoading[idx] || false;
                  const swapDdOpen = swapSearchQ.length >= 2 && swapSearchRes.length > 0;

                  return <div key={idx} style={{ marginBottom:18, paddingBottom:18, borderBottom: idx < wiSwaps.length-1 ? '1px dashed '+GR20 : 'none' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:14, alignItems:'start' }}>

                      {/* LEFT: Replace this holding */}
                      <div>
                        <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT, display:'block', marginBottom:4 }}>Replace holding {wiSwaps.length > 1 ? '#'+(idx+1) : ''}</label>
                        <select value={swap.from} onChange={e => { updateSwap(idx, 'from', e.target.value); updateSwap(idx, 'to', ''); }}
                          style={{ width:'100%', padding:'7px 9px', border:'1px solid '+GR20, borderRadius:6, fontSize:12.5, background:'#fff' }}>
                          <option value=''>— pick fund to replace —</option>
                          {[...funds].sort((a,b) => (weights[b.isin]||0)-(weights[a.isin]||0))
                            .filter(f => !wiSwaps.some((s, si) => si !== idx && s.from === f.isin))
                            .map(f => <option key={f.isin} value={f.isin}>{f.name} ({weights[f.isin]||0}%)</option>)}
                        </select>
                      </div>

                      {/* RIGHT: With this fund — R1/R2 dropdown + search */}
                      <div>
                        <label style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', color:MUT, display:'block', marginBottom:4 }}>With this fund</label>
                        {/* R1/R2 dropdown — includes search-selected fund as option so it shows correctly */}
                        {(() => {
                          const searchSelected = swap.to && !swapCandidates.find(f => f.isin === swap.to)
                            ? (getSnap(swap.to) || swapSearchRes.find(f => f.isin === swap.to))
                            : null;
                          return <select value={swap.to} onChange={e => updateSwap(idx, 'to', e.target.value)} disabled={!swap.from}
                            style={{ width:'100%', padding:'7px 9px', border:'1px solid '+GR20, borderRadius:6, fontSize:12.5, background: swap.from ? '#fff' : GR10, marginBottom:6 }}>
                            <option value=''>— R1/R2 in same category —</option>
                            {swapCandidates.map(f => <option key={f.isin} value={f.isin}>{f.name} ({f.ranking})</option>)}
                            {searchSelected && <option key={swap.to} value={swap.to}>
                              {searchSelected.name || swap.to}
                            </option>}
                          </select>;
                        })()}
                        {/* Per-swap search box — exactly like BuildPortfolio */}
                        {swap.from && <div style={{ position:'relative' }}>
                          <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:GR60, fontSize:12, pointerEvents:'none' }}>⊕</span>
                          <input
                            type='search'
                            value={swapSearchQ}
                            onChange={e => handleSwapSearch(idx, e.target.value)}
                            placeholder='Search any fund by name…'
                            style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid '+GR20, borderRadius:6, fontSize:12, boxSizing:'border-box' }}
                          />
                          {swapSearching && <span style={{ position:'absolute', right:10, top:9, fontSize:10, color:GR60 }}>Searching…</span>}
                          {swapDdOpen && <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, right:0, background:'#fff', border:'1px solid '+GR20, borderRadius:8, boxShadow:'0 4px 16px rgba(62,52,82,.12)', maxHeight:200, overflowY:'auto', zIndex:50 }}>
                            {swapSearchRes.slice(0,5).map(f => <div key={f.isin}
                              onClick={() => selectSwapTo(idx, f.isin)}
                              style={{ padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid '+GR20, fontSize:12 }}
                              onMouseEnter={e=>e.currentTarget.style.background=GR10}
                              onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                              <div style={{ fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:2 }}>{f.name}</div>
                              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                                <span style={{ fontSize:9, background:GR10, padding:'1px 6px', borderRadius:10, color:GR80 }}>{f.category}</span>
                                {f.ranking && <span style={{ fontSize:9, fontWeight:700, color: ['R1','R2'].includes(f.ranking)?POS:NEG }}>{f.ranking}</span>}
                                {f.return_1y!=null && <span style={{ fontSize:9, color:f.return_1y>=0?POS:NEG, fontWeight:600 }}>{f.return_1y>=0?'+':''}{f.return_1y?.toFixed(1)}%</span>}
                              </div>
                            </div>)}
                            {swapSearchRes.length > 5 && <div style={{ padding:'6px 12px', fontSize:10, color:GR60, textAlign:'center' }}>Scroll for {swapSearchRes.length-5} more results</div>}
                          </div>}
                        </div>}
                      </div>

                      {/* +/- buttons */}
                      <div style={{ display:'flex', gap:6, paddingTop:24 }}>
                        {wiSwaps.length > 1 && <button onClick={() => removeSwapRow(idx)}
                          style={{ width:28, height:28, borderRadius:'50%', background:'#fff', border:'1px solid '+GR20, color:NEG, fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>−</button>}
                        {idx === wiSwaps.length-1 && wiSwaps.length < 3 && <button onClick={addSwapRow}
                          style={{ width:28, height:28, borderRadius:'50%', background:BERRY, border:'none', color:'#fff', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>+</button>}
                      </div>
                    </div>
                  </div>;
                })}

                {/* Combined delta */}
                {canApply && <div style={{ background:GR10, borderRadius:8, padding:'14px 18px', marginBottom:14 }}>
                  <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, marginBottom:10 }}>
                    Portfolio impact after {validSwaps.length} swap{validSwaps.length > 1 ? 's' : ''}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:10 }}>
                    {[
                      { l:'6M Return',      v:dR6m,  unit:'%' },
                      { l:'1Y Return',      v:dR1y,  unit:'%' },
                      { l:'3Y CAGR',        v:dR3y,  unit:'%' },
                      { l:'Volatility (3Y)',v:dStd,  unit:'%' },
                      { l:'Sharpe (3Y)',    v:dSh,   unit:''  },
                      { l:'Treynor (3Y)',   v:dTr,   unit:''  },
                      { l:'Up Capture (3Y)',v:dUpC,  unit:'%' },
                      { l:'Dn Capture (3Y)',v:dDnC,  unit:'%' },
                    ].map(({l,v,unit}) => <div key={l} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:10, color:GR60, marginBottom:3 }}>{l}</div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color: v==null?GR60:v>=0?POS:NEG }}>
                        {v==null ? '—' : (v>=0?'+':'')+v.toFixed(2)+unit}
                      </div>
                    </div>)}
                  </div>
                  {validSwaps.some(s => !getSnap(s.to)) && <div style={{ fontSize:10.5, color:WARN, marginTop:10, textAlign:'center' }}>⏳ Loading candidate fund data…</div>}
                </div>}

                <button onClick={applyAllSwaps} disabled={!canApply}
                  style={{ padding:'8px 18px', background:canApply?BERRY:'#ccc', color:'#fff', border:'none', borderRadius:6, fontSize:11.5, cursor:canApply?'pointer':'default', fontWeight:600 }}>
                  Apply {validSwaps.length > 1 ? validSwaps.length + ' swaps' : 'this swap'} to the portfolio →
                </button>
              </div>
            </div>

            {/* Allocation shift */}
            <div style={cardStyle}>
              <div style={cardHdStyle}>Allocation shift — what if you moved money between equity and debt?</div>
              {eqEff>0 && debtEff>0 ? <div style={{ padding:'16px 20px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11.5, marginBottom:6 }}>
                  <span style={{ fontWeight:700, color:GR80 }}>Shift toward equity ←→ Shift toward debt</span>
                  <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, color:PLUM }}>{wiShift===0?'No shift':'+'+Math.abs(Math.round(wiShift))+'% to '+(wiShift>0?'debt':'equity')}</span>
                </div>
                <input type="range" min={-shiftLimit} max={shiftLimit} value={wiShift} step={1} onChange={e=>setWiShift(parseInt(e.target.value))} style={{ width:'100%' }}/>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:GR60, marginBottom:14 }}>
                  <span>+{Math.round(shiftLimit)}% more equity</span><span>+{Math.round(shiftLimit)}% more debt</span>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 }}>
                  {[
                    { l:'3Y return',     base:baseR3y,   cur:shiftedBlend.r3y,  fmt:'pct' },
                    { l:'Volatility',    base:baseStd,   cur:shiftedBlend.std,  fmt:'pct' },
                    { l:'Sharpe (3Y)',   base:baseSharpe,cur:shiftedBlend.sharpe,fmt:'num' },
                    { l:'Treynor (3Y)',  base:baseTreynor,cur:shiftedBlend.treynor,fmt:'num' },
                  ].map((m,i) => {
                    const d = delta(m.cur, m.base, m.fmt);
                    return <div key={i} style={{ background:GR10, borderRadius:8, padding:10, textAlign:'center' }}>
                      <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, marginBottom:4 }}>{m.l}</div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color:PLUM }}>{m.cur!=null?m.cur.toFixed(2)+(m.fmt==='pct'?'%':''):'—'}</div>
                      {d && <div style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:600, color:d.val>=0?POS:NEG, marginTop:2 }}>{d.str}</div>}
                    </div>;
                  })}
                </div>

                {/* Trade-off curve — risk vs return across full shift range */}
                {baseStd != null && (() => {
                  const W=540, H=210, PL=44, PB=24, PT=12, PR=12;
                  const scanPts = [];
                  for (let sv=-shiftLimit; sv<=shiftLimit; sv+=Math.max(1,Math.round(shiftLimit/12))) {
                    scanPts.push({ shift:Math.round(sv), b:scaledBlend(sv) });
                  }
                  const xs = scanPts.map(p=>p.b.std||0), ys = scanPts.map(p=>p.b.r3y||0);
                  const xPad=(Math.max(...xs)-Math.min(...xs)||1)*0.15, yPad=(Math.max(...ys)-Math.min(...ys)||1)*0.2;
                  const xMin=Math.min(...xs)-xPad, xMax=Math.max(...xs)+xPad;
                  const yMin=Math.min(...ys)-yPad, yMax=Math.max(...ys)+yPad;
                  const sx = v => PL+((v-xMin)/(xMax-xMin||1))*(W-PL-PR);
                  const sy = v => H-PB-((v-yMin)/(yMax-yMin||1))*(H-PB-PT);
                  const pathD = scanPts.map((p,i) => (i===0?'M':'L')+sx(p.b.std||0).toFixed(1)+','+sy(p.b.r3y||0).toFixed(1)).join(' ');
                  const cur = scaledBlend(wiShift);
                  return <div style={{ marginTop:14 }}>
                    <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:MUT, marginBottom:6 }}>Full trade-off — risk vs. return across the entire shift range</div>
                    <svg viewBox={'0 0 '+W+' '+H} style={{ width:'100%', maxWidth:640, height:240, display:'block', margin:'0 auto' }}>
                      <path d={pathD} fill="none" stroke={LAV} strokeWidth="2"/>
                      <circle cx={sx(cur.std||0).toFixed(1)} cy={sy(cur.r3y||0).toFixed(1)} r="6" fill={BERRY} stroke="#fff" strokeWidth="1.5"/>
                      {/* Shift labels above the line — absolute values only */}
                      {scanPts.filter((_,i)=>i%4===0).map((p,i) => <text key={i} x={sx(p.b.std||0)} y={sy(p.b.r3y||0)-8} fontSize="8" fill={p.shift<0?POS:p.shift>0?NEG:'#222'} fontWeight="600" textAnchor="middle">{Math.abs(Math.round(p.shift))}%</text>)}
                      {/* Directional labels parallel to line, below it */}
                      {(() => {
                        const p0 = scanPts[0], pN = scanPts[scanPts.length-1];
                        const x0=sx(p0.b.std||0), y0=sy(p0.b.r3y||0);
                        const x1=sx(pN.b.std||0), y1=sy(pN.b.r3y||0);
                        const angle = Math.atan2(y1-y0, x1-x0) * 180 / Math.PI;
                        const textAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
                        const midX=(x0+x1)/2, midY=(y0+y1)/2;
                        // Equity label near start of line (bottom-left)
                        const eqX=(x0+midX*0.4)/1.4, eqY=(y0+midY*0.4)/1.4+14;
                        // Debt label near end of line (top-right)
                        const dtX=(x1+midX*0.4)/1.4, dtY=(y1+midY*0.4)/1.4+14;
                        return <>
                          <text x={eqX} y={eqY} fontSize="8.5" fill={POS} fontWeight="700" textAnchor="middle" transform={`rotate(${textAngle},${eqX},${eqY})`}>more equity →</text>
                          <text x={dtX} y={dtY} fontSize="8.5" fill={NEG} fontWeight="700" textAnchor="middle" transform={`rotate(${textAngle},${dtX},${dtY})`}>← more debt</text>
                        </>;
                      })()}
                      <text x={W/2} y={H-4} fontSize="8.5" fill={MUT} textAnchor="middle" fontWeight="700">Risk →</text>
                      <text x={8} y={H/2} fontSize="8.5" fill={MUT} textAnchor="middle" fontWeight="700" transform={`rotate(-90,8,${H/2})`}>Return →</text>
                    </svg>
                    <div style={{ fontSize:9.5, color:GR60, textAlign:'center', marginTop:2 }}>Marker moves live as you drag the slider above</div>
                  </div>;
                })()}

                <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                  <button onClick={applyShift} disabled={wiShift===0} style={{ padding:'8px 18px', borderRadius:20, background:wiShift===0?GR20:'var(--brand-primary)', color:wiShift===0?GR60:'#fff', border:'none', fontSize:11.5, fontWeight:600, cursor:wiShift===0?'not-allowed':'pointer' }}>Apply this shift to the portfolio →</button>
                  <button onClick={revertShift} disabled={!prevWeights} style={{ padding:'8px 16px', borderRadius:20, background:'#fff', color:prevWeights?NEG:GR60, border:'1px solid '+(prevWeights?NEG:GR20), fontSize:11.5, fontWeight:600, cursor:prevWeights?'pointer':'not-allowed', opacity:prevWeights?1:0.5 }}>↩ Revert last shift</button>
                </div>
              </div> : <div style={{ padding:20, textAlign:'center', color:GR60, fontSize:11.5 }}>This portfolio needs both equity and debt exposure to model an allocation shift.</div>}
            </div>

            {/* Growth projection → moved to Returns tab */}

            <div style={{ fontSize:10.5, color:GR60, marginTop:8, lineHeight:1.6 }}>What-if scenarios are computed live against this portfolio's current holdings and weights, but nothing changes until you click an "Apply" button. Growth projections use the portfolio's 3Y CAGR as the annual assumption and are simplified illustrations — not a guarantee of future performance.</div>
          </div>;
        })()}

        {/* ── EXPOSURE ── */}
        {activeTab === 'exposure' && (() => {
          const AllocRow = ({ label, value, color, target }) => {
            const p = parseFloat(value) || 0;
            const inRange = !target || (p >= target[0] && p <= target[1]);
            const statusColor = target ? (inRange ? '#059669' : '#C0392B') : color;
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-body)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: statusColor }}>{p.toFixed(1)}%</span>
                </div>
                <div style={{ position: 'relative', height: 9, background: 'var(--border)', borderRadius: 5, maxWidth: '70%' }}>
                  <div style={{ width: Math.min(p, 100) + '%', height: '100%', background: color, borderRadius: 3, transition: 'width .4s' }} />
                  {target && (
                    <div style={{ position: 'absolute', top: -3, bottom: -3, left: target[0] + '%', width: Math.max(target[1] - target[0], 0) + '%', border: '2.5px dashed #222', borderRadius: 3, opacity: .35, pointerEvents: 'none' }} />
                  )}
                </div>
                {target && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Target {target[0]}–{target[1]}%</span>
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 20, background: inRange ? 'rgba(5,150,105,.1)' : 'rgba(192,57,43,.1)', color: statusColor }}>
                      {inRange ? '✓ in range' : '✗ out of range'}
                    </span>
                  </div>
                )}
              </div>
            );
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="ptf-card" style={{ padding: '14px 16px' }}>
                  <div className="ptf-card-hd">{ips?.alloc ? 'Asset allocation vs IPS targets' : 'Asset allocation'}</div>
                  <AllocRow label="Equity"       value={AC.equity}    color="#912F63" target={ips?.alloc ? [+(ips.alloc.eqMin||0), +(ips.alloc.eqMax||100)] : null} />
                  <AllocRow label="Bonds / Debt" value={AC.debt}      color="#3E3452" target={ips?.alloc ? [+(ips.alloc.debtMin||0), +(ips.alloc.debtMax||100)] : null} />
                  <AllocRow label="Cash / Liquid" value={AC.cash}     color="#A795AE" />
                  {AC.commodity > 0.5 && <AllocRow label="Commodities" value={AC.commodity} color="#D97706" />}
                  {AC.other     > 0.5 && <AllocRow label="REITs/Other"       value={AC.other}     color="#6D5479" />}
                </div>
                <div className="ptf-card" style={{ padding: '14px 16px' }}>
                  <div className="ptf-card-hd">{ips?.alloc ? 'Market cap split vs IPS targets' : 'Market cap split'}</div>
                  <AllocRow label="Large cap" value={B.large_cap} color="#185FA5" target={ips?.alloc ? [+(ips.alloc.lcMin||0), +(ips.alloc.lcMax||100)] : null} />
                  <AllocRow label="Mid cap" value={B.mid_cap} color="#1D9E75" target={ips?.alloc ? [+(ips.alloc.mcMin||0), +(ips.alloc.mcMax||100)] : null} />
                  <AllocRow label="Small cap" value={B.small_cap} color="#D85A30" target={ips?.alloc ? [+(ips.alloc.scMin||0), +(ips.alloc.scMax||100)] : null} />
                </div>
              </div>

              <div className="ptf-card" style={{ padding: '14px 16px' }}>
                <div className="ptf-card-hd">Market cap breakdown per fund</div>
                <div style={{ display: 'flex', gap: 16, marginBottom: 14, marginTop: 8 }}>
                  {[['Large cap','#185FA5'],['Mid cap','#1D9E75'],['Small cap','#D85A30']].map(([lbl,clr]) => (
                    <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: clr }} />{lbl}
                    </div>
                  ))}
                </div>
                {funds.filter(f => {
                  const snap = snapshots[f.isin];
                  const lc = snap?.large_cap || 0, mc = snap?.mid_cap || 0, sc = snap?.small_cap || 0;
                  if (!lc && !mc && !sc) return false;
                  const ac = (snap?.asset_class || f.asset_class || '').toLowerCase();
                  if (ac.includes('debt') || ac.includes('precious') || ac.includes('etf - debt') || ac.includes('commodity')) return false;
                  return true;
                }).map(f => {
                  const snap = snapshots[f.isin];
                  const w = weights[f.isin] || 0;
                  const lc = snap?.large_cap || 0, mc = snap?.mid_cap || 0, sc = snap?.small_cap || 0;
                  return (
                    <div key={f.isin} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <div style={{ width: 3, height: 28, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                          <div style={{ fontSize: 10, marginTop: 2, display: 'flex', gap: 8 }}>
                            {lc > 0 && <span style={{ color: '#185FA5' }}>Large {lc.toFixed(0)}%</span>}
                            {mc > 0 && <span style={{ color: '#1D9E75' }}>Mid {mc.toFixed(0)}%</span>}
                            {sc > 0 && <span style={{ color: '#D85A30' }}>Small {sc.toFixed(0)}%</span>}
                          </div>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{w}%</span>
                      </div>
                      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--border)', gap: 1, maxWidth: '80%' }}>
                        {lc > 0 && <div style={{ width: lc + '%', background: '#185FA5' }} />}
                        {mc > 0 && <div style={{ width: mc + '%', background: '#1D9E75' }} />}
                        {sc > 0 && <div style={{ width: sc + '%', background: '#D85A30' }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── CORRELATION ── */}
        {activeTab === 'correlation' && (
          <div>
            {funds.length < 2 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, opacity: .2, marginBottom: 12 }}>⊞</div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--brand-dark)', marginBottom: 6 }}>Add at least 2 funds</div>
                <div style={{ fontSize: 13 }}>Correlation analysis requires 2 or more funds in the portfolio.</div>
              </div>
            ) : (
              <>
                <div className="ptf-card" style={{ marginBottom: 14 }}>
                  <div className="ptf-card-hd">
                    Correlation matrix (3Y daily NAV returns)
                    {corrData?.date_range && (
                      <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                        {corrData.date_range.start} → {corrData.date_range.end} · {corrData.common_days} trading days
                      </span>
                    )}
                  </div>
                  {corrLoading && (
                    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Computing correlation...</div>
                  )}
                  <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)' }}></th>
                          {funds.map((f, i) => <th key={f.isin} style={{ padding: '8px 16px', textAlign: 'center', fontWeight: 700, fontSize: 12, color: f.color, whiteSpace: 'nowrap' }}>F{i + 1}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {funds.map((fi, i) => (
                          <tr key={fi.isin}>
                            <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <span style={{ color: fi.color }}>F{i + 1}</span> {fi.name}
                            </td>
                            {funds.map((fj, j) => {
                              const v = corrMatrix[i][j];
                              const { bg, color } = corrColor(v);
                              return (
                                <td key={fj.isin} style={{ padding: '10px 16px', textAlign: 'center', background: bg, color, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, borderRadius: 6, border: '3px solid #fff', minWidth: 80 }}>
                                  {v != null ? v.toFixed(2) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Excluded funds note */}
                {corrData?.excluded?.length > 0 && (
                  <div style={{ margin: '10px 0 14px', padding: '10px 14px', background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.3)', borderRadius: 8, fontSize: 11, color: '#92700A' }}>
                    <strong>Excluded from correlation</strong> (insufficient 3Y NAV data):
                    {' '}{corrData.excluded.map(e => {
                      const idx = funds.findIndex(f => f.isin === e.isin);
                      const label = idx >= 0 ? `F${idx + 1} ${funds[idx].name}` : e.isin;
                      return `${label} (${e.years_available}Y available)`;
                    }).join(', ')}
                  </div>
                )}
                {/* Correlation legend */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
                  {[['≥0.90', '#fde8ee', '#912F63', 'Very high — diversification benefit minimal'],
                    ['0.70–0.89', '#fef3e2', '#D97706', 'High — some overlap'],
                    ['0.50–0.69', '#f0f9f5', '#1A7A52', 'Moderate — reasonable diversification'],
                    ['<0.50', '#eef0f7', '#3E3452', 'Low — strong diversification'],
                  ].map(([range, bg, color, desc]) => (
                    <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-block', width: 28, height: 16, background: bg, borderRadius: 3, border: '1px solid #ddd', fontSize: 8, fontWeight: 700, color, textAlign: 'center', lineHeight: '16px' }}>{range}</span>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>

                {/* Insights */}
                {(() => {
                  const highPairs = [];
                  funds.forEach((fi, i) => funds.forEach((fj, j) => {
                    if (j > i && corrMatrix[i][j] != null && corrMatrix[i][j] >= 0.85)
                      highPairs.push(`${fi.name.split(' ').slice(0, 2).join(' ')} & ${fj.name.split(' ').slice(0, 2).join(' ')} (${corrMatrix[i][j].toFixed(2)})`);
                  }));
                  return highPairs.length > 0 ? (
                    <div className="ptf-insight-warn">⚠ High correlation detected: {highPairs.join('; ')}. Consider replacing one with a lower-correlated fund for better diversification.</div>
                  ) : (
                    <div className="ptf-insight-pos">✓ Portfolio shows reasonable diversification across calendar year return patterns.</div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── FUND DETAILS ── */}
        {activeTab === 'overlap' && (() => {
          const funds2 = equityFundsForOverlap;
          const nonEquity = funds.filter(f => !isActiveEquityFund(f));
          const overlapColor = (pct) => pct >= 35 ? '#C0392B' : pct >= 25 ? '#E67E22' : pct >= 15 ? '#F39C12' : pct >= 5 ? '#27AE60' : '#A0A0A0';
          const overlapLabel = (pct) => pct >= 35 ? 'Very High' : pct >= 25 ? 'High' : pct >= 15 ? 'Moderate' : pct >= 5 ? 'Low' : 'Negligible';

          return (
            <div style={{ padding: '4px 0' }}>
              {nonEquity.length > 0 && (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.3)', borderRadius: 8, fontSize: 12, color: '#92700A' }}>
                  ⚠ Overlap is based on equity stock holdings only. <strong>{nonEquity.map(f => shortFundName(f.name)).join(', ')}</strong> {nonEquity.length === 1 ? 'is' : 'are'} a pure debt fund and {nonEquity.length === 1 ? 'holds' : 'hold'} no equity stocks — excluded from overlap.
                </div>
              )}
              {funds2.length < 2 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Add at least 2 active equity funds to see overlap.</div>}
              {funds2.length >= 2 && overlapLoading && (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  {overlapError || 'Calculating overlap...'}
                  {overlapError && <div style={{ fontSize: 11, marginTop: 6 }}>Fetching from Morningstar, please wait...</div>}
                </div>
              )}
              {funds2.length >= 2 && overlapError && !overlapLoading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--neg)', fontSize: 13 }}>{overlapError}</div>}
              {funds2.length >= 2 && overlapData && !overlapLoading && (() => {
                const { pairwise_matrix, common_all, pair_details, fund_holdings_counts } = overlapData;
                const pairs = Object.values(pairwise_matrix);
                const fundMap = Object.fromEntries(funds2.map(f => [f.isin, f]));
                const fundsWithNoData = funds2.filter(f => (fund_holdings_counts?.[f.isin] ?? -1) === 0);
                if (fundsWithNoData.length > 0) return (
                  <div style={{ padding: 24, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>Holdings data not available for: {fundsWithNoData.map(f => f.name).join(', ')}</div>
                    <div style={{ fontSize: 11 }}>Contact admin to fetch holdings for these funds.</div>
                  </div>
                );
                const avgOverlap = pairs.length ? (pairs.reduce((s,p) => s+p.overlap_pct,0)/pairs.length).toFixed(1) : 0;
                const highestPair = pairs.reduce((best,p) => p.overlap_pct>(best?.overlap_pct||0)?p:best, null);
                const totalUniqueStocks = overlapData.unique_stock_count || '—';
                const heldByAllCount = common_all.length;
                const heldByAllName = common_all.length > 0 ? common_all[0].name : '—';
                const statCard = (value, label, sub, color) => (
                  <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 10, padding: '14px 16px', textAlign: 'center', minWidth: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: color||'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
                    {sub && <div style={{ fontSize: 11, color: 'var(--text-body)', marginTop: 3 }}>{sub}</div>}
                  </div>
                );
                return (
                  <div>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                      {statCard(`${avgOverlap}%`, 'Avg Overlap', `${funds2.length} funds · ${pairs.length} pairs`)}
                      {statCard(highestPair?`${highestPair.overlap_pct.toFixed(1)}%`:'—','Highest Pair', highestPair?`${shortFundName(fundMap[highestPair.fund_a]?.name)} ↔ ${shortFundName(fundMap[highestPair.fund_b]?.name)}`:'', overlapColor(highestPair?.overlap_pct||0))}
                      {statCard(totalUniqueStocks,'Unique Stocks',`${funds2.length} funds combined`)}
                      {statCard(heldByAllCount>0?heldByAllCount:'0','Held By Every Fund',heldByAllCount>0?`Top by weight: ${heldByAllName}`:'None in common',heldByAllCount>0?'var(--brand-primary)':'var(--text-muted)')}
                    </div>
                    <div style={{ marginBottom: 20, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 14 }}>Overlap matrix</div>
                      <table style={{ borderCollapse: 'separate', borderSpacing: 5, margin: '0 auto' }}>
                        <thead><tr>
                          <td style={{ width: 120 }}/>
                          {funds2.map(f => <th key={f.isin} style={{ textAlign: 'center', padding: '0 3px 8px', fontSize: 10, fontWeight: 500, width: 80 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: f.color }}/>
                              <div style={{ maxWidth: 75, textAlign: 'center', lineHeight: 1.3 }}>{shortFundName(f.name)}</div>
                            </div>
                          </th>)}
                        </tr></thead>
                        <tbody>
                          {funds2.map((fa, i) => (
                            <tr key={fa.isin}>
                              <td style={{ textAlign: 'right', padding: '3px 8px 3px 0', fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: fa.color, marginRight: 5, verticalAlign: 'middle' }}/>
                                {shortFundName(fa.name)}
                              </td>
                              {funds2.map((fb, j) => {
                                if (i===j) return <td key={fb.isin} style={{ width:80,height:50,background:'#f4f4f4',borderRadius:7,textAlign:'center',fontSize:16,color:'#ccc' }}>—</td>;
                                const key = i<j?`${fa.isin}|${fb.isin}`:`${fb.isin}|${fa.isin}`;
                                const p = pairwise_matrix[key]; const pct = p?.overlap_pct||0;
                                const bg = pct>=35?'rgba(192,57,43,.10)':pct>=25?'rgba(230,126,34,.10)':pct>=15?'rgba(243,156,18,.10)':pct>=5?'rgba(39,174,96,.10)':'#f4f4f4';
                                return <td key={fb.isin} style={{ width:80,height:50,background:bg,borderRadius:7,textAlign:'center',verticalAlign:'middle' }}>
                                  <div style={{ fontFamily:'var(--font-mono)',fontWeight:700,fontSize:16,color:overlapColor(pct) }}>{pct.toFixed(0)}%</div>
                                </td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ display:'flex',gap:14,marginTop:10,fontSize:10,color:'var(--text-muted)',justifyContent:'center' }}>
                        <span><span style={{color:'#A0A0A0'}}>●</span> &lt;5% Negligible</span>
                        <span><span style={{color:'#27AE60'}}>●</span> 5–15% Low</span>
                        <span><span style={{color:'#F39C12'}}>●</span> 15–25% Moderate</span>
                        <span><span style={{color:'#E67E22'}}>●</span> 25–35% High</span>
                        <span><span style={{color:'#C0392B'}}>●</span> &gt;35% Very high</span>
                      </div>
                    </div>
                    {pairs.map((p, pi) => {
                      const fa=fundMap[p.fund_a], fb=fundMap[p.fund_b];
                      const pd=pair_details[`${p.fund_a}|${p.fund_b}`]||{};
                      const shared=pd.shared||[], onlyA=pd.only_a||[], onlyB=pd.only_b||[];
                      const pct=p.overlap_pct; const clr=overlapColor(pct); const lbl=overlapLabel(pct);
                      const nameA=shortFundName(fa?.name), nameB=shortFundName(fb?.name);
                      return (
                        <div key={`${p.fund_a}|${p.fund_b}`} style={{ background:'#fff',border:'1px solid var(--border)',borderRadius:12,marginBottom:14,overflow:'hidden',boxShadow:'var(--shadow-card)' }}>
                          <div style={{ display:'flex',alignItems:'center',padding:'12px 18px',background:`${clr}12`,borderBottom:`1px solid ${clr}30`,gap:10 }}>
                            <div style={{ display:'flex',alignItems:'center',gap:7,flex:1 }}>
                              <div style={{ width:9,height:9,borderRadius:2,background:fa?.color }}/>
                              <span style={{ fontWeight:600,fontSize:12,color:'var(--text-body)' }}>{nameA}</span>
                            </div>
                            <div style={{ fontSize:10,color:'var(--text-muted)' }}>vs</div>
                            <div style={{ display:'flex',alignItems:'center',gap:7,flex:1,justifyContent:'flex-end' }}>
                              <span style={{ fontWeight:600,fontSize:12,color:'var(--text-body)' }}>{nameB}</span>
                              <div style={{ width:9,height:9,borderRadius:2,background:fb?.color }}/>
                            </div>
                            <div style={{ marginLeft:14,background:`${clr}18`,border:`1px solid ${clr}44`,borderRadius:7,padding:'5px 12px',textAlign:'center',minWidth:80 }}>
                              <div style={{ fontFamily:'var(--font-mono)',fontWeight:700,fontSize:16,color:clr }}>{pct.toFixed(1)}%</div>
                              <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:clr }}>{lbl}</div>
                            </div>
                          </div>
                          <div style={{ padding:'14px 18px' }}>
                            {shared.length>0 && (
                              <div style={{ marginBottom:16 }}>
                                <div style={{ fontSize:10,fontWeight:700,color:'#E67E22',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:8 }}>Shared Holdings ({shared.length})</div>
                                <div style={{ display:'grid',gridTemplateColumns:'1fr 80px 80px',gap:'0 20px',marginBottom:4 }}>
                                  <div style={{ fontSize:10,color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em' }}>Stock</div>
                                  <div style={{ fontSize:10,color:fa?.color,fontWeight:700,textTransform:'uppercase',textAlign:'right' }}>{nameA.split(' ')[0]}</div>
                                  <div style={{ fontSize:10,color:fb?.color,fontWeight:700,textTransform:'uppercase',textAlign:'right' }}>{nameB.split(' ')[0]}</div>
                                </div>
                                {shared.map(h => (
                                  <div key={h.holding_isin} style={{ display:'grid',gridTemplateColumns:'1fr 80px 80px',gap:'0 20px',padding:'5px 8px',alignItems:'center',background:'var(--bg-secondary)',borderRadius:5,marginBottom:3 }}>
                                    <div style={{ fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:7 }}>
                                      {h.name}<span style={{ fontSize:9,fontWeight:700,color:'#E67E22' }}>● SHARED</span>
                                    </div>
                                    <div style={{ fontFamily:'var(--font-mono)',fontSize:12,textAlign:'right',color:fa?.color }}>{h.weight_a.toFixed(1)}%</div>
                                    <div style={{ fontFamily:'var(--font-mono)',fontSize:12,textAlign:'right',color:fb?.color }}>{h.weight_b.toFixed(1)}%</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:24 }}>
                              {[['Only in '+nameA, onlyA, fa],[`Only in ${nameB}`, onlyB, fb]].map(([title, list, fund]) => (
                                <div key={title}>
                                  <div style={{ fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:8 }}>{title}</div>
                                  <div style={{ display:'grid',gridTemplateColumns:'1fr auto',gap:'0 14px' }}>
                                    {Array.from({length:10}).map((_,idx) => {
                                      const h=list[idx];
                                      return (<React.Fragment key={idx}>
                                        <div style={{ fontSize:12,padding:'4px 0',color:h?'var(--text-body)':'transparent' }}>{h?h.name:'·'}</div>
                                        <div style={{ fontFamily:'var(--font-mono)',fontSize:12,textAlign:'right',padding:'4px 0',color:h?fund?.color:'transparent' }}>{h?`${h.weight.toFixed(1)}%`:''}</div>
                                      </React.Fragment>);
                                    })}
                                  </div>
                                </div>
                              ))}
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
        })()}

        {/* ── ROLLING RETURNS ── */}
        {activeTab === 'stress' && (() => {
        if (funds.length === 0) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Add funds to the portfolio to see stress test results.</div>;
        if (stressLoading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Computing historical stress scenarios...</div>;
        if (stressError) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--neg)', fontSize: 13 }}>{stressError}</div>;
        if (!stressData) return null;

        const { scenarios } = stressData || {};
        if (!scenarios || scenarios.length === 0) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No scenario data available.</div>;
        const HIDDEN_SCENARIOS = ['gfc', 'euro'];
        const scenarios_filtered = scenarios.filter(s => !HIDDEN_SCENARIOS.includes(s.id));
        const withData = scenarios_filtered.filter(s => s.has_data && s.portfolio_return != null);
        const worstReturn = withData.length > 0 ? Math.min(...withData.map(s => s.portfolio_return)) : 0;

        const retColor = v => v == null ? 'var(--text-muted)' : v >= 0 ? 'var(--pos)' : 'var(--neg)';
        const fmt2 = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

        return (
          <div>
            {/* Key insight banner */}
            {withData.length > 0 && (() => {
              const worst = withData.reduce((a, b) => (b.portfolio_return ?? 0) < (a.portfolio_return ?? 0) ? b : a, withData[0]);
              return (
                <div style={{ borderLeft: '4px solid #B46B10', background: '#FEF3C7', padding: '11px 14px', borderRadius: '0 8px 8px 0', fontSize: 12, lineHeight: 1.7, marginBottom: 14, color: 'var(--text-primary)' }}>
                  Worst historical scenario for this portfolio: <strong style={{ color: 'var(--neg)' }}>{worst.name}</strong> ({worst.label}) with an estimated drawdown of <strong style={{ color: 'var(--neg)' }}>{fmt2(worst.portfolio_return)}</strong>. Returns are calculated from actual NAV history in the database.
                </div>
              );
            })()}

            {/* Impact bars */}
            <div className="ptf-card" style={{ marginBottom: 14 }}>
              <div className="ptf-card-hd">Portfolio drawdown by scenario — actual NAV returns</div>
              <div style={{ padding: 14 }}>
                {scenarios_filtered.map(sc => {
                  const v = sc.portfolio_return;
                  const pct = worstReturn < 0 && v != null ? Math.abs(v / worstReturn * 100) : 0;
                  return (
                    <div key={sc.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <div>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{sc.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 10 }}>{sc.label}</span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: retColor(v) }}>{fmt2(v)}</span>
                      </div>
                      <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                        {v != null && <div style={{ width: pct.toFixed(0) + '%', height: '100%', background: v >= 0 ? 'var(--pos)' : 'linear-gradient(90deg, #912F63, #C46985)', borderRadius: 4 }} />}
                      </div>
                      {!sc.has_data && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>NAV history not available for this period</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scenario detail table */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Scenario detail — fund-level returns</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Scenario</th>
                      <th style={{ padding: '8px 14px', textAlign: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Period</th>
                      <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Portfolio</th>
                      <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Nifty 500</th>
                      {bmStress && !bmStress.error && <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#1A5C3A', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Blended BM</th>}
                      <th style={{ padding: '8px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Cushion vs {bmStress && !bmStress.error ? 'Blended BM' : 'Nifty 500'}</th>
                      <th style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', borderLeft: '2px solid var(--border)' }}></th>
                      {funds.map(f => (
                        <th key={f.isin} style={{ padding: '8px 14px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {f.name?.split(' ').slice(0, 3).join(' ')}
                          <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-muted)' }}>{weights[f.isin]}%</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios_filtered.map((sc, i) => (
                      <tr key={sc.id} style={{ borderBottom: '1px solid var(--bg-secondary)', background: i % 2 === 0 ? 'var(--bg-secondary)' : '#fff' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--text-primary)' }}>{sc.name}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sc.label}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: retColor(sc.portfolio_return) }}>{fmt2(sc.portfolio_return)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: retColor(sc.nifty500_return) }}>{fmt2(sc.nifty500_return)}</td>
                        {bmStress && !bmStress.error && (() => {
                          const bmRet = bmStress.returns?.[sc.id];
                          return <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: retColor(bmRet) }}>{fmt2(bmRet)}</td>;
                        })()}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: (() => { const ref = bmStress && !bmStress.error ? bmStress.returns?.[sc.id] : sc.nifty500_return; const cushion = sc.portfolio_return != null && ref != null ? sc.portfolio_return - ref : null; return cushion == null ? 'var(--text-muted)' : cushion >= 0 ? 'var(--pos)' : 'var(--neg)'; })() }}>
                          {(() => { const ref = bmStress && !bmStress.error ? bmStress.returns?.[sc.id] : sc.nifty500_return; const cushion = sc.portfolio_return != null && ref != null ? sc.portfolio_return - ref : null; return cushion == null ? '—' : (cushion >= 0 ? '+' : '') + cushion.toFixed(1) + '%'; })()}
                        </td>
                        <td style={{ padding: '10px 14px', borderLeft: '2px solid var(--border)' }} />
                        {funds.map(f => (
                          <td key={f.isin} style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: retColor(sc.fund_returns?.[f.isin]) }}>
                            {fmt2(sc.fund_returns?.[f.isin])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                Returns calculated from actual NAV history. "—" means the fund was not active or NAV data is unavailable for that period.
                {benchmarks && benchmarks.length > 0 && !bmStress && <span style={{ color: '#B46B10', marginLeft: 8 }}>⏳ Loading benchmark column…</span>}
                {bmStress?.error && <span style={{ color: 'var(--neg)', marginLeft: 8 }}>Benchmark stress unavailable ({bmStress.error})</span>}
              </div>
            </div>
          </div>
        );
      })()}

      {activeTab === 'drift' && (() => {
        if (funds.length === 0) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Add funds to see style and drift analysis.</div>;

        const STYLES = {
          'Large Value':  { row: 0, col: 0 }, 'Large Blend':  { row: 0, col: 1 }, 'Large Growth':  { row: 0, col: 2 },
          'Mid Value':    { row: 1, col: 0 }, 'Mid Blend':    { row: 1, col: 1 }, 'Mid Growth':    { row: 1, col: 2 },
          'Small Value':  { row: 2, col: 0 }, 'Small Blend':  { row: 2, col: 1 }, 'Small Growth':  { row: 2, col: 2 },
        };
        const ROW_LBLS = ['Large', 'Mid', 'Small'];
        const COL_LBLS = ['Value', 'Blend', 'Growth'];
        const CELL = 72;

        // Accumulate style weights
        const styleWts = {};
        Object.keys(STYLES).forEach(s => { styleWts[s] = 0; });
        let styleTotal = 0;
        funds.forEach(f => {
          const snap = snapshots[f.isin] || {};
          const wt = weights[f.isin] || 0;
          const style = snap.equity_style;
          if (style && STYLES[style] != null) {
            styleWts[style] = (styleWts[style] || 0) + wt;
            styleTotal += wt;
          }
        });

        const domStyle = styleTotal > 0 ? Object.keys(styleWts).reduce((a, b) => styleWts[b] > styleWts[a] ? b : a) : null;
        const domPct = domStyle && styleTotal > 0 ? (styleWts[domStyle] / styleTotal * 100) : 0;

        // Blended cap tier
        const blendedLc = (() => { let v=0,w=0; funds.forEach(f=>{ const s=snapshots[f.isin]; const lc=parseFloat(s?.large_cap); if(isNaN(lc)) return; v+=lc*(weights[f.isin]||0); w+=(weights[f.isin]||0); }); return w>0?v/w:0; })();
        const blendedMc = (() => { let v=0,w=0; funds.forEach(f=>{ const s=snapshots[f.isin]; const mc=parseFloat(s?.mid_cap);   if(isNaN(mc)) return; v+=mc*(weights[f.isin]||0); w+=(weights[f.isin]||0); }); return w>0?v/w:0; })();
        const blendedSc = (() => { let v=0,w=0; funds.forEach(f=>{ const s=snapshots[f.isin]; const sc=parseFloat(s?.small_cap); if(isNaN(sc)) return; v+=sc*(weights[f.isin]||0); w+=(weights[f.isin]||0); }); return w>0?v/w:0; })();
        const lcDrift = blendedLc - 60, mcDrift = blendedMc - 25, scDrift = blendedSc - 15;

        // Factor exposure blended
        const FACTORS = ['momentum', 'quality', 'volatility', 'size', 'style', 'yield', 'liquidity'];
        const factorBlend = {};
        FACTORS.forEach(fac => {
          let wsum = 0, wused = 0;
          funds.forEach(f => {
            const v = snapshots[f.isin]?.[`factor_${fac}`];
            const wt = weights[f.isin] || 0;
            if (v != null && v !== '-' && !isNaN(parseFloat(v))) {
              wsum += parseFloat(v) * wt;
              wused += wt;
            }
          });
          factorBlend[fac] = wused > 0 ? wsum / wused : null;
        });

        const svgW = 3 * CELL + 80, svgH = 3 * CELL + 80;

        function DriftBar({ label, current, neutral, drift }) {
          const pct = Math.min(current, 100);
          const warn = Math.abs(drift) > 10;
          return (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: warn ? '#B46B10' : 'var(--text-primary)' }}>
                  {current.toFixed(1)}% vs {neutral}% neutral ({drift >= 0 ? '+' : ''}{drift.toFixed(1)}%)
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: pct.toFixed(0) + '%', height: '100%', background: warn ? '#B46B10' : 'var(--brand-primary)', borderRadius: 4 }} />
              </div>
            </div>
          );
        }

        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              {/* Style box — centred */}
              <div className="ptf-card" style={{ minWidth: 280, maxWidth: 360 }}>
                <div className="ptf-card-hd">Morningstar style box</div>
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block' }}>
                    {ROW_LBLS.map((l, i) => (
                      <text key={l} x={38} y={45 + i * CELL + CELL / 2 + 4} textAnchor="end" fontSize={10} fill="#A2A0A0" fontFamily="var(--font-body)">{l}</text>
                    ))}
                    {COL_LBLS.map((l, i) => (
                      <text key={l} x={46 + i * CELL + CELL / 2} y={30} textAnchor="middle" fontSize={10} fill="#A2A0A0" fontFamily="var(--font-body)">{l}</text>
                    ))}
                    {Object.entries(STYLES).map(([style, pos]) => {
                      const pct = styleTotal > 0 ? (styleWts[style] || 0) / styleTotal * 100 : 0;
                      const alpha = Math.min(0.95, pct / 40);
                      const cx = 42 + pos.col * CELL + CELL / 2;
                      const cy = 40 + pos.row * CELL + CELL / 2;
                      return (
                        <g key={style}>
                          <rect x={42 + pos.col * CELL} y={40 + pos.row * CELL} width={CELL} height={CELL}
                            fill="#912F63" fillOpacity={alpha} stroke="#E8E5EC" strokeWidth={1} rx={4} />
                          {pct > 1 && <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" fontFamily="var(--font-mono)">{pct.toFixed(0)}%</text>}
                        </g>
                      );
                    })}
                  </svg>
                  {domStyle && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6, textAlign: 'center' }}>
                      Dominant style: <strong style={{ color: 'var(--brand-primary)' }}>{domStyle}</strong> ({domPct.toFixed(0)}% of portfolio)
                    </div>
                  )}
                  {!domStyle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>No equity style data available for these funds.</div>}
                </div>
              </div>
            </div>

            {/* Fund-level style */}
            <div className="ptf-card" style={{ marginBottom: 14 }}>
              <div className="ptf-card-hd">Fund-level style positioning</div>
              <div style={{ padding: '4px 16px' }}>
                {funds.map((f, i) => {
                  const snap = snapshots[f.isin] || {};
                  const wt = weights[f.isin] || 0;
                  const COLORS = ['#912F63', '#3E3452', '#0F6E56', '#B46B10', '#1558A8'];
                  return (
                    <div key={f.isin} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < funds.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ width: 3, height: 32, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{snap.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</div>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{snap.equity_style || '—'}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--brand-primary)', minWidth: 36, textAlign: 'right' }}>{wt}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Factor exposure */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Factor exposure — blended portfolio</div>
              <div style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
                  {FACTORS.map(fac => {
                    const v = factorBlend[fac];
                    const pct = v != null ? Math.min(100, Math.max(0, v)) : null;
                    return (
                      <div key={fac} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{fac}</div>
                        <div style={{ height: 80, background: 'var(--bg-secondary)', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                          {pct != null && <div style={{ height: pct + '%', background: 'var(--brand-primary)', borderRadius: '4px 4px 0 0', opacity: 0.85 }} />}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--brand-dark)', marginTop: 4 }}>
                          {v != null ? v.toFixed(1) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>Factor scores are weighted averages across all funds in the portfolio. Scale 0–100.</div>
              </div>
            </div>
          </div>
        );
      })()}


        {activeTab === 'funds' && (
          <div>
            <div className="ptf-card" style={{ marginBottom: 14 }}>
              <div className="ptf-card-hd">Fund details & analytics</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr>
                    <th style={{ textAlign: 'left' }}>Fund</th>
                    <th>Weight</th>
                    <th>1Y</th>
                    <th>3Y CAGR</th>
                    <th>5Y CAGR</th>
                    <th>Sharpe</th>
                    <th>Alpha</th>
                    <th>Beta</th>
                    <th>Dn cap</th>
                    <th>ER</th>
                    <th>Rating</th>
                  </tr></thead>
                  <tbody>
                    {funds.map(f => {
                      const fsnap = snapshots[f.isin];
                      return (<tr key={f.isin}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 3, height: 34, borderRadius: 2, background: f.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                              <span style={{ fontSize: 9, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>{f.category}</span>
                              {fsnap?.fund_size != null && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>₹{fsnap?.fund_size >= 100000 ? (fsnap?.fund_size / 100000).toFixed(0) + 'L Cr' : (fsnap?.fund_size / 1000).toFixed(0) + 'K Cr'}</span>}
                            </div>
                          </div>
                        </div></td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{weights[f.isin] || 0}%</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['1y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['1y'])}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['3y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['3y'])}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.returns?.['5y'] || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.returns?.['5y'])}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.risk?.sharpe_ratio_3y || 0) >= 0.5 ? 'var(--pos)' : 'var(--text-muted)' }}>{f2(fsnap?.risk?.sharpe_ratio_3y)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.risk?.alpha_3y || 0) >= 0 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fp(fsnap?.risk?.alpha_3y)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{f2(fsnap?.risk?.beta_3y)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.risk?.down_capture_3y || 0) < 100 ? 'var(--pos)' : 'var(--brand-primary)' }}>{fsnap?.risk?.down_capture_3y != null ? f2(fsnap?.risk?.down_capture_3y) + '%' : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: (fsnap?.expense_ratio || 0) <= 1 ? 'var(--pos)' : (fsnap?.expense_ratio || 0) >= 2 ? 'var(--brand-primary)' : 'var(--text-muted)' }}>{fsnap?.expense_ratio != null ? fsnap?.expense_ratio + '%' : '—'}</td>
                        <td style={{ color: '#B46B10', letterSpacing: -1 }}>{fsnap?.morningstar_rating && fsnap.morningstar_rating !== '-' ? '★'.repeat(parseInt(fsnap.morningstar_rating)) + '☆'.repeat(5 - parseInt(fsnap.morningstar_rating)) : '—'}</td>
                      </tr>);
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Blended portfolio</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{total >= 99.8 ? Math.round(total) : total.toFixed(2)}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.sharpe_ratio_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.alpha_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.beta_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.down_capture_3y)}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f2(B.expense_ratio)}%</td>
                      <td>—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}