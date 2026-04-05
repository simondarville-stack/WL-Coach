import { useState, useEffect } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { parsePrescription } from '../../lib/prescriptionParser';
import type { MacroContext } from './WeeklyPlanner';

interface WeekPoint {
  weekStart: string;
  label: string;
  weekNumber: number | null;
  perf_hi: number | null;
  perf_avg: number | null;
  soll_hi: number | null;
  soll_avg: number | null;
}

interface ExerciseHistoryChartProps {
  exerciseId: string;
  athleteId: string;
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

export function ExerciseHistoryChart({ exerciseId, athleteId, macroContext }: ExerciseHistoryChartProps) {
  const [data, setData] = useState<WeekPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hi' | 'avg'>('hi');

  useEffect(() => { void loadData(); }, [exerciseId, athleteId, macroContext?.macroId]);

  async function loadData() {
    setLoading(true);
    try {
      // ── 1. Performed data from training log ──────────────────────────────
      // Look back WINDOW_WEEKS from today
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_WEEKS * 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const { data: logRows } = await supabase
        .from('training_log_exercises')
        .select('performed_raw, session:training_log_sessions!inner(date, week_start, athlete_id, status)')
        .eq('exercise_id', exerciseId)
        .eq('session.athlete_id', athleteId)
        .eq('session.status', 'completed')
        .gte('session.date', cutoffStr)
        .order('session.date', { ascending: true });

      // Aggregate by week_start
      const perfByWeek = new Map<string, { hi: number; totalLoad: number; totalReps: number }>();
      for (const row of logRows ?? []) {
        const session = row.session as { date: string; week_start: string } | null;
        if (!session || !row.performed_raw) continue;
        const ws = getMondayUTC(session.date);
        const lines = parsePrescription(row.performed_raw);
        for (const line of lines) {
          if (line.load <= 0) continue;
          const prev = perfByWeek.get(ws) ?? { hi: 0, totalLoad: 0, totalReps: 0 };
          perfByWeek.set(ws, {
            hi: Math.max(prev.hi, line.load),
            totalLoad: prev.totalLoad + line.load * line.reps * line.sets,
            totalReps: prev.totalReps + line.reps * line.sets,
          });
        }
      }

      // ── 2. Macro targets (if macro active and exercise is tracked) ───────
      let sollByWeekStart = new Map<string, { hi: number | null; avg: number | null; weekNumber: number }>();

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
              .select('macro_week_id, target_hi, target_ave')
              .eq('tracked_exercise_id', te.id)
              .in('macro_week_id', macroWeeks.map(w => w.id));

            const targetMap = new Map((targets ?? []).map(t => [t.macro_week_id, t]));
            for (const mw of macroWeeks) {
              const t = targetMap.get(mw.id);
              sollByWeekStart.set(mw.week_start, {
                hi: t?.target_hi ?? null,
                avg: t?.target_ave ?? null,
                weekNumber: mw.week_number,
              });
            }
          }
        }
      }

      // ── 3. Merge into chart points ────────────────────────────────────────
      const allWeeks = new Set<string>([
        ...Array.from(perfByWeek.keys()),
        ...Array.from(sollByWeekStart.keys()),
      ]);

      const sorted = Array.from(allWeeks).sort();
      const points: WeekPoint[] = sorted.map(ws => {
        const perf = perfByWeek.get(ws);
        const soll = sollByWeekStart.get(ws);
        return {
          weekStart: ws,
          label: soll ? `W${soll.weekNumber}` : formatLabel(ws),
          weekNumber: soll?.weekNumber ?? null,
          perf_hi: perf && perf.hi > 0 ? perf.hi : null,
          perf_avg: perf && perf.totalReps > 0 ? Math.round(perf.totalLoad / perf.totalReps) : null,
          soll_hi: soll?.hi ?? null,
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

  const hasPerf  = data.some(d => d.perf_hi !== null || d.perf_avg !== null);
  const hasSoll  = data.some(d => d.soll_hi !== null || d.soll_avg !== null);

  if (!hasPerf && !hasSoll) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-gray-400 italic border border-dashed border-gray-200 rounded-lg mb-3">
        No logged sessions found for this exercise
      </div>
    );
  }

  const perfKey = view === 'hi' ? 'perf_hi' : 'perf_avg';
  const sollKey = view === 'hi' ? 'soll_hi' : 'soll_avg';

  const allVals = data.flatMap(d => [
    d[perfKey as keyof WeekPoint],
    d[sollKey as keyof WeekPoint],
  ]).filter((v): v is number => typeof v === 'number');

  const minY = allVals.length > 0 ? Math.max(0, Math.min(...allVals) - 10) : 0;
  const maxY = allVals.length > 0 ? Math.max(...allVals) + 10 : 100;

  const nowWeekStart = macroContext
    ? undefined
    : getMondayUTC(new Date().toISOString().slice(0, 10));

  // Find label for current week to draw reference line
  const nowLabel = macroContext
    ? `W${macroContext.weekNumber}`
    : data.find(d => d.weekStart === nowWeekStart)?.label;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Load history</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView('hi')}
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              view === 'hi' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-400 hover:bg-gray-100'
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
              name === 'perf_hi' ? 'Hi performed'
              : name === 'perf_avg' ? 'Avg performed'
              : name === 'soll_hi' ? 'SOLL Hi'
              : 'SOLL Avg',
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

          {/* SOLL line (macro targets) */}
          {hasSoll && (
            <Line
              type="stepAfter"
              dataKey={sollKey}
              stroke="#f97316"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
              name={sollKey}
              legendType="none"
            />
          )}

          {/* Performed line */}
          {hasPerf && (
            <Line
              type="monotone"
              dataKey={perfKey}
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls
              name={perfKey}
              legendType="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Manual legend */}
      <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500">
        {hasPerf && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-blue-500 rounded" />
            Performed {view === 'hi' ? 'hi' : 'avg'}
          </span>
        )}
        {hasSoll && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 border-t border-dashed border-orange-400" />
            SOLL {view === 'hi' ? 'hi' : 'avg'}
          </span>
        )}
      </div>
    </div>
  );
}
