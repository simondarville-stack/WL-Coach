import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import {
  computeMetrics,
  formatMetricValue,
  METRICS,
  DEFAULT_VISIBLE_METRICS,
  type MetricKey,
  type ComputedMetrics,
} from '../../lib/metrics';
import { MetricStrip } from '../ui/MetricStrip';
import type { Athlete, TrainingGroup } from '../../lib/database.types';

// ── Types ──────────────────────────────────────────────────────────

interface ExerciseRaw {
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

interface ExerciseSummary {
  exerciseId: string;
  color: string;
  name: string;
  totalReps: number;
  topSet: number;
  avgLoad: number;
}

interface MacroTargets {
  reps: number | null;
  tonnage: number | null;
  avg: number | null;
}

interface WeekSummary {
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

interface DaySummary {
  dayIndex: number;
  exercises: { exerciseId: string; color: string; name: string; code: string }[];
  rawExercises: ExerciseRaw[];
  totalReps: number;
  tonnage: number;
  isRest: boolean;
  isLogged: boolean;
  dayMetrics: ComputedMetrics;
}

interface MacroBlock {
  macroId: string;
  macroName: string;
  startDate: string;
  endDate: string;
  phases: PhaseBlock[];
}

interface PhaseBlock {
  phaseId: string;
  phaseName: string;
  color: string;
  startWeek: string;
  endWeek: string;
}

interface PlannerWeekOverviewProps {
  athlete: Athlete | null;
  group: TrainingGroup | null;
  onSelectWeek: (weekStart: string) => void;
  visibleMetrics?: MetricKey[];       // day card metrics (visible_card_metrics)
  visibleSummaryMetrics?: MetricKey[]; // week stats column (visible_summary_metrics)
  competitionTotal?: number | null;
}

// ── Constants ──────────────────────────────────────────────────────

const WEEKS_BACK = 2;
const WEEKS_FORWARD = 2;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

/** Timezone-safe "Monday of current week" as local YYYY-MM-DD */
function getTodayMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

const EMPTY_METRICS: ComputedMetrics = { reps: 0, sets: 0, max: 0, avg: 0, tonnage: 0, k: null };

// ── Component ──────────────────────────────────────────────────────

export function PlannerWeekOverview({
  athlete,
  group,
  onSelectWeek,
  visibleMetrics = DEFAULT_VISIBLE_METRICS,
  visibleSummaryMetrics = DEFAULT_VISIBLE_METRICS,
  competitionTotal = null,
}: PlannerWeekOverviewProps) {
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [macroBlocks, setMacroBlocks] = useState<MacroBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [centerDate, setCenterDate] = useState(() => getTodayMonday());
  const currentWeekRef = useRef<HTMLDivElement>(null);

  const today = getTodayMonday();
  const rangeStart = addWeeks(centerDate, -WEEKS_BACK);
  const rangeEnd = addWeeks(centerDate, WEEKS_FORWARD);

  const targetId = athlete?.id || null;
  const targetGroupId = group?.id || null;

  // ── Load data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
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
        d = addWeeks(d, 1);
      }

      // 2. Fetch week plans in range
      let wpQuery = supabase
        .from('week_plans')
        .select('*')
        .eq('owner_id', getOwnerId())
        .gte('week_start', rangeStart)
        .lte('week_start', rangeEnd);

      if (group) {
        wpQuery = wpQuery.eq('group_id', group.id).eq('is_group_plan', true);
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

      if (group) {
        macroQuery = macroQuery.eq('group_id', group.id);
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
          .select('macrocycle_id, week_number, week_start, week_type, total_reps_target, tonnage_target, avg_intensity_target')
          .in('macrocycle_id', macroIds)
          .order('week_number');

        // Build weekStart → macro targets map
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
    } catch (err) {
      console.error('Failed to load week overview:', err);
    } finally {
      setLoading(false);
    }
  }, [targetId, targetGroupId, rangeStart, rangeEnd, competitionTotal]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Helpers ──────────────────────────────────────────────────────

  function getMacroForWeek(weekStart: string): MacroBlock | null {
    return macroBlocks.find(m =>
      weekStart >= m.startDate && weekStart <= m.endDate
    ) || null;
  }

  function getPhaseForWeek(weekStart: string): { macro: MacroBlock; phase: PhaseBlock } | null {
    for (const macro of macroBlocks) {
      for (const phase of macro.phases) {
        if (weekStart >= phase.startWeek && weekStart <= phase.endWeek) {
          return { macro, phase };
        }
      }
    }
    return null;
  }

