'use strict';
/**
 * BugleRock Portfolio Proposal — PPTX Generator
 * Usage: node generate_proposal_pptx.js < data.json > proposal.pptx
 * Reads JSON from stdin, writes pptx bytes to stdout.
 */

const pptxgen = require('pptxgenjs');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

/* ── Read stdin ─────────────────────────────────────────────────── */
const raw = require('fs').readFileSync(0, 'utf8'); // fd 0 = stdin, works on all platforms
const D   = JSON.parse(raw);

const {
  client, rm, invest, goal, risk, tenure, deploy, targetRet,
  reviewFreq, constraints, notes, today, benchmarkName,
  funds, weights, snapshots, bmRets,
  B,        // blended portfolio metrics
  sipAmt, investAmt, tenureYrs,
} = D;

/* ── Brand colours ──────────────────────────────────────────────── */
const BERRY  = '912F63';
const PLUM   = '3E3452';
const LAV    = 'A795AE';
const MUT    = '6D5479';
const SPINK  = 'C46985';
const POS    = '1A7A52';
const NEG    = '912F63';
const WARN   = 'D97706';
const GR10   = 'F9F8F9';
const GR20   = 'F2F0F3';
const GR60   = 'A2A0A0';
const GR80   = '2C2A30';
const WHITE  = 'FFFFFF';

/* ── Helpers ────────────────────────────────────────────────────── */
function nb(v, d=1) { return v != null ? parseFloat(v).toFixed(d) : '—'; }
function pc(v)      { return v != null ? (parseFloat(v)>=0?'+':'')+parseFloat(v).toFixed(2)+'%' : '—'; }
function fmtL(v) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 10000000) return '₹'+(v/10000000).toFixed(1)+'Cr';
  if (abs >= 100000)   return '₹'+(v/100000).toFixed(2)+'L';
  return '₹'+(v/1000).toFixed(1)+'K';
}
function rc(v, good, bad)  { return v==null?GR60:parseFloat(v)>=good?POS:parseFloat(v)<=bad?NEG:WARN; }
function rcL(v, good, bad) { return v==null?GR60:parseFloat(v)<=good?POS:parseFloat(v)>=bad?NEG:WARN; }

const CAGR3   = (B.ret3y||0)/100;
const bmCAGR  = (bmRets.r3y||0)/100;
const bmCAGR5 = (bmRets.r5y||bmRets.r3y||0)/100;
const bmCAGR10= bmCAGR5;
const ptfCAGR = { 3:CAGR3, 5:(B.ret5y||B.ret3y||0)/100, 10:(B.ret5y||B.ret3y||0)/100 };
const investL = investAmt/100000;
const LUMP_FV = investL * Math.pow(1+CAGR3, tenureYrs);
const BM_FV   = investL * Math.pow(1+bmCAGR, tenureYrs);

// Sort funds by weight
const SF = [...funds].sort((a,b)=>(weights[b.isin]||0)-(weights[a.isin]||0));
const TOT= funds.reduce((s,f)=>s+(weights[f.isin]||0),0)||100;
SF.forEach(f=>{ f._wPct = (weights[f.isin]||0)/TOT*100; });

/* ── Slide geometry (16x9, inches) ─────────────────────────────── */
const W = 10, H = 5.625;
const ML = 0.45, MT = 0.38, MR = 0.45;
const CW = W - ML - MR; // content width

/* ── Init pptx ─────────────────────────────────────────────────── */
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author  = rm || 'BugleRock Capital';
pres.company = 'BugleRock Capital';
pres.subject = `Portfolio Proposal — ${client}`;
pres.title   = `Investment Proposal — ${client}`;

/* ══════════════════════════════════════════════════════════════════
   SLIDE HELPERS
══════════════════════════════════════════════════════════════════ */

/** Add standard slide with PLUM header bar */
function addSlide(title, subtitle) {
  const sl = pres.addSlide();
  // Header bar
  sl.addShape(pres.ShapeType.rect, {
    x:0, y:0, w:W, h:0.52,
    fill: { color: PLUM },
    line: { color: PLUM },
  });
  sl.addText(title, {
    x: ML, y: 0.07, w: CW*0.75, h: 0.38,
    fontSize: 16, bold: true, color: WHITE,
    fontFace: 'Cormorant Garamond', valign: 'middle',
  });
  if (subtitle) {
    sl.addText(subtitle, {
      x: ML, y: 0.42, w: CW, h: 0.22,
      fontSize: 8, color: LAV, italic: true,
    });
  }
  // Footer
  sl.addShape(pres.ShapeType.rect, {
    x:0, y:H-0.28, w:W, h:0.28,
    fill: { color: GR10 }, line: { color: GR20 },
  });
  sl.addText(`BügleRock Capital  ·  Sound of Clarity  ·  buglerock.asia  ·  ${today}`, {
    x: ML, y: H-0.26, w: CW*0.7, h: 0.22,
    fontSize: 7, color: GR60,
  });
  sl.addText(`${client}`, {
    x: W-MR-2.5, y: H-0.26, w: 2.5, h: 0.22,
    fontSize: 7, color: LAV, align: 'right',
  });
  return sl;
}

/** KPI box */
function addKpiBox(sl, x, y, w, h, val, lbl, sub, color) {
  sl.addShape(pres.ShapeType.rect, {
    x, y, w, h,
    fill: { color: GR10 }, line: { color: GR20, pt: 0.5 },
    rectRadius: 0.06,
  });
  sl.addText(val, {
    x: x+0.06, y: y+0.06, w: w-0.12, h: h*0.5,
    fontSize: 15, bold: true, color: color||GR80,
    fontFace: 'Cormorant Garamond', align: 'center', valign: 'bottom',
  });
  sl.addText(lbl, {
    x: x+0.06, y: y+h*0.52, w: w-0.12, h: h*0.24,
    fontSize: 7, bold: true, color: GR60,
    align: 'center', charSpacing: 0.5,
  });
  if (sub) {
    sl.addText(sub, {
      x: x+0.06, y: y+h*0.76, w: w-0.12, h: h*0.2,
      fontSize: 6.5, color: color||GR60, align: 'center',
    });
  }
}

