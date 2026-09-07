// ══════════════════════════════════════════════════════════
// Retirement Planner — full report builder (returns HTML strings)
// Ported faithfully; colours use BugleRock brand hex values.
// ══════════════════════════════════════════════════════════

const BERRY = '#912F63', PLUM = '#3E3452', LAV = '#A795AE', MUT = '#6D5479';
const POS = '#1A7A52', NEG = '#B71C1C', WARN = '#D97706';
const GR10 = '#FAF7F9', GR20 = '#E8DDE5', GR30 = '#D4C4CE', GR60 = '#6D5479', GR80 = '#2D1F2B';

export function rtBuildFullSections(R) {
  const IN = R.IN;
  const CY = new Date().getFullYear();
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const vc = R.successRate >= 85 ? POS : R.successRate >= 65 ? WARN : NEG;
  const vbg = R.successRate >= 85 ? '#E6F4ED' : R.successRate >= 65 ? '#FEF9EC' : '#FEE2E2';
  const vt = R.successRate >= 85 ? 'On Track' : R.successRate >= 65 ? 'Needs Attention' : 'At Risk';
  const vm = R.successRate >= 85
    ? `The retirement plan succeeds in <strong>${R.successRate}%</strong> of ${R.NSIM} simulated market scenarios. The corpus sustainably supports the planned retirement lifestyle through age ${IN.lifeExp}. Maintain current SIP discipline and rebalance annually.`
    : R.successRate >= 65
      ? `The plan succeeds in <strong>${R.successRate}%</strong> of scenarios. While the median outlook is positive, tail risk is material. Refer to the sensitivity analysis for targeted interventions to raise the success rate above 85%.`
      : `The plan fails in <strong>${100 - R.successRate}%</strong> of scenarios${R.medianDepAge ? `, with the corpus typically depleting around age <strong>${R.medianDepAge}</strong>` : ''}. Immediate corrective action — higher SIP, delayed retirement, or reduced spending — is necessary.`;

  const fmtL = (v) => { if (v == null || isNaN(v)) return '—'; return Math.abs(v) >= 100 ? '₹' + (v / 100).toFixed(2) + ' Cr' : '₹' + v.toFixed(1) + ' L'; };
  const fmtK = (v) => {
    if (v == null || isNaN(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 10000000) return '₹' + (v / 10000000).toFixed(2) + ' Cr';
    if (abs >= 100000)   return '₹' + (v / 100000).toFixed(1) + ' L';
    if (abs >= 1000)     return '₹' + Math.round(v / 1000) + 'K';
    return '₹' + Math.round(v);
  };
  const td = (v, c, bold) => `<td style="padding:7px 12px;border-bottom:1px solid ${GR20};font-family:DM Mono,monospace;text-align:right;${bold ? 'font-weight:700;' : ''}${c ? 'color:' + c + ';' : ''}">${v}</td>`;
  const th = (v, align) => `<th style="padding:8px 12px;text-align:${align || 'right'};font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20};white-space:nowrap;background:${GR10}">${v}</th>`;
  const thc = (v, align) => `<th style="padding:5px 6px;text-align:${align || 'right'};font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20};white-space:nowrap;background:${GR10}">${v}</th>`;
  const secHd = (n, title, sub) =>
    `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">`
    + `<div style="background:${BERRY};color:#fff;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;flex-shrink:0">${n}</div>`
    + `<div><div style="font-family:Cormorant Garamond,serif;font-size:17px;font-weight:700;color:${PLUM}">${title}</div>`
    + (sub ? `<div style="font-size:11px;color:${GR60}">${sub}</div>` : '')
    + `</div></div>`;
  const card = (content) => `<div style="border:1px solid ${GR20};border-radius:12px;overflow:hidden">${content}</div>`;
  const cardHd = (t, right) =>
    `<div style="padding:9px 16px;background:${PLUM};color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between">`
    + `<span>${t}</span>${right ? `<span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:10px;opacity:.8">${right}</span>` : ''}</div>`;

  // ── CHART 1: Fan chart ──
  const W = 960, H = 400, PADL = 68, PADR = 20, PADT = 30, PADB = 44;
  const pW = W - PADL - PADR, pH = H - PADT - PADB;
  const maxV = Math.max.apply(null, R.P90) * 1.08 || 10;
  const fx = (y) => (PADL + (y / R.years) * pW).toFixed(1);
  const fy = (v) => (PADT + pH - (Math.max(v, 0) / maxV) * pH).toFixed(1);
  const band = (top, bot) => {
    let d = 'M' + fx(0) + ',' + fy(top[0]);
    for (let i = 1; i <= R.years; i++) d += ' L' + fx(i) + ',' + fy(top[i]);
    for (let j = R.years; j >= 0; j--) d += ' L' + fx(j) + ',' + fy(bot[j]);
    return d + ' Z';
  };
  const lpath = (arr) => {
    let d = 'M' + fx(0) + ',' + fy(arr[0]);
    for (let i = 1; i <= R.years; i++) d += ' L' + fx(i) + ',' + fy(arr[i]);
    return d;
  };
  let grid = '', vlines = '';
  for (let t = 0; t <= 5; t++) {
    const gv = maxV * t / 5, gy = fy(gv);
    grid += `<line x1="${PADL}" y1="${gy}" x2="${W - PADR}" y2="${gy}" stroke="${GR20}" stroke-width=".8"/>`
      + `<text x="${PADL - 6}" y="${+gy + 3.5}" text-anchor="end" font-size="9" fill="${LAV}" font-family="DM Mono,monospace">${gv >= 100 ? (gv / 100).toFixed(1) + 'Cr' : gv.toFixed(0) + 'L'}</text>`;
  }
  for (let yx = 0; yx <= R.years; yx += 5) {
    const xa = fx(yx);
    vlines += `<line x1="${xa}" y1="${PADT}" x2="${xa}" y2="${H - PADB}" stroke="${GR20}" stroke-width=".4"/>`
      + `<text x="${xa}" y="${H - PADB + 16}" text-anchor="middle" font-size="9" fill="${LAV}" font-family="DM Sans,sans-serif">${IN.age + yx}</text>`;
  }
  const retX = fx(R.yearsToRet);
  let goalMk = '';
  Object.keys(R.goalsByYear || {}).forEach((yr) => {
    const gxp = fx(+yr), gvp = R.P50[+yr];
    const gl = IN.goals.find((g) => g.age === (IN.age + (+yr))) || {};
    const goalLabel = gl.name || '';
    const glWords = goalLabel.split(' ');
    // Multi-line label: up to 2 lines of 2 words each
    const glLine1 = glWords.slice(0, 2).join(' ');
    const glLine2 = glWords.length > 2 ? glWords.slice(2).join(' ') : '';
    const glLines = glLine2 ? 2 : 1;
    const glTopY  = +fy(gvp) - 28 - (glLines > 1 ? 13 : 0);
    goalMk += `<line x1="${gxp}" y1="${fy(gvp)}" x2="${gxp}" y2="${+fy(gvp) - 20}" stroke="${WARN}" stroke-width="1.5"/>`
      + `<circle cx="${gxp}" cy="${+fy(gvp) - 23}" r="5" fill="${WARN}" stroke="white" stroke-width="1.5"/>`
      + (goalLabel ? `<text x="${gxp}" y="${glTopY}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${WARN}" font-family="DM Sans,sans-serif">${glLine1}</text>` : '')
      + (glLine2   ? `<text x="${gxp}" y="${glTopY + 13}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${WARN}" font-family="DM Sans,sans-serif">${glLine2}</text>` : '');
  });
  const areaD = lpath(R.P50) + ' L' + fx(R.years) + ',' + fy(0) + ' L' + fx(0) + ',' + fy(0) + ' Z';
  const fanSvg = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">`
    + `<defs><linearGradient id="fanarea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${BERRY}" stop-opacity=".12"/><stop offset="100%" stop-color="${BERRY}" stop-opacity="0"/></linearGradient></defs>`
    + grid + vlines
    + `<path d="${band(R.P90, R.P10)}" fill="${BERRY}" opacity=".06"/>`
    + `<path d="${band(R.P75, R.P25)}" fill="${BERRY}" opacity=".13"/>`
    + `<path d="${areaD}" fill="url(#fanarea)"/>`
    + `<path d="${lpath(R.P10)}" fill="none" stroke="${NEG}" stroke-width="1" stroke-dasharray="5 4" opacity=".5"/>`
    + `<path d="${lpath(R.P90)}" fill="none" stroke="${POS}" stroke-width="1" stroke-dasharray="5 4" opacity=".5"/>`
    + `<path d="${lpath(R.P75)}" fill="none" stroke="${BERRY}" stroke-width=".8" opacity=".3"/>`
    + `<path d="${lpath(R.P25)}" fill="none" stroke="${BERRY}" stroke-width=".8" opacity=".3"/>`
    + `<path d="${lpath(R.P50)}" fill="none" stroke="${BERRY}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<line x1="${retX}" y1="${PADT}" x2="${retX}" y2="${H - PADB}" stroke="${PLUM}" stroke-width="1.5" stroke-dasharray="7 4"/>`
    + `<rect x="${+retX - 56}" y="${PADT - 24}" width="112" height="19" rx="4" fill="${PLUM}"/>`
    + `<text x="${retX}" y="${PADT - 10}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff" font-family="DM Sans,sans-serif">Retirement · age ${IN.retAge}</text>`
    + goalMk + `</svg>`;

  // ── CHART 2: SIP growth bars ──
  const milestones = [0, 5, 10, 15, Math.min(R.yearsToRet, 20), R.yearsToRet]
    .filter((v, i, a) => a.indexOf(v) === i && v <= R.years && v >= 0)
    .sort((a, b) => a - b);
  const sipMaxV = Math.max(...milestones.map(yr => R.P90[yr] || 0)) * 1.05 || 1;
  const growthSvg = `<div style="display:flex;align-items:flex-end;gap:16px;padding:12px 24px 0;height:200px;box-sizing:border-box">`
    + milestones.map((yr) => {
      const lbl = yr === 0 ? 'Now' : 'Age ' + (IN.age + yr);
      const h50 = Math.max(6, (R.P50[yr] / sipMaxV) * 160);
      const h90 = Math.max(6, (R.P90[yr] / sipMaxV) * 160);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">`
        + `<div style="width:100%;position:relative;display:flex;justify-content:center;align-items:flex-end;height:180px">`
        // Label positioned just above the P50 bar
        + `<div style="position:absolute;bottom:${h50.toFixed(0)}px;font-family:DM Mono,monospace;font-size:10.5px;font-weight:700;color:${BERRY};white-space:nowrap;padding-bottom:4px">${fmtL(R.P50[yr])}</div>`
        + `<div style="position:absolute;bottom:0;width:75%;height:${h90.toFixed(0)}px;background:${BERRY};opacity:.15;border-radius:4px 4px 0 0"></div>`
        + `<div style="position:absolute;bottom:0;width:55%;height:${h50.toFixed(0)}px;background:${BERRY};opacity:.75;border-radius:4px 4px 0 0"></div>`
        + `</div>`
        + `<div style="font-size:10px;color:${GR60};font-family:DM Sans,sans-serif;padding-top:6px;border-top:1px solid ${GR20};width:100%;text-align:center">${lbl}</div>`
        + `</div>`;
    }).join('')
    + `</div>`;

  // ── CHART 3: Income waterfall ──
  // Correct flow: lifestyle cost → less offsets → net need before tax → gross-up for tax → gross portfolio withdrawal
  const firstYr = R.yearsToRet;
  const baseNeed1 = R.annualExpToday * Math.pow(1 + IN.infl, firstYr) / 12 * 100000; // ₹/mo lifestyle at retirement
  const oi1      = (IN.otherIndexed ? R.otherIncToday * Math.pow(1 + IN.infl, firstYr) : R.otherIncToday) / 12 * 100000;
  const npsAnn1  = (R.npsAnnualAnnuity || 0) * 100000 / 12;
  const netBeforeTax1 = Math.max(0, baseNeed1 - oi1 - npsAnn1); // net need after offsets, before tax gross-up
  const taxGrossUp1   = IN.tax > 0 ? netBeforeTax1 * IN.tax / (1 - IN.tax) : 0; // additional amount needed to cover tax
  const grossWd1      = netBeforeTax1 + taxGrossUp1; // what actually comes out of the portfolio
  const srcItems = [
    { l: 'Living expenses at retirement',                        v: baseNeed1,      pos: false },
    ...(oi1      > 0 ? [{ l: 'Less: Pension / rental income',   v: oi1,            pos: true  }] : []),
    ...(npsAnn1  > 0 ? [{ l: 'Less: NPS annuity',               v: npsAnn1,        pos: true  }] : []),
    { l: 'Net need before tax',                                  v: netBeforeTax1,  pos: false, bold: true },
    ...(taxGrossUp1 > 0 ? [{ l: `Tax gross-up (${Math.round(IN.tax * 100)}% — amount withheld)`, v: taxGrossUp1, pos: false }] : []),
    { l: 'Gross portfolio withdrawal required',                  v: grossWd1,       pos: false, bold: true, hilite: true },
  ];

  // ── Percentile table ──
  const keyAges = [IN.retAge, Math.min(IN.retAge + 5, IN.lifeExp), Math.min(IN.retAge + 10, IN.lifeExp),
    Math.min(IN.retAge + 15, IN.lifeExp), Math.min(IN.retAge + 20, IN.lifeExp), IN.lifeExp]
    .filter((v, i, a) => v <= IN.lifeExp && a.indexOf(v) === i);
  const pctRows = keyAges.map((ka) => {
    const yi = ka - IN.age;
    const p50 = R.P50[yi], p10 = R.P10[yi];
    const depleted = p10 <= 0;
    return `<tr>`
      + `<td style="padding:8px 12px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif;font-weight:500;color:${GR80}">`
      + `Age ${ka}${ka === IN.retAge ? ` <span style="background:${BERRY};color:#fff;font-size:8px;padding:1px 6px;border-radius:10px;font-family:DM Sans">Retirement</span>` : ka === IN.lifeExp ? ` <span style="background:${MUT};color:#fff;font-size:8px;padding:1px 6px;border-radius:10px;font-family:DM Sans">Plan end</span>` : ''}</td>`
      + td(CY + (ka - IN.age), '', '')
      + td(fmtL(R.P10[yi]), NEG)
      + td(fmtL(R.P25[yi]), '')
      + td(fmtL(p50), BERRY, true)
      + td(fmtL(R.P75[yi]), '')
      + td(fmtL(R.P90[yi]), POS)
      + `</tr>`;
  }).join('');

  // ── Sensitivity bars ──
  // Short display labels for sensitivity bars (keep full labels for risk section)
  const sensShortLabels = {
    sip10k:         '+₹10k/mo SIP',
    sip25k:         '+₹25k/mo SIP',
    retLater:       'Retire 2 years later',
    retEarlier:     'Retire 2 years earlier',
    lowReturns:     'Returns −2% (pre & post-ret)',
    expenses20:     'Expenses +20%',
    sequenceRisk:   'Poor first 5 yrs — sequence risk',
    equityCrash:    `Equity crash at retirement (−${Math.round((IN.crashSeverity || 0.30) * 100)}% yr 1)`,
    inflDecade:     'High inflation decade (+2%, 10 yrs)',
    stagflation:    'Stagflation (−2% return, +2% infl)',
    longevity:      'Extended horizon (+5 years)',
    flexWithdrawal: 'Flexible withdrawal (guardrail)',
  };
  const sensBars = R.sens.map((s) => {
    const c = s.sr >= 85 ? POS : s.sr >= 65 ? WARN : NEG;
    const bg = s.sr >= 85 ? '#E6F4ED' : s.sr >= 65 ? '#FEF9EC' : '#FEE2E2';
    const lbl = s.base ? 'Current plan' : (sensShortLabels[s.key] || s.label);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">`
      + `<div style="width:200px;font-size:11px;text-align:right;color:${s.base ? PLUM : GR60};font-weight:${s.base ? '700' : '400'};flex-shrink:0;line-height:1.3">${lbl}</div>`
      + `<div style="flex:1;height:20px;background:${GR10};border-radius:4px;overflow:hidden;position:relative">`
      + `<div style="width:${s.sr}%;height:100%;background:${c};opacity:${s.base ? '1' : '.75'}"></div>`
      + `<div style="position:absolute;left:85%;top:0;bottom:0;width:1.5px;background:${PLUM};opacity:.3"></div>`
      + `</div>`
      + `<div style="width:40px;font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:${c};text-align:right">${s.sr}%</div>`
      + `<div style="width:68px;font-size:10px;color:${c};background:${bg};padding:2px 6px;border-radius:20px;text-align:center;flex-shrink:0">${s.base ? 'Base plan' : s.sr > R.successRate ? '↑ +' + (s.sr - R.successRate) + 'pts' : s.sr < R.successRate ? '↓ ' + (s.sr - R.successRate) + 'pts' : '→ Same'}</div>`
      + `</div>`;
  }).join('');

  // ── Year-by-year cashflow ──
  // Smart cashflow formatter: handles L, Cr, negative values with sign prefix
  const fmtCF = (v, sign) => {
    if (!v || v === 0) return '—';
    const abs = Math.abs(v);
    let num, unit;
    if (abs >= 100)     { num = abs / 100; unit = ' Cr'; }
    else if (abs < 0.1) { num = abs * 100; unit = 'K';   }
    else                { num = abs;       unit = ' L';  }
    // Show decimals only if non-zero after rounding
    const rounded = Math.round(num * 100) / 100;
    const str = (rounded === Math.floor(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)) + unit;
    return (sign || '') + str;
  };

  let cfRows = '', sipA2 = IN.sipM * 12 / 100000, p10Depleted = false;

  const corpusLabel = IN.corpus0 > 0 ? `Today (${fmtCF(IN.corpus0)})` : 'Today';
  cfRows += `<tr style="background:${GR10}">`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:10px;font-weight:700">${IN.age}</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:10px">${CY}</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif;font-size:10px;font-weight:700;color:${PLUM}">${corpusLabel}</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${GR60}">—</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${GR60}">—</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${GR60}">—</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${GR60}">—</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${GR60}">—</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;font-weight:700;color:${BERRY}">${fmtCF(IN.corpus0)}</td>`
    + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${NEG}">${fmtCF(IN.corpus0)}</td>`
    + `</tr>`;
  for (let y = 1; y <= R.years; y++) {
    const ca = IN.age + y, isRet2 = ca > IN.retAge;
    const sipIn = (ca <= IN.sipTill && ca <= IN.retAge) ? sipA2 : 0;
    if (sipIn) sipA2 *= (1 + IN.stepUp);
    const epfIn = ca === IN.retAge ? R.epfAtRet + R.npsLump : 0;
    const li2 = (R.lumpsByYear || {})[y] || 0, gi2 = (R.goalsByYear || {})[y] || 0;
    const oneT2 = ca === IN.retAge && IN.oneTime ? IN.oneTime : 0;
    let wd2 = 0;
    if (isRet2) {
      const bn2 = R.annualExpToday * Math.pow(1 + IN.infl, y);
      const oi2 = IN.otherIndexed ? R.otherIncToday * Math.pow(1 + IN.infl, y) : R.otherIncToday;
      wd2 = Math.max(0, bn2 - oi2 - R.npsAnnualAnnuity || 0) / (1 - IN.tax);
    }
    const isRet1 = (ca === IN.retAge);
    const rowStyle = isRet1 ? 'background:#F7EEF3;' : ca % 5 === 0 ? 'background:' + GR10 + ';' : '';
    cfRows += `<tr style="${rowStyle}">`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:10px;font-weight:${isRet1 ? '700' : '400'}">${ca}${isRet1 ? ' ★' : ''}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:10px">${CY + y}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif;font-size:10px;color:${GR60}">${isRet2 ? 'Retirement' : 'Accumulation'}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${POS}">${sipIn ? fmtCF(sipIn, '+') : '—'}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${POS}">${epfIn ? fmtCF(epfIn, '+') : '—'}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${POS}">${li2 ? fmtCF(li2, '+') : '—'}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${WARN}">${gi2 || oneT2 ? fmtCF(gi2 + oneT2, '−') : '—'}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${NEG}">${wd2 ? fmtCF(wd2, '−') : '—'}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;font-weight:${isRet1 ? '700' : '400'};color:${BERRY}">${fmtCF(R.P50[y])}</td>`
      + `<td style="padding:4px 6px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:10px;color:${NEG}">${(() => { if (p10Depleted) return '—'; if (R.P10[y] <= 0) { p10Depleted = true; return '—'; } return fmtCF(R.P10[y]); })()}</td>`
      + `</tr>`;
  }

  // ── Goals table ──
  const goalRows = IN.goals.filter((g) => g.amt > 0).map((g, i) => {
    const yr = g.age - IN.age, fv = g.amt * Math.pow(1 + IN.infl, yr);
    const p50AtGoal = R.P50[yr] || 0;
    const feasible = p50AtGoal > fv * 1.25;
    return `<tr>`
      + `<td style="padding:8px 12px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif">${g.name || 'Goal ' + (i + 1)}</td>`
      + td(g.age, '', '') + td(CY + yr, '', '') + td(fmtL(g.amt), '', '')
      + td(fmtL(fv), BERRY, true) + td(fmtL(p50AtGoal), feasible ? POS : NEG, false)
      + `<td style="padding:8px 12px;border-bottom:1px solid ${GR20};text-align:center">`
      + `<span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:20px;background:${feasible ? '#E6F4ED' : '#FEE2E2'};color:${feasible ? POS : NEG}">${feasible ? '✓ Feasible' : '⚠ At risk'}</span></td>`
      + `</tr>`;
  }).join('');

  // ── IPS summary ──
  const ipsRows = [
    ['Investor', IN.name || '—'],
    ['Retirement age', IN.retAge + ' years'],
    ['Plan horizon', IN.lifeExp + ' years' + (IN.spouse ? ' · Spouse ' + IN.spouse : '')],
    ['Current corpus', fmtL(IN.corpus0)],
    ['Monthly SIP', '₹' + IN.sipM.toLocaleString('en-IN') + ' · step-up ' + Math.round(IN.stepUp * 100) + '%/yr till age ' + IN.sipTill],
    ['EPF/PPF corpus', fmtL(IN.epf) + ' · ₹' + IN.epfM.toLocaleString('en-IN') + '/mo @ ' + (IN.epfR * 100).toFixed(1) + '%'],
    ['NPS corpus', fmtL(IN.nps) + ' · ₹' + IN.npsM.toLocaleString('en-IN') + '/mo @ ' + (IN.npsR * 100).toFixed(1) + '%'],
    ['NPS annuity rate', (IN.annRate * 100).toFixed(1) + '% on 40% of NPS corpus'],
    ['Monthly expenses', '₹' + IN.expM.toLocaleString('en-IN') + ' · replacement ratio ' + (IN.replace * 100).toFixed(0) + '%'],
    ['Other income', IN.otherIncM > 0 ? '₹' + IN.otherIncM.toLocaleString('en-IN') + '/mo (' + (IN.otherIndexed ? 'indexed' : 'fixed') + ')' : 'None'],
    ['Tax on withdrawals', (IN.tax * 100).toFixed(0) + '%'],
    ['Pre-ret return', (IN.preMu * 100).toFixed(1) + '% ± ' + (IN.preSig * 100).toFixed(0) + '% (volatility)'],
    ['Post-ret return', (IN.postMu * 100).toFixed(1) + '% ± ' + (IN.postSig * 100).toFixed(0) + '% (volatility)'],
    ...(IN.lateMu != null ? [['Late-ret return (75+)', (IN.lateMu * 100).toFixed(1) + '% ± ' + (IN.lateSig * 100).toFixed(0) + '% (glide path)']] : []),
    ['Inflation', (IN.infl * 100).toFixed(1) + '%' + (IN.inflUnc ? ' ± ' + (IN.inflUnc * 100).toFixed(1) + '% uncertainty per simulation' : '')],
    ...(IN.withdrawalStrategy === 'guardrail' ? [['Withdrawal strategy', `Guardrail — cut ${IN.guardrailCut}% if portfolio drops >${IN.guardrailTrigger}% below target`]] : [['Withdrawal strategy', 'Fixed real withdrawal']]),
    ['Simulations', R.NSIM + ' Monte Carlo paths'],
  ].map((r) =>
    `<tr><td style="padding:7px 14px;border-bottom:1px solid ${GR20};font-size:11.5px;font-weight:500;color:${GR80};width:200px">${r[0]}</td>`
    + `<td style="padding:7px 14px;border-bottom:1px solid ${GR20};font-size:11.5px;color:${GR60}">${r[1]}</td></tr>`).join('');

  // ── Bug fixes: correct field names ──
  // npsAnnuityIncome → npsAnnualAnnuity  |  planScore → score  |  lateRMu → lateMu

  // ── Plan score badge (exactly matches HTML reference) ──
  const score = R.score;
  const POS2 = '#1A7A52', NEG2 = '#B71C1C', WARN2 = '#D97706';
  let planScoreHtml = '';
  if (score) {
    const sc = score.composite;
    const scoreColor = sc >= 80 ? POS2 : sc >= 60 ? WARN2 : NEG2;
    const scoreVerdict = sc >= 80 ? 'Strong' : sc >= 60 ? 'Moderate' : 'Needs work';
    planScoreHtml = `<div class="rt-score-badge rt-fade-in">`
      + `<div><div class="rt-score-big" style="color:${scoreColor}">${sc}</div>`
      + `<div style="text-align:center;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${GR60}">/ 100</div>`
      + `<div style="text-align:center;margin-top:4px"><span class="rt-pill" style="background:${scoreColor}18;color:${scoreColor}">${scoreVerdict}</span></div></div>`
      + `<div style="flex:1;min-width:0">`
      + `<div class="rt-score-meta"><h4>Retirement Readiness Score — composite of 5 dimensions</h4></div>`
      + (score.components || []).map(c => {
          const cc = parseFloat(c.score) >= 80 ? POS2 : parseFloat(c.score) >= 60 ? WARN2 : NEG2;
          return `<div class="rt-score-row">`
            + `<div class="rt-score-lbl">${c.label}</div>`
            + `<div class="rt-score-wt">${c.weight}</div>`
            + `<div class="rt-score-bar"><div class="rt-score-fill" style="width:${c.score}%;background:${cc}"></div></div>`
            + `<div class="rt-score-num" style="color:${cc}">${c.score}</div>`
            + `</div>`;
        }).join('')
      + `<div style="font-size:9px;color:${GR60};margin-top:6px">Score = Funding probability (35%) + Corpus buffer (25%) + Downside resilience (20%) + Goal coverage (12%) + Healthcare resilience (8%). BugleRock house methodology.</div>`
      + `</div></div>`;
  }

  // ── Hero card (exactly matches HTML reference) ──
  const conf = R.successRate;
  const target = IN.targetConf || 85;
  const onTrack = conf >= target;
  const surplus = R.surplus || 0;
  const surplusColor = surplus >= 0 ? '#86efac' : '#fca5a5';
  const surplusLabel = surplus >= 0 ? 'Projected surplus' : 'Funding shortfall';
  const statusLabel = conf >= target ? 'ON TRACK' : conf >= 65 ? 'NEEDS ATTENTION' : 'AT RISK';
  const medianDepAge = R.medianDepAge;
  const coverageRatio = (R.reqCorpus || 0) > 0 ? (R.p50c / R.reqCorpus * 100) : null;
  const replacementRatio = (R.lifestyleAtRet || 0) > 0 ? (R.firstNeed / R.lifestyleAtRet * 100) : null;
  const shortByLine = surplus >= 0
    ? `Your projected corpus is <strong>${fmtL(surplus)} above</strong> the recommended retirement buffer.`
    : `You are <strong>${fmtL(Math.abs(surplus))} short</strong> of the recommended retirement buffer.`;

  const reqSIP      = R.reqSIP;
  const altRetAge   = R.altRetAge;
  const altSpendPct = R.altSpendPct;

  const heroHtml = `<div class="rt-hero rt-fade-in"><div class="rt-hero-inner">`
    + `<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">`
      + `<div>`
        + `<div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:5px">Retirement readiness — ${IN.name || 'Client'}</div>`
        + `<div style="font-size:27px;font-weight:700;line-height:1.1">${statusLabel}</div>`
        + `<div style="font-size:13px;color:#fff;margin-top:8px;font-weight:600">${shortByLine}</div>`
        + `<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:5px">House planning threshold — not a guarantee</div>`
      + `</div>`
      + `<div style="text-align:right;flex-shrink:0">`
        + `<div style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:2px">Plan success probability</div>`
        + `<div style="font-family:'DM Mono',monospace;font-size:54px;font-weight:700;line-height:1;color:${onTrack ? '#4ade80' : '#f87171'}">${conf}<span style="font-size:22px">%</span></div>`
        + `<div style="font-size:9.5px;color:rgba(255,255,255,.45);margin-top:3px">Target ${target}% &nbsp;·&nbsp; Monte Carlo, ${IN.nSims} scenarios</div>`
      + `</div>`
    + `</div>`

    // 5-cell KPI strip
    + `<div class="rt-kpi-strip">`
    + [
        ['Corpus at retirement', fmtL(R.p50c),  'P50 median'],
        ['Required corpus',      fmtL(R.reqCorpus || R.corpusNeeded), 'To sustain plan'],
        [surplusLabel,           (surplus >= 0 ? '+' : '') + fmtL(surplus), 'At retirement (P50)'],
        ['Gross withdrawal / month',  fmtK(R.firstNeed ? (R.firstNeed * 100000 / 12) : (R.incomeAtRet || 0)), 'From portfolio (pre-tax)'],
        ['Plan to age',          String(IN.lifeExp), 'Retire at ' + IN.retAge],
      ].map((kp, i) => {
        const c2 = i === 2 ? surplusColor : 'rgba(255,255,255,.92)';
        return `<div class="rt-kpi-cell">`
          + `<div class="rt-kpi-val" style="color:${c2}">${kp[1]}</div>`
          + `<div class="rt-kpi-lbl">${kp[0]}</div>`
          + `<div class="rt-kpi-sub">${kp[2]}</div>`
          + `</div>`;
      }).join('')
    + `</div>`

    // "What needs to change?" decision table
    + `<div style="margin-top:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:10px;overflow:hidden">`
      + `<div style="padding:9px 15px;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.6);border-bottom:1px solid rgba(255,255,255,.12)">What needs to change?</div>`
      + `<table style="width:100%;border-collapse:collapse">`
        + `<thead><tr>`
          + `<th style="padding:7px 15px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.4)">Option</th>`
          + `<th style="padding:7px 15px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.4)">Change</th>`
          + `<th style="padding:7px 15px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.4)">Result</th>`
        + `</tr></thead><tbody>`
        + (reqSIP != null && reqSIP != null && reqSIP > IN.sipM
            ? `<tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:8px 15px;font-size:12px;color:#fff">Increase SIP</td><td style="padding:8px 15px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:#fff">+${fmtK(reqSIP - IN.sipM)}/mo</td><td style="padding:8px 15px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:#4ade80">${target}% confidence</td></tr>`
            : '')
        + (altRetAge && altRetAge !== IN.retAge
            ? `<tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:8px 15px;font-size:12px;color:#fff">Retire later</td><td style="padding:8px 15px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:#fff">+${altRetAge - IN.retAge} year(s)</td><td style="padding:8px 15px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:#4ade80">${target}% confidence</td></tr>`
            : '')
        + (altSpendPct && altSpendPct < 1
            ? `<tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:8px 15px;font-size:12px;color:#fff">Reduce retirement spending</td><td style="padding:8px 15px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:#fff">−${Math.round((1 - altSpendPct) * 100)}%</td><td style="padding:8px 15px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:#4ade80">${target}% confidence</td></tr>`
            : '')
        + (!(reqSIP != null && reqSIP != null && reqSIP > IN.sipM) && !(altRetAge && altRetAge !== IN.retAge) && !(altSpendPct && altSpendPct < 1)
            ? `<tr style="border-top:1px solid rgba(255,255,255,.1)"><td colspan="3" style="padding:8px 15px;font-size:12px;color:#4ade80;font-weight:600">No changes needed — plan already meets the ${target}% target</td></tr>`
            : '')
      + `</tbody></table>`
    + `</div>`

    // Secondary stat row: coverage ratio, depletion age, income replacement
    + `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(255,255,255,.12);border-radius:8px;overflow:hidden;margin-top:12px">`
      + `<div style="padding:10px 14px;background:rgba(0,0,0,.15)">`
        + `<div style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.5)">Median corpus ÷ required corpus</div>`
        + `<div style="font-family:'DM Mono',monospace;font-size:17px;font-weight:700;color:#fff;margin-top:3px">${coverageRatio != null ? coverageRatio.toFixed(0) + '%' : '—'}</div>`
        + `<div style="font-size:8.5px;color:rgba(255,255,255,.4);margin-top:2px">A corpus ratio — not the same as success probability</div>`
      + `</div>`
      + `<div style="padding:10px 14px;background:rgba(0,0,0,.15)">`
        + `<div style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.5)">If nothing changes, funds run out at</div>`
        + `<div style="font-family:'DM Mono',monospace;font-size:17px;font-weight:700;color:${medianDepAge ? '#fca5a5' : '#4ade80'};margin-top:3px">${medianDepAge ? 'Age ' + medianDepAge : 'No depletion in ' + conf + '% of scenarios'}</div>`
        + `<div style="font-size:8.5px;color:rgba(255,255,255,.4);margin-top:2px">Median across simulations that deplete</div>`
      + `</div>`
      + `<div style="padding:10px 14px;background:rgba(0,0,0,.15)">`
        + `<div style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.5)">Retirement income replacement</div>`
        + `<div style="font-family:'DM Mono',monospace;font-size:17px;font-weight:700;color:#fff;margin-top:3px">${replacementRatio != null ? replacementRatio.toFixed(0) + '%' : '—'}</div>`
        + `<div style="font-size:8.5px;color:rgba(255,255,255,.4);margin-top:2px">Net withdrawal ÷ lifestyle spending at retirement</div>`
      + `</div>`
    + `</div>`

    // Funding gap / buffer bar
    + `<div style="margin-top:8px;padding:11px 15px;background:rgba(0,0,0,.2);border-radius:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">`
      + `<div style="font-size:11px;color:rgba(255,255,255,.6)">Funding gap / buffer in today's ₹ — PV at ${Math.round((IN.preMu || IN.preret || 0.09) * 100)}% p.a.</div>`
      + `<div style="font-family:'DM Mono',monospace;font-size:17px;font-weight:700;color:${(R.fundingGapToday || 0) >= 0 ? '#86efac' : '#fca5a5'}">${(R.fundingGapToday || 0) >= 0 ? 'Buffer of ' + fmtL(Math.abs(R.fundingGapToday || 0)) : 'Gap of ' + fmtL(Math.abs(R.fundingGapToday || 0))}</div>`
    + `</div>`
  + `</div></div>`;

  // ── What could derail the plan? (risks from sensitivity) ──
  const sensDetailed = R.sensDetailed || [];
  const riskRows = [
    { label: `Equity crash at retirement (−${Math.round((IN.crashSeverity || 0.30) * 100)}% in year one, recovers after)`,          key: 'equityCrash' },
    { label: 'Low-return / high-inflation regime — stagflation (−2% returns, +2% inflation for entire retirement)',                   key: 'stagflation' },
    { label: 'Poor first 5 years of retirement — sequence risk (lower returns + higher swings early on)',                            key: 'sequenceRisk' },
    { label: 'Extended retirement horizon (+5 years)',               key: 'longevity' },
    { label: 'High inflation decade (+2% above expected, first 10 years of retirement only)',                                        key: 'inflDecade' },
  ].map(r => {
    const s = sensDetailed.find(x => x.key === r.key);
    return { label: r.label, impactPts: s ? -s.delta : 0 };
  }).filter(r => r.impactPts > 0).sort((a, b) => b.impactPts - a.impactPts);
  const maxRisk = riskRows.length ? riskRows[0].impactPts : 1;
  const biggestRisk = riskRows[0];

  const riskSectionHtml = riskRows.length ? (
    `<div class="rt-out-card rt-fade-in" style="margin-bottom:16px">`
    + `<div class="rt-out-hdr"><div class="rt-out-title" style="color:${NEG}">What could derail the plan?</div></div>`
    + `<div class="rt-out-body">`
    + riskRows.map(r => {
        const rel = r.impactPts / maxRisk;
        const lvl = rel >= 0.66 ? { c: NEG, t: 'High impact' } : rel >= 0.33 ? { c: WARN, t: 'Medium impact' } : { c: '#CA8A04', t: 'Low impact' };
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${GR10}">`
          + `<div style="width:8px;height:8px;border-radius:50%;background:${lvl.c};flex-shrink:0"></div>`
          + `<div style="flex:1;font-size:12px;color:${GR80}">${r.label}</div>`
          + `<div style="font-size:10px;font-weight:700;color:${lvl.c}">${lvl.t}</div>`
          + `<div style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:${lvl.c};width:44px;text-align:right">−${r.impactPts.toFixed(0)}pt</div>`
          + `</div>`;
      }).join('')
    + (biggestRisk ? `<div style="margin-top:10px;padding:9px 13px;background:${GR10};border-radius:8px;font-size:11px;color:${GR80}">Biggest sensitivity: <strong style="color:${PLUM}">${biggestRisk.label.toLowerCase()}</strong> — costs roughly ${biggestRisk.impactPts.toFixed(0)} confidence points if it occurs.</div>` : '')
    + `</div></div>`
  ) : '';

  // ── Phase split card ──
  const fmtMo = (lakhs) => '₹' + Math.round((lakhs * 100000) / 12).toLocaleString('en-IN') + '/mo';
  const fmtAbs = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
  const npsAnnuityMonthly = fmtAbs((R.npsAnnualAnnuity || 0) * 100000 / 12) + '/mo';

  const phaseSplitHtml = `<div class="rt-phase-grid rt-fade-in">`
    + `<div class="rt-phase-build">`
      + `<div class="rt-phase-label" style="color:${PLUM}">Phase 1 — Build wealth</div>`
      + `<div class="rt-phase-period">Age ${IN.age} to ${IN.retAge} (${IN.retAge - IN.age} years)</div>`
      + `<div class="rt-phase-grid2">`
      + [
          ['Current corpus', fmtL(IN.corpus0)],
          ['Monthly SIP', fmtAbs(IN.sipM) + '/mo'],
          ['Step-up', (IN.stepUp * 100).toFixed(0) + '% p.a.'],
          ['Pre-ret. return', (IN.preMu * 100).toFixed(1) + '%'],
        ].map(r => `<div><div class="rt-phase-item-lbl">${r[0]}</div><div class="rt-phase-item-val">${r[1]}</div></div>`).join('')
      + `</div>`
    + `</div>`
    + `<div class="rt-phase-divider">RETIRE AT ${IN.retAge}</div>`
    + `<div class="rt-phase-draw">`
      + `<div class="rt-phase-label" style="color:${BERRY}">Phase 2 — Fund retirement</div>`
      + `<div class="rt-phase-period">Age ${IN.retAge} to ${IN.lifeExp} (${IN.lifeExp - IN.retAge} years)</div>`
      + `<div class="rt-phase-grid2">`
      + [
          ['Gross withdrawal / month', fmtMo(R.firstNeed)],
          ['Post-ret. return', (IN.postMu * 100).toFixed(1) + '%'],
          ['NPS annuity', fmtAbs((R.npsAnnualAnnuity || 0) * 100000) + '/yr'],
          ['NPS monthly', npsAnnuityMonthly],
        ].map(r => `<div><div class="rt-phase-item-lbl">${r[0]}</div><div class="rt-phase-item-val">${r[1]}</div></div>`).join('')
      + `</div>`
    + `</div>`
  + `</div>`;

  // ── Retirement readiness bridge ──
  const goalsTotalFV = (R.goalsFV || []).reduce((s, g) => s + g.fv, 0);
  const bridgeSteps = [
    { label: "Today's corpus",      val: fmtL(IN.corpus0),                      color: PLUM },
    { label: 'SIP contributions',   val: '+' + fmtL(R.totalSIPContrib || 0),    color: MUT },
    { label: 'Market growth',       val: '+' + fmtL(R.marketGrowthEst || 0),    color: '#1558A8' },
    { label: 'EPF / PPF',           val: '+' + fmtL(R.epfAtRet || 0),           color: POS },
    { label: 'NPS 60% lump sum',    val: '+' + fmtL(R.npsLump || 0),            color: '#059669' },
    { label: 'Goals / withdrawals', val: goalsTotalFV > 0 ? '−' + fmtL(goalsTotalFV) : 'none', color: NEG },
    { label: 'Corpus at retirement',val: fmtL(R.p50c) + ' (P50)',               color: BERRY },
  ];

  const bridgeSectionHtml = `<div class="rt-out-card rt-fade-in" style="margin-bottom:16px">`
    + `<div class="rt-out-hdr"><div class="rt-out-title" style="color:${MUT}">Retirement readiness bridge — how the corpus is built</div></div>`
    + `<div class="rt-out-body">`
    + `<div class="rt-bridge-wrap" style="display:flex;align-items:center">`
    + bridgeSteps.map((s, i) =>
        `<div class="rt-bridge-node">`
        + `<div style="width:34px;height:34px;border-radius:50%;background:${s.color}14;border:1.5px solid ${s.color};margin:0 auto 6px;display:flex;align-items:center;justify-content:center">`
        + (i === 0 || i === bridgeSteps.length - 1
            ? `<div style="width:14px;height:14px;border-radius:50%;background:${s.color}"></div>`
            : `<div style="width:6px;height:6px;border-radius:50%;background:${s.color}"></div>`)
        + `</div>`
        + `<div style="font-size:8.5px;color:${GR80};font-weight:600;line-height:1.3">${s.label}</div>`
        + `<div style="font-size:8px;color:${s.color};font-weight:700;font-family:'DM Mono',monospace;margin-top:2px">${s.val}</div>`
        + `</div>`
        + (i < bridgeSteps.length - 1 ? `<div class="rt-bridge-sep">&middot;</div>` : '')
      ).join('')
    + `</div>`
    + `<div style="font-size:9px;color:${GR60};margin-top:10px;text-align:center">SIP contributions = total nominal cash invested over ${IN.retAge - IN.age} years (not compounded). Market growth = net compounding the portfolio earned on everything that stayed invested (P50 corpus minus direct contributions). Goals are shown as a separate outflow — the bridge nodes will not sum exactly to the P50 corpus because money withdrawn for goals also loses future compounding, which is captured in the simulation but not separately shown here.</div>`
    + `</div></div>`;

  // ── What should you do? ──
  const sipGap = reqSIP != null ? reqSIP - IN.sipM : 0;
  const whatToDoHtml = `<div class="rt-out-card rt-fade-in" style="margin-bottom:16px">`
    + `<div class="rt-out-hdr"><div class="rt-out-title" style="color:${BERRY}">What should you do? — path to ${target}% confidence</div></div>`
    + `<div class="rt-out-body">`
    + `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">`
    // Card 1 — SIP
    + `<div style="border-radius:10px;padding:16px;border-left:4px solid ${sipGap > 0 ? BERRY : POS};background:${sipGap > 0 ? '#fff0f5' : '#f0fdf4'}">`
    + `<div style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${sipGap > 0 ? BERRY : GR60};margin-bottom:8px">SIP adjustment</div>`
    + (sipGap > 0
      ? `<div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${PLUM};line-height:1">₹${Math.round(reqSIP).toLocaleString('en-IN')}/mo</div>`
        + `<div style="font-size:11px;color:${GR60};margin-top:6px">Additional investment required:</div>`
        + `<div style="font-size:12px;font-weight:700;color:${BERRY};margin-top:4px">+₹${Math.round(sipGap).toLocaleString('en-IN')}/month</div>`
        + `<div style="font-size:10px;color:${GR60};margin-top:3px">Current: ₹${Math.round(IN.sipM).toLocaleString('en-IN')}/mo</div>`
      : `<div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${POS};line-height:1">Sufficient</div>`
        + `<div style="font-size:11px;color:${GR60};margin-top:6px">₹${Math.round(IN.sipM).toLocaleString('en-IN')}/mo meets ${target}% target</div>`)
    + `</div>`
    // Card 2 — Retire later
    + `<div style="border-radius:10px;padding:16px;border-left:4px solid ${LAV};background:#f5f3ff">`
    + `<div style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${GR60};margin-bottom:8px">Alternatively — retire later</div>`
    + (altRetAge && altRetAge !== IN.retAge
      ? `<div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${PLUM};line-height:1">Age ${altRetAge}</div>`
        + `<div style="font-size:11px;color:${GR60};margin-top:6px">Retire ${altRetAge - IN.retAge} year(s) later than planned</div>`
        + `<div style="font-size:10px;color:${GR60};margin-top:3px">Current plan: retire at ${IN.retAge}</div>`
      : `<div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${POS};line-height:1">On schedule</div>`
        + `<div style="font-size:11px;color:${GR60};margin-top:6px">Retiring at ${IN.retAge} meets ${target}% target</div>`)
    + `</div>`
    // Card 3 — Reduce spending
    + `<div style="border-radius:10px;padding:16px;border-left:4px solid ${WARN};background:#fffbeb">`
    + `<div style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${GR60};margin-bottom:8px">Alternatively — reduce spending</div>`
    + (altSpendPct && altSpendPct < 1
      ? `<div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${PLUM};line-height:1">${Math.round(altSpendPct * 100)}% of today</div>`
        + `<div style="font-size:11px;color:${GR60};margin-top:6px">Reduce planned expenses by ${Math.round((1 - altSpendPct) * 100)}%</div>`
        + `<div style="font-size:10px;color:${WARN};margin-top:3px">Budget ₹${Math.round(IN.expM * altSpendPct).toLocaleString('en-IN')}/mo (today's ₹)</div>`
      : `<div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${POS};line-height:1">Sustainable</div>`
        + `<div style="font-size:11px;color:${GR60};margin-top:6px">Current spending level is supportable</div>`)
    + `</div>`
    + `</div>`
    // Plain English paragraph
    + `<div style="padding:13px 16px;background:${GR10};border-radius:8px;font-size:11.5px;color:${GR80};line-height:1.75">`
    + `<strong style="color:${PLUM}">What this means for you:</strong> `
    + (sipGap > 0
      ? `Your current SIP of ₹${Math.round(IN.sipM).toLocaleString('en-IN')}/month is projected to give a <strong>${R.successRate}%</strong> chance of sustaining your plan to age ${IN.lifeExp}. To reach the ${target}% planning threshold, increase your monthly investment by ₹${Math.round(sipGap).toLocaleString('en-IN')}. Working a few more years or trimming your retirement budget achieves a similar result — the cards above show each option precisely.`
      : `Your plan is on track. Your current SIP of ₹${Math.round(IN.sipM).toLocaleString('en-IN')}/month projects a <strong>${R.successRate}%</strong> probability of sustaining your income through age ${IN.lifeExp} — above the ${target}% planning threshold. Maintain your current contributions and review annually.`)
    + `</div>`
    + `</div></div>`;

  const sectionsHtml = planScoreHtml + heroHtml + riskSectionHtml + phaseSplitHtml + bridgeSectionHtml + whatToDoHtml + ''
    + `<section style="margin-bottom:32px">` + secHd('1', 'Corpus Projection Fan Chart', `Monte Carlo simulation · ${R.NSIM} scenarios · age ${IN.age} to ${IN.lifeExp}`)
    + card(cardHd('Projected retirement corpus — all scenarios', '━ Median &nbsp; ▒ 25–75th pct &nbsp; ░ 10–90th pct &nbsp; ● Goals')
      + `<div style="padding:20px">${fanSvg}</div>`
      + `<div style="padding:10px 20px 14px;display:flex;gap:20px;flex-wrap:wrap;font-size:11px;color:${GR60};border-top:1px solid ${GR20}">`
      + `<span><span style="display:inline-block;width:24px;height:3px;background:${BERRY};margin-right:5px;vertical-align:middle;border-radius:2px"></span>Median (P50)</span>`
      + `<span><span style="display:inline-block;width:16px;height:10px;background:${BERRY};opacity:.15;margin-right:5px;vertical-align:middle;border-radius:2px"></span>10th–90th pct</span>`
      + `<span><span style="display:inline-block;width:16px;height:10px;background:${BERRY};opacity:.3;margin-right:5px;vertical-align:middle;border-radius:2px"></span>25th–75th pct</span>`
      + `<span style="color:${NEG}">— P10 (worst 10%)</span><span style="color:${POS}">— P90 (best 10%)</span>`
      + `<span style="color:${WARN}">● Goals</span><span style="color:${PLUM}">┊ Retirement age</span></div>`)
    + `</section>`

    + `<section class="pg" style="margin-bottom:32px">` + secHd('2', 'Corpus Milestones', 'Median and range at key accumulation ages')
    + card(cardHd('Corpus growth milestones — median scenario') + `<div style="padding:0 8px 16px">${growthSvg}</div>`)
    + `</section>`

    + `<section class="pg" style="margin-bottom:32px">` + secHd('3', 'Corpus Percentile Analysis', 'Range of outcomes at key ages')
    + card(cardHd('Corpus (₹) at key ages — P10 to P90')
      + `<table style="width:100%;border-collapse:collapse"><thead><tr>${th('Age', 'left')}${th('Year')}${th('P10 (worst 10%)')}${th('P25')}${th('Median (P50)')}${th('P75')}${th('P90 (best 10%)')}</tr></thead>`
      + `<tbody>${pctRows}</tbody></table>`)
    + `</section>`

    + `<section style="margin-bottom:32px">` + secHd('4', 'Retirement Income Requirement', `Monthly cashflow at retirement — age ${IN.retAge}`)
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">`
    + card(cardHd('Monthly income waterfall — first year of retirement')
      + `<table style="width:100%;border-collapse:collapse"><tbody>`
      + srcItems.map((s) => {
        const bg = s.hilite ? 'background:' + PLUM + ';' : '';
        const fg = s.hilite ? 'color:#fff;' : s.pos ? 'color:' + POS + ';' : 'color:' + GR80 + ';';
        const lbl = s.hilite ? '<strong style="color:#fff">' + s.l + '</strong>' : (s.bold ? '<strong>' + s.l + '</strong>' : s.l);
        const prefix = s.pos ? '−' : '';
        return `<tr style="${bg}"><td style="padding:8px 14px;border-bottom:1px solid ${s.hilite ? 'rgba(255,255,255,.1)' : GR20};font-family:DM Sans,sans-serif;${s.hilite ? 'color:#fff;' : 'color:' + GR80 + ';'}">${lbl}</td>`
          + `<td style="padding:8px 14px;border-bottom:1px solid ${s.hilite ? 'rgba(255,255,255,.1)' : GR20};text-align:right;font-family:DM Mono,monospace;font-weight:${s.bold ? '700' : '400'};${fg}">${prefix}${fmtK(s.v)}/mo</td></tr>`;
      }).join('')
      + `</tbody></table>`
      + `<div style="padding:10px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">Based on ${Math.round(IN.replace * 100)}% replacement ratio. All figures at age ${IN.retAge}. Tax gross-up = extra amount portfolio releases so ${Math.round(IN.tax * 100)}% tax leaves the full spending need intact.</div>`)
    + card(cardHd(`Retirement corpus sources at age ${IN.retAge}`)
      + `<table style="width:100%;border-collapse:collapse"><tbody>`
      + [
        ['Investment corpus (P50)', fmtL(R.P50[R.yearsToRet]), BERRY, true],
        ['EPF/PPF corpus', fmtL(R.epfAtRet), POS, false],
        ['NPS lump sum (60%)', fmtL(R.npsLump), POS, false],
        ['Total retirement corpus', fmtL(R.P50[R.yearsToRet] + R.epfAtRet + R.npsLump), PLUM, true],
        ['Required corpus', fmtL(R.corpusNeeded), NEG, false],
        ['Surplus / (deficit)', fmtL(R.P50[R.yearsToRet] + R.epfAtRet + R.npsLump - R.corpusNeeded), R.P50[R.yearsToRet] + R.epfAtRet + R.npsLump >= R.corpusNeeded ? POS : NEG, true],
      ].map((r) =>
        `<tr><td style="padding:8px 14px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif;font-weight:${r[3] ? '700' : '400'};color:${GR80}">${r[0]}</td>`
        + `<td style="padding:8px 14px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-weight:${r[3] ? '700' : '400'};color:${r[2]}">${r[1]}</td></tr>`).join('')
      + `</tbody></table>`
      + `<div style="padding:10px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">NPS annuity (40% @ ${(IN.annRate * 100).toFixed(1)}%) generates ${fmtL(R.npsAnnualAnnuity || 0)}/yr fixed income. Shown separately as it is not part of the investable corpus.</div>`)
    + `</div></section>`

    + `<section class="pg" style="margin-bottom:32px">` + secHd('5', 'Sensitivity Analysis', 'What moves the needle — plan success rate under alternative assumptions')
    + card(cardHd('Success rate comparison', `Dashed line = ${IN.targetConf || 85}% threshold · ${R.NSIM} simulations per scenario`)
      + `<div style="padding:20px 24px">${sensBars}</div>`
      + `<div style="padding:10px 20px 14px;font-size:11px;color:${GR60};border-top:1px solid ${GR20};line-height:1.7">Each scenario changes one variable from the base plan and re-runs ${R.NSIM} Monte Carlo simulations. The ${IN.targetConf || 85}% threshold is BugleRock's house planning standard. Scenarios above the dashed line are considered robust.</div>`)
    + `</section>`

    + (R.score != null ? (() => {
      const ps = R.score;
      const psTotal = ps.composite;
      const psColor = psTotal >= 80 ? POS : psTotal >= 55 ? WARN : NEG;
      const psVerdict = psTotal >= 80 ? 'Excellent' : psTotal >= 65 ? 'Good' : psTotal >= 50 ? 'Fair' : 'Needs Work';
      const compColors = [BERRY, PLUM, MUT, WARN, POS];
      return `<section style="margin-bottom:32px">` + secHd('6', 'Plan Score', 'Composite health rating across dimensions')
        + card(cardHd('Retirement plan score — 100-point composite')
          + `<div style="display:grid;grid-template-columns:auto 1fr;gap:0">`
          + `<div style="padding:28px 32px;text-align:center;border-right:1px solid ${GR20};display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:160px">`
          + `<div style="font-family:Cormorant Garamond,serif;font-size:64px;font-weight:700;color:${psColor};line-height:1">${psTotal}</div>`
          + `<div style="font-size:11px;font-weight:700;color:${psColor};letter-spacing:.06em;text-transform:uppercase;margin-top:2px">${psVerdict}</div>`
          + `<div style="font-size:10px;color:${GR60};margin-top:6px">out of 100</div>`
          + `</div>`
          + `<div style="padding:20px 24px">`
          + (ps.components || []).map((c, ci) => {
              const col = compColors[ci % compColors.length];
              const pct = Math.min(100, Math.max(0, parseFloat(c.score)));
              return `<div style="margin-bottom:14px">`
                + `<div style="display:flex;justify-content:space-between;margin-bottom:5px">`
                + `<span style="font-size:11.5px;color:${GR80};font-weight:500">${c.label}</span>`
                + `<span style="font-family:DM Mono,monospace;font-size:12px;font-weight:700;color:${col}">${c.score} <span style="font-size:10px;color:${GR60}">${c.weight}</span></span>`
                + `</div>`
                + `<div style="height:8px;background:${GR20};border-radius:4px;overflow:hidden">`
                + `<div style="width:${pct.toFixed(1)}%;height:100%;background:${col};border-radius:4px;opacity:.85"></div>`
                + `</div></div>`;
            }).join('')
          + `</div></div>`)
        + `</section>`;
    })() : '')

    + (goalRows ?
      `<section style="margin-bottom:32px">` + secHd('7', 'Financial Goals', 'Future value and feasibility at each goal date')
      + card(cardHd("Goals — today's value inflated to goal year")
        + `<table style="width:100%;border-collapse:collapse"><thead><tr>${th('Goal', 'left')}${th('Age')}${th('Year')}${th("Today's value")}${th('Future value')}${th('Median corpus')}${th('Feasibility')}</tr></thead>`
        + `<tbody>${goalRows}</tbody></table>`
        + `<div style="padding:10px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">Goal feasibility is based on the median corpus at that age vs the inflated goal amount. A goal is "At risk" if the median corpus is less than 1.25× the goal amount at that age.</div>`)
      + `</section>` : '')

    + `<section class="pg" style="margin-bottom:32px">` + secHd('8', 'Year-by-Year Cashflow', 'All inflows and outflows — median corpus and stress case (P10)')
    + card(cardHd('Annual cashflow statement — ★ = retirement year')
      + `<div style="overflow-x:auto"><table class="cf-table" style="width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed">`
      + `<colgroup><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:12%"><col style="width:13%"><col style="width:13%"></colgroup>`
      + `<thead><tr>`
      + thc('Age', 'center') + thc('Year', 'center') + thc('Phase', 'left')
      + thc('SIP in') + thc('EPF+NPS') + thc('Lumps in') + thc('Goals out') + thc('Withdrawal') + thc('Median') + thc('P10')
      + `</tr></thead><tbody>${cfRows}</tbody></table></div>`
      + `<div style="padding:10px 16px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">EPF+NPS lump merges into corpus at retirement. Withdrawals are grossed up for ${(IN.tax * 100).toFixed(0)}% tax. NPS annuity income (${fmtL(R.npsAnnualAnnuity || 0)}/yr) deducted before computing withdrawal. Shaded rows every 5 years. Values shown in L / Cr as applicable.</div>`)
    + `</section>`

    + `<section class="pg" style="margin-bottom:32px">` + secHd('9', 'Investment Policy & Assumptions')
    + card(cardHd('Plan parameters and methodology')
      + `<table style="width:100%;border-collapse:collapse"><tbody>${ipsRows}</tbody></table>`
      + `<div style="padding:14px 18px;background:${GR10};border-top:1px solid ${GR20}">`
      + `<div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${LAV};margin-bottom:7px">Methodology &amp; disclosures</div>`
      + `<div style="font-size:10px;color:#888;line-height:1.85">`
      + `<strong>Monte Carlo simulation:</strong> ${R.NSIM} independent paths. Each year's return is drawn from a normal distribution with the stated mean and standard deviation — pre-retirement ${(IN.preMu * 100).toFixed(1)}% ± ${(IN.preSig * 100).toFixed(0)}%, post-retirement ${(IN.postMu * 100).toFixed(1)}% ± ${(IN.postSig * 100).toFixed(0)}%. `
      + `<br><strong>EPF/PPF &amp; NPS:</strong> Accumulated deterministically at stated rates and merged into the investable corpus at retirement (EPF: 100%, NPS: 60% lump + 40% annuity at ${(IN.annRate * 100).toFixed(1)}%). `
      + `<br><strong>Goals:</strong> Amounts stated in today's value, compounded at general inflation (${(IN.infl * 100).toFixed(1)}%) to the goal year and deducted as a lump sum in that year. `
      + `<br><strong>Withdrawals:</strong> Annual post-tax income need (living expenses − other income − NPS annuity) grossed up by ${(IN.tax * 100).toFixed(0)}% for tax. `
      + `<br><strong>Sensitivity analysis:</strong> Each scenario re-runs ${R.NSIM} Monte Carlo paths changing one variable from the base plan. `
      + `<br><br>This analysis is prepared by BugleRock Capital for informational purposes. It is based on the stated assumptions and is not a guarantee or promise of future outcomes. Actual results will differ. Mutual fund investments are subject to market risk. Please consult your adviser before making investment decisions. © BugleRock Capital ${CY}.`
      + `</div></div>`)
    + `</section>`;

  return { sectionsHtml, IN, today, vc, vbg, vt, vm, fmtL, fmtK };
}

// Standalone printable report in a new tab
export function rtOpenReport(R) {
  if (!R) return;
  const B = rtBuildFullSections(R);
  const { IN, today, vc, vbg, vt, vm, fmtL, fmtK } = B;
  const CY = new Date().getFullYear();

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow popups to view the full report.'); return; }
  w.document.write(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + `<title>Retirement Plan — ${IN.name || 'Client'}</title>`
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + `body{font-family:"DM Sans",sans-serif;background:#fff;color:${GR80};font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}`
    + '.page{max-width:1040px;margin:0 auto;padding:36px 44px}'
    + 'section{margin-bottom:32px}'
    + '.cf-table{font-size:9px}'
    + '.cf-table td,.cf-table th{padding:3px 4px!important}'
    + `.rt-score-badge{display:flex;align-items:center;gap:18px;background:#f8f6fa;border-radius:14px;padding:16px 22px;margin-bottom:16px;border:1px solid #E4E1E7;flex-wrap:wrap}`
    + `.rt-score-big{font-family:'DM Mono',monospace;font-size:52px;font-weight:700;line-height:1;flex-shrink:0;width:80px;text-align:center}`
    + `.rt-score-meta h4{font-size:11px;font-weight:700;color:${GR80};margin-bottom:6px;font-family:inherit}`
    + `.rt-score-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f0ecf4}`
    + `.rt-score-lbl{flex:1;font-size:11.5px;color:${GR80}}`
    + `.rt-score-wt{font-size:9.5px;color:#A2A0A0;width:28px;text-align:right;flex-shrink:0}`
    + `.rt-score-bar{width:90px;height:6px;background:#E8DDE5;border-radius:3px;overflow:hidden;flex-shrink:0}`
    + '.rt-score-fill{height:100%;border-radius:3px}'
    + `.rt-score-num{font-family:'DM Mono',monospace;font-size:11.5px;font-weight:700;width:26px;text-align:right;flex-shrink:0}`
    + '.rt-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700}'
    + `.rt-hero{background:linear-gradient(135deg,#3E3452 0%,#6D5479 55%,#912F63 100%);border-radius:14px;padding:28px 32px;color:#fff;margin-bottom:18px;box-shadow:0 6px 28px rgba(62,52,82,.22);position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}`
    + '.rt-hero-inner{position:relative;z-index:1}'
    + '.rt-kpi-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden;margin-top:20px}'
    + `.rt-kpi-cell{padding:13px 16px;border-right:1px solid rgba(255,255,255,.1)}`
    + `.rt-kpi-val{font-family:'DM Mono',monospace;font-size:16px;font-weight:700;line-height:1.1}`
    + '.rt-kpi-lbl{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-top:4px}'
    + '.rt-kpi-sub{font-size:8px;color:rgba(255,255,255,.3);margin-top:1px}'
    + `.rt-out-card{background:#fff;border:1px solid #E4E1E7;border-radius:14px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 6px rgba(62,52,82,.06)}`
    + '.rt-out-hdr{padding:12px 20px;display:flex;align-items:center;gap:10px;background:#f8f6fa;border-bottom:1px solid #E4E1E7}'
    + '.rt-out-num{width:24px;height:24px;border-radius:50%;background:#912F63;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.rt-out-title{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#6D5479}'
    + '.rt-out-body{padding:18px 20px}'
    + '.rt-fade-in{animation:rtFadeIn .35s ease both}'
    + '@keyframes rtFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}'
    + '@media print{@page{margin:10mm 8mm;size:A4}.no-print{display:none!important}.pg{page-break-before:always;padding-top:24px}.page{padding:20px 16px}}'
    + '@media(max-width:860px){.rt-kpi-strip{grid-template-columns:repeat(3,1fr)}}'
    + '.rt-phase-grid{display:grid;grid-template-columns:1fr auto 1fr;gap:0;margin-bottom:16px;border-radius:14px;overflow:hidden;border:1px solid #E4E1E7;box-shadow:0 1px 6px rgba(62,52,82,.06)}'
    + '.rt-phase-build{background:#f7f4fb;padding:16px 20px}'
    + '.rt-phase-divider{background:#912F63;color:#fff;padding:0 16px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;writing-mode:vertical-lr;letter-spacing:.08em;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    + '.rt-phase-draw{background:#fff0f5;padding:16px 20px}'
    + '.rt-phase-label{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px}'
    + '.rt-phase-period{font-size:10.5px;color:#6D5479;margin-bottom:10px}'
    + '.rt-phase-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}'
    + '.rt-phase-item-lbl{font-size:8.5px;color:#6D5479}'
    + `.rt-phase-item-val{font-size:12px;font-weight:700;color:#2D1F2B;font-family:'DM Mono',monospace}`
    + '.rt-bridge-wrap{flex-wrap:wrap}'
    + '.rt-bridge-node{flex:1;text-align:center;padding:11px 6px;min-width:80px}'
    + '.rt-bridge-sep{color:#A2A0A0;font-size:13px;flex-shrink:0}'
    + '</style></head><body>'
    + `<div class="no-print" style="background:${PLUM};padding:11px 28px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:99">`
    + `<div style="flex:1;color:rgba(255,255,255,.7);font-size:12px">Retirement plan · <strong style="color:#fff">${IN.name || 'Client'}</strong> · ${today}</div>`
    + `<button onclick="window.print()" style="padding:8px 22px;background:${BERRY};color:#fff;border:none;border-radius:8px;font:600 12px DM Sans,sans-serif;cursor:pointer">⬇ Print / Save PDF</button>`
    + `<button onclick="window.close()" style="padding:8px 14px;background:rgba(255,255,255,.12);color:#fff;border:1.5px solid rgba(255,255,255,.25);border-radius:8px;font:12px DM Sans,sans-serif;cursor:pointer">✕ Close</button>`
    + '</div>'
    + '<div class="page">'
    + '<section>'
    + `<div style="border-bottom:3px solid ${BERRY};padding-bottom:18px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end">`
    + '<div>'
    + `<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${LAV};margin-bottom:7px">Retirement Financial Plan — Monte Carlo Analysis</div>`
    + `<div style="font-family:Cormorant Garamond,serif;font-size:40px;font-weight:700;color:${PLUM};line-height:1.1;margin-bottom:5px">${IN.name || 'Retirement Projection'}</div>`
    + `<div style="font-size:12.5px;color:${GR60}">Age ${IN.age} → Retire at ${IN.retAge} → Plan till ${IN.lifeExp}${IN.spouse ? ' · Spouse age ' + IN.spouse : ''} &nbsp;·&nbsp; ${today}</div>`
    + '</div>'
    + '<div style="text-align:right;flex-shrink:0">'
    + '<svg width="150" height="38" viewBox="0 0 150 38" style="display:inline-block">'
    + '<defs><linearGradient id="rtLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#912F63"/><stop offset="100%" stop-color="#3E3452"/></linearGradient></defs>'
    + '<rect x="0" y="1" width="34" height="34" rx="8" fill="url(#rtLogoGrad)"/>'
    + '<rect x="8" y="21" width="4" height="8" rx="1.5" fill="#fff" opacity="0.95"/>'
    + '<rect x="14.5" y="17" width="4" height="12" rx="1.5" fill="#fff" opacity="0.95"/>'
    + '<rect x="21" y="12.5" width="4" height="16.5" rx="1.5" fill="#fff" opacity="0.95"/>'
    + '<path d="M 7 27 Q 16 6 27 10" fill="none" stroke="#C46985" stroke-width="2" stroke-linecap="round"/>'
    + '<circle cx="27" cy="10" r="2.2" fill="#C46985"/>'
    + `<text x="44" y="25" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" font-size="22"><tspan fill="${BERRY}">Bü</tspan><tspan fill="${PLUM}">gleRock</tspan></text>`
    + '</svg></div></div>'
    + `<div style="background:${vbg};border-left:5px solid ${vc};border-radius:0 12px 12px 0;padding:18px 22px;display:flex;align-items:flex-start;gap:20px;margin-bottom:20px">`
    + '<div style="flex-shrink:0;text-align:center">'
    + `<div style="font-family:Cormorant Garamond,serif;font-size:52px;font-weight:700;color:${vc};line-height:1">${R.successRate}%</div>`
    + `<div style="font-size:11px;font-weight:700;color:${vc};letter-spacing:.04em">${vt.toUpperCase()}</div>`
    + '</div>'
    + `<div><div style="font-size:14px;font-weight:600;color:${vc};margin-bottom:5px">Plan verdict</div>`
    + `<div style="font-size:12.5px;color:#555;line-height:1.7">${vm}</div>`
    + (R.medianDepAge ? `<div style="margin-top:8px;font-size:11px;color:${GR60}">In failed scenarios, corpus typically depletes around age <strong>${R.medianDepAge}</strong> — ${IN.lifeExp - R.medianDepAge} years short of plan horizon.</div>` : '')
    + '</div></div>'
    + '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">'
    + [
      [fmtL(R.P50[R.yearsToRet]), 'Median corpus at ' + IN.retAge, BERRY],
      [fmtL(R.P10[R.yearsToRet]), 'Worst 10% at ' + IN.retAge, NEG],
      [fmtL(R.P90[R.yearsToRet]), 'Best 10% at ' + IN.retAge, POS],
      [fmtL(R.corpusNeeded), 'Corpus required', PLUM],
      [fmtK(R.incomeAtRet), 'Monthly need at ' + IN.retAge, PLUM],
      [fmtL(R.epfAtRet + R.npsLump), 'EPF+NPS lump at ' + IN.retAge, POS],
    ].map((k) =>
      `<div style="background:${GR10};border:1px solid ${GR20};border-radius:10px;padding:12px 8px;text-align:center">`
      + `<div style="font-family:Cormorant Garamond,serif;font-size:18px;font-weight:700;color:${k[2]};line-height:1;margin-bottom:4px">${k[0]}</div>`
      + `<div style="font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${GR60}">${k[1]}</div></div>`).join('')
    + '</div></section>'
    + B.sectionsHtml
    + '</div></body></html>');
  w.document.close();
}