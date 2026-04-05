import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { PlannedExercise, Exercise, AthletePR } from '../../lib/database.types';

interface LoadDistributionProps {
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  athletePRs: AthletePR[];
  dayLabels: Record<number, string>;
  activeDays: number[];
  dayDisplayOrder: number[];
}

interface DayData {
  day: string;
  dayIndex: number;
  load: number;
  reps: number;
  stress: number;
}

export function LoadDistribution({
  plannedExercises,
  athletePRs,
  dayLabels,
  activeDays,
  dayDisplayOrder,
}: LoadDistributionProps) {
  const distributionData = useMemo(() => {
    const prMap = new Map<string, number>();
    athletePRs.forEach(pr => {
      if (pr.pr_value_kg) prMap.set(pr.exercise_id, pr.pr_value_kg);
    });

    const visibleDays = dayDisplayOrder
      .filter(dayIndex => activeDays.includes(dayIndex))
      .map(dayIndex => ({ index: dayIndex, name: dayLabels[dayIndex] || `Day ${dayIndex}` }));

    return visibleDays.map(({ index, name }): DayData => {
      let dailyLoad = 0;
      let dailyReps = 0;
      let dailyStress = 0;
      (plannedExercises[index] || []).forEach(plannedEx => {
        const totalReps = plannedEx.summary_total_reps || 0;
        const avgLoad = plannedEx.summary_avg_load || 0;
        dailyReps += totalReps;
        if (plannedEx.unit === 'absolute_kg' && avgLoad > 0) {
          dailyLoad += avgLoad * totalReps;
          const pr = prMap.get(plannedEx.exercise_id);
          if (pr && pr > 0 && totalReps > 0) {
            dailyStress += totalReps * Math.pow(avgLoad / pr, 2);
          }
        }
      });
      return { day: name, dayIndex: index, load: Math.round(dailyLoad), reps: dailyReps, stress: Math.round(dailyStress * 10) / 10 };
    });
  }, [plannedExercises, athletePRs, dayLabels, activeDays, dayDisplayOrder]);

  const chartProps = {
    cartesianGrid: { strokeDasharray: '3 3', stroke: '#e5e7eb' },
    xAxis: { dataKey: 'day', tick: { fontSize: 11 }, stroke: '#6b7280', interval: 0, angle: -35, textAnchor: 'end' as const, height: 70 },
    yAxis: { domain: [0, 'auto'] as [number, string], tickCount: 5, tick: { fontSize: 11 }, stroke: '#6b7280', width: 48 },
    tooltip: { contentStyle: { fontSize: 12 } },
  };

  return (
    <div className="bg-white border-t border-gray-200 p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Weekly Load Distribution</h3>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Load by Day (kg)</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={distributionData}>
              <CartesianGrid {...chartProps.cartesianGrid} />
              <XAxis {...chartProps.xAxis} />
              <YAxis {...chartProps.yAxis} />
              <Tooltip {...chartProps.tooltip} formatter={(v: number) => `${Math.round(v)} kg`} />
              <Bar dataKey="load" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Stress by Day</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={distributionData}>
              <CartesianGrid {...chartProps.cartesianGrid} />
              <XAxis {...chartProps.xAxis} />
              <YAxis {...chartProps.yAxis} />
              <Tooltip {...chartProps.tooltip} formatter={(v: number) => v.toFixed(1)} />
              <Bar dataKey="stress" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mt-3 text-[10px] text-gray-400 space-y-0.5">
        <p><strong>Load:</strong> sum(avg_load × reps) for kg-based exercises</p>
        <p><strong>Stress:</strong> sum(reps × (load/PR)²) — requires athlete PRs</p>
      </div>
    </div>
  );
}
