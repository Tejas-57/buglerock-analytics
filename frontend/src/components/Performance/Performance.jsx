import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReturnMetrics from './ReturnMetrics';
import RiskMetrics from './RiskMetrics';
import NAVLineChart from './NAVLineChart';
import './Performance.css';

export default function Performance({ selectedDate, selectedFund }) {
  const [perfData, setPerfData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedFund) return;
    setLoading(true);
    setError(null);
    const dateStr = selectedDate.toISOString().split('T')[0];
    fetch(`/api/performance/metrics?isin=${selectedFund.isin}&date=${dateStr}&category=${encodeURIComponent(selectedFund.category)}&asset_class=${encodeURIComponent(selectedFund.assetClass)}`)
      .then(r => r.json())
      .then(d => { setPerfData(d); setLoading(false); })
      .catch(() => { setError('Failed to load performance data.'); setLoading(false); });
  }, [selectedFund, selectedDate]);

  if (!selectedFund) {
    return (
      <div className="performance-page fade-in">
        <div className="page-header">
          <h1 className="section-title">Performance Analysis</h1>
          <p className="page-desc">Returns, risk metrics and historical NAV chart vs benchmark.</p>
        </div>
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
            </svg>
          </div>
          <p>No fund selected. Please select a fund from the Home tab.</p>
          <button className="btn-primary" style={{ marginTop: '16px' }} onClick={() => navigate('/home')}>
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="performance-page fade-in">
      <div className="page-header">
        <h1 className="section-title">Performance Analysis</h1>
        <p className="page-desc">
          Showing: <span style={{ color: 'var(--gold)' }}>{selectedFund.name}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{selectedFund.category}</span>
        </p>
      </div>

      {loading && (
        <div className="loading-blocks">
          {[200, 120, 340, 200].map((h, i) => (
            <div key={i} className="loading-shimmer" style={{ height: `${h}px`, borderRadius: '8px' }} />
          ))}
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}

      {perfData && !loading && (
        <div className="performance-content">
          <NAVLineChart fund={selectedFund} selectedDate={selectedDate} />
          <ReturnMetrics data={perfData} assetClass={selectedFund?.assetClass} />
          <RiskMetrics data={perfData} />
        </div>
      )}
    </div>
  );
}