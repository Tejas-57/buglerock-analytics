import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { addToWatchlist, isInWatchlist } from '../Watchlist/Watchlist';
import './PeerGroupAnalytics.css';

const API = process.env.REACT_APP_API_URL || '';

const CY_YEARS = [2021, 2022, 2023, 2024, 2025];

const Q_COLORS = {
  1: { bg: 'rgba(26,122,82,.1)',  text: '#1A7A52' },
  2: { bg: 'rgba(26,122,82,.06)', text: '#3A7A30' },
  3: { bg: 'rgba(122,90,16,.08)', text: '#7A5A10' },
  4: { bg: 'rgba(145,47,99,.1)',  text: '#912F63' },
};

const POS  = '#1A7A52';
const NEG  = '#B71C1C';
const WARN = '#7A5A10';

function fmt(v, dec = 2)  { if (v == null) return '—'; return parseFloat(v).toFixed(dec); }
function fmtPct(v)        { if (v == null) return '—'; const n = parseFloat(v); return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`; }
function fmtSgn(v, s='%') { if (v == null) return '—'; const n = parseFloat(v); return `${n >= 0 ? '+' : ''}${n.toFixed(1)}${s}`; }
function fmtAum(v) {
  if (!v) return '—';
  if (v >= 100000) return `₹${(v/100000).toFixed(1)}L Cr`;
  if (v >= 1000)   return `₹${(v/1000).toFixed(0)}k Cr`;
  return `₹${Math.round(v)} Cr`;
}

/* ─────────────────────────────────────────────────────────
   1. PERFORMANCE SNAPSHOT
───────────────────────────────────────────────────────── */
function SpotlightCard({ icon, label, fund, metricVal, metricLabel, metricColor, badge }) {
  if (!fund) return (
    <div className="pga-spotlight-card pga-spotlight-empty">
      <div className="pga-spotlight-label">{label}</div>
      <div className="pga-spotlight-metric-val" style={{ color: 'var(--text-muted)' }}>—</div>
    </div>
  );
  return (
    <div className="pga-spotlight-card">
      <div className="pga-spotlight-eyebrow">
        <span className="pga-spotlight-icon">{icon}</span>
        <span className="pga-spotlight-label">{label}</span>
        {badge && <span className="pga-spotlight-badge">{badge}</span>}
      </div>
      <div className="pga-spotlight-name" title={fund.name}>{fund.name}</div>
      <div className="pga-spotlight-amc">
        {fund.amc}
        {fund.morningstar_rating != null && (
          <span style={{ marginLeft: 5, color: WARN, letterSpacing: 1 }}>{'★'.repeat(fund.morningstar_rating)}</span>
        )}
      </div>
      <div>
        <div className="pga-spotlight-metric-val" style={{ color: metricColor || 'var(--brand-dark)' }}>{metricVal}</div>
        <div className="pga-spotlight-metric-lbl">{metricLabel}</div>
      </div>
    </div>
  );
}

function PerformanceSnapshot({ funds, cyMedians }) {
  if (!funds?.length) return null;

  const withSharpe = funds.filter(f => f.sharpe_ratio_3y != null);
  const withEr     = funds.filter(f => f.expense_ratio   != null);
  const withRating = funds.filter(f => f.morningstar_rating != null);
  const with3y     = funds.filter(f => f.return_3y        != null);

  const bestSharpe   = withSharpe.length  ? [...withSharpe].sort((a,b) => b.sharpe_ratio_3y - a.sharpe_ratio_3y)[0] : null;
  const lowestCost   = withEr.length      ? [...withEr].sort((a,b) => a.expense_ratio - b.expense_ratio)[0]         : null;
  const highestRated = withRating.length  ? [...withRating].sort((a,b) => b.morningstar_rating - a.morningstar_rating)[0] : null;
  const best3y       = with3y.length      ? [...with3y].sort((a,b) => b.return_3y - a.return_3y)[0]                 : null;

  const consistRows = funds.map(f => {
    let beats = 0, total = 0;
    CY_YEARS.forEach(yr => {
      const key = `return_cy${yr}`;
      const med = cyMedians?.[key]?.median;
      if (f[key] != null && med != null) { total++; if (f[key] >= med) beats++; }
    });
    return { fund: f, beats, total, rate: total > 0 ? beats / total : 0 };
  }).filter(r => r.total >= 3).sort((a, b) => b.rate - a.rate || (b.fund.return_3y||0) - (a.fund.return_3y||0));

  const mostConsistent = consistRows[0] || null;

  return (
    <div className="pga-section">
      <div className="pga-section-hd">
        <span className="pga-section-title">Performance snapshot</span>
        <span className="pga-section-meta">Best-in-category across 5 dimensions</span>
      </div>
      <div className="pga-spotlight-grid">
        <SpotlightCard icon="⚡" label="Best risk-adjusted"
          fund={bestSharpe}
          metricVal={bestSharpe ? fmt(bestSharpe.sharpe_ratio_3y) : '—'}
          metricLabel="Sharpe ratio (3Y)" metricColor={POS} />
        <SpotlightCard icon="💰" label="Lowest cost"
          fund={lowestCost}
          metricVal={lowestCost ? `${fmt(lowestCost.expense_ratio)}%` : '—'}
          metricLabel="Expense ratio" metricColor="var(--brand-dark)" />
        <SpotlightCard icon="🏆" label="Highest rated"
          fund={highestRated}
          metricVal={highestRated ? `${highestRated.morningstar_rating}★` : '—'}
          metricLabel="Morningstar" metricColor={WARN} />
        <SpotlightCard icon="📈" label="Best 3Y return"
          fund={best3y}
          metricVal={best3y ? fmtPct(best3y.return_3y) : '—'}
          metricLabel="3Y CAGR" metricColor={POS} />
        <SpotlightCard icon="🎯" label="Most consistent"
          fund={mostConsistent?.fund}
          metricVal={mostConsistent ? `${mostConsistent.beats}/${mostConsistent.total}` : '—'}
          metricLabel="yrs beat median"
          metricColor={mostConsistent?.rate >= 0.8 ? POS : 'var(--brand-mid)'}
          badge={mostConsistent?.rate >= 0.8 ? 'Strong' : mostConsistent?.rate >= 0.6 ? 'Good' : null} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   2. RISK / RETURN SCATTER — fixed axes for cross-category comparison
───────────────────────────────────────────────────────── */
function RiskReturnScatter({ funds }) {
  const pts = useMemo(() => funds.filter(f => f.std_dev_3y != null && f.return_3y != null), [funds]);
  if (!pts.length) return null;

  // Fixed axis ranges — consistent across all categories
  const X_MIN = 8,  X_MAX = 24;  // std_dev_3y (%)
  const Y_MIN = 0,  Y_MAX = 35;  // return_3y  (%)

  const W=580, H=280, PL=52, PB=36, PT=16, PR=16;
  const iw = W-PL-PR, ih = H-PB-PT;

  const sx = v => PL + ((v - X_MIN) / (X_MAX - X_MIN)) * iw;
  const sy = v => H - PB - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * ih;

  // Category medians for crosshair
  const sorted = (arr) => [...arr].sort((a, b) => a - b);
  const median = arr => { const s = sorted(arr); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
  const medX = median(pts.map(f => f.std_dev_3y));
  const medY = median(pts.map(f => f.return_3y));
  const msx = sx(medX), msy = sy(medY);

  const xTicks = [8, 10, 12, 14, 16, 18, 20, 22, 24];
  const yTicks = [0, 5, 10, 15, 20, 25, 30, 35];

  // Y-axis label x position — well clear of tick labels
  const Y_LABEL_X = 10;

  return (
    <div className="pga-section">
      <div className="pga-section-hd">
        <span className="pga-section-title">Risk / return — 3Y CAGR vs. std deviation</span>
        <span className="pga-section-meta">{pts.length} funds · lines = category median</span>
      </div>
      <div className="pga-db-explain">
        Each dot is one fund. <strong>Higher and further left is better</strong> — more return for less bumpiness along the way. Dots clustered together behave similarly; a dot far from the pack is a genuine outlier, good or bad.
      </div>
      <div className="pga-scatter-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', fontSize: '6px' }}>

          {/* Grid lines */}
          {xTicks.map(v => (
            <g key={`xg${v}`}>
              <line x1={sx(v).toFixed(1)} y1={PT} x2={sx(v).toFixed(1)} y2={H-PB}
                stroke="var(--border)" strokeWidth={0.7}/>
              <text x={sx(v).toFixed(1)} y={H-PB+10} fontSize={6} fill="var(--text-muted)"
                textAnchor="middle" fontFamily="DM Mono,monospace" letterSpacing="0.02em">{v}</text>
            </g>
          ))}
          {yTicks.map(v => (
            <g key={`yg${v}`}>
              <line x1={PL} y1={sy(v).toFixed(1)} x2={W-PR} y2={sy(v).toFixed(1)}
                stroke="var(--border)" strokeWidth={0.7}/>
              <text x={PL-5} y={parseFloat(sy(v).toFixed(1))+2.5} fontSize={6} fill="var(--text-muted)"
                textAnchor="end" fontFamily="DM Mono,monospace" letterSpacing="0.02em">{v}%</text>
            </g>
          ))}

          {/* Median crosshairs */}
          <line x1={msx.toFixed(1)} y1={PT} x2={msx.toFixed(1)} y2={H-PB}
            stroke="var(--brand-mid)" strokeWidth={1} strokeDasharray="4,3" opacity={0.6}/>
          <line x1={PL} y1={msy.toFixed(1)} x2={W-PR} y2={msy.toFixed(1)}
            stroke="var(--brand-mid)" strokeWidth={1} strokeDasharray="4,3" opacity={0.6}/>

          {/* Dots */}
          {pts.map(f => (
            <circle key={f.isin}
              cx={Math.max(PL, Math.min(W-PR, sx(f.std_dev_3y))).toFixed(1)}
              cy={Math.max(PT, Math.min(H-PB, sy(f.return_3y))).toFixed(1)}
              r={5} fill="var(--brand-primary)" fillOpacity={0.72}
              stroke="#fff" strokeWidth={1.2}>
              <title>{f.name}{'\n'}3Y CAGR: {fmtPct(f.return_3y)}   Std dev: {fmt(f.std_dev_3y, 1)}%</title>
            </circle>
          ))}

          {/* Axis labels */}
          <text x={(PL+W-PR)/2} y={H-1} fontSize={8} fill="var(--text-muted)" opacity={0.7}
            textAnchor="middle" fontFamily="DM Sans,sans-serif" letterSpacing="0.04em">Std deviation 3Y (%)</text>
          <text x={Y_LABEL_X} y={(PT+H-PB)/2} fontSize={8} fill="var(--text-muted)" opacity={0.7}
            textAnchor="middle" fontFamily="DM Sans,sans-serif" letterSpacing="0.04em"
            transform={`rotate(-90,${Y_LABEL_X},${(PT+H-PB)/2})`}>3Y CAGR (%)</text>

        </svg>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   3. CONSISTENCY
───────────────────────────────────────────────────────── */
function ConsistencyChart({ funds, cyMedians }) {
  const rows = useMemo(() => {
    return funds.map(f => {
      const years = CY_YEARS.map(yr => {
        const key = `return_cy${yr}`;
        const med = cyMedians?.[key]?.median;
        if (f[key] == null || med == null) return null;
        return { beat: f[key] >= med, val: f[key], med };
      });
      const withData = years.filter(y => y !== null);
      const beats = withData.filter(y => y.beat).length;
      return { fund: f, years, beats, total: withData.length, rate: withData.length > 0 ? beats / withData.length : 0 };
    })
    .filter(r => r.total >= 3)
    .sort((a, b) => b.rate - a.rate || (b.fund.return_3y||0) - (a.fund.return_3y||0))
    .slice(0, 10);
  }, [funds, cyMedians]);

  if (!rows.length) return null;
  const rateColor = r => r >= 0.8 ? POS : r >= 0.6 ? '#4A8A3C' : r >= 0.4 ? WARN : NEG;

  return (
    <div className="pga-section">
      <div className="pga-section-hd">
        <span className="pga-section-title">Consistency — years beating category median</span>
        <span className="pga-section-meta">CY 2021–2025 vs peer median · top 10 funds</span>
      </div>
      <div className="pga-db-explain">
        A fund that wins big one year and lags badly the next is harder to rely on than one that steadily beats the middle of the pack. This checks each fund against its own category's median return, year by year — a high score (e.g. 4/5) suggests dependable, repeatable performance rather than a single lucky year.
      </div>
      <div className="pga-consist-head">
        <div className="pga-consist-name-col"/>
        <div className="pga-consist-dots-col">
          {CY_YEARS.map(yr => <div key={yr} className="pga-consist-yr-lbl">{yr}</div>)}
        </div>
        <div className="pga-consist-rate-col" style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: 'var(--text-muted)' }}>Rate</div>
      </div>
      {rows.map(({ fund: f, years, beats, total, rate }) => (
        <div key={f.isin} className="pga-consist-row">
          <div className="pga-consist-name-col">
            <div className="pga-consist-fname" title={f.name}>{f.name}</div>
            <div className="pga-consist-sub">{f.amc}{f.return_3y != null ? ` · ${fmtPct(f.return_3y)} 3Y CAGR` : ''}</div>
          </div>
          <div className="pga-consist-dots-col">
            {years.map((y, i) => (
              <div key={i} className="pga-consist-dot-wrap">
                {y === null
                  ? <span className="pga-consist-dot pga-consist-dot-null" title={`${CY_YEARS[i]}: no data`}/>
                  : <span className={`pga-consist-dot ${y.beat ? 'pga-consist-dot-beat' : 'pga-consist-dot-miss'}`}
                      title={`${CY_YEARS[i]}: ${y.val.toFixed(1)}% vs median ${y.med.toFixed(1)}%`}/>
                }
              </div>
            ))}
          </div>
          <div className="pga-consist-rate-col">
            <span className="pga-consist-rate" style={{ color: rateColor(rate) }}>{beats}/{total}</span>
            <span className="pga-consist-rate-sub"> yrs</span>
          </div>
        </div>
      ))}
      <div className="pga-consist-legend">
        <span className="pga-leg-item"><span className="pga-consist-dot pga-consist-dot-beat"/> Beat median</span>
        <span className="pga-leg-item"><span className="pga-consist-dot pga-consist-dot-miss"/> Below median</span>
        <span className="pga-leg-item"><span className="pga-consist-dot pga-consist-dot-null"/> No data</span>
        <span>Only funds with ≥3 years of CY data shown.</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   4. DISTRIBUTION BARS
───────────────────────────────────────────────────────── */
const DB_METRICS = [
  { key: 'return_1y',       label: '1Y Return',     unit: '%' },
  { key: 'return_3y',       label: '3Y CAGR',       unit: '%' },
  { key: 'return_5y',       label: '5Y CAGR',       unit: '%' },
  { key: 'sharpe_ratio_3y', label: 'Sharpe (3Y)',   unit: ''  },
  { key: 'std_dev_3y',      label: 'Std dev (3Y)',  unit: '%' },
  { key: 'expense_ratio',   label: 'Expense ratio', unit: '%' },
];

function DistBar({ d, unit }) {
  if (!d) return <div className="pga-db-nodata">—</div>;
  const range = d.max - d.min || 1;
  const pos   = v => `${Math.max(0, Math.min(100, ((v - d.min) / range) * 100))}%`;
  return (
    <div className="pga-db-bar">
      <div className="pga-db-track">
        <div className="pga-db-iqr" style={{ left: pos(d.p25), width: `${((d.p75-d.p25)/range)*100}%` }}/>
        <div className="pga-db-median" style={{ left: pos(d.median) }}/>
        <div className="pga-db-tick" style={{ left: 0 }}/>
        <div className="pga-db-tick" style={{ right: 0, left: 'auto' }}/>
      </div>
      <div className="pga-db-labels">
        <span className="pga-db-edge">{d.min.toFixed(1)}{unit}</span>
        <span className="pga-db-p25" style={{ left: pos(d.p25) }}>P25 {d.p25.toFixed(1)}{unit}</span>
        <span className="pga-db-med" style={{ left: pos(d.median) }}>{d.median.toFixed(1)}{unit}</span>
        <span className="pga-db-p75" style={{ left: pos(d.p75) }}>P75 {d.p75.toFixed(1)}{unit}</span>
        <span className="pga-db-edge-r">{d.max.toFixed(1)}{unit}</span>
      </div>
    </div>
  );
}

function DistributionBars({ distribution, fundCount }) {
  return (
    <div className="pga-section">
      <div className="pga-section-hd">
        <span className="pga-section-title">Distribution across {fundCount} funds — Min · 25th–75th percentile band · Median · Max</span>
        <span className="pga-legend">
          <span className="pga-leg-item"><span className="pga-leg-sq" style={{ background: '#7A2754', opacity: .25 }}/>25th–75th pct band</span>
          <span className="pga-leg-item"><span style={{ display:'inline-block', width:3, height:12, background:'#3E3452', borderRadius:2, marginRight:4 }}/>Median</span>
        </span>
      </div>
      <div className="pga-db-explain">
        The shaded band covers the middle 50% of funds (25th to 75th percentile) — a fund inside the band is "typical" for its category; one far outside it, in either direction, is a genuine outlier worth understanding.
      </div>
      <div className="pga-db-grid">
        {DB_METRICS.map(m => (
          <div key={m.key} className="pga-db-item">
            <div className="pga-db-item-hd">
              <span className="pga-db-label">{m.label}</span>
              {distribution[m.key] && <span className="pga-db-count">{distribution[m.key].count}</span>}
            </div>
            <DistBar d={distribution[m.key]} unit={m.unit}/>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   5. MOMENTUM & VALUATION
───────────────────────────────────────────────────────── */
function MomentumValuation({ stats }) {
  if (!stats) return null;
  const retClr  = v => v == null ? undefined : v >= 0 ? POS : NEG;
  const betaClr = v => v == null ? undefined : v > 1.1 ? WARN : v < 0.9 ? POS : undefined;
  const dcClr   = v => v == null ? undefined : v <= 100 ? POS : NEG;
  function Chip({ label, value, color, sub }) {
    return (
      <div className="pga-mv-chip">
        <div className="pga-mv-val" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
        <div className="pga-mv-lbl">{label}</div>
        {sub && <div className="pga-mv-sub">{sub}</div>}
      </div>
    );
  }
  return (
    <div className="pga-section">
      <div className="pga-section-hd">
        <span className="pga-section-title">Momentum &amp; valuation snapshot</span>
        <span className="pga-section-meta">Category averages</span>
      </div>
      <div className="pga-db-explain">
        <strong>Momentum</strong> shows whether the category is currently heating up or cooling off over the last few months. <strong>Valuation</strong> shows whether the category's underlying stocks look expensive or cheap right now, plus a few extra risk gauges. Hover any label for a definition.
      </div>
      <div className="pga-mv-body">
        <div className="pga-mv-section-label">Short-term momentum (avg return)</div>
        <div className="pga-mv-grid pga-mv-grid-4">
          <Chip label="1 month"  value={fmtSgn(stats.avg_return_1m)} color={retClr(stats.avg_return_1m)}/>
          <Chip label="3 months" value={fmtSgn(stats.avg_return_3m)} color={retClr(stats.avg_return_3m)}/>
          <Chip label="6 months" value={fmtSgn(stats.avg_return_6m)} color={retClr(stats.avg_return_6m)}/>
          <Chip label="1 year"   value={fmtSgn(stats.avg_return_1y)} color={retClr(stats.avg_return_1y)}/>
        </div>
        <div className="pga-mv-divider"/>
        <div className="pga-mv-section-label">Valuation &amp; additional risk (3Y)</div>
        <div className="pga-mv-grid pga-mv-grid-6">
          <Chip label="Avg P/E"    value={stats.avg_pe  != null ? `${fmt(stats.avg_pe, 1)}x`  : '—'} sub="price / earnings"/>
          <Chip label="Avg P/B"    value={stats.avg_pb  != null ? `${fmt(stats.avg_pb, 1)}x`  : '—'} sub="price / book"/>
          <Chip label="Alpha"      value={fmtSgn(stats.avg_alpha_3y)}                                  color={retClr(stats.avg_alpha_3y)} sub="vs benchmark"/>
          <Chip label="Beta"       value={stats.avg_beta    != null ? fmt(stats.avg_beta)    : '—'}   color={betaClr(stats.avg_beta)}    sub="mkt sensitivity"/>
          <Chip label="Up capture" value={stats.avg_up_capture   != null ? `${fmt(stats.avg_up_capture,0)}%`   : '—'} sub="upside"/>
          <Chip label="Dn capture" value={stats.avg_down_capture != null ? `${fmt(stats.avg_down_capture,0)}%` : '—'} color={dcClr(stats.avg_down_capture)} sub="downside"/>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   SHARED TABLE COMPONENTS
───────────────────────────────────────────────────────── */
function ReturnCell({ value, quartile, showQ = false }) {
  if (value == null) return <span className="pga-null">—</span>;
  const n   = parseFloat(value);
  const clr = n >= 0 ? POS : NEG;
  const qc  = showQ && quartile ? Q_COLORS[quartile] : null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'center' }}>
      {qc && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:qc.bg, color:qc.text }}>Q{quartile}</span>}
      <span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600, color:clr }}>{fmtPct(n)}</span>
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
  { key: 'ranking',        label: 'BR Rank' },
  { key: 'return_1y',     label: '1Y'     },
  { key: 'return_3y',     label: '3Y'     },
  { key: 'return_5y',     label: '5Y'     },
  { key: 'sharpe_ratio_3y', label: 'Sharpe' },
  { key: 'alpha_3y',      label: 'Alpha'  },
  { key: 'fund_size',     label: 'AUM'    },
  { key: 'expense_ratio', label: 'ER'     },
];

// R1→1, R2→2 … R5→5, R0/null/anything else → 99 (sorts last)
function rankOrder(r) {
  if (!r) return 99;
  const n = parseInt(r.replace('R', ''), 10);
  return (!n || n === 0) ? 99 : n;
}

/* ─────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────── */
export default function PeerGroupAnalytics({ selectedDate, setSelectedFund }) {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(() => {
    return localStorage.getItem('pga_selected_cat') || '';
  });
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const [search, setSearch]       = useState('');
  const [minRating, setMinRating] = useState(0);
  const [maxEr, setMaxEr]         = useState(99);
  const [sortKey, setSortKey]     = useState('ranking');
  const [sortDir, setSortDir]     = useState('asc');
  const [selectedISINs, setSelectedISINs] = useState(new Set());
  const [watchlistAdded, setWatchlistAdded] = useState(new Set());

  const dateStr = selectedDate ? selectedDate.toISOString().split('T')[0] : null;

  useEffect(() => {
    fetch(`${API}/api/peer/categories`)
      .then(r => r.json())
      .then(d => {
        setCategories(d.groups || []);
        // Only default to first category if nothing saved
        const saved = localStorage.getItem('pga_selected_cat');
        if (!saved && d.groups?.length && d.groups[0].categories?.length) {
          setSelectedCat(d.groups[0].categories[0].label);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedCat) return;
    setLoading(true); setError(null); setData(null);
    setSearch(''); setMinRating(0); setMaxEr(99);
    setSortKey('peer_rank_1y'); setSortDir('asc');
    const url = `${API}/api/peer/category?category=${encodeURIComponent(selectedCat)}${dateStr ? `&date=${dateStr}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [selectedCat, dateStr]);

  const filteredFunds = useMemo(() => {
    if (!data?.funds) return [];
    return data.funds
      .filter(f => {
        if (search) { const q = search.toLowerCase(); if (!f.name?.toLowerCase().includes(q) && !f.amc?.toLowerCase().includes(q)) return false; }
        if (minRating > 0 && (f.morningstar_rating == null || f.morningstar_rating < minRating)) return false;
        if (maxEr < 99 && f.expense_ratio != null && f.expense_ratio > maxEr) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortKey === 'ranking') {
          const diff = rankOrder(a.ranking) - rankOrder(b.ranking);
          return sortDir === 'asc' ? diff : -diff;
        }
        let av = a[sortKey], bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1; if (bv == null) return -1;
        return sortDir === 'asc' ? av - bv : bv - av;
      });
  }, [data, search, minRating, maxEr, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'expense_ratio' || key === 'peer_rank_1y' || key === 'ranking' ? 'asc' : 'desc'); }
  }

  function SortTh({ sk, label, align = 'right' }) {
    const active = sortKey === sk;
    return (
      <th className={`pga-th ${active ? 'sorted' : ''}`} style={{ textAlign: align }} onClick={() => handleSort(sk)}>
        {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    );
  }

  const stats      = data?.stats;
  const dist       = data?.distribution;
  const cyMedians  = dist?.cy_medians;
  const filtersActive = search || minRating > 0 || maxEr < 99;

  return (
    <div className="pga-page fade-in">
      {/* ── Page header — title left, dropdown right ── */}
      <div className="pga-top-bar">
        <div>
          <h1 className="pga-page-title">Peer Group Analytics</h1>
          <p className="pga-page-desc">Full peer distribution — see where any fund really sits within its category.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {categories.length > 0 && (
            <select
              className="pga-cat-dropdown btn"
              value={selectedCat}
              onChange={e => { setSelectedCat(e.target.value); localStorage.setItem('pga_selected_cat', e.target.value); }}
            >
              {categories.map(grp => (
                <optgroup key={grp.group} label={grp.group}>
                  {grp.categories.map(c => (
                    <option key={c.label} value={c.label}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {data && (
            <span className="pga-data-date">Data: {data.data_date}</span>
          )}
        </div>
      </div>

      {/* ── Loading / error ── */}
      {loading && (
        <div className="pga-loading">
          <div className="mp-spinner"/>
          <div>Loading {selectedCat}…</div>
        </div>
      )}
      {error && <div className="error-msg">{error}</div>}

      {data && !loading && (
        <>
          {/* ── Category stats strip ── */}
          <div className="pga-hdr">
            <div className="pga-hdr-top">
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span className="pga-cat-title">{data.category}</span>
                  <span className="pga-count-badge">{stats?.fund_count} funds</span>
                  {filtersActive && <span className="pga-filter-badge">{filteredFunds.length} shown</span>}
                </div>
                <div className="pga-desc">{data.description}</div>
              </div>
            </div>
            <div className="pga-stats-row">
              <StatChip label="Avg 1M"       value={fmtPct(stats?.avg_return_1m)}  color={stats?.avg_return_1m  >= 0 ? POS : NEG}/>
              <StatChip label="Avg 3M"       value={fmtPct(stats?.avg_return_3m)}  color={stats?.avg_return_3m  >= 0 ? POS : NEG}/>
              <StatChip label="Avg 6M"       value={fmtPct(stats?.avg_return_6m)}  color={stats?.avg_return_6m  >= 0 ? POS : NEG}/>
              <StatChip label="Avg 1Y"       value={fmtPct(stats?.avg_return_1y)}  color={stats?.avg_return_1y  >= 0 ? POS : NEG}/>
              <StatChip label="Avg 3Y CAGR"  value={fmtPct(stats?.avg_return_3y)}  color={stats?.avg_return_3y  >= 0 ? POS : NEG}/>
              <StatChip label="Avg 5Y CAGR"  value={fmtPct(stats?.avg_return_5y)}  color={stats?.avg_return_5y  >= 0 ? POS : NEG}/>
              <StatChip label="Std Dev (3Y)" value={stats?.avg_std_dev_3y != null ? `${fmt(stats.avg_std_dev_3y, 1)}%` : '—'}/>
              <StatChip label="Std Dev (5Y)" value={stats?.avg_std_dev_5y != null ? `${fmt(stats.avg_std_dev_5y, 1)}%` : '—'}/>
            </div>
          </div>

          {/* ── 5 analytics sections ── */}
          <PerformanceSnapshot funds={data.funds} cyMedians={cyMedians}/>
          <RiskReturnScatter   funds={data.funds}/>
          <ConsistencyChart    funds={data.funds} cyMedians={cyMedians}/>
          {dist && <DistributionBars distribution={dist} fundCount={data.funds.length}/>}
          <MomentumValuation stats={stats}/>

          {/* ── Filter + sort bar ── */}
          <div className="pga-filter-bar">
            <div className="pga-filter-inner">
              <div className="pga-search-wrap">
                <svg className="pga-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input type="text" className="pga-search" placeholder="Search fund or AMC…"
                  value={search} onChange={e => setSearch(e.target.value)}/>
              </div>
              <div className="pga-sort-group">
                Sort:
                {SORT_KEYS.map(s => (
                  <button key={s.key} className={`pga-sort-btn ${sortKey === s.key ? 'active' : ''}`} onClick={() => handleSort(s.key)}>{s.label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Table header block ── */}
          <div className="pga-table-header-block">
            <div className="pga-table-title">ALL FUNDS IN {(data.category || '').toUpperCase()} — CLICK A COLUMN TO SORT, CHECK UP TO 4 TO COMPARE</div>
            <div className="pga-table-subtitle">
              Every fund in this category, ranked and searchable. <strong>Quartile (Q1–Q4)</strong> shows which quarter of the pack a fund sits in by 1-year return (Q1 = best 25%, Q4 = worst 25%) and stays fixed no matter how you sort the table.
            </div>
          </div>

          {/* ── Action bar — shown when funds are selected ── */}
          {selectedISINs.size > 0 && (
            <div className="pga-action-bar">
              <span className="pga-action-count">{selectedISINs.size} fund{selectedISINs.size > 1 ? 's' : ''} selected</span>
              <div className="pga-action-btns">
                <button className="pga-action-btn pga-action-compare" onClick={() => {
                  if (selectedISINs.size > 4) {
                    alert('You can compare up to 4 funds at a time. Please deselect some funds.');
                    return;
                  }
                  const selected = filteredFunds.filter(f => selectedISINs.has(f.isin));
                  sessionStorage.setItem('compareFunds', JSON.stringify(selected.map(f => ({ isin: f.isin, name: f.name, ranking: f.ranking, amfi_code: f.amfi_code, category: f.category }))));
                  navigate('/peer-comparison');
                }}>
                  Compare funds →
                </button>
                <button className="pga-action-btn pga-action-watchlist" onClick={() => {
                  const selected = filteredFunds.filter(f => selectedISINs.has(f.isin));
                  selected.forEach(f => addToWatchlist({ isin: f.isin, name: f.name, ranking: f.ranking, amfi_code: f.amfi_code, category: f.category }));
                  setWatchlistAdded(new Set([...watchlistAdded, ...selectedISINs]));
                }}>
                  + Add to watchlist
                </button>
                <button className="pga-action-btn pga-action-clear" onClick={() => setSelectedISINs(new Set())}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* ── Fund table ── */}
          <div className="pga-table-card">
            <div style={{ overflowX:'auto' }}>
              <table className="pga-table">
                <thead>
                  <tr>
                    <th className="pga-th" style={{ width:32, textAlign:'center', paddingRight:4 }}>
                      <input type="checkbox"
                        checked={filteredFunds.length > 0 && filteredFunds.every(f => selectedISINs.has(f.isin))}
                        onChange={e => {
                          if (e.target.checked) setSelectedISINs(new Set(filteredFunds.map(f => f.isin)));
                          else setSelectedISINs(new Set());
                        }}
                      />
                    </th>
                    <th className="pga-th" style={{ textAlign:'left' }}>Fund</th>
                    <SortTh sk="ranking"         label="BR"     align="center"/>
                    <SortTh sk="return_1y"       label="1Y"     align="center"/>
                    <SortTh sk="return_3y"       label="3Y"     align="center"/>
                    <SortTh sk="return_5y"       label="5Y"     align="center"/>
                    <SortTh sk="sharpe_ratio_3y" label="Sharpe" align="center"/>
                    <SortTh sk="alpha_3y"        label="Alpha"  align="center"/>
                    <SortTh sk="std_dev_3y"      label="Std dev" align="center"/>
                    <SortTh sk="expense_ratio"   label="ER"     align="center"/>
                    <SortTh sk="fund_size"       label="AUM"    align="center"/>
                    <th className="pga-th" style={{ textAlign:'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFunds.length === 0 ? (
                    <tr><td colSpan={12} style={{ textAlign:'center', padding:32, color:'var(--text-muted)', fontSize:13 }}>No funds match the current filters.</td></tr>
                  ) : filteredFunds.map(f => {
                    const brRank  = f.ranking;
                    const rankVal = brRank ? parseInt(brRank.replace('R',''), 10) : 0;
                    const brClass = !brRank || rankVal === 0 ? null
                      : rankVal <= 2 ? 'pga-br-green'
                      : rankVal === 3 ? 'pga-br-neutral'
                      : 'pga-br-red';
                    const isChecked = selectedISINs.has(f.isin);
                    const inWatchlist = watchlistAdded.has(f.isin) || isInWatchlist(f.isin);
                    return (
                      <tr key={f.isin} className={`pga-tr ${isChecked ? 'pga-tr-selected' : ''}`}>
                        <td className="pga-td" style={{ textAlign:'center', paddingRight:4 }}>
                          <input type="checkbox" checked={isChecked}
                            onChange={e => {
                              const next = new Set(selectedISINs);
                              if (e.target.checked) next.add(f.isin); else next.delete(f.isin);
                              setSelectedISINs(next);
                            }}
                          />
                        </td>
                        <td className="pga-td">
                          <div style={{ fontWeight:600, fontSize:12.5, color:'var(--text-primary)', marginBottom:2 }}>{f.name}</div>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                            {f.amc}
                            {f.morningstar_rating != null && <span style={{ color:WARN, marginLeft:5 }}>{'★'.repeat(f.morningstar_rating)}</span>}
                          </div>
                        </td>
                        <td className="pga-td" style={{ textAlign:'center' }}>
                          {brClass
                            ? <span className={`pga-br-badge ${brClass}`}>{brRank}</span>
                            : <span className="pga-null">—</span>}
                        </td>
                        <td className="pga-td"><ReturnCell value={f.return_1y} quartile={f.quartile_1y} showQ/></td>
                        <td className="pga-td"><ReturnCell value={f.return_3y}/></td>
                        <td className="pga-td"><ReturnCell value={f.return_5y}/></td>
                        <td className="pga-td pga-num pga-center">{fmt(f.sharpe_ratio_3y, 1)}</td>
                        <td className="pga-td pga-num pga-center" style={{ color: f.alpha_3y >= 0 ? POS : NEG }}>{f.alpha_3y != null ? `${f.alpha_3y > 0 ? '+' : ''}${parseFloat(f.alpha_3y).toFixed(1)}%` : '—'}</td>
                        <td className="pga-td pga-num pga-center">{fmt(f.std_dev_3y, 1)}%</td>
                        <td className="pga-td pga-num pga-center">{f.expense_ratio != null ? `${parseFloat(f.expense_ratio).toFixed(1)}%` : '—'}</td>
                        <td className="pga-td pga-num pga-center" style={{ fontSize:11 }}>{fmtAum(f.fund_size)}</td>
                        <td className="pga-td" style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                          <button className="pga-row-btn pga-row-watch" title="Add to watchlist"
                            onClick={() => { addToWatchlist({ isin: f.isin, name: f.name, ranking: f.ranking, amfi_code: f.amfi_code, category: f.category }); setWatchlistAdded(prev => new Set([...prev, f.isin])); }}
                            style={{ background: inWatchlist ? 'rgba(26,122,82,.1)' : undefined, color: inWatchlist ? POS : undefined }}>
                            {inWatchlist ? '✓' : '+ Watch'}
                          </button>
                          <button className="pga-row-btn pga-row-view" title="View fund detail"
                            onClick={() => { setSelectedFund?.({ isin: f.isin, name: f.name, ranking: f.ranking, amfi_code: f.amfi_code, category: f.category }); navigate('/home'); }}>
                            View →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredFunds.length > 0 && (
              <div className="pga-table-footer">
                Q1–Q4 based on 1Y return rank within unfiltered peer set · Data as of {data.data_date}
              </div>
            )}
          </div>

          <div className="pga-footnote">
            Quartiles computed on 1Y return within the full category. Consistency uses each fund's CY return vs the peer median for that calendar year.
          </div>

          {/* ── Methodology box ── */}
          <div className="pga-methodology">
            <div className="pga-methodology-hd">ℹ Methodology</div>
            <div className="pga-methodology-body">
              Quartiles are computed within the category peer set using 1Y return (Q1 = top performers) and stay fixed regardless of how the table is sorted. Averages exclude funds with no data for that metric. Consistency scoring compares each fund's calendar-year return to the peer median for that year. Figures reflect live data from the BugleRock database, refreshed daily.
            </div>
          </div>
        </>
      )}
    </div>
  );
}