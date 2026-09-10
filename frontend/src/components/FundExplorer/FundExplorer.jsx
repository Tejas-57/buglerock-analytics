import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Normalize category name — remove spaces after colon for consistent matching
function normCat(cat) {
  return cat ? cat.replace(/Cat:\s+/g, 'Cat: ').trim() : cat;
}

const EXCLUDED_ACTIVE_EQUITY = [
  'Cat: Index MF - IT','Cat: Index MF - Factor-Low Vol','Cat: Index MF - Factor-Alpha Low Vol',
  'Cat:Index MF - Factor-Momentum','Cat: Index MF - Factor-Value','Cat: Index MF - Factor-Quality','Cat: Index MF - Factor-Alpha',
];

const ASSET_STRUCTURE = [
  {
    id:'equity', label:'Equity', icon:'📈',
    subtypes:[
      { id:'active', label:'Active Funds', asset_classes:['Equity'], groups:[
        { label:'', cats:['India Fund Large-Cap','India Fund Large & Mid-Cap','India Fund Flexi Cap','Cat: Flexi Cap Funds','Cat: Multi Cap Funds','India Fund Focused Fund','Cat: Contra / Value Funds'] },
        { label:'', cats:['India Fund Mid-Cap','India Fund Small-Cap'] },
        { label:'ELSS', cats:['India Fund ELSS (Tax Savings)'] },
        { label:'Thematic & Sectoral', cats:['Thematic Funds','Cat: Thematic - Quant','Cat: Thematic - Business Cycle','Cat: Banking & Financial Services Funds','Cat: Infrastructure Funds','Cat: Consumption Funds','India Fund Sector - Energy','Cat: IT / Tech Funds','Cat: Healthcare funds','Cat: MNC Funds','India Fund Equity - Other'] },
        { label:'Others', cats:['Cat: Equity FoF','Cat: Multi Factor'] },
      ]},
      { id:'passive_index', label:'Passive Funds', asset_classes:['Equity Index'], groups:[
        { label:'Broad Market', cats:['India Fund Index Funds','Cat: Index MF - Nifty 50','Cat: Index MF - Nifty Next 50','Cat: Index MF - Sensex','Cat: Index MF - Nifty & BSE 500','Cat: Index MF - Nifty 100','Cat: Index MF - Equal Wt','Cat: Index MF - Large&Mid','Cat: Index MF - Midcap','Cat: Index MF - Smallcap'] },
        { label:'Factor / Smart Beta', cats:['Cat: Index MF - Factor-Value','Cat:Index MF - Factor-Momentum','Cat: Index MF - Factor-Quality','Cat: Index MF - Factor-Low Vol','Cat: Index MF - Factor-Alpha Low Vol','Cat: Index MF - Factor-Alpha','Cat: Multi Factor'] },
        { label:'Sectoral', cats:['Cat: Index MF - Bank','Cat: Index MF - IT','Cat: Healthcare funds','Cat: Thematic - Manufacturing','Cat: Thematic Funds','Cat: Thematic - PSU','Cat: Thematic - Commodities'] },
      ]},
      { id:'passive_etf', label:'Passive - ETF', asset_classes:['ETF - Equity'], groups:[
        { label:'Broad Market', cats:['India ETF Nifty 50','India ETF Nifty Next 50','India ETF Sensex','India ETF Nifty 100','India ETF Nifty 200','India ETF Nifty 500','India ETF Others'] },
        { label:'Mid & Small Cap', cats:['India ETF Midcap','India ETF Smallcap'] },
        { label:'Factor Based', cats:['India ETF Value','India ETF Alpha','India ETF Low Vol','India ETF Momentum','India ETF Quality','India ETF Divided Yield'] },
        { label:'Sectoral', cats:['India ETF Technology','India ETF Financial Services','India ETF Defence','India ETF Metals & Commodities','India ETF Energy','India ETF Healthcare','India ETF Consumption','India ETF Infrastructure'] },
      ]},
      { id:'global', label:'Global Funds', asset_classes:['International'], groups:[
        { label:'Global', cats:['India Fund Global - Other','Cat: Global - Other Funds','Cat: Global - Innovation Funds','Cat: Emerging Market Funds','Cat: China & Asia based Funds','Cat: US based Funds','Cat: Europe based Funds'] },
      ]},
    ],
  },
  {
    id:'hybrid', label:'Hybrid', icon:'⚖️',
    subtypes:[{ id:'hybrid_all', label:'All Hybrid', asset_classes:['Hybrid'], groups:[
      { label:'Equity-oriented', cats:['India Fund Aggressive Allocation','India Fund Dynamic Asset Allocation','India Fund Multi Asset Allocation','India Fund Balanced Allocation','India Fund Equity Savings','India Fund Arbitrage Fund'] },
      { label:'Debt-oriented', cats:['India Fund Conservative Allocation'] },
      { label:'Solution-oriented', cats:['India Fund Retirement','India Fund Children'] },
    ]}],
  },
  {
    id:'precious_metals', label:'Precious Metals', icon:'🥇',
    subtypes:[
      { id:'pm_all', label:'All', asset_classes:['Precious Metals', 'ETF - Equity'], groups:[
        { label:'Gold', cats:['Cat: India Fund Sector - Precious Metals-Gold', 'India ETF Gold'] },
        { label:'Silver', cats:['Cat: India Fund Sector - Precious Metals-Silver', 'India ETF Silver'] },
        { label:'Gold & Silver ETF FoFs', cats:['India Fund Sector - Precious Metals'] },
      ]},
    ],
  },
  {
    id:'sif', label:'SIF', icon:'🔬',
    subtypes:[{ id:'sif_all', label:'All SIF', asset_classes:['SIF'], groups:[
      { label:'SIF', cats:[
        'India Fund Equity Oriented',
        'India Fund Hybrid Oriented',
        'Cat: SIF',
        'India Fund Hybrid Long-Short Fund',
        'India Fund Equity Ex-Top 100 Long-Short Fund',
        'India Fund Equity Long-Short Fund',
      ]},
    ]}],
  },
  {
    id:'fixed_income', label:'Debt', icon:'🏦',
    subtypes:[
      { id:'debt_mf', label:'Debt MFs', asset_classes:['Debt'], groups:[
        { label:'Liquid Funds', cats:['India OE Overnight','India OE Liquid','India OE Ultra Short Duration','India OE Money Market'] },
        { label:'Duration Funds', cats:['India OE Short Duration','India OE Low Duration','India OE Medium Duration','India OE Medium to Long Duration','India OE Long Duration','India OE Government Bond','India OE 10 yr Government Bond'] },
        { label:'Others', cats:['India OE Corporate Bond','India OE Dynamic Bond','India OE Floating Rate','India OE Banking & PSU','India OE Credit Risk','India OE Index Funds - Fixed Income','India OE Other Bond','India OE Fund of Funds'] },
      ]},
      { id:'debt_etf', label:'Debt ETFs', asset_classes:['ETF - Debt'], groups:[
        { label:'ETF', cats:['India ETF Medium to Long Duration','India ETF Long Duration','India ETF Government Bond','India ETF 10 yr Government Bond','India ETF Index Funds - Fixed Income'] },
      ]},
    ],
  },
];

