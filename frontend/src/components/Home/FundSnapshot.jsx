import React from 'react';
import './FundSnapshot.css';

function StarRating({ rating }) {
  return (
    <div className="star-rating">
      {[1,2,3,4,5].map(i => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24"
          fill={i <= rating ? 'var(--gold-primary)' : 'none'}
          stroke={i <= rating ? 'var(--gold-primary)' : 'var(--border-light)'}
          strokeWidth="1.5">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value ${highlight ? 'value-gold' : ''}`}>{value || '—'}</span>
    </div>
  );
}

export default function FundSnapshot({ data }) {
  if (!data) return null;
  const d = data;

  return (
    <div className="snapshot-wrapper">
      {/* Fund identity header */}
      <div className="fund-header-card card">
        <div className="fund-title-row">
          <div>
            <div className="fund-name">{d.name}</div>
            <div className="fund-meta">
              <span className="fund-category">{d.category}</span>
              <span className="fund-isin">{d.isin}</span>
              {d.ranking && <span className={`badge-${d.ranking.toLowerCase()}`}>{d.ranking}</span>}
            </div>
          </div>
          <div className="fund-nav-block">
            <div className="nav-label-sm">NAV</div>
            <div className="nav-value" style={{fontFamily:'"Times New Roman", Times, serif', letterSpacing:'0.04em', fontWeight:'700'}}>₹{d.nav && d.nav !== "-" ? parseFloat(d.nav).toFixed(2) : "—"}</div>
            <div className="nav-date">{d.nav_date || ''}</div>
          </div>
        </div>
        {d.morningstar_rating && (
          <div className="rating-row">
            <span className="rating-label">Morningstar</span>
            <StarRating rating={d.morningstar_rating} />
          </div>
        )}
      </div>

      {/* Key metrics grid */}
      <div className="snapshot-grid">
        <div className="metric-tile">
          <div className="label">Fund Size</div>
          <div className="value" style={{fontSize:'13px', fontFamily:'var(--font-mono)'}}>{d.fund_size ? `₹${Number(d.fund_size).toLocaleString('en-IN', {maximumFractionDigits:0})} Cr` : '—'}</div>
        </div>
        <div className="metric-tile">
          <div className="label">Expense Ratio</div>
          <div className="value" style={{fontSize:'13px', fontFamily:'var(--font-mono)'}}>{d.expense_ratio != null ? `${d.expense_ratio}%` : '—'}</div>
        </div>
        <div className="metric-tile">
          <div className="label">Inception Date</div>
          <div className="value" style={{fontSize:'13px', fontFamily:'var(--font-mono)'}}>{d.inception_date && d.inception_date !== '-' ? (() => { const dt = new Date(d.inception_date + 'T00:00:00'); const day = dt.getDate(); const s=day%100; const ord = day + (s>=11&&s<=13?'th':['th','st','nd','rd'][day%10]||'th'); const mon = dt.toLocaleString('en-IN',{month:'short'}); const yr = dt.getFullYear(); return `${ord} ${mon} ${yr}`; })() : '—'}</div>
        </div>
        <div className="metric-tile">
          <div className="label">52W High NAV</div>
          <div className="value" style={{fontSize:'13px', fontFamily:'var(--font-mono)'}}>{d.nav_52w_high && d.nav_52w_high !== '-' ? `₹${parseFloat(d.nav_52w_high).toFixed(2)}` : '—'}</div>
        </div>
        <div className="metric-tile">
          <div className="label">Price to Earnings (P/E)</div>
          <div className="value" style={{fontSize:'13px', fontFamily:'var(--font-mono)'}}>{d.pe_ratio !== '-' ? parseFloat(d.pe_ratio).toFixed(2) : '—'}</div>
        </div>
        <div className="metric-tile">
          <div className="label">Price to Book (P/B)</div>
          <div className="value" style={{fontSize:'13px', fontFamily:'var(--font-mono)'}}>{d.pb_ratio !== '-' ? parseFloat(d.pb_ratio).toFixed(2) : '—'}</div>
        </div>
      </div>

      {/* Manager & Exit Load */}
      <div className="detail-cards">
        <div className="card detail-card">
          <div className="section-subtitle">Fund Manager</div>
          <div className="manager-names">
            {d.manager_name
              ? d.manager_name.split(';').filter(Boolean).map((m, i) => (
                  <div key={i} className="manager-chip">{m.trim()}</div>
                ))
              : <span className="value-na">—</span>
            }
          </div>
        </div>
        <div className="card detail-card">
          <div className="section-subtitle">Exit Load</div>
          <div className="exit-load-text">{d.exit_load || '—'}</div>
        </div>
      </div>
    </div>
  );
}