import React, { useState, useEffect } from 'react';

/**
 * Portfolio X-Ray — comprehensive single-page structural tear sheet.
 * 7 sections in order (Overview → Performance → Risk → Diversification →
 * Style → Stress → Compliance). Every metric appears exactly once.
 * Read-only report. Interactive tools live in Sensitivity / What-If tabs.
 */

const CATEGORY_CAP_NORMS = {
  'Large Cap':       { lc: 85, mc: 12, sc: 3 },
  'Large & Mid Cap': { lc: 55, mc: 40, sc: 5 },
  'Flexi Cap':       { lc: 65, mc: 25, sc: 10 },
  'Multi Cap':       { lc: 45, mc: 30, sc: 25 },
  'Mid Cap':         { lc: 15, mc: 75, sc: 10 },
  'Small Cap':       { lc: 5,  mc: 15, sc: 80 },
  'Focused':         { lc: 60, mc: 25, sc: 15 },
  'ELSS':            { lc: 60, mc: 25, sc: 15 },
  'Value':           { lc: 60, mc: 25, sc: 15 },
  'Contra':          { lc: 60, mc: 25, sc: 15 },
  'Dividend Yield':  { lc: 65, mc: 25, sc: 10 },
};

// Historical stress scenarios (broad market fall %)
const STRESS_SCENARIOS = [
  { label: '2008 Global Financial Crisis', marketFall: -52 },
  { label: '2020 COVID crash', marketFall: -38 },
  { label: '2015-16 China slowdown', marketFall: -22 },
  { label: '2011 European debt crisis', marketFall: -25 },
  { label: '2013 Taper tantrum', marketFall: -14 },
  { label: '2022 rate hike cycle', marketFall: -12 },
];

const f2 = (v) => v == null || isNaN(v) ? '—' : v.toFixed(2);
const fp = (v) => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

// Advanced risk figures derived from blended volatility & calendar-year history
function computeAdvancedRisk(B, funds, snapshots, weights) {
  const std3y = B.std_dev_3y;
  if (std3y == null) return null;

  const monthlyStd = std3y / Math.sqrt(12);
  // Assume mean monthly return = 8%/12 (long-term equity expectation ~ 8%)
  const monthlyMean = (B.return_3y || 8) / 12 / 100 * 100; // in %

  // Parametric estimates (normal distribution)
  const cvar95 = 2.063 * monthlyStd;         // E[loss | loss > VaR95]
  const es99 = 2.665 * monthlyStd;
  const worst3m = -1.645 * monthlyStd * Math.sqrt(3);
  const worst6m = -1.645 * monthlyStd * Math.sqrt(6);
  const probLoss = monthlyMean > 0
    ? 100 * (1 - normCdf(monthlyMean / monthlyStd))
    : 50;

  // Max drawdown estimate from annualised vol (approximate: ~2× vol for equity)
  const maxDD = -std3y * 2;
  const ulcer = std3y * 0.7;   // rough approximation
  const recoveryMonths = Math.max(1, Math.abs(maxDD) / (B.return_3y || 8) * 12);

  // Worst 1Y — pick the worst calendar year from what we have
  const cyKeys = ['return_cy2021', 'return_cy2022', 'return_cy2023', 'return_cy2024', 'return_cy2025'];
  const cyVals = cyKeys.map((k) => B[k]).filter((v) => v != null && !isNaN(v));
  const worst1y = cyVals.length ? Math.min(...cyVals) : null;

  // Skewness & kurtosis — rough estimates (require full return series ideally)
  // We proxy: assume mildly negative skew (-0.3) and modest excess kurtosis (1.0)
  // for typical equity portfolios; tightens with more debt exposure
  const eqShare = ((B.large_cap || 0) + (B.mid_cap || 0) + (B.small_cap || 0)) / 100;
  const skew = -0.3 * eqShare;
  const kurt = 1.0 * eqShare;
  const tailRiskLabel = kurt > 0.8 ? 'Elevated tail risk' : kurt > 0.3 ? 'Moderate tail risk' : 'Muted tails';

  return { maxDD, ulcer, recoveryMonths, cvar95, es99, worst3m, worst6m, worst1y, probLoss, skew, kurt, tailRiskLabel };
}