/** Section number badge + title row */
function addSectionHd(sl, num, title, sub) {
  sl.addShape(pres.ShapeType.rect, {
    x: ML, y: 0.6, w: 0.28, h: 0.28,
    fill: { color: BERRY }, line: { color: BERRY },
  });
  sl.addText(num, {
    x: ML, y: 0.6, w: 0.28, h: 0.28,
    fontSize: 12, bold: true, color: WHITE,
    fontFace: 'Cormorant Garamond', align: 'center', valign: 'middle',
  });
  sl.addText(title, {
    x: ML+0.35, y: 0.6, w: CW-0.35, h: 0.28,
    fontSize: 14, bold: true, color: PLUM,
    fontFace: 'Cormorant Garamond', valign: 'middle',
  });
  if (sub) {
    sl.addText(sub, {
      x: ML+0.35, y: 0.88, w: CW-0.35, h: 0.16,
      fontSize: 7.5, color: GR60, italic: true,
    });
  }
}

/** Table header row style */
const TH_OPTS = { bold: true, fontSize: 7.5, color: LAV, fill: GR10, align: 'center', border: [{pt:0,color:'FFFFFF'},{pt:0,color:'FFFFFF'},{pt:1,color:GR20},{pt:0,color:'FFFFFF'}] };
const TD_OPTS = { fontSize: 8.5, color: GR80, fill: WHITE, border: [{pt:0},{pt:0},{pt:0.5,color:GR20},{pt:0}] };
const TD_MONO = { ...TD_OPTS, fontFace: 'DM Mono' };

