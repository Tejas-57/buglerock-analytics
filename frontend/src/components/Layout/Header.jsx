import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './Header.css';

export default function Header({ selectedDate, onDateChange }) {
  const isToday = new Date().toDateString() === selectedDate.toDateString();

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
            As of Date
          </div>
          <DatePicker
            selected={selectedDate}
            onChange={onDateChange}
            dateFormat="dd MMM yyyy"
            maxDate={new Date()}
            className="date-input"
            popperPlacement="bottom-end"
          />
          {!isToday && (
            <button className="date-reset" onClick={() => onDateChange(new Date())} title="Reset to today">
              Today
            </button>
          )}
        </div>
      </div>
    </header>
  );
}