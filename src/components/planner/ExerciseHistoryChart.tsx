import { useState, useEffect } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { parsePrescription } from '../../lib/prescriptionParser';
import {
  formatKg as fmtKg,
  formatLoadReps,
  groupLoadReps,
  joinLoadRepsDetails as joinDetails,
} from '../../lib/loadRepsFormat';
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
  /** Stacked prescription behind the point: "80×3, 85×2×3" (load × reps × sets).
   *  Null when the week has nothing planned / logged for this exercise. */
  plan_detail: string | null;
  perf_detail: string | null;
}


interface ExerciseHistoryChartProps {
  exerciseId: string;
  athleteId:  string;
  macroContext: MacroContext | null;
  /** The week the coach is currently planning (Monday-anchored). The "Now"
   *  marker and the look-ahead window follow THIS week, not the real today,
   *  so the chart gives direction relative to where the coach is writing. */
  currentWeekStart?: string;
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

/**
 * Hover card for one week. Beyond the plotted kg it shows the *stacked
 * prescription* behind that point — load × reps (× sets) for what was written
 * and what was actually lifted — so the coach can see, e.g., that a 100 kg max
 * was a single, while the week before 95 kg was 95×2×3.
 */
function HistoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: WeekPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const row = (label: string, value: string, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ color, fontWeight: 500 }}>{value}</span>
    </div>
  );
  const detail = (label: string, text: string) => (
    <div style={{ marginTop: 3 }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <div style={{ color: 'var(--color-text-primary)', fontSize: 11 }}>{text}</div>
    </div>
  );

  return (
    <div style={{
      background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-tertiary)',
      borderRadius: 'var(--radius-md)', padding: '6px 8px', fontSize: 11,
      boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 150, maxWidth: 260,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 3, color: 'var(--color-text-primary)' }}>
        Week {point.label}
      </div>
      {point.soll_max != null && row('SOLL max', `${fmtKg(point.soll_max)} kg`, '#fb923c')}
      {point.plan_max != null && row('Planned max', `${fmtKg(point.plan_max)} kg`, '#94a3b8')}
      {point.plan_avg != null && row('Planned avg', `${fmtKg(point.plan_avg)} kg`, '#94a3b8')}
      {point.plan_detail && detail('Planned', point.plan_detail)}
      {point.perf_max != null && row('Performed max', `${fmtKg(point.perf_max)} kg`, '#3b82f6')}
      {point.perf_avg != null && row('Performed avg', `${fmtKg(point.perf_avg)} kg`, '#3b82f6')}
      {point.perf_detail && detail('Performed', point.perf_detail)}
    </div>
  );
}

