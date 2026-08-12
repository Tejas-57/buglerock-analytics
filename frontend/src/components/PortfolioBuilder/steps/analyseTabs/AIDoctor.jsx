import React from 'react';

/**
 * AI Doctor — rules-based diagnostic scan over the current portfolio.
 * Runs 10 checks (Sharpe, Alpha, DownCapture, ExpenseRatio, Concentration,
 * FundCount, Overlap, StyleDrift, IPS, Volatility) and produces:
 *  - a 0–100 health score
 *  - 5 vital tiles (Returns / Cost / Concentration / Diversification / Compliance)
 *  - symptom cards (critical / warning / minor) with prescriptions
 *  - confirmed strengths grid
 *
 * All inputs come from what Analyse already computes — no backend call.
 */

// Standard cap-mix norms per category (LC / MC / SC as % of equity sleeve).
// Used only when the fund's disclosed cap mix drifts materially from its label.
const CATEGORY_CAP_NORMS = {
  'Large Cap':            { lc: 85, mc: 12, sc: 3 },
  'Large & Mid Cap':      { lc: 55, mc: 40, sc: 5 },
  'Flexi Cap':            { lc: 65, mc: 25, sc: 10 },
  'Multi Cap':            { lc: 45, mc: 30, sc: 25 },
  'Mid Cap':              { lc: 15, mc: 75, sc: 10 },
  'Small Cap':            { lc: 5,  mc: 15, sc: 80 },
  'Focused':              { lc: 60, mc: 25, sc: 15 },
  'ELSS':                 { lc: 60, mc: 25, sc: 15 },
  'Value':                { lc: 60, mc: 25, sc: 15 },
  'Contra':               { lc: 60, mc: 25, sc: 15 },
  'Dividend Yield':       { lc: 65, mc: 25, sc: 10 },
};

const f2 = (v) => v == null || isNaN(v) ? '—' : v.toFixed(2);
const fp = (v) => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

