import React, { useState, useRef, useEffect, useCallback } from 'react';

const API = process.env.REACT_APP_API_URL || '';
function BenchmarkPicker({ selectedDate, value, onChange }) {
  const [allBMs, setAllBMs] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().slice(0, 10) : (selectedDate || '');
  const [rawBmWeights, setRawBmWeights] = React.useState({});

  React.useEffect(() => {
    const url = dateStr ? API+'/api/benchmarks/returns?date='+dateStr : API+'/api/benchmarks/returns';
    fetch(url).then(r=>r.json()).then(d=>{
      setAllBMs((d.benchmarks||[]).map(b=>({
        name:b.index_name,display_name:b.index_name,
        return_1y:b.return_1y,return_3y:b.return_3y,return_5y:b.return_5y,
        return_1m:b.return_1m,return_3m:b.return_3m,return_6m:b.return_6m,
        return_ytd:b.return_ytd,return_cy2025:b.return_cy2025,
        return_cy2024:b.return_cy2024,return_cy2023:b.return_cy2023,
        return_cy2022:b.return_cy2022,return_cy2021:b.return_cy2021,
      })));
    }).catch(()=>{});
  }, [dateStr]);

  const selected = value || [];
  function toggleBM(bm) {
    const exists = selected.find(s=>s.name===bm.name);
    if (exists) {
      const remaining = selected.filter(s=>s.name!==bm.name);
      if (remaining.length>0) { const eq=Math.floor(100/remaining.length); onChange(remaining.map((s,i)=>({...s,weight:i===remaining.length-1?100-eq*(remaining.length-1):eq}))); } else onChange([]);
    } else {
      const newSel=[...selected,{...bm,weight:0}]; const eq=Math.floor(100/newSel.length);
      onChange(newSel.map((s,i)=>({...s,weight:i===newSel.length-1?100-eq*(newSel.length-1):eq})));
    }
  }
  function handleBmWeightChange(name,val){ setRawBmWeights(prev=>({...prev,[name]:val})); }
  function handleBmWeightBlur(name,val){
    const v=Math.max(0,Math.min(100,parseInt(val)||0));
    onChange(selected.map(s=>s.name===name?{...s,weight:v}:s));
    setRawBmWeights(prev=>{const n={...prev};delete n[name];return n;});
  }
  const totalW=selected.reduce((s,b)=>s+(b.weight||0),0);
  return (
    <div style={{position:'relative',minWidth:220}}>
      {selected.length>0&&(<div style={{marginBottom:4,display:'flex',flexDirection:'column',gap:3}}>
        {selected.map(bm=>(<div key={bm.name} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 8px',background:'var(--bg-secondary)',borderRadius:6,border:'1px solid var(--border)'}}>
          <div style={{flex:1,fontSize:11,fontWeight:500,color:'var(--brand-dark)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bm.display_name}</div>
          <input type="number" min="0" max="100"
            value={rawBmWeights[bm.name]!==undefined?rawBmWeights[bm.name]:(bm.weight||0)}
            onChange={e=>handleBmWeightChange(bm.name,e.target.value)}
            onBlur={e=>handleBmWeightBlur(bm.name,e.target.value)}
            style={{width:42,padding:'2px 4px',border:'1px solid '+(totalW===100?'var(--border)':'var(--brand-primary)'),borderRadius:4,fontFamily:'var(--font-mono)',fontSize:11,fontWeight:600,textAlign:'center'}}/>
          <span style={{fontSize:10,color:'var(--text-muted)'}}>%</span>
          <button onClick={()=>toggleBM(bm)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:13,padding:'0 2px'}}>✕</button>
        </div>))}
        <div style={{fontSize:9,color:totalW===100?'var(--pos)':'var(--brand-primary)',fontWeight:600,paddingLeft:2}}>{totalW===100?'✓ 100%':'⚠ '+totalW+'%'}</div>
      </div>)}
      <button onClick={()=>setOpen(v=>!v)} style={{padding:'4px 10px',border:'1px dashed var(--brand-primary)',borderRadius:6,background:'rgba(145,47,99,.04)',color:'var(--brand-primary)',fontSize:10,fontWeight:500,cursor:'pointer',width:'100%'}}>
        {open?'✕ Close':'+ '+(selected.length>0?'Change':'Set benchmark')}{allBMs.length>0&&!open&&<span style={{marginLeft:4,fontSize:9,color:'var(--text-muted)',fontWeight:400}}>({allBMs.length} available)</span>}
      </button>
      {open&&(<div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:999,background:'#fff',border:'1px solid var(--border)',borderRadius:8,boxShadow:'0 8px 24px rgba(62,52,82,.12)',maxHeight:220,overflowY:'auto',marginTop:4}}>
        {allBMs.length===0?<div style={{padding:12,textAlign:'center',fontSize:11,color:'var(--text-muted)'}}>Loading…</div>
        :allBMs.map(bm=>{const isSel=selected.some(s=>s.name===bm.name);return(
          <div key={bm.name} onClick={()=>toggleBM(bm)} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',cursor:'pointer',borderBottom:'1px solid var(--border)',background:isSel?'rgba(145,47,99,.04)':'#fff'}}>
            <div style={{width:14,height:14,borderRadius:3,border:'1.5px solid '+(isSel?'var(--brand-primary)':'var(--border)'),background:isSel?'var(--brand-primary)':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              {isSel&&<svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:500,color:'var(--text-primary)'}}>{bm.display_name}</div>
              <div style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>1Y {bm.return_1y!=null?(bm.return_1y>=0?'+':'')+bm.return_1y.toFixed(1)+'%':'—'} · 3Y {bm.return_3y!=null?(bm.return_3y>=0?'+':'')+bm.return_3y.toFixed(1)+'%':'—'}</div>
            </div>
          </div>
        );})}
      </div>)}
    </div>
  );
}

