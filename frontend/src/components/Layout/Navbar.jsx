import React from 'react';
import { NavLink } from 'react-router-dom';
import './Navbar.css';

const NAV_SECTIONS = [
  {
    section: 'DISCOVER',
    items: [
      { path: '/fund-explorer',  label: 'Fund Explorer',        icon: ExploreIcon },
      { path: '/watchlist',      label: 'Watchlist',            icon: WatchlistIcon },
      { path: '/stock-exposure', label: 'Stock Exposure',       icon: StockExposureIcon },
    ],
  },
  {
    section: 'ANALYSE',
    items: [
      { path: '/home',                 label: 'Fund Detail',        icon: HomeIcon },
      { path: '/peer-comparison',      label: 'Compare Funds',      icon: PeerIcon },
      { path: '/peer-group-analytics', label: 'Peer Group Analytics', icon: PeerGroupIcon },
    ],
  },
  {
    section: 'BUILD',
    items: [
      { path: '/portfolio',          label: 'Portfolio Builder',   icon: PortfolioIcon },
      { path: '/models',             label: 'Model Portfolios',    icon: ModelsIcon },
      { path: '/retirement-planner', label: 'Retirement Planner',  icon: RetirementIcon },
      { path: '/simulator',          label: 'Simulator',           icon: SimulatorIcon },
      { path: '/rolling-analytics',  label: 'Rolling Analytics',   icon: RollingIcon },
    ],
  },
];

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-logo">
        <div className="logo-text">
          <div className="logo-brand">
            <span className="logo-bu">Bügle</span><span className="logo-glerock">Rock</span>
          </div>
          <span className="logo-secondary">Analytics</span>
        </div>
      </div>

      <div className="navbar-divider" />

      <ul className="nav-list">
        {NAV_SECTIONS.map(({ section, items }) => (
          <React.Fragment key={section}>
            <li className="nav-section-label">{section}</li>
            {items.map(({ path, label, icon: Icon }) => (
              <li key={path}>
                <NavLink to={path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon"><Icon /></span>
                  <span className="nav-label">{label}</span>
                  <span className="nav-active-bar" />
                </NavLink>
              </li>
            ))}
          </React.Fragment>
        ))}
      </ul>

      <div className="navbar-footer">
        <div className="nav-version">v2.0.0</div>
        <div className="nav-powered">Powered by Morningstar</div>
      </div>
    </nav>
  );
}

function WatchlistIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  );
}
function ExploreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
}
function PeerGroupIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );
}
function PeerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}
function ModelsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}
function PortfolioIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  );
}
function SimulatorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  );
}
function RollingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/>
    </svg>
  );
}
function StockExposureIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  );
}
function RetirementIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0z"/><path d="M12 7v5l3 2"/>
    </svg>
  );
}