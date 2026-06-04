import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './PeerComparison.css';

const RETURN_COLS = ['1m','3m','6m','1y','3y','5y','ytd'];

function fmt(v, suffix = '') {
  if (v === null || v === undefined || v === '-') return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return `${n.toFixed(2)}${suffix}`;
}

function ReturnTd({ value }) {
  if (value === null || value === undefined || value === '-') return <td className="value-na">—</td>;
  const n = parseFloat(value);
  return <td className={n > 0 ? 'value-positive' : n < 0 ? 'value-negative' : ''}>{n > 0 ? '+' : ''}{n.toFixed(2)}%</td>;
}

export default function PeerComparison({ selectedDate, selectedFund }) {
  const [peerData, setPeerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('returns');
  const [riskTf, setRiskTf] = useState('3y');
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedFund) return;
    setLoading(true);
    setError(null);
    const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/peer/comparison?isin=${selectedFund.isin}&category=${encodeURIComponent(selectedFund.category)}&asset_class=${encodeURIComponent(selectedFund.assetClass)}&date=${dateStr}`)
      .then(r => r.json())
      .then(d => { setPeerData(d); setLoading(false); })
      .catch(() => { setError('Failed to load peer data.'); setLoading(false); });
  }, [selectedFund, selectedDate]);

  if (!selectedFund) {
    return (
      <div className="peer-page fade-in">
        <div className="page-header">
          <h1 className="section-title">Peer Comparison</h1>
          <p className="page-desc">Compare R1 & R2 ranked funds within the same category.</p>
        </div>
        <div className="empty-state">
          <p>No fund selected. Please select a fund from the Home tab.</p>
          <button className="btn-primary" style={{ marginTop: '16px' }} onClick={() => navigate('/home')}>Go to Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="peer-page fade-in">
      <div className="page-header">
        <h1 className="section-title">Peer Comparison</h1>
        <p className="page-desc">
          Showing: <span style={{ color: 'var(--brand-primary)' }}>{selectedFund.name}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{selectedFund.category}</span>
        </p>
      </div>

      {loading && <div className="loading-shimmer" style={{ height: '400px', borderRadius: '8px' }} />}
      {error && <div className="error-msg">{error}</div>}

      {peerData && !loading && (
        <div className="peer-content">
          <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="section-subtitle" style={{ margin: 0 }}>Category</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{selectedFund.category}</div>
              </div>
              <div style={{ background: 'rgba(145,47,99,0.08)', border: '1px solid rgba(145,47,99,0.2)', borderRadius: 20, padding: '4px 14px', fontSize: 12, color: 'var(--brand-primary)', fontWeight: 600 }}>
                {peerData.peers?.length || 0} peers
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div className="tab-row" style={{ border: 'none', marginBottom: 0 }}>
                <button className={`tab-btn ${activeTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveTab('returns')}>Returns</button>
                <button className={`tab-btn ${activeTab === 'risk' ? 'active' : ''}`} onClick={() => setActiveTab('risk')}>Risk Metrics</button>
              </div>
              {activeTab === 'risk' && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {['3y', '5y'].map(t => (
                    <button key={t} onClick={() => setRiskTf(t)} style={{
                      padding: '3px 10px', borderRadius: 4, border: '1px solid',
                      borderColor: riskTf === t ? 'var(--brand-primary)' : 'var(--border)',
                      background: riskTf === t ? 'var(--brand-primary)' : 'transparent',
                      color: riskTf === t ? '#fff' : 'var(--text-muted)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>{t.toUpperCase()}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="table-scroll" style={{ padding: '0 0 8px' }}>
              {activeTab === 'returns' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fund</th><th>Rank</th><th>1M</th><th>3M</th><th>6M</th><th>1Y</th><th>3Y</th><th>5Y</th><th>YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peerData.peers?.map((peer) => (
                      <tr key={peer.isin} className={peer.isin === selectedFund?.isin ? 'highlight-row' : ''}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {peer.isin === selectedFund?.isin && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', flexShrink: 0 }} />}
                            {peer.name}
                          </div>
                        </td>
                        <td><span className={`badge-${peer.ranking?.toLowerCase()}`}>{peer.ranking || '—'}</span></td>
                        {RETURN_COLS.map(k => <ReturnTd key={k} value={peer.returns?.[k]} />)}
                      </tr>
                    ))}
                    {peerData.peer_avg && (
                      <tr className="avg-row">
                        <td style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Category Average</td>
                        <td>—</td>
                        {RETURN_COLS.map(k => <ReturnTd key={k} value={peerData.peer_avg.returns?.[k]} />)}
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === 'risk' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fund</th><th>Rank</th><th>Std Dev</th><th>Alpha</th><th>Beta</th><th>Sharpe</th><th>Sortino</th><th>Info Ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peerData.peers?.map((peer) => (
                      <tr key={peer.isin} className={peer.isin === selectedFund?.isin ? 'highlight-row' : ''}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {peer.isin === selectedFund?.isin && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', flexShrink: 0 }} />}
                            {peer.name}
                          </div>
                        </td>
                        <td><span className={`badge-${peer.ranking?.toLowerCase()}`}>{peer.ranking || '—'}</span></td>
                        <td>{fmt(peer.risk?.[`std_dev_${riskTf}`], '%')}</td>
                        <td>{fmt(peer.risk?.[`alpha_${riskTf}`])}</td>
                        <td>{fmt(peer.risk?.[`beta_${riskTf}`])}</td>
                        <td>{fmt(peer.risk?.[`sharpe_ratio_${riskTf}`])}</td>
                        <td>{fmt(peer.risk?.[`sortino_ratio_${riskTf}`])}</td>
                        <td>{fmt(peer.risk?.[`information_ratio_${riskTf}`])}</td>
                      </tr>
                    ))}
                    {peerData.peer_avg && (
                      <tr className="avg-row">
                        <td style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Category Average</td>
                        <td>—</td>
                        <td>{fmt(peerData.peer_avg.risk?.[`std_dev_${riskTf}`], '%')}</td>
                        <td>{fmt(peerData.peer_avg.risk?.[`alpha_${riskTf}`])}</td>
                        <td>{fmt(peerData.peer_avg.risk?.[`beta_${riskTf}`])}</td>
                        <td>{fmt(peerData.peer_avg.risk?.[`sharpe_ratio_${riskTf}`])}</td>
                        <td>{fmt(peerData.peer_avg.risk?.[`sortino_ratio_${riskTf}`])}</td>
                        <td>{fmt(peerData.peer_avg.risk?.[`information_ratio_${riskTf}`])}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}