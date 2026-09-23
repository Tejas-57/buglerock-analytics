// generateComparisonPDF.js
// frontend/src/components/PeerComparison/generateComparisonPDF.js

export function generateComparisonPDF(funds, sectorData, selectedDate) {
  if (!funds || funds.length === 0) return;

  const BERRY = '#912F63';
  const PLUM  = '#3E3452';
  const LIGHT = '#F7F5F3';
  const BORDER = '#E8E5EC';
  const MONO  = "'DM Mono', monospace";
  const SERIF = "'Cormorant Garamond', serif";
  const SANS  = "'DM Sans', sans-serif";

  const refDate = selectedDate instanceof Date
    ? selectedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : selectedDate || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  function fmt(v, d = 2) {
    if (v === null || v === undefined || v === '-') return '—';
    const n = parseFloat(v);
    return isNaN(n) ? '—' : n.toFixed(d);
  }

  function pct(v) {
    if (v === null || v === undefined || v === '-') return '—';
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function pctc(v) {
    if (v === null || v === undefined || v === '-') return '—';
    const n = parseFloat(v);
    return isNaN(n) ? '—' : n.toFixed(2) + '%';
  }

  function fmtAum(v) {
    if (!v || v === '-') return '—';
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return n >= 10000 ? '₹' + (n / 1000).toFixed(0) + 'K Cr' : '₹' + n.toFixed(0) + ' Cr';
  }

  function stars(r) {
    const n = Math.round(parseFloat(r));
    return isNaN(n) ? '' : '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function highlight(vals, lowerBetter = false) {
    const nums = vals.map(v => (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null);
    const valid = nums.filter(v => v !== null && !isNaN(v));
    if (valid.length < 2) return vals.map(() => '');
    const best  = lowerBetter ? Math.min(...valid) : Math.max(...valid);
    const worst = lowerBetter ? Math.max(...valid) : Math.min(...valid);
    return nums.map(v => {
      if (v === null || isNaN(v)) return '';
      if (v === best  && best !== worst) return 'best';
      if (v === worst && best !== worst) return 'worst';
      return '';
    });
  }

  const colW = Math.max(120, Math.floor(480 / funds.length));

  function tableHeader() {
    return `
      <tr style="background:#fff;border-bottom:2px solid ${BORDER}">
        <th style="width:140px;min-width:140px;padding:10px 12px;text-align:left;font-weight:400;font-size:10px;color:#8A8790;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid ${BORDER}">Metric</th>
        ${funds.map(f => `
          <th style="width:${colW}px;min-width:${colW}px;padding:10px 12px;border-left:1px solid ${BORDER};border-top:3px solid ${f.color};text-align:right;font-weight:normal;vertical-align:top">
            <div style="font-size:11px;font-weight:700;color:${PLUM};line-height:1.3;margin-bottom:3px;text-align:left">${f.name}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(145,47,99,0.08);color:${BERRY};font-weight:500">${(f.category || '').replace(/^(India Fund |India OE |India ETF |Cat: )/, '')}</span>
              ${f.data?.fund_size && f.data.fund_size !== '-' ? `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(109,84,121,0.08);color:#6D5479;font-weight:500">${fmtAum(f.data.fund_size)}</span>` : ''}
            </div>
            <div style="font-family:${SERIF};font-size:16px;font-weight:600;color:${f.color};text-align:left">
              ${f.data?.nav && f.data.nav !== '-' ? `₹${parseFloat(f.data.nav).toFixed(2)}` : '—'}
            </div>
            ${f.data?.morningstar_rating && f.data.morningstar_rating !== '-' ? `<div style="font-size:11px;color:#B46B10;letter-spacing:-1px;text-align:left">${stars(f.data.morningstar_rating)}</div>` : ''}
          </th>
        `).join('')}
      </tr>`;
  }

  function sectionHead(label) {
    return `
      <tr>
        <td style="padding:7px 12px;font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${BERRY};background:${LIGHT};border-top:1px solid ${BORDER}" colspan="${funds.length + 1}">${label}</td>
      </tr>`;
  }

  function row(label, vals, fmtFn, lowerBetter = false, showBar = false) {
    const hl  = highlight(vals, lowerBetter);
    const nums = vals.map(v => (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null);
    const maxAbs = Math.max(...nums.filter(v => v !== null && !isNaN(v)).map(Math.abs), 1);
    return `
      <tr style="border-bottom:1px solid ${BORDER}">
        <td style="padding:7px 12px;font-size:11px;color:#5A5760;font-weight:500;white-space:nowrap;border-right:1px solid ${BORDER}">${label}</td>
        ${vals.map((v, i) => {
          const cls = hl[i];
          const bg    = cls === 'best'  ? 'rgba(16,185,129,0.08)' : cls === 'worst' ? 'rgba(239,68,68,0.08)' : '#fff';
          const color = cls === 'best'  ? '#059669' : cls === 'worst' ? '#DC2626' : '#2C2A30';
          const txt   = fmtFn(v);
          const n     = parseFloat(v);
          const barW  = (showBar && !isNaN(n)) ? (Math.abs(n) / maxAbs * 100).toFixed(0) : 0;
          const barC  = cls === 'best'  ? '#059669' : cls === 'worst' ? '#DC2626' : '#A795AE';
          const empty = v === null || v === undefined || v === '-' || txt === '—';
          return `<td style="padding:7px 12px;text-align:right;font-family:${MONO};font-size:11px;font-weight:${cls ? 700 : 500};background:${empty ? LIGHT : bg};color:${color};border-left:1px solid ${BORDER}">
            ${empty ? '<span style="color:#ccc">—</span>' : showBar ? `
              <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
                <div style="width:36px;height:3px;background:#eee;border-radius:2px;overflow:hidden;flex-shrink:0">
                  <div style="width:${barW}%;height:100%;background:${barC};border-radius:2px"></div>
                </div>${txt}
              </div>` : txt}
          </td>`;
        }).join('')}
      </tr>`;
  }

  function wrapPage(title, content, pageNum) {
    return `
      <div class="page">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid ${BORDER}">
          <div style="font-family:${SERIF};font-size:18px;font-weight:600;color:${PLUM}">${title}</div>
          <div style="text-align:right">
            <div style="font-size:10px;color:#8A8790">As of ${refDate}</div>
            <div style="font-size:9px;color:#B0ADB5;margin-top:2px">BugleRock Capital · Page ${pageNum}</div>
          </div>
        </div>
        <div style="overflow:hidden;border-radius:8px;border:1px solid ${BORDER}">
          <table style="width:100%;border-collapse:collapse;font-family:${SANS};font-size:12px;table-layout:fixed">
            <thead>${tableHeader()}</thead>
            <tbody>${content}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Page 1: Returns ───────────────────────────────────────────────────────

  const wins = funds.map(() => 0);
  const retKeys = ['1m','3m','6m','1y','2y','3y','5y','10y','ytd','cy2025','cy2024','cy2023','cy2022','cy2021'];
  retKeys.forEach(k => {
    const vals = funds.map(f => f.data?.returns?.[k]);
    const nums = vals.map(v => (v !== null && v !== undefined && v !== '-') ? parseFloat(v) : null);
    const valid = nums.filter(v => v !== null && !isNaN(v));
    if (!valid.length) return;
    const best = Math.max(...valid);
    nums.forEach((v, i) => { if (v === best) wins[i]++; });
  });
  const maxWins = Math.max(...wins);

  const returnsContent = `
    ${sectionHead('Return Periods')}
    ${row('1 month',  funds.map(f => f.data?.returns?.['1m']),    pct, false, true)}
    ${row('3 months', funds.map(f => f.data?.returns?.['3m']),    pct, false, true)}
    ${row('6 months', funds.map(f => f.data?.returns?.['6m']),    pct, false, true)}
    ${row('1 year',   funds.map(f => f.data?.returns?.['1y']),    pct, false, true)}
    ${row('2 year',   funds.map(f => f.data?.returns?.['2y']),    pct, false, true)}
    ${row('3Y CAGR',  funds.map(f => f.data?.returns?.['3y']),    pct, false, true)}
    ${row('5Y CAGR',  funds.map(f => f.data?.returns?.['5y']),    pct, false, true)}
    ${row('10Y CAGR', funds.map(f => f.data?.returns?.['10y']),   pct, false, true)}
    ${row('YTD 2026', funds.map(f => f.data?.returns?.['ytd']),   pct, false, true)}
    ${sectionHead('Calendar Year Returns')}
    ${row('CY 2025',  funds.map(f => f.data?.returns?.['cy2025']), pct, false, true)}
    ${row('CY 2024',  funds.map(f => f.data?.returns?.['cy2024']), pct, false, true)}
    ${row('CY 2023',  funds.map(f => f.data?.returns?.['cy2023']), pct, false, true)}
    ${row('CY 2022',  funds.map(f => f.data?.returns?.['cy2022']), pct, false, true)}
    ${row('CY 2021',  funds.map(f => f.data?.returns?.['cy2021']), pct, false, true)}
    ${funds.length >= 2 ? `
    <tr>
      <td style="padding:10px 12px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${BERRY};background:${LIGHT};border-right:1px solid ${BORDER}">Periods Won</td>
      ${wins.map((w, i) => {
        const isTop = w === maxWins;
        return `<td style="padding:10px 12px;text-align:right;background:${isTop ? 'rgba(145,47,99,0.06)' : LIGHT};border-left:1px solid ${BORDER}">
          <span style="font-family:${SERIF};font-size:18px;font-weight:600;color:${isTop ? BERRY : '#2C2A30'}">${w}</span>
          <div style="font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#8A8790">${isTop ? '★ Leading' : 'periods'}</div>
        </td>`;
      }).join('')}
    </tr>` : ''}`;

  // ── Page 2: Risk Metrics ───────────────────────────────────────────────────

  const riskContent = `
    ${sectionHead('1-Year Risk Metrics')}
    ${row('Sharpe (1Y)',   funds.map(f => f.data?.risk?.sharpe_ratio_1y), v => fmt(v), false, true)}
    ${row('Alpha (1Y)',    funds.map(f => f.data?.risk?.alpha_1y),        pct, false, true)}
    ${row('Beta (1Y)',     funds.map(f => f.data?.risk?.beta_1y),         v => fmt(v), true)}
    ${row('Up cap (1Y)',   funds.map(f => f.data?.risk?.up_capture_1y),   pctc)}
    ${row('Down cap (1Y)', funds.map(f => f.data?.risk?.down_capture_1y), pctc, true)}
    ${row('Std dev (1Y)',  funds.map(f => f.data?.risk?.std_dev_1y),      pctc, true)}
    ${sectionHead('3-Year Risk Metrics')}
    ${row('Sharpe ratio',  funds.map(f => f.data?.risk?.sharpe_ratio_3y), v => fmt(v), false, true)}
    ${row('Sortino ratio', funds.map(f => f.data?.risk?.sortino_ratio_3y),v => fmt(v), false, true)}
    ${row('Alpha',         funds.map(f => f.data?.risk?.alpha_3y),        pct, false, true)}
    ${row('Beta',          funds.map(f => f.data?.risk?.beta_3y),         v => fmt(v), true)}
    ${row('Up capture',    funds.map(f => f.data?.risk?.up_capture_3y),   pctc)}
    ${row('Down capture',  funds.map(f => f.data?.risk?.down_capture_3y), pctc, true)}
    ${row('Std deviation', funds.map(f => f.data?.risk?.std_dev_3y),      pctc, true)}`;

  // ── Page 3: Composition ────────────────────────────────────────────────────

  const compositionContent = `
    ${sectionHead('Market Cap Split')}
    ${row('Large cap', funds.map(f => f.data?.large_cap), pctc, false, true)}
    ${row('Mid cap',   funds.map(f => f.data?.mid_cap),   pctc, false, true)}
    ${row('Small cap', funds.map(f => f.data?.small_cap), pctc, false, true)}
    ${sectionHead('Asset Allocation')}
    ${row('Equity', funds.map(f => f.data?.equity_pct), pctc, false, true)}
    ${row('Bonds',  funds.map(f => f.data?.bond_pct),   pctc, false, true)}
    ${row('Cash',   funds.map(f => f.data?.cash_pct),   pctc, false, true)}
    ${sectionHead('Valuation Metrics')}
    ${row('P/E ratio', funds.map(f => f.data?.pe_ratio), v => fmt(v), true)}
    ${row('P/B ratio', funds.map(f => f.data?.pb_ratio), v => fmt(v), true)}`;

  // ── Page 4: Sectoral Exposure ──────────────────────────────────────────────

  const SECTOR_LABELS = {
    basic_materials: 'Basic Materials', communication_services: 'Communication Services',
    consumer_cyclical: 'Consumer Cyclical', consumer_defensive: 'Consumer Defensive',
    energy: 'Energy', financial_services: 'Financial Services', healthcare: 'Healthcare',
    industrials: 'Industrials', real_estate: 'Real Estate', technology: 'Technology', utilities: 'Utilities',
  };
  const SECTOR_COLORS = ['#912F63','#3E3452','#1A7A52','#D97706','#185FA5','#B91C1C','#6D5479','#0891B2','#F59E0B','#059669','#7C3AED'];

  const allSectors = [...new Set(
    funds.flatMap(f => (sectorData[f.isin] || []).map(s => s.sector))
  )].sort((a, b) => {
    const maxA = Math.max(...funds.map(f => (sectorData[f.isin] || []).find(s => s.sector === a)?.weight_pct || 0));
    const maxB = Math.max(...funds.map(f => (sectorData[f.isin] || []).find(s => s.sector === b)?.weight_pct || 0));
    return maxB - maxA;
  });

  const sectorContent = allSectors.length === 0
    ? `<tr><td colspan="${funds.length + 1}" style="padding:24px;text-align:center;color:#8A8790;font-size:12px">Sector data not available — visit the Sectoral Exposure tab first to load data</td></tr>`
    : allSectors.map((sector, si) => {
        const clr  = SECTOR_COLORS[si % SECTOR_COLORS.length];
        const vals = funds.map(f => (sectorData[f.isin] || []).find(s => s.sector === sector)?.weight_pct ?? null);
        const maxVal = Math.max(...vals.filter(v => v != null), 0);
        return `
          <tr style="border-bottom:1px solid ${BORDER}">
            <td style="padding:7px 12px;font-size:11px;color:#5A5760;white-space:nowrap;border-right:1px solid ${BORDER}">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${clr};margin-right:6px;vertical-align:middle"></span>
              ${SECTOR_LABELS[sector] || sector}
            </td>
            ${vals.map(v => {
              const isTop = v === maxVal && maxVal > 0;
              return `<td style="padding:7px 12px;text-align:right;border-left:1px solid ${BORDER};background:${isTop ? clr + '20' : '#fff'}">
                ${v != null ? `
                  <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
                    <div style="width:36px;height:3px;background:#eee;border-radius:2px;overflow:hidden;flex-shrink:0">
                      <div style="width:${(v/Math.max(maxVal,1)*100).toFixed(0)}%;height:100%;background:${clr};border-radius:2px"></div>
                    </div>
                    <span style="font-family:${MONO};font-size:11px;font-weight:${isTop ? 700 : 500};color:${isTop ? clr : '#2C2A30'}">${v.toFixed(1)}%</span>
                  </div>` : '<span style="color:#ccc">—</span>'}
              </td>`;
            }).join('')}
          </tr>`;
      }).join('');

  // ── Cover page ─────────────────────────────────────────────────────────────

  // Fund list — outside the dark header, as a separate white card below
  const fundListRows = funds.map((f, i) => `
    <tr style="border-bottom:1px solid ${BORDER}">
      <td style="padding:12px 16px;width:32px;vertical-align:middle">
        <div style="width:14px;height:14px;border-radius:4px;background:${f.color}"></div>
      </td>
      <td style="padding:12px 8px 12px 0;vertical-align:middle">
        <div style="font-size:13px;font-weight:600;color:${PLUM};margin-bottom:2px">${f.name}</div>
        <div style="font-size:10px;color:#8A8790">${(f.category || '').replace(/^(India Fund |India OE |India ETF |Cat: )/, '')} &nbsp;·&nbsp; AUM ${fmtAum(f.data?.fund_size)}</div>
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:middle;white-space:nowrap">
        <div style="font-family:${MONO};font-size:15px;font-weight:700;color:${f.color}">${f.data?.nav && f.data.nav !== '-' ? `₹${parseFloat(f.data.nav).toFixed(2)}` : '—'}</div>
        ${f.data?.returns?.['1y'] && f.data.returns['1y'] !== '-' ? `<div style="font-size:10px;font-weight:600;color:${parseFloat(f.data.returns['1y']) >= 0 ? '#059669' : '#DC2626'};margin-top:2px">${pct(f.data.returns['1y'])} 1Y return</div>` : ''}
      </td>
    </tr>`).join('');

  const coverPage = `
    <div class="page" style="display:flex;flex-direction:column;gap:20px">

      <!-- Header banner -->
      <div style="background:${PLUM};border-radius:12px;padding:28px 32px;display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-family:${SERIF};font-size:34px;font-weight:700;color:#fff;letter-spacing:-.02em;line-height:1.1">Fund Comparison<br>Report</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:10px">As of ${refDate} &nbsp;·&nbsp; Prepared ${today}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:${SERIF};font-size:20px;font-weight:600;color:#fff">BügleRock Capital</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:4px">Sound of Clarity</div>
        </div>
      </div>

      <!-- Fund list — white card outside header -->
      <div style="border-radius:10px;border:1px solid ${BORDER};overflow:hidden">
        <div style="padding:10px 16px;background:${LIGHT};border-bottom:1px solid ${BORDER}">
          <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8A8790">Funds in this report</div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${fundListRows}</tbody>
        </table>
      </div>

      <!-- Disclaimer -->
      <div style="padding-top:12px;border-top:1px solid ${BORDER};font-size:8px;color:#B0ADB5;line-height:1.6">
        This report is prepared by BugleRock Capital for internal and client discussion purposes only. Data sourced from Morningstar. Past performance is not indicative of future results. BugleRock Capital does not guarantee the accuracy or completeness of the information herein. Not for public distribution.
      </div>
    </div>`;

  // ── Assemble & open ────────────────────────────────────────────────────────

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fund Comparison — BugleRock Capital</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; background: #fff; color: #2C2A30; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin: 12mm; size: A4 landscape; }
    @media print {
      .no-print { display: none !important; }
      .page { page-break-after: always; padding: 0; }
      .page:last-child { page-break-after: avoid; }
    }
    .page { padding: 20px; max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
  </style>
</head>
<body>
  ${coverPage}
  ${wrapPage('Returns', returnsContent, 1)}
  ${wrapPage('Risk Metrics', riskContent, 2)}
  ${wrapPage('Composition', compositionContent, 3)}
  ${wrapPage('Sectoral Exposure', sectorContent, 4)}

  <div class="no-print" style="text-align:center;padding:24px">
    <button onclick="window.print()" style="padding:12px 28px;background:${BERRY};color:#fff;border:none;border-radius:8px;font:600 13px 'DM Sans',sans-serif;cursor:pointer;margin-right:10px">⬇ Print / Save PDF</button>
    <button onclick="window.close()" style="padding:12px 28px;background:#f4f4f4;color:#555;border:none;border-radius:8px;font:600 13px 'DM Sans',sans-serif;cursor:pointer">Close</button>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}