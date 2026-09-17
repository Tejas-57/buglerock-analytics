import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global fetch override — always send cookies with every API request
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  return originalFetch(url, {
    ...options,
    credentials: options.credentials || 'include',
  });
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);