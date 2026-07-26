import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface HistoryEntry {
  date: string;
  value: number;
  leagueType: string;
}

interface ValueChartProps {
  history: HistoryEntry[];
  leagueType: string;
}

const CHART_COLORS = {
  line: '#e8a525',
  grid: '#2a3545',
  axis: '#6b7a8d',
  bg: '#111720',
  tooltipBorder: '#2a3545',
  ink: '#c5cdd9',
};

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${m}/${d}`;
}

export default function ValueChart({ history, leagueType }: ValueChartProps) {
  // Filter to selected league type and sort chronologically
  const data = history
    .filter(h => h.leagueType === leagueType)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(h => ({ date: h.date, value: h.value }));

  if (data.length < 2) {
    return (
      <div className="chart-empty">
        {data.length === 0
          ? 'No history yet — values are recorded daily.'
          : 'Chart available once more history accumulates.'}
      </div>
    );
  }

  // Compute Y domain with padding
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, 1);
  const yMin = Math.max(0, Math.floor(min - pad));
  const yMax = Math.min(100, Math.ceil(max + pad));

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid
            stroke={CHART_COLORS.grid}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: CHART_COLORS.axis, fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: CHART_COLORS.axis, fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{
              background: CHART_COLORS.bg,
              border: `2px solid ${CHART_COLORS.tooltipBorder}`,
              borderRadius: 2,
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 12,
              color: CHART_COLORS.ink,
            }}
            labelFormatter={(label) => String(label)}
            formatter={(val) => [Number(val).toFixed(1), 'Value']}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS.line}
            strokeWidth={2}
            dot={data.length <= 30}
            activeDot={{ r: 4, fill: CHART_COLORS.line, stroke: CHART_COLORS.bg, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