const COLORS = ['#912F63','#3E3452','#1558A8','#1A7A52','#C46985','#6D5479','#B46B10','#0F6E56'];
const BM_DATA = {
  nifty50:    {name:'Nifty 50 TRI',            rets:{r1y:16.3,r3y:13.2,r5y:14.8,cy25:11.88,cy24:10.09,cy23:21.30,cy22:5.69,cy21:25.59}},
  nifty100:   {name:'Nifty 100 TRI',           rets:{r1y:15.8,r3y:12.8,r5y:14.2,cy25:11.6,cy24:10.09,cy23:22.70,cy22:5.90,cy21:28.40}},
  nifty500:   {name:'Nifty 500 TRI',           rets:{r1y:14.9,r3y:14.1,r5y:15.6,cy25:12.4,cy24:17.60,cy23:23.20,cy22:2.20,cy21:30.50}},
  midcap150:  {name:'Nifty Midcap 150 TRI',    rets:{r1y:13.2,r3y:18.9,r5y:19.4,cy25:15.2,cy24:28.60,cy23:40.80,cy22:-5.10,cy21:48.00}},
  smallcap250:{name:'Nifty Smallcap 250 TRI',  rets:{r1y:11.8,r3y:20.1,r5y:20.8,cy25:14.1,cy24:26.00,cy23:48.20,cy22:-12.90,cy21:58.50}},
  largmid250: {name:'Nifty Large Midcap 250 TRI',rets:{r1y:14.6,r3y:15.3,r5y:16.4,cy25:13.2,cy24:21.10,cy23:28.50,cy22:-0.10,cy21:35.70}},
  hybrid7525: {name:'Nifty 50 Hybrid 75:25 TRI',rets:{r1y:12.4,r3y:11.2,r5y:12.8,cy25:9.8,cy24:13.20,cy23:17.70,cy22:4.80,cy21:20.40}},
  sensex:     {name:'BSE Sensex TRI',           rets:{r1y:15.6,r3y:12.6,r5y:14.1,cy25:11.3,cy24:9.50,cy23:19.80,cy22:6.10,cy21:23.50}},
};

