import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Layout/Navbar';
import Header from './components/Layout/Header';
import FundExplorer from './components/FundExplorer/FundExplorer';
import Home from './components/Home/Home';
import Performance from './components/Performance/Performance';
import PeerComparison from './components/PeerComparison/PeerComparison';
import Simulator from './components/Simulator/Simulator';
import RollingAnalytics from './components/RollingAnalytics/RollingAnalytics';
import ChatButton from './components/Chat/ChatButton';
import './styles/global.css';
import './App.css';

function loadFromStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? JSON.parse(val) : fallback;
  } catch { return fallback; }
}

function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function toDateStr(date) {
  return date instanceof Date ? date.toISOString().split('T')[0] : date;
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = loadFromStorage('br_selected_date', null);
    return saved ? new Date(saved) : new Date();
  });

  const [selectedFund, setSelectedFund] = useState(() => {
    return loadFromStorage('br_selected_fund', null);
  });

  useEffect(() => { resolveDate(selectedDate); }, []);

  const resolveDate = (date) => {
    const dateStr = toDateStr(date);
    fetch(`/api/funds/asset-classes?date=${dateStr}`)
      .then(r => r.json())
      .then(d => {
        if (d.asset_classes && d.asset_classes.length > 0) {
          setSelectedDate(date);
          saveToStorage('br_selected_date', date instanceof Date ? date.toISOString() : new Date(date).toISOString());
        } else {
          fetch('/api/status').then(r => r.json()).then(s => {
            if (s.data_as_of) {
              const fallback = new Date(s.data_as_of + 'T12:00:00');
              setSelectedDate(fallback);
              saveToStorage('br_selected_date', fallback.toISOString());
            }
          }).catch(() => {});
        }
      }).catch(() => {});
  };

  const handleDateChange = (date) => { setSelectedDate(date); resolveDate(date); };
  const handleFundSelect = (fund) => { setSelectedFund(fund); saveToStorage('br_selected_fund', fund); };

  return (
    <Router>
      <div className="app-shell">
        <Navbar />
        <div className="app-body">
          <Header selectedDate={selectedDate} onDateChange={handleDateChange} />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/fund-explorer" replace />} />
              <Route path="/fund-explorer" element={
                <FundExplorer selectedDate={selectedDate} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/home" element={
                <Home selectedDate={selectedDate} selectedFund={selectedFund} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/performance" element={
                <Performance selectedDate={selectedDate} selectedFund={selectedFund} />
              } />
              <Route path="/peer-comparison" element={
                <PeerComparison selectedDate={selectedDate} selectedFund={selectedFund} />
              } />
              <Route path="/simulator" element={
                <Simulator selectedFund={selectedFund} setSelectedFund={handleFundSelect} />
              } />
              <Route path="/rolling-analytics" element={
                <RollingAnalytics selectedFund={selectedFund} setSelectedFund={handleFundSelect} />
              } />
            </Routes>
          </main>
        </div>
        <ChatButton selectedFund={selectedFund} selectedDate={selectedDate} />
      </div>
    </Router>
  );
}