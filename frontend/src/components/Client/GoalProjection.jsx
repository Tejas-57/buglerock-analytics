import React from 'react';
import { useReferenceModel } from './useReferenceModel';
import { fmtINR, projectValue, HORIZON_META } from './clientUtils';

// Illustrative projection of the client's lump sum and SIP over their horizon. The two scenarios
// are the reference model's own blended past 3Y and 5Y CAGR, so no return assumption is invented here.
export default function GoalProjection({ client }) {
  const { model } = useReferenceModel(client.risk_profile);

  const lump = Number(client.investment_amount) || 0;
  const sip = Number(client.sip) || 0;
  if (!lump && !sip) return null;

  const horizon = HORIZON_META[client.horizon];
  const years = horizon?.years;

  const scenarios = model ? [
    { label: 'If it repeats its 3Y CAGR', rate: model.blended?.return_3y },
    { label: 'If it repeats its 5Y CAGR', rate: model.blended?.return_5y },
  ].filter(s => s.rate != null) : [];

  return (
    <div className="client-section">
      <div className="client-section-title">Goal projection</div>

      {!years && (
        <div className="rm-note" style={{ marginTop: 0 }}>
          Set an investment horizon in the client profile to see a projection.
        </div>
      )}

      {years && !model && (
        <div className="rm-note" style={{ marginTop: 0 }}>Waiting for the reference model's returns…</div>
      )}

      {years && model && scenarios.length === 0 && (
        <div className="rm-note" style={{ marginTop: 0 }}>The reference model has no 3Y or 5Y return history to project from.</div>
      )}

      {years && scenarios.length > 0 && (
        <>
          <div className="rm-sub">
            {lump ? `${fmtINR(lump)} lump sum` : ''}{lump && sip ? ' + ' : ''}{sip ? `${fmtINR(sip)}/month SIP` : ''}
            {' '}over {years} years ({horizon.label})
          </div>
          <table className="rm-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="r">CAGR</th>
                <th className="r">Invested</th>
                <th className="r">Projected value</th>
                <th className="r">Gain</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(s => {
                const { invested, value } = projectValue(lump, sip, years, s.rate);
                return (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="r">{Number(s.rate).toFixed(1)}%</td>
                    <td className="r">{fmtINR(invested)}</td>
                    <td className="r">{fmtINR(value)}</td>
                    <td className="r">{value < invested ? '−' : '+'}{fmtINR(Math.abs(value - invested))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rm-note">
            Illustration only, not a forecast. It assumes the model keeps earning the same blended past CAGR every year,
            SIP instalments at month end, and ignores tax, exit loads, rebalancing and any step-up. The horizon uses the
            top of the chosen band (7+ years is shown as 10).
          </div>
        </>
      )}
    </div>
  );
}