export default function AIDoctor({ B, funds, weights, snapshots = {}, ips, overlapData }) {
  const symptoms = [];
  const strengths = [];
  const addSym = (sev, title, desc, rx) => symptoms.push({ sev, title, desc, rx });
  const addStr = (title, desc) => strengths.push({ title, desc });

  // Vital status tracking
  let vitalReturns = 'ok', vitalCost = 'ok', vitalConcentration = 'ok',
      vitalDiversification = 'ok', vitalCompliance = 'ok';

  // ── 1. Risk-adjusted return ──
  if (B.sharpe_ratio_3y != null) {
    if (B.sharpe_ratio_3y < 0.4) {
      addSym('critical', 'Weak risk-adjusted returns',
        `Sharpe ratio of ${f2(B.sharpe_ratio_3y)} means the return earned isn't adequately compensating for the risk being taken.`,
        `Consider funds with a stronger risk-adjusted track record, or trim exposure to volatile holdings that aren't pulling their weight.`);
      vitalReturns = 'critical';
    } else if (B.sharpe_ratio_3y < 0.6) {
      addSym('warning', 'Middling risk-adjusted returns',
        `Sharpe ratio of ${f2(B.sharpe_ratio_3y)} is adequate but not strong — returns are only moderately compensating for risk.`,
        null);
      vitalReturns = 'warning';
    } else {
      addStr('Strong risk-adjusted returns',
        `Sharpe ratio of ${f2(B.sharpe_ratio_3y)} — the return being earned is genuinely compensating for the risk taken.`);
    }
  }

  // ── 2. Alpha ──
  if (B.alpha_3y != null) {
    if (B.alpha_3y < -1) {
      addSym('critical', 'Active fees not justified by performance',
        `Blended alpha of ${fp(B.alpha_3y)} — paying active-fund fees without active-fund outperformance to show for it.`,
        `Consider whether a lower-cost index or passive alternative would serve just as well, or replace the weakest-alpha holdings.`);
    } else if (B.alpha_3y < 0) {
      addSym('minor', 'Slight benchmark lag',
        `Blended alpha of ${fp(B.alpha_3y)} — marginally behind the benchmark after costs.`, null);
    } else {
      addStr('Outperforming the benchmark',
        `Blended alpha of ${fp(B.alpha_3y)} — genuine value being added beyond what the benchmark alone would deliver.`);
    }
  }

  // ── 3. Downside protection ──
  if (B.down_capture_3y != null) {
    if (B.down_capture_3y > 110) {
      addSym('critical', 'Amplifies market downturns',
        `Down-capture of ${f2(B.down_capture_3y)}% — this portfolio historically falls further than the market in a drawdown, not less.`,
        `Add a defensive, lower-beta, or debt/hybrid holding to cushion the next downturn.`);
    } else if (B.down_capture_3y > 100) {
      addSym('warning', 'Slightly amplifies downturns',
        `Down-capture of ${f2(B.down_capture_3y)}% — marginally more exposed to market falls than the benchmark.`, null);
    } else {
      addStr('Strong downside protection',
        `Down-capture of ${f2(B.down_capture_3y)}% — loses less than the market in a drawdown, a genuinely valuable trait most portfolios lack.`);
    }
  }

  // ── 4. Cost ──
  if (B.expense_ratio != null) {
    if (B.expense_ratio > 1.8) {
      addSym('warning', 'Elevated overall cost',
        `Blended expense ratio of ${f2(B.expense_ratio)}% is on the expensive side — costs compound against returns every single year regardless of performance.`,
        `Check whether Regular-plan holdings could be migrated to Direct, or whether a lower-cost fund exists in the same category.`);
      vitalCost = 'warning';
    } else if (B.expense_ratio <= 0.9) {
      addStr('Cost-efficient construction',
        `Blended expense ratio of just ${f2(B.expense_ratio)}% — more of the gross return reaches the client every year.`);
    }
  }

  // ── 5. Single-holding concentration ──
  let maxW = 0, maxFund = null;
  funds.forEach((f) => {
    const w = weights[f.isin] || 0;
    if (w > maxW) { maxW = w; maxFund = f; }
  });
  if (maxFund) {
    if (maxW > 50) {
      addSym('critical', 'Overconcentrated in one holding',
        `'${maxFund.name}' alone makes up ${maxW}% of the portfolio — that single manager's missteps carry an outsized impact.`,
        `Consider trimming this position and redistributing into other holdings to reduce single-fund risk.`);
      vitalConcentration = 'critical';
    } else if (maxW > 35) {
      addSym('warning', 'High single-holding weight',
        `'${maxFund.name}' makes up ${maxW}% of the portfolio — worth a deliberate decision, not an accident.`, null);
      vitalConcentration = 'warning';
    }
  }

  // ── 6. Fund count ──
  const n = funds.length;
  if (n < 3) {
    addSym('warning', 'Limited number of holdings',
      `Only ${n} fund${n > 1 ? 's' : ''} in the portfolio — a single manager's missteps have an outsized impact with so few names.`,
      `Consider adding 1–2 more funds from different categories or AMCs to spread manager risk.`);
    vitalDiversification = 'warning';
  } else if (n > 15) {
    addSym('minor', 'Possible overdiversification',
      `With ${n} holdings, additional funds are likely adding complexity and cost without meaningfully reducing risk.`,
      `Consider consolidating into fewer, higher-conviction positions.`);
  }

  // ── 7. Holdings overlap (real data from overlapData if available) ──
  if (overlapData?.pairwise_matrix) {
    const pairs = Object.values(overlapData.pairwise_matrix);
    if (pairs.length) {
      const highest = pairs.reduce((best, p) => p.overlap_pct > (best?.overlap_pct || 0) ? p : best, null);
      if (highest) {
        const f1 = funds.find((f) => f.isin === highest.fund_1_isin);
        const f2n = funds.find((f) => f.isin === highest.fund_2_isin);
        const f1Name = f1?.name || 'Fund A';
        const f2Name = f2n?.name || 'Fund B';
        if (highest.overlap_pct >= 25) {
          addSym('warning', 'Significant holdings overlap',
            `'${f1Name}' and '${f2Name}' share an estimated ${highest.overlap_pct.toFixed(0)}% of their top holdings — possibly paying two sets of fees for much the same bet.`,
            `Open the Overlap tab — consider replacing one of these with a fund that adds genuinely distinct exposure.`);
          if (vitalDiversification === 'ok') vitalDiversification = 'warning';
        } else {
          addStr('Genuine diversification across holdings',
            `Highest pairwise overlap between any two holdings is only ${highest.overlap_pct.toFixed(0)}% — each fund is contributing distinct exposure.`);
        }
      }
    }
  }

  // ── 8. Style drift ──
  let driftFund = null, driftDev = 0;
  funds.forEach((f) => {
    const snap = snapshots[f.isin];
    if (!snap) return;
    // Try to identify category from snapshot or fund label
    const cat = snap.sub_category || snap.subCategory || f.subCategory || f.sub || '';
    const norm = CATEGORY_CAP_NORMS[cat];
    if (!norm) return;
    const lc = parseFloat(snap.large_cap), mc = parseFloat(snap.mid_cap), sc = parseFloat(snap.small_cap);
    if (isNaN(lc) || isNaN(mc) || isNaN(sc)) return;
    const dev = Math.max(Math.abs(lc - norm.lc), Math.abs(mc - norm.mc), Math.abs(sc - norm.sc));
    if (dev > driftDev) { driftDev = dev; driftFund = { fund: f, cat }; }
  });
  if (driftFund && driftDev >= 20) {
    addSym('warning', 'Style drift detected',
      `'${driftFund.fund.name}' has drifted ${driftDev.toFixed(0)} percentage points from its ${driftFund.cat} category norm.`,
      `Open the Style & drift tab — confirm this fund still behaves the way its category label suggests.`);
  }

  // ── 9. IPS compliance ──
  const ipsIssues = [];
  if (ips) {
    const totalEq = (B.large_cap || 0) + (B.mid_cap || 0) + (B.small_cap || 0);
    // parse IPS constraints (accept both string/number)
    const nz = (v) => v != null && v !== '' && !isNaN(parseFloat(v)) ? parseFloat(v) : null;
    const eqMin = nz(ips.eqMin), eqMax = nz(ips.eqMax);
    const lcMax = nz(ips.lcMax), scMax = nz(ips.scMax);
    const maxfunds = nz(ips.maxFunds || ips.maxfunds);
    if (eqMin != null && totalEq < eqMin) ipsIssues.push(`Equity allocation (${totalEq.toFixed(0)}%) is below the IPS minimum of ${eqMin}%.`);
    if (eqMax != null && totalEq > eqMax) ipsIssues.push(`Equity allocation (${totalEq.toFixed(0)}%) exceeds the IPS maximum of ${eqMax}%.`);
    if (lcMax != null && B.large_cap > lcMax) ipsIssues.push(`Large cap (${B.large_cap.toFixed(0)}%) exceeds the IPS limit of ${lcMax}%.`);
    if (scMax != null && B.small_cap > scMax) ipsIssues.push(`Small cap (${B.small_cap.toFixed(0)}%) exceeds the IPS limit of ${scMax}%.`);
    if (maxfunds != null && n > maxfunds) ipsIssues.push(`Portfolio has ${n} funds, exceeding the IPS maximum of ${maxfunds}.`);
    if (ips.name || ips.goal) {
      if (ipsIssues.length) {
        addSym('critical', 'Outside agreed IPS constraints', ipsIssues.join(' '),
          `Rebalance to bring the portfolio back within the constraints agreed with ${ips.name || 'the client'}, or formally revise the IPS if circumstances have genuinely changed.`);
        vitalCompliance = 'critical';
      } else {
        addStr('Fully aligned with the IPS',
          `Every allocation constraint agreed with ${ips.name || 'the client'} is currently being met.`);
      }
    } else {
      vitalCompliance = 'unknown';
    }
  } else {
    vitalCompliance = 'unknown';
  }

  // ── 10. Volatility ──
  if (B.std_dev_3y != null && B.std_dev_3y >= 22) {
    addSym('warning', 'High volatility',
      `Annualised volatility of ${f2(B.std_dev_3y)}% is well above what a typical diversified equity portfolio carries.`,
      `Confirm this matches the client's stated risk tolerance and time horizon before proceeding.`);
  }

  // ── Overall health score ──
  const critCount = symptoms.filter((s) => s.sev === 'critical').length;
  const warnCount = symptoms.filter((s) => s.sev === 'warning').length;
  const minorCount = symptoms.filter((s) => s.sev === 'minor').length;
  const score = Math.max(0, Math.min(100, 100 - critCount * 22 - warnCount * 9 - minorCount * 3));
  const verdict =
    score >= 80 ? { l: 'Excellent health', c: 'var(--pos)', bg: 'var(--green-dim, #E6F4ED)' }
    : score >= 60 ? { l: 'Good health — minor issues', c: '#2D8A5F', bg: '#EDF6F0' }
    : score >= 40 ? { l: 'Needs attention', c: '#D97706', bg: '#FEF9EC' }
    : { l: 'Critical — review urgently', c: 'var(--neg)', bg: 'var(--red-dim, #FEE2E2)' };

  // Sort symptoms by severity
  const sevOrder = { critical: 0, warning: 1, minor: 2 };
  symptoms.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev]);

  return (
    <div>
      {/* ── Header banner ── */}
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-card) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        marginBottom: 18,
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 700, color: verdict.c, lineHeight: 1 }}>{score.toFixed(0)}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>out of 100</div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', marginBottom: 4 }}>Portfolio AI Doctor — Diagnosis</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: verdict.c }}>{verdict.l}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 6 }}>
            Scanned {n} holding{n > 1 ? 's' : ''} across risk, cost, diversification, style drift and IPS compliance. Found{' '}
            <strong style={{ color: 'var(--neg)' }}>{critCount} critical</strong>,{' '}
            <strong style={{ color: '#D97706' }}>{warnCount} warning</strong> and{' '}
            <strong style={{ color: 'var(--brand-dark)' }}>{minorCount} minor</strong>{' '}
            issue{(critCount + warnCount + minorCount) !== 1 ? 's' : ''}, alongside {strengths.length} confirmed strength{strengths.length !== 1 ? 's' : ''}.
          </div>
        </div>
      </div>

      {/* ── Vital tiles ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <VitalTile label="Returns" status={vitalReturns} />
        <VitalTile label="Cost" status={vitalCost} />
        <VitalTile label="Concentration" status={vitalConcentration} />
        <VitalTile label="Diversification" status={vitalDiversification} />
        <VitalTile label="Compliance" status={vitalCompliance} />
      </div>

      {/* ── Symptoms ── */}
      {symptoms.length > 0 ? (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', marginBottom: 8 }}>
            Symptoms detected ({symptoms.length})
          </div>
          {symptoms.map((s, i) => <SymptomCard key={i} s={s} />)}
        </>
      ) : (
        <div style={{
          borderLeft: '4px solid var(--pos)',
          background: 'var(--green-dim, #E6F4ED)',
          padding: '14px 18px',
          borderRadius: '0 var(--radius-md) var(--radius-md) 0',
          marginBottom: 18,
          fontSize: 12.5,
          color: 'var(--text-primary)',
        }}>
          ✓ No issues detected across any of the checks run — this portfolio is in excellent shape.
        </div>
      )}

      {/* ── Strengths ── */}
      {strengths.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-mid, #A795AE)', margin: '18px 0 8px' }}>
            Confirmed strengths ({strengths.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {strengths.map((s, i) => (
              <div key={i} style={{
                border: '1px solid var(--border)',
                borderLeft: '4px solid var(--pos)',
                borderRadius: '0 var(--radius-md) var(--radius-md) 0',
                padding: '10px 14px',
                background: 'var(--green-dim, #E6F4ED)33',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>✓ {s.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Footnote ── */}
      <div style={{
        marginTop: 20,
        fontSize: 10.5,
        color: 'var(--text-muted)',
        lineHeight: 1.6,
        borderTop: '1px solid var(--border)',
        paddingTop: 10,
      }}>
        This diagnosis is a rules-based scan of the current allocation — not a substitute for the detailed analytics in the other tabs, which remain the source of record. Re-run it any time the portfolio changes.
      </div>
    </div>
  );
}

// ══════════ Sub-components ══════════
function VitalTile({ label, status }) {
  const cfg =
    status === 'critical' ? { color: 'var(--neg)', text: '● Critical' }
    : status === 'warning' ? { color: '#D97706', text: '● Watch' }
    : status === 'unknown' ? { color: 'var(--text-muted)', text: '○ Not set' }
    : { color: 'var(--pos)', text: '● Healthy' };
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '9px 12px',
      textAlign: 'center',
      flex: 1,
      minWidth: 110,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: cfg.color }}>{cfg.text}</div>
    </div>
  );
}

function SymptomCard({ s }) {
  const style =
    s.sev === 'critical' ? { c: 'var(--neg)', bg: 'var(--red-dim, #FEE2E2)', lbl: 'CRITICAL' }
    : s.sev === 'warning' ? { c: '#D97706', bg: '#FEF9EC', lbl: 'WARNING' }
    : { c: 'var(--brand-dark)', bg: 'var(--bg-secondary)', lbl: 'MINOR' };
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${style.c}`,
      borderRadius: '0 var(--radius-md) var(--radius-md) 0',
      padding: '11px 15px',
      marginBottom: 9,
      background: style.bg + '22',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 8.5, fontWeight: 700, letterSpacing: '.05em',
          padding: '2px 8px', borderRadius: 9, background: style.c, color: '#fff',
        }}>{style.lbl}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{s.title}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{s.desc}</div>
      {s.rx && (
        <div style={{ fontSize: 11, color: 'var(--brand-dark)', lineHeight: 1.6, marginTop: 6 }}>
          <strong>🩺 Prescription:</strong> {s.rx}
        </div>
      )}
    </div>
  );
}