import React from 'react';
import './Header.css';

export default function Header({ selectedDate, user, onLogout }) {
  const dateStr = selectedDate instanceof Date
    ? selectedDate.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    : selectedDate;

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="header-title">Analytics Platform</div>
      </div>
      <div className="header-right">
        <div className="date-selector">
          <div className="date-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            AS OF DATE
          </div>
          <span className="date-input" style={{ cursor:'default', userSelect:'none' }}>{dateStr}</span>
        </div>

        {user && (
          <div className="header-user">
            <span className="header-username">{user.name.split(' ')[0]}</span>
            <button className="header-logout" onClick={onLogout} title="Sign out">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/* Add these to your existing Header.css */