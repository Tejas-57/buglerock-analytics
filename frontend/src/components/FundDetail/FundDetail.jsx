import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
  if (n >= 10000) return '₹' + (n / 100).toFixed(0) + ' Cr';
  if (n >= 1000) return '₹' + (n / 100).toFixed(1) + ' Cr';
  return '₹' + n.toFixed(0) + ' Cr';
}
function stars(n) {
  if (!n || n === '-') return null;
  const r = parseInt(n);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function ReturnPill({ period, value, highlight }) {
  const v = value != null && value !== '-' ? parseFloat(value) : null;
  return (
    <div style={{ border: `${highlight ? 1.5 : 1}px solid ${highlight ? 'var(--brand-primary)' : 'var(--border)'}`, borderRadius: 10, padding: '9px 8px', textAlign: 'center', background: highlight ? 'rgba(145,47,99,0.04)' : '#fff' }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{period}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, lineHeight: 1, letterSpacing: '-.02em', color: v != null ? col(v) : 'var(--text-muted)' }}>{v != null ? pct(v) : '—'}</div>
    </div>
  );
}

function NavSparkline({ nav, nav52hi, nav52lo }) {
  if (!nav || !nav52hi || !nav52lo || nav === '-' || nav52hi === '-' || nav52lo === '-') {
    return <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>52W data not available</div>;
  }
  const lo = parseFloat(nav52lo), hi = parseFloat(nav52hi), cur = parseFloat(nav);
  const rng = hi - lo;
  const pts = [];
  for (let i = 0; i <= 11; i++) {
    const prog = i / 11;
    const noise = (Math.sin(i * 1.7 + 2) * 0.15 + Math.sin(i * 0.9) * 0.1) * rng;
    pts.push(lo + (cur - lo) * prog + noise);
  }
  pts[pts.length - 1] = cur;
  const minP = Math.min(...pts) * 0.98, maxP = Math.max(...pts) * 1.02;
  const W = 320, H = 60;
  const toX = i => (i / (pts.length - 1)) * W;
  const toY = v => H - ((v - minP) / (maxP - minP)) * H;
  const pathD = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const areaD = pathD + ` L${W},${H} L0,${H} Z`;
  const chgPct = rng > 0 ? ((cur - lo) / lo * 100).toFixed(1) : '0.0';
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#912F63" stopOpacity=".18"/><stop offset="100%" stopColor="#912F63" stopOpacity="0"/></linearGradient></defs>
        <path d={areaD} fill="url(#sg)"/>
        <path d={pathD} fill="none" stroke="#912F63" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={toX(pts.length-1).toFixed(1)} cy={toY(cur).toFixed(1)} r="3.5" fill="#912F63" stroke="white" strokeWidth="1.5"/>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>
        <span>52W Low ₹{fmt(lo)}</span>
        <span style={{ color: parseFloat(chgPct) >= 0 ? '#1A7A52' : '#912F63', fontWeight: 600 }}>{parseFloat(chgPct) >= 0 ? '+' : ''}{chgPct}% from low</span>
        <span>52W High ₹{fmt(hi)}</span>
      </div>
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
  const CY_KEYS = ['cy2021','cy2022','cy2023','cy2024','cy2025'];
  const CY_YRS  = ['2021','2022','2023','2024','2025'];
  const r = fund?.returns || {};
  const br = benchmark?.returns || {};
  const fVals = CY_KEYS.map(k => { const v = r[`return_${k}`] || r[k]; return v != null && v !== '-' ? parseFloat(v) : null; });
  const bVals = CY_KEYS.map(k => { const v = br[`return_${k}`] || br[k]; return v != null && v !== '-' ? parseFloat(v) : null; });
  const allV = [...fVals, ...bVals].filter(v => v != null);
  if (!allV.length) return <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12 }}>Calendar year data not available</div>;
  const maxV = Math.max(...allV.map(Math.abs)) || 10;
  const CH = 130, ZH = 32, posH = CH - ZH;
  return (
    <div style={{ padding: '14px 14px 10px' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: CH, position: 'relative', paddingBottom: 4 }}>
        {CY_YRS.map((yr, i) => {
          const fv = fVals[i], bv = bVals[i];
          const diff = fv != null && bv != null ? (fv - bv).toFixed(1) : null;
          const fH = fv != null ? Math.max(3, Math.abs(fv) / maxV * posH) : 0;
          const bH = bv != null ? Math.max(3, Math.abs(bv) / maxV * posH) : 0;
          return (
            <div key={yr} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              {diff != null && <div style={{ fontSize: 8, fontWeight: 600, color: parseFloat(diff) >= 0 ? '#1A7A52' : '#912F63', marginBottom: 2, textAlign: 'center' }}>{parseFloat(diff) >= 0 ? '+' : ''}{diff}</div>}
              {fv != null && <div style={{ fontSize: 8, fontWeight: 600, color: '#912F63', marginBottom: 1 }}>{fv >= 0 ? '+' : ''}{fv.toFixed(1)}%</div>}
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', width: '100%' }}>
                {fv != null && <div style={{ flex: 1, height: fH, background: fv >= 0 ? '#912F63' : '#C46985', borderRadius: '2px 2px 0 0', minHeight: 3 }} />}
                {bv != null && <div style={{ flex: 1, height: bH, background: bv >= 0 ? '#A795AE' : '#D4C9DF', borderRadius: '2px 2px 0 0', minHeight: 3, opacity: 0.85 }} />}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>{yr}</div>
            </div>
          );
        })}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: ZH, height: 1, background: 'var(--border)' }} />
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
  const [period, setPeriod] = useState('3y');

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
    ['1 Month',  r['1m'],  null],
    ['3 Months', r['3m'],  null],
    ['6 Months', r['6m'],  null],
    ['1 Year',   r['1y'],  bmR['1y']],
    ['2 Year',   r['2y'],  null],
    ['3Y CAGR',  r['3y'],  bmR['3y']],
    ['5Y CAGR',  r['5y'],  bmR['5y']],
    ['7Y CAGR',  r['7y'],  null],
    ['10Y CAGR', r['10y'], null],
    ['YTD',      r['ytd'], null],
  ].filter(([, fv]) => fv != null && fv !== '-');

  const riskRows = [
    { l:'Std Dev',  v3:rk('std_dev'),      v1:rk1('std_dev'),      fmt:v=>fmt(v)+'%', sig:v=>parseFloat(v)<12?'Low vol':parseFloat(v)<18?'Moderate':'High vol' },
    { l:'Alpha',    v3:rk('alpha'),        v1:rk1('alpha'),        fmt:v=>pct(v),     sig:v=>parseFloat(v)>2?'Strong outperform':parseFloat(v)>0?'Positive':parseFloat(v)>-2?'Slight lag':'Underperform' },
    { l:'Beta',     v3:rk('beta'),         v1:rk1('beta'),         fmt:v=>fmt(v),     sig:v=>parseFloat(v)<0.8?'Defensive':parseFloat(v)<1.1?'Market-like':'Aggressive' },
    { l:'Sharpe',   v3:rk('sharpe_ratio'), v1:rk1('sharpe_ratio'), fmt:v=>fmt(v),     sig:v=>parseFloat(v)>0.8?'Strong':parseFloat(v)>0.5?'Adequate':'Weak' },
    { l:'Sortino',  v3:rk('sortino_ratio'),v1:rk1('sortino_ratio'),fmt:v=>fmt(v),     sig:v=>parseFloat(v)>1?'Good':parseFloat(v)>0.6?'Moderate':'Weak' },
    { l:'Up cap',   v3:rk('up_capture'),   v1:rk1('up_capture'),   fmt:v=>fmt(v)+'%', sig:v=>parseFloat(v)>100?'Beats mkt upside':'Lags upside' },
    { l:'Down cap', v3:rk('down_capture'), v1:rk1('down_capture'), fmt:v=>fmt(v)+'%', sig:v=>parseFloat(v)<90?'Protected':parseFloat(v)<100?'Moderate':'Poor protect' },
  ].filter(row => (row.v3!=null&&row.v3!=='-')||(row.v1!=null&&row.v1!=='-'));

  const nav52pct = f?.nav && f?.nav_52w_high && f?.nav_52w_low && f.nav!=='-' && f.nav_52w_high!=='-' && f.nav_52w_low!=='-'
    ? Math.min(100, Math.max(0, ((parseFloat(f.nav)-parseFloat(f.nav_52w_low))/(parseFloat(f.nav_52w_high)-parseFloat(f.nav_52w_low)))*100))
    : null;

  const erVal = f?.expense_ratio != null && f.expense_ratio !== '-' ? parseFloat(f.expense_ratio) : null;
  const erColor = erVal == null ? 'var(--text-muted)' : erVal <= 1.0 ? '#1A7A52' : erVal <= 1.5 ? '#7A5A10' : '#912F63';
  const erLabel = erVal == null ? '—' : erVal <= 0.5 ? 'Ultra-low cost' : erVal <= 1.0 ? 'Low cost' : erVal <= 1.5 ? 'Average' : erVal <= 2.0 ? 'Above average' : 'High cost';

  const periodBtn = (p) => (
    <button key={p} onClick={() => setPeriod(p)} style={{ marginLeft: 4, padding: '2px 8px', fontSize: 10, border: '1px solid', borderColor: period===p?'var(--brand-primary)':'var(--border)', borderRadius: 4, background: period===p?'var(--brand-primary)':'transparent', color: period===p?'#fff':'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>{p.toUpperCase()}</button>
  );

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── HERO ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 20 }}>
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
                {r['1d'] != null && r['1d'] !== '-' && <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3, color: col(r['1d']) }}>{parseFloat(r['1d'])>=0?'▲ +':'▼ '}{fmt(r['1d'])}% today</div>}
                {f.nav_date && f.nav_date !== '-' && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{f.nav_date}</div>}
              </>
            ) : null}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => navigate('/performance')} style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>Performance ↗</button>
              <button onClick={() => navigate('/peer-comparison')} style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--text-secondary)' }}>Compare peers ↗</button>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>₹{fmt(f.nav_52w_low)}</span>
            <div style={{ flex: 1, height: 5, background: 'var(--bg-secondary)', borderRadius: 3, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${nav52pct.toFixed(1)}%`, background: 'linear-gradient(to right,#C46985,#912F63)', borderRadius: 3 }} />
              <div style={{ position: 'absolute', top: -3, left: `${nav52pct.toFixed(1)}%`, width: 11, height: 11, borderRadius: '50%', background: 'var(--brand-dark)', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)', transform: 'translateX(-50%)' }} />
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>₹{fmt(f.nav_52w_high)}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>52-week range</span>
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
          {[['1M',r['1m']],['3M',r['3m']],['6M',r['6m']],['1Y',r['1y'],true],['YTD',r['ytd']],['3Y',r['3y']],['5Y',r['5y']],['10Y',r['10y']]].map(([p,v,hi]) => (
            <ReturnPill key={p} period={p} value={v} highlight={hi} />
          ))}
        </div>

        {/* ② NAV SPARKLINE */}
        <Card title="Historical NAV performance" subtitle="Indicative — based on 52W range">
          <div style={{ padding: '12px 14px 4px' }}>
            <NavSparkline nav={f.nav} nav52hi={f.nav_52w_high} nav52lo={f.nav_52w_low} />
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
        <Card title={`Calendar year returns${bmName?' vs '+bmName:''}`}>
          <div style={{ padding: '8px 16px 0', display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-muted)' }}>
            <span><span style={{ display:'inline-block',width:8,height:8,borderRadius:1,background:'#912F63',marginRight:3,verticalAlign:'middle' }} />Fund</span>
            {bmName && <span><span style={{ display:'inline-block',width:8,height:8,borderRadius:1,background:'#A795AE',marginRight:3,verticalAlign:'middle',opacity:.85 }} />{bmName}</span>}
          </div>
          <CYBarsChart fund={f} benchmark={benchmark} />
        </Card>

        {/* ⑤ RISK */}
        <SecLabel extra={<span>{['1y','3y','5y'].map(periodBtn)}</span>}>Risk analytics</SecLabel>

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
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, lineHeight: 1, marginBottom: 3, letterSpacing: '-.02em', color: c }}>{v!=null?fmt(v)+'%':'—'}</div>
                <div style={{ fontSize: 10, lineHeight: 1.45, color: c, opacity: .75 }}>{desc}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
          <RiskGauge label={`Sharpe (${period.toUpperCase()})`}  value={rk('sharpe_ratio')}  lo={0}  hi={2}   thresh={0.5} lowerBetter={false} />
          <RiskGauge label={`Sortino (${period.toUpperCase()})`} value={rk('sortino_ratio')} lo={0}  hi={3}   thresh={0.8} lowerBetter={false} />
          <RiskGauge label={`Alpha (${period.toUpperCase()})`}   value={rk('alpha')}          lo={-5} hi={10}  thresh={0}   lowerBetter={false} />
          <RiskGauge label={`Beta (${period.toUpperCase()})`}    value={rk('beta')}           lo={0}  hi={1.5} thresh={1.1} lowerBetter={true}  />
        </div>

        {/* ⑥ RISK TABLE + PORTFOLIO */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <Card title="Risk metrics detail">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  {['Metric','3Y','1Y','Signal'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: h==='Metric'?'left':'right', fontSize: 10, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riskRows.length===0 ? (
                  <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Risk data not available</td></tr>
                ) : riskRows.map(row => (
                  <tr key={row.l} style={{ borderBottom: '1px solid var(--bg-secondary)' }}>
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)' }}>{row.l}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{row.v3!=null&&row.v3!=='-'?row.fmt(row.v3):'—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{row.v1!=null&&row.v1!=='-'?row.fmt(row.v1):'—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{row.v3!=null&&row.v3!=='-'?row.sig(row.v3):'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Portfolio composition">
            <div style={{ padding: 14 }}>
              {(f.large_cap!=null&&f.large_cap!=='-')||(f.mid_cap!=null&&f.mid_cap!=='-')||(f.small_cap!=null&&f.small_cap!=='-') ? (<>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 8 }}>Market cap split</div>
                <BarRow name="Large cap" value={f.large_cap} color="#912F63" />
                <BarRow name="Mid cap"   value={f.mid_cap}   color="#6D5479" />
                <BarRow name="Small cap" value={f.small_cap} color="#C46985" />
              </>) : null}
              {(f.equity_pct!=null&&f.equity_pct!=='-')||(f.bond_pct!=null&&f.bond_pct!=='-')||(f.cash_pct!=null&&f.cash_pct!=='-') ? (<>
                <div style={{ height: 1, background: 'var(--bg-secondary)', margin: '10px 0' }} />
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 8 }}>Asset allocation</div>
                <BarRow name="Equity" value={f.equity_pct} color="#3E3452" />
                <BarRow name="Bonds"  value={f.bond_pct}   color="#A795AE" />
                <BarRow name="Cash"   value={f.cash_pct}   color="#A2A0A0" />
              </>) : null}
              {(f.pe_ratio!=null&&f.pe_ratio!=='-')||(f.pb_ratio!=null&&f.pb_ratio!=='-') ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bg-secondary)' }}>
                  {f.pe_ratio!=null&&f.pe_ratio!=='-' && <div style={{ flex:1,textAlign:'center',padding:8,background:'var(--bg-secondary)',borderRadius:8 }}><div style={{ fontFamily:'var(--font-serif)',fontSize:18,fontWeight:600,color:'var(--brand-dark)' }}>{fmt(f.pe_ratio)}</div><div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>P/E ratio</div></div>}
                  {f.pb_ratio!=null&&f.pb_ratio!=='-' && <div style={{ flex:1,textAlign:'center',padding:8,background:'var(--bg-secondary)',borderRadius:8 }}><div style={{ fontFamily:'var(--font-serif)',fontSize:18,fontWeight:600,color:'var(--brand-dark)' }}>{fmt(f.pb_ratio)}</div><div style={{ fontSize:10,color:'var(--text-muted)',marginTop:2 }}>P/B ratio</div></div>}
                </div>
              ) : null}
              {!f.large_cap&&!f.equity_pct && <div style={{ color:'var(--text-muted)',fontSize:12,padding:'8px 0' }}>Composition data not available</div>}
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
                <button onClick={() => navigate('/performance')} style={{ width: '100%', padding: 8, background: 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>View full performance ↗</button>
                <button onClick={() => navigate('/peer-comparison')} style={{ width: '100%', padding: 8, background: 'var(--brand-dark)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>Compare with peers ↗</button>
                <button onClick={() => navigate('/simulator')} style={{ width: '100%', padding: 8, background: '#fff', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>Run SIP simulation ↗</button>
              </div>
            </div>
          </Card>
        </div>

      </>}
    </div>
  );
}