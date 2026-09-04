// ══════════════════════════════════════════════════════════════════════
// Retirement Planner — Monte Carlo engine v3 (pure functions)
// All monetary figures in ₹ Lakh unless noted.
//
// v3 additions: serial correlation (φ=0.15), late-retirement glide path,
// inflation-uncertainty regime, separate healthcare/lifestyle inflation,
// guardrail withdrawal strategy, crash override, plan score composite,
// enhanced 13-scenario sensitivity, SIP/retire-age/spend solvers.
// ══════════════════════════════════════════════════════════════════════

/* ── Formatting ────────────────────────────────────────────────────── */
export function rtFmt(lakh) {
  if (lakh == null || isNaN(lakh)) return '—';
  const abs = Math.abs(lakh);
  const sign = lakh < 0 ? '−' : '';
  if (abs >= 100) return sign + '₹' + (abs / 100).toFixed(2) + ' Cr';
  return sign + '₹' + abs.toFixed(1) + ' L';
}
export function rtFmtCr(lakh) { return rtFmt(lakh); } // alias
export function rtFmtK(v) { return '₹' + Math.round(v / 1000) + 'K'; }
export function rtFmtA(v) { return '₹' + Math.round(v).toLocaleString('en-IN'); }
export function rtFmtM(lakh) { return '₹' + Math.round((lakh * 100000) / 12).toLocaleString('en-IN') + '/mo'; }

/* ── Box-Muller ───────────────────────────────────────────────────── */
function rnorm() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── Core Monte Carlo ─────────────────────────────────────────────── */
/**
 * IN shape (all rates as decimals, monetary in Lakhs):
 *   age, retAge, lifeExp, corpus0, sipM (₹ absolute), stepUp, sipTill,
 *   epf, epfM (₹ absolute), epfR, nps, npsM (₹ absolute), npsR, annRate,
 *   expM (₹ absolute), replace,
 *   otherIncM (₹ absolute), otherIndexed (bool), oneTime (Lakhs), tax,
 *   preMu, preSig, postMu, postSig, lateMu, lateSig,
 *   infl, inflUnc, nSims, targetConf,
 *   withdrawalStrategy ('fixed'|'flexible'), guardrailTrigger, guardrailCut,
 *   crashSeverity,
 *   goals: [{name, age, amt (Lakhs), infl?}], lumps: [{name, age, amt (Lakhs)}]
 *
 * Override params (for stress scenarios):
 *   _crashReturn, _inflShockYrs, _inflShockExtra
 */
