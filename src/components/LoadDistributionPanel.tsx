import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { PlannedExercise, Exercise, AthletePR } from '../lib/database.types';

interface LoadDistributionPanelProps {
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

export function LoadDistributionPanel({
  plannedExercises,
  athletePRs,
  dayLabels,
  activeDays,
  dayDisplayOrder,
}: LoadDistributionPanelProps) {
  const distributionData = useMemo(() => {
    const prMap = new Map<string, number>();
    athletePRs.forEach(pr => {
      if (pr.pr_value_kg) {
        prMap.set(pr.exercise_id, pr.pr_value_kg);
      }
    });

    const visibleDays = dayDisplayOrder
      .filter(dayIndex => activeDays.includes(dayIndex))
      .map(dayIndex => ({
        index: dayIndex,
        name: dayLabels[dayIndex] || `Day ${dayIndex}`
      }));

    const dayData: DayData[] = visibleDays.map(({ index, name }) => {
      let dailyLoad = 0;
      let dailyReps = 0;
      let dailyStress = 0;

      const dayExercises = plannedExercises[index] || [];

      dayExercises.forEach(plannedEx => {
        const totalSets = plannedEx.summary_total_sets || 0;
        const totalReps = plannedEx.summary_total_reps || 0;
        const avgLoad = plannedEx.summary_avg_load || 0;

        dailyReps += totalReps;

        if (plannedEx.unit === 'absolute_kg' && avgLoad > 0) {
          dailyLoad += avgLoad * totalReps;

          const athletePR = prMap.get(plannedEx.exercise_id);
          if (athletePR && athletePR > 0 && totalSets > 0) {
            const intensity = avgLoad / athletePR;
            dailyStress += totalReps * Math.pow(intensity, 2);
          }
        }
      });

      return {
        day: name,
        dayIndex: index,
        load: Math.round(dailyLoad),
        reps: dailyReps,
        stress: Math.round(dailyStress * 10) / 10,
      };
    });

    return dayData;
  }, [plannedExercises, athletePRs, dayLabels, activeDays, dayDisplayOrder]);

  const maxLoad = Math.max(...distributionData.map(d => d.load), 1);
  const maxReps = Math.max(...distributionData.map(d => d.reps), 1);
  const maxStress = Math.max(...distributionData.map(d => d.stress), 1);

  return (
    <div className="bg-white border-t border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Weekly Load Distribution</h3>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Load by Day (kg)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={distributionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
                interval={0}
                angle={-35}
                textAnchor="end"
                height={50}
              />
              <YAxis
                domain={[0, maxLoad * 1.1]}
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: number) => `${Math.round(value)} kg`}
              />
              <Bar dataKey="load" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Reps by Day</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={distributionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
                interval={0}
                angle={-35}
                textAnchor="end"
                height={50}
              />
              <YAxis
                domain={[0, maxReps * 1.1]}
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: number) => `${value} reps`}
              />
              <Bar dataKey="reps" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Stress by Day</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={distributionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
                interval={0}
                angle={-35}
                textAnchor="end"
                height={50}
              />
              <YAxis
                domain={[0, maxStress * 1.1]}
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: number) => value.toFixed(1)}
              />
              <Bar dataKey="stress" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500 space-y-1">
        <p><strong>Load:</strong> Sum of (load × reps) for all kg-based exercises</p>
        <p><strong>Reps:</strong> Total reps across all exercises</p>
        <p><strong>Stress:</strong> Sum of (reps × (load/PR)²) for exercises with PRs</p>
      </div>
    </div>
  );
}
