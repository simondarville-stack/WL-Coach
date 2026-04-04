import { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { fetchWeeklyAggregates, type WeeklyAggregate } from '../../hooks/useAnalysis';
import { supabase } from '../../lib/supabase';

interface Props {
  athleteId: string;
  startDate: string;
  endDate: string;
}

type XAxisType = 'week' | 'weekNumber';
type PrimaryMetric =
  | 'plannedTonnage' | 'performedTonnage'
  | 'plannedReps' | 'performedReps'
  | 'plannedSets' | 'performedSets'
  | 'complianceReps' | 'sessionRpe' | 'rawTotal';
type OverlayMetric = 'none' | 'bodyweight' | 'performedTonnage' | 'performedReps' | 'complianceReps' | 'rawTotal' | 'sessionRpe';

const X_AXIS_OPTIONS: { id: XAxisType; label: string }[] = [
  { id: 'week', label: 'Week (date)' },
  { id: 'weekNumber', label: 'Macro week #' },
];

const PRIMARY_OPTIONS: { id: PrimaryMetric; label: string; unit: string }[] = [
  { id: 'performedTonnage', label: 'Total tonnage (performed)', unit: 'kg' },
  { id: 'plannedTonnage', label: 'Total tonnage (planned)', unit: 'kg' },
  { id: 'performedReps', label: 'Total reps (performed)', unit: 'reps' },
  { id: 'plannedReps', label: 'Total reps (planned)', unit: 'reps' },
  { id: 'performedSets', label: 'Total sets (performed)', unit: 'sets' },
  { id: 'plannedSets', label: 'Total sets (planned)', unit: 'sets' },
  { id: 'complianceReps', label: 'Compliance %', unit: '%' },
  { id: 'sessionRpe', label: 'Session RPE', unit: '' },
  { id: 'rawTotal', label: 'RAW readiness total', unit: '' },
];

const OVERLAY_OPTIONS: { id: OverlayMetric; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'performedTonnage', label: 'Total tonnage' },
  { id: 'performedReps', label: 'Total reps' },
  { id: 'complianceReps', label: 'Compliance %' },
  { id: 'rawTotal', label: 'RAW readiness' },
  { id: 'sessionRpe', label: 'Session RPE' },
];

const COMPLIANCE_COLOR_PRESETS = ['All', 'Snatch', 'Clean & jerk', 'Back squat', 'Front squat', 'Pulls'];
const CATEGORY_PRESETS = ['All', 'Classical', 'Squats', 'Pulls', 'Accessories'];