export function rtRunMC(IN, overrideSIP) {
  const sip = overrideSIP !== undefined ? overrideSIP : IN.sipM;
  const yrsAccum = Math.max(0, IN.retAge - IN.age);
  const yrsRetire = Math.max(0, IN.lifeExp - IN.retAge);
  const PHI = 0.15; // serial correlation coefficient

  // Stress overrides
  const inflShockYrs = IN._inflShockYrs || 0;
  const inflShockExtra = IN._inflShockExtra || 0;
  const crashReturn = IN._crashReturn != null ? IN._crashReturn : null;
  const withdrawalStrategy = IN.withdrawalStrategy || 'fixed';
  const GUARDRAIL_TRIGGER = IN.guardrailTrigger != null ? IN.guardrailTrigger : 0.15;
  const GUARDRAIL_CUT = IN.guardrailCut != null ? IN.guardrailCut : 0.10;

  // EPF deterministic
  let epfAtRet = IN.epf;
  const epfAnnual = (IN.epfM * 12) / 100000;
  for (let y = 0; y < yrsAccum; y++) epfAtRet = (epfAtRet + epfAnnual) * (1 + IN.epfR);

  // NPS deterministic
  let npsAtRet = IN.nps;
  const npsAnnual = (IN.npsM * 12) / 100000;
  for (let y = 0; y < yrsAccum; y++) npsAtRet = (npsAtRet + npsAnnual) * (1 + IN.npsR);
  const npsLump = npsAtRet * 0.6;
  const npsAnnualAnnuity = npsAtRet * 0.4 * IN.annRate;

  // Goals with own inflation
  const goalsFV = (IN.goals || []).map(g => {
    const goalInfl = g.infl != null ? g.infl : IN.infl;
    const fv = g.amt * Math.pow(1 + goalInfl, g.age - IN.age);
    return { name: g.name, age: g.age, fv, amtToday: g.amt, infl: goalInfl, priority: g.priority || 1 };
  });

  // Lump map
  const lumpMap = {};
  (IN.lumps || []).forEach(l => { if (l.amt > 0) lumpMap[l.age] = (lumpMap[l.age] || 0) + l.amt; });

  // Income at retirement
  const inflFactor = Math.pow(1 + IN.infl, yrsAccum);
  const annualExpToday = (IN.expM * 12 * IN.replace) / 100000; // Lakhs/yr
  const lifestyleAtRet = annualExpToday * inflFactor;
  const healthAtRet = 0; // healthcare folded into expenses
  const otherIncToday = (IN.otherIncM * 12) / 100000;
  const otherIncAtRet = otherIncToday * (IN.otherIndexed ? inflFactor : 1);
  const netBeforeTax = Math.max(0, lifestyleAtRet - otherIncAtRet - npsAnnualAnnuity);
  const firstNeed = netBeforeTax > 0 ? netBeforeTax / (1 - IN.tax) : 0;

  // Required corpus (closed-form approximation)
  const g_r = IN.postMu - IN.infl;
  let reqCorpus = Math.abs(g_r) < 0.001
    ? firstNeed * yrsRetire
    : firstNeed * (1 - Math.pow((1 + IN.infl) / (1 + IN.postMu), yrsRetire)) / (IN.postMu - IN.infl);
  reqCorpus += (IN.oneTime || 0);

  // Late-retirement glide targets (default to post-ret if not provided)
  const lateMu = IN.lateMu != null ? IN.lateMu : IN.postMu;
  const lateSig = IN.lateSig != null ? IN.lateSig : IN.postSig;

  // Simulation
  const nSims = IN.nSims || 500;
  let successCount = 0;
  const corpusAtRet = [];
  const depletionYrs = [];
  let guardrailTriggerYears = 0;
  const allFullPaths = [];

  for (let sim = 0; sim < nSims; sim++) {
    let c = IN.corpus0;
    let curSIP = (sip * 12) / 100000; // Lakhs/yr
    const inflRegime = Math.max(0.01, IN.infl + rnorm() * (IN.inflUnc || 0));
    let prevShock = 0;

    // ── Accumulation ──
    const accumPath = [c];
    for (let y = 0; y < yrsAccum; y++) {
      const age = IN.age + y;
      const shock = PHI * prevShock + Math.sqrt(1 - PHI * PHI) * rnorm();
      prevShock = shock;
      const ret = IN.preMu + shock * IN.preSig;
      if (age < IN.sipTill) {
        c = (c + curSIP) * (1 + ret);
        curSIP *= (1 + IN.stepUp);
      } else {
        c *= (1 + ret);
      }
      if (lumpMap[age + 1]) c += lumpMap[age + 1];
      goalsFV.forEach(g => { if (g.age === age + 1) c = Math.max(0, c - g.fv); });
      c = Math.max(0, c);
      accumPath.push(c);
    }

    // Add EPF + NPS at retirement
    c += epfAtRet + npsLump;
    if (IN.oneTime) c -= IN.oneTime;
    corpusAtRet.push(c);

    // ── Retirement drawdown ──
    let depleted = false;
    const retirePath = [c];
    let lifestylePart = lifestyleAtRet;
    let prevYearStartCorpus = c;

    for (let r = 0; r < yrsRetire; r++) {
      const t = yrsRetire > 1 ? r / (yrsRetire - 1) : 0;
      const rMu = IN.postMu * (1 - t) + lateMu * t;
      const rVol = IN.postSig * (1 - t) + lateSig * t;
      const shock2 = PHI * prevShock + Math.sqrt(1 - PHI * PHI) * rnorm();
      prevShock = shock2;
      const ret2 = (crashReturn != null && r === 0) ? crashReturn : (rMu + shock2 * rVol);

      // Withdrawal from separately-compounded components
      let grossNeedYr = lifestylePart;
      let netYr = Math.max(0, grossNeedYr - otherIncAtRet - npsAnnualAnnuity);
      let withdrawal = netYr > 0 ? netYr / (1 - IN.tax) : 0;

      // Guardrail
      if (withdrawalStrategy === 'flexible' && r > 0 && c < prevYearStartCorpus * (1 - GUARDRAIL_TRIGGER)) {
        withdrawal *= (1 - GUARDRAIL_CUT);
        guardrailTriggerYears++;
      }
      prevYearStartCorpus = c;

      c = (c - withdrawal) * (1 + ret2);

      // Grow components at own rates
      const lifestyleInfl = inflRegime + (r < inflShockYrs ? inflShockExtra : 0);
      lifestylePart *= (1 + lifestyleInfl);

      if (c < 0) { c = 0; if (!depleted) { depleted = true; depletionYrs.push(r); } }
      retirePath.push(c);
    }

    if (!depleted) successCount++;
    allFullPaths.push({ accum: accumPath, retire: retirePath });
  }

  // Build percentile paths
  function buildPct(phase, pct) {
    const len = phase === 'accum' ? yrsAccum + 1 : yrsRetire + 1;
    const res = [];
    for (let t = 0; t < len; t++) {
      const vals = allFullPaths.map(p => (p[phase][t] || 0)).sort((a, b) => a - b);
      res.push(vals[Math.floor(nSims * pct)]);
    }
    return res;
  }

  const accumP10 = buildPct('accum', 0.1), accumP25 = buildPct('accum', 0.25), accumP50 = buildPct('accum', 0.5);
  const accumP75 = buildPct('accum', 0.75), accumP90 = buildPct('accum', 0.9);
  const P10 = buildPct('retire', 0.1), P25 = buildPct('retire', 0.25), P50 = buildPct('retire', 0.5);
  const P75 = buildPct('retire', 0.75), P90 = buildPct('retire', 0.9);

  const sortedC = corpusAtRet.slice().sort((a, b) => a - b);
  const p50c = sortedC[Math.floor(nSims * 0.5)];
  const sortedDep = depletionYrs.slice().sort((a, b) => a - b);
  const p10DepAge = sortedDep.length ? IN.retAge + sortedDep[Math.floor(sortedDep.length * 0.1)] : null;

  // Bridge numbers
  let totalSIPContrib = 0;
  let curS = (sip * 12) / 100000;
  for (let y = 0; y < yrsAccum; y++) {
    if (IN.age + y < IN.sipTill) totalSIPContrib += curS;
    curS *= (1 + IN.stepUp);
  }
  const compoundedCorpus = IN.corpus0 * Math.pow(1 + IN.preMu, yrsAccum);
  const marketGrowthEst = Math.max(0, p50c - epfAtRet - npsLump - compoundedCorpus - totalSIPContrib);

  return {
    successRate: Math.round((successCount / nSims) * 100),
    p10c: sortedC[Math.floor(nSims * 0.1)], p25c: sortedC[Math.floor(nSims * 0.25)],
    p50c, p75c: sortedC[Math.floor(nSims * 0.75)], p90c: sortedC[Math.floor(nSims * 0.9)],
    epfAtRet, npsAtRet, npsLump, npsAnnualAnnuity,
    reqCorpus, firstNeed, lifestyleAtRet, healthAtRet,
    otherIncAtRet, npsAnnuityNet: npsAnnualAnnuity, netBeforeTax,
    goalsFV,
    accumP10, accumP25, accumP50, accumP75, accumP90,
    P10path: P10, P25path: P25, P50path: P50, P75path: P75, P90path: P90,
    cfAccum: accumP50, cfRetire: P50,
    depletionYrs, sortedDep, p10DepAge,
    surplus: p50c - reqCorpus,
    fundingGapToday: (p50c - reqCorpus) / Math.pow(1 + IN.preMu, yrsAccum),
    totalSIPContrib, marketGrowthEst,
    withdrawalStrategy, guardrailTriggerYears,
    // Legacy compat
    years: yrsAccum + yrsRetire, yearsToRet: yrsAccum,
    annualExpToday, otherIncToday,
    IN, sip,
    NSIM: nSims,
  };
}

