import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import {
  buildCellsForWeekRange,
  fetchMacroPhaseBarEvents,
  resolveScopeAthleteIds,
} from '../lib/macroPhaseBarData';
import { computeMetrics, type ComputedMetrics } from '../lib/metrics';
import type { MacroPhase, MacroWeek, WeekTypeConfig } from '../lib/database.types';
import type { MacroPhaseBarEvent } from '../components/planning';

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
  dayIndex: number;
  exercises: { exerciseId: string; color: string; name: string; code: string }[];
  rawExercises: ExerciseRaw[];
  totalReps: number;
  tonnage: number;
  isRest: boolean;
  isLogged: boolean;
  dayMetrics: ComputedMetrics;
}

export interface WeekSummary {
  weekStart: string;
  weekPlanId: string | null;
  activeDays: number[];
  dayLabels: Record<number, string> | null;
  days: DaySummary[];
  totalReps: number;
  totalTonnage: number;
  avgLoad: number | null;
  compliance: number | null;
  loggedDays: number;
  plannedDays: number;
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
  const [rawMacros, setRawMacros] = useState<Array<{ id: string; name: string }>>([]);
  const [rawPhases, setRawPhases] = useState<MacroPhase[]>([]);
  const [rawMacroWeeks, setRawMacroWeeks] = useState<MacroWeek[]>([]);
  const [weekTypeConfigs, setWeekTypeConfigs] = useState<WeekTypeConfig[]>([]);
  const [barEvents, setBarEvents] = useState<MacroPhaseBarEvent[]>([]);
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
      setRawMacros([]);
      setRawPhases([]);
      setRawMacroWeeks([]);
      setBarEvents([]);
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

      // 2. Fetch week plans in range
      let wpQuery = supabase
        .from('week_plans')
        .select('*')
        .eq('owner_id', getOwnerId())
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
      const exerciseMap = new Map<string, ExerciseRaw[]>();

      if (wpIds.length > 0) {
        const { data: exercises } = await supabase
          .from('planned_exercises')
          .select(`
            weekplan_id, day_index, exercise_id,
            summary_total_reps, summary_total_sets, summary_avg_load, summary_highest_load,
            exercises(name, color, exercise_code, counts_towards_totals)
          `)
          .in('weekplan_id', wpIds);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (exercises || []).forEach((ex: any) => {
          const key = ex.weekplan_id;
          if (!exerciseMap.has(key)) exerciseMap.set(key, []);
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
          });
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

      // 5. Fetch macro context
      let macroQuery = supabase
        .from('macrocycles')
        .select('id, name, start_date, end_date')
        .eq('owner_id', getOwnerId())
        .lte('start_date', rangeEnd)
        .gte('end_date', rangeStart);

      if (targetGroupId) {
        macroQuery = macroQuery.eq('group_id', targetGroupId);
      } else if (targetId) {
        macroQuery = macroQuery.eq('athlete_id', targetId);
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

        setRawMacros(macros.map(m => ({ id: m.id, name: m.name })));
        setRawPhases((phases as MacroPhase[]) ?? []);
        setRawMacroWeeks((macroWeeks as MacroWeek[]) ?? []);

        // Build weekStart → macro targets map
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (macroWeeks || []).forEach((mw: any) => {
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
      } else {
        setRawMacros([]);
        setRawPhases([]);
        setRawMacroWeeks([]);
      }

      setMacroBlocks(blocks);

      // 6. Build week summaries
      const summaries: WeekSummary[] = weekDates.map(ws => {
        const wp = wpMap.get(ws);
        const wpExercises: ExerciseRaw[] = wp ? (exerciseMap.get(wp.id) || []) : [];
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

        // Build day summaries
        const days: DaySummary[] = [];
        for (let di = 0; di < 7; di++) {
          const dayExs = wpExercises.filter(e => e.dayIndex === di);
          const isRest = !activeDays.includes(di);
          const dayMetrics = computeMetrics(
            dayExs.map(e => ({
              summary_total_sets: e.sets,
              summary_total_reps: e.reps,
              summary_highest_load: e.highestLoad,
              summary_avg_load: e.avgLoad,
              counts_towards_totals: e.countsTowardsTotals,
            })),
            competitionTotal,
          );
          days.push({
            dayIndex: di,
            exercises: dayExs.map(e => ({ exerciseId: e.exerciseId, color: e.color, name: e.name, code: e.code })),
            rawExercises: dayExs,
            totalReps: dayExs.reduce((s, e) => s + e.reps, 0),
            tonnage: dayExs.reduce((s, e) => s + e.tonnage, 0),
            isRest: isRest && dayExs.length === 0,
            isLogged: logged.has(di),
            dayMetrics,
          });
        }

        // Week-level metrics
        const weekMetrics = computeMetrics(
          wpExercises.map(e => ({
            summary_total_sets: e.sets,
            summary_total_reps: e.reps,
            summary_highest_load: e.highestLoad,
            summary_avg_load: e.avgLoad,
            counts_towards_totals: e.countsTowardsTotals,
          })),
          competitionTotal,
        );

        const totalReps = days.reduce((s, d) => s + d.totalReps, 0);
        const totalTonnage = days.reduce((s, d) => s + d.tonnage, 0);
        const avgLoad = totalReps > 0 ? Math.round(totalTonnage / totalReps) : null;
        const plannedDays = days.filter(d => !d.isRest && d.exercises.length > 0).length;
        const loggedDays = days.filter(d => d.isLogged).length;
        const compliance = plannedDays > 0 ? loggedDays / plannedDays : null;

        return {
          weekStart: ws,
          weekPlanId: wp?.id || null,
          activeDays,
          dayLabels: wp?.day_labels || null,
          days,
          totalReps,
          totalTonnage,
          avgLoad,
          compliance,
          loggedDays,
          plannedDays,
          weekMetrics,
          exerciseSummaries,
          macroTargets: macroWeekTargetMap.get(ws) ?? null,
        };
      });

      setWeeks(summaries);

      // 7. Load coach-defined week type configs for the MacroPhaseBar
      const { data: settings } = await supabase
        .from('general_settings')
        .select('week_types')
        .eq('owner_id', getOwnerId())
        .maybeSingle();
      setWeekTypeConfigs(
        (settings?.week_types as WeekTypeConfig[] | undefined) ?? []
      );

      // 8. Load events for the visible range
      const evRangeStart = weekDates[0];
      const evRangeEnd = addDays(weekDates[weekDates.length - 1], 6);
      const scopeAthleteIds = await resolveScopeAthleteIds(targetId, targetGroupId);
      const fetched = await fetchMacroPhaseBarEvents(scopeAthleteIds, evRangeStart, evRangeEnd);
      setBarEvents(fetched);
    } catch (err) {
      console.error('Failed to load week overview:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const phaseBarCells = useCallback(
    (weekStarts: string[]) =>
      buildCellsForWeekRange(weekStarts, {
        macros: rawMacros,
        phases: rawPhases,
        weeks: rawMacroWeeks,
        weekTypeConfigs,
      }),
    [rawMacros, rawPhases, rawMacroWeeks, weekTypeConfigs],
  );

  return {
    weeks,
    macroBlocks,
    barEvents,
    loading,
    loadData,
    phaseBarCells,
  };
}
