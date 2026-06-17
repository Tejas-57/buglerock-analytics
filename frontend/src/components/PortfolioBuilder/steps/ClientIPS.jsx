import React from 'react';

export default function ClientIPS({ ips, setIps, onSave, onSkip }) {
  function update(field, value) {
    setIps(prev => ({ ...prev, [field]: value }));
  }
  function updateAlloc(field, value) {
    setIps(prev => ({ ...prev, alloc: { ...prev.alloc, [field]: value } }));
  }

  return (
    <div className="ptf-panel p-active" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="ips-scroll">
        <div className="ips-max">

          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 3 }}>
              Investment Policy Statement
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Define client objectives, risk profile, and allocation guidelines before building the portfolio.{' '}
              <button onClick={onSkip} style={{ background: 'none', border: 'none', color: 'var(--brand-primary)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                Skip and build without IPS →
              </button>
            </div>
          </div>

          {/* Section A — Client Information */}
          <div style={{ marginBottom: 18 }}>
            <div className="ips-s-hd"><span className="ips-s-num">A</span>Client information</div>
            <div className="ips-g4">
              <div className="ips-f"><label>Client name / entity</label><input type="text" value={ips.name || ''} onChange={e => update('name', e.target.value)} placeholder="e.g. Priya Sharma" /></div>
              <div className="ips-f"><label>PAN / Reference ID</label><input type="text" value={ips.pan || ''} onChange={e => update('pan', e.target.value)} placeholder="Optional" /></div>
              <div className="ips-f"><label>Investment amount (₹)</label><input type="text" value={ips.amount || ''} onChange={e => update('amount', e.target.value)} placeholder="e.g. 50,00,000" /></div>
              <div className="ips-f"><label>Prepared by (RM)</label><input type="text" value={ips.rm || 'BugleRock Capital'} onChange={e => update('rm', e.target.value)} /></div>
              <div className="ips-f"><label>Client email</label><input type="email" value={ips.email || ''} onChange={e => update('email', e.target.value)} placeholder="client@email.com" /></div>
              <div className="ips-f"><label>Tax status</label>
                <select value={ips.taxStatus || 'Resident individual'} onChange={e => update('taxStatus', e.target.value)}>
                  <option>Resident individual</option><option>HUF</option><option>NRI</option>
                  <option>Corporate / Trust</option><option>PMS / AIF</option>
                </select>
              </div>
              <div className="ips-f"><label>Proposal date</label><input type="date" value={ips.proposalDate || new Date().toISOString().slice(0,10)} onChange={e => update('proposalDate', e.target.value)} /></div>
              <div className="ips-f"><label>Next review date</label><input type="date" value={ips.nextReviewDate || ''} onChange={e => update('nextReviewDate', e.target.value)} /></div>
            </div>
          </div>

          {/* Section B — Objectives & Time Horizon */}
          <div style={{ marginBottom: 18 }}>
            <div className="ips-s-hd"><span className="ips-s-num">B</span>Objectives &amp; time horizon</div>
            <div className="ips-g4">
              <div className="ips-f"><label>Primary objective</label>
                <select value={ips.primaryObjective || 'Wealth creation'} onChange={e => update('primaryObjective', e.target.value)}>
                  <option>Wealth creation</option><option>Retirement planning</option><option>Child education</option>
                  <option>Tax optimisation</option><option>Capital preservation</option><option>Regular income</option>
                  <option>Corpus building</option><option>NRI repatriation corpus</option>
                </select>
              </div>
              <div className="ips-f"><label>Secondary objective</label>
                <select value={ips.secondaryObjective || '—'} onChange={e => update('secondaryObjective', e.target.value)}>
                  <option>—</option><option>Wealth creation</option><option>Regular income</option>
                  <option>Capital preservation</option><option>Tax savings (ELSS)</option><option>Emergency corpus</option>
                </select>
              </div>
              <div className="ips-f"><label>Investment tenure</label>
                <select value={ips.tenure || 'Very long-term (7+ years)'} onChange={e => update('tenure', e.target.value)}>
                  <option>Short-term (1–3 years)</option><option>Medium-term (3–5 years)</option>
                  <option>Long-term (5–7 years)</option><option>Very long-term (7+ years)</option>
                </select>
              </div>
              <div className="ips-f"><label>Target return (% p.a.)</label><input type="text" value={ips.targetReturn || ''} onChange={e => update('targetReturn', e.target.value)} placeholder="e.g. 14%" /></div>
              <div className="ips-f"><label>Deployment mode</label>
                <select value={ips.deploymentMode || 'Lump sum — single tranche'} onChange={e => update('deploymentMode', e.target.value)}>
                  <option>Lump sum — single tranche</option><option>Lump sum — 3 tranches (STP)</option>
                  <option>Lump sum — 6 tranches (STP)</option><option>SIP only</option><option>Lump sum + SIP</option>
                </select>
              </div>
              <div className="ips-f"><label>Monthly SIP (₹)</label><input type="text" value={ips.monthlySIP || ''} onChange={e => update('monthlySIP', e.target.value)} placeholder="e.g. 25,000" /></div>
              <div className="ips-f"><label>Review frequency</label>
                <select value={ips.reviewFrequency || 'Quarterly'} onChange={e => update('reviewFrequency', e.target.value)}>
                  <option>Monthly</option><option>Quarterly</option><option>Semi-annual</option><option>Annual</option>
                </select>
              </div>
              <div className="ips-f"><label>Retirement age</label><input type="text" value={ips.retirementAge || ''} onChange={e => update('retirementAge', e.target.value)} placeholder="e.g. 60" /></div>
            </div>
          </div>

          {/* Section C — Risk Profile */}
          <div style={{ marginBottom: 18 }}>
            <div className="ips-s-hd"><span className="ips-s-num">C</span>Risk profile &amp; suitability</div>
            <div className="ips-g4">
              <div className="ips-f"><label>Risk profile</label>
                <select value={ips.riskProfile || 'Moderate'} onChange={e => update('riskProfile', e.target.value)}>
                  <option>Conservative</option><option>Moderately conservative</option><option>Moderate</option>
                  <option>Moderately aggressive</option><option>Aggressive</option><option>Very aggressive</option>
                </select>
              </div>
              <div className="ips-f"><label>Risk score (1–100)</label><input type="number" min="1" max="100" value={ips.riskScore || ''} onChange={e => update('riskScore', e.target.value)} placeholder="e.g. 65" /></div>
              <div className="ips-f"><label>Max drawdown tolerance</label>
                <select value={ips.maxDrawdown || '10–20%'} onChange={e => update('maxDrawdown', e.target.value)}>
                  <option>Less than 5%</option><option>5–10%</option><option>10–20%</option>
                  <option>20–30%</option><option>Greater than 30%</option>
                </select>
              </div>
              <div className="ips-f"><label>Liquidity requirement</label>
                <select value={ips.liquidity || 'Moderate (≤10% in 3 months)'} onChange={e => update('liquidity', e.target.value)}>
                  <option>None</option><option>Low (≤5% in 30 days)</option>
                  <option>Moderate (≤10% in 3 months)</option><option>High (≥20% within 1 month)</option>
                </select>
              </div>
              <div className="ips-f"><label>Investment experience</label>
                <select value={ips.experience || '3–7 years'} onChange={e => update('experience', e.target.value)}>
                  <option>First-time investor</option><option>Less than 1 year</option><option>1–3 years</option>
                  <option>3–7 years</option><option>7+ years</option>
                </select>
              </div>
              <div className="ips-f"><label>Source of funds</label>
                <select value={ips.sourceOfFunds || 'Salary / Business income'} onChange={e => update('sourceOfFunds', e.target.value)}>
                  <option>Salary / Business income</option><option>Inheritance</option><option>Property sale</option>
                  <option>Investment proceeds</option><option>Other</option>
                </select>
              </div>
              <div className="ips-f"><label>Annual income range</label>
                <select value={ips.annualIncome || 'Below ₹10L'} onChange={e => update('annualIncome', e.target.value)}>
                  <option>Below ₹10L</option><option>₹10–25L</option><option>₹25–50L</option>
                  <option>₹50L–1Cr</option><option>Above ₹1Cr</option>
                </select>
              </div>
              <div className="ips-f"><label>Net worth range</label>
                <select value={ips.netWorth || 'Below ₹25L'} onChange={e => update('netWorth', e.target.value)}>
                  <option>Below ₹25L</option><option>₹25L–1Cr</option><option>₹1–5Cr</option>
                  <option>₹5–25Cr</option><option>Above ₹25Cr</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section D — Target Asset Allocation */}
          <div style={{ marginBottom: 18 }}>
            <div className="ips-s-hd"><span className="ips-s-num">D</span>Target asset allocation</div>
            <div className="ips-g2">
              <div>
                <div className="ips-sub">Equity</div>
                {[
                  ['Total equity', 'eqMin', 'eqMax', 60, 100],
                  ['Large cap', 'lcMin', 'lcMax', 30, 70],
                  ['Mid cap', 'mcMin', 'mcMax', 15, 40],
                  ['Small cap', 'scMin', 'scMax', 0, 25],
                  ['International', 'intlMin', 'intlMax', 0, 15],
                ].map(([label, minKey, maxKey, defMin, defMax]) => (
                  <div className="alloc-row" key={label}>
                    <div className="alloc-lbl">{label}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input className="alloc-in" value={ips.alloc?.[minKey] ?? defMin} onChange={e => updateAlloc(minKey, e.target.value)} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>–</span>
                      <input className="alloc-in" value={ips.alloc?.[maxKey] ?? defMax} onChange={e => updateAlloc(maxKey, e.target.value)} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div className="ips-sub">Debt &amp; alternatives</div>
                {[
                  ['Debt / Bonds', 'debtMin', 'debtMax', 0, 30],
                  ['Gold / Alt', 'goldMin', 'goldMax', 0, 10],
                  ['Cash / Liquid', 'cashMin', 'cashMax', 0, 10],
                ].map(([label, minKey, maxKey, defMin, defMax]) => (
                  <div className="alloc-row" key={label}>
                    <div className="alloc-lbl">{label}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input className="alloc-in" value={ips.alloc?.[minKey] ?? defMin} onChange={e => updateAlloc(minKey, e.target.value)} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>–</span>
                      <input className="alloc-in" value={ips.alloc?.[maxKey] ?? defMax} onChange={e => updateAlloc(maxKey, e.target.value)} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section E — Benchmark, Constraints & Guidelines */}
          <div style={{ marginBottom: 18 }}>
            <div className="ips-s-hd"><span className="ips-s-num">E</span>Benchmark, constraints &amp; guidelines</div>
            <div className="ips-g4" style={{ marginBottom: 10 }}>
              <div className="ips-f"><label>Portfolio benchmark</label>
                <select value={ips.benchmark || 'nifty50'} onChange={e => update('benchmark', e.target.value)}>
                  <option value="nifty50">Nifty 50 TRI</option><option value="nifty100">Nifty 100 TRI</option>
                  <option value="nifty500">Nifty 500 TRI</option><option value="midcap150">Nifty Midcap 150 TRI</option>
                  <option value="smallcap250">Nifty Smallcap 250 TRI</option><option value="largmid250">Nifty Large Midcap 250 TRI</option>
                  <option value="hybrid7525">Nifty 50 Hybrid 75:25 TRI</option><option value="sensex">BSE Sensex TRI</option>
                </select>
              </div>
              <div className="ips-f"><label>Max funds</label>
                <select value={ips.maxFunds || '5'} onChange={e => update('maxFunds', e.target.value)}>
                  <option>3</option><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option><option>10</option>
                </select>
              </div>
              <div className="ips-f"><label>Min fund AUM (₹ Cr)</label><input type="text" value={ips.minAUM || ''} onChange={e => update('minAUM', e.target.value)} placeholder="e.g. 500" /></div>
              <div className="ips-f"><label>Max expense ratio (%)</label><input type="text" value={ips.maxER || ''} onChange={e => update('maxER', e.target.value)} placeholder="e.g. 1.5" /></div>
            </div>
            <div className="ips-g2">
              <div className="ips-f"><label>Investment constraints &amp; exclusions</label>
                <textarea value={ips.constraints || ''} onChange={e => update('constraints', e.target.value)} placeholder="e.g. No tobacco, alcohol or gambling stocks. Direct plans only. AUM > ₹500 Cr." />
              </div>
              <div className="ips-f"><label>Existing holdings to consider</label>
                <textarea value={ips.existingHoldings || ''} onChange={e => update('existingHoldings', e.target.value)} placeholder="e.g. HDFC ELSS ₹25,000/month SIP (₹4.2L corpus). Avoid overlap." />
              </div>
            </div>
          </div>

          {/* Section F — Deployment & Adviser Notes */}
          <div style={{ marginBottom: 20 }}>
            <div className="ips-s-hd"><span className="ips-s-num">F</span>Deployment &amp; adviser notes</div>
            <div className="ips-g3">
              <div className="ips-f"><label>Deployment instructions</label>
                <textarea value={ips.deploymentNotes || ''} onChange={e => update('deploymentNotes', e.target.value)} placeholder="e.g. Deploy in 3 tranches via STP over 90 days from liquid fund." />
              </div>
              <div className="ips-f"><label>Rebalancing policy</label>
                <select value={ips.rebalancing || 'Annual rebalancing'} onChange={e => update('rebalancing', e.target.value)}>
                  <option>Annual rebalancing</option><option>Semi-annual</option><option>Quarterly</option>
                  <option>Threshold-based (±5%)</option><option>Threshold-based (±10%)</option><option>No automatic rebalancing</option>
                </select>
              </div>
              <div className="ips-f"><label>Adviser notes</label>
                <textarea value={ips.adviserNotes || ''} onChange={e => update('adviserNotes', e.target.value)} placeholder="e.g. Client is DINK household, high risk capacity. ESG preference for thematic allocation." />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="ips-footer">
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>All fields optional — save what you have</span>
        <button className="btn" onClick={onSkip} style={{ color: 'var(--text-muted)' }}>Skip</button>
        <button className="btn btn-primary" onClick={onSave}>Save IPS &amp; continue →</button>
      </div>
    </div>
  );
}