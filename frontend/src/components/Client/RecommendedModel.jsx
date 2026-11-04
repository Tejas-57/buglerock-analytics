import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useReferenceModel } from './useReferenceModel';

const MIX_COLORS = {
  Equity:          '#912F63',
  Debt:            '#3E3452',
  Gold:            '#C46985',
  'Cash & Others': '#A795AE',
};

const pct = (v, d = 1) => (v == null ? '—' : `${Number(v).toFixed(d)}%`);
const num = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

export default function RecommendedModel({ riskProfile, maxFunds }) {
  const navigate = useNavigate();
  const { loading, model, error, retry } = useReferenceModel(riskProfile);

  function openInModels() {
    try { localStorage.setItem('mp_sel', riskProfile); } catch {}
    navigate('/models');
  }

  return (
    <div className="client-section">
      <div className="rm-head">
        <div className="client-section-title" style={{ marginBottom: 0 }}>Reference model portfolio</div>
        {model && <button className="btn-outline rm-open" onClick={openInModels}>Open in Model Portfolios →</button>}
      </div>

      {loading && <div className="rm-note">Building the {riskProfile.replace('_', ' ')} model from the latest data…</div>}

      {error && (
        <div className="rm-note">
          Model data is unavailable ({error}).{' '}
          <button className="rm-link" onClick={retry}>Retry</button>
        </div>
      )}

      {model && (
        <>
          <div className="rm-sub">
            <strong>{model.label}</strong> · {model.fund_count} funds · data as of {model.data_date}
          </div>

          {maxFunds && model.fund_count > Number(maxFunds) && (
            <div className="rm-warn">
              This model holds {model.fund_count} funds, more than the client's limit of {maxFunds}.
            </div>
          )}

          <div className="rm-mix-bar">
            {Object.entries(model.asset_mix || {}).filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k} style={{ width: `${v}%`, background: MIX_COLORS[k] || '#A2A0A0' }} title={`${k} ${v}%`} />
            ))}
          </div>
          <div className="rm-legend">
            {Object.entries(model.asset_mix || {}).filter(([, v]) => v > 0).map(([k, v]) => (
              <span key={k}><i style={{ background: MIX_COLORS[k] || '#A2A0A0' }} />{k} {pct(v)}</span>
            ))}
          </div>

          <div className="rm-metrics">
            {[
              ['1Y return', pct(model.blended?.return_1y)],
              ['3Y CAGR', pct(model.blended?.return_3y)],
              ['5Y CAGR', pct(model.blended?.return_5y)],
              ['Std dev (3Y)', pct(model.blended?.std_dev_3y)],
              ['Sharpe (3Y)', num(model.blended?.sharpe_3y)],
              ['Down-capture (3Y)', num(model.blended?.down_capture_3y, 1)],
            ].map(([label, val]) => (
              <div key={label} className="rm-metric">
                <div className="rm-metric-label">{label}</div>
                <div className="rm-metric-val">{val}</div>
              </div>
            ))}
          </div>

          <table className="rm-table">
            <thead>
              <tr><th>Fund</th><th>Sleeve</th><th className="r">Weight</th></tr>
            </thead>
            <tbody>
              {(model.funds || []).map(f => (
                <tr key={f.isin}>
                  <td>{f.name}</td>
                  <td>{f.sleeve}</td>
                  <td className="r">{pct(f.weight, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rm-note">
            This is the live model for the client's risk profile, rebuilt daily. It is not yet saved against the client,
            so it can change from day to day. Past returns are not a forecast.
          </div>
        </>
      )}
    </div>
  );
}
