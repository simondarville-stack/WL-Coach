// Renders an AnalysisResult per viz.type using Recharts (line/bar/stacked/
// grouped/scatter/radar). Heatmap is a CSS grid (no new charting dep). The
// component reads only the chart model from vizAdapter — never raw facts.

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { AnalysisResult, VizType } from '../../../lib/analysis';
import { toChartModel, mergeCompare, isGhostSeries } from './vizAdapter';
import { HeatmapGrid } from './HeatmapGrid';
import { formatValue } from './format';

interface ResultChartProps {
  result: AnalysisResult;
  type: VizType;
  /** Previous-period result for the ghost overlay (line/bar). */
  compare?: AnalysisResult | null;
}

const axisTick = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-tertiary)' };
const HEIGHT = 440;

export function ResultChart({ result, type, compare }: ResultChartProps) {
  if (type === 'heatmap') return <HeatmapGrid result={result} />;

  let model = toChartModel(result);
  if (compare && (type === 'line' || type === 'bar' || type === 'groupedBar' || type === 'stackedBar')) {
    model = mergeCompare(model, toChartModel(compare));
  }
  if (model.data.length === 0 || model.series.length === 0) {
    return <Empty label="No data to chart in this scope." />;
  }

  const tooltipStyle = {
    background: 'var(--color-bg-primary)',
    border: '0.5px solid var(--color-border-secondary)',
    borderRadius: 'var(--radius-md)',
    fontSize: 12,
    fontFamily: 'var(--font-sans)',
  };
  const fmt = (v: number | string | undefined): string =>
    typeof v === 'number' ? formatValue(v, model.series[0]?.unit ?? '') : v == null ? '—' : String(v);

  if (type === 'scatter') {
    if (model.series.length < 2) return <Empty label="Scatter needs at least two measures (X and Y)." />;
    const [sx, sy] = model.series;
    const points = model.data.map((d) => ({ name: d.x, x: d[sx.key], y: d[sy.key] }));
    return (
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--color-border-tertiary)" />
            <XAxis type="number" dataKey="x" name={sx.label} tick={axisTick} stroke="var(--color-border-secondary)" />
            <YAxis type="number" dataKey="y" name={sy.label} tick={axisTick} stroke="var(--color-border-secondary)" />
            <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={points} fill={sx.color} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'radar') {
    return (
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={model.data} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
            <PolarGrid stroke="var(--color-border-tertiary)" />
            <PolarAngleAxis dataKey="x" tick={axisTick} />
            <PolarRadiusAxis tick={axisTick} stroke="var(--color-border-tertiary)" />
            {model.series.map((s) => (
              <Radar key={s.key} name={s.label} dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.25} />
            ))}
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-sans)' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'line') {
    return (
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={model.data} margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--color-border-tertiary)" vertical={false} />
            <XAxis dataKey="x" tick={axisTick} stroke="var(--color-border-secondary)" />
            <YAxis tick={axisTick} stroke="var(--color-border-secondary)" width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={fmt} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-sans)' }} />
            {model.series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} strokeDasharray={s.state === 'planned' ? '5 4' : isGhostSeries(s.key) ? '2 3' : undefined} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // bar / stackedBar / groupedBar
  const stacked = type === 'stackedBar';
  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={model.data} margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
          <CartesianGrid stroke="var(--color-border-tertiary)" vertical={false} />
          <XAxis dataKey="x" tick={axisTick} stroke="var(--color-border-secondary)" />
          <YAxis tick={axisTick} stroke="var(--color-border-secondary)" width={56} />
          <Tooltip contentStyle={tooltipStyle} formatter={fmt} cursor={{ fill: 'var(--color-accent-muted)' }} />
          <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-sans)' }} />
          {model.series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} fillOpacity={isGhostSeries(s.key) ? 0.4 : 1} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-body)' }}>
      {label}
    </div>
  );
}