// Categories that are merged from multiple DB categories
const MERGED_CATEGORIES = {
  'India Fund Equity Savings': {
    asset_class: 'Hybrid',
    sub_cats: 'India Fund Equity Savings - Aggressive|India Fund Equity Savings - Conservative',
  },
  'India ETF Gold': {
    asset_class: 'ETF - Equity',
    sub_cats: 'India ETF Gold',
  },
  'India ETF Silver': {
    asset_class: 'ETF - Equity',
    sub_cats: 'India ETF Silver',
  },
};

const RANK_ORDER = { R1:1, R2:2, R3:3, R4:4, R5:5 };
const RANK_COLORS = {
  R1:{ bg:'rgba(16,185,129,0.12)', color:'#059669', border:'rgba(16,185,129,0.3)' },
  R2:{ bg:'rgba(16,185,129,0.12)', color:'#059669', border:'rgba(16,185,129,0.3)' },
  R3:{ bg:'rgba(45,31,43,0.06)',   color:'#2D1F2B', border:'rgba(45,31,43,0.15)' },
  R4:{ bg:'rgba(239,68,68,0.08)',  color:'#EF4444', border:'rgba(239,68,68,0.2)' },
  R5:{ bg:'rgba(239,68,68,0.08)',  color:'#EF4444', border:'rgba(239,68,68,0.2)' },
};
const PIP_COLORS = { R1:'#059669', R2:'#059669', R3:'#2D1F2B', R4:'#EF4444', R5:'#EF4444', default:'#A795AE' };

function getRankOrder(r) { return !r || r==='-' || r==='0' ? 99 : (RANK_ORDER[r] || 98); }
function cleanLabel(cat) { return cat.replace(/^(India Fund |India OE |India ETF |Cat: |Cat:)/,''); }

const CAT_LABEL_OVERRIDE = {
  'Cat: India Fund Sector - Precious Metals-Gold':   'Gold Funds',
  'India ETF Gold':                                  'Gold ETFs',
  'Cat: India Fund Sector - Precious Metals-Silver': 'Silver Funds',
  'India ETF Silver':                                'Silver ETFs',
  'India Fund Sector - Precious Metals':             'Gold & Silver ETF FoFs',
};

