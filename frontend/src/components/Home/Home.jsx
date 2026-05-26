import React, { useState, useEffect } from 'react';
import FundSelector from './FundSelector';
import FundSnapshot from './FundSnapshot';
import PieCharts from './PieCharts';
import './Home.css';

export default function Home({ selectedDate, selectedFund, setSelectedFund }) {
  const [snapshotData, setSnapshotData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedFund) return;
    setLoading(true);
    setError(null);
    const dateStr = selectedDate.toISOString().split('T')[0];
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/home/snapshot?isin=${selectedFund.isin}&date=${dateStr}`)
      .then(r => r.json())
      .then(d => { setSnapshotData(d); setLoading(false); })
      .catch(e => { setError('Failed to load fund data.'); setLoading(false); });
  }, [selectedFund, selectedDate]);

  return (
    <div className="home-page fade-in">
      <div className="page-header">
        <h1 className="section-title">Fund Overview</h1>
        <p className="page-desc">Select a fund to view its snapshot and key details.</p>
      </div>

      <div className="card card-gold selector-card">
        <div className="section-subtitle">Fund Selection</div>
        <FundSelector onFundSelect={setSelectedFund} selectedFund={selectedFund} selectedDate={selectedDate} />
      </div>

      {!selectedFund && (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <p>Select an asset class, category and fund to view its snapshot</p>
        </div>
      )}

      {loading && (
        <div className="snapshot-grid">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="loading-shimmer" style={{height: '80px', borderRadius: '8px'}} />
          ))}
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}

      {snapshotData && !loading && (
        <div className="home-content">
          <FundSnapshot data={snapshotData} />
          <PieCharts data={snapshotData} />
        </div>
      )}
    </div>
  );
}