// Same helpers as Watchlist
function fmt(v, d=2) { if (v==null||v==='-') return '—'; return parseFloat(v).toFixed(d); }
function pct(v) { if (v==null||v==='-') return '—'; const n=parseFloat(v); return (n>=0?'+':'')+n.toFixed(2)+'%'; }
function col(v) { if (v==null||v==='-') return 'var(--text-muted)'; return parseFloat(v)>=0?'var(--pos)':'var(--brand-primary)'; }

// Get snapshot data for a fund — same as Watchlist does
async function fetchSnapshot(isin, dateStr) {
  try {
    const r = await fetch(`${API}/api/home/snapshot?isin=${isin}&date=${dateStr}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function equaliseWeights(fundList) {
  if (!fundList.length) return {};
  const eq = parseFloat((100 / fundList.length).toFixed(2));
  const nw = {};
  let assigned = 0;
  fundList.forEach((f, i) => {
    if (i === fundList.length - 1) {
      nw[f.isin] = parseFloat((100 - assigned).toFixed(2));
    } else {
      nw[f.isin] = eq;
      assigned += eq;
    }
  });
  return nw;
}

export default function BuildPortfolio({ funds, weights, setFunds, setWeights, snapshots={}, setSnapshots, benchmarks=[], onBenchmarksChange, ipsSkipped=false, onAnalyse, ips, selectedDate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [ddOpen, setDdOpen] = useState(false);
  const [wlDdOpen, setWlDdOpen] = useState(false);
  const [watchlistFunds, setWatchlistFunds] = useState([]);
  // snapshots come from parent (shared across all steps)
  const inputRef = useRef(null);
  const ddRef = useRef(null);
  const wlRef = useRef(null);

  const dateStr = selectedDate ? selectedDate.toISOString().slice(0,10) : '';

  // Fetch snapshots for all funds in portfolio — same as Watchlist
  useEffect(() => {
    if (!funds.length || !dateStr) return;
    const missing = funds.filter(f => !snapshots[f.isin]);
    if (!missing.length) return;
    Promise.allSettled(
      missing.map(f => fetchSnapshot(f.isin, dateStr))
    ).then(results => {
      const map = { ...snapshots };
      missing.forEach((f, i) => {
        if (results[i].status === 'fulfilled' && results[i].value) map[f.isin] = results[i].value;
      });
      setSnapshots(map);
    });
  }, [funds, dateStr]);

  // Load watchlist
  useEffect(() => {
    if (!wlDdOpen) return;
    try {
      const wl = JSON.parse(localStorage.getItem('watchlist_default') || '[]');
      setWatchlistFunds(wl);
    } catch { setWatchlistFunds([]); }
  }, [wlDdOpen]);

  // Search
  const search = useCallback(async (q) => {
    if (!q) { setResults([]); setDdOpen(false); return; }
    try {
      const r = await fetch(`${API}/api/funds/search?q=${encodeURIComponent(q)}&date=${dateStr}&limit=20`);
      const d = await r.json();
      const usedIsins = funds.map(f => f.isin);
      setResults((d.funds||[]).filter(f => !usedIsins.includes(f.isin)).slice(0,15));
      setDdOpen(true);
    } catch { setResults([]); }
  }, [funds, dateStr]);

  useEffect(() => { const t = setTimeout(()=>search(query),200); return ()=>clearTimeout(t); }, [query, search]);

  useEffect(() => {
    function handleClick(e) {
      if (!ddRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) setDdOpen(false);
      if (!wlRef.current?.contains(e.target)) setWlDdOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const totalWeight = parseFloat(funds.reduce((s,f) => s+(weights[f.isin]||0), 0).toFixed(2));

  async function addFund(fund) {
    if (funds.find(f => f.isin===fund.isin)) return;
    const coloredFund = { ...fund, color: COLORS[funds.length % COLORS.length] };
    const newFunds = [...funds, coloredFund];
    setFunds(newFunds);
    // Preserve existing weights — new fund starts at 0 (user sets manually)
    setWeights(prev => ({ ...prev, [fund.isin]: 0 }));
    setQuery(''); setDdOpen(false);
    // Fetch snapshot immediately
    const snap = await fetchSnapshot(fund.isin, dateStr);
    if (snap) setSnapshots(prev => ({ ...prev, [fund.isin]: snap }));
  }

  async function addFromWatchlist(fund) {
    if (funds.find(f => f.isin===fund.isin)) return;
    const coloredFund = { ...fund, color: COLORS[funds.length % COLORS.length] };
    const newFunds = [...funds, coloredFund];
    setFunds(newFunds);
    // Preserve existing weights — new fund starts at 0 (user sets manually)
    setWeights(prev => ({ ...prev, [fund.isin]: 0 }));
    const snap = await fetchSnapshot(fund.isin, dateStr);
    if (snap) setSnapshots(prev => ({ ...prev, [fund.isin]: snap }));
  }

  function removeFund(isin) {
    const remaining = funds.filter(f => f.isin!==isin);
    setFunds(remaining);
    setSnapshots(prev => { const n={...prev}; delete n[isin]; return n; });
    // Preserve remaining weights — just remove the deleted fund
    setWeights(prev => { const n={...prev}; delete n[isin]; return n; });
  }

  const [rawWeights, setRawWeights] = React.useState({});

  function handleWeightChange(isin, val) {
    setRawWeights(prev => ({ ...prev, [isin]: val }));
  }

  function handleWeightBlur(isin, val) {
    const v = Math.max(0, Math.min(100, parseFloat(val) || 0));
    setWeights(prev => ({ ...prev, [isin]: parseFloat(v.toFixed(2)) }));
    setRawWeights(prev => { const n = { ...prev }; delete n[isin]; return n; });
  }

  function updateWeight(isin, val) {
    const v = Math.max(0, Math.min(100, parseFloat(val) || 0));
    setWeights(prev => ({ ...prev, [isin]: parseFloat(v.toFixed(2)) }));
  }

  function equalise() { if (funds.length) setWeights(equaliseWeights(funds)); }

  function clearAll() {
    if (funds.length && window.confirm('Remove all funds from the portfolio?')) {
      setFunds([]); setWeights({}); setSnapshots({});
    }
  }

  // Weighted average exposure metrics
  function blendMetric(getter) {
    let val = 0, covered = 0;
    funds.forEach(f => {
      const snap = snapshots[f.isin];
      if (!snap) return;
      const v = getter(snap);
      if (v==null||v==='-'||isNaN(parseFloat(v))) return;
      val += parseFloat(v) * (weights[f.isin]||0);
      covered += (weights[f.isin]||0);
    });
    return covered > 0 ? val/covered : null;
  }

  // All flat on snapshot response
  const bEq   = blendMetric(s => s.equity_pct);
  const bDebt = blendMetric(s => s.bond_pct);
  const bCash = blendMetric(s => s.cash_pct);
  const bOther= blendMetric(s => s.other_pct);
  const bLC   = blendMetric(s => s.large_cap);
  const bMC   = blendMetric(s => s.mid_cap);
  const bSC   = blendMetric(s => s.small_cap);

  function bar(val, color) {
    const p = val != null ? Math.min(val, 100).toFixed(1) : 0;
    return (
      <div style={{ display:'flex', alignItems:'center', gap:6, width:'100%' }}>
        <div style={{ flex:1, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
          <div style={{ width:p+'%', height:'100%', background:color, borderRadius:2 }} />
        </div>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, color, minWidth:38, textAlign:'right' }}>
          {val!=null ? val.toFixed(1)+'%' : '—'}
        </span>
      </div>
    );
  }

  const barColor = Math.abs(totalWeight-100)<=0.05?'var(--pos)':totalWeight>100?'var(--brand-primary)':'var(--text-muted)';
  const wlNotAdded = watchlistFunds.filter(f => !funds.find(p => p.isin===f.isin));

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0, overflow:'hidden' }}>

      {/* Toolbar */}
      <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'#fff', flexShrink:0, overflow:'visible' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontFamily:'var(--font-serif)', fontSize:16, fontWeight:600, color:'var(--brand-dark)' }}>Build portfolio</div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <button onClick={equalise} style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:20, background:'#fff', color:'var(--text-secondary)', fontSize:11, fontWeight:500, cursor:'pointer' }}>⟳ Equalise</button>
            <button onClick={clearAll} style={{ padding:'6px 12px', border:'1px solid rgba(145,47,99,.25)', borderRadius:20, background:'rgba(145,47,99,.04)', color:'var(--brand-primary)', fontSize:11, fontWeight:500, cursor:'pointer' }}>✕ Clear</button>
            <button onClick={onAnalyse} disabled={!funds.length||Math.abs(totalWeight-100)>0.05} style={{ padding:'7px 16px', border:'none', borderRadius:20, background:!funds.length||Math.abs(totalWeight-100)>0.05?'var(--border)':'var(--brand-primary)', color:'#fff', fontSize:11, fontWeight:600, cursor:!funds.length||Math.abs(totalWeight-100)>0.05?'not-allowed':'pointer' }}>
              Analyse portfolio →
            </button>
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          {/* Weight bar */}
          <div style={{ display:'flex', alignItems:'center', gap:8, width:240, flexShrink:0 }}>
            <span style={{ fontSize:9, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--text-muted)', whiteSpace:'nowrap' }}>Total weight</span>
            <div style={{ flex:1, height:5, background:'var(--border)', borderRadius:3, overflow:'hidden' }}>
              <div style={{ width:Math.min(totalWeight,100)+'%', height:'100%', background:barColor, borderRadius:3, transition:'width .2s' }} />
            </div>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, minWidth:58, textAlign:'right', color:barColor }}>{totalWeight} / 100%</span>
          </div>

          {/* Search */}
          <div style={{ flex:1, maxWidth:480, position:'relative' }} ref={ddRef}>
            <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', fontSize:12, pointerEvents:'none' }}>⊕</span>
            <input ref={inputRef} type="search" value={query} onChange={e=>setQuery(e.target.value)}
              placeholder="Search fund by name, AMC, category…"
              style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid var(--border)', borderRadius:'var(--radius-md)', font:'12px var(--font-body)', outline:'none', boxSizing:'border-box' }}
            />
            {ddOpen && results.length>0 && (
              <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, right:0, background:'#fff', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', boxShadow:'0 4px 16px rgba(62,52,82,.12)', maxHeight:220, overflowY:'auto', zIndex:50 }}>
                {results.map(f => (
                  <div key={f.isin} onClick={()=>addFund(f)}
                    style={{ padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8, fontSize:12 }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-secondary)'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{ width:3, height:30, borderRadius:2, background:COLORS[funds.length%COLORS.length], flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11.5, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:1 }}>{f.name}</div>
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <span style={{ fontSize:9, background:'var(--bg-secondary)', padding:'1px 6px', borderRadius:10, color:'var(--text-secondary)' }}>{f.category}</span>
                        {f.return_1y!=null && <span style={{ fontSize:9, color:col(f.return_1y), fontWeight:600 }}>{pct(f.return_1y)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Watchlist */}
          <div style={{ position:'relative', flexShrink:0 }} ref={wlRef}>
            <button onClick={()=>setWlDdOpen(v=>!v)}
              style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:20, background:'#fff', color:'var(--text-secondary)', fontSize:11, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
              ♡ Watchlist
              {wlNotAdded.length>0 && <span style={{ background:'var(--brand-primary)', color:'#fff', fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:10 }}>{wlNotAdded.length}</span>}
            </button>
            {wlDdOpen && (
              <div style={{ position:'fixed', top:wlRef.current?wlRef.current.getBoundingClientRect().bottom+6+'px':'80px', right:wlRef.current?(window.innerWidth-wlRef.current.getBoundingClientRect().right)+'px':'20px', background:'#fff', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', boxShadow:'0 8px 24px rgba(62,52,82,.14)', width:360, zIndex:9999 }}>
                {wlNotAdded.length===0 ? (
                  <div style={{ padding:'20px 14px', textAlign:'center', fontSize:12, color:'var(--text-muted)' }}>
                    {watchlistFunds.length===0?'Watchlist is empty':'All watchlist funds already added'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)', background:'var(--bg-secondary)', borderRadius:'var(--radius-lg) var(--radius-lg) 0 0' }}>
                      <span style={{ fontSize:9, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--text-muted)' }}>Select from watchlist ({wlNotAdded.length})</span>
                      <button onClick={()=>{ wlNotAdded.forEach(f=>addFromWatchlist(f)); setWlDdOpen(false); }}
                        style={{ fontSize:10, fontWeight:600, padding:'3px 10px', borderRadius:20, border:'none', background:'var(--brand-primary)', color:'#fff', cursor:'pointer' }}>+ Add all</button>
                    </div>
                    <div style={{ maxHeight:380, overflowY:'auto' }}>
                      {wlNotAdded.map((f, idx) => (
                        <div key={f.isin} style={{ padding:'9px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8 }}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--bg-secondary)'}
                          onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                          <div style={{ width:3, height:34, borderRadius:2, background:COLORS[(funds.length+idx)%COLORS.length], flexShrink:0 }} />
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:11.5, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:2 }}>{f.name}</div>
                            <div style={{ fontSize:9, color:'var(--text-muted)' }}>{f.category}</div>
                          </div>
                          <button onClick={()=>addFromWatchlist(f)}
                            style={{ width:24, height:24, borderRadius:'50%', border:'1.5px solid var(--brand-primary)', background:'#fff', color:'var(--brand-primary)', fontSize:14, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, lineHeight:1 }}>+</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Benchmark display / picker */}
          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0, maxWidth: ipsSkipped ? 340 : 280 }}>
            <label style={{ fontSize:10, fontWeight:500, color:'var(--text-muted)', flexShrink:0 }}>Benchmark</label>
            {ipsSkipped
              ? <BenchmarkPicker selectedDate={selectedDate} value={benchmarks} onChange={onBenchmarksChange} />
              : <div style={{ fontSize:11, color:'var(--brand-dark)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {benchmarks.length > 0
                    ? benchmarks.map(b => `${b.display_name} (${b.weight}%)`).join(' + ')
                    : <span style={{ color:'var(--text-muted)', fontStyle:'italic' }}>Set in Client & IPS</span>}
                </div>
            }
          </div>
        </div>
      </div>

      {/* Weighted avg exposure strip */}
      {funds.length>0 && (
        <div style={{ display:'flex', alignItems:'stretch', borderBottom:'1px solid var(--border)', background:'#fff', flexShrink:0, overflowX:'auto' }}>
          {/* Funds count */}
          <div style={{ textAlign:'center', padding:'8px 16px', borderRight:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <div style={{ fontFamily:'var(--font-serif)', fontSize:20, fontWeight:600, color:'var(--brand-dark)', lineHeight:1 }}>{funds.length}</div>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--text-muted)', marginTop:3 }}>FUNDS</div>
          </div>
          {/* Asset class exposure */}
          <div style={{ padding:'8px 16px', borderRight:'1px solid var(--border)', flexShrink:0, minWidth:180 }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:5 }}>Asset class exposure</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {[
                ['Equity',  bEq,   '#912F63'],
                ['Debt',    bDebt, '#3E3452'],
                ['Cash',    bCash, '#A795AE'],
                ['Other',   bOther,'#6D5479'],
              ].filter(([,v]) => v!=null && v > 0.1).map(([l,v,c]) => (
                <div key={l} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:9, color:'var(--text-muted)', width:36, flexShrink:0 }}>{l}</span>
                  {bar(v, c)}
                </div>
              ))}
            </div>
          </div>
          {/* Market cap exposure */}
          <div style={{ padding:'8px 16px', flexShrink:0, minWidth:180 }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:5 }}>Market cap exposure</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {[
                ['Large',   bLC,  '#912F63'],
                ['Mid',     bMC,  '#6D5479'],
                ['Small',   bSC,  '#C46985'],
              ].filter(([,v]) => v!=null && v > 0.1).map(([l,v,c]) => (
                <div key={l} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:9, color:'var(--text-muted)', width:36, flexShrink:0 }}>{l}</span>
                  {bar(v, c)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fund list */}
      <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
        {funds.length===0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, color:'var(--text-muted)' }}>
            <div style={{ fontSize:32, opacity:.2 }}>◈</div>
            <div style={{ fontFamily:'var(--font-serif)', fontSize:18, fontWeight:600, color:'var(--brand-dark)' }}>No funds added yet</div>
            <div style={{ fontSize:13 }}>Search for a fund above or import from your watchlist.</div>
          </div>
        ) : funds.map((f, idx) => {
          const w = weights[f.isin]||0;
          const snap = snapshots[f.isin];
          const r1y = snap?.returns?.['1y'];
          return (
            <div key={f.isin} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 20px', borderBottom:'1px solid var(--border)', background:'#fff' }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--bg-secondary)'}
              onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
              <div style={{ width:3, height:36, borderRadius:2, background:f.color||COLORS[idx%COLORS.length], flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:500, color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:2 }}>{f.name}</div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={{ fontSize:9, background:'var(--bg-secondary)', padding:'1px 6px', borderRadius:10 }}>{f.category}</span>
                  {r1y!=null&&r1y!=='-' && <span style={{ fontSize:9, fontWeight:600, color:col(r1y) }}>1Y {pct(r1y)}</span>}
                  {snap?.risk?.sharpe_ratio_3y!=null && <span style={{ fontSize:9, color:'var(--text-muted)' }}>Sh {fmt(snap.risk.sharpe_ratio_3y)}</span>}
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                <input type="range" min="0" max="100" step="0.5" value={w} onChange={e=>updateWeight(f.isin,e.target.value)}
                  style={{ WebkitAppearance:'none', width:110, height:4, borderRadius:2, background:'var(--border)', outline:'none', cursor:'pointer' }} />
                <input type="number" min="0" max="100" step="0.5"
                  value={rawWeights[f.isin] !== undefined ? rawWeights[f.isin] : (w === 0 ? "" : w)}
                  onChange={e => handleWeightChange(f.isin, e.target.value)}
                  onBlur={e => handleWeightBlur(f.isin, e.target.value)}
                  style={{ width:58, border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'3px 5px', font:'11px var(--font-mono)', fontWeight:600, textAlign:'center', outline:'none' }} />
                <span style={{ fontSize:11, color:'var(--text-muted)' }}>%</span>
                <button onClick={()=>removeFund(f.isin)}
                  style={{ width:17, height:17, borderRadius:'50%', border:'1px solid var(--border)', background:'none', cursor:'pointer', fontSize:9, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', padding:0 }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {Math.abs(totalWeight-100)>0.05&&funds.length>0 && (
        <div style={{ padding:'10px 20px', background:totalWeight>100?'#FFF1F4':'var(--bg-secondary)', borderTop:'1px solid '+(totalWeight>100?'#F9A8BC':'var(--border)'), fontSize:11.5, color:totalWeight>100?'#B91C1C':'var(--text-muted)', flexShrink:0, display:'flex', alignItems:'center', gap:8, fontWeight: totalWeight>100?600:400 }}>
          {totalWeight>100
            ? <>⚠️ <span>Weights sum to <strong>{totalWeight}%</strong> — exceeds 100% by <strong>{(totalWeight-100).toFixed(2)}%</strong>. Weights must sum to exactly 100% to run analysis.</span></>
            : <>ℹ️ <span>Weights sum to <strong>{totalWeight}%</strong> — add <strong>{(100-totalWeight).toFixed(2)}%</strong> more to reach 100%</span></>
          }
        </div>
      )}
    </div>
  );
}

export { COLORS };
export function fp(v) { if (v==null||v==='-') return '—'; const n=parseFloat(v); return (n>=0?'+':'')+n.toFixed(1)+'%'; }
export function f2(v) { if (v==null||v==='-') return '—'; return parseFloat(v).toFixed(1); }