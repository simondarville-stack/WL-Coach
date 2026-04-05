import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line,
} from 'recharts';
import type { PlannedExercise, Exercise, AthletePR } from '../../lib/database.types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface LoadDistributionProps {
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  athletePRs: AthletePR[];
  dayLabels: Record<number, string>;
  activeDays: number[];
  dayDisplayOrder: number[];
  daySchedule: Record<number, { weekday: number; time: string | null }> | null;
}

interface DayData {
  day: string;
  dayIndex: number;
  load: number;
  reps: number;
  stress: number;
  isRest?: boolean;
}

function computeDayStats(
  slots: number[],
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>,
  prMap: Map<string, number>,
): { load: number; reps: number; stress: number } {
  let load = 0, reps = 0, stress = 0;
  slots.forEach(index => {
    (plannedExercises[index] || []).forEach(ex => {
      const r = ex.summary_total_reps || 0;
      const avg = ex.summary_avg_load || 0;
      reps += r;
      if (ex.unit === 'absolute_kg' && avg > 0) {
        load += avg * r;
        const pr = prMap.get(ex.exercise_id);
        if (pr && pr > 0 && r > 0) stress += r * Math.pow(avg / pr, 2);
      }
    });
  });
  return { load: Math.round(load), reps, stress: Math.round(stress * 10) / 10 };
}

function calculateStressCurve(chartData: DayData[]): number[] {
  const DECAY = 0.35;
  let acc = 0;
  return chartData.map(d => {
    if (d.isRest) acc *= (1 - DECAY);
    else acc += d.stress;
    return Math.round(acc * 10) / 10;
  });
}

