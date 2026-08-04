import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatDateShort, isoMonday, isoAddWeeks, weekStartsBetween, snapToMonday } from '../../lib/dateUtils';
import {
  clampViewport, fitViewport, fullViewport, isFull, panViewport, spanOf, zoomViewport,
  MIN_SPAN, type Viewport,
} from '../../lib/chartViewport';
import { parsePrescription } from '../../lib/prescriptionParser';
import {
  formatKg as fmtKg,
  formatLoadReps,
  groupLoadReps,
  joinLoadRepsDetails as joinDetails,
} from '../../lib/loadRepsFormat';
import {
  placeUnit, placeLoggedDate, orderedUnits, parseClockMinutes,
  type DaySchedule,
} from '../../lib/weekTimeline';
import { weekdayShortFromMonday } from '../../lib/dateUtils';
import type { MacroContext } from './WeeklyPlanner';

/**
 * One plotted point. Sessions no longer collapse onto their week: `x` is a
 * CONTINUOUS week position — the integer part is the week, the fraction is
 * where in that week the session sits (see lib/weekTimeline). Two snatch
 * sessions in the same week are now two points, which is the whole point of
 * a history chart.
 */
interface ChartPoint {
  /** weekIndex + fraction-of-week. The x-axis is numeric. */
  x: number;
  weekStart: string;
  label: string;
  weekNumber: number | null;
  /** "Wed 16:00" / "Session 2 of 3" — how the position was decided. */
  when: string | null;
  plan_max:  number | null;
  plan_avg: number | null;
  perf_max:  number | null;
  perf_avg: number | null;
  soll_max:  number | null;
  soll_avg: number | null;
  /** Stacked prescription behind the point: "80×3, 85×2×3" (load × reps × sets).
   *  Null when the session has nothing planned / logged for this exercise. */
  plan_detail: string | null;
  perf_detail: string | null;
}

/** Running totals while a session's sets are folded together. */
interface Acc { max: number; totalLoad: number; totalReps: number }
const accOf = (m: Map<string, Acc>, k: string): Acc =>
  m.get(k) ?? { max: 0, totalLoad: 0, totalReps: 0 };


interface ExerciseHistoryChartProps {
  exerciseId: string;
  athleteId:  string;
  macroContext: MacroContext | null;
  /** The week the coach is currently planning (Monday-anchored). The "Now"
   *  marker and the look-ahead window follow THIS week, not the real today,
   *  so the chart gives direction relative to where the coach is writing. */
  currentWeekStart?: string;
}

/** How far back we FETCH. The coach can pan across all of it. */
// COACH-CONFIG candidate — three years of history.
const FETCH_BACK_WEEKS = 156;
/** How many weeks are VISIBLE on first render. */
// COACH-CONFIG candidate — the old fixed window, now just the default zoom.
const DEFAULT_VISIBLE_WEEKS = 16;
/** Guard against an absurd span if a plan exists far outside the fetch window. */
const MAX_POINTS = 400;
/** Device-local: a coach who prefers a 30-week look keeps it across exercises. */
const SPAN_PREF_KEY = 'emos.exerciseHistory.spanWeeks';

