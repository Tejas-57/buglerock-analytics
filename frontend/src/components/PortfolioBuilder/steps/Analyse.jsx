import React, { useState, useEffect } from 'react';
import { fp, f2 } from './BuildPortfolio';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'returns', label: 'Returns & projections' },
  { id: 'risk', label: 'Risk metrics' },
  { id: 'exposure', label: 'Exposure' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'overlap', label: 'Overlap' },
  { id: 'rolling', label: 'Rolling returns' },
  { id: 'funds', label: 'Fund details' },
];

function blendFromSnaps(funds, weights, snapshots) {
  // Same approach as Watchlist — use snapshot data
  function get(isin, getter) {
    const snap = snapshots[isin];
    if (!snap) return null;
    const v = getter(snap);
    if (v==null||v==='-'||v===''||isNaN(parseFloat(v))) return null;
    return parseFloat(v);
  }
  function wblend(getter) {
    let val=0, cov=0;
    funds.forEach(f => {
      const v = get(f.isin, getter);
      if (v==null||isNaN(v)) return;
      val += v*(weights[f.isin]||0); cov += (weights[f.isin]||0);
    });
    return cov>0 ? val/cov : null;
  }
  return {
    return_1y:       wblend(s=>s.returns?.['1y']),
    return_3y:       wblend(s=>s.returns?.['3y']),
    return_5y:       wblend(s=>s.returns?.['5y']),
    return_1m:       wblend(s=>s.returns?.['1m']),
    return_3m:       wblend(s=>s.returns?.['3m']),
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


const CY_KEYS = ['cy2021','cy2022','cy2023','cy2024','cy2025'];
const CY_LBL  = ['2021','2022','2023','2024','2025'];

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

export default function Analyse({ funds, weights, snapshots={}, benchmarks=[], ips, onEdit, onOptimise }) {
  const [activeTab, setActiveTab] = useState('overview');

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
    const ac = (snap?.asset_class || '').toLowerCase();
    const cat = (snap?.category || f.category || '').toLowerCase();
    const isEquity = ac === 'equity';
    const isIndex = cat.includes('index') || cat.includes('etf') || (snap?.expense_ratio && snap.expense_ratio < 0.5);
    return isEquity && !isIndex;
  }

  const equityFundsForOverlap = funds.filter(isActiveEquityFund).map(f => ({
    ...f,
    color: f.color,
    data: snapshots[f.isin] || {},
  }));

  async function fetchOverlap() {
    if (equityFundsForOverlap.length < 2) return;
    const API = import.meta.env.VITE_API_URL || '';
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
    if (activeTab === 'overlap' && equityFundsForOverlap.length >= 2) fetchOverlap();
    else if (activeTab === 'overlap' && equityFundsForOverlap.length < 2) { setOverlapData(null); setOverlapError(null); }
  }, [activeTab, funds.map(f => f.isin).join(',')]);

  // ── Rolling returns state & fetch (daily-NAV based) ─────────────────────
  const [rollingData, setRollingData] = useState(null);
  const [rollingLoading, setRollingLoading] = useState(false);
  const [rollingError, setRollingError] = useState(null);

  useEffect(() => {
    if (activeTab !== 'rolling' || funds.length === 0) return;
    const API = import.meta.env.VITE_API_URL || '';
    const isins = funds.map(f => f.isin).join(',');
    setRollingLoading(true);
    setRollingError(null);
    fetch(`${API}/api/nav/rolling-metrics?isins=${isins}`)
      .then(r => { if (!r.ok) throw new Error('Failed to compute rolling metrics'); return r.json(); })
      .then(d => { setRollingData(d.funds || {}); setRollingLoading(false); })
      .catch(e => { setRollingError(e.message); setRollingLoading(false); });
  }, [activeTab, funds.map(f => f.isin).join(',')]);

  // Compute blended benchmark from benchmarks array (manual weights)
  const totalBmW = benchmarks.reduce((s, b) => s + (b.weight || 0), 0) || 1;
  function blendBm(getter) {
    let val = 0, cov = 0;
    benchmarks.forEach(b => {
      const v = getter(b);
      if (v == null || isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (b.weight || 0);
      cov += (b.weight || 0);
    });
    return cov > 0 ? val / cov : null;
  }

  const bm = benchmarks.length > 0 ? {
    name: benchmarks.length === 1
      ? benchmarks[0].display_name
      : benchmarks.map(b => `${b.display_name} (${b.weight}%)`).join(' + '),
    rets: {
      r1y:  blendBm(b => b.return_1y),
      r3y:  blendBm(b => b.return_3y),
      r5y:  blendBm(b => b.return_5y),
      cy25: blendBm(b => b.return_cy2025),
      cy24: blendBm(b => b.return_cy2024),
      cy23: blendBm(b => b.return_cy2023),
      cy22: blendBm(b => b.return_cy2022),
      cy21: blendBm(b => b.return_cy2021),
      r1m:  blendBm(b => b.return_1m),
      r3m:  blendBm(b => b.return_3m),
      ytd:  blendBm(b => b.return_ytd),
    }
  } : {
    name: 'No benchmark selected',
    rets: { r1y: null, r3y: null, r5y: null, cy25: null, cy24: null, cy23: null, cy22: null, cy21: null, r1m: null, r3m: null, ytd: null }
  };
  const B = blendFromSnaps(funds, weights, snapshots);
  const total = funds.reduce((s, f) => s + (weights[f.isin] || 0), 0);

  const investAmt = ips?.amount ? parseFloat(ips.amount.replace(/[^0-9.]/g, '')) : 1000000;
  const sipAmt = ips?.monthlySIP ? parseFloat(ips.monthlySIP.replace(/[^0-9.]/g, '')) : 10000;

  function sipFV(m, r, y) { const mo = r / 100 / 12; if (mo === 0) return m * 12 * y; return m * ((Math.pow(1 + mo, 12 * y) - 1) / mo) * (1 + mo); }

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

  React.useEffect(() => {
    if (activeTab !== 'correlation' || funds.length < 2) return;
    const API = import.meta.env.VITE_API_URL || '';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Tab bar */}
      <div className="ptf-tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`ptf-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
        <div className="ptf-tab-actions">
          {activeTab === 'overlap' && overlapData && (
            <button className="btn btn-ghost" onClick={generateOverlapPDF} style={{ fontSize: 11 }}>⬇ Export Overlap Report</button>
          )}
          <button className="btn btn-ghost" onClick={onEdit} style={{ fontSize: 11 }}>← Edit</button>
          <button className="btn btn-primary" onClick={onOptimise} style={{ fontSize: 11 }}>Optimise →</button>
        </div>
      </div>

      <div className="ptf-analytics">

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
                <div className="ptf-card-hd">Market cap & asset mix</div>
                <div style={{ padding: '12px 14px' }}>
                  {[
                    [B.large_cap, 'Large cap', 'var(--brand-primary)'],
                    [B.mid_cap, 'Mid cap', 'var(--muted-pur,#6D5479)'],
                    [B.small_cap, 'Small cap', '#C46985'],
                    [B.bond_pct, 'Bonds/Debt', 'var(--lav-grey,#A795AE)'],
                    [B.cash_pct, 'Cash/Liquid', 'var(--text-muted)'],
                  ].filter(r => (r[0] || 0) > 0.1).map(([v, lbl, clr], i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', width: 68, textAlign: 'right', flexShrink: 0 }}>{lbl}</div>
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
              <div className="ptf-card-hd">Calendar year performance vs {bm.name}</div>
              <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                <svg width="100%" height="110" viewBox="0 0 500 110" preserveAspectRatio="xMidYMid meet">
                  {(() => {
                    const cyV = CY_KEYS.map(k => B['return_'+k]); // e.g. return_cy2021
                    const bmV = ['cy21','cy22','cy23','cy24','cy25'].map(k => bm.rets[k]);
                    const mx = Math.max(...cyV.concat(bmV).filter(v => v != null).map(Math.abs).concat([5]));
                    const PH = 92, ZH = 18;
                    return CY_KEYS.map((k, i) => {
                      const fv = cyV[i], bv = bmV[i];
                      const x = i * 96, bw = 36, gp = 4;
                      const fh = fv != null ? Math.max(2, Math.abs(fv) / mx * PH) : 0;
                      const bh = bv != null ? Math.max(2, Math.abs(bv) / mx * PH) : 0;
                      const diff = fv != null && bv != null ? fv - bv : null;
                      return (
                        <g key={k}>
                          {diff != null && <text x={x + bw} y={PH - Math.max(fh, bh) - 5} textAnchor="middle" fontSize="8" fontWeight="700" fill={diff >= 0 ? 'var(--pos)' : 'var(--brand-primary)'} fontFamily="sans-serif">{diff >= 0 ? '+' : ''}{diff.toFixed(1)}%</text>}
                          {fv != null && <rect x={x} y={PH - fh} width={bw} height={fh} fill={fv >= 0 ? 'var(--brand-primary)' : '#C46985'} rx="2" />}
                          {bv != null && <rect x={x + bw + gp} y={PH - bh} width={bw - 4} height={bh} fill="var(--lav-grey,#A795AE)" rx="2" opacity=".8" />}
                          <text x={x + bw} y={107} textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="sans-serif">{CY_LBL[i]}</text>
                        </g>
                      );
                    });
                  })()}
                  <line x1="0" y1="92" x2="500" y2="92" stroke="var(--border)" strokeWidth="1" />
                </svg>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 9, color: 'var(--text-muted)' }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--brand-primary)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Portfolio</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--lav-grey,#A795AE)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle', opacity: .8 }}></span>{bm.name}</span>
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

            {/* Projection cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div className="ptf-card">
                <div className="ptf-card-hd">Lump sum projection — {fmtL(investAmt)}</div>
                <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                  <table className="ptf-analytics-tbl">
                    <thead><tr><th style={{ textAlign: 'left' }}>Horizon</th><th>Portfolio</th><th>{bm.name.split(' ').slice(0, 2).join(' ')}</th><th>Gain</th></tr></thead>
                    <tbody>
                      {[3, 5, 10].map(y => {
                        const ptfV = investAmt * Math.pow(1 + (B.return_3y || 0) / 100, y);
                        const bmV = investAmt * Math.pow(1 + ((bm.rets.r3y || 13)) / 100, y);
                        return (
                          <tr key={y}>
                            <td>{y} yrs</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{fmtL(ptfV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtL(bmV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: ptfV >= bmV ? 'var(--pos)' : 'var(--brand-primary)' }}>
                              {ptfV >= bmV ? '+' : '-'}{fmtL(Math.abs(ptfV - bmV))}
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
                        const ptfV = sipFV(sipAmt, B.return_3y || 0, y);
                        const bmV = sipFV(sipAmt, bm.rets.r3y || 13, y);
                        const invested = sipAmt * 12 * y;
                        return (
                          <tr key={y}>
                            <td>{y} yrs</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtL(invested)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-primary)' }}>{fmtL(ptfV)}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', color: ptfV >= bmV ? 'var(--pos)' : 'var(--brand-primary)' }}>
                              {ptfV >= bmV ? '+' : ''}{(((ptfV - bmV) / bmV) * 100).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>Based on blended 3Y CAGR ({(B.return_3y || 0).toFixed(2)}% p.a.) vs {bm.name} ({(bm.rets.r3y || 0).toFixed(2)}% p.a.). Illustrative only — not a guarantee of future returns.</div>
                </div>
              </div>
            </div>

            {/* Per-fund return table */}
            <div className="ptf-card">
              <div className="ptf-card-hd">Return contribution per fund</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ptf-analytics-tbl">
                  <thead><tr><th style={{ textAlign: 'left' }}>Fund</th><th>Weight</th><th>1M</th><th>3M</th><th>1Y</th><th>3Y CAGR</th><th>5Y CAGR</th><th>YTD</th><th>1Y contrib</th></tr></thead>
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
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{total}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_1m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_3m)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fp(B.return_5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fp(B.return_ytd)}</td>
                      <td>—</td>
                    </tr>
                    <tr style={{ background: 'var(--brand-dark)' }}>
                      <td style={{ fontWeight: 600, color: '#fff' }}>{bm.name || 'Benchmark'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>BM</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>—</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>—</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{fp(bm.rets.r1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{fp(bm.rets.r3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>{fp(bm.rets.r5y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>—</td>
                      <td style={{ color: '#fff' }}>—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
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
                    {RISK_METRICS.map(m => {
                      const v = B[m.k];
                      if (v == null) return null;
                      const s = m.sig(v);
                      const pct = Math.min(100, Math.max(0, m.lb ? (1 - v / 20) * 100 : (v / (m.good * 2)) * 100));
                      return (
                        <tr key={m.k} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                          <td style={{ fontWeight: 700, color: 'var(--brand-dark)' }}>Blended</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: SIG_COL[s[1]], textAlign: 'right' }}>{m.fmt(v)}</td>
                          <td colSpan={RISK_METRICS.length - 1}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: pct.toFixed(0) + '%', height: '100%', background: SIG_COL[s[1]], borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: SIG_BG[s[1]], color: SIG_COL[s[1]] }}>{s[0]}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })[0]}
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Risk alerts */}
            {B.down_capture_3y > 100 && <div className="ptf-insight-neg" style={{ marginTop: 10 }}>⚠ Down capture of {f2(B.down_capture_3y)}% — portfolio amplifies benchmark drawdowns.</div>}
            {B.alpha_3y < 0 && <div className="ptf-insight-warn" style={{ marginTop: 6 }}>⚠ Blended alpha negative ({fp(B.alpha_3y)}) — active fund fees not justified by outperformance.</div>}
            {B.sharpe_ratio_3y < 0.4 && <div className="ptf-insight-neg" style={{ marginTop: 6 }}>⚠ Sharpe of {f2(B.sharpe_ratio_3y)} is weak. Returns do not adequately compensate for risk taken.</div>}
            {B.sharpe_ratio_3y >= 0.6 && B.alpha_3y >= 0 && B.down_capture_3y <= 100 && <div className="ptf-insight-pos" style={{ marginTop: 6 }}>✓ Risk profile looks healthy — Sharpe {f2(B.sharpe_ratio_3y)}, positive alpha, down capture {f2(B.down_capture_3y)}%.</div>}
          </div>
        )}

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
                  <div className="ptf-card-hd">Asset allocation vs IPS targets</div>
                  <AllocRow label="Equity" value={B.equity_pct} color="#912F63" target={[+(ips?.alloc?.eqMin||0), +(ips?.alloc?.eqMax||100)]} />
                  <AllocRow label="Bonds / Debt" value={B.bond_pct||0} color="#3E3452" target={[+(ips?.alloc?.debtMin||0), +(ips?.alloc?.debtMax||100)]} />
                  <AllocRow label="Cash / Liquid" value={B.cash_pct||0} color="#A795AE" />
                </div>
                <div className="ptf-card" style={{ padding: '14px 16px' }}>
                  <div className="ptf-card-hd">Market cap split vs IPS targets</div>
                  <AllocRow label="Large cap" value={B.large_cap} color="#185FA5" target={[+(ips?.alloc?.lcMin||0), +(ips?.alloc?.lcMax||100)]} />
                  <AllocRow label="Mid cap" value={B.mid_cap} color="#1D9E75" target={[+(ips?.alloc?.mcMin||0), +(ips?.alloc?.mcMax||100)]} />
                  <AllocRow label="Small cap" value={B.small_cap} color="#D85A30" target={[+(ips?.alloc?.scMin||0), +(ips?.alloc?.scMax||100)]} />
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
                    <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, fontSize: 9, color: 'var(--text-muted)' }}></th>
                          {funds.map((f, i) => <th key={f.isin} style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600, fontSize: 9, color: f.color, whiteSpace: 'nowrap' }}>F{i + 1}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {funds.map((fi, i) => (
                          <tr key={fi.isin}>
                            <td style={{ padding: '4px 8px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <span style={{ color: fi.color }}>F{i + 1}</span> {fi.name}
                            </td>
                            {funds.map((fj, j) => {
                              const v = corrMatrix[i][j];
                              const { bg, color } = corrColor(v);
                              return (
                                <td key={fj.isin} style={{ padding: '4px 6px', textAlign: 'center', background: bg, color, fontFamily: 'var(--font-mono)', fontWeight: 600, borderRadius: 3, border: '2px solid #fff', minWidth: 52 }}>
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
                  ⚠ Overlap is only for active equity funds. <strong>{nonEquity.map(f => shortFundName(f.name)).join(', ')}</strong> excluded.
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
        {activeTab === 'rolling' && (() => {
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
          const port1y = weightedAvg(r => r.r1y);
          const port3y = weightedAvg(r => r.r3y);

          const colorFor = (v) => v == null ? 'var(--text-muted)' : v >= 12 ? 'var(--pos)' : v >= 6 ? '#D97706' : 'var(--neg)';

          return (
            <div>
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Computed from each fund's daily NAV history. <strong>1Y rolling return</strong> is the average of all overlapping 1-year (252 trading-day) return windows over the trailing 3 years (756 trading days). <strong>3Y rolling CAGR</strong> is the average of all overlapping 3-year (756 trading-day) CAGR windows over the trailing 5 years (1,260 trading days). Funds with less history than the lookback required show "—".
              </div>
              <div className="ptf-card">
                <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>Rolling return consistency by fund</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>Fund</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>Weight</th>
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
                          {port1y != null ? (port1y >= 0 ? '+' : '') + port1y.toFixed(1) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--brand-dark)' }}>
                          {port3y != null ? (port3y >= 0 ? '+' : '') + port3y.toFixed(1) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 12px' }} />
                      </tr>
                    </tbody>
                  </table>
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
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{total}%</td>
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