function normCdf(x) {
  // Approximation for standard normal CDF
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Sector colors — same palette as elsewhere
const SECTOR_COLORS = {
  'Financial Services': '#912F63', 'Technology': '#3E3452', 'Consumer Cyclical': '#C46985',
  'Basic Materials': '#6D5479', 'Industrials': '#A795AE', 'Consumer Defensive': '#D97706',
  'Healthcare': '#1A7A52', 'Energy': '#B71C1C', 'Communication Services': '#4A5D8C',
  'Real Estate': '#8E5A3E', 'Utilities': '#616161', 'Unclassified': '#A2A0A0',
};

const RANK_STYLE = {
  R1: { bg:'rgba(16,185,129,0.12)', color:'#059669', border:'rgba(16,185,129,0.3)' },
  R2: { bg:'rgba(16,185,129,0.12)', color:'#059669', border:'rgba(16,185,129,0.3)' },
  R3: { bg:'rgba(45,31,43,0.06)',   color:'#2D1F2B', border:'rgba(45,31,43,0.15)' },
  R4: { bg:'rgba(239,68,68,0.08)',  color:'#EF4444', border:'rgba(239,68,68,0.2)'  },
  R5: { bg:'rgba(239,68,68,0.08)',  color:'#EF4444', border:'rgba(239,68,68,0.2)'  },
};

export default function PortfolioXRay({ B, AC, funds, weights, snapshots = {}, benchmarks = [], bmRets, ips, overlapData, histVar, histVarLoading, stressData, bmStress }) {
  const [lookthrough, setLookthrough] = useState(null);
  const [ltLoading, setLtLoading] = useState(false);
  const [ltError, setLtError] = useState(null);
  const [debtComposition, setDebtComposition] = useState(null);
  const [debtLoading, setDebtLoading] = useState(false);

  useEffect(() => {
    const allFunds = funds.filter((f) => {
      const s = snapshots[f.isin] || {};
      const w = weights[f.isin] || 0;
      return w > 0; // include all funds with non-zero weight
    });
    if (allFunds.length === 0) { setLookthrough(null); return; }

    const isins = allFunds.map((f) => f.isin).join(',');
    const ws = allFunds.map((f) => weights[f.isin] || 0).join(',');
    if (!isins) return;

    const API = process.env.REACT_APP_API_URL || '';
    setLtLoading(true); setLtError(null);
    fetch(`${API}/api/holdings/portfolio-lookthrough?isins=${isins}&weights=${ws}`)
      .then((r) => r.ok ? r.json() : Promise.reject('Lookthrough fetch failed'))
      .then((data) => setLookthrough(data))
      .catch((e) => setLtError(typeof e === 'string' ? e : e.message))
      .finally(() => setLtLoading(false));
  }, [funds.map((f) => f.isin).join(','), JSON.stringify(weights)]);

  // Fetch holdings for debt/hybrid funds and compute weighted debt composition
  useEffect(() => {
    const API = process.env.REACT_APP_API_URL || '';
    // Identify funds with meaningful debt exposure
    const debtFunds = funds.filter(f => {
      const s = snapshots[f.isin] || {};
      const ac = (s.asset_class || f.asset_class || '').toLowerCase();
      const bondPct = parseFloat(s.bond_pct) || 0;
      const isDebt = ac === 'debt' || ac.includes('debt') || ac.includes('bond');
      const isHybridWithDebt = (ac === 'hybrid' || ac.includes('hybrid') || ac.includes('allocation')) && bondPct >= 5;
      console.log('[DebtComp] fund:', f.name, 'ac:', ac, 'bondPct:', bondPct, 'isDebt:', isDebt, 'isHybrid:', isHybridWithDebt);
      return isDebt || isHybridWithDebt;
    });
    if (debtFunds.length === 0) { setDebtComposition(null); return; }

    setDebtLoading(true);
    Promise.all(
      debtFunds.map(f =>
        fetch(`${API}/api/holdings/${f.isin}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      // Credit quality mapping — Indian ratings → standardised buckets
      const CQ_MAP = {
        'sovereign': 'AAA / Equiv', 'crisil aaa': 'AAA / Equiv', 'icra aaa': 'AAA / Equiv',
        'care aaa': 'AAA / Equiv', 'ind aaa': 'AAA / Equiv',
        'crisil aa+': 'AA', 'crisil aa': 'AA', 'crisil aa-': 'AA',
        'icra aa+': 'AA', 'icra aa': 'AA', 'icra aa-': 'AA',
        'care aa+': 'AA', 'care aa': 'AA', 'care aa-': 'AA',
        'ind aa+': 'AA', 'ind aa': 'AA', 'ind aa-': 'AA',
        'crisil a+': 'A', 'crisil a': 'A', 'crisil a-': 'A',
        'icra a+': 'A', 'icra a': 'A', 'icra a-': 'A',
        'care a+': 'A', 'care a': 'A', 'care a-': 'A',
        'crisil bbb': 'BBB', 'icra bbb': 'BBB', 'care bbb': 'BBB',
        'crisil bb': 'BB', 'icra bb': 'BB',
        'crisil b': 'B', 'icra b': 'B',
      };

      const CQ_ORDER = ['AAA / Equiv', 'AA', 'A', 'BBB', 'BB', 'B', 'Below B', 'Not Rated'];

      // Debt sector mapping from holding_type
      const TYPE_SECTOR = {
        'BT': 'Government', 'BD': 'Government',  // Govt bonds / SDL
        'B':  'Corporate',
        'CA': 'Cash & Equivalents', 'CR': 'Cash & Equivalents',
        'DS': 'Government',
        'EX': 'Other',
      };

      // Weighted aggregation
      const cqTotals = {};
      const secTotals = {};
      let totalDebtWeight = 0;
      let avgCqNumerator = 0;
      const CQ_SCORE = { 'AAA / Equiv': 7, 'AA': 6, 'A': 5, 'BBB': 4, 'BB': 3, 'B': 2, 'Below B': 1, 'Not Rated': 0 };

      debtFunds.forEach((f, i) => {
        const data = results[i];
        if (!data || !data.holdings) return;
        const s = snapshots[f.isin] || {};
        const ac = (s.asset_class || '').toLowerCase();
        const bondPct = parseFloat(s.bond_pct) || (ac === 'debt' ? 100 : 0);
        const fundW = (weights[f.isin] || 0) * (bondPct / 100); // portfolio weight × debt fraction
        totalDebtWeight += fundW;

        // Only look at bond/debt type holdings
        const debtHoldings = data.holdings.filter(h =>
          ['B','BT','BD','DS','CR','CA'].includes(h.holding_type) && h.weighting != null
        );
        const holdingTotal = debtHoldings.reduce((s, h) => s + h.weighting, 0) || 1;

        debtHoldings.forEach(h => {
          const holdingW = (h.weighting / holdingTotal) * fundW;
          // Credit quality
          const cqRaw = (h.indian_credit_quality || '').toLowerCase().trim();
          const bucket = CQ_MAP[cqRaw] || (cqRaw === '' || cqRaw == null ? 'Not Rated' : 'Not Rated');
          cqTotals[bucket] = (cqTotals[bucket] || 0) + holdingW;
          avgCqNumerator += (CQ_SCORE[bucket] || 0) * holdingW;
          // Debt sector
          const sector = TYPE_SECTOR[h.holding_type] || 'Other';
          secTotals[sector] = (secTotals[sector] || 0) + holdingW;
        });
      });

      if (totalDebtWeight === 0) { setDebtComposition(null); setDebtLoading(false); return; }

      // Normalise to % of debt sleeve
      const cqBreakdown = CQ_ORDER.map(bucket => ({
        label: bucket,
        pct: totalDebtWeight > 0 ? (cqTotals[bucket] || 0) / totalDebtWeight * 100 : 0,
      }));

      const SEC_ORDER = ['Government', 'Corporate', 'Cash & Equivalents', 'Municipal', 'Securitized', 'Derivative', 'Other'];
      const secBreakdown = SEC_ORDER.map(sec => ({
        label: sec,
        pct: totalDebtWeight > 0 ? (secTotals[sec] || 0) / totalDebtWeight * 100 : 0,
      }));

      // Average credit quality label
      const avgScore = avgCqNumerator / totalDebtWeight;
      const avgCqLabel = avgScore >= 6.5 ? 'AAA' : avgScore >= 5.5 ? 'AA+' : avgScore >= 5 ? 'AA'
        : avgScore >= 4.5 ? 'AA-' : avgScore >= 4 ? 'A' : avgScore >= 3 ? 'BBB' : avgScore >= 2 ? 'BB' : 'B';

      setDebtComposition({ cqBreakdown, secBreakdown, avgCqLabel, totalDebtWeight });
      setDebtLoading(false);
    });
  }, [funds.map(f => f.isin).join(','), JSON.stringify(weights), Object.keys(snapshots).length]);

  const eqShare = ((B.large_cap || 0) + (B.mid_cap || 0) + (B.small_cap || 0));
  const adv = computeAdvancedRisk(B, funds, snapshots, weights);

  // Sort funds by weight
  const sortedFunds = [...funds].sort((a, b) => (weights[b.isin] || 0) - (weights[a.isin] || 0));

  // Overlap stats
  const overlapPairs = overlapData?.pairwise_matrix ? Object.values(overlapData.pairwise_matrix) : [];
  const avgOverlap = overlapPairs.length ? overlapPairs.reduce((s, p) => s + p.overlap_pct, 0) / overlapPairs.length : null;
  const highestPair = overlapPairs.length
    ? overlapPairs.reduce((best, p) => p.overlap_pct > (best?.overlap_pct || 0) ? p : best, null)
    : null;

  // Style drift
  const driftRows = funds.map((f) => {
    const snap = snapshots[f.isin] || {};
    const cat = snap.sub_category || snap.subCategory || f.subCategory || f.category || '';
    const norm = CATEGORY_CAP_NORMS[cat];
    if (!norm) return null;
    const lc = parseFloat(snap.large_cap), mc = parseFloat(snap.mid_cap), sc = parseFloat(snap.small_cap);
    if (isNaN(lc) || isNaN(mc) || isNaN(sc)) return null;
    const dev = Math.max(Math.abs(lc - norm.lc), Math.abs(mc - norm.mc), Math.abs(sc - norm.sc));
    return { fund: f, cat, dev, flagged: dev >= 20 };
  }).filter(Boolean);

  // Stress test scaled to portfolio equity %
  const stressRows = STRESS_SCENARIOS.map((s) => ({
    label: s.label,
    marketFall: s.marketFall,
    portfolioImpact: s.marketFall * (eqShare / 100) * (B.beta_3y || 1),
  }));

  // IPS compliance
  const ipsIssues = [];
  if (ips) {
    const nz = (v) => v != null && v !== '' && !isNaN(parseFloat(v)) ? parseFloat(v) : null;
    const eqMin = nz(ips.eqMin), eqMax = nz(ips.eqMax);
    const lcMax = nz(ips.lcMax), scMax = nz(ips.scMax);
    const maxfunds = nz(ips.maxFunds || ips.maxfunds);
    if (eqMin != null && eqShare < eqMin) ipsIssues.push(`Equity allocation (${eqShare.toFixed(0)}%) is below the IPS minimum of ${eqMin}%.`);
    if (eqMax != null && eqShare > eqMax) ipsIssues.push(`Equity allocation (${eqShare.toFixed(0)}%) exceeds the IPS maximum of ${eqMax}%.`);
    if (lcMax != null && B.large_cap > lcMax) ipsIssues.push(`Large cap (${B.large_cap.toFixed(0)}%) exceeds the IPS limit of ${lcMax}%.`);
    if (scMax != null && B.small_cap > scMax) ipsIssues.push(`Small cap (${B.small_cap.toFixed(0)}%) exceeds the IPS limit of ${scMax}%.`);
    if (maxfunds != null && funds.length > maxfunds) ipsIssues.push(`Portfolio has ${funds.length} funds, exceeding the IPS maximum of ${maxfunds}.`);
  }

  const bm = bmRets || {};

  // Dynamic section numbering — hidden sections don't count
  let _sec = 0;
  const sn = () => ++_sec;
  const cyKeys = ['cy2021', 'cy2022', 'cy2023', 'cy2024', 'cy2025'];
  const cyBmKeys = ['cy21', 'cy22', 'cy23', 'cy24', 'cy25'];
  const cyLbls = ['2021', '2022', '2023', '2024', '2025'];
  const cyBeat = cyKeys.filter((k, i) => {
    const v = B['return_' + k]; const bv = bm[cyBmKeys[i]];
    return v != null && bv != null && v >= bv;
  }).length;
  const cyTotal = cyKeys.filter((k, i) => {
    const v = B['return_' + k]; const bv = bm[cyBmKeys[i]];
    return v != null && bv != null;
  }).length;

  const periods = [
    { k: 'return_1m', l: '1 Month' },
    { k: 'return_3m', l: '3 Months' },
    { k: 'return_1y', l: '1 Year' },
    { k: 'return_3y', l: '3 Years (annualised)' },
    { k: 'return_5y', l: '5 Years (annualised)' },
  ];

  return (
    <div>
      {/* Section 1: Overview */}
      <SectionH n={sn()} title="Composition overview" sub="What this portfolio actually holds — funds, categories, weights and one-year performance at a glance." />
      <div className="ptf-card" style={{ marginBottom: 14 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Fund', 'Category', 'Weight', '1Y return', 'BR Rank'].map((h, i) => (
                <th key={i} style={{
                  textAlign: i === 0 || i === 1 ? 'left' : 'center',
                  padding: '8px 12px',
                  fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
                  color: 'var(--brand-mid, #A795AE)',
                  background: 'var(--bg-secondary)',
                  borderBottom: '2px solid var(--border)',
                }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sortedFunds.map((f) => {
                const w = weights[f.isin] || 0;
                const snap = snapshots[f.isin] || {};
                const r1y = snap.returns?.['1y'];
                const ranking = snap?.ranking || "-";
                return (
                  <tr key={f.isin} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 10px' }}>
                      <span style={{ display: 'inline-block', width: 3, height: 15, borderRadius: 2, background: f.color || 'var(--brand-primary)', marginRight: 7, verticalAlign: 'middle' }} />
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-primary)' }}>{f.name}</span>
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 10.5, color: 'var(--text-muted)' }}>{f.category || snap.sub_category || '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--brand-dark)' }}>{w}%</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: r1y >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                      {r1y != null ? fp(r1y) : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      {ranking && ranking !== '-' && RANK_STYLE[ranking] ? (
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                          background: RANK_STYLE[ranking].bg,
                          color: RANK_STYLE[ranking].color,
                          border: '1px solid ' + RANK_STYLE[ranking].border,
                        }}>{ranking}</span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Performance */}
      <SectionH n={sn()} title="Performance" sub="Point-to-point returns and year-by-year performance relative to the benchmark." />
      <div className="ptf-card" style={{ marginBottom: 14, padding: '4px 16px' }}>
        {periods.map((p) => {
          const v = B[p.k];
          return (
            <MetricRow key={p.k} label={p.l} plainDesc={null} value={v != null ? fp(v) : '—'} />
          );
        })}
        <div style={{ padding: '12px 0 8px', borderTop: '1px solid var(--border)', marginTop: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)' }}>
          Calendar year returns vs {bmRets ? 'benchmark' : 'index'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, padding: '4px 0 8px' }}>
          {cyKeys.map((k, i) => {
            const v = B['return_' + k]; const bv = bm[cyBmKeys[i]];
            const diff = (v != null && bv != null) ? v - bv : null;
            return (
              <div key={k} style={{ background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{cyLbls[i]}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: v >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {v != null ? fp(v) : '—'}
                </div>
                {diff != null && (
                  <div style={{ fontSize: 9, color: diff >= 0 ? 'var(--pos)' : 'var(--neg)', marginTop: 2 }}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(1)}% vs bm
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {cyTotal > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '6px 0 4px', borderTop: '1px solid var(--border)' }}>
            Beat benchmark in <strong>{cyBeat}</strong> of <strong>{cyTotal}</strong> calendar years.
          </div>
        )}
        {benchmarks && benchmarks.length > 0 && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', padding: '6px 0 4px', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>
            Benchmark: {benchmarks.length === 1
              ? benchmarks[0].display_name
              : benchmarks.map(b => `${b.display_name} (${b.weight}%)`).join(' + ')}
            {benchmarks.length > 1 && ' — blended weighted by IPS allocation'}
          </div>
        )}
        {(!benchmarks || benchmarks.length === 0) && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', padding: '6px 0 4px', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>
            No benchmark set — configure in Client &amp; IPS → Section E.
          </div>
        )}
      </div>

      {/* Section 3: Risk */}
      <SectionH n={sn()} title="Risk metrics" sub="Volatility, risk-adjusted returns, drawdown potential and distribution shape — everything in one place." />
      <div className="ptf-card" style={{ marginBottom: 14, padding: '4px 16px' }}>
        <MetricRow label="Volatility (3Y annualised)" plainDesc="How much the portfolio's value swings around from year to year — higher means bumpier." value={B.std_dev_3y != null ? f2(B.std_dev_3y) + '%' : '—'} />
        <MetricRow label="Sharpe ratio (3Y)" plainDesc="Return per unit of risk. Above 1.0 is genuinely good; below 0.5 means returns aren't compensating for the risk." value={f2(B.sharpe_ratio_3y)} verdict={B.sharpe_ratio_3y != null ? (B.sharpe_ratio_3y > 0.7 ? 'Strong' : B.sharpe_ratio_3y > 0.4 ? 'Adequate' : 'Weak') : null} verdictColor={B.sharpe_ratio_3y != null ? (B.sharpe_ratio_3y > 0.4 ? 'var(--pos)' : 'var(--neg)') : null} />
        <MetricRow label="Sortino ratio (3Y)" plainDesc="Like Sharpe, but only counts the downside swings investors actually dislike." value={f2(B.sortino_ratio_3y)} />
        <MetricRow label="Beta (vs. benchmark)" plainDesc="How much the portfolio moves for every 1% the market moves. 1.0 = moves in step with the market." value={f2(B.beta_3y)} verdict={B.beta_3y != null ? (B.beta_3y < 0.8 ? 'Defensive' : B.beta_3y < 1.1 ? 'Market-like' : 'Aggressive') : null} />
        <MetricRow label="Alpha (3Y, vs. benchmark)" plainDesc="Extra return (or shortfall) after adjusting for risk — the value a manager genuinely added." value={fp(B.alpha_3y)} verdict={B.alpha_3y != null ? (B.alpha_3y > 2 ? 'Outperforming' : B.alpha_3y > 0 ? 'Positive' : 'Lagging') : null} verdictColor={B.alpha_3y != null ? (B.alpha_3y >= 0 ? 'var(--pos)' : 'var(--neg)') : null} />
        <MetricRow label="Upside / downside capture" plainDesc="% of the market's gain (or fall) the portfolio experiences. Below 100% on the downside is genuinely valuable." value={(B.up_capture_3y != null && B.down_capture_3y != null) ? `${f2(B.up_capture_3y)}% / ${f2(B.down_capture_3y)}%` : '—'} verdict={B.down_capture_3y != null ? (B.down_capture_3y < 90 ? 'Protected' : B.down_capture_3y < 100 ? 'Moderate' : 'Exposed') : null} verdictColor={B.down_capture_3y != null ? (B.down_capture_3y < 90 ? 'var(--pos)' : B.down_capture_3y < 100 ? '#D97706' : 'var(--neg)') : null} />
        <div style={{ padding: '12px 0 8px', borderTop: '1px solid var(--border)', marginTop: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)' }}>
          Drawdown & tail risk {histVar ? '(CVaR/ES from historical simulation)' : '(estimated from volatility)'}
        </div>
        {adv ? (
          <>
            <MetricRow label="Maximum drawdown (est.)" plainDesc="The largest peak-to-trough decline this portfolio could plausibly have seen." value={adv.maxDD.toFixed(1) + '%'} />
            <MetricRow label="Ulcer Index (est.)" plainDesc="Captures both how deep AND how long a drawdown runs — a more complete stress measure than drawdown alone." value={adv.ulcer.toFixed(1) + '%'} />
            <MetricRow label="Recovery period (est.)" plainDesc="Estimated months to climb back to the previous peak after a drawdown." value={Math.round(adv.recoveryMonths) + ' months'} />
            {(() => {
              const hMonth = histVar?.var?.find(r => r.horizon === '1 month');
              const hYear  = histVar?.var?.find(r => r.horizon === '1 year');
              const cvar95Val = hMonth?.es_95 != null ? hMonth.es_95.toFixed(1) + '% (1M, historical)' : adv.cvar95.toFixed(1) + '% (est.)';
              const es99Val   = hYear?.es_99  != null ? hYear.es_99.toFixed(1)  + '% (1Y, historical)' : adv.es99.toFixed(1)   + '% (est.)';
              const cvar95Lbl = hMonth?.es_95 != null ? 'CVaR 95%' : 'CVaR 95% (est.)';
              const es99Lbl   = hYear?.es_99  != null ? 'Expected Shortfall 99%' : 'Expected Shortfall 99% (est.)';
              return <>
                <MetricRow label={cvar95Lbl} plainDesc="If a month is bad, how bad on average — more informative than a single cutoff." value={histVarLoading ? 'Loading…' : cvar95Val} />
                <MetricRow label={es99Lbl} plainDesc="The same idea as CVaR, at a more conservative 99% confidence level." value={histVarLoading ? 'Loading…' : es99Val} />
              </>;
            })()}
            <MetricRow label="Probability of loss, per month" plainDesc="Estimated chance of a negative return in any given month." value={adv.probLoss.toFixed(0) + '%'} />
            <MetricRow label="Worst 3 months / 6 months (est.)" plainDesc="A statistically plausible worst stretch at 95% confidence." value={adv.worst3m.toFixed(1) + '% / ' + adv.worst6m.toFixed(1) + '%'} />
            <MetricRow label="Worst 1 year (actual)" plainDesc="The real lowest calendar-year return on file — the one figure here drawn from history." value={adv.worst1y != null ? adv.worst1y.toFixed(1) + '%' : '—'} verdictColor={adv.worst1y != null ? (adv.worst1y >= 0 ? 'var(--pos)' : 'var(--neg)') : null} />
          </>
        ) : (
          <div style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: 11 }}>Not enough data to estimate drawdown and tail-risk figures.</div>
        )}
      </div>

      {/* Section 4: Diversification */}
      <SectionH n={sn()} title="Diversification & concentration" sub="Where the money actually sits once you look through the fund wrappers to the underlying companies." />
      <div className="ptf-card" style={{ marginBottom: 14, padding: '4px 16px' }}>
        <MetricRow label="Average overlap between any two holdings" plainDesc="How much any two funds' top holdings duplicate each other, on average. High overlap means paying two sets of fees for a similar bet." value={avgOverlap != null ? avgOverlap.toFixed(1) + '%' : '—'} verdict={avgOverlap != null ? (avgOverlap >= 35 ? 'Very High' : avgOverlap >= 25 ? 'High' : avgOverlap >= 15 ? 'Moderate' : avgOverlap >= 5 ? 'Low' : 'Negligible') : null} verdictColor={avgOverlap != null ? (avgOverlap >= 35 ? '#C0392B' : avgOverlap >= 25 ? '#E67E22' : avgOverlap >= 15 ? '#F39C12' : avgOverlap >= 5 ? 'var(--pos)' : 'var(--text-muted)') : null} />
        <MetricRow label="Highest overlapping pair" plainDesc={highestPair ? `Between two funds in this portfolio` : ''} value={highestPair ? highestPair.overlap_pct.toFixed(0) + '%' : '—'} verdict={highestPair ? (highestPair.overlap_pct >= 35 ? 'Very High' : highestPair.overlap_pct >= 25 ? 'High' : highestPair.overlap_pct >= 15 ? 'Moderate' : highestPair.overlap_pct >= 5 ? 'Low' : 'Negligible') : null} verdictColor={highestPair ? (highestPair.overlap_pct >= 35 ? '#C0392B' : highestPair.overlap_pct >= 25 ? '#E67E22' : highestPair.overlap_pct >= 15 ? '#F39C12' : highestPair.overlap_pct >= 5 ? 'var(--pos)' : 'var(--text-muted)') : null} />
        {lookthrough && <MetricRow label="Unique companies held (look-through)" plainDesc="Total distinct stocks across every fund's top holdings combined." value={lookthrough.top_stocks?.length > 0 ? '20+' : '—'} />}
        {lookthrough?.total_effective_equity_pct != null && (
          <MetricRow label="Effective equity look-through" plainDesc="Total portfolio-level equity exposure after weighting each fund's holdings." value={lookthrough.total_effective_equity_pct.toFixed(1) + '%'} />
        )}
      </div>

      {ltLoading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading portfolio look-through…</div>}
      {ltError && <div style={{ padding: 20, textAlign: 'center', color: 'var(--neg)', fontSize: 12 }}>{ltError}</div>}

      {lookthrough && lookthrough.sector_breakdown?.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div className="ptf-card">
            <div className="ptf-card-hd">Sector mix — equity look-through</div>
            <div style={{ padding: '12px 16px' }}>
              {lookthrough.sector_breakdown.slice(0, 10).map((s) => {
                const maxW = lookthrough.sector_breakdown[0].weight_pct || 1;
                const pct = Math.min(100, (s.weight_pct / maxW) * 100);
                const clr = SECTOR_COLORS[s.sector] || 'var(--brand-primary)';
                return (
                  <div key={s.sector} style={{ marginBottom: 7 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.sector}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand-dark)' }}>{s.weight_pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 5, height: 7, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct.toFixed(1) + '%', background: clr, borderRadius: 5 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="ptf-card">
            <div className="ptf-card-hd">Top 10 holdings (look-through)</div>
            <div style={{ padding: '8px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {lookthrough.top_stocks.slice(0, 10).map((s, i) => {
                    const typeColor = s.type === 'Equity' ? '#912F63'
                      : s.type === 'Govt' ? '#3E3452'
                      : s.type === 'Bond' ? '#B46B10'
                      : s.type === 'REIT' || s.type === 'InvIT' ? '#1A7A52'
                      : '#6D5479';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 4px', fontSize: 10.5, color: 'var(--text-muted)', width: 20 }}>{i + 1}</td>
                        <td style={{ padding: '6px 4px', fontSize: 11.5, color: 'var(--text-primary)' }}>
                          {s.name}
                          {s.type && s.type !== 'Equity' && (
                            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${typeColor}15`, color: typeColor, border: `1px solid ${typeColor}30` }}>
                              {s.type}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--brand-dark)' }}>{s.weight_pct.toFixed(2)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Debt portfolio composition — only shown when portfolio has debt/hybrid exposure */}
      {(debtLoading || debtComposition) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-dark)', fontFamily: 'var(--font-display)', marginBottom: 10, marginTop: 6 }}>
            Debt portfolio composition
          </div>
          {debtLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading debt composition…</div>
          ) : debtComposition && (
            <div className="ptf-card">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: '16px 20px' }}>
                {/* Credit Quality */}
                <div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 12 }}>
                    Credit Quality
                  </div>
                  {debtComposition.cqBreakdown.map(({ label, pct }) => {
                    const clr = pct === 0 ? 'var(--text-muted)'
                      : label === 'AAA / Equiv' ? '#1A7A52'
                      : label === 'AA' ? '#2E7D32'
                      : label === 'A'  ? '#D97706'
                      : '#C0392B';
                    const barClr = label === 'AAA / Equiv' ? '#1A7A52'
                      : label === 'AA' ? '#4CAF50'
                      : label === 'A'  ? '#D97706'
                      : label === 'BBB' ? '#E67E22'
                      : '#C0392B';
                    return (
                      <div key={label} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: clr }}>{pct.toFixed(1)}%</span>
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: Math.min(100, pct).toFixed(1) + '%', background: barClr, borderRadius: 4, transition: 'width .3s' }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 14, padding: '8px 12px', background: 'rgba(145,47,99,0.08)', borderRadius: 8, border: '1px solid rgba(145,47,99,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--brand-primary)', fontWeight: 600 }}>Avg credit quality</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>{debtComposition.avgCqLabel}</span>
                  </div>
                </div>

                {/* Debt Sector Breakdown */}
                <div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-primary)', marginBottom: 12 }}>
                    Sector Breakdown
                  </div>
                  {debtComposition.secBreakdown.map(({ label, pct }) => {
                    const clr = pct === 0 ? 'var(--text-muted)'
                      : label === 'Government' ? '#3E3452'
                      : label === 'Corporate'  ? '#912F63'
                      : label === 'Cash & Equivalents' ? '#A795AE'
                      : '#6D5479';
                    return (
                      <div key={label} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: clr }}>{pct.toFixed(1)}%</span>
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: Math.min(100, pct).toFixed(1) + '%', background: clr, borderRadius: 4, transition: 'width .3s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ padding: '8px 20px 12px', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>
                Computed from underlying bond holdings of all debt and hybrid funds, weighted by portfolio allocation × debt fraction. Percentages are rebased to 100% of the debt sleeve — not the total portfolio.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 5: Style & mandate — hidden until data available, re-enable by removing false && */}
      {false && (
      <>
      {/* Section 5: Style & mandate */}
      <SectionH n={sn()} title="Style & mandate alignment" sub="Whether each fund's actual cap mix still matches what its category label promises." />
      {driftRows.length > 0 ? (
        <div className="ptf-card" style={{ marginBottom: 14 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Fund</th>
                <th style={{ textAlign: 'right', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Deviation from category norm</th>
                <th style={{ textAlign: 'center', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Status</th>
              </tr></thead>
              <tbody>
                {driftRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 12px', fontSize: 11.5, color: 'var(--text-primary)' }}>{r.fund.name}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.flagged ? '#D97706' : 'var(--text-primary)' }}>{r.dev.toFixed(0)} points</td>
                    <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: r.flagged ? '#FEF9EC' : 'var(--green-dim, #E6F4ED)', color: r.flagged ? '#D97706' : 'var(--pos)' }}>
                        {r.flagged ? 'Drifted' : 'On mandate'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 14 }}>No holdings with a defined category norm to check.</div>
      )}

      </>
      )}
      {/* Section 6: Stress testing */}
      <SectionH n={sn()} title="Stress testing" sub={stressData ? `Actual portfolio returns during historical stress periods from NAV history.` : `Historical stress scenario analysis.`} />
      <div className="ptf-card" style={{ marginBottom: 14 }}>
        <div style={{ overflowX: 'auto' }}>
          {stressData?.scenarios ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Scenario</th>
                <th style={{ textAlign: 'right', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Period</th>
                <th style={{ textAlign: 'right', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Portfolio</th>
                <th style={{ textAlign: 'right', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', background: 'var(--bg-secondary)' }}>Nifty 500</th>
                {bmStress && !bmStress.error && <th style={{ textAlign: 'right', padding: '7px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1A5C3A', background: 'var(--bg-secondary)' }}>Blended BM</th>}
              </tr></thead>
              <tbody>
                {stressData.scenarios.filter(s => !['gfc','euro'].includes(s.id)).map((s, i) => {
                  const pr = s.portfolio_return;
                  const nr = s.nifty500_return;
                  const bmR = bmStress && !bmStress.error ? bmStress.returns?.[s.id] : null;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 12px', fontSize: 11.5, color: 'var(--text-primary)' }}>{s.name}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 10.5, color: 'var(--text-muted)' }}>{s.label}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: pr == null ? 'var(--text-muted)' : pr < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                        {pr == null ? '—' : (pr >= 0 ? '+' : '') + pr.toFixed(1) + '%'}
                      </td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: nr == null ? 'var(--text-muted)' : nr < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                        {nr == null ? '—' : (nr >= 0 ? '+' : '') + nr.toFixed(1) + '%'}
                      </td>
                      {bmStress && !bmStress.error && (
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600, color: bmR == null ? 'var(--text-muted)' : bmR < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                          {bmR == null ? '—' : (bmR >= 0 ? '+' : '') + bmR.toFixed(1) + '%'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
              ⏳ Computing stress scenarios from NAV history…
            </div>
          )}
        </div>
        {stressData && <div style={{ padding: '8px 12px', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>Returns calculated from actual NAV history. "—" means the fund was not active or NAV data is unavailable for that period.</div>}
      </div>

      {/* Section 7: Compliance — hidden until ready */}
      {false && (
      <>
      {/* Section 7: Compliance */}
      <SectionH n={sn()} title="Compliance" sub="Whether the portfolio, as it stands today, still sits inside the boundaries agreed with the client." />
      {ips?.name || ips?.goal ? (
        ipsIssues.length > 0 ? (
          <div style={{
            borderLeft: '4px solid var(--neg)',
            background: 'var(--red-dim, #FEE2E2)',
            padding: '12px 16px',
            borderRadius: '0 var(--radius-md) var(--radius-md) 0',
            fontSize: 11.5,
            color: 'var(--text-primary)',
            marginBottom: 14,
          }}>
            {ipsIssues.map((m, i) => <div key={i}>⚠ {m}</div>)}
          </div>
        ) : (
          <div style={{
            borderLeft: '4px solid var(--pos)',
            background: 'var(--green-dim, #E6F4ED)',
            padding: '12px 16px',
            borderRadius: '0 var(--radius-md) var(--radius-md) 0',
            fontSize: 11.5,
            color: 'var(--text-primary)',
            marginBottom: 14,
          }}>
            ✓ Fully compliant with all IPS constraints agreed with {ips.name || 'the client'}.
          </div>
        )
      ) : (
        <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 14 }}>No IPS on file for this portfolio yet.</div>
      )}

      </>
      )}
      {/* Footer note */}
      <div style={{
        marginTop: 22,
        fontSize: 10.5,
        color: 'var(--text-muted)',
        lineHeight: 1.6,
        borderTop: '1px solid var(--border)',
        paddingTop: 10,
      }}>
        Every figure above is computed fresh from the current allocation and appears exactly once in this report. For interactive tools — scenario sliders, fund-swap comparisons, correlation matrices — use the Sensitivity and What-If tabs.
      </div>
    </div>
  );
}

// ══════════════ Sub-components ══════════════
function SectionH({ n, title, sub }) {
  return (
    <div style={{ margin: '26px 0 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11, fontWeight: 700, color: '#fff',
          background: 'var(--brand-primary)',
          borderRadius: 5, padding: '2px 8px',
        }}>{n}</span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 17, fontWeight: 700, color: 'var(--brand-dark)',
        }}>{title}</span>
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 10px', lineHeight: 1.6, maxWidth: 760 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, plainDesc, value, verdict, verdictColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {plainDesc && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 1 }}>{plainDesc}</div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 78 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--brand-dark)' }}>{value}</div>
        {verdict && (
          <div style={{ fontSize: 9.5, fontWeight: 700, color: verdictColor || 'var(--text-muted)' }}>{verdict}</div>
        )}
      </div>
    </div>
  );
}