/* ══════════════════════════════════════════════════════════════════
   SLIDE 1 — COVER
══════════════════════════════════════════════════════════════════ */
{
  const sl = pres.addSlide();

  // Gradient accent bar (top)
  sl.addShape(pres.ShapeType.rect, { x:0, y:0, w:W, h:0.06, fill:{ color: BERRY }, line:{ color: BERRY } });
  sl.addShape(pres.ShapeType.rect, { x:W*0.33, y:0, w:W*0.34, h:0.06, fill:{ color: MUT }, line:{ color: MUT } });
  sl.addShape(pres.ShapeType.rect, { x:W*0.67, y:0, w:W*0.33, h:0.06, fill:{ color: LAV }, line:{ color: LAV } });

  // Left: client name + details
  sl.addText('INVESTMENT PROPOSAL', {
    x: ML, y: 0.22, w: 5.5, h: 0.22,
    fontSize: 8, bold: true, color: LAV, charSpacing: 2.5,
  });
  sl.addText(client, {
    x: ML, y: 0.44, w: 5.8, h: 0.9,
    fontSize: 36, bold: true, color: PLUM,
    fontFace: 'Cormorant Garamond', valign: 'top',
  });
  sl.addText([
    { text: 'Objective: ',  options: { bold: true, color: GR80 } },
    { text: goal+'\n',      options: { color: GR60 } },
    { text: 'Risk profile: ',options: { bold: true, color: GR80 } },
    { text: risk+'\n',      options: { color: GR60 } },
    { text: 'Horizon: ',    options: { bold: true, color: GR80 } },
    { text: tenure+' years',options: { color: GR60 } },
  ], {
    x: ML, y: 1.38, w: 5.2, h: 0.72,
    fontSize: 9.5, lineSpacingMultiple: 1.6,
  });

  // Divider line
  sl.addShape(pres.ShapeType.line, {
    x: ML, y: 2.18, w: CW, h: 0,
    line: { color: GR20, pt: 0.75 },
  });

  // Right: BugleRock + date
  sl.addText('BügleRock Capital', {
    x: 6.2, y: 0.22, w: 3.35, h: 0.44,
    fontSize: 20, bold: true, color: BERRY,
    fontFace: 'Cormorant Garamond', align: 'right',
  });
  sl.addText('Sound of Clarity', {
    x: 6.2, y: 0.66, w: 3.35, h: 0.2,
    fontSize: 7.5, color: LAV, align: 'right', charSpacing: 2,
  });
  sl.addText([
    { text: 'Date: ',        options: { bold: true, color: GR80 } },
    { text: today+'\n',      options: { color: GR60 } },
    { text: 'Prepared by: ', options: { bold: true, color: GR80 } },
    { text: (rm||'BugleRock Capital')+'\n', options: { color: GR60 } },
    { text: 'Investment: ',  options: { bold: true, color: GR80 } },
    { text: invest||'—',     options: { color: GR60 } },
  ], {
    x: 6.2, y: 1.0, w: 3.35, h: 0.72,
    fontSize: 9.5, align: 'right', lineSpacingMultiple: 1.6,
  });

  // KPI cards (4 across bottom)
  const CALS = [
    [SF.length+' funds', 'Portfolio size', 'Diversified allocation', PLUM],
    [pc(B.ret3y), '3Y CAGR (blended)', pc(bmRets.r3y)+' benchmark', rc(B.ret3y,0,-5)],
    [nb(B.sharpe), 'Sharpe ratio (3Y)', 'Risk-adjusted quality', rc(B.sharpe,0.5,0.3)],
    [fmtL(LUMP_FV*100000), tenureYrs+'Y projected', fmtL(BM_FV*100000)+' benchmark', BERRY],
  ];
  const kw = (CW-0.36)/4, ky = 2.32, kh = 1.02;
  CALS.forEach(([v,l,s,c],i) => addKpiBox(sl, ML+i*(kw+0.12), ky, kw, kh, v, l, s, c));

  // Footer
  sl.addShape(pres.ShapeType.rect, { x:0, y:H-0.28, w:W, h:0.28, fill:{ color: GR10 }, line:{ color: GR20 } });
  sl.addText('BügleRock Capital · CMS Licence 100978 · buglerock.asia · Sound of Clarity', {
    x: ML, y: H-0.26, w: CW, h: 0.22, fontSize: 7, color: GR60,
  });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 2 — IPS
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('01  Investment Policy Statement', 'Defines the client\'s objectives, constraints and guidelines governing this portfolio.');
  addSectionHd(sl, '01', 'Investment Policy Statement', "Defines the client's objectives, constraints and guidelines.");

  const cells = [
    ['Client / entity', client],
    ['Prepared by', rm||'BugleRock Capital'],
    ['Investment amount', invest||'—'],
    ['Proposal date', today],
    ['Primary objective', goal||'—'],
    ['Risk profile', risk||'—'],
    ['Investment tenure', tenure ? tenure+' years' : '—'],
    ['Target return', targetRet||'—'],
    ['Deployment mode', deploy||'—'],
    ['Review frequency', reviewFreq||'—'],
    ['Monthly SIP', sipAmt>0 ? '₹'+sipAmt.toLocaleString('en-IN') : '—'],
    ['Benchmark', benchmarkName||'—'],
  ];

  const cols = 4, rows = Math.ceil(cells.length/cols);
  const cw2 = CW/cols, ch2 = 0.48;
  const startY = 1.08;
  cells.forEach(([lbl,val],i) => {
    const col = i%cols, row = Math.floor(i/cols);
    const bx = ML+col*cw2, by = startY+row*(ch2+0.06);
    sl.addShape(pres.ShapeType.rect, { x:bx, y:by, w:cw2-0.06, h:ch2, fill:{ color: WHITE }, line:{ color: GR20, pt:0.5 } });
    sl.addText(lbl.toUpperCase(), { x:bx+0.08, y:by+0.05, w:cw2-0.2, h:0.14, fontSize:6.5, bold:true, color:LAV, charSpacing:0.3 });
    sl.addText(val, { x:bx+0.08, y:by+0.2, w:cw2-0.2, h:0.24, fontSize:9, bold:true, color:GR80 });
  });

  if (constraints) {
    const cy = startY + rows*(ch2+0.06) + 0.1;
    sl.addShape(pres.ShapeType.rect, { x:ML, y:cy, w:CW, h:0.55, fill:{ color: GR10 }, line:{ color: GR20, pt:0.5 } });
    sl.addText('CONSTRAINTS & EXCLUSIONS', { x:ML+0.1, y:cy+0.06, w:CW-0.2, h:0.14, fontSize:6.5, bold:true, color:LAV });
    sl.addText(constraints, { x:ML+0.1, y:cy+0.22, w:CW-0.2, h:0.3, fontSize:8.5, color:GR80 });
  }
  if (notes) {
    const ny = startY + rows*(ch2+0.06) + (constraints?0.72:0.1);
    sl.addShape(pres.ShapeType.rect, { x:ML, y:ny, w:CW, h:0.55, fill:{ color: GR10 }, line:{ color: GR20, pt:0.5 } });
    sl.addText('ADVISER NOTES', { x:ML+0.1, y:ny+0.06, w:CW-0.2, h:0.14, fontSize:6.5, bold:true, color:LAV });
    sl.addText(notes, { x:ML+0.1, y:ny+0.22, w:CW-0.2, h:0.3, fontSize:8.5, color:GR80 });
  }
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 3 — PORTFOLIO OVERVIEW
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('02  Portfolio Overview', `Blended analytics for the recommended ${SF.length}-fund portfolio vs ${benchmarkName}.`);
  addSectionHd(sl, '02', 'Portfolio Overview', `${SF.length}-fund blended portfolio analytics vs ${benchmarkName}.`);

  // Score box (left)
  const OVERALL = Math.min(100, Math.round((
    ((B.ret3y||0)>=12?90:(B.ret3y||0)>=8?65:38) +
    ((B.sharpe||0)>=0.7?90:(B.sharpe||0)>=0.4?65:38) +
    ((B.alpha||0)>=2?90:(B.alpha||0)>=0?65:38) +
    ((B.dncap||100)<=90?90:(B.dncap||100)<=100?65:38) +
    ((B.er||0)<=1.0?90:(B.er||0)<=1.5?65:38)
  )/5));
  const SC_CLR = OVERALL>=80?POS:OVERALL>=60?WARN:NEG;
  const SC_LBL = OVERALL>=80?'Strong':OVERALL>=60?'Adequate':'Needs review';
  sl.addShape(pres.ShapeType.rect, { x:ML, y:1.08, w:1.1, h:1.1, fill:{ color: GR10 }, line:{ color: SC_CLR, pt:1.5 } });
  sl.addText(String(OVERALL), { x:ML, y:1.1, w:1.1, h:0.72, fontSize:36, bold:true, color:SC_CLR, fontFace:'Cormorant Garamond', align:'center', valign:'bottom' });
  sl.addText('/100', { x:ML, y:1.82, w:1.1, h:0.14, fontSize:7.5, bold:true, color:SC_CLR, align:'center' });
  sl.addText(SC_LBL, { x:ML, y:1.96, w:1.1, h:0.18, fontSize:8, bold:true, color:SC_CLR, align:'center' });

  // 8 KPI cells (right of score)
  const kpis = [
    [pc(B.ret1y),'1Y Return',pc(bmRets.r1y)+' bm',rc(B.ret1y,0,-5)],
    [pc(B.ret3y),'3Y CAGR',pc(bmRets.r3y)+' bm',rc(B.ret3y,0,-5)],
    [pc(B.ret5y),'5Y CAGR',pc(bmRets.r5y)+' bm',rc(B.ret5y,0,-5)],
    [nb(B.sharpe),'Sharpe (3Y)',nb(B.sortino)+' Sortino',rc(B.sharpe,0.5,0.3)],
    [pc(B.alpha),'Alpha (3Y)','vs '+benchmarkName,rc(B.alpha,0,-2)],
    [nb(B.dncap)+'%','Down capture','≤100% protective',rcL(B.dncap,95,105)],
    [nb(B.er)+'%','Blended ER','Expense ratio',rcL(B.er,1.0,1.8)],
    [nb(B.std3y)+'%','Std Dev (3Y)','Annualised vol',rcL(B.std3y,14,20)],
  ];
  const gkw=(CW-1.22)/4, gkh=0.5, gky=1.08;
  kpis.forEach(([v,l,s,c],i) => {
    const col=i%4, row=Math.floor(i/4);
    addKpiBox(sl, ML+1.22+col*(gkw+0.06), gky+row*(gkh+0.08), gkw, gkh, v, l, s, c);
  });

  // Fund list (left col)
  const fy = 2.32, fh = (H-fy-0.36)/SF.length;
  sl.addText('FUND ALLOCATION', { x:ML, y:fy-0.18, w:3.8, h:0.16, fontSize:7, bold:true, color:BERRY, charSpacing:0.5 });
  SF.slice(0,8).forEach((f,i) => {
    const by = fy+i*Math.min(fh,0.3);
    sl.addShape(pres.ShapeType.rect, { x:ML, y:by, w:0.04, h:0.22, fill:{ color:(f.color||'A795AE').replace('#','') }, line:{ color:(f.color||'A795AE').replace('#','') } });
    sl.addText(f.name.length>35?f.name.slice(0,35)+'…':f.name, { x:ML+0.1, y:by, w:3.0, h:0.14, fontSize:8, bold:true, color:GR80 });
    sl.addText(f.category||'', { x:ML+0.1, y:by+0.12, w:2.6, h:0.12, fontSize:7, color:GR60 });
    sl.addText(f._wPct.toFixed(1)+'%', { x:ML+3.1, y:by, w:0.6, h:0.22, fontSize:9, bold:true, color:(f.color||'A795AE').replace('#',''), align:'right', valign:'middle' });
  });

  // Cap mix (right col)
  const capData = [
    [B.lc,'Large cap',BERRY], [B.mc,'Mid cap',MUT], [B.sc,'Small cap',SPINK],
    [B.bond_pct,'Bonds/Debt',LAV], [B.cash_pct,'Cash/Liquid',GR60],
  ].filter(r=>(r[0]||0)>0.5);
  const cx2 = ML+4.2;
  sl.addText('MARKET CAP & ASSET MIX', { x:cx2, y:fy-0.18, w:CW-4.2, h:0.16, fontSize:7, bold:true, color:BERRY, charSpacing:0.5 });
  capData.forEach((r,i) => {
    const by=fy+i*0.34;
    sl.addText(r[1], { x:cx2, y:by+0.08, w:1.0, h:0.2, fontSize:8.5, color:GR80, align:'right' });
    const bw = Math.max(0.05,(r[0]||0)/100*3.5);
    sl.addShape(pres.ShapeType.rect, { x:cx2+1.08, y:by+0.1, w:bw, h:0.16, fill:{ color:r[2] }, line:{ color:r[2] } });
    sl.addText(nb(r[0],1)+'%', { x:cx2+1.12+bw, y:by+0.08, w:0.6, h:0.2, fontSize:8.5, bold:true, color:r[2] });
  });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 4 — PERFORMANCE
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('03  Performance Analysis', `Returns across all periods and calendar years vs ${benchmarkName}.`);
  addSectionHd(sl, '03', 'Performance Analysis', `Returns across all periods and calendar years vs ${benchmarkName}.`);

  // Trailing returns table (left)
  const periods = [
    ['1 month', B.ret1m, bmRets.r1m],
    ['3 months', B.ret3m, bmRets.r3m],
    ['Year to date', B.ytd, bmRets.ytd],
    ['1 year', B.ret1y, bmRets.r1y],
    ['3 years (CAGR)', B.ret3y, bmRets.r3y],
    ['5 years (CAGR)', B.ret5y, bmRets.r5y],
  ];
  const tRows = [
    [{ text:'Period', options:{...TH_OPTS,align:'left'} }, { text:'Portfolio', options:TH_OPTS }, { text:'Benchmark', options:TH_OPTS }, { text:'Diff', options:TH_OPTS }],
    ...periods.map(([lbl,pv,bv]) => {
      const d = pv!=null&&bv!=null ? parseFloat(pv)-parseFloat(bv) : null;
      return [
        { text:lbl, options:{...TD_OPTS,align:'left',bold:false} },
        { text:pc(pv), options:{...TD_MONO, align:'right', bold:true, color:rc(pv,0,-5)} },
        { text:pc(bv), options:{...TD_MONO, align:'right', color:GR60} },
        { text:d!=null?pc(d):'—', options:{...TD_MONO, align:'right', bold:true, color:d!=null?(d>=0?POS:NEG):GR60} },
      ];
    }),
  ];
  sl.addTable(tRows, { x:ML, y:1.08, w:4.5, colW:[1.4,1.0,1.0,1.1], rowH:0.32, border:{pt:0}, margin:4 });

  // CY bar chart (right)
  const CYK = ['cy21','cy22','cy23','cy24','cy25'];
  const CYL = ['2021','2022','2023','2024','2025'];
  const cyPtf = CYK.map(k=>B[k]!=null?parseFloat(B[k]):null);
  const cyBm  = CYK.map((_,i)=>bmRets['r'+CYL[i].slice(2)]!=null?parseFloat(bmRets['r'+CYL[i].slice(2)]):null);

  const chartData = [
    { name:'Portfolio', labels: CYL, values: cyPtf.map(v=>v??0) },
    { name: benchmarkName, labels: CYL, values: cyBm.map(v=>v??0) },
  ];
  sl.addChart(pres.ChartType.bar, chartData, {
    x: ML+4.7, y: 1.08, w: CW-4.7, h: 3.3,
    barDir: 'col', barGrouping: 'clustered',
    chartColors: [BERRY, LAV],
    showLegend: true, legendPos: 'b', legendFontSize: 8,
    showValue: true, dataLabelFontSize: 7, dataLabelColor: GR80,
    catAxisLabelFontSize: 8, valAxisLabelFontSize: 7,
    valGridLine: { color: GR20, size: 0.5 },
    catGridLine: { style: 'none' },
    valAxisNumFmt: '0.0"%"',
  });

  // Callout
  const spreadGap = (B.ret3y||0)-(bmRets.r3y||0);
  const calloutTxt = `Portfolio 3Y CAGR of ${pc(B.ret3y)} vs benchmark ${pc(bmRets.r3y)} — a spread of ${spreadGap>=0?'+':''}${spreadGap.toFixed(2)}%. ${spreadGap>0?'Consistent positive alpha demonstrates active fund selection skill.':'Portfolio has lagged benchmark — review fund selection.'}`;
  sl.addShape(pres.ShapeType.rect, {
    x:ML, y:4.48, w:CW, h:0.48,
    fill:{ color: spreadGap>=0?'E6F4ED':'FEF9EC' }, line:{ color: spreadGap>=0?POS:WARN, pt:0.5 },
  });
  sl.addText(calloutTxt, { x:ML+0.12, y:4.5, w:CW-0.24, h:0.44, fontSize:8, color: spreadGap>=0?POS:WARN, valign:'middle' });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 5 — WEALTH CREATION
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('04  Wealth Creation Projection', `Based on blended 3Y CAGR of ${pc(B.ret3y)} over 10 years.`);
  addSectionHd(sl, '04', 'Wealth Creation Projection', `Based on blended 3Y CAGR of ${pc(B.ret3y)} over 10 years.`);

  // Big corpus number
  const ptf10 = investL * Math.pow(1+ptfCAGR[10], 10) * 100000;
  const bm10  = bmCAGR10>0 ? investL*Math.pow(1+bmCAGR10,10)*100000 : null;
  const extra = bm10!=null ? ptf10-bm10 : null;

  sl.addText('Projected wealth after 10 years', { x:ML, y:1.06, w:5.5, h:0.2, fontSize:8, bold:true, color:GR60, charSpacing:0.3 });
  sl.addText(fmtL(ptf10), { x:ML, y:1.24, w:5.5, h:0.62, fontSize:32, bold:true, color:BERRY, fontFace:'Cormorant Garamond' });
  sl.addText(bm10!=null?`vs ${fmtL(bm10)} (${benchmarkName})`:'', { x:ML, y:1.84, w:5.5, h:0.2, fontSize:9, color:GR60 });
  if (extra!=null) sl.addText(`${extra>=0?'+':''}${fmtL(extra)} extra wealth created`, { x:ML, y:2.02, w:5.5, h:0.22, fontSize:10, bold:true, color:extra>=0?POS:NEG });

  // Line chart (growth projection)
  const yrs = [0,1,2,3,4,5,6,7,8,9,10];
  const ptfVals = yrs.map(y=>+(investL*Math.pow(1+ptfCAGR[10],y)).toFixed(2));
  const bmVals  = yrs.map(y=>+(bmCAGR10>0?investL*Math.pow(1+bmCAGR10,y):investL).toFixed(2));
  sl.addChart(pres.ChartType.line, [
    { name:'Portfolio', labels:yrs.map(String), values:ptfVals },
    { name:benchmarkName, labels:yrs.map(String), values:bmVals },
  ], {
    x:ML, y:2.3, w:5.5, h:1.85,
    chartColors:[BERRY, LAV],
    lineDataSymbol:'none', lineSmooth:true,
    showLegend:true, legendPos:'b', legendFontSize:7,
    showValue:false,
    catAxisLabelFontSize:7, valAxisLabelFontSize:7,
    valGridLine:{ color:GR20, size:0.5 }, catGridLine:{ style:'none' },
    valAxisNumFmt:'0.00',
  });

  // 3/5/10 year table (right)
  const tRows2 = [
    [{ text:'Horizon', options:{...TH_OPTS,align:'left'} }, { text:'Portfolio', options:TH_OPTS }, { text:'Benchmark', options:TH_OPTS }, { text:'Extra', options:TH_OPTS }],
    ...[3,5,10].map(y => {
      const pv = investL*Math.pow(1+ptfCAGR[y],y)*100000;
      const bc = y===3?bmCAGR:(y===5?bmCAGR5:bmCAGR10);
      const bv = bc>0?investL*Math.pow(1+bc,y)*100000:null;
      const ex = bv!=null?pv-bv:null;
      return [
        { text:y+' yrs', options:{...TD_OPTS,align:'left'} },
        { text:fmtL(pv), options:{...TD_MONO,align:'right',bold:true,color:BERRY} },
        { text:bv!=null?fmtL(bv):'—', options:{...TD_MONO,align:'right',color:LAV} },
        { text:ex!=null?(ex>=0?'+':'')+fmtL(ex):'—', options:{...TD_MONO,align:'right',bold:true,color:ex!=null?(ex>=0?POS:NEG):GR60} },
      ];
    }),
  ];
  sl.addTable(tRows2, { x:ML+5.7, y:1.06, w:CW-5.7, colW:[0.8,1.0,1.0,1.0], rowH:0.36, border:{pt:0}, margin:4 });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 6 — RISK PROFILE
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('05  Risk Profile & Quality', 'Comprehensive risk metrics with market-context interpretation.');
  addSectionHd(sl, '05', 'Risk Profile & Quality', 'Comprehensive risk metrics with market-context interpretation.');

  // Risk metrics table (left)
  const riskRows = [
    ['Sharpe ratio (3Y)', nb(B.sharpe), rc(B.sharpe,0.7,0.4), (B.sharpe||0)>=0.7?'Strong':(B.sharpe||0)>=0.4?'Adequate':'Weak'],
    ['Alpha (3Y)', pc(B.alpha), rc(B.alpha,0,-2), (B.alpha||0)>=2?'Outperforming':(B.alpha||0)>=0?'Neutral':'Lagging'],
    ['Beta (3Y)', nb(B.beta), Math.abs(((B.beta||1)-1))<0.15?POS:WARN, (B.beta||1)<0.9?'Defensive':(B.beta||1)<=1.1?'Market-like':'Aggressive'],
    ['Down capture (3Y)', nb(B.dncap)+'%', rcL(B.dncap,90,105), (B.dncap||100)<=90?'Protected':(B.dncap||100)<=100?'On par':'Amplified'],
    ['Up capture (3Y)', nb(B.upcap)+'%', rc(B.upcap,100,90), (B.upcap||0)>=100?'Outpacing':'Lagging'],
    ['Std deviation (3Y)', nb(B.std3y)+'%', rcL(B.std3y,14,20), (B.std3y||0)<=14?'Low vol':(B.std3y||0)<=20?'Moderate':'High vol'],
    ['Blended ER', nb(B.er)+'%', rcL(B.er,1.0,1.8), (B.er||0)<=1.0?'Cost-efficient':(B.er||0)<=1.5?'Reasonable':'Review costs'],
  ];
  const rTblRows = [
    [{ text:'Metric', options:{...TH_OPTS,align:'left'} }, { text:'Value', options:TH_OPTS }, { text:'Rating', options:TH_OPTS }],
    ...riskRows.map(([m,v,c,lbl]) => [
      { text:m, options:{...TD_OPTS,align:'left',bold:true} },
      { text:v, options:{...TD_MONO,align:'right',bold:true,color:c} },
      { text:lbl, options:{...TD_OPTS,align:'center',bold:true,color:c} },
    ]),
  ];
  sl.addTable(rTblRows, { x:ML, y:1.08, w:4.4, colW:[2.0,1.0,1.4], rowH:0.3, border:{pt:0}, margin:4 });

  // Stress test table (right)
  const SCEN = [
    {n:'COVID crash — Mar 2020',     drop:-38, lcF:1.00, mcF:1.12, scF:1.25, bdF:-0.10},
    {n:'IL&FS crisis — 2018',        drop:-15, lcF:0.90, mcF:1.40, scF:1.60, bdF:0.05},
    {n:'GFC — 2009',                 drop:-55, lcF:1.00, mcF:1.10, scF:1.20, bdF:-0.30},
    {n:'US inflation shock — 2022',  drop:-16, lcF:0.90, mcF:1.00, scF:1.10, bdF:0.30},
    {n:'Hypothetical −25%',          drop:-25, lcF:1.00, mcF:1.15, scF:1.30, bdF:-0.20},
  ];
  function bDrop(sc) {
    let d=0;
    SF.forEach(f=>{
      const w=f._wPct/100;
      const cat=(f.category||'').toLowerCase();
      const isD=cat.includes('debt')||cat.includes('liquid')||cat.includes('bond');
      const sn=snapshots[f.isin]||{};
      const scPct=parseFloat(sn.small_cap)||0, mcPct=parseFloat(sn.mid_cap)||0;
      const factor=isD?sc.bdF:scPct>40?sc.scF:mcPct>40?sc.mcF:sc.lcF;
      d+=w*sc.drop*factor;
    });
    return d;
  }
  sl.addText('CRASH SCENARIO STRESS TEST', { x:ML+4.6, y:1.0, w:CW-4.6, h:0.16, fontSize:7, bold:true, color:BERRY, charSpacing:0.5 });
  const sTblRows = [
    [{ text:'Scenario', options:{...TH_OPTS,align:'left'} }, { text:'Market', options:TH_OPTS }, { text:'Portfolio', options:TH_OPTS }, { text:'Cushion', options:TH_OPTS }],
    ...SCEN.map(sc => {
      const pd=bDrop(sc), delta=pd-sc.drop;
      return [
        { text:sc.n, options:{...TD_OPTS,align:'left',fontSize:7.5} },
        { text:nb(sc.drop,1)+'%', options:{...TD_MONO,align:'right',bold:true,color:NEG} },
        { text:nb(pd,1)+'%', options:{...TD_MONO,align:'right',bold:true,color:pd>sc.drop?POS:NEG} },
        { text:(delta>=0?'↑ +':'↓ ')+nb(delta,1)+'%', options:{...TD_MONO,align:'right',bold:true,color:delta>=0?POS:NEG} },
      ];
    }),
  ];
  sl.addTable(sTblRows, { x:ML+4.6, y:1.18, w:CW-4.6, colW:[2.0,0.8,0.8,0.9], rowH:0.3, border:{pt:0}, margin:4 });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 7 — EXPOSURE & STYLE
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('06  Portfolio Exposure & Style', 'Market cap, asset class, valuation and growth/value characteristics.');
  addSectionHd(sl, '06', 'Portfolio Exposure & Style', 'Market cap, asset class, valuation and growth/value characteristics.');

  // Cap bars
  const capData = [
    [B.lc,'Large cap',BERRY], [B.mc,'Mid cap',MUT], [B.sc,'Small cap',SPINK],
    [B.bond_pct,'Bonds/Debt',LAV], [B.cash_pct,'Cash',GR60],
  ].filter(r=>(r[0]||0)>0.5);
  sl.addText('MARKET CAP & ASSET MIX', { x:ML, y:1.08, w:3.2, h:0.16, fontSize:7, bold:true, color:BERRY, charSpacing:0.5 });
  capData.forEach((r,i) => {
    const by = 1.3+i*0.36;
    sl.addText(r[1], { x:ML, y:by+0.06, w:1.0, h:0.2, fontSize:8.5, color:GR80, align:'right' });
    const bw=Math.max(0.05,(r[0]||0)/100*2.0);
    sl.addShape(pres.ShapeType.rect, { x:ML+1.08, y:by+0.08, w:bw, h:0.16, fill:{ color:r[2] }, line:{ color:r[2] } });
    sl.addText(nb(r[0],1)+'%', { x:ML+1.12+bw, y:by+0.06, w:0.5, h:0.2, fontSize:8.5, bold:true, color:r[2] });
  });

  // Valuation table (middle)
  const valRows = [
    ['Std deviation (3Y)', nb(B.std3y)+'%', 'Annualised vol', rcL(B.std3y,14,20)],
    ['Beta (3Y)', nb(B.beta), 'Market sensitivity', Math.abs(((B.beta||1)-1))<0.15?POS:WARN],
    ['Blended ER', nb(B.er)+'%', '<1.0% = low cost', rcL(B.er,1.0,1.8)],
    ['Down capture', nb(B.dncap)+'%', '≤90% = protected', rcL(B.dncap,90,105)],
    ['Up capture', nb(B.upcap)+'%', '≥100% = outpacing', rc(B.upcap,100,90)],
  ];
  const vTblRows = [
    [{ text:'Metric', options:{...TH_OPTS,align:'left'} }, { text:'Value', options:TH_OPTS }, { text:'Context', options:{...TH_OPTS,align:'left'} }],
    ...valRows.map(([m,v,ctx,c])=>[
      { text:m, options:{...TD_OPTS,align:'left'} },
      { text:v, options:{...TD_MONO,align:'right',bold:true,color:c} },
      { text:ctx, options:{...TD_OPTS,align:'left',fontSize:7.5,color:GR60} },
    ]),
  ];
  sl.addTable(vTblRows, { x:ML+3.4, y:1.08, w:3.2, colW:[1.4,0.8,1.0], rowH:0.3, border:{pt:0}, margin:4 });

  // Style narrative (right)
  const capBias = (B.lc||0)>60 ? `Large-cap dominated (${nb(B.lc,0)}%). Lower volatility, steady market-like returns.`
    : (B.sc||0)>25 ? `Small-cap heavy (${nb(B.sc,0)}%). Higher growth potential, elevated volatility.`
    : 'Diversified cap mix — balanced growth and stability across market cycles.';
  const defText = (B.beta||1)<0.9 ? 'Portfolio moves less than the market in both directions — strong cushion in corrections.'
    : (B.beta||1)<=1.1 ? 'Portfolio broadly tracks the market.'
    : 'Portfolio amplifies market moves — higher risk/reward profile.';
  const dnText = (B.dncap||100)<=90 ? `Down capture of ${nb(B.dncap)}% — falls significantly less than benchmark in drawdowns.`
    : (B.dncap||100)<=100 ? `Down capture of ${nb(B.dncap)}% — falls broadly in line with market in corrections.`
    : `Down capture of ${nb(B.dncap)}% — amplifies drawdowns. Consider adding defensive holdings.`;

  sl.addShape(pres.ShapeType.rect, { x:ML+6.72, y:1.08, w:CW-6.72, h:3.5, fill:{ color:GR10 }, line:{ color:GR20, pt:0.5 } });
  sl.addText('STYLE & CHARACTERISTICS', { x:ML+6.82, y:1.16, w:CW-6.92, h:0.16, fontSize:7, bold:true, color:BERRY, charSpacing:0.5 });
  sl.addText([
    { text:'Cap bias:  ', options:{ bold:true, color:PLUM } }, { text:capBias+'\n\n', options:{ color:GR80 } },
    { text:'Defensiveness:  ', options:{ bold:true, color:PLUM } }, { text:defText+'\n\n', options:{ color:GR80 } },
    { text:'Downside:  ', options:{ bold:true, color:PLUM } }, { text:dnText, options:{ color:GR80 } },
  ], { x:ML+6.82, y:1.36, w:CW-6.92, h:3.1, fontSize:8.5, lineSpacingMultiple:1.55, valign:'top' });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDE 8 — FUND DETAILS
══════════════════════════════════════════════════════════════════ */
{
  const sl = addSlide('07  Fund Details', `Complete data for all ${SF.length} holdings in the recommended portfolio.`);
  addSectionHd(sl, '07', 'Fund Details', `Complete data for all ${SF.length} holdings.`);

  const fTblRows = [
    [
      { text:'Fund', options:{...TH_OPTS,align:'left'} },
      { text:'Weight', options:TH_OPTS }, { text:'ER', options:TH_OPTS },
      { text:'1Y', options:TH_OPTS }, { text:'3Y CAGR', options:TH_OPTS },
      { text:'5Y CAGR', options:TH_OPTS }, { text:'Sharpe', options:TH_OPTS },
      { text:'Alpha', options:TH_OPTS }, { text:'Dn cap', options:TH_OPTS },
    ],
    ...SF.map((f,i) => {
      const s = snapshots[f.isin]||{};
      const er=s.expense_ratio!=null?parseFloat(s.expense_ratio):null;
      const r1=s.returns?.['1y']!=null?parseFloat(s.returns['1y']):null;
      const r3=s.returns?.['3y']!=null?parseFloat(s.returns['3y']):null;
      const r5=s.returns?.['5y']!=null?parseFloat(s.returns['5y']):null;
      const sh=s.risk?.sharpe_ratio_3y!=null?parseFloat(s.risk.sharpe_ratio_3y):null;
      const al=s.risk?.alpha_3y!=null?parseFloat(s.risk.alpha_3y):null;
      const dc=s.risk?.down_capture_3y!=null?parseFloat(s.risk.down_capture_3y):null;
      const bg = i%2===0?WHITE:GR10;
      function td2(v,c){ return { text:v, options:{...TD_MONO,align:'right',fill:bg,color:c||GR80} }; }
      return [
        { text:f.name.length>30?f.name.slice(0,30)+'…':f.name, options:{...TD_OPTS,align:'left',fill:bg,bold:true,fontSize:8} },
        td2(f._wPct.toFixed(1)+'%', MUT),
        td2(er!=null?er.toFixed(2)+'%':'—', rcL(er,1.2,1.8)),
        td2(pc(r1), rc(r1,0,-5)),
        td2(pc(r3), rc(r3,0,-5)),
        td2(pc(r5), rc(r5,0,-5)),
        td2(nb(sh), rc(sh,0.5,0.3)),
        td2(pc(al), rc(al,0,-2)),
        td2(dc!=null?nb(dc)+'%':'—', rcL(dc,90,105)),
      ];
    }),
    // Blended footer
    [
      { text:'Blended portfolio', options:{...TD_OPTS,align:'left',fill:PLUM,color:WHITE,bold:true} },
      { text:'100%', options:{...TD_MONO,align:'right',fill:PLUM,color:WHITE,bold:true} },
      { text:nb(B.er)+'%', options:{...TD_MONO,align:'right',fill:PLUM,color:WHITE,bold:true} },
      { text:pc(B.ret1y), options:{...TD_MONO,align:'right',fill:PLUM,color:(B.ret1y||0)>=0?'A4E4C0':'FFB3B3',bold:true} },
      { text:pc(B.ret3y), options:{...TD_MONO,align:'right',fill:PLUM,color:(B.ret3y||0)>=0?'A4E4C0':'FFB3B3',bold:true} },
      { text:pc(B.ret5y), options:{...TD_MONO,align:'right',fill:PLUM,color:(B.ret5y||0)>=0?'A4E4C0':'FFB3B3',bold:true} },
      { text:nb(B.sharpe), options:{...TD_MONO,align:'right',fill:PLUM,color:WHITE,bold:true} },
      { text:pc(B.alpha), options:{...TD_MONO,align:'right',fill:PLUM,color:(B.alpha||0)>=0?'A4E4C0':'FFB3B3',bold:true} },
      { text:B.dncap!=null?nb(B.dncap)+'%':'—', options:{...TD_MONO,align:'right',fill:PLUM,color:WHITE,bold:true} },
    ],
  ];
  sl.addTable(fTblRows, {
    x:ML, y:1.06, w:CW,
    colW:[2.4,0.6,0.55,0.7,0.7,0.7,0.6,0.6,0.65],
    rowH:0.29, border:{pt:0}, margin:3,
  });
}

/* ══════════════════════════════════════════════════════════════════
   SLIDES 9+ — ANNEXURE: PER-FUND CARDS
══════════════════════════════════════════════════════════════════ */
SF.forEach((f, fi) => {
  const s = snapshots[f.isin]||{};
  const sl = addSlide(`A${fi+1}  ${f.name}`, `${f.category||''} · ${f.isin||''}`);

  // Fund header card
  sl.addShape(pres.ShapeType.rect, { x:ML, y:0.6, w:CW, h:0.62, fill:{ color:PLUM }, line:{ color:PLUM } });
  sl.addText(f.name, { x:ML+0.14, y:0.66, w:CW-1.8, h:0.3, fontSize:14, bold:true, color:WHITE, fontFace:'Cormorant Garamond' });
  sl.addText(`${f.category||''} · ${f.isin||''}`, { x:ML+0.14, y:0.94, w:CW-1.8, h:0.2, fontSize:8, color:LAV });
  sl.addShape(pres.ShapeType.rect, { x:W-MR-1.1, y:0.68, w:1.0, h:0.3, fill:{ color:(f.color||'A795AE').replace('#','') }, line:{ color:(f.color||'A795AE').replace('#','') } });
  sl.addText(f._wPct.toFixed(0)+'%', { x:W-MR-1.1, y:0.68, w:1.0, h:0.3, fontSize:14, bold:true, color:WHITE, fontFace:'DM Mono', align:'center', valign:'middle' });

  // 8-metric grid
  const metrics = [
    [pc(s.returns?.['1y']),'1Y Return',rc(parseFloat(s.returns?.['1y']),0,-5)],
    [pc(s.returns?.['3y']),'3Y CAGR',rc(parseFloat(s.returns?.['3y']),0,-5)],
    [pc(s.returns?.['5y']),'5Y CAGR',rc(parseFloat(s.returns?.['5y']),0,-5)],
    [nb(s.risk?.sharpe_ratio_3y),'Sharpe (3Y)',rc(parseFloat(s.risk?.sharpe_ratio_3y),0.5,0.3)],
    [pc(s.risk?.alpha_3y),'Alpha (3Y)',rc(parseFloat(s.risk?.alpha_3y),0,-2)],
    [s.risk?.down_capture_3y!=null?nb(s.risk.down_capture_3y)+'%':'—','Down capture',rcL(parseFloat(s.risk?.down_capture_3y),90,105)],
    [s.expense_ratio!=null?parseFloat(s.expense_ratio).toFixed(2)+'%':'—','Expense ratio',rcL(parseFloat(s.expense_ratio),1.0,1.8)],
    [s.risk?.std_dev_3y!=null?nb(s.risk.std_dev_3y)+'%':'—','Std dev (3Y)',rcL(parseFloat(s.risk?.std_dev_3y),14,20)],
  ];
  const mw=(CW-0.28)/4, mh=0.62, my=1.3;
  metrics.forEach(([v,l,c],i) => {
    const col=i%4, row=Math.floor(i/4);
    const bx=ML+col*(mw+0.09), by=my+row*(mh+0.08);
    addKpiBox(sl, bx, by, mw, mh, v, l, null, c);
  });

  // CY strip
  const CYK2=['cy21','cy22','cy23','cy24','cy25'];
  const CYL2=['2021','2022','2023','2024','2025'];
  sl.addShape(pres.ShapeType.rect, { x:ML, y:2.7, w:CW, h:0.52, fill:{ color:GR10 }, line:{ color:GR20, pt:0.5 } });
  CYK2.forEach((k,i) => {
    const v = s.returns?.['cy20'+CYL2[i].slice(2)];
    if (v==null) return;
    const fv=parseFloat(v);
    const bx=ML+0.2+i*1.65;
    sl.addText((fv>=0?'+':'')+fv.toFixed(1)+'%', { x:bx, y:2.74, w:1.4, h:0.22, fontSize:10, bold:true, color:fv>=0?POS:NEG, fontFace:'DM Mono', align:'center' });
    sl.addText(CYL2[i], { x:bx, y:2.94, w:1.4, h:0.2, fontSize:7.5, color:GR60, align:'center' });
  });
});

/* ══════════════════════════════════════════════════════════════════
   LAST SLIDE — DISCLAIMER
══════════════════════════════════════════════════════════════════ */
{
  const sl = pres.addSlide();
  sl.addShape(pres.ShapeType.rect, { x:0, y:0, w:W, h:H, fill:{ color:PLUM }, line:{ color:PLUM } });
  sl.addText('BügleRock Capital', { x:ML, y:0.5, w:CW, h:0.7, fontSize:28, bold:true, color:WHITE, fontFace:'Cormorant Garamond', align:'center' });
  sl.addText('Sound of Clarity', { x:ML, y:1.18, w:CW, h:0.24, fontSize:10, color:LAV, align:'center', charSpacing:2.5 });
  sl.addShape(pres.ShapeType.rect, { x:2.5, y:1.5, w:5, h:0.02, fill:{ color:BERRY }, line:{ color:BERRY } });
  sl.addText(
    'This investment proposal is prepared by '+rm+' for the exclusive use of '+client+'. All mutual fund data is sourced from BugleRock Analytics as at the proposal date and is subject to change. Past performance is not a reliable indicator of future results. Mutual fund investments are subject to market risk. Projections are purely illustrative. This document does not constitute investment advice.\n\n'+
    'BugleRock Capital Pte. Ltd. · CMS Licence No. 100978 · 30 Raffles Place #07-01, BNI Tower, Singapore 048622\n'+
    'BugleRock Capital Pvt. Ltd. · SEBI Registered · Prestige Takt, 23 Kasturba Cross Road, Bengaluru 560001\n\n'+
    '© BugleRock 2026. All rights reserved.',
    { x:ML+0.5, y:1.7, w:CW-1.0, h:2.8, fontSize:8.5, color:LAV, align:'center', lineSpacingMultiple:1.6 }
  );
  sl.addText(today, { x:ML, y:H-0.4, w:CW, h:0.24, fontSize:8, color:MUT, align:'center' });
}

/* ── Write to temp file then stdout ─────────────────────────────── */
const tmp = path.join(os.tmpdir(), `proposal_${Date.now()}.pptx`);
pres.writeFile({ fileName: tmp }).then(() => {
  const buf = fs.readFileSync(tmp);
  process.stdout.write(buf);
  fs.unlinkSync(tmp);
  process.exit(0);
}).catch(err => {
  process.stderr.write(err.message+'\n');
  process.exit(1);
});