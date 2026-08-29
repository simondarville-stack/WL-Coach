import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { athleteMacroScopeFilter } from '../lib/plannerMacro';
import { computeMetrics, type ComputedMetrics } from '../lib/metrics';
import { expandForCounting } from '../lib/comboExpansion';
import { weekState, type WeekState } from '../lib/weekUtils';

// Minimal exercise shape loaded for the overview (subset of Exercise columns).
interface OverviewExercise {
  name: string | null; color: string | null;
  exercise_code: string | null; counts_towards_totals: boolean | null;
}
// A combo-expanded row used only for the tick-filtered metrics (R/S/tonnage/…).
interface MetricRow {
  dayIndex: number; sets: number; reps: number;
  highestLoad: number; avgLoad: number; countsTowardsTotals: boolean;
}

// ── Types ──────────────────────────────────────────────────────────

export interface ExerciseRaw {
  dayIndex: number;
  exerciseId: string;
  color: string;
  name: string;
  code: string;
  reps: number;
  sets: number;
  highestLoad: number;
  avgLoad: number;
  tonnage: number;
  countsTowardsTotals: boolean;
  isCombo: boolean;
}

export interface ExerciseSummary {
  exerciseId: string;
  color: string;
  name: string;
  totalReps: number;
  topSet: number;
  avgLoad: number;
}

export interface MacroTargets {
  reps: number | null;
  tonnage: number | null;
  avg: number | null;
}

export interface DaySummary {
  /** The unit's own slot number — its identity in planned_exercises.day_index.
   *  NOT a weekday, and not bounded by 7: addNewDay allocates max+1, so a week
   *  that has had units added and removed can carry slot 8. */
  slotIndex: number;
  /** Weekday 0=Mon..6=Sun resolved through week_plans.day_schedule, or null
   *  when this unit has no weekday (a free "Unit N", or a straggler in an
   *  otherwise-scheduled week). */
  weekday: number | null;
  /** Clock time from day_schedule, when the coach set one. */
  time: string | null;
  /** The coach's label for the unit, from week_plans.day_labels. */
  label: string | null;
  exercises: { exerciseId: string; color: string; name: string; code: string }[];
  rawExercises: ExerciseRaw[];
  totalReps: number;
  tonnage: number;
  isLogged: boolean;
  dayMetrics: ComputedMetrics;
}

export interface WeekSummary {
  weekStart: string;
  weekPlanId: string | null;
  activeDays: number[];
  dayLabels: Record<number, string> | null;
  /** True when this week is calendar-mapped (day_schedule holds any entry), so
   *  its units carry weekdays and belong under the Mon–Sun columns. */
  isScheduled: boolean;
  /** One entry per training unit, in display order — NOT seven weekday buckets. */
  days: DaySummary[];
  totalReps: number;
  totalTonnage: number;
  avgLoad: number | null;
  /** loggedDays ÷ plannedDays — ONLY for a completed (past) week; null while in progress. */
  compliance: number | null;
  loggedDays: number;
  plannedDays: number;
  weekState: WeekState;
  weekMetrics: ComputedMetrics;
  exerciseSummaries: ExerciseSummary[];
  macroTargets: MacroTargets | null;
}

export interface MacroBlock {
  macroId: string;
  macroName: string;
  startDate: string;
  endDate: string;
  phases: PhaseBlock[];
}

export interface PhaseBlock {
  phaseId: string;
  phaseName: string;
  color: string;
  startWeek: string;
  endWeek: string;
}

// ── Internal helpers ───────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── Hook ───────────────────────────────────────────────────────────

interface LoadParams {
  targetId: string | null;
  targetGroupId: string | null;
  rangeStart: string;
  rangeEnd: string;
  competitionTotal: number | null;
}

