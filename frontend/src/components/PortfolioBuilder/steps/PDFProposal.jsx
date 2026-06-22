import React, { useState } from 'react';
import { fp, f2 } from './BuildPortfolio';

function blendPtf(funds, wtMap, snapshots) {
  function wblend(getter) {
    let val = 0, cov = 0;
    funds.forEach(f => {
      const snap = snapshots[f.isin];
      if (!snap) return;
      const v = getter(snap);
      if (v == null || v === '-' || isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (wtMap[f.isin] || 0);
      cov += (wtMap[f.isin] || 0);
    });
    return cov > 0 ? val / cov : null;
  }
  return {
    ret1y:  wblend(s => s.returns?.['1y']),
    ret3y:  wblend(s => s.returns?.['3y']),
    ret5y:  wblend(s => s.returns?.['5y']),
    ret1m:  wblend(s => s.returns?.['1m']),
    ret3m:  wblend(s => s.returns?.['3m']),
    ytd:    wblend(s => s.returns?.['ytd']),
    cy25:   wblend(s => s.returns?.['cy2025']),
    cy24:   wblend(s => s.returns?.['cy2024']),
    cy23:   wblend(s => s.returns?.['cy2023']),
    cy22:   wblend(s => s.returns?.['cy2022']),
    cy21:   wblend(s => s.returns?.['cy2021']),
    sharpe: wblend(s => s.risk?.sharpe_ratio_3y),
    sortino:wblend(s => s.risk?.sortino_ratio_3y),
    alpha:  wblend(s => s.risk?.alpha_3y),
    beta:   wblend(s => s.risk?.beta_3y),
    upcap:  wblend(s => s.risk?.up_capture_3y),
    dncap:  wblend(s => s.risk?.down_capture_3y),
    std3y:  wblend(s => s.risk?.std_dev_3y),
    er:     wblend(s => s.expense_ratio),
    lc:     wblend(s => s.large_cap),
    mc:     wblend(s => s.mid_cap),
    sc:     wblend(s => s.small_cap),
    eq_pct: wblend(s => s.equity_pct),
    bond_pct: wblend(s => s.bond_pct),
    cash_pct: wblend(s => s.cash_pct),
  };
}

function fmtL(v) { return v >= 100000 ? '₹' + (v / 100000).toFixed(2) + 'L' : '₹' + (v / 1000).toFixed(1) + 'K'; }
function sipFV(m, r, y) { const mo = r / 100 / 12; if (mo === 0) return m * 12 * y; return m * ((Math.pow(1 + mo, 12 * y) - 1) / mo) * (1 + mo); }

export default function PDFProposal({ funds, weights, originalWeights, snapshots={}, benchmarks=[], ips, selectedPortfolio, setSelectedPortfolio, onEditPortfolio, onCompare }) {
  const hasOpt = Object.keys(originalWeights || {}).length > 0;
  // Compute blended benchmark from benchmarks array
  function blendBmVal(getter) {
    let val = 0, cov = 0;
    benchmarks.forEach(b => {
      const v = getter(b);
      if (v == null || isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (b.weight || 0);
      cov += (b.weight || 0);
    });
    return cov > 0 ? val / cov : null;
  }
  const bm = benchmarks.length > 0 ? {
    name: benchmarks.length === 1 ? benchmarks[0].display_name : benchmarks.map(b => `${b.display_name} (${b.weight}%)`).join(' + '),
    rets: {
      r1y:  blendBmVal(b => b.return_1y),
      r3y:  blendBmVal(b => b.return_3y),
      r5y:  blendBmVal(b => b.return_5y),
      cy25: blendBmVal(b => b.return_cy2025),
      cy24: blendBmVal(b => b.return_cy2024),
      cy23: blendBmVal(b => b.return_cy2023),
      cy22: blendBmVal(b => b.return_cy2022),
      cy21: blendBmVal(b => b.return_cy2021),
    }
  } : { name: 'No benchmark', rets: { r1y: null, r3y: null, r5y: null, cy25: null, cy24: null, cy23: null, cy22: null, cy21: null } };
  const activeWeights = selectedPortfolio === 'optimised' && hasOpt ? weights : (hasOpt ? originalWeights : weights);
  const B = blendPtf(funds, activeWeights, snapshots);
  const investAmt = ips?.amount ? parseFloat(ips.amount.replace(/[^0-9.]/g, '')) : 1000000;
  const sipAmt = ips?.monthlySIP ? parseFloat(ips.monthlySIP.replace(/[^0-9.]/g, '')) : 0;

  function generatePDF() {
    const clientName = ips?.name || 'Client';
    const preparedBy = ips?.rm || 'BugleRock Capital';
    const refDate = ips?.proposalDate ? new Date(ips.proposalDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const BERRY = '#912F63', PLUM = '#3E3452', LAV = '#A795AE', POS = '#1A7A52';
    const GR10 = '#F8F6FA', GR20 = '#E8E5EC', GR60 = '#6B7280';

    const allFunds = funds.filter(f => activeWeights[f.isin] != null);
    const tot = allFunds.reduce((s, f) => s + (activeWeights[f.isin] || 0), 0);
    const investedL = investAmt / 100000;
    const CAGR = (B.ret3y || 0) / 100;
    // Per-horizon CAGR for portfolio and benchmark
    const ptfCAGR = { 3: (B.ret3y||0)/100, 5: (B.ret5y||B.ret3y||0)/100, 10: (B.ret5y||B.ret3y||0)/100 };
    const bmCAGR3  = (bm.rets.r3y  || 0) / 100;
    const bmCAGR5  = (bm.rets.r5y  || bm.rets.r3y || 0) / 100;
    const bmCAGR10 = (bm.rets.r5y  || bm.rets.r3y || 0) / 100;
    const bmCAGR   = bmCAGR3; // used for 10yr SVG chart (use 3Y as base)
    const CYK = ['cy21', 'cy22', 'cy23', 'cy24', 'cy25'];
    const CYL = ['2021', '2022', '2023', '2024', '2025'];
    const cyV = CYK.map(k => B[k]);
    const bmV = CYK.map(k => bm.rets[k]);
    const mxCY = Math.max(...cyV.concat(bmV).filter(v => v != null).map(Math.abs).concat([5]));
    // CY chart — reserve 20px at top for labels, 30px at bottom for year labels + legend
    const SW = 420, SH = 150;
    const TOP_PAD = 20, BOT_PAD = 30;
    const CHART_H = SH - TOP_PAD - BOT_PAD; // drawable bar area
    const BASE_Y = TOP_PAD + CHART_H;        // y coordinate of baseline

    const cySvg = `<svg width="100%" height="${SH}" viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="xMidYMid meet">` +
      CYK.map((k, i) => {
        const fv = cyV[i], bv = bmV[i], x = i * 80, bw = 32, gp = 4;
        const fh = fv != null ? Math.max(2, Math.abs(fv) / mxCY * CHART_H) : 0;
        const bh = bv != null ? Math.max(2, Math.abs(bv) / mxCY * CHART_H) : 0;
        const diff = fv != null && bv != null ? fv - bv : null;
        // Label sits 6px above the tallest bar, but always within TOP_PAD area
        const labelY = Math.max(10, BASE_Y - Math.max(fh, bh) - 6);
        return (diff != null ? `<text x="${x + bw + gp/2}" y="${labelY}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${diff >= 0 ? POS : BERRY}" font-family="DM Sans,sans-serif">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</text>` : '') +
          (fv != null ? `<rect x="${x}" y="${BASE_Y - fh}" width="${bw}" height="${fh}" fill="${fv >= 0 ? BERRY : '#C46985'}" rx="2"/>` : '') +
          (bv != null ? `<rect x="${x + bw + gp}" y="${BASE_Y - bh}" width="${bw - 4}" height="${bh}" fill="${LAV}" rx="2" opacity=".8"/>` : '') +
          `<text x="${x + bw}" y="${BASE_Y + 13}" text-anchor="middle" font-size="8" fill="${GR60}" font-family="DM Sans,sans-serif">${CYL[i]}</text>`;
      }).join('') +
      `<line x1="0" y1="${BASE_Y}" x2="${SW}" y2="${BASE_Y}" stroke="${GR20}" stroke-width="1"/>` +
      // Year labels
      // Legend below chart
      `<rect x="0" y="${SH - 12}" width="10" height="10" fill="${BERRY}" rx="2"/>` +
      `<text x="14" y="${SH - 4}" font-size="8" fill="${GR60}" font-family="DM Sans,sans-serif">Portfolio</text>` +
      `<rect x="72" y="${SH - 12}" width="10" height="10" fill="${LAV}" rx="2" opacity=".8"/>` +
      `<text x="86" y="${SH - 4}" font-size="8" fill="${GR60}" font-family="DM Sans,sans-serif">${bm.name}</text>` +
      `</svg>`;

    // Growth projection SVG
    const gY = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ptfG = gY.map(y => investedL * Math.pow(1 + CAGR, y));
    const bmG = gY.map(y => bmCAGR10 > 0 ? investedL * Math.pow(1 + bmCAGR10, y) : investedL);
    const mxG = Math.max(...ptfG.concat(bmG)) * 1.05;
    const GW = 520, GH = 110, GP = 20;
    const gx = i => (GP + (i / 10) * (GW - GP * 2)).toFixed(1);
    const gy = v => (GH - GP - (v / mxG) * (GH - GP * 2) + GP * 0.3).toFixed(1);
    const ptfD = ptfG.map((v, i) => (i === 0 ? 'M' : 'L') + gx(i) + ',' + gy(v)).join(' ');
    const bmD = bmG.map((v, i) => (i === 0 ? 'M' : 'L') + gx(i) + ',' + gy(v)).join(' ');
    const areaD = ptfD + ' L' + gx(10) + ',' + GH + ' L' + gx(0) + ',' + GH + ' Z';
    const growSvg = `<svg width="100%" height="${GH}" viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${BERRY}" stop-opacity=".15"/><stop offset="100%" stop-color="${BERRY}" stop-opacity="0"/></linearGradient></defs>
      <path d="${areaD}" fill="url(#ag)"/>
      <path d="${ptfD}" fill="none" stroke="${BERRY}" stroke-width="2"/>
      <path d="${bmD}" fill="none" stroke="${LAV}" stroke-width="1.5" stroke-dasharray="5 3"/>
    </svg>`;

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Portfolio Proposal — ${clientName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;background:#fff;color:#2C2A30;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{margin:14mm 14mm 14mm 14mm;size:A4}
      @media print{.no-print{display:none!important}.pg{page-break-inside:avoid}}
      .avoid-break{page-break-inside:avoid}
      .container{max-width:760px;margin:0 auto;padding:20px}
    </style></head><body><div class="container">
    
    <!-- Cover -->
    <div style="background:${PLUM};padding:28px 28px 20px;border-radius:12px;margin-bottom:20px;color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;letter-spacing:-.02em;margin-bottom:4px">Portfolio Proposal</div>
          <div style="font-size:12px;opacity:.7">${refDate} · Prepared by ${preparedBy}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:600">BügleRock Capital</div>
          <div style="font-size:10px;opacity:.6;margin-top:2px">Sound of Clarity</div>
        </div>
      </div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:#EDD5E2;margin-bottom:16px">Prepared for: ${clientName}</div>
      <!-- KPI strip -->
      <div style="display:grid;grid-template-columns:repeat(6,1fr);background:rgba(255,255,255,.1);border-radius:8px;overflow:hidden">
        ${[
          [fp(B.ret1y), '1Y Return'],
          [fp(B.ret3y), '3Y CAGR'],
          [fp(B.ret5y), '5Y CAGR'],
          [f2(B.sharpe), 'Sharpe'],
          [fp(B.alpha), 'Alpha'],
          [f2(B.er) + '%', 'Blended ER'],
        ].map(([v, l], i) => `<div style="padding:12px 8px;text-align:center;${i < 5 ? 'border-right:1px solid rgba(255,255,255,.15)' : ''}"><div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#EDD5E2;margin-bottom:3px">${v}</div><div style="font-size:8px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6">${l}</div></div>`).join('')}
      </div>
    </div>

    <!-- IPS Summary -->
    <div class="avoid-break" style="margin-bottom:20px">
      <div style="padding:8px 14px;background:${PLUM};color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0">1. Investment Policy Statement</div>
      <div style="border:1px solid ${GR20};border-top:none;border-radius:0 0 8px 8px;padding:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
          <div>
            <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${PLUM};margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid ${GR20}">Client objectives</div>
            ${[['Investor', `<strong>${clientName}</strong>`], ['Prepared by', preparedBy], ['Amount', ips?.amount || '—'], ['Tenure', ips?.tenure || '—'], ['Objective', ips?.primaryObjective || '—'], ['Risk profile', ips?.riskProfile || '—']].map(([l, v]) => `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid ${GR20}"><div style="font-size:10px;color:${GR60};width:100px;flex-shrink:0">${l}</div><div style="font-size:11px;font-weight:500;color:${PLUM}">${v}</div></div>`).join('')}
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${PLUM};margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid ${GR20}">Parameters</div>
            ${[['Benchmark', bm.name || 'Not set'], ['Deployment', ips?.deploymentMode || '—'], ['Target return', ips?.targetReturn || '—'], ['Review cycle', ips?.reviewFrequency || '—'], ['Portfolio type', selectedPortfolio === 'optimised' && hasOpt ? 'Optimised' : 'Original']].map(([l, v]) => `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid ${GR20}"><div style="font-size:10px;color:${GR60};width:100px;flex-shrink:0">${l}</div><div style="font-size:11px;font-weight:500;color:${PLUM}">${v}</div></div>`).join('')}
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${PLUM};margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid ${GR20}">Target allocation</div>
            ${[['Equity', (ips?.alloc?.eqMin || '—') + '% – ' + (ips?.alloc?.eqMax || '—') + '%'], ['Large cap', (ips?.alloc?.lcMin || '—') + '% – ' + (ips?.alloc?.lcMax || '—') + '%'], ['Debt', (ips?.alloc?.debtMin || '—') + '% – ' + (ips?.alloc?.debtMax || '—') + '%'], ['Max funds', ips?.maxFunds || allFunds.length]].map(([l, v]) => `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid ${GR20}"><div style="font-size:10px;color:${GR60};width:80px;flex-shrink:0">${l}</div><div style="font-size:11px;font-weight:500;color:${PLUM}">${v}</div></div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Portfolio Overview -->
    <div class="avoid-break" style="margin-bottom:20px">
      <div style="padding:8px 14px;background:${PLUM};color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0">2. Portfolio Overview</div>
      <div style="border:1px solid ${GR20};border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
        <div style="height:8px;display:flex;gap:2px">${allFunds.map(f => `<div style="flex:${activeWeights[f.isin] || 0};background:${f.color}"></div>`).join('')}</div>
        <div style="padding:16px;display:grid;grid-template-columns:1fr 1fr">
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BERRY};margin-bottom:10px">Fund allocation</div>
            ${allFunds.map(f => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
              <div style="width:3px;height:28px;border-radius:2px;background:${f.color};flex-shrink:0"></div>
              <div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${f.name}</div>
              <div style="font-size:9px;color:${GR60}">${f.category}${snapshots[f.isin]?.returns?.['3y'] != null && snapshots[f.isin].returns['3y'] !== '-' ? ' · 3Y ' + fp(parseFloat(snapshots[f.isin].returns['3y'])) : ''}</div></div>
              <div style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:${f.color}">${activeWeights[f.isin] || 0}%</div>
            </div>`).join('')}
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BERRY};margin-bottom:10px">Market cap & asset mix</div>
            ${[[B.lc, 'Large cap', BERRY], [B.mc, 'Mid cap', '#6D5479'], [B.sc, 'Small cap', '#C46985'], [B.bond_pct, 'Bonds/Debt', LAV], [B.cash_pct, 'Cash/Liquid', GR60]].filter(r => (r[0] || 0) > 0.1).map(([v, lbl, clr]) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="font-size:10px;color:${GR60};width:68px;text-align:right;flex-shrink:0">${lbl}</div>
              <div style="flex:1;height:7px;background:${GR20};border-radius:4px;overflow:hidden"><div style="width:${Math.min(v || 0, 100).toFixed(1)}%;height:100%;background:${clr};border-radius:4px"></div></div>
              <div style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:${clr};min-width:36px;text-align:right">${(v || 0).toFixed(1)}%</div>
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Growth Projection -->
    <div class="avoid-break" style="margin-bottom:20px">
      <div style="padding:8px 14px;background:${PLUM};color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0">3. Wealth creation — Growth projection</div>
      <div style="border:1px solid ${GR20};border-top:none;border-radius:0 0 8px 8px;padding:16px">
        <div style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start;margin-bottom:14px">
          <div>
            <div style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${GR60};margin-bottom:4px">Projected wealth after 10 years (${fmtL(investAmt)} invested)</div>
            <div style="font-family:'Cormorant Garamond',serif;font-size:34px;font-weight:700;color:${BERRY}">${fmtL(investedL * Math.pow(1 + ptfCAGR[10], 10) * 100000)}</div>
            <div style="font-size:12px;color:${GR60};margin-top:2px">${bmCAGR10 > 0 ? 'vs ' + fmtL(investedL * Math.pow(1 + bmCAGR10, 10) * 100000) + ' (' + bm.name + ')' : bm.name}</div>
            ${(() => { const ptf10 = investedL * Math.pow(1 + ptfCAGR[10], 10) * 100000; const bm10 = bmCAGR10 > 0 ? investedL * Math.pow(1 + bmCAGR10, 10) * 100000 : null; const extra = bm10 != null ? ptf10 - bm10 : null; return extra != null ? `<div style="font-size:13px;font-weight:600;color:${extra >= 0 ? POS : BERRY};margin-top:4px">${extra >= 0 ? '+' : ''}${fmtL(extra)} extra wealth created</div>` : ''; })()}
            <div style="font-size:9px;color:${GR60};margin-top:6px">Portfolio: 5Y CAGR ${fp(B.ret5y || B.ret3y)} · Benchmark: ${fp((bm.rets.r5y || bm.rets.r3y))} · Illustrative only.</div>
          </div>
        </div>
        ${growSvg}
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:12px">
          <thead><tr style="background:${GR10}"><th style="padding:6px 10px;text-align:left;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${LAV};border-bottom:1px solid ${GR20}">Horizon</th><th style="padding:6px 10px;text-align:right;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${LAV};border-bottom:1px solid ${GR20}">Portfolio</th><th style="padding:6px 10px;text-align:right;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${LAV};border-bottom:1px solid ${GR20}">${bm.name}</th><th style="padding:6px 10px;text-align:right;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${LAV};border-bottom:1px solid ${GR20}">Extra wealth</th></tr></thead>
          <tbody>${[3, 5, 10].map(y => {
            const pc = ptfCAGR[y] || CAGR;
            const bc = y === 3 ? bmCAGR3 : y === 5 ? bmCAGR5 : bmCAGR10;
            const ptfV = investedL * Math.pow(1 + pc, y) * 100000;
            const bmV2 = bc > 0 ? investedL * Math.pow(1 + bc, y) * 100000 : null;
            const extra = bmV2 != null ? ptfV - bmV2 : null;
            return `<tr style="border-bottom:1px solid ${GR20}">
              <td style="padding:6px 10px;font-weight:500">${y} yrs</td>
              <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:${BERRY}">${fmtL(ptfV)}</td>
              <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;color:${LAV}">${bmV2 != null ? fmtL(bmV2) : '—'}</td>
              <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;color:${extra != null ? (extra >= 0 ? POS : BERRY) : GR60}">${extra != null ? (extra >= 0 ? '+' : '') + fmtL(extra) : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>

    <!-- Calendar Year Performance -->
    <div class="avoid-break" style="margin-bottom:20px">
      <div style="padding:8px 14px;background:${PLUM};color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0">4. Calendar year performance vs ${bm.name}</div>
      <div style="border:1px solid ${GR20};border-top:none;border-radius:0 0 8px 8px;padding:16px">${cySvg}</div>
    </div>

    <!-- Risk Profile -->
    <div class="avoid-break" style="margin-bottom:20px">
      <div style="padding:8px 14px;background:${PLUM};color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0">5. Risk profile & quality metrics</div>
      <div style="border:1px solid ${GR20};border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:${GR10}"><th style="padding:8px 14px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20}">Metric</th><th style="padding:8px 12px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20}">Portfolio</th><th style="padding:8px 12px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20}">Signal</th><th style="padding:8px 14px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20}">Interpretation</th></tr></thead>
          <tbody>${[
            ['Sharpe ratio (3Y)', B.sharpe, 0.5, false, f2(B.sharpe), ['Strong','Adequate','Weak'], `Risk-adjusted efficiency: every unit of risk taken generates ${f2(B.sharpe)}x return.`],
            ['Alpha (3Y)', B.alpha, 0, false, fp(B.alpha), ['Outperforming','Positive','Lagging'], B.alpha >= 0 ? `Fund managers are adding ${fp(B.alpha)} above index exposure.` : 'Active management costs exceed outperformance.'],
            ['Beta (3Y)', B.beta, 1.1, true, f2(B.beta), ['Defensive','Market-like','Aggressive'], `Portfolio moves ${f2(B.beta)}x with the benchmark.`],
            ['Down capture (3Y)', B.dncap, 100, true, f2(B.dncap) + '%', ['Protected','Moderate','Exposed'], B.dncap < 100 ? `Falls ${(100 - B.dncap).toFixed(1)}% less than benchmark in downturns.` : 'Falls more than benchmark in corrections.'],
            ['Std deviation (3Y)', B.std3y, 16, true, f2(B.std3y) + '%', ['Low vol','Moderate','High vol'], `Annual return volatility of ${f2(B.std3y)}%.`],
            ['Blended expense ratio', B.er, 1.5, true, f2(B.er) + '%', ['Low cost','Average','High cost'], B.er <= 1.0 ? 'Very competitive cost structure.' : B.er <= 1.5 ? 'Reasonable ER for actively managed funds.' : 'High cost — evaluate if active management justifies the fee.'],
          ].map(([metric, v, good, lb, fmt, lbls, desc], idx) => {
            const pos = lb ? v <= good : v >= good;
            const neg = lb ? v > good * 1.2 : v < good * 0.6;
            const c = v == null ? GR60 : pos ? POS : neg ? BERRY : '#D97706';
            const i = pos ? 0 : neg ? 2 : 1;
            const bg = c === POS ? '#E6F4ED' : c === BERRY ? '#FEE2E2' : '#FEF9EC';
            return `<tr style="border-bottom:1px solid ${GR20};background:${idx % 2 === 0 ? GR10 : '#fff'}"><td style="padding:9px 14px;font-size:11px;font-weight:500;color:${PLUM}">${metric}</td><td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:${c}">${fmt}</td><td style="padding:9px 12px;text-align:right"><span style="font-size:9px;font-weight:700;padding:3px 10px;border-radius:20px;background:${bg};color:${c}">${lbls[i]}</span></td><td style="padding:9px 14px;font-size:10px;color:${GR60};line-height:1.6">${desc}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>

    <!-- Fund Details -->
    <div class="pg avoid-break" style="margin-bottom:20px">
      <div style="padding:8px 14px;background:${PLUM};color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-radius:8px 8px 0 0">6. Fund details & individual analytics</div>
      <div style="border:1px solid ${GR20};border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:${GR10}">${['Fund','Weight','1Y','3Y CAGR','5Y CAGR','Sharpe','Alpha','Dn cap','ER'].map(h => `<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20};text-align:right;white-space:nowrap;${h==='Fund'?'text-align:left':''}">${h}</th>`).join('')}</tr></thead>
          <tbody>${allFunds.map(f => {
            const w = activeWeights[f.isin] || 0;
            const sn = snapshots[f.isin] || {};
            const r1y = sn.returns?.['1y']; const r3y = sn.returns?.['3y']; const r5y = sn.returns?.['5y'];
            const sharpe = sn.risk?.sharpe_ratio_3y; const alpha = sn.risk?.alpha_3y;
            const dncap = sn.risk?.down_capture_3y; const er = sn.expense_ratio;
            const v1y = r1y != null && r1y !== '-' ? parseFloat(r1y) : null;
            const v3y = r3y != null && r3y !== '-' ? parseFloat(r3y) : null;
            const v5y = r5y != null && r5y !== '-' ? parseFloat(r5y) : null;
            const vSh = sharpe != null && sharpe !== '-' ? parseFloat(sharpe) : null;
            const vAl = alpha != null && alpha !== '-' ? parseFloat(alpha) : null;
            const vDn = dncap != null && dncap !== '-' ? parseFloat(dncap) : null;
            const vER = er != null && er !== '-' ? parseFloat(er) : null;
            return `<tr style="border-bottom:1px solid ${GR20}">
              <td style="padding:8px 10px">
                <div style="display:flex;align-items:center;gap:6px">
                  <div style="width:3px;height:28px;border-radius:2px;background:${f.color};flex-shrink:0"></div>
                  <div><div style="font-size:11px;font-weight:500;overflow:hidden;white-space:nowrap;max-width:160px;text-overflow:ellipsis">${f.name}</div>
                  <span style="font-size:8px;background:${GR10};padding:1px 5px;border-radius:10px;color:${GR60}">${f.category}</span></div>
                </div>
              </td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700">${w}%</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${v1y != null ? (v1y >= 0 ? POS : BERRY) : GR60}">${v1y != null ? fp(v1y) : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${v3y != null ? (v3y >= 0 ? POS : BERRY) : GR60}">${v3y != null ? fp(v3y) : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${v5y != null ? (v5y >= 0 ? POS : BERRY) : GR60}">${v5y != null ? fp(v5y) : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${vSh != null ? (vSh >= 0.5 ? POS : GR60) : GR60}">${vSh != null ? f2(vSh) : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${vAl != null ? (vAl >= 0 ? POS : BERRY) : GR60}">${vAl != null ? fp(vAl) : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${vDn != null ? (vDn < 100 ? POS : BERRY) : GR60}">${vDn != null ? f2(vDn) + '%' : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:${vER != null ? (vER <= 1 ? POS : vER >= 2 ? BERRY : GR60) : GR60}">${vER != null ? f2(vER) + '%' : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr style="background:${PLUM}"><td style="padding:9px 10px;font-size:11px;font-weight:700;color:#fff">Blended portfolio</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:#fff">${tot}%</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${B.ret1y >= 0 ? '#A4E4C0' : BERRY}">${fp(B.ret1y)}</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${B.ret3y >= 0 ? '#A4E4C0' : BERRY}">${fp(B.ret3y)}</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${B.ret5y >= 0 ? '#A4E4C0' : BERRY}">${fp(B.ret5y)}</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:#fff">${f2(B.sharpe)}</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${B.alpha >= 0 ? '#A4E4C0' : BERRY}">${fp(B.alpha)}</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:#fff">${f2(B.dncap)}%</td><td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:#fff">${f2(B.er)}%</td></tr></tfoot>
        </table>
      </div>
    </div>

    <!-- Disclaimer -->
    <div style="border:1px solid ${GR20};border-radius:10px;padding:14px 16px;background:${GR10};margin-bottom:8px">
      <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${LAV};margin-bottom:6px">Important disclosures & risk warnings</div>
      <div style="font-size:9px;color:#9CA3AF;line-height:1.75">
        This portfolio proposal has been prepared by <strong style="color:${GR60}">${preparedBy}</strong>, part of the BugleRock Capital group. BugleRock Capital Pte. Ltd. (BRCPL) holds a Capital Markets Services Licence (CMS100978) issued by the Monetary Authority of Singapore. In India, BugleRock Capital Pvt. Ltd. is a SEBI-registered entity, member of BSE and NSE. This document is prepared exclusively for <strong style="color:${GR60}">${clientName}</strong> and must not be shared, reproduced or redistributed without written consent.<br><br>
        Mutual fund investments are subject to market risk. Past performance is not necessarily indicative of future results. The performance data, return projections and portfolio analytics presented are based on historical information and are for illustrative purposes only. The return projections are calculated using the blended 3-year CAGR of the proposed portfolio. Actual returns will differ based on market conditions, redemption timing, applicable taxes, exit loads, and transaction costs. Tax treatment depends on individual circumstances.<br><br>
        This document does not constitute investment advice, a solicitation to buy or sell any securities, or a binding commitment by BugleRock Capital. © BugleRock Capital 2026. All rights reserved.
      </div>
    </div>
    <div style="text-align:center;padding:10px;font-size:9px;color:#D1D5DB">BugleRock Capital · CMS100978 · Sound of Clarity · buglerock.asia</div>

    <div class="no-print" style="position:fixed;bottom:20px;right:20px;display:flex;gap:10px">
      <button onclick="window.print()" style="padding:10px 24px;background:${BERRY};color:#fff;border:none;border-radius:8px;font:600 13px 'DM Sans',sans-serif;cursor:pointer">⬇ Print / Save PDF</button>
      <button onclick="window.close()" style="padding:10px 16px;background:#fff;color:#555;border:1px solid #ddd;border-radius:8px;font:500 12px 'DM Sans',sans-serif;cursor:pointer">Close</button>
    </div>
    </div></body></html>`);
    w.document.close();
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 28px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{ maxWidth: 600, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(145,47,99,.06)', border: '1.5px solid rgba(145,47,99,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>📄</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 6 }}>Generate portfolio proposal</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>A professional client-ready proposal with IPS, portfolio analytics, growth projections, risk breakdown, and fund details.</div>
        </div>

        {/* Summary card */}
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[
              { l: 'Client', v: ips?.name || '(not set)' },
              { l: 'Investment amount', v: ips?.amount ? '₹' + ips.amount : '(not set)' },
              { l: 'Portfolio funds', v: funds.length + ' funds' },
              { l: 'Objective', v: ips?.primaryObjective || '(not set)' },
              { l: 'Risk profile', v: ips?.riskProfile || '(not set)' },
              { l: 'Benchmark', v: bm.name || 'Not set' },
              { l: 'IPS', v: ips?.name ? '✓ Saved' : 'Not saved', c: ips?.name ? 'var(--pos)' : 'var(--text-muted)' },
              { l: 'Optimisation', v: hasOpt ? '✓ Applied' : 'Not run', c: hasOpt ? 'var(--pos)' : 'var(--text-muted)' },
              { l: 'Portfolio for proposal', v: selectedPortfolio === 'optimised' && hasOpt ? 'Optimised' : 'Original', c: 'var(--brand-primary)' },
            ].map((item, i) => (
              <div key={i}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>{item.l}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: item.c || 'var(--brand-dark)' }}>{item.v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong>Proposal includes:</strong> IPS · Portfolio overview & KPIs · Growth projection · Calendar year performance · Risk profile & quality metrics · Fund details table{hasOpt ? ' · Optimised vs original comparison' : ''}
          </div>
        </div>

        {/* Portfolio choice */}
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>Proposal will use</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { val: 'original', label: 'Original portfolio', desc: 'Your hand-built weights', color: 'var(--pos)' },
              { val: 'optimised', label: 'Optimised portfolio', desc: 'Strategy-applied weights', color: 'var(--brand-primary)', disabled: !hasOpt },
            ].map(opt => (
              <label key={opt.val} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, cursor: opt.disabled ? 'not-allowed' : 'pointer', padding: '10px 14px', border: `1.5px solid ${selectedPortfolio === opt.val ? opt.color : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: '#fff', opacity: opt.disabled ? .5 : 1 }}>
                <input type="radio" name="ptf-which-pdf" value={opt.val} checked={selectedPortfolio === opt.val} onChange={() => !opt.disabled && setSelectedPortfolio(opt.val)} disabled={opt.disabled} style={{ accentColor: opt.color }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: opt.color }}>{opt.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            Generating for: <strong style={{ color: 'var(--brand-dark)' }}>{selectedPortfolio === 'optimised' && hasOpt ? 'Optimised portfolio' : 'Original portfolio'}</strong>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onEditPortfolio} style={{ fontSize: 12 }}>← Edit portfolio</button>
          <button className="btn btn-ghost" onClick={onCompare} style={{ fontSize: 12 }}>Compare portfolios</button>
          <button className="btn btn-primary" onClick={generatePDF} style={{ fontSize: 13, padding: '11px 28px' }}>⬇ Generate PDF proposal</button>
        </div>
      </div>
    </div>
  );
}