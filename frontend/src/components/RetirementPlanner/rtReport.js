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
  Object.keys(R.goalsByYear).forEach((yr) => {
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
  const milestones = [0, 5, 10, 15, Math.min(R.yearsToRet, 20), R.yearsToRet].filter((v, i, a) => a.indexOf(v) === i && v <= R.years);
  const sipBW = 900, sipBH = 160;
  const sipMaxV = R.P90[R.yearsToRet] * 1.05 || 10;
  const sbx = (yr) => (20 + (yr / R.years) * (sipBW - 40)).toFixed(1);
  const sipBars = milestones.map((yr) => {
    const bx = sbx(yr), bw = Math.max(40, Math.min(100, (sipBW - 40) / R.years * 6));
    const bh50 = Math.max(0, (R.P50[yr] / sipMaxV) * (sipBH - 20));
    const bh90 = Math.max(0, (R.P90[yr] / sipMaxV) * (sipBH - 20));
    const lbl = yr === 0 ? 'Now' : 'Age ' + (IN.age + yr);
    const labelY = sipBH - 10 - bh50 - 8; // above bar
    const insideY = sipBH - 10 - bh50 + 14; // inside bar near top
    const useInside = bh50 > 25; // put label inside if bar is tall enough
    return `<rect x="${+bx - bw / 2}" y="${sipBH - 10 - bh90}" width="${bw}" height="${bh90}" fill="${BERRY}" opacity=".15" rx="3"/>`
      + `<rect x="${+bx - bw / 2 + 4}" y="${sipBH - 10 - bh50}" width="${bw - 8}" height="${bh50}" fill="${BERRY}" opacity=".7" rx="3"/>`
      + `<text x="${bx}" y="${useInside ? insideY : labelY}" text-anchor="middle" font-size="9" font-weight="700" fill="${useInside ? '#fff' : BERRY}" font-family="DM Mono,monospace">${fmtL(R.P50[yr])}</text>`
      + `<text x="${bx}" y="${sipBH + 12}" text-anchor="middle" font-size="9" fill="${GR60}" font-family="DM Sans,sans-serif">${lbl}</text>`;
  }).join('');
  const growthSvg = `<svg width="100%" viewBox="0 0 ${sipBW} ${sipBH + 24}" style="display:block"><line x1="20" y1="${sipBH - 10}" x2="${sipBW - 20}" y2="${sipBH - 10}" stroke="${GR20}" stroke-width="1"/>${sipBars}</svg>`;

  // ── CHART 3: Income waterfall ──
  const firstYr = R.yearsToRet;
  const baseNeed1 = R.annualExpToday * Math.pow(1 + IN.infl, firstYr) / 12 * 100000;
  const oi1 = (IN.otherIndexed ? R.otherIncToday * Math.pow(1 + IN.infl, firstYr) : R.otherIncToday) / 12 * 100000;
  const npsAnn1 = R.npsAnnuityIncome / 12 * 100000;
  const grossWd1 = Math.max(0, baseNeed1 - oi1 - npsAnn1);
  const taxAmt1 = grossWd1 * IN.tax;
  const netWd1 = grossWd1 - taxAmt1;
  const srcItems = [
    { l: 'Living expenses', v: baseNeed1, neg: true },
    { l: 'Less: Pension/rental income', v: oi1, neg: false },
    { l: 'Less: NPS annuity', v: npsAnn1, neg: false },
    { l: 'Gross withdrawal', v: grossWd1, neg: true, bold: true },
    { l: `Less: Tax (${Math.round(IN.tax * 100)}%)`, v: taxAmt1, neg: true },
    { l: 'Net monthly income needed', v: netWd1, neg: true, bold: true, hilite: true },
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
  const sensBars = R.sens.map((s) => {
    const c = s.sr >= 85 ? POS : s.sr >= 65 ? WARN : NEG;
    const bg = s.sr >= 85 ? '#E6F4ED' : s.sr >= 65 ? '#FEF9EC' : '#FEE2E2';
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">`
      + `<div style="width:220px;font-size:11.5px;text-align:right;color:${s.base ? PLUM : GR60};font-weight:${s.base ? '700' : '400'};flex-shrink:0">${s.label}</div>`
      + `<div style="flex:1;height:22px;background:${GR10};border-radius:4px;overflow:hidden;position:relative">`
      + `<div style="width:${s.sr}%;height:100%;background:${c};opacity:${s.base ? '1' : '.75'}"></div>`
      + `<div style="position:absolute;left:85%;top:0;bottom:0;width:1.5px;background:${PLUM};opacity:.3"></div>`
      + `</div>`
      + `<div style="width:52px;font-family:DM Mono,monospace;font-size:13px;font-weight:700;color:${c}">${s.sr}%</div>`
      + `<div style="width:90px;font-size:10px;color:${c};background:${bg};padding:2px 8px;border-radius:20px;text-align:center">${s.base ? 'Base plan' : s.sr > R.successRate ? '↑ +' + (s.sr - R.successRate) + 'pts' : s.sr < R.successRate ? '↓ ' + (s.sr - R.successRate) + 'pts' : '→ Same'}</div>`
      + `</div>`;
  }).join('');

  // ── Year-by-year cashflow ──
  // Smart cashflow formatter: handles L, Cr, negative values with sign prefix
  const fmtCF = (v, sign) => {
    if (!v || v === 0) return '—';
    const abs = Math.abs(v);
    let str;
    if (abs >= 100) str = (abs / 100).toFixed(2) + ' Cr';
    else if (abs < 0.1) str = (abs * 100).toFixed(0) + 'K';
    else str = abs.toFixed(1) + ' L';
    return (sign || '') + str;
  };

  let cfRows = '', sipA2 = IN.sipM * 12 / 100000, p10Depleted = false;

  const corpusLabel = IN.corpus0 > 0 ? `Today (opening — ${fmtCF(IN.corpus0)})` : 'Today (opening)';
  cfRows += `<tr style="background:${GR10}">`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:11px;font-weight:700">${IN.age}</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:11px">${CY}</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif;font-size:10px;color:${GR60}">${corpusLabel}</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${GR60}">—</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${GR60}">—</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${GR60}">—</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${GR60}">—</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${GR60}">—</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;font-weight:700;color:${BERRY}">${fmtCF(IN.corpus0)}</td>`
    + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${NEG}">${fmtCF(IN.corpus0)}</td>`
    + `</tr>`;
  for (let y = 1; y <= R.years; y++) {
    const ca = IN.age + y, isRet2 = ca > IN.retAge;
    const sipIn = (ca <= IN.sipTill && ca <= IN.retAge) ? sipA2 : 0;
    if (sipIn) sipA2 *= (1 + IN.stepUp);
    const epfIn = ca === IN.retAge ? R.epfAtRet + R.npsLump : 0;
    const li2 = R.lumpsByYear[y] || 0, gi2 = R.goalsByYear[y] || 0;
    const oneT2 = ca === IN.retAge && IN.oneTime ? IN.oneTime : 0;
    let wd2 = 0;
    if (isRet2) {
      const bn2 = R.annualExpToday * Math.pow(1 + IN.infl, y);
      const oi2 = IN.otherIndexed ? R.otherIncToday * Math.pow(1 + IN.infl, y) : R.otherIncToday;
      wd2 = Math.max(0, bn2 - oi2 - R.npsAnnuityIncome) / (1 - IN.tax);
    }
    const isRet1 = (ca === IN.retAge);
    const rowStyle = isRet1 ? 'background:#F7EEF3;' : ca % 5 === 0 ? 'background:' + GR10 + ';' : '';
    cfRows += `<tr style="${rowStyle}">`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:11px;font-weight:${isRet1 ? '700' : '400'}">${ca}${isRet1 ? ' ★' : ''}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:center;font-family:DM Mono,monospace;font-size:11px">${CY + y}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};font-family:DM Sans,sans-serif;font-size:10px;color:${GR60}">${isRet2 ? 'Retirement' : 'Accumulation'}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${POS}">${sipIn ? fmtCF(sipIn, '+') : '—'}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${POS}">${epfIn ? fmtCF(epfIn, '+') : '—'}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${POS}">${li2 ? fmtCF(li2, '+') : '—'}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${WARN}">${gi2 || oneT2 ? fmtCF(gi2 + oneT2, '−') : '—'}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${NEG}">${wd2 ? fmtCF(wd2, '−') : '—'}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;font-weight:${isRet1 ? '700' : '400'};color:${BERRY}">${fmtCF(R.P50[y])}</td>`
      + `<td style="padding:5px 10px;border-bottom:1px solid ${GR20};text-align:right;font-family:DM Mono,monospace;font-size:11px;color:${NEG}">${(() => { if (p10Depleted) return '—'; if (R.P10[y] <= 0) { p10Depleted = true; return '—'; } return fmtCF(R.P10[y]); })()}</td>`
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
    ['Inflation', (IN.infl * 100).toFixed(1) + '%'],
    ['Simulations', R.NSIM + ' Monte Carlo paths'],
  ].map((r) =>
    `<tr><td style="padding:7px 14px;border-bottom:1px solid ${GR20};font-size:11.5px;font-weight:500;color:${GR80};width:200px">${r[0]}</td>`
    + `<td style="padding:7px 14px;border-bottom:1px solid ${GR20};font-size:11.5px;color:${GR60}">${r[1]}</td></tr>`).join('');

  const sectionsHtml = ''
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

    + `<section style="margin-bottom:32px">` + secHd('2', 'Corpus Milestones', 'Median and range at key accumulation ages')
    + card(cardHd('Corpus growth milestones — median scenario') + `<div style="padding:18px 20px">${growthSvg}</div>`)
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
        const fg = s.hilite ? 'color:#fff;' : s.neg ? 'color:' + NEG + ';' : 'color:' + POS + ';';
        const lbl = s.hilite ? '<strong style="color:#fff">' + s.l + '</strong>' : s.l;
        return `<tr style="${bg}"><td style="padding:8px 14px;border-bottom:1px solid ${s.hilite ? 'rgba(255,255,255,.1)' : GR20};font-family:DM Sans,sans-serif;${s.bold ? 'font-weight:700;' : ''}${s.hilite ? 'color:#fff;' : 'color:' + GR80 + ';'}">${lbl}</td>`
          + `<td style="padding:8px 14px;border-bottom:1px solid ${s.hilite ? 'rgba(255,255,255,.1)' : GR20};text-align:right;font-family:DM Mono,monospace;font-weight:${s.bold ? '700' : '400'};${fg}">${fmtK(s.v)}/mo</td></tr>`;
      }).join('')
      + `</tbody></table>`
      + `<div style="padding:10px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">Based on ${Math.round(IN.replace * 100)}% replacement ratio. All figures at age ${IN.retAge}.</div>`)
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
      + `<div style="padding:10px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">NPS annuity (40% @ ${(IN.annRate * 100).toFixed(1)}%) generates ${fmtL(R.npsAnnuityIncome)}/yr fixed income. Shown separately as it is not part of the investable corpus.</div>`)
    + `</div></section>`

    + `<section class="pg" style="margin-bottom:32px">` + secHd('5', 'Sensitivity Analysis', 'What moves the needle — plan success rate under alternative assumptions')
    + card(cardHd('Success rate comparison', 'Dashed line = 85% threshold · 1,000 simulations per scenario')
      + `<div style="padding:20px 24px">${sensBars}</div>`
      + `<div style="padding:10px 20px 14px;font-size:11px;color:${GR60};border-top:1px solid ${GR20};line-height:1.7">Each scenario changes one variable from the base plan and re-runs 1,000 Monte Carlo simulations. The 85% threshold is a widely used rule-of-thumb for plan adequacy. Scenarios above the dashed line are considered robust.</div>`)
    + `</section>`

    + (goalRows ?
      `<section style="margin-bottom:32px">` + secHd('6', 'Financial Goals', 'Future value and feasibility at each goal date')
      + card(cardHd("Goals — today's value inflated to goal year")
        + `<table style="width:100%;border-collapse:collapse"><thead><tr>${th('Goal', 'left')}${th('Age')}${th('Year')}${th("Today's value")}${th('Future value')}${th('Median corpus')}${th('Feasibility')}</tr></thead>`
        + `<tbody>${goalRows}</tbody></table>`
        + `<div style="padding:10px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">Goal feasibility is based on the median corpus at that age vs the inflated goal amount. A goal is "At risk" if the median corpus is less than 1.25× the goal amount at that age.</div>`)
      + `</section>` : '')

    + `<section class="pg" style="margin-bottom:32px">` + secHd('7', 'Year-by-Year Cashflow', 'All inflows and outflows — median corpus and stress case (P10)')
    + card(cardHd('Annual cashflow statement — ★ = retirement year')
      + `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>`
      + th('Age', 'center') + th('Year', 'center') + th('Phase', 'left')
      + th('SIP in') + th('EPF+NPS') + th('Lumps in') + th('Goals out') + th('Withdrawal') + th('Median corpus') + th('P10 corpus')
      + `</tr></thead><tbody>${cfRows}</tbody></table></div>`
      + `<div style="padding:10px 16px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20}">EPF+NPS lump merges into corpus at retirement. Withdrawals are grossed up for ${(IN.tax * 100).toFixed(0)}% tax. NPS annuity income (${fmtL(R.npsAnnuityIncome)}/yr) deducted before computing withdrawal. Shaded rows every 5 years. Values shown in L / Cr as applicable.</div>`)
    + `</section>`

    + `<section class="pg" style="margin-bottom:32px">` + secHd('8', 'Investment Policy & Assumptions')
    + card(cardHd('Plan parameters and methodology')
      + `<table style="width:100%;border-collapse:collapse"><tbody>${ipsRows}</tbody></table>`
      + `<div style="padding:14px 18px;background:${GR10};border-top:1px solid ${GR20}">`
      + `<div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${LAV};margin-bottom:7px">Methodology &amp; disclosures</div>`
      + `<div style="font-size:10px;color:#888;line-height:1.85">`
      + `<strong>Monte Carlo simulation:</strong> ${R.NSIM} independent paths. Each year's return is drawn from a normal distribution with the stated mean and standard deviation — pre-retirement ${(IN.preMu * 100).toFixed(1)}% ± ${(IN.preSig * 100).toFixed(0)}%, post-retirement ${(IN.postMu * 100).toFixed(1)}% ± ${(IN.postSig * 100).toFixed(0)}%. `
      + `<br><strong>EPF/PPF &amp; NPS:</strong> Accumulated deterministically at stated rates and merged into the investable corpus at retirement (EPF: 100%, NPS: 60% lump + 40% annuity at ${(IN.annRate * 100).toFixed(1)}%). `
      + `<br><strong>Goals:</strong> Amounts stated in today's value, compounded at general inflation (${(IN.infl * 100).toFixed(1)}%) to the goal year and deducted as a lump sum in that year. `
      + `<br><strong>Withdrawals:</strong> Annual post-tax income need (living expenses − other income − NPS annuity) grossed up by ${(IN.tax * 100).toFixed(0)}% for tax. `
      + `<br><strong>Sensitivity analysis:</strong> Each scenario re-runs 250 Monte Carlo paths changing one variable from the base plan. `
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
    + '@media print{@page{margin:12mm 10mm;size:A4}.no-print{display:none!important}.pg{page-break-before:always;padding-top:24px}}'
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