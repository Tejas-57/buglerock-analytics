import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Layout/Navbar';
import Header from './components/Layout/Header';
import FundExplorer from './components/FundExplorer/FundExplorer';
import FundDetail from './components/FundDetail/FundDetail';
import Watchlist from './components/Watchlist/Watchlist';
import Performance from './components/Performance/Performance';
import CompareFunds from './components/PeerComparison/CompareFunds';
import Simulator from './components/Simulator/Simulator';
import RollingAnalytics from './components/RollingAnalytics/RollingAnalytics';
import ChatButton from './components/Chat/ChatButton';
import PortfolioBuilder from './components/PortfolioBuilder/PortfolioBuilder';
import './styles/global.css';
import './App.css';

function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function loadFromStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? JSON.parse(val) : fallback;
  } catch { return fallback; }
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedFund, setSelectedFund] = useState(() => loadFromStorage('br_selected_fund', null));

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/status`)
      .then(r => r.json())
      .then(s => {
        if (s.data_as_of) {
          const latest = new Date(s.data_as_of + 'T12:00:00');
          setSelectedDate(latest);
          saveToStorage('br_selected_date', latest.toISOString());
        }
      })
      .catch(() => setSelectedDate(new Date()));
  }, []);

  const handleFundSelect = (fund) => {
    setSelectedFund(fund);
    saveToStorage('br_selected_fund', fund);
  };

  if (!selectedDate) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)', fontSize:13 }}>
        Loading...
      </div>
    );
  }

  return (
    <Router>
      <div className="app-shell">
        <Navbar />
        <div className="app-body">
          <Header selectedDate={selectedDate} />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/fund-explorer" replace />} />
              <Route path="/fund-explorer" element={
                <FundExplorer selectedDate={selectedDate} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/home" element={
                <FundDetail selectedDate={selectedDate} selectedFund={selectedFund} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/watchlist" element={
                <Watchlist selectedDate={selectedDate} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/performance" element={
                <Performance selectedDate={selectedDate} selectedFund={selectedFund} />
              } />
              <Route path="/peer-comparison" element={
                <CompareFunds selectedDate={selectedDate} />
              } />
              <Route path="/simulator" element={
                <Simulator selectedFund={selectedFund} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/rolling-analytics" element={
                <RollingAnalytics selectedFund={selectedFund} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/portfolio" element={
                <PortfolioBuilder selectedDate={selectedDate} />
              } />
            </Routes>
          </main>
        </div>
        <ChatButton selectedFund={selectedFund} selectedDate={selectedDate} />
      </div>
    </Router>
  );
}