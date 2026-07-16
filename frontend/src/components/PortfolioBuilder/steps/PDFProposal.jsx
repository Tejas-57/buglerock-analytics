import React, { useState } from 'react';
import { fp, f2 } from './BuildPortfolio';

/* ── Blend helpers ──────────────────────────────────────────────────── */
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
  // LMS normalized cap
  function capBlend(key) {
    let val = 0, cov = 0;
    funds.forEach(f => {
      const s = snapshots[f.isin] || {};
      const w = wtMap[f.isin] || 0; if (!w) return;
      const lc = parseFloat(s.large_cap)||0, mc = parseFloat(s.mid_cap)||0, sc = parseFloat(s.small_cap)||0;
      const lms = lc+mc+sc; if (!lms) return;
      const v = key==='lc'?lc:key==='mc'?mc:sc;
      val += (v/lms*100)*w; cov += w;
    });
    return cov > 0 ? val/cov : null;
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
    lc:     capBlend('lc'),
    mc:     capBlend('mc'),
    sc:     capBlend('sc'),
    eq_pct: wblend(s => s.equity_pct),
    bond_pct: wblend(s => s.bond_pct),
    cash_pct: wblend(s => s.cash_pct),
  };
}

function fmtL(v) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 10000000) return (v/10000000).toFixed(1)+'Cr';
  if (abs >= 100000)   return (v/100000).toFixed(2)+'L';
  return '₹'+(v/1000).toFixed(1)+'K';
}
function sipFV(m, r, y) {
  const mo = r/100/12;
  if (mo === 0) return m*12*y;
  return m*((Math.pow(1+mo, 12*y)-1)/mo)*(1+mo);
}
function nb(v, d=1) { return v != null ? parseFloat(v).toFixed(d) : '—'; }
function pc(v)      { return v != null ? (parseFloat(v)>=0?'+':'')+parseFloat(v).toFixed(2)+'%' : '—'; }
function rc(v, good, bad)  { return v==null?'#A2A0A0':parseFloat(v)>=good?'#1A7A52':parseFloat(v)<=bad?'#912F63':'#D97706'; }
function rcL(v, good, bad) { return v==null?'#A2A0A0':parseFloat(v)<=good?'#1A7A52':parseFloat(v)>=bad?'#912F63':'#D97706'; }