/* ── Solvers ──────────────────────────────────────────────────────── */
export function rtSolveSIP(IN, targetRate) {
  let lo = 0, hi = Math.max(IN.sipM * 10, 500000);
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (rtRunMC(IN, mid).successRate >= targetRate) hi = mid; else lo = mid;
    if (hi - lo < 200) break;
  }
  return Math.ceil(hi / 500) * 500;
}

export function rtSolveRetAge(IN, targetRate) {
  for (let a = IN.retAge; a <= 75; a++) {
    const I2 = { ...IN, retAge: a, sipTill: Math.max(IN.sipTill, a) };
    if (rtRunMC(I2).successRate >= targetRate) return a;
  }
  return null;
}

export function rtSolveSpend(IN, targetRate) {
  for (let pct = 1; pct >= 0.5; pct -= 0.02) {
    if (rtRunMC({ ...IN, expM: IN.expM * pct }).successRate >= targetRate) return pct;
  }
  return null;
}

/* ── Sensitivity scenarios ───────────────────────────────────────── */
export function rtSensitivity(IN, base) {
  const yrsRetire = Math.max(0, IN.lifeExp - IN.retAge);
  const scenarios = [
    { key: 'sip10k', label: '+₹10k/mo SIP', fn: () => rtRunMC({ ...IN, sipM: IN.sipM + 10000 }) },
    { key: 'sip25k', label: '+₹25k/mo SIP', fn: () => rtRunMC({ ...IN, sipM: IN.sipM + 25000 }) },
    { key: 'retLater', label: 'Retire 2 yrs later', fn: () => rtRunMC({ ...IN, retAge: IN.retAge + 2, sipTill: Math.max(IN.sipTill, IN.retAge + 2) }) },
    { key: 'retEarlier', label: 'Retire 2 yrs earlier', fn: () => rtRunMC({ ...IN, retAge: Math.max(IN.age + 5, IN.retAge - 2) }) },
    { key: 'lowReturns', label: 'Returns −2%', fn: () => rtRunMC({ ...IN, preMu: IN.preMu - 0.02, postMu: IN.postMu - 0.02 }) },
    { key: 'expenses20', label: 'Expenses +20%', fn: () => rtRunMC({ ...IN, expM: IN.expM * 1.2 }) },
    { key: 'sequenceRisk', label: 'Bad first 5 yrs (sequence risk)', fn: () => rtRunMC({ ...IN, postMu: IN.postMu - 0.04, postSig: IN.postSig + 0.04 }) },
    { key: 'equityCrash', label: `Equity crash at retirement (−${Math.round((IN.crashSeverity || 0.30) * 100)}%)`, fn: () => rtRunMC({ ...IN, _crashReturn: -(IN.crashSeverity || 0.30) }) },
    { key: 'inflDecade', label: 'High inflation decade (+2%, 10 yrs)', fn: () => rtRunMC({ ...IN, _inflShockYrs: 10, _inflShockExtra: 0.02 }) },
    { key: 'stagflation', label: 'Stagflation (low return + high inflation)', fn: () => rtRunMC({ ...IN, postMu: IN.postMu - 0.02, _inflShockYrs: yrsRetire, _inflShockExtra: 0.02 }) },
    { key: 'longevity', label: 'Longevity stress (+5 yrs)', fn: () => rtRunMC({ ...IN, lifeExp: IN.lifeExp + 5 }) },
    { key: 'flexWithdrawal', label: 'Flexible withdrawal strategy', fn: () => rtRunMC({ ...IN, withdrawalStrategy: 'flexible' }) },
  ];
  return scenarios.map(s => {
    const r = s.fn();
    return { key: s.key, label: s.label, conf: r.successRate, delta: r.successRate - base.successRate };
  });
}

