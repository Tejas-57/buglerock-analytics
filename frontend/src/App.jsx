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
import ModelPortfolios from './components/ModelPortfolios/ModelPortfolios';
import PeerGroupAnalytics from './components/PeerGroupAnalytics/PeerGroupAnalytics';
import ChatButton from './components/Chat/ChatButton';
import PortfolioBuilder from './components/PortfolioBuilder/PortfolioBuilder';
import StockExposure from './components/StockExposure/StockExposure';
import RetirementPlanner from './components/RetirementPlanner/RetirementPlanner';
import Login from './components/Login/Login';
import SetupPassword from './components/Login/SetupPassword';
import AdminPanel from './components/Admin/AdminPanel';
import { useAuth } from './hooks/useAuth';
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
  const { user, loading: authLoading, login, logout } = useAuth();
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedFund, setSelectedFund] = useState(() => loadFromStorage('br_selected_fund', null));

  useEffect(() => {
    if (!user) return;
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/status`, { credentials: 'include' })
      .then(r => r.json())
      .then(s => {
        if (s.data_as_of) {
          const latest = new Date(s.data_as_of + 'T12:00:00');
          setSelectedDate(latest);
          saveToStorage('br_selected_date', latest.toISOString());
        }
      })
      .catch(() => setSelectedDate(new Date()));
  }, [user]);

  const handleFundSelect = (fund) => {
    setSelectedFund(fund);
    saveToStorage('br_selected_fund', fund);
  };

  // Auth loading
  if (authLoading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#912F63', fontSize:14, fontWeight:600 }}>
        Loading FundIQ…
      </div>
    );
  }

  return (
    <Router>
      <Routes>

        {/* ── Public routes — always accessible ── */}
        <Route
          path="/setup-password"
          element={<SetupPassword onLogin={(data) => { login(data); window.location.href = '/fund-explorer'; }} />}
        />
        <Route
          path="/login"
          element={user ? <Navigate to="/fund-explorer" replace /> : <Login onLogin={login} />}
        />

        {/* ── Protected routes — redirect to login if not authenticated ── */}
        <Route
          path="/*"
          element={
            !user ? (
              <Navigate to="/login" replace />
            ) : !selectedDate ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)', fontSize:13 }}>
                Loading...
              </div>
            ) : (
              <div className="app-shell">
                <Navbar user={user} onLogout={logout} />
                <div className="app-body">
                  <Header selectedDate={selectedDate} user={user} onLogout={logout} />
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
                      <Route path="/stock-exposure" element={<StockExposure />} />
                      <Route path="/performance" element={
                        <Performance selectedDate={selectedDate} selectedFund={selectedFund} />
                      } />
                      <Route path="/peer-comparison" element={
                        <CompareFunds selectedDate={selectedDate} />
                      } />
                      <Route path="/simulator" element={
                        <Simulator selectedDate={selectedDate} />
                      } />
                      <Route path="/rolling-analytics" element={
                        <RollingAnalytics selectedDate={selectedDate} />
                      } />
                      <Route path="/models" element={
                        <ModelPortfolios selectedDate={selectedDate} />
                      } />
                      <Route path="/peer-group-analytics" element={
                        <PeerGroupAnalytics selectedDate={selectedDate} setSelectedFund={handleFundSelect} />
                      } />
                      <Route path="/portfolio" element={
                        <PortfolioBuilder selectedDate={selectedDate} />
                      } />
                      <Route path="/retirement-planner" element={<RetirementPlanner />} />
                      <Route path="/admin" element={
                        user.role === 'admin'
                          ? <AdminPanel />
                          : <Navigate to="/fund-explorer" replace />
                      } />
                    </Routes>
                  </main>
                </div>
                <ChatButton selectedFund={selectedFund} selectedDate={selectedDate} />
              </div>
            )
          }
        />
      </Routes>
    </Router>
  );
}