function readSpanPref(): number | null {
  try {
    const raw = localStorage.getItem(SPAN_PREF_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= MIN_SPAN ? n : null;
  } catch { return null; }
}
function writeSpanPref(span: number): void {
  try { localStorage.setItem(SPAN_PREF_KEY, String(span)); } catch { /* private mode */ }
}

/**
 * Hover card for one week. Beyond the plotted kg it shows the *stacked
 * prescription* behind that point — load × reps (× sets) for what was written
 * and what was actually lifted — so the coach can see, e.g., that a 100 kg max
 * was a single, while the week before 95 kg was 95×2×3.
 */
function HistoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
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
        {point.when && (
          <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)' }}> · {point.when}</span>
        )}
      </div>
      {point.soll_max != null && row('Target max', `${fmtKg(point.soll_max)} kg`, '#fb923c')}
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
  const [data, setData]     = useState<ChartPoint[]>([]);
  /** The dense Monday grid the x-axis is indexed on; the viewport counts WEEKS,
   *  not points, so zoom still reads "16 wk" however many sessions that is. */
  const [weeks, setWeeks]   = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]     = useState<'max' | 'avg'>('max');
  /** Inclusive index window into `data`. null until the first data arrives. */
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startVp: Viewport; moved: boolean } | null>(null);
  const cleanupPanRef = useRef<(() => void) | null>(null);

  // Anchor the window on the week being planned (falls back to today when the
  // planner didn't pass one, e.g. legacy call sites).
  const anchorWeek = isoMonday(currentWeekStart ?? new Date().toISOString().slice(0, 10));

  useEffect(() => { void loadData(); }, [exerciseId, athleteId, macroContext?.macroId, anchorWeek]);

  async function loadData() {
    setLoading(true);
    try {
      // Fetch WIDE (three years) so there is something to pan across; the
      // viewport decides what is actually shown.
      const lookBack  = isoAddWeeks(anchorWeek, -FETCH_BACK_WEEKS);
      const lookAhead = macroContext
        ? isoAddWeeks(anchorWeek, macroContext.totalWeeks - macroContext.weekNumber + 2)
        : isoAddWeeks(anchorWeek, 8);

      const { data: weekPlans } = await supabase
        .from('week_plans')
        // active_days / day_display_order / day_schedule are what decide WHERE
        // in the week a session sits — see lib/weekTimeline.
        .select('id, week_start, active_days, day_display_order, day_schedule')
        .eq('athlete_id', athleteId)
        .gte('week_start', lookBack)
        .lte('week_start', lookAhead);

      // Keyed by SESSION — "<weekStart>|<dayIndex>" — not by week, so an
      // exercise trained twice in one week produces two points.
      const sessionKey = (ws: string, day: number) => `${ws}|${day}`;
      type WeekShape = {
        week_start: string;
        active_days: number[] | null;
        day_display_order: number[] | null;
        day_schedule: DaySchedule;
      };
      const shapeById = new Map<string, WeekShape>(
        (weekPlans ?? []).map(w => [w.id, w as unknown as WeekShape]),
      );

      const planBySession = new Map<string, Acc>();
      const planDetailBySession = new Map<string, string | null>();
      /** session key → { weekStart, dayIndex } so we can place it later. */
      const sessionMeta = new Map<string, { weekStart: string; dayIndex: number }>();

      if (weekPlans?.length) {
        const wpIds = weekPlans.map(w => w.id);

        const { data: planRows } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, day_index, prescription_raw, summary_highest_load, summary_avg_load, summary_total_reps')
          .eq('exercise_id', exerciseId)
          .in('weekplan_id', wpIds)
          .order('day_index');

        for (const row of planRows ?? []) {
          const shape = shapeById.get(row.weekplan_id);
          if (!shape) continue;
          const ws = shape.week_start;
          const day = row.day_index ?? 1;
          const hi   = row.summary_highest_load ?? 0;
          const avg  = row.summary_avg_load ?? 0;
          const reps = row.summary_total_reps ?? 0;
          if (hi <= 0 && avg <= 0) continue;
          const key = sessionKey(ws, day);
          sessionMeta.set(key, { weekStart: ws, dayIndex: day });
          const prev = accOf(planBySession, key);
          planBySession.set(key, {
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
          planDetailBySession.set(key, joinDetails(planDetailBySession.get(key) ?? null, detail));
        }
      }

      const { data: logRows } = await supabase
        .from('training_log_exercises')
        .select('id, performed_raw, session:training_log_sessions!inner(date, day_index, athlete_id, status)')
        .eq('exercise_id', exerciseId)
        .eq('session.athlete_id', athleteId)
        .eq('session.status', 'completed')
        .gte('session.date', lookBack)
        .lte('session.date', lookAhead);

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

      const perfBySession = new Map<string, Acc>();
      const perfDetailBySession = new Map<string, string | null>();
      /** session key → the real date it happened, which beats any placement rule. */
      const loggedDateBySession = new Map<string, string>();
      for (const row of logRows ?? []) {
        const session = row.session as unknown as { date: string; day_index: number | null } | null;
        if (!session) continue;
        const ws = isoMonday(session.date);
        const day = session.day_index ?? 1;
        const key = sessionKey(ws, day);
        sessionMeta.set(key, { weekStart: ws, dayIndex: day });
        loggedDateBySession.set(key, session.date);
        const setsForRow = setsByLogEx.get(row.id) ?? [];

        if (setsForRow.length > 0) {
          // v2 path: every completed set contributes to max + tonnage.
          for (const s of setsForRow) {
            const load = s.performed_load ?? 0;
            const reps = s.performed_reps ?? 0;
            if (load <= 0 || reps <= 0) continue;
            const prev = accOf(perfBySession, key);
            perfBySession.set(key, {
              max: Math.max(prev.max, load),
              totalLoad: prev.totalLoad + load * reps,
              totalReps: prev.totalReps + reps,
            });
          }
          // One row per set → collapse consecutive equal (load, reps) pairs.
          perfDetailBySession.set(key, joinDetails(
            perfDetailBySession.get(key) ?? null,
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
            const prev = accOf(perfBySession, key);
            perfBySession.set(key, {
              max: Math.max(prev.max, line.load),
              totalLoad: prev.totalLoad + line.load * line.reps * line.sets,
              totalReps: prev.totalReps + line.reps * line.sets,
            });
          }
          perfDetailBySession.set(key, joinDetails(
            perfDetailBySession.get(key) ?? null,
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
              // Snap: some legacy week_start values were stored a day early
              // (see dateUtils) and would miss the dense Monday grid entirely.
              sollByWeekStart.set(snapToMonday(mw.week_start), {
                max: t?.target_max ?? null,
                avg: t?.target_avg ?? null,
                weekNumber: mw.week_number,
              });
            }
          }
        }
      }

      // The DENSE, contiguous Monday grid the x-axis is indexed on. It is no
      // longer the list of points — it is the ruler the points are measured
      // against, so the axis stays proportional to time (a nine-week gap in
      // training looks like a nine-week gap) and the viewport can keep counting
      // in weeks.
      const weekKeys = [
        ...[...sessionMeta.values()].map(m => m.weekStart),
        ...sollByWeekStart.keys(),
        anchorWeek,
      ].sort();
      if (weekKeys.length === 0) { setWeeks([]); setData([]); return; }
      let grid = weekStartsBetween(weekKeys[0], weekKeys[weekKeys.length - 1]);
      if (grid.length > MAX_POINTS) grid = grid.slice(-MAX_POINTS);
      const weekIndex = new Map(grid.map((ws, i) => [ws, i]));

      const labelFor = (ws: string) => {
        const soll = sollByWeekStart.get(ws);
        // DD/MM via dateUtils — the old toLocaleDateString('en-GB') flips to
        // US month-first on some machines (see dateUtils' own warning).
        return soll ? `W${soll.weekNumber}` : formatDateShort(ws);
      };

      const points: ChartPoint[] = [];

      // ── one point per SESSION ────────────────────────────────────────────
      for (const [key, meta] of sessionMeta) {
        const wi = weekIndex.get(meta.weekStart);
        if (wi === undefined) continue;           // outside the trimmed grid
        const shape = [...shapeById.values()].find(w => w.week_start === meta.weekStart);
        const loggedDate = loggedDateBySession.get(key);

        // A session that was actually logged is placed on its real date — that
        // beats both the schedule and the ordinal rule, because it is what
        // happened. Otherwise the week's own planning mode decides.
        let fraction: number;
        let when: string | null;
        if (loggedDate) {
          fraction = placeLoggedDate(meta.weekStart, loggedDate);
          when = `${weekdayShortFromMonday(Math.round(fraction * 7 - 0.5))} ${formatDateShort(loggedDate)}`;
        } else {
          const placed = placeUnit({
            dayIndex: meta.dayIndex,
            activeDays: shape?.active_days ?? null,
            displayOrder: shape?.day_display_order ?? null,
            schedule: shape?.day_schedule ?? null,
          });
          fraction = placed.fraction;
          if (placed.basis === 'scheduled') {
            const slot = shape?.day_schedule?.[String(meta.dayIndex)];
            const t = parseClockMinutes(slot?.time ?? null);
            when = `${weekdayShortFromMonday(slot?.weekday ?? 0)}${t != null ? ` ${slot!.time}` : ''}`;
          } else if (placed.basis === 'ordinal') {
            const ordered = orderedUnits(shape?.active_days ?? null, shape?.day_display_order ?? null);
            when = `Session ${ordered.indexOf(meta.dayIndex) + 1} of ${ordered.length}`;
          } else {
            when = `Unit ${meta.dayIndex}`;
          }
        }

        const plan = planBySession.get(key);
        const perf = perfBySession.get(key);
        points.push({
          x: wi + fraction,
          weekStart: meta.weekStart,
          label: labelFor(meta.weekStart),
          weekNumber: sollByWeekStart.get(meta.weekStart)?.weekNumber ?? null,
          when,
          plan_max:  plan && plan.max > 0 ? plan.max : null,
          plan_avg: plan && plan.totalReps > 0 ? Math.round(plan.totalLoad / plan.totalReps) : null,
          perf_max:  perf && perf.max > 0 ? perf.max : null,
          perf_avg: perf && perf.totalReps > 0 ? Math.round(perf.totalLoad / perf.totalReps) : null,
          soll_max: null,
          soll_avg: null,
          plan_detail: planDetailBySession.get(key) ?? null,
          perf_detail: perfDetailBySession.get(key) ?? null,
        });
      }

      // ── the macro Target is a WEEK-level number ──────────────────────────
      // It is not a session, so it keeps sitting on the week divider and is
      // drawn as a step that holds across the week.
      for (const [ws, soll] of sollByWeekStart) {
        const wi = weekIndex.get(ws);
        if (wi === undefined) continue;
        if (soll.max == null && soll.avg == null) continue;
        points.push({
          x: wi,
          weekStart: ws,
          label: labelFor(ws),
          weekNumber: soll.weekNumber,
          when: null,
          plan_max: null, plan_avg: null, perf_max: null, perf_avg: null,
          soll_max: soll.max, soll_avg: soll.avg,
          plan_detail: null, perf_detail: null,
        });
      }

      // Recharts needs a numeric axis dataset in x order.
      points.sort((a, b) => a.x - b.x);

      setWeeks(grid);
      setData(points);
    } catch {
      setWeeks([]);
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  // Frame the window on the week being planned: it sits ~80 % across, with the
  // recent past behind it — the same look the old fixed 16-week window had.
  // The viewport counts WEEKS (indices into `weeks`), not points, so "16 wk"
  // still means sixteen weeks however many sessions fall inside them.
  useEffect(() => {
    if (weeks.length === 0) { setViewport(null); return; }
    const anchorIdx = weeks.findIndex(ws => ws >= anchorWeek);
    const endAt = anchorIdx < 0 ? weeks.length - 1 : Math.min(weeks.length - 1, anchorIdx + 3);
    setViewport(fitViewport(weeks.length, readSpanPref() ?? DEFAULT_VISIBLE_WEEKS, endAt));
  }, [weeks, anchorWeek]);

  const vp = useMemo(
    () => (viewport ? clampViewport(viewport, weeks.length) : fullViewport(weeks.length)),
    [viewport, weeks.length],
  );
  /** Points inside the window, with one week of margin either side so the
   *  lines run to the edges instead of stopping short of them. */
  const visible = useMemo(
    () => data.filter(d => d.x >= vp.start - 1 && d.x <= vp.end + 2),
    [data, vp],
  );
  /** Points strictly inside the window — what the Y scale should fit. */
  const inWindow = useMemo(
    () => data.filter(d => d.x >= vp.start && d.x <= vp.end + 1),
    [data, vp],
  );

  const applyZoom = (factor: number, anchorFraction = 0.5) => {
    setViewport(v => {
      const next = zoomViewport(v ?? fullViewport(weeks.length), weeks.length, factor, anchorFraction);
      writeSpanPref(spanOf(next));
      return next;
    });
  };
  const applyPan = (deltaIndices: number) =>
    setViewport(v => panViewport(v ?? fullViewport(weeks.length), weeks.length, deltaIndices));

  // Wheel must be a NATIVE listener with { passive: false }. React registers
  // wheel passively at the root, so preventDefault() inside a JSX onWheel is a
  // no-op — the surrounding dialog would scroll under the cursor instead of
  // zooming. Trackpad pinch arrives here as ctrl+wheel and falls through the
  // same zoom branch, so pinch-to-zoom works with no extra code.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || weeks.length === 0) return;
    const PLOT_L = 32;  // YAxis width
    const PLOT_R = 8;   // chart margin.right
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left - PLOT_L) / Math.max(1, r.width - PLOT_L - PLOT_R)));
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dir = (e.deltaX || e.deltaY) > 0 ? 1 : -1;
        setViewport(v => {
          const cur = v ?? fullViewport(weeks.length);
          return panViewport(cur, weeks.length, dir * Math.max(1, Math.round(spanOf(cur) / 6)));
        });
      } else {
        applyZoom(e.deltaY > 0 ? 1.25 : 0.8, f);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks.length]);

  // Drag to pan. No setPointerCapture: Recharts rebuilds the SVG subtree on
  // every viewport change, so the capture target can vanish mid-drag.
  const onPointerDown = (e: React.PointerEvent) => {
    if (weeks.length === 0 || e.button !== 0) return;
    panRef.current = { pointerId: e.pointerId, startX: e.clientX, startVp: vp, moved: false };
    const move = (ev: PointerEvent) => {
      const st = panRef.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      if (ev.pointerType === 'mouse' && ev.buttons === 0) { up(); return; }
      const dx = ev.clientX - st.startX;
      // 3 px threshold so a plain click still reaches Recharts' tooltip.
      if (!st.moved && Math.abs(dx) <= 3) return;
      st.moved = true;
      const w = wrapRef.current?.getBoundingClientRect().width ?? 300;
      const pxPerIdx = Math.max(1, (w - 40) / Math.max(1, spanOf(st.startVp) - 1));
      setViewport(panViewport(st.startVp, weeks.length, -Math.round(dx / pxPerIdx)));
    };
    const up = () => {
      panRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cleanupPanRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    cleanupPanRef.current = up;
  };
  useEffect(() => () => { cleanupPanRef.current?.(); }, []);

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

  // Scale to what is ON SCREEN, so zooming in magnifies vertically too.
  // Rounded to 5 kg, otherwise the axis jitters on every pan step.
  const allVals = inWindow.flatMap(d => [d[planKey], d[perfKey], d[sollKey]])
    .filter((v): v is number => typeof v === 'number');

  const minY = allVals.length > 0 ? Math.max(0, Math.floor(Math.min(...allVals) / 5) * 5 - 5) : 0;
  const maxY = allVals.length > 0 ? Math.ceil(Math.max(...allVals) / 5) * 5 + 5 : 100;

  // "Now" marks the week being planned, on the numeric axis: the index of that
  // week in the grid. -1 when it is outside the fetched range.
  const anchorIndex = weeks.indexOf(anchorWeek);
  const nowAnchor = anchorIndex >= vp.start && anchorIndex <= vp.end + 1 ? anchorIndex : null;

  /** Integer ticks — one per week divider in view. Thinned so the labels stay
   *  readable when the coach zooms out to a year. */
  const tickStep = Math.max(1, Math.ceil(spanOf(vp) / 12));
  const weekTicks: number[] = [];
  for (let i = vp.start; i <= vp.end + 1 && i < weeks.length; i += tickStep) weekTicks.push(i);
  const labelForIndex = (i: number): string => {
    const ws = weeks[Math.round(i)];
    if (!ws) return '';
    return data.find(d => d.weekStart === ws)?.label ?? formatDateShort(ws);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', letterSpacing: '0.05em', flexShrink: 0 }}>
          Load history
        </span>
        {/* Where in the history the coach currently is. */}
        {weeks.length > 0 && (
          <span style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {formatDateShort(weeks[vp.start])}-{formatDateShort(weeks[Math.min(vp.end, weeks.length - 1)])}
            {' \u00b7 '}{spanOf(vp)} wk
            {inWindow.length > 0 && `, ${inWindow.filter(d => d.when).length} sessions`}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {([
            { key: 'left',  Icon: ChevronLeft,  title: 'Pan back',    onClick: () => applyPan(-Math.max(1, Math.round(spanOf(vp) / 3))), disabled: vp.start <= 0 },
            { key: 'out',   Icon: ZoomOut,      title: 'Zoom out',    onClick: () => applyZoom(1.4), disabled: isFull(vp, weeks.length) },
            { key: 'in',    Icon: ZoomIn,       title: 'Zoom in',     onClick: () => applyZoom(0.7), disabled: spanOf(vp) <= MIN_SPAN },
            { key: 'right', Icon: ChevronRight, title: 'Pan forward', onClick: () => applyPan(Math.max(1, Math.round(spanOf(vp) / 3))), disabled: vp.end >= weeks.length - 1 },
            { key: 'all',   Icon: Maximize2,    title: 'Show all',    onClick: () => { setViewport(fullViewport(weeks.length)); writeSpanPref(weeks.length); }, disabled: isFull(vp, weeks.length) },
          ] as const).map(({ key, Icon, title, onClick, disabled }) => (
            <button
              key={key}
              onClick={onClick}
              disabled={disabled}
              title={title}
              aria-label={title}
              style={{
                display: 'inline-flex', alignItems: 'center', padding: '2px 4px',
                borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent',
                color: 'var(--color-text-tertiary)', cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.25 : 1,
              }}
            >
              <Icon size={12} />
            </button>
          ))}
          <span style={{ width: 1, height: 12, background: 'var(--color-border-tertiary)', margin: '0 2px' }} aria-hidden />
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

      {/* Wheel zooms, drag pans, shift+wheel pans. touchAction 'pan-y' keeps
          vertical page scroll working on touch while claiming the horizontal
          drag. Enter is deliberately NOT handled -- the surrounding dialog
          closes on it. */}
      <div
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label="Load history chart - arrow keys pan, plus and minus zoom, 0 shows all"
        onPointerDown={onPointerDown}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); applyPan(-1); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); applyPan(1); }
          else if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(0.7); }
          else if (e.key === '-') { e.preventDefault(); applyZoom(1.4); }
          else if (e.key === '0') { e.preventDefault(); setViewport(fullViewport(weeks.length)); }
        }}
        style={{
          position: 'relative', outline: 'none',
          touchAction: 'pan-y', userSelect: 'none',
          cursor: weeks.length > spanOf(vp) ? 'grab' : 'default',
        }}
      >
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={visible} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          {/* Numeric, not category: a session sits at weekIndex + fraction-of-week,
              so two sessions in one week are two points at their own positions
              instead of one merged dot on the divider. */}
          <XAxis
            type="number"
            dataKey="x"
            domain={[vp.start, vp.end + 1]}
            allowDataOverflow
            ticks={weekTicks}
            tickFormatter={(i: number) => labelForIndex(i)}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#e5e7eb" tickLine={false}
          />
          <YAxis domain={[minY, maxY]} tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#e5e7eb" tickLine={false} width={32} />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip content={HistoryTooltip as any} />
          {nowAnchor != null && (
            <ReferenceLine x={nowAnchor} stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2"
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
      </div>

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
            Target
          </span>
        )}
      </div>
    </div>
  );
}
