import { useState, useEffect } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { parsePrescription } from '../../lib/prescriptionParser';
import type { MacroContext } from './WeeklyPlanner';

interface WeekPoint {
  weekStart: string;
  label: string;
  weekNumber: number | null;
  plan_max:  number | null;
  plan_avg: number | null;
  perf_max:  number | null;
  perf_avg: number | null;
  soll_max:  number | null;
  soll_avg: number | null;
}

interface ExerciseHistoryChartProps {
  exerciseId: string;
  athleteId:  string;
  macroContext: MacroContext | null;
}

const WINDOW_WEEKS = 16;

function getMondayUTC(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

function formatLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function addWeeksUTC(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function ExerciseHistoryChart({ exerciseId, athleteId, macroContext }: ExerciseHistoryChartProps) {
  const [data, setData]     = useState<WeekPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]     = useState<'max' | 'avg'>('max');

  useEffect(() => { void loadData(); }, [exerciseId, athleteId, macroContext?.macroId]);

  async function loadData() {
    setLoading(true);
    try {
      const todayStr  = new Date().toISOString().slice(0, 10);
      const lookBack  = addWeeksUTC(todayStr, -WINDOW_WEEKS);
      // Look ahead to cover future macro weeks too
      const lookAhead = macroContext
        ? addWeeksUTC(todayStr, macroContext.totalWeeks - macroContext.weekNumber + 2)
        : addWeeksUTC(todayStr, 4);

      // ── 1. Planned data (week_plans + planned_exercises) ──────────────────
      const { data: weekPlans } = await supabase
        .from('week_plans')
        .select('id, week_start')
        .eq('athlete_id', athleteId)
        .gte('week_start', lookBack)
        .lte('week_start', lookAhead);

      const planByWeek = new Map<string, { max: number; totalLoad: number; totalReps: number }>();

      if (weekPlans?.length) {
        const wpIds = weekPlans.map(w => w.id);
        const wpStartById = new Map(weekPlans.map(w => [w.id, w.week_start]));

        const { data: planRows } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, summary_highest_load, summary_avg_load, summary_total_reps')
          .eq('exercise_id', exerciseId)
          .in('weekplan_id', wpIds);

        for (const row of planRows ?? []) {
          const ws = wpStartById.get(row.weekplan_id);
          if (!ws) continue;
          const hi   = row.summary_highest_load ?? 0;
          const avg  = row.summary_avg_load ?? 0;
          const reps = row.summary_total_reps ?? 0;
          if (hi <= 0 && avg <= 0) continue;
          const prev = planByWeek.get(ws) ?? { max: 0, totalLoad: 0, totalReps: 0 };
          planByWeek.set(ws, {
            max: Math.max(prev.max, hi),
            totalLoad: prev.totalLoad + avg * reps,
            totalReps: prev.totalReps + reps,
          });
        }
      }

      // ── 2. Performed data (training log, completed sessions only) ─────────
      const { data: logRows } = await supabase
        .from('training_log_exercises')
        .select('performed_raw, session:training_log_sessions!inner(date, athlete_id, status)')
        .eq('exercise_id', exerciseId)
        .eq('session.athlete_id', athleteId)
        .eq('session.status', 'completed')
        .gte('session.date', lookBack);

      const perfByWeek = new Map<string, { max: number; totalLoad: number; totalReps: number }>();
      for (const row of logRows ?? []) {
        const session = row.session as { date: string } | null;
        if (!session || !row.performed_raw) continue;
        const ws    = getMondayUTC(session.date);
        const lines = parsePrescription(row.performed_raw);
        for (const line of lines) {
          if (line.load <= 0) continue;
          const prev = perfByWeek.get(ws) ?? { max: 0, totalLoad: 0, totalReps: 0 };
          perfByWeek.set(ws, {
            max: Math.max(prev.max, line.load),
            totalLoad: prev.totalLoad + line.load * line.reps * line.sets,
            totalReps: prev.totalReps + line.reps * line.sets,
          });
        }
      }

      // ── 3. Macro SOLL targets ──────────────────────────────────────────────
      const sollByWeekStart = new Map<string, { max: number | null; avg: number | null; weekNumber: number }>();

      if (macroContext) {
        const { data: te } = await supabase
          .from('macro_tracked_exercises')
          .select('id')
          .eq('macrocycle_id', macroContext.macroId)
          .eq('exercise_id', exerciseId)
          .maybeSingle();

        if (te) {
          const { data: macroWeeks } = await supabase
            .from('macro_weeks')
            .select('id, week_number, week_start')
            .eq('macrocycle_id', macroContext.macroId)
            .order('week_number');

          if (macroWeeks?.length) {
            const { data: targets } = await supabase
              .from('macro_targets')
              .select('macro_week_id, target_max, target_avg')
              .eq('tracked_exercise_id', te.id)
              .in('macro_week_id', macroWeeks.map(w => w.id));

            const targetMap = new Map((targets ?? []).map(t => [t.macro_week_id, t]));
            for (const mw of macroWeeks) {
              const t = targetMap.get(mw.id);
              sollByWeekStart.set(mw.week_start, {
                max: t?.target_max ?? null,
                avg: t?.target_avg ?? null,
                weekNumber: mw.week_number,
              });
            }
          }
        }
      }

      // ── 4. Merge all three sources ────────────────────────────────────────
      const allWeeks = new Set<string>([
        ...planByWeek.keys(),
        ...perfByWeek.keys(),
        ...sollByWeekStart.keys(),
      ]);

      const points: WeekPoint[] = Array.from(allWeeks).sort().map(ws => {
        const plan = planByWeek.get(ws);
        const perf = perfByWeek.get(ws);
        const soll = sollByWeekStart.get(ws);
        return {
          weekStart: ws,
          label:      soll ? `W${soll.weekNumber}` : formatLabel(ws),
          weekNumber: soll?.weekNumber ?? null,
          plan_max:  plan && plan.max > 0 ? plan.max : null,
          plan_avg: plan && plan.totalReps > 0 ? Math.round(plan.totalLoad / plan.totalReps) : null,
          perf_max:  perf && perf.max > 0 ? perf.max : null,
          perf_avg: perf && perf.totalReps > 0 ? Math.round(perf.totalLoad / perf.totalReps) : null,
          soll_max:  soll?.max ?? null,
          soll_avg: soll?.avg ?? null,
        };
      });

      setData(points);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading history…</div>;
  }

  const hasPlan = data.some(d => d.plan_max !== null || d.plan_avg !== null);
  const hasPerf = data.some(d => d.perf_max !== null || d.perf_avg !== null);
  const hasSoll = data.some(d => d.soll_max !== null || d.soll_avg !== null);

  if (!hasPlan && !hasPerf && !hasSoll) {
    return (
      <div className="h-28 flex items-center justify-center text-xs text-gray-400 italic border border-dashed border-gray-200 rounded-lg mb-3">
        No planned or logged data found for this exercise
      </div>
    );
  }

  const planKey = view === 'max' ? 'plan_max'  : 'plan_avg';
  const perfKey = view === 'max' ? 'perf_max'  : 'perf_avg';
  const sollKey = view === 'max' ? 'soll_max'  : 'soll_avg';

  const allVals = data.flatMap(d => [
    d[planKey as keyof WeekPoint],
    d[perfKey as keyof WeekPoint],
    d[sollKey as keyof WeekPoint],
  ]).filter((v): v is number => typeof v === 'number');

  const minY = allVals.length > 0 ? Math.max(0, Math.min(...allVals) - 10) : 0;
  const maxY = allVals.length > 0 ? Math.max(...allVals) + 10 : 100;

  const nowWeekStart = getMondayUTC(new Date().toISOString().slice(0, 10));
  const nowLabel = macroContext
    ? `W${macroContext.weekNumber}`
    : data.find(d => d.weekStart === nowWeekStart)?.label;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Load history</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView('max')}
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              view === 'max' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-400 hover:bg-gray-100'
            }`}
          >
            Hi
          </button>
          <button
            onClick={() => setView('avg')}
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              view === 'avg' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-400 hover:bg-gray-100'
            }`}
          >
            Avg
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#e5e7eb"
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minY, maxY]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#e5e7eb"
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, padding: '4px 8px', borderColor: '#e5e7eb' }}
            formatter={(value: number, name: string) => [
              `${value} kg`,
              name === 'plan_max'  ? 'Planned max'
              : name === 'plan_avg' ? 'Planned avg'
              : name === 'perf_max'  ? 'Performed max'
              : name === 'perf_avg' ? 'Performed avg'
              : name === 'soll_max'  ? 'SOLL max'
              : 'SOLL avg',
            ]}
            labelFormatter={(label: string) => `Week: ${label}`}
          />
          {nowLabel && (
            <ReferenceLine
              x={nowLabel}
              stroke="#f97316"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              label={{ value: 'Now', position: 'top', fontSize: 9, fill: '#f97316' }}
            />
          )}

          {/* SOLL macro targets — orange dashed */}
          {hasSoll && (
            <Line
              type="stepAfter"
              dataKey={sollKey}
              stroke="#fb923c"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
              name={sollKey}
              legendType="none"
            />
          )}

          {/* Planned — gray line with open dots */}
          {hasPlan && (
            <Line
              type="monotone"
              dataKey={planKey}
              stroke="#94a3b8"
              strokeWidth={1.5}
              dot={{ r: 3, fill: '#fff', stroke: '#94a3b8', strokeWidth: 1.5 }}
              activeDot={{ r: 4 }}
              connectNulls
              name={planKey}
              legendType="none"
            />
          )}

          {/* Performed — blue filled dots */}
          {hasPerf && (
            <Line
              type="monotone"
              dataKey={perfKey}
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3.5, fill: '#3b82f6', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls
              name={perfKey}
              legendType="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500">
        {hasPlan && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-px bg-slate-400 rounded" style={{ height: 1.5 }} />
            Planned
          </span>
        )}
        {hasPerf && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 rounded" style={{ height: 2, backgroundColor: '#3b82f6' }} />
            Performed
          </span>
        )}
        {hasSoll && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 border-t border-dashed border-orange-400" />
            SOLL
          </span>
        )}
      </div>
    </div>
  );
}
