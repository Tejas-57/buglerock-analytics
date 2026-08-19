// ══════════════════════════════════════════════════════════
// Retirement Planner — Monte Carlo engine (pure functions)
// Faithful port of the reference logic. All figures in ₹ Lakh.
// ══════════════════════════════════════════════════════════

export function rtFmt(lakh) {
  if (lakh == null || isNaN(lakh)) return '—';
  if (Math.abs(lakh) >= 100) return '₹' + (lakh / 100).toFixed(2) + ' Cr';
  return '₹' + lakh.toFixed(1) + ' L';
}

export function rtFmtK(v) {
  return '₹' + Math.round(v / 1000) + 'K';
}

// Box-Muller normal sample
function rtNorm(mu, sigma) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Core simulation → { P10..P90, successRate, medianDepAge, ... }
export function rtSimulate(IN, NSIM) {
  const years = IN.lifeExp - IN.age;
  const yearsToRet = IN.retAge - IN.age;

  // Goals & lumps by year offset
  const goalsByYear = {}, lumpsByYear = {};
  IN.goals.forEach((g) => {
    if (!g.amt || g.age <= IN.age || g.age > IN.lifeExp) return;
    const yr = g.age - IN.age;
    goalsByYear[yr] = (goalsByYear[yr] || 0) + g.amt * Math.pow(1 + IN.infl, yr);
  });
  IN.lumps.forEach((g) => {
    if (!g.amt || g.age <= IN.age || g.age > IN.lifeExp) return;
    const yr = g.age - IN.age;
    lumpsByYear[yr] = (lumpsByYear[yr] || 0) + g.amt; // face value at that age
  });

  // EPF & NPS deterministic accumulation to retirement
  let epfC = IN.epf, npsC = IN.nps;
  const epfAnnual = (IN.epfM * 12) / 100000, npsAnnual = (IN.npsM * 12) / 100000;
  for (let e = 1; e <= yearsToRet; e++) {
    epfC = epfC * (1 + IN.epfR) + epfAnnual;
    npsC = npsC * (1 + IN.npsR) + npsAnnual;
  }
  const epfAtRet = epfC;
  const npsAtRet = npsC;
  const npsLump = npsAtRet * 0.6;                     // 60% merges into corpus
  const npsAnnuityIncome = npsAtRet * 0.4 * IN.annRate; // ₹L/yr fixed

  const annualExpToday = (IN.expM * 12 * IN.replace) / 100000;
  const healthExpToday = (IN.healthM * 12) / 100000;
  const otherIncToday = (IN.otherIncM * 12) / 100000;

  const paths = [], depletions = [];
  for (let s = 0; s < NSIM; s++) {
    // If retiring today (yearsToRet=0), EPF+NPS lump is already available at t=0
    let c = IN.corpus0 + (yearsToRet === 0 ? (epfAtRet + npsLump - (IN.oneTime || 0)) : 0);
    const path = [c];
    let depAge = null;
    let sip = (IN.sipM * 12) / 100000;
    for (let y = 1; y <= years; y++) {
      const curAge = IN.age + y;
      const isRet = curAge > IN.retAge;
      const r = isRet ? rtNorm(IN.postMu, IN.postSig) : rtNorm(IN.preMu, IN.preSig);
      c = c * (1 + r);
      if (curAge <= IN.sipTill && curAge <= IN.retAge) { c += sip; sip *= (1 + IN.stepUp); }
      if (lumpsByYear[y]) c += lumpsByYear[y];
      if (curAge === IN.retAge) { c += epfAtRet + npsLump; if (IN.oneTime) c -= IN.oneTime; }
      if (goalsByYear[y]) c -= goalsByYear[y];
      if (isRet) {
        const baseNeed = annualExpToday * Math.pow(1 + IN.infl, y);
        const healthNeed = healthExpToday * Math.pow(1 + IN.healthInfl, y);
        const otherInc = IN.otherIndexed ? otherIncToday * Math.pow(1 + IN.infl, y) : otherIncToday;
        const netNeed = Math.max(0, baseNeed + healthNeed - otherInc - npsAnnuityIncome);
        const grossWd = netNeed / (1 - IN.tax);
        c -= grossWd;
      }
      if (c <= 0 && depAge === null) { depAge = curAge; c = 0; }
      path.push(c);
    }
    paths.push(path);
    depletions.push(depAge);
  }

  function pct(arr, p) {
    const a = arr.slice().sort((x, y) => x - y);
    const idx = (a.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return a[lo] + (a[hi] - a[lo]) * (idx - lo);
  }
  const P10 = [], P25 = [], P50 = [], P75 = [], P90 = [];
  for (let y2 = 0; y2 <= years; y2++) {
    const vals = paths.map((p) => p[y2]);
    P10.push(pct(vals, 0.10)); P25.push(pct(vals, 0.25)); P50.push(pct(vals, 0.50));
    P75.push(pct(vals, 0.75)); P90.push(pct(vals, 0.90));
  }
  const success = depletions.filter((d) => d === null).length;
  const deps = depletions.filter((d) => d !== null).sort((a, b) => a - b);

  return {
    P10, P25, P50, P75, P90,
    successRate: Math.round((success / NSIM) * 100),
    medianDepAge: deps.length ? deps[Math.floor(deps.length / 2)] : null,
    epfAtRet, npsAtRet, npsLump, npsAnnuityIncome,
    goalsByYear, lumpsByYear,
    annualExpToday, healthExpToday, otherIncToday,
    years, yearsToRet,
  };
}

// Full run: simulation + corpus-needed + sensitivity scenarios
export function rtRunSimulation(IN, NSIM) {
  const R = rtSimulate(IN, NSIM);
  R.NSIM = NSIM;

  // Corpus needed at retirement (annuity PV, net of other income)
  const realR = (1 + IN.postMu) / (1 + IN.infl) - 1;
  const n = IN.lifeExp - IN.retAge;
  let firstNeed = R.annualExpToday * Math.pow(1 + IN.infl, R.yearsToRet)
    + R.healthExpToday * Math.pow(1 + IN.healthInfl, R.yearsToRet)
    - (IN.otherIndexed ? R.otherIncToday * Math.pow(1 + IN.infl, R.yearsToRet) : R.otherIncToday)
    - R.npsAnnuityIncome;
  firstNeed = Math.max(0, firstNeed) / (1 - IN.tax);
  R.corpusNeeded = Math.abs(realR) < 0.0001
    ? firstNeed * n
    : firstNeed * (1 - Math.pow(1 + realR, -n)) / realR * (1 + realR);
  R.incomeAtRet = (R.annualExpToday * Math.pow(1 + IN.infl, R.yearsToRet)
    + R.healthExpToday * Math.pow(1 + IN.healthInfl, R.yearsToRet)) / 12 * 100000;

  // Sensitivity scenarios (1000 sims each)
  const variant = (overrides) => {
    const v = JSON.parse(JSON.stringify(IN));
    v.goals = IN.goals; v.lumps = IN.lumps;
    Object.keys(overrides).forEach((k) => { v[k] = overrides[k]; });
    return rtSimulate(v, 1000).successRate;
  };
  R.sens = [
    { label: 'Current plan', sr: R.successRate, base: true },
    { label: 'SIP +₹10,000/mo', sr: variant({ sipM: IN.sipM + 10000 }) },
    { label: 'SIP +₹25,000/mo', sr: variant({ sipM: IN.sipM + 25000 }) },
    { label: `Retire 2 yrs later (${IN.retAge + 2})`, sr: variant({ retAge: IN.retAge + 2, sipTill: Math.max(IN.sipTill, IN.retAge + 2) }) },
    { label: `Retire 2 yrs earlier (${IN.retAge - 2})`, sr: variant({ retAge: IN.retAge - 2 }) },
    { label: 'Returns 2% lower', sr: variant({ preMu: IN.preMu - 0.02, postMu: IN.postMu - 0.02 }) },
    { label: 'Expenses +20%', sr: variant({ expM: IN.expM * 1.2 }) },
  ];

  R.IN = IN;
  return R;
}