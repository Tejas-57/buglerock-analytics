import React, { useState, useRef, useEffect } from 'react';
import './ChatButton.css';

export default function ChatButton({ selectedFund, selectedDate }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I\'m your BugleRock AI assistant. Ask me anything about mutual funds, risk metrics, or the currently selected fund.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullContext, setFullContext] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Fetch all tab data whenever fund or date changes
  useEffect(() => {
    if (!selectedFund?.isin) { setFullContext(null); return; }

    const dateStr = selectedDate instanceof Date
      ? selectedDate.toISOString().split('T')[0]
      : selectedDate;

    const isin       = selectedFund.isin;
    const amfi       = selectedFund.amfi_code;
    const category   = encodeURIComponent(selectedFund.category || '');
    const assetClass = encodeURIComponent(selectedFund.assetClass || '');

    Promise.allSettled([
      // Home snapshot
      fetch(`/api/home/snapshot?isin=${isin}&date=${dateStr}`).then(r => r.json()),
      // Performance metrics (returns + benchmark + peer avg)
      fetch(`/api/performance/metrics?isin=${isin}&category=${category}&asset_class=${assetClass}&date=${dateStr}`).then(r => r.json()),
      // Peer comparison
      fetch(`/api/peer/comparison?isin=${isin}&category=${category}&asset_class=${assetClass}&date=${dateStr}`).then(r => r.json()),
    ]).then(([snapRes, perfRes, peerRes]) => {
      setFullContext({
        snapshot:    snapRes.status === 'fulfilled' ? snapRes.value : null,
        performance: perfRes.status === 'fulfilled' ? perfRes.value : null,
        peers:       peerRes.status === 'fulfilled' ? peerRes.value : null,
        fund:        selectedFund,
        date:        dateStr,
      });
    });
  }, [selectedFund?.isin, selectedDate]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          fund_context: fullContext,
          date: fullContext?.date || (selectedDate instanceof Date
            ? selectedDate.toISOString().split('T')[0]
            : selectedDate),
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', text: data.response || 'Sorry, I could not process that.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Connection error. Please try again.' }]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <>
      <button className={`chat-fab ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title="AI Assistant">
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        )}
        {!open && <span className="fab-label">AI</span>}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-left">
              <div className="chat-avatar">G</div>
              <div>
                <div className="chat-title">BugleRock AI</div>
                <div className="chat-sub">Powered by Gemini</div>
              </div>
            </div>
            {selectedFund && (
              <div className="chat-fund-tag">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                </svg>
                {selectedFund.name?.split(' ').slice(0, 3).join(' ')}…
              </div>
            )}
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.role === 'assistant' && <div className="msg-avatar">G</div>}
                <div className="msg-bubble">{m.text}</div>
              </div>
            ))}
            {loading && (
              <div className="chat-msg assistant">
                <div className="msg-avatar">G</div>
                <div className="msg-bubble typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-row">
            <textarea
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about this fund, risk metrics, comparisons…"
              rows={2}
            />
            <button className="chat-send" onClick={sendMessage} disabled={!input.trim() || loading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22,2 15,22 11,13 2,9"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}