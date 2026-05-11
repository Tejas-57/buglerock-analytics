import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './PieCharts.css';

const MARKET_CAP_COLORS = ['#C9A84C', '#E2B96F', '#9a7a30'];
const ASSET_COLORS = ['#10B981', '#60A5FA', '#F59E0B', '#9CA3AF'];

const RADIAN = Math.PI / 180;
function CustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#08091A" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-name">{payload[0].name}</div>
      <div className="tt-value">{payload[0].value?.toFixed(2)}%</div>
    </div>
  );
}

function PieSection({ title, data, colors }) {
  const filtered = data.filter(d => d.value > 0);
  if (!filtered.length) return (
    <div className="pie-section card">
      <div className="section-subtitle">{title}</div>
      <div className="no-data-sm">No data available</div>
    </div>
  );
  return (
    <div className="pie-section card">
      <div className="section-subtitle">{title}</div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={filtered}
            cx="50%"
            cy="50%"
            outerRadius={90}
            dataKey="value"
            labelLine={false}
            label={<CustomLabel />}
          >
            {filtered.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(v) => <span style={{color:'var(--text-secondary)',fontSize:'12px'}}>{v}</span>}
            wrapperStyle={{paddingTop:'8px'}}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PieCharts({ data }) {
  if (!data) return null;

  const marketCapData = [
    { name: 'Large Cap', value: data.large_cap ?? 0 },
    { name: 'Mid Cap',   value: data.mid_cap ?? 0 },
    { name: 'Small Cap', value: data.small_cap ?? 0 },
  ];

  const assetData = [
    { name: 'Equity', value: data.equity_pct ?? 0 },
    { name: 'Debt',   value: data.bond_pct ?? 0 },
    { name: 'Cash',   value: data.cash_pct ?? 0 },
    { name: 'Other',  value: data.other_pct ?? 0 },
  ];

  return (
    <div className="pie-charts-row">
      <PieSection title="Market Cap Exposure" data={marketCapData} colors={MARKET_CAP_COLORS} />
      <PieSection title="Asset Class Exposure" data={assetData} colors={ASSET_COLORS} />
    </div>
  );
}