export function usePlannerWeekOverview() {
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [macroBlocks, setMacroBlocks] = useState<MacroBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async ({
    targetId,
    targetGroupId,
    rangeStart,
    rangeEnd,
    competitionTotal,
  }: LoadParams) => {
    if (!targetId && !targetGroupId) {
      setWeeks([]);
      setMacroBlocks([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      // 1. Generate week dates in range
      const weekDates: string[] = [];
      let d = rangeStart;
      while (d <= rangeEnd) {
        weekDates.push(d);
        // add 7 days
        d = addDays(d, 7);
      }

      // 2. Fetch week plans in range. No owner_id filter — athlete_id /
      // group_id is the access boundary, and a shared athlete's plans
      // are owned by the host coach.
      let wpQuery = supabase
        .from('week_plans')
        .select('*')
        .gte('week_start', rangeStart)
        .lte('week_start', rangeEnd);

      if (targetGroupId) {
        wpQuery = wpQuery.eq('group_id', targetGroupId).eq('is_group_plan', true);
      } else if (targetId) {
        wpQuery = wpQuery.eq('athlete_id', targetId).eq('is_group_plan', false);
      }

      const { data: weekPlans } = await wpQuery;
      const wpMap = new Map<string, typeof weekPlans extends (infer T)[] | null ? T : never>();
      (weekPlans || []).forEach(wp => wpMap.set(wp.week_start, wp));

      // 3. Fetch planned exercises for all week plans
      const wpIds = (weekPlans || []).map(wp => wp.id);
      const exerciseMap = new Map<string, ExerciseRaw[]>();   // display rows (one per planned exercise)
      const metricMap = new Map<string, MetricRow[]>();       // combo-expanded rows for tick-filtered metrics

      if (wpIds.length > 0) {
        const { data: exercises } = await supabase
          .from('planned_exercises')
          .select(`
            id, weekplan_id, day_index, exercise_id, is_combo, prescription_raw, unit,
            summary_total_reps, summary_total_sets, summary_avg_load, summary_highest_load,
            exercises(name, color, exercise_code, counts_towards_totals)
          `)
          .in('weekplan_id', wpIds);

        // Combo members (with their own exercise metadata) so a combo can be
        // expanded into per-member instances when computing tick-filtered metrics.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const comboIds = (exercises || []).filter((ex: any) => ex.is_combo).map((ex: any) => ex.id);
        const membersByPe = new Map<string, { exerciseId: string; exercise: OverviewExercise; position: number }[]>();
        if (comboIds.length > 0) {
          const { data: members } = await supabase
            .from('planned_exercise_combo_members')
            .select('planned_exercise_id, exercise_id, position, exercise:exercise_id(name, color, exercise_code, counts_towards_totals)')
            .in('planned_exercise_id', comboIds);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (members || []).forEach((m: any) => {
            const arr = membersByPe.get(m.planned_exercise_id) || [];
            arr.push({ exerciseId: m.exercise_id, exercise: m.exercise, position: m.position });
            membersByPe.set(m.planned_exercise_id, arr);
          });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (exercises || []).forEach((ex: any) => {
          const key = ex.weekplan_id;
          if (!exerciseMap.has(key)) exerciseMap.set(key, []);
          if (!metricMap.has(key)) metricMap.set(key, []);

          // Display row: keep the combo as a single entry (the grid renders it
          // as one item). Reps/tonnage totals are invariant under expansion.
          const reps = ex.summary_total_reps || 0;
          const sets = ex.summary_total_sets || 0;
          const avgLoad = ex.summary_avg_load || 0;
          const highestLoad = ex.summary_highest_load || 0;
          exerciseMap.get(key)!.push({
            dayIndex: ex.day_index,
            exerciseId: ex.exercise_id,
            color: ex.exercises?.color || '#888',
            name: ex.exercises?.name || '?',
            code: ex.exercises?.exercise_code || '',
            reps,
            sets,
            highestLoad,
            avgLoad,
            tonnage: reps * avgLoad,
            countsTowardsTotals: ex.exercises?.counts_towards_totals !== false,
            isCombo: ex.is_combo === true,
          });

          // Metric rows: a combo expands into its members so each member's reps
          // count under its own tick (a combo merely governs structure).
          for (const c of expandForCounting<OverviewExercise>({
            exercise_id: ex.exercise_id,
            exercise: ex.exercises,
            unit: ex.unit ?? null,
            is_combo: ex.is_combo === true,
            prescription_raw: ex.prescription_raw ?? null,
            summary_total_sets: ex.summary_total_sets,
            summary_total_reps: ex.summary_total_reps,
            summary_highest_load: ex.summary_highest_load,
            summary_avg_load: ex.summary_avg_load,
          }, membersByPe.get(ex.id))) {
            metricMap.get(key)!.push({
              dayIndex: ex.day_index,
              sets: c.summary_total_sets,
              reps: c.summary_total_reps,
              highestLoad: c.summary_highest_load || 0,
              avgLoad: c.summary_avg_load || 0,
              countsTowardsTotals: c.exercise?.counts_towards_totals !== false,
            });
          }
        });
      }

      // 4. Fetch training log sessions for compliance
      const logMap = new Map<string, Set<number>>();
      if (targetId) {
        const { data: sessions } = await supabase
          .from('training_log_sessions')
          .select('week_start, day_index, status')
          .eq('athlete_id', targetId)
          .gte('week_start', rangeStart)
          .lte('week_start', rangeEnd);

        (sessions || []).forEach(s => {
          if (!logMap.has(s.week_start)) logMap.set(s.week_start, new Set());
          if (s.status === 'completed' || s.status === 'partial') {
            logMap.get(s.week_start)!.add(s.day_index);
          }
        });
      }

      // 5. Fetch macro context. Same access pattern as week plans —
      // a shared athlete's macrocycle is owned by the host. An individual
      // athlete inherits macros of groups they belong to (same scoping as
      // the planner's macro context, lib/plannerMacro).
      let macroQuery = supabase
        .from('macrocycles')
        .select('id, name, start_date, end_date, athlete_id')
        .lte('start_date', rangeEnd)
        .gte('end_date', rangeStart);

      if (targetGroupId) {
        macroQuery = macroQuery.eq('group_id', targetGroupId);
      } else if (targetId) {
        macroQuery = macroQuery.or(await athleteMacroScopeFilter(targetId));
      }

      const { data: macros } = await macroQuery;
      const blocks: MacroBlock[] = [];
      const macroWeekTargetMap = new Map<string, MacroTargets>();

      if (macros && macros.length > 0) {
        const macroIds = macros.map(m => m.id);
        const { data: phases } = await supabase
          .from('macro_phases')
          .select('*')
          .in('macrocycle_id', macroIds)
          .order('position');

        const { data: macroWeeks } = await supabase
          .from('macro_weeks')
          .select('*')
          .in('macrocycle_id', macroIds)
          .order('week_number');

        // Build weekStart → macro targets map. Where an athlete's own macro
        // and an inherited group macro cover the same week, the own macro wins.
        const ownedMacroIds = new Set(macros.filter(m => m.athlete_id != null).map(m => m.id));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (macroWeeks || []).forEach((mw: any) => {
          if (!ownedMacroIds.has(mw.macrocycle_id) && macroWeekTargetMap.has(mw.week_start)) return;
          macroWeekTargetMap.set(mw.week_start, {
            reps: mw.total_reps_target ?? null,
            tonnage: mw.tonnage_target ?? null,
            avg: mw.avg_intensity_target ?? null,
          });
        });

        macros.forEach(macro => {
          const mPhases = (phases || []).filter(p => p.macrocycle_id === macro.id);
          const mWeeks = (macroWeeks || []).filter(w => w.macrocycle_id === macro.id);

          const phaseBlocks: PhaseBlock[] = mPhases.map(phase => {
            const startWk = mWeeks.find(w => w.week_number === phase.start_week_number);
            const endWk = mWeeks.find(w => w.week_number === phase.end_week_number);
            return {
              phaseId: phase.id,
              phaseName: phase.name,
              color: phase.color || '#888',
              startWeek: startWk?.week_start || macro.start_date,
              endWeek: endWk ? addDays(endWk.week_start, 6) : macro.end_date,
            };
          });

          blocks.push({
            macroId: macro.id,
            macroName: macro.name,
            startDate: macro.start_date,
            endDate: macro.end_date,
            phases: phaseBlocks,
          });
        });
      }

      setMacroBlocks(blocks);

      // 6. Build week summaries
      const summaries: WeekSummary[] = weekDates.map(ws => {
        const wp = wpMap.get(ws);
        const wpExercises: ExerciseRaw[] = wp ? (exerciseMap.get(wp.id) || []) : [];
        const wpMetricRows: MetricRow[] = wp ? (metricMap.get(wp.id) || []) : [];
        const activeDays = wp?.active_days || [];
        const logged = logMap.get(ws) || new Set<number>();

        // Build per-exercise summary (aggregate across days)
        const exSummaryMap = new Map<string, {
          color: string; name: string;
          totalReps: number; topSet: number;
          weightedLoadSum: number; tonnage: number;
        }>();
        for (const ex of wpExercises) {
          if (!ex.countsTowardsTotals) continue;
          if (!exSummaryMap.has(ex.exerciseId)) {
            exSummaryMap.set(ex.exerciseId, {
              color: ex.color, name: ex.name,
              totalReps: 0, topSet: 0, weightedLoadSum: 0, tonnage: 0,
            });
          }
          const s = exSummaryMap.get(ex.exerciseId)!;
          s.totalReps += ex.reps;
          s.topSet = Math.max(s.topSet, ex.highestLoad);
          s.weightedLoadSum += ex.avgLoad * ex.reps;
          s.tonnage += ex.tonnage;
        }
        const exerciseSummaries: ExerciseSummary[] = Array.from(exSummaryMap.entries()).map(([id, s]) => ({
          exerciseId: id,
          color: s.color,
          name: s.name,
          totalReps: s.totalReps,
          topSet: s.topSet,
          avgLoad: s.totalReps > 0 ? Math.round(s.weightedLoadSum / s.totalReps) : 0,
        }));

        // Build one summary per training UNIT. The old shape was seven buckets
        // indexed 0..6 by day_index, which conflated the slot number with the
        // weekday and silently dropped any unit at slot >= 7 — from the grid
        // AND from every total derived from it.
        const schedule = wp?.day_schedule ?? null;
        const dayLabels = wp?.day_labels ?? null;
        const slotSet = new Set<number>(activeDays);
        wpExercises.forEach(e => slotSet.add(e.dayIndex));
        // A logged session on a slot the plan no longer carries is still
        // something that happened this week; show it rather than hide it.
        logged.forEach(di => slotSet.add(di));

        // Display order follows the coach's own arrangement when there is one
        // (the Day-config modal writes day_display_order), else slot order.
        const displayOrder = wp?.day_display_order ?? [];
        const orderRank = (slot: number) => {
          const i = displayOrder.indexOf(slot);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const slots = Array.from(slotSet).sort(
          (a, b) => (orderRank(a) - orderRank(b)) || (a - b),
        );

        const days: DaySummary[] = slots.map(slot => {
          const dayExs = wpExercises.filter(e => e.dayIndex === slot);
          const entry = schedule?.[slot];
          return {
            slotIndex: slot,
            weekday: entry?.weekday ?? null,
            time: entry?.time ?? null,
            label: dayLabels?.[slot] ?? null,
            exercises: dayExs.map(e => ({ exerciseId: e.exerciseId, color: e.color, name: e.name, code: e.code })),
            rawExercises: dayExs,
            totalReps: dayExs.reduce((s, e) => s + e.reps, 0),
            tonnage: dayExs.reduce((s, e) => s + e.tonnage, 0),
            isLogged: logged.has(slot),
            dayMetrics: computeMetrics(
              wpMetricRows.filter(e => e.dayIndex === slot).map(e => ({
                summary_total_sets: e.sets,
                summary_total_reps: e.reps,
                summary_highest_load: e.highestLoad,
                summary_avg_load: e.avgLoad,
                counts_towards_totals: e.countsTowardsTotals,
              })),
              competitionTotal,
            ),
          };
        });

        // Week-level metrics
        const weekMetrics = computeMetrics(
          wpMetricRows.map(e => ({
            summary_total_sets: e.sets,
            summary_total_reps: e.reps,
            summary_highest_load: e.highestLoad,
            summary_avg_load: e.avgLoad,
            counts_towards_totals: e.countsTowardsTotals,
          })),
          competitionTotal,
        );

        // Totals read the exercise rows directly, so they cannot drift from
        // however the grid happens to bucket units into columns.
        const totalReps = wpExercises.reduce((s, e) => s + e.reps, 0);
        const totalTonnage = wpExercises.reduce((s, e) => s + e.tonnage, 0);
        const avgLoad = totalReps > 0 ? Math.round(totalTonnage / totalReps) : null;
        const plannedDays = days.filter(d => d.exercises.length > 0).length;
        // Compliance asks "did they train what was written", so a logged bonus
        // session counts as neither numerator nor denominator — it is shown in
        // the grid but would otherwise push compliance above 100%.
        const loggedDays = days.filter(d => d.isLogged && d.exercises.length > 0).length;
        // A graded compliance % is a source of truth only once the week is over;
        // the current/future week reports progress (loggedDays / plannedDays) instead.
        const state = weekState(ws);
        const compliance = state === 'past' && plannedDays > 0 ? loggedDays / plannedDays : null;

        return {
          weekStart: ws,
          weekPlanId: wp?.id || null,
          activeDays,
          dayLabels: wp?.day_labels || null,
          isScheduled: !!schedule && Object.keys(schedule).length > 0,
          days,
          totalReps,
          totalTonnage,
          avgLoad,
          compliance,
          loggedDays,
          plannedDays,
          weekState: state,
          weekMetrics,
          exerciseSummaries,
          macroTargets: macroWeekTargetMap.get(ws) ?? null,
        };
      });

      setWeeks(summaries);
    } catch (err) {
      console.error('Couldn’t load week overview:. Check your connection and try again.', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    weeks,
    macroBlocks,
    loading,
    loadData,
  };
}