export default function PDFProposal({ funds, weights, originalWeights, snapshots={}, benchmarks=[], ips, selectedPortfolio, setSelectedPortfolio, onEditPortfolio, onCompare, analyseData={} }) {
  const hasOpt = Object.keys(originalWeights || {}).length > 0;
  const { stressData, overlapData, corrData } = analyseData || {};

  function blendBmVal(getter) {
    let val = 0, cov = 0;
    benchmarks.forEach(b => {
      const v = getter(b);
      if (v == null || isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (b.weight || 0);
      cov += (b.weight || 0);
    });
    return cov > 0 ? val/cov : null;
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
  } : { name: 'Benchmark', rets: {} };

  const activeWeights = selectedPortfolio === 'optimised' && hasOpt ? weights : (hasOpt ? originalWeights : weights);
  const B  = blendPtf(funds, activeWeights, snapshots);
  const investAmt = ips?.amount ? parseFloat(ips.amount.replace(/[^0-9.]/g, '')) : 1000000;
  const sipAmt    = ips?.monthlySIP ? parseFloat(ips.monthlySIP.replace(/[^0-9.]/g, '')) : 0;
  const tenureYrs = ips?.tenure ? parseInt(ips.tenure) || 10 : 10;

  const [generating, setGenerating] = useState(false);

  async function generatePDF() {
    const API = process.env.REACT_APP_API_URL || '';
    setGenerating(true);

    // Open window BEFORE any async work — browsers block popups after await
    const w = window.open('', '_blank');
    if (w) w.document.write('<html><body style="font-family:sans-serif;padding:40px;color:#3E3452"><h2>⏳ Generating proposal…</h2><p>Fetching stress test, overlap and correlation data. This will take a few seconds.</p></body></html>');

    try {
      const allFundsForFetch = funds.filter(f => activeWeights[f.isin] != null);
      const isins = allFundsForFetch.map(f => f.isin).join(',');
      const wts   = allFundsForFetch.map(f => activeWeights[f.isin]).join(',');

      const [freshStress, freshOverlap, freshCorr] = await Promise.allSettled([
        fetch(`${API}/api/nav/stress-test?isins=${isins}&weights=${wts}`).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/holdings/overlap?isins=${isins}`).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/nav/correlation?isins=${isins}`).then(r => r.ok ? r.json() : null),
      ]);

      const resolvedStress  = freshStress.status  === 'fulfilled' ? freshStress.value  : (stressData  || null);
      const resolvedOverlap = freshOverlap.status === 'fulfilled' ? freshOverlap.value : (overlapData || null);
      const resolvedCorr    = freshCorr.status    === 'fulfilled' ? freshCorr.value    : (corrData    || null);

      buildAndOpen(resolvedStress, resolvedOverlap, resolvedCorr, w);
    } catch(e) {
      buildAndOpen(stressData || null, overlapData || null, corrData || null, w);
    } finally {
      setGenerating(false);
    }
  }
  function generatePPT() {
    const API = process.env.REACT_APP_API_URL || '';

    // Build blended benchmark returns
    const bmRets = {
      r1y:  blendBmVal(b => b.return_1y),
      r3y:  blendBmVal(b => b.return_3y),
      r5y:  blendBmVal(b => b.return_5y),
      r1m:  blendBmVal(b => b.return_1m),
      r3m:  blendBmVal(b => b.return_3m),
      ytd:  blendBmVal(b => b.return_ytd),
      r21:  blendBmVal(b => b.return_cy2021),
      r22:  blendBmVal(b => b.return_cy2022),
      r23:  blendBmVal(b => b.return_cy2023),
      r24:  blendBmVal(b => b.return_cy2024),
      r25:  blendBmVal(b => b.return_cy2025),
    };

    const payload = {
      client:        ips?.name || 'Client',
      rm:            ips?.rm || 'BugleRock Capital',
      invest:        ips?.amount ? '₹'+ips.amount : '—',
      goal:          ips?.primaryObjective || 'Wealth creation',
      risk:          ips?.riskProfile || 'Moderate',
      tenure:        tenureYrs,
      deploy:        ips?.deploymentMode || null,
      targetRet:     ips?.targetReturn || null,
      reviewFreq:    ips?.reviewFrequency || 'Quarterly',
      constraints:   ips?.constraints || null,
      notes:         ips?.notes || null,
      today:         ips?.proposalDate
        ? new Date(ips.proposalDate).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})
        : new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}),
      benchmarkName: bm.name,
      funds: funds.filter(f => activeWeights[f.isin] != null).map(f => ({
        isin: f.isin, name: f.name, category: f.category, color: f.color,
      })),
      weights: activeWeights,
      snapshots,
      B,
      bmRets,
      sipAmt,
      investAmt,
      tenureYrs,
    };

    fetch(`${API}/api/proposal/pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => {
        if (!r.ok) return r.text().then(t => { throw new Error(t); });
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `BugleRock_Proposal_${(ips?.name||'Client').replace(/\s+/g,'_')}.pptx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
      })
      .catch(err => alert('PPT generation failed: ' + err.message));
  }

  function buildAndOpen(resolvedStress, resolvedOverlap, resolvedCorr, w) {
    const CLIENT   = ips?.name || 'Client';
    const RM       = ips?.rm   || 'BugleRock Capital';
    const INVEST   = ips?.amount ? '₹'+ips.amount : '—';
    const GOAL     = ips?.primaryObjective || 'Wealth creation';
    const RISK     = ips?.riskProfile || 'Moderate';
    const TENURE   = ips?.tenure ? ips.tenure+' years' : '10 years';
    const DEPLOY   = ips?.deploymentMode || '—';
    const TRET     = ips?.targetReturn || '—';
    const REVFREQ  = ips?.reviewFrequency || 'Quarterly';
    const CONSTRAIN= ips?.constraints || '';
    const NOTES    = ips?.notes || '';
    const TODAY    = ips?.proposalDate
      ? new Date(ips.proposalDate).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})
      : new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});

    const BERRY  = '#912F63', PLUM = '#3E3452', LAV = '#A795AE';
    const MUT    = '#6D5479', SPINK = '#C46985';
    const POS    = '#1A7A52', NEG  = '#912F63', WARN = '#D97706';
    const GR10   = '#F9F8F9', GR20 = '#F2F0F3', GR60 = '#A2A0A0', GR80 = '#2C2A30';
    const PLUM_LT= '#EDE9F2';

    const allFunds = funds.filter(f => activeWeights[f.isin] != null);
    const TOT      = allFunds.reduce((s,f) => s+(activeWeights[f.isin]||0), 0) || 100;
    const SF       = allFunds.slice().sort((a,b) => (activeWeights[b.isin]||0)-(activeWeights[a.isin]||0));
    SF.forEach(f => { f._w = activeWeights[f.isin]||0; f._wPct = f._w/TOT*100; });

    const INVESTL  = investAmt/100000;
    const TYR      = tenureYrs;
    const CAGR3    = (B.ret3y||0)/100;
    const bmCAGR   = (bm.rets.r3y||0)/100;
    const LUMP_FV  = INVESTL * Math.pow(1+CAGR3, TYR);
    const SIP_FV   = sipAmt > 0 ? sipFV(sipAmt, B.ret3y||0, TYR)/100000 : 0;
    const TOTAL_FV = LUMP_FV + SIP_FV;
    const BM_FV    = INVESTL * Math.pow(1+bmCAGR, TYR) + (sipAmt>0?sipFV(sipAmt,bm.rets.r3y||0,TYR)/100000:0);
    const MULT     = (TOTAL_FV/INVESTL).toFixed(1);

    // Overall score 0-100
    const scores = [
      B.ret3y   != null && B.ret3y   >= 12 ? 20 : B.ret3y   != null && B.ret3y   >= 8  ? 14 : 8,
      B.sharpe  != null && B.sharpe  >= 0.7 ? 20 : B.sharpe  != null && B.sharpe  >= 0.4 ? 14 : 8,
      B.alpha   != null && B.alpha   >= 2   ? 20 : B.alpha   != null && B.alpha   >= 0  ? 14 : 8,
      B.dncap   != null && B.dncap   <= 90  ? 20 : B.dncap   != null && B.dncap   <= 100 ? 14 : 8,
      B.er      != null && B.er      <= 1.0 ? 20 : B.er      != null && B.er      <= 1.5 ? 14 : 8,
    ];
    const OVERALL = scores.reduce((a,b)=>a+b,0);
    const SC_CLR  = OVERALL>=80?POS:OVERALL>=60?WARN:NEG;
    const SC_BG   = OVERALL>=80?'#E6F4ED':OVERALL>=60?'#FEF9EC':'#FEE2E2';
    const SC_LBL  = OVERALL>=80?'Strong':OVERALL>=60?'Adequate':'Needs review';

    /* ── HTML HELPERS ─────────────────────────────────────────── */
    const kpiCell = (val,lbl,sub,clr,bg) =>
      `<div style="background:${bg||GR10};border:1px solid ${GR20};border-radius:10px;padding:13px 10px;text-align:center">
        <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:${clr||GR80};line-height:1;margin-bottom:3px">${val}</div>
        <div style="font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${GR60}">${lbl}</div>
        ${sub?`<div style="font-size:9px;color:${clr||GR60};margin-top:2px">${sub}</div>`:''}
      </div>`;

    const infoCell = (lbl,val) =>
      `<div style="padding:9px 13px;background:#fff;border:1px solid ${GR20};border-radius:8px">
        <div style="font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};margin-bottom:2px">${lbl}</div>
        <div style="font-size:12px;font-weight:600;color:${GR80}">${val||'—'}</div>
      </div>`;

    const sectionHd = (num,title,sub) =>
      `<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:10px;border-bottom:1.5px solid ${GR20}">
        <div style="background:${BERRY};color:#fff;font-size:20px;font-weight:300;font-family:'Cormorant Garamond',serif;padding:2px 12px;border-radius:4px;flex-shrink:0;letter-spacing:.02em">${num}</div>
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${PLUM};line-height:1.1">${title}</div>
          ${sub?`<div style="font-size:11px;color:${GR60};margin-top:3px">${sub}</div>`:''}
        </div>
      </div>`;

    const tblBox = (title,inner,note) =>
      `<div style="border:1px solid ${GR20};border-radius:10px;overflow:hidden;margin-bottom:16px">
        <div style="padding:9px 16px;background:${PLUM};color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">${title}</div>
        ${inner}
        ${note?`<div style="padding:8px 14px;font-size:10px;color:${GR60};background:${GR10};border-top:1px solid ${GR20};line-height:1.65">${note}</div>`:''}
      </div>`;

    const callout = (txt,type) => {
      const map = {pos:[POS,'#E6F4ED'],warn:[WARN,'#FEF9EC'],neg:[NEG,'#FEE2E2'],info:[PLUM,PLUM_LT]};
      const m = map[type]||map.info;
      return `<div style="border-left:4px solid ${m[0]};background:${m[1]};padding:10px 14px;border-radius:0 8px 8px 0;margin:10px 0;font-size:11.5px;color:${m[0]};line-height:1.7">${txt}</div>`;
    };

    const TH = (t,a) => `<th style="padding:8px 12px;text-align:${a||'right'};font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${LAV};border-bottom:2px solid ${GR20};background:${GR10};white-space:nowrap">${t}</th>`;
    const TD = (v,c,b) => `<td style="padding:7px 12px;border-bottom:1px solid ${GR20};text-align:right;font-family:'DM Mono',monospace;font-size:11px;${b?'font-weight:700;':''}${c?'color:'+c+';':''}">${v}</td>`;
    const TDL = (v,b,sub) => `<td style="padding:7px 12px;border-bottom:1px solid ${GR20};font-family:'DM Sans',sans-serif;font-size:12px;${b?'font-weight:600;':''}">${v}${sub?`<div style="font-size:9px;color:${GR60}">${sub}</div>`:''}</td>`;

    /* ── SVG: Donut chart ─────────────────────────────────────── */
    const donutSvg = (() => {
      const r=60,cx=75,cy=75,tau=2*Math.PI;
      let start=-Math.PI/2;
      let svg = `<svg viewBox="0 0 240 150" width="240" height="150" style="display:block">`;
      SF.forEach(f => {
        const angle=tau*f._wPct/100;
        const x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start);
        const end=start+angle;
        const x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end);
        svg+=`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${angle>Math.PI?1:0},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${f.color}"/>`;
        start=end;
      });
      svg+=`<circle cx="${cx}" cy="${cy}" r="36" fill="#fff"/>`;
      svg+=`<text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="9" fill="${GR60}" font-family="DM Sans,sans-serif">Funds</text>`;
      svg+=`<text x="${cx}" y="${cy+10}" text-anchor="middle" font-size="16" font-weight="700" fill="${PLUM}" font-family="DM Mono,monospace">${SF.length}</text>`;
      let ly=12;
      SF.slice(0,7).forEach(f => {
        svg+=`<circle cx="152" cy="${ly}" r="5" fill="${f.color}"/>`;
        svg+=`<text x="162" y="${ly+4}" font-size="9.5" fill="${GR80}" font-family="DM Sans,sans-serif">${f.name.split(' ').slice(0,3).join(' ')}</text>`;
        svg+=`<text x="234" y="${ly+4}" text-anchor="end" font-size="9.5" font-weight="700" fill="${PLUM}" font-family="DM Mono,monospace">${f._wPct.toFixed(0)}%</text>`;
        ly+=18;
      });
      if(SF.length>7) svg+=`<text x="162" y="${ly+4}" font-size="9" fill="${GR60}" font-family="DM Sans,sans-serif">+${SF.length-7} more funds</text>`;
      return svg+'</svg>';
    })();

    /* ── SVG: Cap bars ──────────────────────────────────────────── */
    const capData = [[B.lc,'Large cap',BERRY],[B.mc,'Mid cap',MUT],[B.sc,'Small cap',SPINK],[B.bond_pct,'Bonds/Debt',LAV],[B.cash_pct,'Cash/Liquid',GR60]].filter(r => (r[0]||0)>0.5);
    const capSvg = (() => {
      let svg=`<svg viewBox="0 0 280 ${capData.length*28+10}" width="280" style="display:block">`;
      capData.forEach((r,i) => {
        const bw=Math.max(2,(r[0]||0)/100*180), y=i*28+4;
        svg+=`<text x="0" y="${y+12}" font-size="10.5" fill="${GR80}" font-family="DM Sans,sans-serif">${r[1]}</text>`;
        svg+=`<rect x="82" y="${y}" width="${bw.toFixed(1)}" height="16" fill="${r[2]}" rx="3"/>`;
        svg+=`<text x="${(85+bw).toFixed(1)}" y="${y+12}" font-size="10.5" font-weight="700" fill="${r[2]}" font-family="DM Mono,monospace">${nb(r[0],1)}%</text>`;
      });
      return svg+'</svg>';
    })();

    /* ── SVG: CY bar chart ──────────────────────────────────────── */
    const CYK=['cy21','cy22','cy23','cy24','cy25'];
    const CYL=['2021','2022','2023','2024','2025'];
    const cyV=CYK.map(k=>B[k]);
    const bmV=CYK.map(k=>bm.rets['r'+k.slice(2)]);
    const mxCY=Math.max(...cyV.concat(bmV).filter(v=>v!=null).map(Math.abs).concat([10]));
    const SW=420,SH=150,TPAD=20,BPAD=30,CH=SH-TPAD-BPAD,ZY=TPAD+CH;
    let cySvg=`<svg width="100%" height="${SH}" viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="xMidYMid meet">`;
    CYK.forEach((k,i) => {
      const fv=cyV[i], bv=bmV[i], x=i*80, bw=32, gp=4;
      const fh=fv!=null?Math.max(2,Math.abs(fv)/mxCY*CH):0;
      const bh=bv!=null?Math.max(2,Math.abs(bv)/mxCY*CH):0;
      const delta=fv!=null&&bv!=null?fv-bv:null;
      const lY=Math.max(10,ZY-Math.max(fh,bh)-6);
      if(delta!=null) cySvg+=`<text x="${(x+bw+gp/2).toFixed(1)}" y="${lY.toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="${delta>=0?POS:NEG}" font-family="DM Mono,monospace">${delta>=0?'▲':'▼'}${delta>=0?'+':''}${delta.toFixed(1)}%</text>`;
      if(fv!=null) cySvg+=`<rect x="${x}" y="${ZY-fh}" width="${bw}" height="${fh}" fill="${fv>=0?BERRY:SPINK}" rx="2"/>`;
      if(bv!=null) cySvg+=`<rect x="${x+bw+gp}" y="${ZY-bh}" width="${bw-4}" height="${bh}" fill="${LAV}" rx="2" opacity=".8"/>`;
      cySvg+=`<text x="${x+bw}" y="${ZY+13}" text-anchor="middle" font-size="8" fill="${GR60}" font-family="DM Sans,sans-serif">${CYL[i]}</text>`;
    });
    cySvg+=`<line x1="0" y1="${ZY}" x2="${SW}" y2="${ZY}" stroke="${GR20}" stroke-width="1"/>`;
    cySvg+=`<rect x="0" y="${SH-12}" width="10" height="10" fill="${BERRY}" rx="2"/>`;
    cySvg+=`<text x="14" y="${SH-4}" font-size="8" fill="${GR60}" font-family="DM Sans,sans-serif">Portfolio</text>`;
    cySvg+=`<rect x="72" y="${SH-12}" width="10" height="10" fill="${LAV}" rx="2" opacity=".8"/>`;
    cySvg+=`<text x="86" y="${SH-4}" font-size="8" fill="${GR60}" font-family="DM Sans,sans-serif">${bm.name}</text>`;
    cySvg+='</svg>';

    /* ── SVG: Growth projection ─────────────────────────────────── */
    const gYrs=[0,1,2,3,5,7,TYR];
    const ptfG=gYrs.map(y=>INVESTL*Math.pow(1+CAGR3,y)+(sipAmt>0?sipFV(sipAmt,B.ret3y||0,y)/100000:0));
    const bmGr=gYrs.map(y=>INVESTL*Math.pow(1+bmCAGR,y)+(sipAmt>0?sipFV(sipAmt,bm.rets.r3y||0,y)/100000:0));
    const mxG=Math.max(...ptfG.concat(bmGr))*1.08;
    const GW=520,GH=110,GP=20;
    const gx=i=>(GP+(i/gYrs.length)*(GW-GP*2)).toFixed(1);
    const gy=v=>(GH-GP-(v/mxG)*(GH-GP*2)+GP*0.3).toFixed(1);
    const ptfD=ptfG.map((v,i)=>(i===0?'M':'L')+gx(i)+','+gy(v)).join(' ');
    const bmD=bmGr.map((v,i)=>(i===0?'M':'L')+gx(i)+','+gy(v)).join(' ');
    const areaD=ptfD+' L'+gx(gYrs.length-1)+','+GH+' L'+gx(0)+','+GH+' Z';
    const projSvg=`<svg width="100%" height="${GH}" viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${BERRY}" stop-opacity=".15"/><stop offset="100%" stop-color="${BERRY}" stop-opacity="0"/></linearGradient></defs>
      <path d="${areaD}" fill="url(#ag)"/>
      <path d="${ptfD}" fill="none" stroke="${BERRY}" stroke-width="2"/>
      <path d="${bmD}" fill="none" stroke="${LAV}" stroke-width="1.5" stroke-dasharray="5 3"/>
      <text x="${gx(0)}" y="${GH-3}" font-size="8" fill="${GR60}" text-anchor="middle" font-family="DM Sans,sans-serif">Now</text>
      <text x="${gx(gYrs.length-1)}" y="${GH-3}" font-size="8" fill="${GR60}" text-anchor="middle" font-family="DM Sans,sans-serif">${TYR}Y</text>
    </svg>`;

    /* ── Table rows ─────────────────────────────────────────────── */
    const fundRows = SF.map((f,i) => {
      const s=snapshots[f.isin]||{};
      return `<tr style="background:${i%2===0?'#fff':GR10}">
        ${TDL(`<div style="display:flex;align-items:center;gap:8px"><div style="width:4px;height:38px;border-radius:2px;background:${f.color};flex-shrink:0"></div>
          <div><div style="font-size:12px;font-weight:600;color:${GR80}">${f.name}</div>
          <div style="font-size:9.5px;color:${GR60}">${f.category||''}</div></div></div>`)}
        ${TD(f._wPct.toFixed(1)+'%',PLUM,'1')}
        ${TD(fmtL(f._wPct/100*investAmt),GR80)}
        ${TD(s.expense_ratio!=null?parseFloat(s.expense_ratio).toFixed(2)+'%':'—',rcL(parseFloat(s.expense_ratio),1.2,1.8))}
        ${TD(pc(s.returns?.['1y']),rc(parseFloat(s.returns?.['1y']),0,-5),'1')}
        ${TD(pc(s.returns?.['3y']),rc(parseFloat(s.returns?.['3y']),0,-5))}
        ${TD(pc(s.returns?.['5y']),rc(parseFloat(s.returns?.['5y']),0,-5))}
        ${TD(nb(s.risk?.sharpe_ratio_3y),rc(parseFloat(s.risk?.sharpe_ratio_3y),0.5,0.3),'1')}
        ${TD(pc(s.risk?.alpha_3y),rc(parseFloat(s.risk?.alpha_3y),0,-2))}
        ${TD(s.risk?.down_capture_3y!=null?nb(s.risk.down_capture_3y,1)+'%':'—',rcL(parseFloat(s.risk?.down_capture_3y),90,105))}
      </tr>`;
    }).join('');

    const trailingRows = [
      ['1 month', B.ret1m, bm.rets.r1m],
      ['3 months', B.ret3m, bm.rets.r3m],
      ['Year to date', B.ytd, bm.rets.ytd],
      ['1 year', B.ret1y, bm.rets.r1y],
      ['3 years (CAGR)', B.ret3y, bm.rets.r3y],
      ['5 years (CAGR)', B.ret5y, bm.rets.r5y],
    ].map(([lbl,pv,bv]) => {
      const d = pv!=null&&bv!=null ? pv-bv : null;
      return `<tr>${TDL(lbl)}${TD(pc(pv),rc(parseFloat(pv),0,-5),'1')}${TD(pc(bv),rc(parseFloat(bv),0,-5))}${TD(d!=null?pc(d):'—',d!=null?(d>=0?POS:NEG):GR60,'1')}</tr>`;
    }).join('');

    const riskRows = [
      ['Sharpe ratio (3Y)','Return per unit of risk',nb(B.sharpe),rc(B.sharpe,0.7,0.4),(B.sharpe||0)>=0.7?'Strong':(B.sharpe||0)>=0.4?'Adequate':'Weak'],
      ['Alpha (3Y)','Excess return vs benchmark',pc(B.alpha),rc(B.alpha,0,-2),(B.alpha||0)>=2?'Outperforming':(B.alpha||0)>=0?'Neutral':'Lagging'],
      ['Beta (3Y)','Market sensitivity',nb(B.beta),Math.abs(((B.beta||1)-1))<0.15?POS:WARN,(B.beta||1)<0.9?'Defensive':(B.beta||1)<=1.1?'Market-like':'Aggressive'],
      ['Down capture (3Y)','Portfolio drop vs market',nb(B.dncap)+'%',rcL(B.dncap,90,105),(B.dncap||100)<=90?'Protected':(B.dncap||100)<=100?'On par':'Amplified'],
      ['Up capture (3Y)','Portfolio gain vs market rise',nb(B.upcap)+'%',rc(B.upcap,100,90),(B.upcap||0)>=100?'Outpacing':'Slightly lagging'],
      ['Std deviation (3Y)','Annualised return volatility',nb(B.std3y)+'%',rcL(B.std3y,14,20),(B.std3y||0)<=14?'Low vol':(B.std3y||0)<=20?'Moderate':'High vol'],
      ['Blended ER','Weighted expense ratio',nb(B.er)+'%',rcL(B.er,1.0,1.8),(B.er||0)<=1.0?'Cost-efficient':(B.er||0)<=1.5?'Reasonable':'Review costs'],
    ].map(([m,sub,v,c,lbl]) =>
      `<tr>${TDL(m,'1',sub)}${TD(v,c,'1')}
        <td style="padding:7px 12px;border-bottom:1px solid ${GR20};text-align:right">
          <span style="font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:${c===POS?'#E6F4ED':c===WARN?'#FEF9EC':'#FEE2E2'};color:${c}">${lbl}</span>
        </td></tr>`
    ).join('');

    /* Annexure: per-fund cards */
    const annexCards = SF.map(f => {
      const s=snapshots[f.isin]||{};
      const metrics=[
        [pc(s.returns?.['1y']),'1Y return',rc(parseFloat(s.returns?.['1y']),0,-5)],
        [pc(s.returns?.['3y']),'3Y CAGR',rc(parseFloat(s.returns?.['3y']),0,-5)],
        [pc(s.returns?.['5y']),'5Y CAGR',rc(parseFloat(s.returns?.['5y']),0,-5)],
        [nb(s.risk?.sharpe_ratio_3y),'Sharpe (3Y)',rc(parseFloat(s.risk?.sharpe_ratio_3y),0.5,0.3)],
        [pc(s.risk?.alpha_3y),'Alpha (3Y)',rc(parseFloat(s.risk?.alpha_3y),0,-2)],
        [s.risk?.down_capture_3y!=null?nb(s.risk.down_capture_3y)+'%':'—','Down capture',rcL(parseFloat(s.risk?.down_capture_3y),90,105)],
        [s.expense_ratio!=null?parseFloat(s.expense_ratio).toFixed(2)+'%':'—','Expense ratio',rcL(parseFloat(s.expense_ratio),1.0,1.8)],
        [s.risk?.std_dev_3y!=null?nb(s.risk.std_dev_3y)+'%':'—','Std dev (3Y)',rcL(parseFloat(s.risk?.std_dev_3y),14,20)],
      ];
      return `<div style="border:1px solid ${GR20};border-radius:12px;overflow:hidden;margin-bottom:16px;page-break-inside:avoid">
        <div style="padding:12px 18px;background:linear-gradient(135deg,${PLUM},${MUT});display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700;color:#fff">${f.name}</div>
            <div style="font-size:10px;color:rgba(255,255,255,.75);margin-top:1px">${f.category||''} · ${f.isin||''}</div>
          </div>
          <div style="text-align:right">
            <div style="background:${f.color};color:#fff;font-size:18px;font-weight:700;padding:4px 16px;border-radius:20px;font-family:'DM Mono',monospace">${f._wPct.toFixed(0)}%</div>
            <div style="font-size:9px;color:rgba(255,255,255,.65);margin-top:3px">${fmtL(f._wPct/100*investAmt)} allocated</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0">
          ${metrics.map(([v,l,c])=>`<div style="padding:11px 14px;border-right:1px solid ${GR20};border-top:1px solid ${GR20}">
            <div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:${c};line-height:1;margin-bottom:2px">${v}</div>
            <div style="font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${GR60}">${l}</div>
          </div>`).join('')}
        </div>
        <div style="padding:10px 18px;background:${GR10};border-top:1px solid ${GR20};display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          ${CYK.map((k,i)=>{const v=s.returns?.['cy20'+CYL[i].slice(2)];return v!=null?`<div style="text-align:center"><div style="font-family:'DM Mono',monospace;font-size:11.5px;font-weight:700;color:${parseFloat(v)>=0?POS:NEG}">${parseFloat(v)>=0?'+':''}${parseFloat(v).toFixed(1)}%</div><div style="font-size:8.5px;color:${GR60}">${CYL[i]}</div></div>`:''}).join('')}
        </div>
      </div>`;
    }).join('');

    const surplus = TOTAL_FV-BM_FV;
    const CYdataAbv = CYK.filter((_,i)=>B['cy'+CYL[i].slice(2)]!=null&&bm.rets['r'+CYL[i].slice(2)]!=null&&(B['cy'+CYL[i].slice(2)]||0)>(bm.rets['r'+CYL[i].slice(2)]||0)).length;
    const CYdataTot = CYK.filter((_,i)=>B['cy'+CYL[i].slice(2)]!=null&&bm.rets['r'+CYL[i].slice(2)]!=null).length;
    const spreadGap = (B.ret3y||0)-(bm.rets.r3y||0);

    /* ════════════════════════════════════════════
       WRITE HTML DOCUMENT
    ════════════════════════════════════════════ */
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Investment Proposal — ${CLIENT}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:13px}
body{font-family:'DM Sans',sans-serif;background:#fff;color:${GR80};line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:1200px;margin:0 auto;padding:32px 48px}
section{margin-bottom:32px}
.pg{page-break-before:always;padding-top:36px}
table{border-collapse:collapse;width:100%}
@media print{@page{margin:8mm 12mm;size:297mm 210mm}.no-print{display:none!important}}
html,body{width:297mm}
</style></head><body>

<!-- Toolbar -->
<div class="no-print" style="background:${PLUM};padding:11px 28px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:99;box-shadow:0 2px 12px rgba(0,0,0,.25)">
  <div style="flex:1;color:rgba(255,255,255,.7);font-size:12px">Investment Proposal &nbsp;·&nbsp; <strong style="color:#fff">${CLIENT}</strong> &nbsp;·&nbsp; ${TODAY}</div>
  <button onclick="window.print()" style="padding:8px 22px;background:${BERRY};color:#fff;border:none;border-radius:8px;font:600 12px 'DM Sans',sans-serif;cursor:pointer;letter-spacing:.03em">⬇ Save as PDF</button>
  <button onclick="window.close()" style="padding:8px 14px;background:rgba(255,255,255,.1);color:#fff;border:1.5px solid rgba(255,255,255,.25);border-radius:8px;font:12px 'DM Sans',sans-serif;cursor:pointer">✕ Close</button>
</div>

<div class="page">

<!-- ═══ COVER PAGE ═══ -->
<section style="min-height:260px;position:relative">
  <div style="height:5px;background:linear-gradient(90deg,${BERRY},${MUT},${LAV});border-radius:3px;margin-bottom:36px"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${LAV};margin-bottom:12px">Investment Proposal</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:48px;font-weight:700;color:${PLUM};line-height:1.05;margin-bottom:8px">${CLIENT}</div>
      <div style="font-size:14px;color:${GR60};line-height:1.9">
        <span style="color:${GR80};font-weight:500">Objective:</span> ${GOAL}<br>
        <span style="color:${GR80};font-weight:500">Risk profile:</span> ${RISK}<br>
        <span style="color:${GR80};font-weight:500">Horizon:</span> ${TENURE}
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;color:${BERRY};letter-spacing:-.01em">BügleRock Capital</div>
      <div style="font-size:9px;color:${LAV};letter-spacing:.14em;text-transform:uppercase;margin-top:2px;margin-bottom:16px">Sound of Clarity</div>
      <div style="font-size:12px;color:${GR60};line-height:1.9">
        <span style="color:${GR80};font-weight:500">Date:</span> ${TODAY}<br>
        <span style="color:${GR80};font-weight:500">Prepared by:</span> ${RM}<br>
        <span style="color:${GR80};font-weight:500">Investment:</span> ${INVEST}
      </div>
    </div>
  </div>
  <div style="height:1px;background:linear-gradient(90deg,${BERRY},${GR20});margin-bottom:24px"></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
    ${kpiCell(SF.length+' funds','Portfolio size','Diversified allocation',PLUM)}
    ${kpiCell(pc(B.ret3y),'3Y CAGR (blended)',pc(bm.rets.r3y)+' benchmark',rc(B.ret3y,0,-5),(B.ret3y||0)>=(bm.rets.r3y||0)?'#E6F4ED':'#FEE2E2')}
    ${kpiCell(nb(B.sharpe),'Sharpe ratio (3Y)','Risk-adjusted quality',rc(B.sharpe,0.5,0.3),(B.sharpe||0)>=0.5?'#E6F4ED':'#FEF9EC')}
    ${kpiCell(fmtL(TOTAL_FV*100000),TYR+'Y projected corpus',fmtL(BM_FV*100000)+' benchmark',BERRY,'#F7EEF3')}
  </div>
</section>

<!-- ═══ PAGE 2: IPS ═══ -->
<section class="pg">
  ${sectionHd('01','Investment Policy Statement','Defines the client\'s objectives, constraints and guidelines governing this portfolio.')}
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
    ${infoCell('Client / entity',CLIENT)}
    ${infoCell('Prepared by',RM)}
    ${infoCell('Investment amount',INVEST)}
    ${infoCell('Proposal date',TODAY)}
    ${infoCell('Primary objective',GOAL)}
    ${infoCell('Risk profile',RISK)}
    ${infoCell('Investment tenure',TENURE)}
    ${infoCell('Target return',TRET)}
    ${infoCell('Deployment mode',DEPLOY)}
    ${infoCell('Monthly SIP',sipAmt>0?'₹'+sipAmt.toLocaleString('en-IN'):'—')}
    ${infoCell('Review frequency',REVFREQ)}
    ${infoCell('Benchmark',bm.name)}
  </div>
  ${CONSTRAIN?tblBox('Investment constraints &amp; exclusions',`<div style="padding:11px 16px;font-size:12px;line-height:1.8;color:${GR80}">${CONSTRAIN}</div>`):''}
  ${NOTES?tblBox('Adviser notes &amp; special instructions',`<div style="padding:11px 16px;font-size:12px;line-height:1.8;color:${GR80}">${NOTES}</div>`):''}
</section>

<!-- ═══ PAGE 3: PORTFOLIO OVERVIEW ═══ -->
<section class="pg">
  ${sectionHd('02','Portfolio overview',`Blended analytics for the recommended ${SF.length}-fund portfolio vs ${bm.name}.`)}
  <div style="display:flex;align-items:stretch;gap:16px;margin-bottom:18px">
    <div style="background:${SC_BG};border:2px solid ${SC_CLR};border-radius:12px;padding:20px 24px;text-align:center;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:120px">
      <div style="font-family:'Cormorant Garamond',serif;font-size:56px;font-weight:700;color:${SC_CLR};line-height:1">${OVERALL}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:.07em;color:${SC_CLR}">/ 100</div>
      <div style="font-size:12px;font-weight:600;color:${SC_CLR};margin-top:6px">${SC_LBL}</div>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      ${kpiCell(pc(B.ret1y),'1Y return',pc(bm.rets.r1y)+' benchmark',rc(B.ret1y,0,-5))}
      ${kpiCell(pc(B.ret3y),'3Y CAGR',pc(bm.rets.r3y)+' benchmark',rc(B.ret3y,0,-5))}
      ${kpiCell(pc(B.ret5y),'5Y CAGR',pc(bm.rets.r5y)+' benchmark',rc(B.ret5y,0,-5))}
      ${kpiCell(nb(B.sharpe),'Sharpe (3Y)',nb(B.sortino)+' Sortino',rc(B.sharpe,0.5,0.3))}
      ${kpiCell(pc(B.alpha),'Alpha (3Y)','vs '+bm.name,rc(B.alpha,0,-2))}
      ${kpiCell(nb(B.dncap)+'%','Down capture','≤100% = protective',rcL(B.dncap,95,105))}
      ${kpiCell(nb(B.er)+'%','Blended ER','Expense ratio',rcL(B.er,1.0,1.8))}
      ${kpiCell(nb(B.std3y)+'%','Std deviation (3Y)','Annualised vol',rcL(B.std3y,14,20))}
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    ${tblBox('Fund allocation','<div style="padding:14px 18px;display:flex;align-items:center;gap:16px">'+donutSvg+'</div>')}
    ${tblBox('Market cap &amp; asset mix','<div style="padding:14px 20px">'+capSvg+'</div>')}
  </div>
  ${(()=>{
    const scorecardRows=[
      ['Return quality',    B.alpha,  [2,0],   false, ['Outperforming','Neutral','Lagging'],    'Alpha of '+pc(B.alpha)+' vs '+bm.name+'. '+((B.alpha||0)>=2?'Fund managers are consistently adding value above market exposure.':(B.alpha||0)>=0?'Positive but modest — watch for persistence over next reporting periods.':'Negative alpha after fees questions the value of active management in the current mix.')],
      ['Risk efficiency',   B.sharpe, [0.7,0.4],false,['Strong','Adequate','Weak'],             'Sharpe '+nb(B.sharpe)+'. '+((B.sharpe||0)>=0.7?'Excellent — portfolio delivers strong returns relative to the risk taken.':(B.sharpe||0)>=0.4?'Adequate risk-adjusted returns — there is room to improve by replacing low-Sharpe holdings.':'Below acceptable threshold — the portfolio is taking on more risk than its returns justify.')],
      ['Downside shield',   B.dncap,  [90,100], true,  ['Protected','On par','Exposed'],        'Down capture '+nb(B.dncap)+'%. '+((B.dncap||100)<=90?'In falling markets, portfolio loses less than the benchmark — strong capital protection.':(B.dncap||100)<=100?'Portfolio falls broadly in line with the market in corrections.':'Portfolio amplifies drawdowns — consider adding defensive or low-beta funds.')],
      ['Cost efficiency',   B.er,     [1.0,1.5],true,  ['Low cost','Reasonable','Review costs'],'Blended ER '+nb(B.er)+'%. '+((B.er||0)<=1.0?'Highly cost-efficient construction. Maximum net return accrues to the client.':(B.er||0)<=1.5?'Reasonable expense ratio for active management.':'Above-average cost drag — switching to Direct plans could significantly improve net returns.')],
    ];
    const rows=scorecardRows.map(([m,v,thrs,lb,labs,interp])=>{
      const ok=lb?(v||0)<=thrs[0]:(v||0)>=thrs[0];
      const warn2=lb?((v||0)<=thrs[1]&&(v||0)>thrs[0]):(v||0)>=thrs[1]&&(v||0)<thrs[0];
      const c=v==null?GR60:ok?POS:warn2?WARN:NEG;
      const bg=ok?'#E6F4ED':warn2?'#FEF9EC':'#FEE2E2';
      const lbl=ok?labs[0]:warn2?labs[1]:labs[2];
      return `<tr>${TDL(m,'1')}${TD(v!=null?(lb?nb(v)+'%':pc(v)):'—',c,'1')}
        <td style="padding:7px 12px;border-bottom:1px solid ${GR20};text-align:right"><span style="font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:${bg};color:${c}">${lbl}</span></td>
        <td style="padding:7px 13px;border-bottom:1px solid ${GR20};font-size:11px;color:${GR60};line-height:1.55;max-width:360px">${interp}</td></tr>`;
    }).join('');
    return tblBox('Portfolio health scorecard',`<table><thead><tr>${TH('Dimension','left')}${TH('Value')}${TH('Rating')}${TH('Interpretation','left')}</tr></thead><tbody>${rows}</tbody></table>`);
  })()}
</section>

<!-- ═══ PAGE 4: PERFORMANCE ═══ -->
<section class="pg">
  ${sectionHd('03','Performance analysis',`Returns across all periods and calendar years vs ${bm.name}.`)}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    ${tblBox(`Trailing returns vs ${bm.name}`,
      `<table><thead><tr>${TH('Period','left')}${TH('Portfolio')}${TH('Benchmark')}${TH('Difference')}</tr></thead><tbody>${trailingRows}</tbody></table>`)}
    ${tblBox(`Calendar year performance vs ${bm.name}`,
      `<div style="padding:14px 18px">${cySvg}
      <div style="display:flex;gap:14px;font-size:10px;color:${GR60};margin-top:10px;align-items:center">
        <span><span style="display:inline-block;width:10px;height:10px;background:${BERRY};border-radius:2px;margin-right:4px;vertical-align:middle"></span>Portfolio</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:${LAV};border-radius:2px;margin-right:4px;vertical-align:middle;opacity:.75"></span>${bm.name}</span>
        <span style="margin-left:auto">▲▼ = outperformance / lag</span>
      </div></div>`)}
  </div>
  ${callout(`Portfolio has outperformed ${bm.name} in <strong>${CYdataAbv} of ${CYdataTot} calendar years</strong>. Blended 3Y CAGR of <strong>${pc(B.ret3y)}</strong> compares to benchmark's <strong>${pc(bm.rets.r3y)}</strong> — a spread of <strong>${spreadGap>=0?'+':''}${spreadGap.toFixed(2)}%</strong>. ${spreadGap>0?'Consistent positive alpha demonstrates active fund selection skill over the measurement period.':'The portfolio has lagged the benchmark over 3 years. Review fund selection or consider increasing passive exposure.'}`,spreadGap>=0?'pos':'warn')}
</section>

<!-- ═══ PAGE 5: WEALTH CREATION ═══ -->
<section class="pg">
  ${sectionHd('04','Wealth creation — Growth projection',`Based on blended 3Y CAGR of ${pc(B.ret3y)} over 10 years.`)}
  ${(()=>{
    const investedL2 = investAmt/100000;
    const ptfCAGR = { 3:(B.ret3y||0)/100, 5:(B.ret5y||B.ret3y||0)/100, 10:(B.ret5y||B.ret3y||0)/100 };
    const bmCAGR3b = (bm.rets.r3y||0)/100;
    const bmCAGR5b = (bm.rets.r5y||bm.rets.r3y||0)/100;
    const bmCAGR10b= (bm.rets.r5y||bm.rets.r3y||0)/100;
    const gY=[0,1,2,3,4,5,6,7,8,9,10];
    const ptfGo=gY.map(y=>investedL2*Math.pow(1+(B.ret3y||0)/100,y));
    const bmGo=gY.map(y=>bmCAGR10b>0?investedL2*Math.pow(1+bmCAGR10b,y):investedL2);
    const mxGo=Math.max(...ptfGo.concat(bmGo))*1.05;
    const GW2=520,GH2=110,GP2=20;
    const gx2=i=>(GP2+(i/10)*(GW2-GP2*2)).toFixed(1);
    const gy2=v=>(GH2-GP2-(v/mxGo)*(GH2-GP2*2)+GP2*0.3).toFixed(1);
    const ptfD2=ptfGo.map((v,i)=>(i===0?'M':'L')+gx2(i)+','+gy2(v)).join(' ');
    const bmD2=bmGo.map((v,i)=>(i===0?'M':'L')+gx2(i)+','+gy2(v)).join(' ');
    const areaD2=ptfD2+' L'+gx2(10)+','+GH2+' L'+gx2(0)+','+GH2+' Z';
    const growSvg2=`<svg width="100%" height="${GH2}" viewBox="0 0 ${GW2} ${GH2}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${BERRY}" stop-opacity=".15"/><stop offset="100%" stop-color="${BERRY}" stop-opacity="0"/></linearGradient></defs>
      <path d="${areaD2}" fill="url(#ag2)"/>
      <path d="${ptfD2}" fill="none" stroke="${BERRY}" stroke-width="2"/>
      <path d="${bmD2}" fill="none" stroke="${LAV}" stroke-width="1.5" stroke-dasharray="5 3"/>
    </svg>`;
    const ptf10=investedL2*Math.pow(1+ptfCAGR[10],10)*100000;
    const bm10v=bmCAGR10b>0?investedL2*Math.pow(1+bmCAGR10b,10)*100000:null;
    const extra10=bm10v!=null?ptf10-bm10v:null;
    return `<div style="border:1px solid ${GR20};border-radius:0 0 8px 8px;padding:16px">
      <div style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start;margin-bottom:14px">
        <div>
          <div style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${GR60};margin-bottom:4px">Projected wealth after 10 years (${fmtL(investAmt)} invested)</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:34px;font-weight:700;color:${BERRY}">${fmtL(ptf10)}</div>
          <div style="font-size:12px;color:${GR60};margin-top:2px">${bmCAGR10b>0?'vs '+fmtL(bm10v)+' ('+bm.name+')':bm.name}</div>
          ${extra10!=null?`<div style="font-size:13px;font-weight:600;color:${extra10>=0?POS:BERRY};margin-top:4px">${extra10>=0?'+':''}${fmtL(extra10)} extra wealth created</div>`:''}
          <div style="font-size:9px;color:${GR60};margin-top:6px">Portfolio: 5Y CAGR ${pc(B.ret5y||B.ret3y)} · Benchmark: ${pc(bm.rets.r5y||bm.rets.r3y)} · Illustrative only.</div>
        </div>
      </div>
      ${growSvg2}
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:12px">
        <thead><tr style="background:${GR10}">
          ${TH('Horizon','left')}${TH('Portfolio')}${TH(bm.name)}${TH('Extra wealth')}
        </tr></thead>
        <tbody>${[3,5,10].map(y=>{
          const pc2=ptfCAGR[y]||(B.ret3y||0)/100;
          const bc2=y===3?bmCAGR3b:y===5?bmCAGR5b:bmCAGR10b;
          const ptfV=investedL2*Math.pow(1+pc2,y)*100000;
          const bmV2b=bc2>0?investedL2*Math.pow(1+bc2,y)*100000:null;
          const ex2=bmV2b!=null?ptfV-bmV2b:null;
          return `<tr style="border-bottom:1px solid ${GR20}">
            <td style="padding:6px 10px;font-weight:500">${y} yrs</td>
            <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:${BERRY}">${fmtL(ptfV)}</td>
            <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;color:${LAV}">${bmV2b!=null?fmtL(bmV2b):'—'}</td>
            <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;color:${ex2!=null?(ex2>=0?POS:NEG):GR60}">${ex2!=null?(ex2>=0?'+':'')+fmtL(ex2):'—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  })()}
</section>

<!-- ═══ PAGE 6: RISK ═══ -->
<section class="pg">
  ${sectionHd('05','Risk profile &amp; quality','Comprehensive risk metrics with market-context interpretation.')}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    ${tblBox('Risk metrics — blended portfolio',
      `<table><thead><tr>${TH('Metric','left')}${TH('Value')}${TH('Rating')}</tr></thead><tbody>${riskRows}</tbody></table>`)}
    ${tblBox('Portfolio style &amp; characteristics',
      `<div style="padding:14px 18px;font-size:12px;color:${GR80};line-height:1.9">
        <strong style="color:${PLUM}">Cap bias:</strong> ${(B.lc||0)>60?'Large-cap dominated ('+nb(B.lc,0)+'%). Lower volatility, steady market-like returns.':(B.sc||0)>25?'Small-cap heavy ('+nb(B.sc,0)+'%). Higher growth potential with elevated volatility.':'Diversified cap mix — balanced growth and stability across market cycles.'}<br><br>
        <strong style="color:${PLUM}">Defensiveness:</strong> Beta of ${nb(B.beta)} — the portfolio is expected to ${(B.beta||1)<0.9?'fall and rise less than the market, providing cushion in corrections.':(B.beta||1)<=1.1?'move broadly in line with the market.':'amplify market moves — both gains and losses will exceed the benchmark.'}<br><br>
        <strong style="color:${PLUM}">Downside protection:</strong> Down capture of ${nb(B.dncap)}% means the portfolio ${(B.dncap||100)<=90?'falls significantly less than the benchmark in drawdowns — strong capital protection.':(B.dncap||100)<=100?'falls broadly in line with the market in corrections.':'amplifies drawdowns — consider adding defensive holdings.'}
      </div>`)}
  </div>
</section>

<!-- ═══ PAGE 6b: STRESS TEST ═══ -->
<section class="pg">
  ${sectionHd('05a','Crash scenario stress test','Portfolio drawdown in historical market crashes — based on actual NAV returns.')}
  ${(()=>{
    const scenarios = resolvedStress?.scenarios?.filter(s => s.has_data && s.portfolio_return != null) || [];
    if (!scenarios.length) return callout('Stress test data not available. Visit the Stress test tab in Analyse to load scenario data before generating the proposal.','info');
    const stressRows = scenarios.map(sc => {
      const v = sc.portfolio_return;
      const bm2 = sc.benchmark_return;
      const delta = bm2 != null ? v - bm2 : null;
      const label = sc.label || '';
      const vStr = (v>=0?'+':'')+v.toFixed(1)+'%';
      const bStr = bm2!=null?(bm2>=0?'+':'')+bm2.toFixed(1)+'%':'—';
      const dStr = delta!=null?(delta>=0?'↑ +':'↓ ')+delta.toFixed(1)+'% vs market':'—';
      const dClr = delta!=null?(delta>=0?POS:NEG):GR60;
      return `<tr>${TDL(sc.name+'<div style="font-size:9px;color:'+GR60+'">'+label+'</div>')}
        ${TD(vStr,v>=0?POS:NEG,'1')}
        ${TD(bStr,bm2!=null?(bm2>=0?POS:NEG):GR60)}
        <td style="padding:7px 12px;border-bottom:1px solid ${GR20};text-align:right"><span style="font-size:10px;font-weight:700;color:${dClr}">${dStr}</span></td></tr>`;
    }).join('');
    return tblBox('Crash scenario stress test — actual NAV returns',
      `<table><thead><tr>${TH('Scenario','left')}${TH('Portfolio return')}${TH('Benchmark')}${TH('Cushion vs market')}</tr></thead><tbody>${stressRows}</tbody></table>`,
      'Returns calculated from actual NAV history in the database for the exact funds and weights in this portfolio.');
  })()}
</section>

<!-- ═══ PAGE 6c: OVERLAP ═══ -->
<section class="pg">
  ${sectionHd('05b','Portfolio overlap matrix','Shared stock holdings between active equity funds in the portfolio.')}
  ${(()=>{
    if (!resolvedOverlap?.pairwise_matrix) return callout('No overlap data — only debt/liquid funds in portfolio or data unavailable.','info');
    const funds2 = funds.filter(f => {
      const ac = (f.asset_class || snapshots[f.isin]?.asset_class || '').toLowerCase();
      const cat = (f.category || snapshots[f.isin]?.category || '').toLowerCase();
      return !(ac==='debt'||ac==='bond'||cat.includes('liquid')||cat.includes('overnight')||cat.includes('money market')||cat.includes('gilt')||cat.includes('corporate bond'));
    });
    if (funds2.length < 2) return '';
    const pairwise_matrix = resolvedOverlap.pairwise_matrix;
    const shortName = n => n.replace(/\b(Fund|Growth|Direct|Regular|Plan|Option|Gr|India|Mutual)\b/gi,'').replace(/\s+/g,' ').trim().slice(0,22);
    const overlapColor = pct => pct>=35?'#C0392B':pct>=25?'#E67E22':pct>=15?'#F39C12':pct>=5?'#27AE60':'#A0A0A0';
    const overlapBg   = pct => pct>=35?'rgba(192,57,43,.10)':pct>=25?'rgba(230,126,34,.10)':pct>=15?'rgba(243,156,18,.10)':pct>=5?'rgba(39,174,96,.10)':'#f4f4f4';
    const matrixHtml = `<table style="border-collapse:separate;border-spacing:5px;margin:0 auto">
      <thead><tr>
        <td style="width:110px"></td>
        ${funds2.map(f=>`<th style="text-align:center;padding:0 3px 8px;font-size:9px;font-weight:500;width:74px">
          <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="width:8px;height:8px;border-radius:2px;background:${f.color||LAV}"></div>
            <div style="max-width:70px;text-align:center;line-height:1.3">${shortName(f.name)}</div>
          </div></th>`).join('')}
      </tr></thead>
      <tbody>${funds2.map((fa,i)=>`<tr>
        <td style="text-align:right;padding:3px 8px 3px 0;font-size:9px;font-weight:500;white-space:nowrap">
          <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${fa.color||LAV};margin-right:5px;vertical-align:middle"></span>${shortName(fa.name)}
        </td>
        ${funds2.map((fb,j)=>{
          if(i===j) return `<td style="width:74px;height:40px;background:#f4f4f4;border-radius:7px;text-align:center;font-size:15px;color:#ccc">—</td>`;
          const key = i<j?`${fa.isin}|${fb.isin}`:`${fb.isin}|${fa.isin}`;
          const p = pairwise_matrix[key]; const pct = p?.overlap_pct||0;
          return `<td style="width:74px;height:40px;background:${overlapBg(pct)};border-radius:7px;text-align:center;vertical-align:middle">
            <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:14px;color:${overlapColor(pct)}">${pct.toFixed(0)}%</div>
          </td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody></table>
      <div style="display:flex;gap:14px;margin-top:10px;font-size:9px;color:#8A8790;justify-content:center">
        <span><span style="color:#A0A0A0">●</span> &lt;5% Negligible</span>
        <span><span style="color:#27AE60">●</span> 5–15% Low</span>
        <span><span style="color:#F39C12">●</span> 15–25% Moderate</span>
        <span><span style="color:#E67E22">●</span> 25–35% High</span>
        <span><span style="color:#C0392B">●</span> &gt;35% Very high</span>
      </div>`;
    return tblBox('Portfolio overlap matrix',`<div style="padding:14px 16px;overflow-x:auto">${matrixHtml}</div>`,'Active equity funds only. Overlap >25% may indicate concentration risk.');
  })()}
</section>

<!-- ═══ PAGE 6d: CORRELATION ═══ -->
<section class="pg">
  ${sectionHd('05c','Return correlation matrix','3-year daily NAV return correlation between all portfolio funds.')}
  ${(()=>{
    if (!resolvedCorr?.matrix || !resolvedCorr?.included || resolvedCorr.included.length < 2) return callout('Insufficient NAV history to compute correlation — funds may be too new.','info');
    const inc = resolvedCorr.included;
    // Build fund list in same order as included ISINs
    const corrFunds = inc.map(isin => funds.find(f => f.isin === isin)).filter(Boolean);
    const shortName = n => n.replace(/\b(Fund|Growth|Direct|Regular|Plan|Option|Gr|India|Mutual)\b/gi,'').replace(/\s+/g,' ').trim().slice(0,18);
    const corrColor = v => {
      if (v == null) return {bg:'#f4f4f4', clr:'#ccc'};
      const a = Math.abs(v);
      if (v === 1) return {bg:'#EDE9F2', clr:PLUM};
      if (a >= 0.85) return {bg:'rgba(145,47,99,.15)', clr:BERRY};
      if (a >= 0.70) return {bg:'rgba(209,87,26,.12)', clr:'#D1571A'};
      if (a >= 0.50) return {bg:'rgba(234,179,8,.10)', clr:'#92700A'};
      return {bg:'rgba(26,122,82,.10)', clr:POS};
    };
    const drStr = resolvedCorr.date_range ? `${resolvedCorr.date_range.start} → ${resolvedCorr.date_range.end} · ${resolvedCorr.common_days} trading days` : '';
    const corrMatrixHtml = `<table style="border-collapse:separate;border-spacing:4px;margin:0 auto">
      <thead><tr>
        <td style="min-width:100px"></td>
        ${corrFunds.map((f,i)=>`<th style="text-align:center;padding:0 4px 8px;font-size:9px;font-weight:600;color:${f.color||LAV};width:68px">F${i+1}</th>`).join('')}
      </tr></thead>
      <tbody>${corrFunds.map((fi,i)=>`<tr>
        <td style="text-align:right;padding:3px 8px 3px 0;font-size:9px;font-weight:500;white-space:nowrap">
          <span style="color:${fi.color||LAV};font-weight:700">F${i+1}</span> ${shortName(fi.name)}
        </td>
        ${corrFunds.map((_,j)=>{
          const ri = inc.indexOf(fi.isin), rj = inc.indexOf(corrFunds[j].isin);
          const v = (ri>=0&&rj>=0) ? resolvedCorr.matrix[ri][rj] : null;
          const {bg,clr} = corrColor(v);
          return `<td style="width:68px;height:38px;background:${bg};border-radius:6px;text-align:center;vertical-align:middle;border:2px solid #fff">
            <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:13px;color:${clr}">${v!=null?v.toFixed(2):'—'}</span>
          </td>`;
        }).join('')}
      </tr>`).join('')}</tbody></table>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:9px;color:${GR60};justify-content:center;align-items:center">
        <span><span style="color:${BERRY}">■</span> ≥0.85 High</span>
        <span><span style="color:#D1571A">■</span> 0.70–0.85 Moderate</span>
        <span><span style="color:#92700A">■</span> 0.50–0.70 Low</span>
        <span><span style="color:${POS}">■</span> &lt;0.50 Weak</span>
        ${drStr?`<span style="margin-left:auto;font-style:italic">${drStr}</span>`:''}
      </div>
      ${resolvedCorr.excluded?.length?`<div style="margin-top:8px;font-size:9px;color:#92700A;background:#FEF9EC;padding:7px 12px;border-radius:6px;border:1px solid rgba(234,179,8,.3)">Excluded (insufficient data): ${resolvedCorr.excluded.map(e=>{const f=funds.find(f=>f.isin===e.isin);return f?f.name:e.isin}).join(', ')}</div>`:''}`;
    return tblBox('Return correlation matrix',`<div style="padding:14px 16px;overflow-x:auto">${corrMatrixHtml}</div>`,'Based on 3-year daily NAV returns. ≥0.85 = high correlation — funds move together, reducing diversification benefit.');
  })()}
</section>

<!-- ═══ PAGE 7: EXPOSURE & STYLE ═══ -->
<section class="pg">
  ${sectionHd('06','Portfolio exposure &amp; style','Market cap, asset class, valuation and growth/value characteristics.')}
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">
    ${tblBox('Market cap allocation','<div style="padding:14px 18px">'+capSvg+'</div>')}
    ${tblBox('Valuation &amp; cost metrics',
      `<table><tbody>
        ${[[nb(B.std3y)+'%','Std deviation (3Y)','Annualised vol',rcL(B.std3y,14,20)],
           [nb(B.beta),'Beta (3Y)','Market sensitivity',Math.abs(((B.beta||1)-1))<0.15?POS:WARN],
           [nb(B.er)+'%','Blended ER','<1.0% = low cost',rcL(B.er,1.0,1.8)],
           [nb(B.dncap)+'%','Down capture','≤90% = protected',rcL(B.dncap,90,105)],
           [nb(B.upcap)+'%','Up capture','≥100% = outpacing',rc(B.upcap,100,90)],
        ].map(([v,m,sub,c])=>`<tr>${TDL(m,'',sub)}${TD(v,c,'1')}</tr>`).join('')}
      </tbody></table>`)}
    ${(()=>{
      const capBias = (B.lc||0)>60 ? `Large-cap dominated (${nb(B.lc,0)}%). Steady, market-like returns with lower volatility.` : (B.sc||0)>25 ? `Small-cap heavy (${nb(B.sc,0)}%). Higher growth potential, elevated volatility.` : 'Diversified across large, mid and small — balanced across market cycles.';
      const styleBias = (B.std3y||0)<=14 ? 'Low volatility portfolio — suitable for conservative mandates and shorter horizons.' : (B.std3y||0)<=20 ? 'Moderate volatility — appropriate for medium-term wealth creation goals.' : 'Higher volatility profile — suitable for aggressive investors with long horizons only.';
      const defText = (B.beta||1)<0.9 ? 'move less than the market in both directions — strong cushion.' : (B.beta||1)<=1.1 ? 'broadly track the market.' : 'amplify market moves.';
      return tblBox('Style &amp; characteristics',
        `<div style="padding:14px 18px;font-size:12px;color:${GR80};line-height:1.9">
          <strong style="color:${PLUM}">Cap bias:</strong> ${capBias}<br><br>
          <strong style="color:${PLUM}">Style bias:</strong> ${styleBias}<br><br>
          <strong style="color:${PLUM}">Defensiveness:</strong> Beta ${nb(B.beta)} — portfolio expected to ${defText}
        </div>`);
    })()}
  </div>
</section>

<!-- ═══ PAGE 8: FUND TABLE ═══ -->
<section class="pg">
  ${sectionHd('07','Fund details',`Complete data for all ${SF.length} holdings in the recommended portfolio.`)}
  ${tblBox('Portfolio holdings — all metrics',
    `<div style="overflow-x:auto"><table><thead><tr>
      ${TH('Fund','left')}${TH('Weight')}${TH('Amount')}${TH('ER')}${TH('1Y')}${TH('3Y CAGR')}${TH('5Y CAGR')}${TH('Sharpe')}${TH('Alpha')}${TH('Dn cap')}
    </tr></thead><tbody>${fundRows}</tbody>
    <tfoot><tr style="background:${PLUM}">
      <td colspan="2" style="padding:8px 12px;background:${PLUM};color:#fff;font-family:'DM Sans',sans-serif;font-weight:700">Blended portfolio</td>
      <td style="padding:8px 12px;background:${PLUM};color:#fff;font-family:'DM Mono',monospace;font-weight:700;text-align:right">${fmtL(investAmt)}</td>
      <td style="padding:8px 12px;background:${PLUM};color:#fff;font-family:'DM Mono',monospace;font-weight:700;text-align:right">${nb(B.er)+'%'}</td>
      <td style="padding:8px 12px;background:${PLUM};color:${(B.ret1y||0)>=0?'#A4E4C0':'#FFB3B3'};font-family:'DM Mono',monospace;font-weight:700;text-align:right">${pc(B.ret1y)}</td>
      <td style="padding:8px 12px;background:${PLUM};color:${(B.ret3y||0)>=0?'#A4E4C0':'#FFB3B3'};font-family:'DM Mono',monospace;font-weight:700;text-align:right">${pc(B.ret3y)}</td>
      <td style="padding:8px 12px;background:${PLUM};color:${(B.ret5y||0)>=0?'#A4E4C0':'#FFB3B3'};font-family:'DM Mono',monospace;font-weight:700;text-align:right">${pc(B.ret5y)}</td>
      <td style="padding:8px 12px;background:${PLUM};color:#fff;font-family:'DM Mono',monospace;font-weight:700;text-align:right">${nb(B.sharpe)}</td>
      <td style="padding:8px 12px;background:${PLUM};color:${(B.alpha||0)>=0?'#A4E4C0':'#FFB3B3'};font-family:'DM Mono',monospace;font-weight:700;text-align:right">${pc(B.alpha)}</td>
      <td style="padding:8px 12px;background:${PLUM};color:#fff;font-family:'DM Mono',monospace;font-weight:700;text-align:right">${B.dncap!=null?nb(B.dncap)+'%':'—'}</td>
    </tr></tfoot></table></div>`,
    `Sharpe ≥ 0.5 = strong · Alpha ≥ 0 = outperforming · Down capture ≤ 100% = portfolio loses less than market in drawdowns · ER < 1.0% = low cost`)}
  ${callout(`The ${SF.length}-fund portfolio achieves a blended 3Y CAGR of ${pc(B.ret3y)} with a Sharpe ratio of ${nb(B.sharpe)} and alpha of ${pc(B.alpha)} vs ${bm.name}. The blended ER of ${nb(B.er)}% ${(B.er||0)<=1.2?'reflects an efficient, cost-conscious construction.':'should be reviewed — migrating to Direct plans could reduce costs significantly.'}`,(B.sharpe||0)>=0.5&&(B.alpha||0)>=0?'pos':'warn')}
</section>

<!-- ═══ ANNEXURE: FUND SNAPSHOTS ═══ -->
<section class="pg">
  ${sectionHd('A','Annexure — Individual fund snapshots','Performance, risk metrics and calendar year returns for each holding.')}
  ${annexCards}
</section>

<!-- DISCLAIMER -->
<div style="border:1px solid ${GR20};border-radius:10px;padding:16px 20px;background:${GR10};margin-top:8px">
  <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${LAV};margin-bottom:8px">Important disclosures &amp; risk warnings</div>
  <div style="font-size:10px;color:#888;line-height:1.9">
    This investment proposal is prepared by <strong>${RM}</strong> for the exclusive use of <strong>${CLIENT}</strong>. All mutual fund data is sourced from BugleRock Analytics as at the proposal date and is subject to change. <strong>Past performance is not a reliable indicator of future results.</strong> Mutual fund investments are subject to market risk — the value of investments can go down as well as up. Projections are purely illustrative and assume a constant compounding rate equal to the portfolio's blended 3-year CAGR; actual returns will vary materially. This document does not constitute investment advice, a solicitation, or an offer to buy or sell any security. Investors should read all Scheme Information Documents (SIDs) and Key Information Memoranda (KIMs) carefully before investing. &nbsp;
    <strong>BugleRock Capital Pte. Ltd.</strong> · CMS Licence No. 100978 · 30 Raffles Place #07-01, BNI Tower, Singapore 048622. &nbsp;
    <strong>BugleRock Capital Pvt. Ltd.</strong> · SEBI Registered · Prestige Takt, 23 Kasturba Cross Road, Bengaluru 560001. &nbsp;
    © BugleRock 2026. All rights reserved. Sound of Clarity.
  </div>
</div>

</div></body></html>`;

    if (!w) { alert('Could not open proposal window. Please allow popups.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /* ── PREVIEW UI ─────────────────────────────────────────────── */
  const B2 = blendPtf(funds, activeWeights, snapshots);
  const bm2name = bm.name || 'Benchmark';
  const BERRY2  = '#912F63', POS2 = '#1A7A52';

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'32px 28px', display:'flex', alignItems:'flex-start', justifyContent:'center' }}>
      <div style={{ maxWidth:640, width:'100%' }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ width:72,height:72,borderRadius:'50%',background:'rgba(145,47,99,.06)',border:'1.5px solid rgba(145,47,99,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,margin:'0 auto 16px' }}>📄</div>
          <div style={{ fontFamily:'var(--font-serif)',fontSize:24,fontWeight:600,color:'var(--brand-dark)',marginBottom:6 }}>Generate portfolio proposal</div>
          <div style={{ fontSize:13,color:'var(--text-muted)',lineHeight:1.7 }}>Professional client-ready proposal with IPS, analytics, growth projections, risk breakdown, fund snapshots and annexure.</div>
        </div>

        {/* Summary card */}
        <div style={{ background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:20 }}>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12 }}>
            {[
              { l:'Client',           v: ips?.name || '(not set)' },
              { l:'Investment amount',v: ips?.amount ? '₹'+ips.amount : '(not set)' },
              { l:'Portfolio funds',  v: funds.length+' funds' },
              { l:'Objective',        v: ips?.primaryObjective || '(not set)' },
              { l:'Risk profile',     v: ips?.riskProfile || '(not set)' },
              { l:'Benchmark',        v: bm2name },
              { l:'IPS',              v: ips?.name ? '✓ Saved' : 'Not saved',   c: ips?.name ? POS2 : 'var(--text-muted)' },
              { l:'Optimisation',     v: hasOpt ? '✓ Applied' : 'Not run',      c: hasOpt ? POS2 : 'var(--text-muted)' },
              { l:'Portfolio for proposal', v: selectedPortfolio==='optimised'&&hasOpt?'Optimised':'Original', c: BERRY2 },
            ].map((item,i) => (
              <div key={i}>
                <div style={{ fontSize:9,fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--text-muted)',marginBottom:3 }}>{item.l}</div>
                <div style={{ fontSize:12,fontWeight:600,color:item.c||'var(--brand-dark)' }}>{item.v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:12,paddingTop:10,borderTop:'1px solid var(--border)',fontSize:11,color:'var(--text-muted)',lineHeight:1.7 }}>
            <strong>Proposal includes:</strong> Cover · IPS · Portfolio overview · Performance · Wealth projection · Risk & stress test · Overlap matrix · Exposure & style · Fund table · Per-fund annexure<br/>
            Stress test and overlap data are fetched fresh on download — no need to visit those tabs first.
          </div>
        </div>

        {/* Portfolio selector */}
        <div style={{ background:'var(--bg-secondary)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'14px 18px',marginBottom:24 }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--text-muted)',marginBottom:10 }}>Proposal will use</div>
          <div style={{ display:'flex',gap:10 }}>
            {[
              { val:'original',  label:'Original portfolio',  desc:'Your hand-built weights', color:'var(--pos)' },
              { val:'optimised', label:'Optimised portfolio',  desc:'Strategy-applied weights',color:'var(--brand-primary)', disabled:!hasOpt },
            ].map(opt => (
              <label key={opt.val} style={{ flex:1,display:'flex',alignItems:'center',gap:8,cursor:opt.disabled?'not-allowed':'pointer',padding:'10px 14px',border:`1.5px solid ${selectedPortfolio===opt.val?opt.color:'var(--border)'}`,borderRadius:'var(--radius-lg)',background:'#fff',opacity:opt.disabled?.5:1 }}>
                <input type="radio" name="ptf-which-pdf" value={opt.val} checked={selectedPortfolio===opt.val} onChange={()=>!opt.disabled&&setSelectedPortfolio(opt.val)} disabled={opt.disabled} style={{ accentColor:opt.color }} />
                <div>
                  <div style={{ fontSize:12,fontWeight:600,color:opt.color }}>{opt.label}</div>
                  <div style={{ fontSize:10,color:'var(--text-muted)' }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap' }}>
          <button className="btn btn-ghost" onClick={onEditPortfolio} style={{ fontSize:12 }}>← Edit portfolio</button>
          <button className="btn btn-ghost" onClick={onCompare} style={{ fontSize:12 }}>Compare portfolios</button>
          <button className="btn btn-primary" onClick={generatePDF} disabled={generating} style={{ fontSize:13,padding:'11px 28px',borderRadius:20,letterSpacing:'normal',textTransform:'none',opacity:generating?0.7:1 }}>{generating ? '⏳ Generating…' : '⬇ Download PDF'}</button>
          <button onClick={generatePPT} style={{ fontSize:13,padding:'11px 28px',borderRadius:20,background:'var(--brand-dark)',color:'#fff',border:'none',fontFamily:'var(--font-body)',fontWeight:600,cursor:'pointer' }}>⬇ Download PPT</button>
        </div>
        <div style={{ textAlign:'center',marginTop:10,fontSize:11,color:'var(--text-muted)' }}>PDF opens in a new tab — use browser print to save as PDF.</div>

      </div>
    </div>
  );
}