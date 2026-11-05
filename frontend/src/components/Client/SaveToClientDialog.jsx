import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClient } from '../../context/ClientContext';
import { listPortfolios, savePortfolio, SOURCE_LABEL } from './clientPortfolios';
import { fmtDate } from './clientUtils';
import './Client.css';

// Asks how to save: as a new portfolio, or over an existing one of the same kind. "Overwrite" adds a
// new version; the earlier version stays in the portfolio's history, so nothing is lost.
//   source       'model' | 'custom' | 'retirement'
//   defaultName  suggested name for a new portfolio
//   getPayload   (variant) => ({ model_key?, summary, snapshot }), called only when the user confirms
//   variants     optional [{ key, label, desc }]: asks which version of the portfolio to save
//                (e.g. optimised or original weights) and passes the choice to getPayload
export default function SaveToClientDialog({ source, defaultName, getPayload, variants, onClose }) {
  const { activeClient } = useClient();
  const navigate = useNavigate();
  const [existing, setExisting] = useState(null); // null while loading
  const [mode, setMode] = useState(null);         // 'new' | 'replace', chosen explicitly
  const [name, setName] = useState(defaultName || '');
  const [targetKey, setTargetKey] = useState('');
  const [variant, setVariant] = useState(variants?.[0]?.key || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    let live = true;
    listPortfolios(activeClient.id)
      .then(list => { if (live) setExisting(list.filter(p => p.source === source)); })
      .catch(e => { if (live) { setExisting([]); setError(e.message); } });
    return () => { live = false; };
  }, [activeClient.id, source]);

  const canSave = !saving && (
    (mode === 'new' && name.trim()) || (mode === 'replace' && targetKey)
  );

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      const payload = getPayload(variant);
      const body = mode === 'new'
        ? { name: name.trim(), source, ...payload }
        : { portfolio_key: targetKey, ...payload };
      setSaved(await savePortfolio(activeClient.id, body));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const loading = existing === null;
  const hasExisting = !loading && existing.length > 0;

  return (
    <div className="sp-overlay" onClick={onClose}>
      <div className="sp-dialog" onClick={e => e.stopPropagation()}>
        <div className="sp-title">Save to {activeClient.name}</div>
        <div className="sp-sub">{SOURCE_LABEL[source]}</div>

        {saved ? (
          <>
            <div className="sp-done">
              Saved as <strong>{saved.name}</strong>, version {saved.version}.
            </div>
            <div className="sp-actions">
              <button className="btn-outline" onClick={onClose}>Close</button>
              <button className="btn-primary" onClick={() => navigate('/client')}>View on dashboard</button>
            </div>
          </>
        ) : (
          <>
            {variants && (
              <div className="sp-group">
                <div className="sp-group-title">Which weights do you want to save?</div>
                {variants.map(v => (
                  <label key={v.key} className={`sp-choice ${variant === v.key ? 'on' : ''}`}>
                    <input type="radio" name="sp-variant" checked={variant === v.key} onChange={() => setVariant(v.key)} />
                    <div>
                      <div className="sp-choice-title">{v.label}</div>
                      <div className="sp-choice-desc">{v.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {variants && <div className="sp-group-title">How do you want to save it?</div>}
            <label className={`sp-choice ${mode === 'new' ? 'on' : ''}`}>
              <input type="radio" name="sp-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
              <div>
                <div className="sp-choice-title">Save as a new portfolio</div>
                <div className="sp-choice-desc">Adds a separate portfolio. Everything already saved stays as it is.</div>
                {mode === 'new' && (
                  <input
                    className="sp-input"
                    autoFocus
                    maxLength={200}
                    placeholder="Portfolio name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                )}
              </div>
            </label>

            <label className={`sp-choice ${mode === 'replace' ? 'on' : ''} ${hasExisting ? '' : 'off'}`}>
              <input
                type="radio" name="sp-mode" disabled={!hasExisting}
                checked={mode === 'replace'} onChange={() => setMode('replace')}
              />
              <div>
                <div className="sp-choice-title">Overwrite an existing portfolio</div>
                <div className="sp-choice-desc">
                  {loading && 'Checking saved portfolios…'}
                  {!loading && !hasExisting && `No ${SOURCE_LABEL[source].toLowerCase()} saved for this client yet.`}
                  {hasExisting && 'The one you pick is replaced by this. Its previous version stays in its history.'}
                </div>
                {mode === 'replace' && (
                  <select className="sp-input" value={targetKey} onChange={e => setTargetKey(e.target.value)}>
                    <option value="">Choose a portfolio…</option>
                    {existing.map(p => (
                      <option key={p.portfolio_key} value={p.portfolio_key}>
                        {p.name} · v{p.version} · saved {fmtDate(p.created_at)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>

            {error && <div className="sp-error">{error}</div>}

            <div className="sp-actions">
              <button className="btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={!canSave} onClick={confirm}>
                {saving ? 'Saving…' : mode === 'replace' ? 'Overwrite' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