/* ── Plan score composite ────────────────────────────────────────── */
export function rtPlanScore(base, IN, sens) {
  const confScore = Math.min(100, base.successRate);
  const gapScore = base.surplus >= 0
    ? Math.min(100, 70 + (base.surplus / Math.max(base.reqCorpus, 1)) * 30)
    : Math.max(0, 70 + (base.surplus / Math.max(base.reqCorpus, 1)) * 70);
  const downsideScore = base.p10DepAge
    ? Math.max(0, Math.min(100, (base.p10DepAge - IN.retAge) / Math.max(IN.lifeExp - IN.retAge, 1) * 100))
    : 90;
  let goalScore = 80;
  if (base.goalsFV && base.goalsFV.length > 0) {
    const ok = base.goalsFV.filter(g => {
      const yrs = g.age - IN.age;
      const p50 = yrs >= 0 && yrs < base.accumP50.length ? base.accumP50[yrs] : 0;
      return p50 >= g.fv * 0.9;
    });
    goalScore = (ok.length / base.goalsFV.length) * 100;
  }
  const composite = confScore * 0.35 + gapScore * 0.30 + downsideScore * 0.22 + goalScore * 0.13;
  return {
    composite: Math.round(composite),
    components: [
      { label: 'Funding probability', score: confScore.toFixed(0), weight: '35%' },
      { label: 'Corpus buffer', score: gapScore.toFixed(0), weight: '25%' },
      { label: 'Downside resilience', score: downsideScore.toFixed(0), weight: '20%' },
      { label: 'Goal coverage', score: goalScore.toFixed(0), weight: '12%' },
    ],
  };
}

