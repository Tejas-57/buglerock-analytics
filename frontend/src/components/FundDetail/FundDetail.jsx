import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { addToWatchlist, isInWatchlist } from '../Watchlist/Watchlist';

const API = process.env.REACT_APP_API_URL || '';

function fmt(v, d = 2) {
  if (v == null || v === '-') return '—';
  return parseFloat(v).toFixed(d);
}
function pct(v, d = 2) {
  if (v == null || v === '-') return '—';
  const n = parseFloat(v);
  return (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
}
function col(v) {
  if (v == null || v === '-') return 'var(--text-muted)';
  return parseFloat(v) >= 0 ? '#1A7A52' : '#912F63';
}
function fmtInr(v) {
  if (!v || v === '-') return '—';
  const n = parseFloat(v);
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr';
}
function stars(n) {
  if (!n || n === '-') return null;
  const r = parseInt(n);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function ReturnPill({ period, value, highlight }) {
  const v = value != null && value !== '-' ? parseFloat(value) : null;
  return (
    <div style={{ border: `${highlight ? 1.5 : 1}px solid ${highlight ? 'var(--brand-primary)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 10px', textAlign: 'center', background: highlight ? 'rgba(145,47,99,0.04)' : '#fff' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{period}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, lineHeight: 1, letterSpacing: '-.02em', color: v != null ? col(v) : 'var(--text-muted)' }}>{v != null ? pct(v) : '—'}</div>
    </div>
  );
}

function NAVChart({ fund, selectedDate }) {
  const [navPeriod, setNavPeriod] = useState('1y');
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const canvasRef = React.useRef(null);
  const containerRef = React.useRef(null);

  useEffect(() => {
    if (!fund?.amfi_code) return;
    setLoading(true);
    const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;
    const params = new URLSearchParams({
      amfi_code: fund.amfi_code,
      period: navPeriod,
      ...(fund.assetClass && { asset_class: fund.assetClass }),
      ...(fund.category && { category: fund.category }),
      ...(dateStr && { date: dateStr }),
    });
    fetch(`${API}/api/performance/nav-chart?${params}`)
      .then(r => r.json())
      .then(d => { setChartData(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fund, navPeriod, selectedDate]);

  const PERIODS = ['1m','3m','6m','1y','3y','5y'];
  const hasData = chartData.length > 0;

  const firstNav = hasData ? chartData.find(d => d.fund_nav != null)?.fund_nav : null;
  const lastNav = hasData ? [...chartData].reverse().find(d => d.fund_nav != null)?.fund_nav : null;
  const isPositive = firstNav && lastNav ? lastNav >= firstNav : true;
  const lineColor = isPositive ? '#1A7A52' : '#912F63';

  // Draw on canvas whenever data changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) return;
    const W = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    const H = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const vals = chartData.map(d => d.fund_nav).filter(v => v != null);
    if (!vals.length) return;
    const minV = Math.min(...vals) * 0.998;
    const maxV = Math.max(...vals) * 1.002;
    const toX = i => (i / (chartData.length - 1)) * W;
    const toY = v => H - ((v - minV) / (maxV - minV || 1)) * H;

    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let started = false;
    chartData.forEach((d, i) => {
      if (d.fund_nav == null) return;
      const x = toX(i), y = toY(d.fund_nav);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // End dot
    const lastIdx = chartData.reduce((acc, d, i) => d.fund_nav != null ? i : acc, 0);
    if (!tooltip) {
      ctx.beginPath();
      ctx.arc(toX(lastIdx), toY(chartData[lastIdx].fund_nav), 3 * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5 * window.devicePixelRatio;
      ctx.stroke();
    }
  }, [chartData, lineColor, tooltip]);

  const getNavAtX = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const idx = Math.min(chartData.length - 1, Math.max(0, Math.round(ratio * (chartData.length - 1))));
    const d = chartData[idx];
    if (!d?.fund_nav) return null;
    const vals = chartData.map(p => p.fund_nav).filter(v => v != null);
    const minV = Math.min(...vals) * 0.998;
    const maxV = Math.max(...vals) * 1.002;
    const toY = v => rect.height - ((v - minV) / (maxV - minV || 1)) * rect.height;
    return { ratio, x: ratio * rect.width, y: toY(d.fund_nav), date: d.date, nav: d.fund_nav };
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {PERIODS.map(p => (
          <button key={p} onClick={() => setNavPeriod(p)} style={{ padding: '3px 10px', fontSize: 11, border: '1px solid', borderColor: navPeriod===p?'var(--brand-primary)':'var(--border)', borderRadius: 4, background: navPeriod===p?'var(--brand-primary)':'transparent', color: navPeriod===p?'#fff':'var(--text-muted)', cursor: 'pointer', fontWeight: 600, textTransform: 'uppercase' }}>{p}</button>
        ))}
      </div>
      <div style={{ height: 20, marginBottom: 4 }}>
        {tooltip && (
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginLeft: `${Math.min(Math.max(tooltip.ratio * 100, 5), 75)}%` }}>
            NAV: <strong>₹{fmt(tooltip.nav)}</strong>&nbsp;|&nbsp;{tooltip.date}
          </span>
        )}
      </div>
      {loading ? (
        <div className="loading-shimmer" style={{ height: 180, borderRadius: 6 }} />
      ) : !hasData ? (
        <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>NAV data not available</div>
      ) : (
        <div ref={containerRef} style={{ position: 'relative', height: 180, cursor: 'crosshair' }}
          onMouseMove={e => setTooltip(getNavAtX(e.clientX))}
          onMouseLeave={() => setTooltip(null)}
        >
          <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
          {/* Vertical hover line */}
          {tooltip && (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: tooltip.x, width: 1, background: '#D0CDD4', pointerEvents: 'none', transform: 'translateX(-50%)' }} />
          )}
          {/* Hover dot */}
          {tooltip && (
            <div style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: lineColor, border: '2px solid white', boxShadow: `0 0 0 1.5px ${lineColor}`, left: tooltip.x, top: tooltip.y, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} />
          )}
        </div>
      )}
      {hasData && chartData.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          <span>{chartData[0]?.date}</span>
          <span>{chartData[chartData.length-1]?.date}</span>
        </div>
      )}
    </div>
  );
}

function BarRow({ name, value, color }) {
  const v = value != null && value !== '-' ? parseFloat(value) : null;
  if (v == null) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color }}>{v.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(v, 100).toFixed(1)}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function RiskGauge({ label, value, lo, hi, thresh, lowerBetter }) {
  const v = value != null && value !== '-' ? parseFloat(value) : null;
  const p = v != null ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 0;
  const good = v != null && (lowerBetter ? v <= thresh : v >= thresh);
  const danger = v != null && (lowerBetter ? v > 1.3 : v < thresh * 0.5);
  const c = v == null ? 'var(--text-muted)' : good ? '#1A7A52' : danger ? '#912F63' : '#7A5A10';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, lineHeight: 1, marginBottom: 6, letterSpacing: '-.02em', color: c }}>{v != null ? fmt(v) : '—'}</div>
      <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${p.toFixed(1)}%`, background: c, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function CYBarsChart({ fund, benchmark }) {
  const [hovered, setHovered] = useState(null);
  const CY_KEYS = ['cy2021','cy2022','cy2023','cy2024','cy2025'];
  const CY_YRS  = ['2021','2022','2023','2024','2025'];
  const r = fund?.returns || {};
  const br = benchmark?.returns || {};
  const fVals = CY_KEYS.map(k => { const v = r[`return_${k}`] || r[k]; return v != null && v !== '-' ? parseFloat(v) : null; });
  const bVals = CY_KEYS.map(k => { const v = br[`return_${k}`] || br[k]; return v != null && v !== '-' ? parseFloat(v) : null; });
  const allV = [...fVals, ...bVals].filter(v => v != null);
  if (!allV.length) return <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12 }}>Calendar year data not available</div>;
  const maxV = Math.max(...allV.map(Math.abs)) || 10;
  const CH = 140, ZH = 24, posH = CH - ZH;
  return (
    <div style={{ padding: '14px 20px 10px' }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', height: CH, position: 'relative' }}>
        {CY_YRS.map((yr, i) => {
          const fv = fVals[i], bv = bVals[i];
          const diff = fv != null && bv != null ? (fv - bv).toFixed(1) : null;
          const fH = fv != null ? Math.max(4, Math.abs(fv) / maxV * posH) : 0;
          const bH = bv != null ? Math.max(4, Math.abs(bv) / maxV * posH) : 0;
          const isHov = hovered === i;
          return (
            <div key={yr} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Outperformance diff */}
              {diff != null && (
                <div style={{ fontSize: 9, fontWeight: 700, color: parseFloat(diff) >= 0 ? '#1A7A52' : '#912F63', marginBottom: 3, textAlign: 'center' }}>
                  {parseFloat(diff) >= 0 ? '+' : ''}{diff}
                </div>
              )}
              {/* Bars */}
              <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', width: '70%' }}>
                {fv != null && (
                  <div style={{ flex: 1, position: 'relative' }}>
                    {/* Hover tooltip on fund bar */}
                    {isHov && fv != null && (
                      <div style={{ position: 'absolute', bottom: fH + 4, left: '50%', transform: 'translateX(-50%)', background: 'var(--brand-dark)', color: '#fff', fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 4, whiteSpace: 'nowrap', zIndex: 10 }}>
                        {fv >= 0 ? '+' : ''}{fv.toFixed(2)}%
                      </div>
                    )}
                    <div style={{ height: fH, background: fv >= 0 ? '#912F63' : '#C46985', borderRadius: '3px 3px 0 0', minHeight: 4, opacity: isHov ? 0.8 : 1, transition: 'opacity .15s' }} />
                  </div>
                )}
                {bv != null && (
                  <div style={{ flex: 1, position: 'relative' }}>
                    {isHov && bv != null && (
                      <div style={{ position: 'absolute', bottom: bH + 4, left: '50%', transform: 'translateX(-50%)', background: '#6D5479', color: '#fff', fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 4, whiteSpace: 'nowrap', zIndex: 10 }}>
                        {bv >= 0 ? '+' : ''}{bv.toFixed(2)}%
                      </div>
                    )}
                    <div style={{ height: bH, background: bv >= 0 ? '#A795AE' : '#D4C9DF', borderRadius: '3px 3px 0 0', minHeight: 4, opacity: isHov ? 0.8 : 0.85, transition: 'opacity .15s' }} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, textAlign: 'center' }}>{yr}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Card = ({ title, subtitle, children }) => (
  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-card)', marginBottom: 14 }}>
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bg-secondary)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--brand-dark)' }}>{title}</span>
      {subtitle && <span style={{ fontSize: 11, color: 'var(--brand-mid)', fontWeight: 500 }}>{subtitle}</span>}
    </div>
    {children}
  </div>
);

const SecLabel = ({ children, extra }) => (
  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
    {children}{extra}
  </div>
);

export default function FundDetail({ selectedDate, selectedFund, setSelectedFund }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem('br_funddetail_period') || '3y'; } catch { return '3y'; }
  });
  function setPeriodPersist(p) {
    try { localStorage.setItem('br_funddetail_period', p); } catch {}
    setPeriod(p);
  }
  const [inWatchlist, setInWatchlist] = useState(() => selectedFund ? isInWatchlist(selectedFund?.isin) : false);
  const [showCompareWarning, setShowCompareWarning] = useState(false);

  const handleCompare = () => {
    const existing = JSON.parse(localStorage.getItem('compareFunds_state') || '[]');
    if (existing.length > 0) {
      setShowCompareWarning(true);
    } else {
      goToCompare();
    }
  };

  const goToCompare = () => {
    if (!selectedFund) return;
    const fund = { isin: selectedFund.isin, name: selectedFund.name, category: selectedFund.category, asset_class: selectedFund.asset_class };
    sessionStorage.setItem('compareFunds', JSON.stringify([fund]));
    setShowCompareWarning(false);
    navigate('/peer-comparison');
  };

  const handleAddToWatchlist = () => {
    if (!selectedFund) return;
    addToWatchlist(selectedFund);
    setInWatchlist(true);
  };

  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;

  useEffect(() => {
    if (!selectedFund?.isin) return;
    setLoading(true); setError(null); setData(null); setBenchmark(null);
    const ac = selectedFund.assetClass || 'Equity';
    const cat = selectedFund.category || '';
    Promise.all([
      fetch(`${API}/api/home/snapshot?isin=${selectedFund.isin}&date=${dateStr}`).then(r => r.json()),
      fetch(`${API}/api/performance/peer-avg?category=${encodeURIComponent(cat)}&asset_class=${encodeURIComponent(ac)}&date=${dateStr}`).then(r => r.json()).catch(() => null),
    ]).then(([snap, bm]) => {
      setData(snap);
      setBenchmark(bm?.benchmark || null);
      setLoading(false);
    }).catch(() => { setError('Failed to load fund data.'); setLoading(false); });
  }, [selectedFund, dateStr]);

  // Top holdings + top sectors — from Morningstar holdings API
  const [holdingsData, setHoldingsData] = useState(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsError, setHoldingsError] = useState(null);

  useEffect(() => {
    if (!selectedFund?.isin) return;
    setHoldingsLoading(true); setHoldingsError(null); setHoldingsData(null);
    fetch(`${API}/api/holdings/${selectedFund.isin}`)
      .then(r => { if (!r.ok) throw new Error('No holdings data'); return r.json(); })
      .then(d => { setHoldingsData(d); setHoldingsLoading(false); })
      .catch(() => { setHoldingsError('Holdings data not available for this fund.'); setHoldingsLoading(false); });
  }, [selectedFund]);

  if (showCompareWarning) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 10 }}>Clear existing comparison?</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
            This action will clear existing funds in the Fund comparison tab and start a new comparison with <strong>{selectedFund?.name}</strong>.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCompareWarning(false)} style={{ padding: '8px 16px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>Cancel</button>
            <button onClick={goToCompare} style={{ padding: '8px 16px', fontSize: 13, border: 'none', borderRadius: 8, background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Yes, proceed</button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedFund) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: .3 }}>◎</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>No fund selected. Choose one from Fund Explorer.</div>
        <button onClick={() => navigate('/fund-explorer')} style={{ padding: '8px 18px', background: 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>← Go to Fund Explorer</button>
      </div>
    );
  }

  const f = data;
  const r = f?.returns || {};
  const risk = f?.risk || {};
  const rk  = (base) => { const v = risk[`${base}_${period}`]; return v != null && v !== '-' ? v : risk[`${base}_3y`] ?? null; };
  const rk1 = (base) => risk[`${base}_1y`] ?? null;
  const bmName = benchmark?.name || null;
  const bmR = benchmark?.returns || {};

  const retRows = [
    ['1 Month',  r['1m'],  bmR['1m']],
    ['3 Months', r['3m'],  bmR['3m']],
    ['6 Months', r['6m'],  bmR['6m']],
    ['1 Year',   r['1y'],  bmR['1y']],
    ['2 Year',   r['2y'],  bmR['2y']],
    ['3Y CAGR',  r['3y'],  bmR['3y']],
    ['5Y CAGR',  r['5y'],  bmR['5y']],
    ['7Y CAGR',  r['7y'],  bmR['7y']],
    ['10Y CAGR', r['10y'], bmR['10y']],
    ['YTD',      r['ytd'], bmR['ytd']],
  ].filter(([, fv]) => fv != null && fv !== '-');

  const bmRisk = benchmark?.risk || {};
  // Helper — true only if value is a real number (not null, not '-', not 0 for capture ratios)
  const hasVal = (v) => v != null && v !== '-' && !isNaN(parseFloat(v));
  const hasEquityRisk = hasVal(rk('up_capture')) || hasVal(rk('alpha')) || hasVal(rk('beta'));
  const hasCYData = ['cy2021','cy2022','cy2023','cy2024','cy2025'].some(k => hasVal(f?.returns?.[k]));
  const bmRk = (base) => { const v = bmRisk[`${base}_${period}`]; return v != null && v !== '-' ? v : null; };

  const riskRows = [
    { l:'Std Dev',            vf:rk('std_dev'),            vb:bmRk('std_dev'),            fmt:v=>fmt(v)+'%', sig:v=>parseFloat(v)<12?'Low vol':parseFloat(v)<18?'Moderate':'High vol' },
    { l:'Alpha',              vf:rk('alpha'),              vb:null,                        fmt:v=>pct(v),     sig:v=>parseFloat(v)>2?'Strong outperform':parseFloat(v)>0?'Positive':parseFloat(v)>-2?'Slight lag':'Underperform' },
    { l:'Beta',               vf:rk('beta'),               vb:null,                        fmt:v=>fmt(v),     sig:v=>parseFloat(v)<0.8?'Defensive':parseFloat(v)<1.1?'Market-like':'Aggressive' },
    { l:'Sharpe',             vf:rk('sharpe_ratio'),       vb:bmRk('sharpe_ratio'),       fmt:v=>fmt(v),     sig:v=>parseFloat(v)>0.8?'Strong':parseFloat(v)>0.5?'Adequate':'Weak' },
    { l:'Sortino',            vf:rk('sortino_ratio'),      vb:bmRk('sortino_ratio'),      fmt:v=>fmt(v),     sig:v=>parseFloat(v)>1?'Good':parseFloat(v)>0.6?'Moderate':'Weak' },
    { l:'Information Ratio',  vf:rk('information_ratio'), vb:null,                        fmt:v=>fmt(v),     sig:v=>parseFloat(v)>0.5?'Strong':parseFloat(v)>0?'Positive':parseFloat(v)>-0.5?'Slight lag':'Weak' },
    // Tracking error — only populated for ETF and Index funds, follows period selector
    { l:`Tracking Error (${period.toUpperCase()})`, vf:f?.[`tracking_error_${period}`], vb:null, fmt:v=>fmt(v)+'%', sig:v=>parseFloat(v)<0.5?'Tight track':parseFloat(v)<1?'Good':parseFloat(v)<2?'Moderate':'High drift' },
  ].filter(row => row.vf!=null&&row.vf!=='-');

  const nav52pct = f?.nav && f?.nav_52w_high && f?.nav_52w_low && f.nav!=='-' && f.nav_52w_high!=='-' && f.nav_52w_low!=='-'
    ? Math.min(100, Math.max(0, ((parseFloat(f.nav)-parseFloat(f.nav_52w_low))/(parseFloat(f.nav_52w_high)-parseFloat(f.nav_52w_low)))*100))
    : null;

  const erVal = f?.expense_ratio != null && f.expense_ratio !== '-' ? parseFloat(f.expense_ratio) : null;

  // Layout mode detection
  const assetClass = selectedFund?.assetClass || f?.asset_class || '';
  const category = selectedFund?.category || f?.category || '';
  const isDebt = assetClass === 'Debt' || assetClass === 'ETF - Debt';
  const isDebtHybrid = assetClass === 'Hybrid' && (
    category.includes('Conservative') || category.includes('Credit Risk') ||
    category.includes('Banking & PSU') || category.includes('Dynamic Bond')
  );
  const equityPct = f?.equity_pct != null && f.equity_pct !== '-' ? parseFloat(f.equity_pct) : null;
  const isEquityHybrid = assetClass === 'Hybrid' && equityPct != null && equityPct >= 60;
  const layoutMode = isDebt ? 'debt' : (isDebtHybrid || (assetClass === 'Hybrid' && !isEquityHybrid)) ? 'hybrid' : 'equity';

  const hasCreditData = f && (
    (f.credit_aaa != null && f.credit_aaa !== '-') ||
    (f.credit_aa != null && f.credit_aa !== '-') ||
    (f.credit_a != null && f.credit_a !== '-') ||
    (f.credit_bbb != null && f.credit_bbb !== '-') ||
    (f.credit_bb != null && f.credit_bb !== '-') ||
    (f.credit_b != null && f.credit_b !== '-') ||
    (f.credit_below_b != null && f.credit_below_b !== '-') ||
    (f.credit_nr != null && f.credit_nr !== '-')
  );
  const hasSectorData = f && (
    (f.fi_sector_government != null && f.fi_sector_government !== '-') ||
    (f.fi_sector_corporate != null && f.fi_sector_corporate !== '-') ||
    (f.fi_sector_cash_equiv != null && f.fi_sector_cash_equiv !== '-') ||
    (f.fi_sector_municipal != null && f.fi_sector_municipal !== '-') ||
    (f.fi_sector_securitized != null && f.fi_sector_securitized !== '-') ||
    (f.fi_sector_derivative != null && f.fi_sector_derivative !== '-')
  );
  // Master switch for the two debt-specific cards — driven by the sheet-level
  // structural flag (does this fund's source sheet even have these columns),
  // not by whether this row's values happen to be populated. This is what
  // correctly excludes equity funds that merely hold a small bond_pct.
  const hasDebtSection = !!(f?.has_debt_columns);
  // Same principle for the Equity Risk Metrics card — driven by whether the
  // fund's source sheet has these columns at all (Debt/Debt ETF sheets don't).
  const hasEquitySection = !!(f?.has_equity_columns);
  const erColor = erVal == null ? 'var(--text-muted)' : erVal <= 1.0 ? '#1A7A52' : erVal <= 1.5 ? '#7A5A10' : '#912F63';
  const erLabel = erVal == null ? '—' : erVal <= 0.5 ? 'Ultra-low cost' : erVal <= 1.0 ? 'Low cost' : erVal <= 1.5 ? 'Average' : erVal <= 2.0 ? 'Above average' : 'High cost';

  const periodBtn = (p) => (
    <button key={p} onClick={() => setPeriod(p)} style={{ marginLeft: 4, padding: '2px 8px', fontSize: 10, border: '1px solid', borderColor: period===p?'var(--brand-primary)':'var(--border)', borderRadius: 4, background: period===p?'var(--brand-primary)':'transparent', color: period===p?'#fff':'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>{p.toUpperCase()}</button>
  );

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── HERO ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-card)', marginBottom: 14, padding: '16px 20px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button onClick={() => navigate('/fund-explorer')} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>← Back</button>
              {f && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.category}</span>}
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: 'var(--brand-dark)', letterSpacing: '-.02em', lineHeight: 1.15, marginBottom: 6 }}>
              {loading ? <div className="loading-shimmer" style={{ height: 28, width: 320, borderRadius: 6 }} /> : (f?.name || selectedFund.name)}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {f?.category && <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: 'rgba(145,47,99,0.08)', color: 'var(--brand-primary)' }}>{f.category}</span>}
              {f?.isin && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{f.isin}</span>}
              {selectedFund.ranking && selectedFund.ranking !== '-' && ['R1','R2','R3','R4','R5'].includes(selectedFund.ranking) && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(16,185,129,0.1)', color: '#059669' }}>{selectedFund.ranking}</span>}
              {f?.morningstar_rating && f.morningstar_rating !== '-' && <span style={{ fontSize: 13, color: '#B46B10', letterSpacing: -1 }}>{stars(f.morningstar_rating)}</span>}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            {loading ? <div className="loading-shimmer" style={{ height: 36, width: 100, borderRadius: 6 }} /> : f?.nav && f.nav !== '-' ? (
              <>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-.03em', lineHeight: 1 }}>₹{fmt(f.nav)}</div>
                {r['1d'] != null && r['1d'] !== '-' && <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3, color: col(r['1d']) }}>{parseFloat(r['1d'])>=0?'▲ +':'▼ '}{fmt(r['1d'])}% 1D</div>}
                {f.nav_date && f.nav_date !== '-' && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{f.nav_date}</div>}
              </>
            ) : null}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
              <button onClick={handleAddToWatchlist} style={{ padding: '6px 12px', fontSize: 12, border: `1px solid ${inWatchlist ? '#1A7A52' : 'var(--brand-primary)'}`, borderRadius: 8, background: inWatchlist ? 'rgba(26,122,82,0.08)' : 'rgba(145,47,99,0.06)', cursor: 'pointer', color: inWatchlist ? '#1A7A52' : 'var(--brand-primary)', fontWeight: 500 }}>
                {inWatchlist ? '★ In Watchlist' : '☆ Add to Watchlist'}
              </button>
              <button onClick={handleCompare} style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>Compare peers ↗</button>
            </div>
          </div>
        </div>

        {bmName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Benchmark</span>
            <span style={{ fontWeight: 500, color: 'var(--brand-dark)' }}>{bmName}</span>
          </div>
        )}

        {nav52pct != null && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 5, background: 'var(--bg-secondary)', borderRadius: 3, position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${nav52pct.toFixed(1)}%`, background: 'linear-gradient(to right,#C46985,#912F63)', borderRadius: 3 }} />
                <div style={{ position: 'absolute', top: -3, left: `${nav52pct.toFixed(1)}%`, width: 11, height: 11, borderRadius: '50%', background: 'var(--brand-dark)', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)', transform: 'translateX(-50%)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, fontSize: 10 }}>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>52W Low ₹{fmt(f.nav_52w_low)}</span>
              <span style={{ color: parseFloat(((parseFloat(f.nav)-parseFloat(f.nav_52w_low))/parseFloat(f.nav_52w_low)*100).toFixed(1))>=0?'#1A7A52':'#912F63', fontWeight: 600 }}>
                {((parseFloat(f.nav)-parseFloat(f.nav_52w_low))/parseFloat(f.nav_52w_low)*100)>=0?'+':''}{((parseFloat(f.nav)-parseFloat(f.nav_52w_low))/parseFloat(f.nav_52w_low)*100).toFixed(1)}% from low
              </span>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>52W High ₹{fmt(f.nav_52w_high)}</span>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 6, marginBottom: 14 }}>
          {[...Array(8)].map((_,i) => <div key={i} className="loading-shimmer" style={{ height: 70, borderRadius: 10 }} />)}
        </div>
      )}
      {error && <div style={{ padding: 20, color: '#912F63', textAlign: 'center' }}>{error}</div>}

      {f && !loading && <>

        {/* ① RETURN PILLS */}
        <SecLabel>Returns at a glance</SecLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,minmax(0,1fr))', gap: 6, marginBottom: 14 }}>
          {[['1M',r['1m']],['3M',r['3m']],['6M',r['6m']],['1Y',r['1y']],['YTD',r['ytd']],['3Y',r['3y']],['5Y',r['5y']],['10Y',r['10y']]].map(([p,v,hi]) => (
            <ReturnPill key={p} period={p} value={v} highlight={hi} />
          ))}
        </div>

        {/* ② NAV CHART */}
        <Card title="Historical NAV performance" subtitle={null}>
          <div style={{ padding: '12px 14px' }}>
            <NAVChart fund={selectedFund} selectedDate={selectedDate} />
          </div>
        </Card>

        {/* ③ RETURN TABLE */}
        <Card title="All return periods" subtitle={bmName ? `vs ${bmName}` : null}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  {['Period','Fund return', bmName&&'Benchmark', bmName&&'Outperformance'].filter(Boolean).map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: h==='Period'?'left':'right', fontSize: 10, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {retRows.map(([period, fv, bv]) => {
                  const diff = bv!=null&&bv!=='-' ? (parseFloat(fv)-parseFloat(bv)).toFixed(2) : null;
                  return (
                    <tr key={period} style={{ borderBottom: '1px solid var(--bg-secondary)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)' }}>{period}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: col(fv) }}>{pct(fv)}</td>
                      {bmName && <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{bv!=null&&bv!=='-'?pct(bv):'—'}</td>}
                      {bmName && <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: diff!=null?col(diff):'var(--text-muted)' }}>{diff!=null?(parseFloat(diff)>=0?'+':'')+diff+'%':'—'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ④ CALENDAR YEAR */}
        {hasCYData && (
          <Card title={`Calendar year returns${bmName?' vs '+bmName:''}`}>
            <div style={{ padding: '8px 16px 0', display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-muted)' }}>
              <span><span style={{ display:'inline-block',width:8,height:8,borderRadius:1,background:'#912F63',marginRight:3,verticalAlign:'middle' }} />Fund</span>
              {bmName && <span><span style={{ display:'inline-block',width:8,height:8,borderRadius:1,background:'#A795AE',marginRight:3,verticalAlign:'middle',opacity:.85 }} />{bmName}</span>}
            </div>
            <CYBarsChart fund={f} benchmark={benchmark} />
          </Card>
        )}

        {/* ⑤ RISK SECTION — data-driven, shows what's available */}

        {/* Equity risk metrics — only if equity risk data exists */}
        {hasEquityRisk && (
          <>
            <SecLabel extra={<span>{['1y','3y','5y'].map(periodBtn)}</span>}>Risk Analytics</SecLabel>

            {/* Up/Down capture — only if data exists */}
            {((rk('up_capture')!=null&&rk('up_capture')!=='-'&&parseFloat(rk('up_capture'))!==0) || (rk('down_capture')!=null&&rk('down_capture')!=='-'&&parseFloat(rk('down_capture'))!==0)) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                {[
                  { label:`Up capture (${period.toUpperCase()})`, val:rk('up_capture'), isUp:true,  desc:'Captures this % of benchmark upside. >100 = outperforms in rising markets.' },
                  { label:`Down capture (${period.toUpperCase()})`, val:rk('down_capture'), isUp:false, desc:'Suffers this % of benchmark decline. <100 = better protection in corrections.' },
                ].map(({ label, val, isUp, desc }) => {
                  const v = val!=null&&val!=='-' ? parseFloat(val) : null;
                  const good = v!=null&&(isUp?v>100:v<100);
                  const danger = v!=null&&(!isUp&&v>105||(isUp&&v<85));
                  const c = v==null?'var(--text-muted)':good?'#1A7A52':danger?'#912F63':'#7A5A10';
                  const bg = v==null?'var(--bg-secondary)':good?'rgba(26,122,82,.06)':danger?'rgba(145,47,99,.06)':'rgba(122,90,16,.06)';
                  return (
                    <div key={label} style={{ borderRadius: 10, padding: '12px 14px', textAlign: 'center', background: bg, border: `1px solid ${bg}` }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: c, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, lineHeight: 1, marginBottom: 3, letterSpacing: '-.02em', color: c }}>{v!=null?fmt(v):'—'}</div>
                      <div style={{ fontSize: 10, lineHeight: 1.45, color: c, opacity: .75 }}>{desc}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Risk gauges — only render gauges that have data */}
            {(() => {
              const gauges = [
                (rk('sharpe_ratio')!=null&&rk('sharpe_ratio')!=='-') && { label:`Sharpe (${period.toUpperCase()})`,  value:rk('sharpe_ratio'),  lo:0,  hi:2,   thresh:0.5, lowerBetter:false },
                (rk('sortino_ratio')!=null&&rk('sortino_ratio')!=='-') && { label:`Sortino (${period.toUpperCase()})`, value:rk('sortino_ratio'), lo:0,  hi:3,   thresh:0.8, lowerBetter:false },
                (rk('alpha')!=null&&rk('alpha')!=='-') && { label:`Alpha (${period.toUpperCase()})`,   value:rk('alpha'),         lo:-5, hi:10,  thresh:0,   lowerBetter:false },
                (rk('beta')!=null&&rk('beta')!=='-') && { label:`Beta (${period.toUpperCase()})`,    value:rk('beta'),          lo:0,  hi:1.5, thresh:1.1, lowerBetter:true  },
              ].filter(Boolean);
              if (!gauges.length) return null;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gauges.length},minmax(0,1fr))`, gap: 8, marginBottom: 14 }}>
                  {gauges.map(g => <RiskGauge key={g.label} label={g.label} value={g.value} lo={g.lo} hi={g.hi} thresh={g.thresh} lowerBetter={g.lowerBetter} />)}
                </div>
              );
            })()}
          </>
        )}

        {/* ⑥ RISK TABLE + PORTFOLIO */}
        <div style={{ display: 'grid', gridTemplateColumns: hasEquitySection ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 14 }}>
          {hasEquitySection && (
            <Card title="Equity risk metrics">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    {['Metric', `Fund (${period.toUpperCase()})`, bmName ? bmName.split(' ').slice(0,3).join(' ') : 'Benchmark', 'Signal'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h==='Metric'?'left':'right', fontSize: 10, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {riskRows.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Risk data not available for this date</td></tr>
                  ) : riskRows.map(row => (
                    <tr key={row.l} style={{ borderBottom: '1px solid var(--bg-secondary)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)' }}>{row.l}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{row.vf!=null&&row.vf!=='-'?row.fmt(row.vf):'—'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{row.vb!=null&&row.vb!=='-'?row.fmt(row.vb):'—'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{row.vf!=null&&row.vf!=='-'?row.sig(row.vf):'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card title="Portfolio composition">
            <div style={{ padding: 14 }}>
              {layoutMode === 'equity' ? (
                // Equity — market cap + asset allocation
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 10 }}>Market cap</div>
                    {(f.large_cap!=null&&f.large_cap!=='-')||(f.mid_cap!=null&&f.mid_cap!=='-')||(f.small_cap!=null&&f.small_cap!=='-') ? (<>
                      <BarRow name="Large cap" value={f.large_cap} color="#912F63" />
                      <BarRow name="Mid cap"   value={f.mid_cap}   color="#6D5479" />
                      <BarRow name="Small cap" value={f.small_cap} color="#C46985" />
                    </>) : <div style={{ color:'var(--text-muted)',fontSize:12 }}>{assetClass === 'Precious Metals' ? 'Data not applicable' : 'Data not available'}</div>}
                    {(f.pe_ratio!=null&&f.pe_ratio!=='-')||(f.pb_ratio!=null&&f.pb_ratio!=='-') ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--bg-secondary)' }}>
                        {f.pe_ratio!=null&&f.pe_ratio!=='-' && <div style={{ flex:1,textAlign:'center',padding:8,background:'var(--bg-secondary)',borderRadius:8 }}><div style={{ fontFamily:'var(--font-serif)',fontSize:18,fontWeight:600,color:'var(--brand-dark)' }}>{fmt(f.pe_ratio)}</div><div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>P/E ratio</div></div>}
                        {f.pb_ratio!=null&&f.pb_ratio!=='-' && <div style={{ flex:1,textAlign:'center',padding:8,background:'var(--bg-secondary)',borderRadius:8 }}><div style={{ fontFamily:'var(--font-serif)',fontSize:18,fontWeight:600,color:'var(--brand-dark)' }}>{fmt(f.pb_ratio)}</div><div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>P/B ratio</div></div>}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ background: 'var(--border)' }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 10 }}>Asset allocation</div>
                    {(f.equity_pct!=null&&f.equity_pct!=='-')||(f.bond_pct!=null&&f.bond_pct!=='-')||(f.cash_pct!=null&&f.cash_pct!=='-')||(f.other_pct!=null&&f.other_pct!=='-') ? (<>
                      <BarRow name="Equity" value={f.equity_pct} color="#3E3452" />
                      <BarRow name="Bonds"  value={f.bond_pct}   color="#A795AE" />
                      <BarRow name="Cash"   value={f.cash_pct}   color="#A2A0A0" />
                      {(f.other_pct != null && f.other_pct !== '-' && parseFloat(f.other_pct) > 0) && (
                        <BarRow name={assetClass === 'Precious Metals' ? 'Precious Metals' : 'Other'} value={f.other_pct} color="#D4AF37" />
                      )}
                    </>) : <div style={{ color:'var(--text-muted)',fontSize:12 }}>Data not available</div>}
                  </div>
                </div>
              ) : layoutMode === 'debt' ? (
                // Debt — asset allocation (credit quality lives in the Debt Parameters card above)
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 10 }}>Asset allocation</div>
                  <BarRow name="Equity" value={f.equity_pct} color="#3E3452" />
                  <BarRow name="Bonds"  value={f.bond_pct}   color="#A795AE" />
                  <BarRow name="Cash"   value={f.cash_pct}   color="#A2A0A0" />
                </div>
              ) : (
                // Hybrid — market cap + asset allocation (credit quality lives in the Debt Parameters card above)
                <div>
                  {(f.large_cap!=null&&f.large_cap!=='-')||(f.mid_cap!=null&&f.mid_cap!=='-') ? (<>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 8 }}>Market cap (equity portion)</div>
                    <BarRow name="Large cap" value={f.large_cap} color="#912F63" />
                    <BarRow name="Mid cap"   value={f.mid_cap}   color="#6D5479" />
                    <BarRow name="Small cap" value={f.small_cap} color="#C46985" />
                    <div style={{ height: 1, background: 'var(--bg-secondary)', margin: '12px 0' }} />
                  </>) : null}
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 8 }}>Asset allocation</div>
                  <BarRow name="Equity" value={f.equity_pct} color="#3E3452" />
                  <BarRow name="Bonds"  value={f.bond_pct}   color="#A795AE" />
                  <BarRow name="Cash"   value={f.cash_pct}   color="#A2A0A0" />
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ⑥b DEBT PORTFOLIO METRICS + COMPOSITION — hidden entirely when the fund has no debt data */}
        {hasDebtSection && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Card title="Debt portfolio metrics">
              <div style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
                  {[
                    { label: 'Avg Maturity',      value: f?.avg_maturity,      unit: ' yrs', desc: 'Weighted avg time to maturity of bonds' },
                    { label: 'Modified Duration', value: f?.modified_duration, unit: ' yrs', desc: 'Interest rate sensitivity — lower = less risk' },
                    { label: 'YTM',               value: f?.ytm,               unit: '%',    desc: 'Expected annual return if held to maturity' },
                  ].map(({ label, value, unit, desc }) => {
                    const hv = value != null && value !== '-' && !isNaN(parseFloat(value));
                    const v = hv ? parseFloat(value) : null;
                    return (
                      <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', textAlign: 'center', background: !hv ? 'var(--bg-secondary)' : '#fff' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: hv ? 'var(--brand-dark)' : 'var(--text-muted)', letterSpacing: '-.02em', lineHeight: 1, marginBottom: 4 }}>
                          {hv ? `${fmt(v)}${unit}` : '—'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{desc}</div>
                      </div>
                    );
                  })}
                </div>

                {!(f?.avg_maturity != null && f.avg_maturity !== '-') && !(f?.modified_duration != null && f.modified_duration !== '-') && !(f?.ytm != null && f.ytm !== '-') && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>Debt metrics not available for this fund</div>
                )}
              </div>
            </Card>

            <Card title="Debt portfolio composition">
              <div style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 10 }}>
                      Credit quality {layoutMode === 'hybrid' ? '(debt portion)' : ''}
                    </div>
                    {hasCreditData ? (<>
                      <BarRow name="AAA / Equiv" value={f.credit_aaa}     color="#1A7A52" />
                      <BarRow name="AA"          value={f.credit_aa}      color="#2E9E6E" />
                      <BarRow name="A"           value={f.credit_a}       color="#6D5479" />
                      <BarRow name="BBB"         value={f.credit_bbb}     color="#B46B10" />
                      <BarRow name="BB"          value={f.credit_bb}      color="#912F63" />
                      <BarRow name="B"           value={f.credit_b}       color="#C46985" />
                      <BarRow name="Below B"     value={f.credit_below_b} color="#7A2E4A" />
                      <BarRow name="Not Rated"   value={f.credit_nr}      color="#A2A0A0" />
                      {f.avg_credit_quality && f.avg_credit_quality !== '-' && (
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg credit quality</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-dark)' }}>{f.avg_credit_quality}</span>
                        </div>
                      )}
                    </>) : <div style={{ color:'var(--text-muted)',fontSize:12 }}>Data not available</div>}
                  </div>
                  <div style={{ background: 'var(--border)' }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 10 }}>
                      Sector breakdown {layoutMode === 'hybrid' ? '(debt portion)' : ''}
                    </div>
                    {hasSectorData ? (<>
                      <BarRow name="Government"           value={f.fi_sector_government} color="#3E3452" />
                      <BarRow name="Corporate"             value={f.fi_sector_corporate}  color="#912F63" />
                      <BarRow name="Cash & Equivalents"    value={f.fi_sector_cash_equiv} color="#A2A0A0" />
                      <BarRow name="Municipal"             value={f.fi_sector_municipal}  color="#6D5479" />
                      <BarRow name="Securitized"           value={f.fi_sector_securitized} color="#B46B10" />
                      <BarRow name="Derivative"            value={f.fi_sector_derivative} color="#C46985" />
                    </>) : <div style={{ color:'var(--text-muted)',fontSize:12 }}>Data not available</div>}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ⑥c TOP HOLDINGS + TOP SECTORS — from Morningstar holdings API */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <Card title="Top 10 holdings">
            <div style={{ padding: 14 }}>
              {holdingsLoading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Loading holdings...</div>
              ) : holdingsError || !holdingsData?.holdings?.length ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Holdings data not available for this fund</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '4px 8px 8px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>#</th>
                      <th style={{ padding: '4px 8px 8px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Holding</th>
                      <th style={{ padding: '4px 8px 8px', textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdingsData.holdings.slice(0, 10).map((h, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--bg-secondary)' }}>
                        <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                        <td style={{ padding: '7px 8px', fontWeight: 500 }}>{h.name || h.isin || '—'}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-dark)' }}>
                          {h.weighting != null ? `${h.weighting.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {holdingsData?.portfolio_date && !holdingsError && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, textAlign: 'right' }}>As of {holdingsData.portfolio_date}</div>
              )}
            </div>
          </Card>

          <Card title="Top 10 sectors">
            <div style={{ padding: 14 }}>
              {(() => {
                if (holdingsLoading) {
                  return <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Loading sectors...</div>;
                }
                const sb = holdingsData?.stats?.sector_breakdown;
                const SECTOR_LABELS = {
                  basic_materials: 'Basic Materials',
                  communication_services: 'Communication Services',
                  consumer_cyclical: 'Consumer Cyclical',
                  consumer_defensive: 'Consumer Defensive',
                  energy: 'Energy',
                  financial_services: 'Financial Services',
                  healthcare: 'Healthcare',
                  industrials: 'Industrials',
                  real_estate: 'Real Estate',
                  technology: 'Technology',
                  utilities: 'Utilities',
                };
                const SECTOR_COLORS = ['#912F63','#3E3452','#6D5479','#C46985','#A795AE','#B46B10','#1A7A52','#2E9E6E','#D97706','#A2A0A0','#7A2E4A'];
                const rows = sb
                  ? Object.entries(sb)
                      .filter(([, v]) => v != null && v !== '-' && parseFloat(v) > 0)
                      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))
                      .slice(0, 10)
                  : [];
                if (!rows.length) {
                  return <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Sector data not available for this fund</div>;
                }
                return (
                  <>
                    {rows.map(([key, v], i) => (
                      <BarRow key={key} name={SECTOR_LABELS[key] || key} value={v} color={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
                    ))}
                    {holdingsData?.stats?.portfolio_date && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, textAlign: 'right' }}>As of {holdingsData.stats.portfolio_date}</div>
                    )}
                  </>
                );
              })()}
            </div>
          </Card>
        </div>

        {/* ⑦ FUND INFO + COST */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Card title="Fund information">
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 0 }}>
                {[
                  ['Category',   f.category||'—', false],
                  ['ISIN',       f.isin||'—', true],
                  ['AMFI code',  f.amfi_code||'—', true],
                  ['NAV',        f.nav!=null&&f.nav!=='-'?'₹'+fmt(f.nav):'—', true],
                  ['Fund size',  fmtInr(f.fund_size), false],
                  ['52W High',   f.nav_52w_high!=null&&f.nav_52w_high!=='-'?'₹'+fmt(f.nav_52w_high):'—', true],
                  ['52W Low',    f.nav_52w_low!=null&&f.nav_52w_low!=='-'?'₹'+fmt(f.nav_52w_low):'—', true],
                  ['Inception',  f.inception_date&&f.inception_date!=='-'?f.inception_date:'—', false],
                  ['MS Category',f.morningstar_category||'—', false],
                ].map(([k, v, mono]) => (
                  <div key={k} style={{ padding: '8px 16px 8px 0', borderBottom: '1px solid var(--bg-secondary)' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{k}</div>
                    <div style={{ fontSize: mono?11:12, fontWeight: 500, color: 'var(--text-primary)', marginTop: 2, fontFamily: mono?'var(--font-mono)':'inherit' }}>{v}</div>
                  </div>
                ))}
              </div>
              {f.manager_name && f.manager_name !== '-' && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bg-secondary)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Fund Manager</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {f.manager_name.split(/[,;/]/).map(m=>m.trim()).filter(Boolean).map(m => (
                      <span key={m} style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-primary)' }}>{m}</span>
                    ))}
                  </div>
                </div>
              )}
              {f.exit_load && f.exit_load !== '-' && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bg-secondary)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Exit load</div>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6 }}>{f.exit_load}</div>
                </div>
              )}
            </div>
          </Card>

          <Card title="Cost &amp; rating">
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 10, borderBottom: '1px solid var(--bg-secondary)', marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', color: erColor }}>{erVal!=null?erVal+'%':'—'}</div>
                  <div style={{ fontSize: 10, color: erColor, marginTop: 2 }}>{erLabel}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Annual expense ratio</div>
                  <div style={{ height: 5, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: erVal!=null?`${Math.min(100,(erVal/2.5)*100).toFixed(1)}%`:'0%', background: erColor, borderRadius: 3 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)' }}><span>0%</span><span>1%</span><span>2.5%+</span></div>
                </div>
              </div>
              {f.morningstar_rating && f.morningstar_rating !== '-' && (
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--bg-secondary)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Morningstar rating</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 22, color: '#B46B10', letterSpacing: -1 }}>{stars(f.morningstar_rating)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.morningstar_rating}-star overall</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={handleAddToWatchlist} style={{ width: '100%', padding: 8, background: inWatchlist ? '#1A7A52' : 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                  {inWatchlist ? '★ Added to Watchlist' : '☆ Add to Watchlist'}
                </button>
                <button onClick={handleCompare} style={{ width: '100%', padding: 8, background: 'var(--brand-dark)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>Compare with peers ↗</button>
                <button onClick={() => navigate('/simulator')} style={{ width: '100%', padding: 8, background: '#fff', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>Run SIP simulation ↗</button>
              </div>
            </div>
          </Card>
        </div>

      </>}
    </div>
  );
}