function formatWeekLabel(ws: string) {
  const d = new Date(ws);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function getValue(agg: WeeklyAggregate, metric: PrimaryMetric | OverlayMetric): number | null {
  if (metric === 'none') return null;
  if (metric === 'bodyweight') return agg.avgBodyweight;
  return (agg as unknown as Record<string, number | null>)[metric] ?? null;
}

function getBarColor(agg: WeeklyAggregate, primary: PrimaryMetric): string {
  if (primary === 'complianceReps') {
    const v = agg.complianceReps;
    if (v >= 95) return '#1D9E75';
    if (v >= 85) return '#378ADD';
    if (v >= 75) return '#EF9F27';
    return '#E24B4A';
  }
  return agg.phaseColor ?? '#378ADD';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-md text-[12px]">
      <div className="font-medium text-gray-700 mb-1">{label}</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ color: p.color }} className="flex gap-2">
          <span>{p.name}:</span>
          <span className="font-medium">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PivotBuilder({ athleteId, startDate, endDate }: Props) {
  const [xAxis, setXAxis] = useState<XAxisType>('week');
  const [primaryMetric, setPrimaryMetric] = useState<PrimaryMetric>('performedReps');
  const [overlayMetric, setOverlayMetric] = useState<OverlayMetric>('none');
  const [exerciseFilter, setExerciseFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [aggregates, setAggregates] = useState<WeeklyAggregate[]>([]);
  const [loading, setLoading] = useState(false);
  const [exercises, setExercises] = useState<Array<{ id: string; name: string; category: string }>>([]);

  // Load exercise list once
  useEffect(() => {
    supabase.from('exercises').select('id, name, category').then(({ data }) => {
      if (data) setExercises(data as typeof exercises);
    });
  }, []);

  const load = useCallback(async () => {
    if (!athleteId) return;
    setLoading(true);
    try {
      // Build exercise/category filters
      const exFilter: string[] = [];
      const catFilter: string[] = [];

      if (exerciseFilter !== 'All') {
        // Find matching exercise IDs by name pattern
        const patterns: Record<string, string[]> = {
          'Snatch': ['snatch'],
          'Clean & jerk': ['clean', 'jerk'],
          'Back squat': ['back squat'],
          'Front squat': ['front squat'],
          'Pulls': ['pull'],
        };
        const p = patterns[exerciseFilter];
        if (p) {
          exercises.forEach(ex => {
            const n = ex.name.toLowerCase();
            if (p.every(word => n.includes(word))) exFilter.push(ex.id);
          });
        }
      }

      if (categoryFilter !== 'All') {
        catFilter.push(categoryFilter);
      }

      const data = await fetchWeeklyAggregates({
        athleteId,
        startDate,
        endDate,
        exerciseFilter: exFilter,
        categoryFilter: catFilter,
      });
      setAggregates(data);
    } finally {
      setLoading(false);
    }
  }, [athleteId, startDate, endDate, exerciseFilter, categoryFilter, exercises]);

  useEffect(() => { load(); }, [load]);

  // Build chart data
  const chartData = aggregates.map(agg => {
    const xLabel = xAxis === 'week' ? formatWeekLabel(agg.weekStart) : `W${agg.weekNumber || '?'}`;
    const primary = getValue(agg, primaryMetric);
    const overlay = overlayMetric !== 'none' ? getValue(agg, overlayMetric) : undefined;
    return {
      x: xLabel,
      primary: primary ?? 0,
      overlay: overlay ?? null,
      barColor: getBarColor(agg, primaryMetric),
      weekStart: agg.weekStart,
      phaseName: agg.phaseName,
    };
  });

  // Summary metrics
  const nonZero = chartData.filter(d => d.primary > 0);
  const avg = nonZero.length > 0 ? nonZero.reduce((s, d) => s + d.primary, 0) / nonZero.length : 0;
  const total = chartData.reduce((s, d) => s + d.primary, 0);
  const half = Math.floor(chartData.length / 2);
  const firstHalf = chartData.slice(0, half).reduce((s, d) => s + d.primary, 0);
  const secondHalf = chartData.slice(half).reduce((s, d) => s + d.primary, 0);
  const delta = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;
  const overlayAvg = overlayMetric !== 'none' && nonZero.length > 0
    ? nonZero.reduce((s, d) => s + (d.overlay ?? 0), 0) / nonZero.length
    : null;

  const primaryLabel = PRIMARY_OPTIONS.find(o => o.id === primaryMetric)?.label ?? '';
  const primaryUnit = PRIMARY_OPTIONS.find(o => o.id === primaryMetric)?.unit ?? '';

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium">X axis</span>
          <select
            value={xAxis}
            onChange={e => setXAxis(e.target.value as XAxisType)}
            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
          >
            {X_AXIS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium">Primary metric</span>
          <select
            value={primaryMetric}
            onChange={e => setPrimaryMetric(e.target.value as PrimaryMetric)}
            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
          >
            {PRIMARY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium">Overlay</span>
          <select
            value={overlayMetric}
            onChange={e => setOverlayMetric(e.target.value as OverlayMetric)}
            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
          >
            {OVERLAY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium self-center">Exercise</span>
        {COMPLIANCE_COLOR_PRESETS.map(f => (
          <button
            key={f}
            onClick={() => setExerciseFilter(f)}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
              exerciseFilter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium self-center">Category</span>
        {CATEGORY_PRESETS.map(f => (
          <button
            key={f}
            onClick={() => setCategoryFilter(f)}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
              categoryFilter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Period average', value: avg.toFixed(1), unit: primaryUnit },
          { label: 'Period total', value: total.toFixed(0), unit: primaryUnit },
          {
            label: 'vs previous half',
            value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
            unit: '',
            colored: true,
            positive: delta >= 0,
          },
          overlayMetric !== 'none' && overlayAvg != null
            ? { label: `${OVERLAY_OPTIONS.find(o => o.id === overlayMetric)?.label} avg`, value: overlayAvg.toFixed(1), unit: '' }
            : null,
        ].map((card, i) =>
          card ? (
            <div key={i} className="bg-gray-50 rounded-lg py-2 px-4 border border-gray-100">
              <div className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-1">{card.label}</div>
              <div className={`text-xl font-medium ${(card as { colored?: boolean; positive?: boolean }).colored ? ((card as { positive?: boolean }).positive ? 'text-green-600' : 'text-red-500') : 'text-gray-900'}`}>
                {card.value}
                {card.unit && <span className="text-sm text-gray-400 ml-1">{card.unit}</span>}
              </div>
            </div>
          ) : (
            <div key={i} className="bg-gray-50 rounded-lg py-2 px-4 border border-gray-100 opacity-30">
              <div className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-1">Overlay avg</div>
              <div className="text-xl font-medium text-gray-300">—</div>
            </div>
          )
        )}
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          No training data found for this period. Try selecting a longer date range.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 4, right: overlayMetric !== 'none' ? 48 : 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={48} />
              {overlayMetric !== 'none' && (
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="left"
                dataKey="primary"
                name={primaryLabel}
                fill="#378ADD"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              {overlayMetric !== 'none' && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="overlay"
                  name={OVERLAY_OPTIONS.find(o => o.id === overlayMetric)?.label ?? overlayMetric}
                  stroke="#EF9F27"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