function RankBadge({ ranking }) {
  if (!ranking || ranking==='-' || ranking==='0') return null;
  const s = RANK_COLORS[ranking] || { bg:'#f5f5f5', color:'#999', border:'#ddd' };
  return <span style={{ fontSize:10, fontWeight:700, fontFamily:'var(--font-mono)', padding:'2px 6px', borderRadius:3, background:s.bg, color:s.color, border:`1px solid ${s.border}` }}>{ranking}</span>;
}

export default function FundExplorer({ selectedDate, setSelectedFund }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedAsset, setSelectedAsset]     = useState(() => searchParams.get('asset') || 'equity');
  const [selectedSubtype, setSelectedSubtype] = useState(() => searchParams.get('subtype') || 'active');
  const [selectedCat, setSelectedCat]         = useState(() => searchParams.get('cat') || null);
  const ACTIVE_SUBTYPES = ['active', 'hybrid_all', 'sif_all', 'debt_mf', 'debt_etf'];
  const NO_RANK_SUBTYPES = ['passive_index','passive_etf','debt_etf','global','pm_all'];
  const [showWhitelisted, setShowWhitelisted] = useState(true);

  useEffect(() => {
    const params = {};
    if (selectedAsset) params.asset = selectedAsset;
    if (selectedSubtype) params.subtype = selectedSubtype;
    if (selectedCat) params.cat = selectedCat;
    setSearchParams(params, { replace: true });
  }, [selectedAsset, selectedSubtype, selectedCat]);

  const [sortBy, setSortBy]                   = useState(null);
  const [searchQuery, setSearchQuery]         = useState('');
  const [allFunds, setAllFunds]               = useState([]);
  const [peerAvg1y, setPeerAvg1y]             = useState(null);
  const [peerAvg3y, setPeerAvg3y]             = useState(null);
  const [peerAvg1m, setPeerAvg1m]             = useState(null);
  const [peerAvg3m, setPeerAvg3m]             = useState(null);
  const [loading, setLoading]                 = useState(false);
  const [availableCats, setAvailableCats]     = useState(null);
  const [availableCatsSubtype, setAvailableCatsSubtype] = useState(null);
  const catsLoadedOnce = React.useRef(false);
  const [searchResults, setSearchResults]     = useState([]);
  const [searchOpen, setSearchOpen]           = useState(false);
  const [searchLoading, setSearchLoading]     = useState(false);
  const [intelligence, setIntelligence]       = useState(null);
  const [intelLoading, setIntelLoading]       = useState(false);
  const [intelOpenTile, setIntelOpenTile]     = useState(null);

  const dateStr = selectedDate instanceof Date ? selectedDate.toISOString().split('T')[0] : selectedDate;
  const assetItem   = ASSET_STRUCTURE.find(a => a.id === selectedAsset);
  const subtypeItem = assetItem?.subtypes.find(s => s.id === selectedSubtype);

  const userChangedAsset   = React.useRef(false);
  const userChangedSubtype = React.useRef(false);

  const handleAssetChange = (assetId) => {
    userChangedAsset.current = true;
    setSelectedAsset(assetId);
  };

  const handleSubtypeChange = (subtypeId) => {
    userChangedSubtype.current = true;
    setSelectedCat(null);
    setAllFunds([]);
    setAvailableCats(new Set());
    setAvailableCatsSubtype(null);
    setSelectedSubtype(subtypeId);
  };

  useEffect(() => {
    if (!userChangedAsset.current) return;
    userChangedAsset.current = false;
    if (assetItem?.subtypes?.length) {
      const firstSubtype = assetItem.subtypes[0].id;
      setSelectedCat(null);
      setAllFunds([]);
      setAvailableCats(new Set());
      setAvailableCatsSubtype(null);
      setSelectedSubtype(firstSubtype);
      const isPassive = ['passive_index','passive_etf','debt_etf'].includes(firstSubtype);
      setShowWhitelisted(!isPassive);
    }
  }, [selectedAsset]);

  useEffect(() => {
    const noRankSubtypes = ['passive_index','passive_etf','debt_etf','global'];
    if (subtypeItem) setShowWhitelisted(!noRankSubtypes.includes(subtypeItem.id));
  }, [selectedSubtype]);

  useEffect(() => {
    if (!subtypeItem || !dateStr) return;
    const ac = subtypeItem.asset_classes[0];

    fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/categories?asset_class=${encodeURIComponent(ac)}&date=${dateStr}`)
      .then(r => r.json())
      .then(d => {
        const cats = new Set((d.categories || []).map(normCat));
        setAvailableCats(cats);
        setAvailableCatsSubtype(selectedSubtype);

        if (userChangedSubtype.current) {
          userChangedSubtype.current = false;
          for (const group of subtypeItem.groups) {
            const first = group.cats.find(c => cats.has(normCat(c)));
            if (first) { setSelectedCat(first); return; }
          }
          setSelectedCat(null);
          return;
        }

        if (selectedCat && cats.has(normCat(selectedCat))) {
          return;
        }

        for (const group of subtypeItem.groups) {
          const first = group.cats.find(c => cats.has(normCat(c)));
          if (first) { setSelectedCat(first); return; }
        }
        setSelectedCat(null);
      })
      .catch(() => setAvailableCats(null));
  }, [selectedSubtype, dateStr]);

  const fetchKeyRef = React.useRef(null);

  useEffect(() => {
    if (!selectedCat || !subtypeItem || !dateStr) return;
    const fetchKey = `${selectedCat}|${selectedSubtype}|${dateStr}`;
    if (fetchKeyRef.current === fetchKey) return; // already fetching/fetched this combination
    fetchKeyRef.current = fetchKey;
    setLoading(true); setAllFunds([]); setPeerAvg1y(null); setPeerAvg3y(null); setPeerAvg1m(null); setPeerAvg3m(null);
    const ac = subtypeItem.asset_classes[0];
    const catNorm = normCat(selectedCat);
    const mergedConfig = MERGED_CATEGORIES[catNorm] || MERGED_CATEGORIES[selectedCat];
    const fundsUrl = mergedConfig
      ? `${process.env.REACT_APP_API_URL || ''}/api/funds/merged-list?categories=${encodeURIComponent(mergedConfig.sub_cats)}&asset_class=${encodeURIComponent(mergedConfig.asset_class)}&date=${dateStr}`
      : `${process.env.REACT_APP_API_URL || ''}/api/funds/list?asset_class=${encodeURIComponent(ac)}&category=${encodeURIComponent(catNorm)}&date=${dateStr}&all=true`;

    Promise.all([
      fetch(fundsUrl).then(r=>r.json()),
      fetch(`${process.env.REACT_APP_API_URL || ''}/api/performance/peer-avg?category=${encodeURIComponent(catNorm)}&asset_class=${encodeURIComponent(ac)}&date=${dateStr}`).then(r=>r.json()).catch(()=>null),
    ]).then(([fd, pd]) => {
      const funds = fd.funds || [];
      const seen = new Set();
      const unique = funds.filter(f => {
        if (!f.isin || seen.has(f.isin)) return false;
        seen.add(f.isin);
        return true;
      });
      setAllFunds(unique);
      setPeerAvg1y(pd?.peer_avg?.returns?.['1y'] ?? null);
      setPeerAvg3y(pd?.peer_avg?.returns?.['3y'] ?? null);
      setPeerAvg1m(pd?.peer_avg?.returns?.['1m'] ?? null);
      setPeerAvg3m(pd?.peer_avg?.returns?.['3m'] ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [selectedCat, selectedSubtype, dateStr]);

  const isPassiveSubtype = ['passive_index','passive_etf','debt_etf','global','pm_all'].includes(selectedSubtype);

  const hasRankedFunds = useMemo(() => {
    return allFunds.some(f => f.ranking && f.ranking !== '-' && f.ranking !== '0' && ['R1','R2','R3','R4','R5'].includes(f.ranking));
  }, [allFunds]);

  const effectiveWhitelisted = showWhitelisted && !isPassiveSubtype && hasRankedFunds;

  const isSIF = selectedSubtype === 'sif_all';
  const peerAvg  = isSIF
    ? (sortBy === '3m' ? peerAvg3m : peerAvg1m)
    : (sortBy === '3y' ? peerAvg3y : peerAvg1y);
  const sortKey  = isSIF
    ? (sortBy === '3m' ? 'return_3m' : 'return_1m')
    : (sortBy === '3y' ? 'return_3y' : 'return_1y');
  const sortLbl  = isSIF
    ? (sortBy === '3m' ? '3M' : '1M')
    : (sortBy === '3y' ? '3Y' : '1Y');

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/search?q=${encodeURIComponent(searchQuery.trim())}&date=${dateStr}`)
        .then(r => r.json())
        .then(d => {
          setSearchResults(d.funds || []);
          setSearchOpen(true);
          setSearchLoading(false);
        })
        .catch(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, dateStr]);

  // Fetch Investment Intelligence once per date
  useEffect(() => {
    setIntelLoading(true);
    fetch(`${process.env.REACT_APP_API_URL || ''}/api/funds/intelligence?date=${dateStr}`)
      .then(r => r.json())
      .then(d => { setIntelligence(d); setIntelLoading(false); })
      .catch(() => setIntelLoading(false));
  }, [dateStr]);

  const displayFunds = useMemo(() => {
    let funds = [...allFunds];
    if (effectiveWhitelisted) funds = funds.filter(f => f.ranking==='R1' || f.ranking==='R2');
    if (sortBy) {
      funds.sort((a,b) => (parseFloat(b[sortKey])||-999) - (parseFloat(a[sortKey])||-999));
    } else {
      funds.sort((a,b) => {
        const rd = getRankOrder(a.ranking) - getRankOrder(b.ranking);
        if (rd !== 0) return rd;
        return (parseFloat(b.return_1y)||-999) - (parseFloat(a.return_1y)||-999);
      });
    }
    return funds;
  }, [allFunds, showWhitelisted, searchQuery, sortBy, sortKey]);

  const handleFundClick = (fund) => {
    setSelectedFund({ isin:fund.isin, name:fund.name, ranking:fund.ranking, amfi_code:fund.amfi_code, category: fund.category || normCat(selectedCat), assetClass:subtypeItem?.asset_classes[0] });
    navigate('/home');
  };

  const INTEL_TILES = [
    { key:'best',          label:'Best Performers',        icon:'★', color:'var(--brand-primary)' },
    { key:'improving',     label:'Improving Funds',         icon:'↗', color:'#059669' },
    { key:'deteriorating', label:'Deteriorating Funds',     icon:'↘', color:'#DC2626' },
    { key:'hi_risk',       label:'High Risk / High Return', icon:'⚡', color:'#B46B10' },
    { key:'consistent',    label:'Consistent Performers',   icon:'●', color:'#3E3452' },
  ];

  const SIGNAL_NOTE = {
    best:          'Blend of 1Y (40%) + 3Y (40%) + 5Y (20%) percentile ranks within category. Needs min 1Y + 3Y; redistributes to 50/50 if no 5Y.',
    improving:     '6M percentile − 1Y percentile > 35 points within category. Flags funds gaining momentum recently vs their full-year standing.',
    deteriorating: '1Y percentile − 6M percentile > 35 points within category. Flags funds that were stronger over the year but have slipped recently.',
    hi_risk:       'Ranked by 3Y return percentile ÷ std dev percentile within category. Highest return per unit of risk taken.',
    consistent:    'Avg of 1Y + 3Y + 5Y percentiles ≥ 60th, scored by avg − (dispersion × 0.3). Rewards steady performers over lucky ones. Requires all 3 periods.',
  };

  const SIGNAL_METRIC = {
    best:          f => `${f.blend_pctl}th pctl${f.completeness==='partial'?' *':''}`,
    improving:     f => `+${f.momentum} pctl`,
    deteriorating: f => `${f.momentum} pctl`,
    hi_risk:       f => `${f.return_3y?.toFixed(1)}% / σ${f.std_dev_3y?.toFixed(1)}`,
    consistent:    f => `${f.avg_pctl}th pctl avg`,
  };

  const IntelPanel = () => (
    <div style={{ width:280, flexShrink:0, borderLeft:'1px solid var(--border)', paddingLeft:16, paddingTop:4 }}>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--brand-dark)', fontFamily:'var(--font-serif)', marginBottom:2 }}>
          Investment Intelligence
        </div>
        <div style={{ fontSize:10, color:'var(--text-muted)' }}>
          {intelligence ? `${intelligence.pool_size} funds across core equity & hybrid` : 'Loading signals...'}
        </div>
      </div>

      {intelLoading && [1,2,3,4,5].map(i => (
        <div key={i} className="loading-shimmer" style={{ height:48, borderRadius:8, marginBottom:6 }} />
      ))}

      {!intelLoading && INTEL_TILES.map(tile => {
        const signal = intelligence?.signals?.[tile.key];
        const count  = signal?.funds?.length ?? 0;
        const isOpen = intelOpenTile === tile.key;
        const funds  = signal?.funds || [];

        return (
          <div key={tile.key} style={{ marginBottom:6 }}>
            {/* Tile header */}
            <div
              onClick={() => setIntelOpenTile(isOpen ? null : tile.key)}
              style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'9px 12px', borderRadius:8, cursor:'pointer', border:'1px solid',
                borderColor: isOpen ? tile.color : 'var(--border)',
                background: isOpen ? `${tile.color}10` : '#fff',
                transition:'all .15s',
              }}
            >
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <span style={{ fontSize:14, color:tile.color }}>{tile.icon}</span>
                <span style={{ fontSize:11, fontWeight:600, color: isOpen ? tile.color : 'var(--text-primary)' }}>{tile.label}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{
                  fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:10,
                  background: isOpen ? tile.color : 'var(--bg-secondary)',
                  color: isOpen ? '#fff' : 'var(--text-secondary)',
                }}>{count}</span>
                <span style={{ fontSize:10, color:'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}>▼</span>
              </div>
            </div>

            {/* Expanded fund list */}
            {isOpen && (
              <div style={{ border:'1px solid var(--border)', borderTop:'none', borderRadius:'0 0 8px 8px', background:'#fff', maxHeight:320, overflowY:'auto' }}>
                {funds.length === 0 ? (
                  <div style={{ padding:'14px 12px', fontSize:11, color:'var(--text-muted)', textAlign:'center' }}>
                    No funds meet this signal's threshold
                  </div>
                ) : funds.map((f, i) => (
                  <div
                    key={f.isin}
                    onClick={() => handleFundClick(f)}
                    style={{
                      padding:'8px 12px', borderBottom: i < funds.length-1 ? '1px solid var(--border)' : 'none',
                      cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'flex-start',
                      gap:8, transition:'background .1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background='var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}
                  >
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize:9.5, color:'var(--text-muted)', marginTop:1 }}>
                        {f.category?.replace(/^(India Fund |India OE |Cat: )/,'')}
                        {f.ranking && f.ranking !== '0' && <span style={{ marginLeft:5, fontWeight:700, color: (PIP_COLORS[f.ranking] || PIP_COLORS.default) }}>{f.ranking}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize:10.5, fontWeight:700, color:tile.color, flexShrink:0, textAlign:'right' }}>
                      {SIGNAL_METRIC[tile.key]?.(f)}
                    </div>
                  </div>
                ))}
                {tile.key === 'best' && funds.some(f => f.completeness === 'partial') && (
                  <div style={{ padding:'6px 12px', fontSize:9.5, color:'var(--text-muted)', borderTop:'1px solid var(--border)', background:'var(--bg-secondary)' }}>
                    * Score based on 1Y + 3Y only (no 5Y data available)
                  </div>
                )}
                {/* Methodology note at bottom */}
                <div style={{ padding:'7px 12px', background:'var(--bg-secondary)', borderTop:'1px solid var(--border)', fontSize:10, color:'var(--text-muted)', lineHeight:1.5 }}>
                  {SIGNAL_NOTE[tile.key]}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* General methodology note */}
      <div style={{ marginTop:12, padding:'10px 12px', borderRadius:8, background:'var(--bg-secondary)', border:'1px solid var(--border)' }}>
        <div style={{ fontSize:10, color:'var(--text-muted)', lineHeight:1.6 }}>
          <span style={{ fontWeight:600, color:'var(--text-secondary)' }}>How signals work: </span>
          Each fund is ranked within its own category peer group using percentiles (0–100th). Signals are computed separately per category — equity and hybrid only, min 5 funds per category. Top 10 funds across all categories are shown per signal.
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 className="section-title" style={{ marginBottom:2 }}>Fund Explorer</h1>
          <p style={{ fontSize:12, color:'var(--text-muted)' }}>Browse, filter and discover mutual funds</p>
        </div>
        <div style={{ position:'relative' }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false); }}>
          <input
            type="text"
            placeholder="Search any fund, AMC or ISIN..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); }}
            onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
            style={{ padding:'7px 12px 7px 32px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, width:280, outline:'none', background:'#fff', color:'var(--text-primary)' }}
          />
          <svg style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          {searchLoading && <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:10, color:'var(--text-muted)' }}>...</span>}
          {searchOpen && searchResults.length > 0 && (
            <div style={{
              position:'absolute', top:'100%', right:0, width:420, maxHeight:320,
              overflowY:'auto', background:'#fff', border:'1px solid var(--border)',
              borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:1000, marginTop:4,
            }}>
              {searchResults.map((fund, idx) => (
                <div
                  key={fund.isin || fund.amfi_code || `search-${idx}`}
                  tabIndex={0}
                  onClick={() => {
                    setSearchQuery('');
                    setSearchOpen(false);
                    handleFundClick(fund);
                  }}
                  style={{
                    display:'flex', alignItems:'center', gap:10, padding:'9px 14px',
                    borderBottom: idx < searchResults.length-1 ? '1px solid var(--border)' : 'none',
                    cursor:'pointer', transition:'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}
                >
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fund.name}</div>
                    <div style={{ display:'flex', gap:6, marginTop:2 }}>
                      <span style={{ fontSize:10, color:'var(--brand-mid)', background:'rgba(109,84,121,0.08)', padding:'1px 5px', borderRadius:3 }}>
                        {['Cat: India Fund Sector - Precious Metals-Gold','Cat: India Fund Sector - Precious Metals-Silver','India Fund Sector - Precious Metals','India ETF Gold','India ETF Silver'].includes(fund.category) ? 'Precious Metals' : fund.category?.replace(/^(India Fund |India OE |India ETF |Cat: )/,'')}
                      </span>
                    </div>
                  </div>
                  {fund.ranking && fund.ranking !== '-' && fund.ranking !== '0' && (
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:3, background:(RANK_COLORS[fund.ranking]?.bg || 'rgba(45,31,43,0.06)'), color:(RANK_COLORS[fund.ranking]?.color || '#2D1F2B') }}>{fund.ranking}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Two-column layout: main content + intel side panel ── */}
      <div style={{ display:'flex', gap:20, alignItems:'flex-start' }}>

        {/* ── Main content (filters + fund list) ── */}
        <div style={{ flex:1, minWidth:0 }}>

      <div style={{ marginBottom:4 }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', color:'var(--brand-mid)', textTransform:'uppercase', marginBottom:8 }}>Asset Class</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {ASSET_STRUCTURE.map(a => (
            <div key={a.id} onClick={()=>handleAssetChange(a.id)} style={{
              display:'flex', alignItems:'center', gap:7, padding:'7px 14px',
              border:`1.5px solid ${selectedAsset===a.id?'var(--brand-primary)':'var(--border)'}`,
              borderRadius:8, cursor:'pointer',
              background: selectedAsset===a.id ? 'rgba(145,47,99,0.06)' : '#fff',
              transition:'all .15s',
            }}>
              <span style={{ fontSize:15 }}>{a.icon}</span>
              <span style={{ fontSize:12, fontWeight:600, color: selectedAsset===a.id ? 'var(--brand-primary)' : 'var(--text-primary)' }}>{a.label}</span>
            </div>
          ))}
        </div>
      </div>

      {assetItem?.subtypes.length > 1 && (
        <div style={{ margin:'12px 0 0' }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', color:'var(--brand-mid)', textTransform:'uppercase', marginBottom:7 }}>Fund Type</div>
          <div style={{ display:'flex', gap:6 }}>
            {assetItem.subtypes.map(s => (
              <button key={s.id} onClick={()=>handleSubtypeChange(s.id)} style={{
                padding:'5px 13px', borderRadius:20, border:'1px solid',
                borderColor: selectedSubtype===s.id ? 'var(--brand-primary)' : 'var(--border)',
                background: selectedSubtype===s.id ? 'var(--brand-primary)' : 'transparent',
                color: selectedSubtype===s.id ? '#fff' : 'var(--text-secondary)',
                fontSize:12, fontWeight:500, cursor:'pointer', transition:'all .15s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>
      )}

      {subtypeItem && (
        <div style={{ margin:'12px 0 0' }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', color:'var(--brand-mid)', textTransform:'uppercase', marginBottom:8 }}>Category</div>
          {subtypeItem.groups.filter(group => {
            if (!availableCats || availableCatsSubtype !== selectedSubtype) return false;
            return group.cats.some(c => availableCats.has(normCat(c)) || MERGED_CATEGORIES[c]);
          }).map(group => (
            <div key={group.label} style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5 }}>{group.label}</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {group.cats.filter(cat => availableCats && availableCatsSubtype === selectedSubtype && (availableCats.has(normCat(cat)) || MERGED_CATEGORIES[cat])).map(cat => {
                  const sel = selectedCat===cat;
                  return (
                    <div key={cat} onClick={()=>{ fetchKeyRef.current = null; setSelectedCat(cat); }} style={{
                      display:'flex', alignItems:'center', gap:7, padding:'5px 11px',
                      border:`1.5px solid ${sel?'var(--brand-primary)':'var(--border)'}`,
                      borderRadius:6, cursor:'pointer',
                      background: sel ? 'rgba(145,47,99,0.05)' : '#fff',
                      transition:'all .12s', fontSize:12,
                      color: sel ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      fontWeight: sel ? 600 : 400,
                    }}>
                      {CAT_LABEL_OVERRIDE[cat] || cleanLabel(cat)}
                      <span style={{ width:14, height:14, borderRadius:'50%', border:`1.5px solid ${sel?'var(--brand-primary)':'#ccc'}`, background:sel?'var(--brand-primary)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        {sel && <span style={{ width:5, height:5, borderRadius:'50%', background:'#fff' }} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', margin:'14px 0 0', padding:'9px 14px', background:'var(--bg-secondary)', borderRadius:8, border:'1px solid var(--border)' }}>
        <div style={{ display:'flex', gap:6 }}>
          {(() => {
            const noRankSubtypes = ['passive_index','passive_etf','debt_etf','global','pm_all'];
            const isPassive = noRankSubtypes.includes(subtypeItem?.id) || !hasRankedFunds;
            if (isPassive) {
              return <span style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>All funds shown</span>;
            }
            return [{ val:true, label:'★ Whitelisted' },{ val:false, label:'All Funds' }].map(({val,label})=>(
              <button key={String(val)} onClick={()=>setShowWhitelisted(val)} style={{
                padding:'4px 12px', borderRadius:20, border:'1px solid',
                borderColor: showWhitelisted===val ? 'var(--brand-primary)' : 'var(--border)',
                background: showWhitelisted===val ? 'var(--brand-primary)' : 'transparent',
                color: showWhitelisted===val ? '#fff' : 'var(--text-secondary)',
                fontSize:11, fontWeight:600, cursor:'pointer',
              }}>{label}</button>
            ));
          })()}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>Sort by</span>
          {(isSIF ? [{val:'1m',label:'1M Return'},{val:'3m',label:'3M Return'}] : [{val:'1y',label:'1Y Return'},{val:'3y',label:'3Y Return'}]).map(({val,label})=>(
            <button key={val} onClick={()=>setSortBy(sortBy===val?null:val)} style={{
              padding:'3px 10px', borderRadius:4, border:'1px solid',
              borderColor: sortBy===val ? 'var(--brand-primary)' : 'var(--border)',
              background: sortBy===val ? 'var(--brand-primary)' : 'transparent',
              color: sortBy===val ? '#fff' : 'var(--text-muted)',
              fontSize:11, fontWeight:600, cursor:'pointer',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {selectedCat && peerAvg != null && peerAvg !== '-' && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 14px', background:'rgba(145,47,99,0.04)', border:'1px solid rgba(145,47,99,0.12)', borderRadius:6, margin:'8px 0 0' }}>
          <span style={{ fontSize:12, color:'var(--brand-mid)', fontWeight:600 }}>
            Category avg {sortLbl}: {parseFloat(peerAvg)>=0?'+':''}{parseFloat(peerAvg).toFixed(2)}%
          </span>
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>
            {displayFunds.length} fund{displayFunds.length!==1?'s':''}
            {sortBy && <span style={{ marginLeft:8, color:'var(--brand-mid)' }}>· Sorted by {sortLbl} return ↓</span>}
          </span>
        </div>
      )}

      <div style={{ marginTop:8, border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', background:'#fff', boxShadow:'var(--shadow-card)' }}>
        {loading && [1,2,3,4,5].map(i=>(
          <div key={i} className="loading-shimmer" style={{ height:62, margin:'1px 0' }}/>
        ))}

        {!loading && displayFunds.length===0 && selectedCat && (
          <div style={{ padding:'36px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
            No funds found for this selection.
          </div>
        )}

        {!loading && displayFunds.map((fund, idx) => {
          const ret    = fund[sortKey];
          const retNum = ret != null && ret !== '-' ? parseFloat(ret) : null;
          const above  = retNum != null && peerAvg != null && peerAvg !== '-' ? retNum >= parseFloat(peerAvg) : null;
          const pipColor = PIP_COLORS[fund.ranking] || PIP_COLORS.default;
          const PRECIOUS_METALS_CATS = [
            'Cat: India Fund Sector - Precious Metals-Gold',
            'Cat: India Fund Sector - Precious Metals-Silver',
            'India Fund Sector - Precious Metals',
            'India ETF Gold',
            'India ETF Silver',
          ];
          const catDisplay = PRECIOUS_METALS_CATS.includes(selectedCat) ? 'Precious Metals' : cleanLabel(selectedCat || '');

          return (
            <div key={`${fund.isin || fund.amfi_code || fund.name || 'fund'}-${idx}`}
              onClick={()=>handleFundClick(fund)}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 16px', borderBottom: idx<displayFunds.length-1 ? '1px solid var(--border)' : 'none', cursor:'pointer', transition:'background .1s' }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--bg-secondary)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            >
              <div style={{ width:3, height:44, borderRadius:2, background:pipColor, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:3 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:380 }}>{fund.name}</span>
                  <RankBadge ranking={fund.ranking} />
                  {fund.sub_label && (
                    <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:3, background:'rgba(109,84,121,0.1)', color:'var(--brand-mid)', flexShrink:0 }}>{fund.sub_label}</span>
                  )}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>{fund.isin}</span>
                  <span style={{ fontSize:10, color:'var(--brand-mid)', background:'rgba(109,84,121,0.08)', padding:'1px 6px', borderRadius:3 }}>{catDisplay}</span>
                </div>
              </div>
              {above !== null && (
                <span style={{
                  fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20, flexShrink:0,
                  background: above ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                  color: above ? '#10B981' : '#EF4444',
                  border: `1px solid ${above?'rgba(16,185,129,0.2)':'rgba(239,68,68,0.2)'}`,
                }}>
                  {above ? '↑ above avg' : '↓ below avg'}
                </span>
              )}
              <div style={{ textAlign:'right', flexShrink:0, minWidth:64 }}>
                {retNum != null ? (
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color: retNum>=0 ? '#10B981' : '#EF4444' }}>
                    {retNum>=0?'+':''}{retNum.toFixed(2)}%
                  </div>
                ) : <div style={{ fontSize:13, color:'var(--text-muted)' }}>—</div>}
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>{sortLbl} return</div>
              </div>
            </div>
          );
        })}
      </div>

        </div>{/* end main content */}

        {/* ── Intelligence side panel ── */}
        <IntelPanel />

      </div>{/* end two-column layout */}
    </div>
  );
}