/* ── Full simulation run (main entry point) ──────────────────────── */
export function rtRunSimulation(IN, NSIM) {
  // Ensure nSims is set
  const fullIN = { ...IN, nSims: NSIM || IN.nSims || 500 };

  const base = rtRunMC(fullIN);
  const sens = rtSensitivity(fullIN, base);
  const reqSIP = rtSolveSIP(fullIN, fullIN.targetConf || 85);
  const nextTarget = Math.min((fullIN.targetConf || 85) + 5, 95);
  const upgradeSIP = base.successRate < nextTarget ? rtSolveSIP(fullIN, nextTarget) : null;
  const score = rtPlanScore(base, fullIN, sens);
  const altRetAge = rtSolveRetAge(fullIN, fullIN.targetConf || 85);
  const altSpendPct = rtSolveSpend(fullIN, fullIN.targetConf || 85);

  // Merge everything into one result object (backwards-compatible with old shape)
  const R = { ...base };
  R.NSIM = fullIN.nSims;
  R.IN = fullIN;

  // Build legacy P10/P50/P90 full paths for report compatibility
  R.P10 = base.accumP10.concat(base.P10path.slice(1));
  R.P25 = base.accumP25.concat(base.P25path.slice(1));
  R.P50 = base.accumP50.concat(base.P50path.slice(1));
  R.P75 = base.accumP75.concat(base.P75path.slice(1));
  R.P90 = base.accumP90.concat(base.P90path.slice(1));

  // Corpus needed & monthly income (for Results display)
  const realR = (1 + IN.postMu) / (1 + IN.infl) - 1;
  const n = IN.lifeExp - IN.retAge;
  R.corpusNeeded = base.reqCorpus;
  R.incomeAtRet = (base.lifestyleAtRet / 12) * 100000; // ₹ absolute monthly

  // Sensitivity (in old format for Results display + new format)
  R.sens = [
    { label: 'Current plan', sr: base.successRate, base: true },
    ...sens.map(s => ({ label: s.label, sr: s.conf, delta: s.delta, key: s.key })),
  ];
  R.sensDetailed = sens;

  // Solvers
  R.reqSIP = reqSIP;
  R.upgradeSIP = upgradeSIP;
  R.nextTarget = nextTarget;
  R.altRetAge = altRetAge;
  R.altSpendPct = altSpendPct;

  // Plan score
  R.score = score;

  // Median depletion age
  const deps = base.depletionYrs;
  R.medianDepAge = base.sortedDep.length ? IN.retAge + base.sortedDep[Math.floor(base.sortedDep.length / 2)] : null;

  // Build goalsByYear and lumpsByYear maps (keyed by years-from-now) for report
  const goalsByYear = {};
  (fullIN.goals || []).forEach(g => {
    const yr = Math.round(g.age - fullIN.age);
    if (yr >= 0) goalsByYear[yr] = (goalsByYear[yr] || 0) + (g.amt || 0);
  });
  const lumpsByYear = {};
  (fullIN.lumps || []).forEach(l => {
    const yr = Math.round(l.age - fullIN.age);
    if (yr >= 0) lumpsByYear[yr] = (lumpsByYear[yr] || 0) + (l.amt || 0);
  });
  R.goalsByYear = goalsByYear;
  R.lumpsByYear = lumpsByYear;

  return R;
}

/* ── Legacy simulate export (for any code still calling it) ──────── */
export function rtSimulate(IN, NSIM) {
  return rtRunMC({ ...IN, nSims: NSIM });
}