export function LoadDistribution({
  plannedExercises,
  athletePRs,
  dayLabels,
  activeDays,
  dayDisplayOrder,
  daySchedule,
}: LoadDistributionProps) {
  const [showStressCurve, setShowStressCurve] = useState(false);

  const isCalendarMapped = !!daySchedule && Object.keys(daySchedule).length > 0;

  const distributionData = useMemo(() => {
    const prMap = new Map<string, number>();
    athletePRs.forEach(pr => { if (pr.pr_value_kg) prMap.set(pr.exercise_id, pr.pr_value_kg); });

    if (isCalendarMapped && daySchedule) {
      // Build 7-column calendar data
      return WEEKDAYS.map((name, wd): DayData => {
        const slots = Object.entries(daySchedule)
          .filter(([, e]) => e.weekday === wd && activeDays.includes(Number(Object.keys(daySchedule).find(k => daySchedule[Number(k)] === e) ?? -1)))
          .map(([slot]) => Number(slot))
          .filter(s => activeDays.includes(s));
        if (slots.length === 0) return { day: name, dayIndex: -1, load: 0, reps: 0, stress: 0, isRest: true };
        const stats = computeDayStats(slots, plannedExercises, prMap);
        return { day: name, dayIndex: slots[0], ...stats, isRest: false };
      });
    }

    // Abstract mode
    const visibleDays = dayDisplayOrder
      .filter(d => activeDays.includes(d))
      .map(d => ({ index: d, name: dayLabels[d] || `Day ${d}` }));
    return visibleDays.map(({ index, name }): DayData => {
      const stats = computeDayStats([index], plannedExercises, prMap);
      return { day: name, dayIndex: index, ...stats };
    });
  }, [plannedExercises, athletePRs, dayLabels, activeDays, dayDisplayOrder, daySchedule, isCalendarMapped]);

  const stressCurve = useMemo(
    () => showStressCurve ? calculateStressCurve(distributionData) : [],
    [distributionData, showStressCurve],
  );

  const chartDataWithCurve = distributionData.map((d, i) => ({
    ...d,
    stressCurve: showStressCurve ? stressCurve[i] : undefined,
  }));

  const chartProps = {
    cartesianGrid: { strokeDasharray: '3 3', stroke: '#e5e7eb' },
    xAxis: { dataKey: 'day', tick: { fontSize: 11 }, stroke: '#6b7280', interval: 0, angle: -35, textAnchor: 'end' as const, height: 70 },
    yAxis: { domain: [0, 'auto'] as [number, string], tickCount: 5, tick: { fontSize: 11 }, stroke: '#6b7280', width: 48 },
    tooltip: { contentStyle: { fontSize: 12 } },
  };

  // In calendar mode, dim rest-day bars (value 0) — handled by showing nothing
  const getBarFill = (entry: DayData, color: string) => entry.isRest ? 'transparent' : color;

  return (
    <div className="bg-white border-t border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700">Weekly Load Distribution</h3>
        {isCalendarMapped && (
          <button
            onClick={() => setShowStressCurve(s => !s)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              showStressCurve ? 'bg-red-50 text-red-600 border-red-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {showStressCurve ? 'Hide' : 'Show'} stress curve
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Load */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Load by Day (kg)</h4>
          <ResponsiveContainer width="100%" height={180}>
            {showStressCurve ? (
              <ComposedChart data={chartDataWithCurve}>
                <CartesianGrid {...chartProps.cartesianGrid} />
                <XAxis {...chartProps.xAxis} />
                <YAxis {...chartProps.yAxis} yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#f87171" width={36} />
                <Tooltip {...chartProps.tooltip} formatter={(v: number, n: string) => [`${Math.round(v)} ${n === 'stressCurve' ? '' : 'kg'}`, n === 'stressCurve' ? 'Stress acc.' : 'Load']} />
                <Bar yAxisId="left" dataKey="load" fill="#3b82f6" />
                <Line yAxisId="right" type="monotone" dataKey="stressCurve" stroke="#f87171" strokeWidth={2} dot={false} />
              </ComposedChart>
            ) : (
              <BarChart data={distributionData}>
                <CartesianGrid {...chartProps.cartesianGrid} />
                <XAxis {...chartProps.xAxis} />
                <YAxis {...chartProps.yAxis} />
                <Tooltip {...chartProps.tooltip} formatter={(v: number) => `${Math.round(v)} kg`} />
                <Bar dataKey="load" fill="#3b82f6" />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Reps */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Reps by Day</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={distributionData}>
              <CartesianGrid {...chartProps.cartesianGrid} />
              <XAxis {...chartProps.xAxis} />
              <YAxis {...chartProps.yAxis} />
              <Tooltip {...chartProps.tooltip} formatter={(v: number) => `${v} reps`} />
              <Bar dataKey="reps" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stress */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Stress by Day</h4>
          <ResponsiveContainer width="100%" height={180}>
            {showStressCurve ? (
              <ComposedChart data={chartDataWithCurve}>
                <CartesianGrid {...chartProps.cartesianGrid} />
                <XAxis {...chartProps.xAxis} />
                <YAxis {...chartProps.yAxis} yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#f87171" width={36} />
                <Tooltip {...chartProps.tooltip} formatter={(v: number, n: string) => [v.toFixed(1), n === 'stressCurve' ? 'Stress acc.' : 'Stress']} />
                <Bar yAxisId="left" dataKey="stress" fill="#f59e0b" />
                <Line yAxisId="right" type="monotone" dataKey="stressCurve" stroke="#f87171" strokeWidth={2} dot={false} />
              </ComposedChart>
            ) : (
              <BarChart data={distributionData}>
                <CartesianGrid {...chartProps.cartesianGrid} />
                <XAxis {...chartProps.xAxis} />
                <YAxis {...chartProps.yAxis} />
                <Tooltip {...chartProps.tooltip} formatter={(v: number) => v.toFixed(1)} />
                <Bar dataKey="stress" fill="#f59e0b" />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mt-3 text-[10px] text-gray-400 space-y-0.5">
        <p><strong>Load:</strong> sum(avg_load × reps) for kg-based exercises{isCalendarMapped ? ' · Rest days shown as empty columns' : ''}</p>
        <p><strong>Stress:</strong> sum(reps × (load/PR)²) — requires athlete PRs</p>
      </div>
    </div>
  );
}