  function getPhaseLabel(weekStart: string, prevWeekStart: string | null): string | null {
    const current = getPhaseForWeek(weekStart);
    const prev = prevWeekStart ? getPhaseForWeek(prevWeekStart) : null;

    if (current && (!prev || prev.phase.phaseId !== current.phase.phaseId)) {
      return current.phase.phaseName;
    }

    const currentMacro = getMacroForWeek(weekStart);
    const prevMacro = prevWeekStart ? getMacroForWeek(prevWeekStart) : null;
    if (currentMacro && (!prevMacro || prevMacro.macroId !== currentMacro.macroId)) {
      return currentMacro.macroName;
    }

    return null;
  }

  const handleTodayClick = () => {
    const newCenter = getTodayMonday();
    setCenterDate(newCenter);
    setTimeout(() => {
      currentWeekRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  // ── Derive macro context for header ─────────────────────────────
  const currentMacro = getMacroForWeek(today);
  const currentPhaseInfo = getPhaseForWeek(today);

  // ── Render ───────────────────────────────────────────────────────

  if (!athlete && !group) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Select an athlete or group to view the weekly overview.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading weeks...
      </div>
    );
  }

  const maxTonnage = Math.max(...weeks.map(w => w.totalTonnage), 1);

  return (
    <div className="flex flex-col gap-3 py-4 px-2">
      {/* Macro context bar */}
      {currentMacro && (
        <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
          <span className="px-2.5 py-0.5 text-[10px] font-medium rounded-full border"
            style={{
              color: currentPhaseInfo?.phase.color || '#7F77DD',
              borderColor: currentPhaseInfo?.phase.color || '#7F77DD',
              backgroundColor: (currentPhaseInfo?.phase.color || '#7F77DD') + '15',
            }}
          >
            {currentMacro.macroName}
          </span>
          {currentPhaseInfo && (
            <span className="text-[11px] text-gray-500">
              {currentPhaseInfo.phase.phaseName}
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-400">
            {formatDateShort(currentMacro.startDate)} – {formatDateShort(currentMacro.endDate)}
          </span>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCenterDate(addWeeks(centerDate, -1))}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          <ChevronLeft size={14} /> Earlier
        </button>
        <button
          onClick={handleTodayClick}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <CalendarDays size={13} /> Today
        </button>
        <button
          onClick={() => setCenterDate(addWeeks(centerDate, 1))}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          Later <ChevronRight size={14} />
        </button>
      </div>

      {/* Volume ribbon */}
      <div className="flex gap-0.5 items-end h-7 px-[72px]">
        {weeks.map(w => {
          const h = maxTonnage > 0 ? (w.totalTonnage / maxTonnage) * 100 : 0;
          const phaseInfo = getPhaseForWeek(w.weekStart);
          const color = phaseInfo?.phase.color || '#888';
          const isCurrent = w.weekStart === today;
          return (
            <div
              key={w.weekStart}
              className="flex-1 rounded-t-sm transition-all"
              style={{
                height: `${Math.max(h, 2)}%`,
                backgroundColor: color + (isCurrent ? '50' : '25'),
                border: isCurrent ? `1px solid ${color}80` : 'none',
              }}
            />
          );
        })}
      </div>

      {/* Week rows */}
      <div className="flex flex-col">
        {weeks.map((week, idx) => {
          const isCurrent = week.weekStart === today;
          const isPast = week.weekStart < today;
          const isFuture = week.weekStart > today;
          const isEmpty = week.weekPlanId === null;
          const endDate = addDays(week.weekStart, 6);

          const prevWeek = idx > 0 ? weeks[idx - 1].weekStart : null;
          const sectionLabel = getPhaseLabel(week.weekStart, prevWeek);

          const macro = getMacroForWeek(week.weekStart);
          let weekNum: string | null = null;
          if (macro) {
            const macroStart = new Date(macro.startDate + 'T00:00:00');
            const weekDate = new Date(week.weekStart + 'T00:00:00');
            const diffWeeks = Math.floor((weekDate.getTime() - macroStart.getTime()) / (7 * 86400000)) + 1;
            if (diffWeeks > 0) weekNum = `W${diffWeeks}`;
          }

          const hasExercises = week.exerciseSummaries.length > 0;

          return (
            <div key={week.weekStart} ref={isCurrent ? currentWeekRef : undefined}>
              {sectionLabel && (
                <div className="flex items-center gap-2 py-2 mt-2">
                  <span className="text-[10px] text-gray-400 font-medium">{sectionLabel}</span>
                  <span className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              <div
                onClick={() => onSelectWeek(week.weekStart)}
                className={`flex flex-col py-3 px-3 -mx-3 rounded-xl cursor-pointer transition-colors ${
                  isCurrent
                    ? 'bg-blue-100 border-2 border-blue-400 shadow-sm'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                {/* ── Top row: meta + day blocks + stats ── */}
                <div className="flex gap-3 items-stretch">
                  {/* Meta column */}
                  <div className="w-[76px] flex-shrink-0 flex flex-col justify-center">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-gray-900">
                        {weekNum || formatDateShort(week.weekStart).split(' ')[1]}
                      </span>
                      {isCurrent && (
                        <span className="text-[7px] font-medium bg-red-100 text-red-600 px-1 py-px rounded">
                          now
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {formatDateShort(week.weekStart)}–{formatDateShort(endDate).split(' ')[1]}
                    </div>
                    {week.compliance !== null && (
                      <div className="mt-1.5">
                        <div className="h-[3px] bg-gray-100 rounded-full overflow-hidden w-full">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(week.compliance * 100)}%`,
                              backgroundColor: week.compliance >= 0.9 ? '#639922'
                                : week.compliance >= 0.5 ? '#378ADD'
                                : '#BA7517',
                            }}
                          />
                        </div>
                        <span className="text-[9px] text-gray-400 mt-0.5">
                          Done: {Math.round(week.compliance * 100)}%{isCurrent && week.compliance < 1 ? ' (prog.)' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Day blocks */}
                  <div className="flex-1 flex gap-1 items-stretch" style={{ minHeight: 90 }}>
                    {week.days.map((day) => {
                      const di = day.dayIndex;
                      const dayIsFuture = isFuture || (isCurrent && di >= new Date().getDay() - 1);
                      const hasData = day.exercises.length > 0;
                      const faded = dayIsFuture && !isPast;

                      return (
                        <div
                          key={di}
                          className={`flex-1 rounded-md flex flex-col px-1 pt-1 pb-1.5 min-w-0 ${
                            day.isRest
                              ? isCurrent ? 'bg-blue-50 opacity-40' : 'bg-gray-50 opacity-30'
                              : isEmpty
                              ? 'border border-dashed border-gray-200'
                              : faded
                              ? isCurrent
                                ? 'border border-dashed border-blue-300 bg-white/70'
                                : 'border border-dashed border-gray-300 bg-gray-50/40'
                              : isCurrent
                              ? 'border border-blue-300 bg-white shadow-sm'
                              : 'border border-gray-200 bg-white'
                          }`}
                        >
                          {/* Day label */}
                          <div className="text-[8px] font-medium text-gray-500 text-center mb-1">{DAY_LABELS[di]}</div>

                          {/* Exercise bands — colored stripe + name */}
                          <div className="flex flex-col gap-0.5 flex-1">
                            {day.exercises.slice(0, 6).map((ex, ei) => (
                              <div
                                key={ei}
                                className="rounded-sm px-1 py-px flex items-center gap-1 min-w-0"
                                style={{
                                  backgroundColor: ex.color + (faded ? '15' : '22'),
                                  borderLeft: `2.5px solid ${ex.color}${faded ? '55' : 'cc'}`,
                                }}
                              >
                                <span
                                  className="text-[9px] leading-snug font-semibold truncate"
                                  style={{ color: faded ? '#9ca3af' : '#1f2937' }}
                                >
                                  {ex.name}
                                </span>
                              </div>
                            ))}
                            {day.exercises.length > 6 && (
                              <span className="text-[7px] text-gray-400 pl-1">+{day.exercises.length - 6}</span>
                            )}
                          </div>

                          {/* Metric strip */}
                          {hasData && (
                            <MetricStrip
                              metrics={day.dayMetrics}
                              visibleMetrics={visibleMetrics}
                              size="sm"
                              showLabels={false}
                              separator="·"
                              className={`text-[8px] leading-tight justify-center mt-1 ${faded ? 'opacity-40' : ''}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Stats column — uses visible_summary_metrics, two columns: target | planned */}
                  <div className="w-[170px] flex-shrink-0 flex flex-col justify-center pl-3 border-l border-gray-200">
                    {/* Column headers */}
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-10 text-[8px] text-gray-400" />
                      <div className="flex-1 text-[8px] text-gray-400 text-right">Target</div>
                      <div className="flex-1 text-[8px] text-gray-500 font-medium text-right">Planned</div>
                    </div>
                    {METRICS.filter(m => (visibleSummaryMetrics as string[]).includes(m.key)).map(m => {
                      const actualVal = week.weekMetrics[m.key] as number | null;
                      const targetVal = week.macroTargets
                        ? m.key === 'reps' ? week.macroTargets.reps
                          : m.key === 'tonnage' ? week.macroTargets.tonnage
                          : m.key === 'avg' ? week.macroTargets.avg
                          : null
                        : null;
                      return (
                        <div key={m.key} className="flex items-center gap-1 py-px">
                          <div className="w-10 text-[9px] text-gray-500 font-medium">{m.label}</div>
                          <div className="flex-1 text-[10px] text-gray-400 text-right tabular-nums">
                            {formatMetricValue(m.key, targetVal)}
                          </div>
                          <div className="flex-1 text-[10px] font-semibold text-gray-700 text-right tabular-nums">
                            {formatMetricValue(m.key, actualVal)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hint */}
      <div className="text-[9px] text-gray-400 text-center pt-2">
        Click any week to open the planner
      </div>
    </div>
  );
}