export function ExerciseHistoryChart({ exerciseId, athleteId, macroContext, currentWeekStart }: ExerciseHistoryChartProps) {
  const [data, setData]     = useState<WeekPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]     = useState<'max' | 'avg'>('max');

  // Anchor the window on the week being planned (falls back to today when the
  // planner didn't pass one, e.g. legacy call sites).
  const anchorWeek = getMondayUTC(currentWeekStart ?? new Date().toISOString().slice(0, 10));

  useEffect(() => { void loadData(); }, [exerciseId, athleteId, macroContext?.macroId, anchorWeek]);

  async function loadData() {
    setLoading(true);
    try {
      const lookBack  = addWeeksUTC(anchorWeek, -WINDOW_WEEKS);
      const lookAhead = macroContext
        ? addWeeksUTC(anchorWeek, macroContext.totalWeeks - macroContext.weekNumber + 2)
        : addWeeksUTC(anchorWeek, 4);

      const { data: weekPlans } = await supabase
        .from('week_plans')
        .select('id, week_start')
        .eq('athlete_id', athleteId)
        .gte('week_start', lookBack)
        .lte('week_start', lookAhead);

      const planByWeek = new Map<string, { max: number; totalLoad: number; totalReps: number }>();
      // Per week: the prescription(s) behind the plotted point, so the tooltip
      // can show what load was written for how many reps — not just the max.
      const planDetailByWeek = new Map<string, string | null>();

      if (weekPlans?.length) {
        const wpIds = weekPlans.map(w => w.id);
        const wpStartById = new Map(weekPlans.map(w => [w.id, w.week_start]));

        const { data: planRows } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, prescription_raw, summary_highest_load, summary_avg_load, summary_total_reps')
          .eq('exercise_id', exerciseId)
          .in('weekplan_id', wpIds)
          .order('day_index');

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
          // parsePrescription is the canonical grammar (lib/prescriptionParser);
          // re-formatting through it normalises "80x5x3" / "80 × 5 × 3" alike.
          const detail = formatLoadReps(
            parsePrescription(row.prescription_raw ?? '')
              .filter(l => l.load > 0)
              .map(l => ({ load: l.load, reps: l.reps, sets: Math.max(1, l.sets) })),
          );
          planDetailByWeek.set(ws, joinDetails(planDetailByWeek.get(ws) ?? null, detail));
        }
      }

      const { data: logRows } = await supabase
        .from('training_log_exercises')
        .select('id, performed_raw, session:training_log_sessions!inner(date, athlete_id, status)')
        .eq('exercise_id', exerciseId)
        .eq('session.athlete_id', athleteId)
        .eq('session.status', 'completed')
        .gte('session.date', lookBack);

      // v2 training log writes per-set data into training_log_sets and
      // leaves performed_raw empty, so we fetch both and prefer the set
      // rows when they exist. v1 rows still parse the summary string.
      const logExIds = (logRows ?? []).map(r => r.id);
      type SetRow = {
        log_exercise_id: string;
        performed_load: number | null;
        performed_reps: number | null;
        status: 'pending' | 'completed' | 'skipped' | 'failed';
      };
      let setRows: SetRow[] = [];
      if (logExIds.length > 0) {
        const { data: lsRows } = await supabase
          .from('training_log_sets')
          .select('log_exercise_id, performed_load, performed_reps, status')
          .in('log_exercise_id', logExIds);
        setRows = (lsRows ?? []) as SetRow[];
      }
      const setsByLogEx = new Map<string, SetRow[]>();
      for (const s of setRows) {
        if (s.status !== 'completed') continue;
        const list = setsByLogEx.get(s.log_exercise_id) ?? [];
        list.push(s);
        setsByLogEx.set(s.log_exercise_id, list);
      }

      const perfByWeek = new Map<string, { max: number; totalLoad: number; totalReps: number }>();
      const perfDetailByWeek = new Map<string, string | null>();
      for (const row of logRows ?? []) {
        const session = row.session as unknown as { date: string } | null;
        if (!session) continue;
        const ws = getMondayUTC(session.date);
        const setsForRow = setsByLogEx.get(row.id) ?? [];

        if (setsForRow.length > 0) {
          // v2 path: every completed set contributes to max + tonnage.
          for (const s of setsForRow) {
            const load = s.performed_load ?? 0;
            const reps = s.performed_reps ?? 0;
            if (load <= 0 || reps <= 0) continue;
            const prev = perfByWeek.get(ws) ?? { max: 0, totalLoad: 0, totalReps: 0 };
            perfByWeek.set(ws, {
              max: Math.max(prev.max, load),
              totalLoad: prev.totalLoad + load * reps,
              totalReps: prev.totalReps + reps,
            });
          }
          // One row per set → collapse consecutive equal (load, reps) pairs.
          perfDetailByWeek.set(ws, joinDetails(
            perfDetailByWeek.get(ws) ?? null,
            formatLoadReps(groupLoadReps(setsForRow.map(s => ({
              load: s.performed_load ?? 0,
              reps: s.performed_reps ?? 0,
            })))),
          ));
        } else if (row.performed_raw) {
          // v1 fallback: parse the summary string the old client wrote.
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
          perfDetailByWeek.set(ws, joinDetails(
            perfDetailByWeek.get(ws) ?? null,
            formatLoadReps(
              lines.filter(l => l.load > 0)
                .map(l => ({ load: l.load, reps: l.reps, sets: Math.max(1, l.sets) })),
            ),
          ));
        }
      }

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
          plan_detail: planDetailByWeek.get(ws) ?? null,
          perf_detail: perfDetailByWeek.get(ws) ?? null,
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
    return (
      <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
        Loading history…
      </div>
    );
  }

  const hasPlan = data.some(d => d.plan_max !== null || d.plan_avg !== null);
  const hasPerf = data.some(d => d.perf_max !== null || d.perf_avg !== null);
  const hasSoll = data.some(d => d.soll_max !== null || d.soll_avg !== null);

  if (!hasPlan && !hasPerf && !hasSoll) {
    return (
      <div style={{
        height: 112, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: 'var(--color-text-tertiary)', fontStyle: 'italic',
        border: '1px dashed var(--color-border-tertiary)', borderRadius: 'var(--radius-md)', marginBottom: 12,
      }}>
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

  // "Now" marks the week being planned. With a macro we use its current week
  // number; otherwise we match the anchor week's label in the data.
  const nowLabel = macroContext
    ? `W${macroContext.weekNumber}`
    : data.find(d => d.weekStart === anchorWeek)?.label;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', letterSpacing: '0.05em' }}>
          Load history
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {(['max', 'avg'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer',
                background: view === v ? 'var(--color-accent-muted)' : 'transparent',
                color: view === v ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                fontWeight: view === v ? 500 : 400,
              }}
            >
              {v === 'max' ? 'Hi' : 'Avg'}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#e5e7eb" tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[minY, maxY]} tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#e5e7eb" tickLine={false} width={32} />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip content={HistoryTooltip as any} />
          {nowLabel && (
            <ReferenceLine x={nowLabel} stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2"
              label={{ value: 'This week', position: 'top', fontSize: 9, fill: '#f97316' }} />
          )}
          {hasSoll && (
            <Line type="stepAfter" dataKey={sollKey} stroke="#fb923c" strokeWidth={1.5}
              strokeDasharray="5 3" dot={false} connectNulls name={sollKey} legendType="none" />
          )}
          {hasPlan && (
            <Line type="monotone" dataKey={planKey} stroke="#94a3b8" strokeWidth={1.5}
              dot={{ r: 3, fill: '#fff', stroke: '#94a3b8', strokeWidth: 1.5 }}
              activeDot={{ r: 4 }} connectNulls name={planKey} legendType="none" />
          )}
          {hasPerf && (
            <Line type="monotone" dataKey={perfKey} stroke="#3b82f6" strokeWidth={2}
              dot={{ r: 3.5, fill: '#3b82f6', strokeWidth: 0 }}
              activeDot={{ r: 5 }} connectNulls name={perfKey} legendType="none" />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, fontSize: 10, color: 'var(--color-text-secondary)' }}>
        {hasPlan && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 12, height: 1.5, backgroundColor: '#94a3b8', borderRadius: 1 }} />
            Planned
          </span>
        )}
        {hasPerf && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 12, height: 2, backgroundColor: '#3b82f6', borderRadius: 1 }} />
            Performed
          </span>
        )}
        {hasSoll && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 12, borderTop: '1.5px dashed #fb923c' }} />
            SOLL
          </span>
        )}
      </div>
    </div>
  );
}
