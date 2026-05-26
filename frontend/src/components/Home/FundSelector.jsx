import React, { useState, useEffect } from 'react';
import './FundSelector.css';

export default function FundSelector({ onFundSelect, selectedFund, selectedDate }) {
  const [assetClasses, setAssetClasses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [funds, setFunds] = useState([]);

  const [selectedAsset, setSelectedAsset] = useState(selectedFund?.assetClass || '');
  const [selectedCategory, setSelectedCategory] = useState(selectedFund?.category || '');
  const [selectedFundLocal, setSelectedFundLocal] = useState(selectedFund?.isin || '');

  const dateStr = selectedDate
    ? (selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate)
    : new Date().toISOString().split('T')[0];

  // Fetch asset classes when date changes — but don't reset fund selection
  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/asset-classes?date=${dateStr}`)
      .then(r => r.json())
      .then(d => setAssetClasses(d.asset_classes || []))
      .catch(() => {});
  }, [dateStr]);

  // Fetch categories when asset changes or date changes
  useEffect(() => {
    if (!selectedAsset) { setCategories([]); return; }
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/categories?asset_class=${encodeURIComponent(selectedAsset)}&date=${dateStr}`)
      .then(r => r.json())
      .then(d => setCategories(d.categories || []))
      .catch(() => {});
  }, [selectedAsset, dateStr]);

  // Fetch funds when category changes or date changes
  useEffect(() => {
    if (!selectedAsset || !selectedCategory) { setFunds([]); return; }
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/list?asset_class=${encodeURIComponent(selectedAsset)}&category=${encodeURIComponent(selectedCategory)}&date=${dateStr}`)
      .then(r => r.json())
      .then(d => setFunds(d.funds || []))
      .catch(() => {});
  }, [selectedCategory, selectedAsset, dateStr]);

  // When date changes and we already have a fund selected, auto-reload snapshot
  useEffect(() => {
    if (!selectedFundLocal || !funds.length) return;
    const fund = funds.find(f => f.isin === selectedFundLocal);
    if (fund && onFundSelect) {
      onFundSelect({ ...fund, assetClass: selectedAsset, category: selectedCategory });
    }
  }, [dateStr, funds]);

  const handleGo = () => {
    if (!selectedFundLocal) return;
    const fund = funds.find(f => f.isin === selectedFundLocal);
    if (fund && onFundSelect) {
      onFundSelect({ ...fund, assetClass: selectedAsset, category: selectedCategory });
    }
  };

  const handleAssetChange = (val) => {
    setSelectedAsset(val);
    setSelectedCategory('');
    setSelectedFundLocal('');
    setFunds([]);
  };

  const handleCategoryChange = (val) => {
    setSelectedCategory(val);
    setSelectedFundLocal('');
  };

  return (
    <div className="fund-selector">
      <div className="selector-group">
        <label className="selector-label">Asset Class</label>
        <select
          className="selector-select"
          value={selectedAsset}
          onChange={e => handleAssetChange(e.target.value)}
        >
          <option value="">Select Asset Class</option>
          {assetClasses.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="selector-arrow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9,18 15,12 9,6"/>
        </svg>
      </div>

      <div className="selector-group">
        <label className="selector-label">Category</label>
        <select
          className="selector-select"
          value={selectedCategory}
          onChange={e => handleCategoryChange(e.target.value)}
          disabled={!selectedAsset}
        >
          <option value="">Select Category</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="selector-arrow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9,18 15,12 9,6"/>
        </svg>
      </div>

      <div className="selector-group">
        <label className="selector-label">Fund</label>
        <select
          className="selector-select"
          value={selectedFundLocal}
          onChange={e => setSelectedFundLocal(e.target.value)}
          disabled={!selectedCategory}
        >
          <option value="">Select Fund</option>
          {funds.map(f => (
            <option key={f.isin} value={f.isin}>
              {f.name} {f.ranking ? `(${f.ranking})` : ''}
            </option>
          ))}
        </select>
      </div>

      <button
        className="btn-primary selector-go"
        onClick={handleGo}
        disabled={!selectedFundLocal}
      >
        GO
      </button>
    </div>
  );
}