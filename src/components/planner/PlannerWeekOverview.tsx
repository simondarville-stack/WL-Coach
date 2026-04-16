import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Button } from '../ui';
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
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 256, fontSize: 'var(--text-body)', color: 'var(--color-text-tertiary)',
      }}>
        Select an athlete or group to view the weekly overview.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 256, fontSize: 'var(--text-body)', color: 'var(--color-text-tertiary)',
      }}>
        Loading weeks...
      </div>
    );
  }

  const maxTonnage = Math.max(...weeks.map(w => w.totalTonnage), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 8px' }}>
      {/* Macro context bar */}
      {currentMacro && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          paddingBottom: 12, borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}>
          <span style={{
            padding: '2px 10px', fontSize: 10, fontWeight: 500,
            borderRadius: 99, border: `1px solid ${currentPhaseInfo?.phase.color || '#7F77DD'}`,
            color: currentPhaseInfo?.phase.color || '#7F77DD',
            backgroundColor: (currentPhaseInfo?.phase.color || '#7F77DD') + '15',
          }}>
            {currentMacro.macroName}
          </span>
          {currentPhaseInfo && (
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {currentPhaseInfo.phase.phaseName}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            {formatDateShort(currentMacro.startDate)} – {formatDateShort(currentMacro.endDate)}
          </span>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft size={14} />}
          onClick={() => setCenterDate(addWeeks(centerDate, -1))}
        >
          Earlier
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<CalendarDays size={13} />}
          onClick={handleTodayClick}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronRight size={14} />}
          iconPosition="right"
          onClick={() => setCenterDate(addWeeks(centerDate, 1))}
        >
          Later
        </Button>
      </div>

      {/* Volume ribbon */}
      <div style={{
        display: 'flex', gap: 2, alignItems: 'flex-end',
        height: 28, padding: '0 72px',
      }}>
        {weeks.map(w => {
          const h = maxTonnage > 0 ? (w.totalTonnage / maxTonnage) * 100 : 0;
          const phaseInfo = getPhaseForWeek(w.weekStart);
          const color = phaseInfo?.phase.color || '#888';
          const isCurrent = w.weekStart === today;
          return (
            <div
              key={w.weekStart}
              style={{
                flex: 1,
                borderRadius: '2px 2px 0 0',
                height: `${Math.max(h, 2)}%`,
                backgroundColor: color + (isCurrent ? '50' : '25'),
                border: isCurrent ? `1px solid ${color}80` : 'none',
                transition: 'height 0.2s',
              }}
            />
          );
        })}
      </div>

      {/* Week rows */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
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

          return (
            <div key={week.weekStart} ref={isCurrent ? currentWeekRef : undefined}>
              {sectionLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', marginTop: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                    {sectionLabel}
                  </span>
                  <span style={{ flex: 1, height: 1, background: 'var(--color-border-tertiary)' }} />
                </div>
              )}
              <div
                onClick={() => onSelectWeek(week.weekStart)}
                style={{
                  display: 'flex', flexDirection: 'column',
                  padding: '12px', margin: '0 -12px',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  border: isCurrent
                    ? '2px solid var(--color-accent-border)'
                    : '1px solid transparent',
                  background: isCurrent ? 'var(--color-accent-muted)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)';
                }}
                onMouseLeave={e => {
                  if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                {/* ── Top row: meta + day blocks + stats ── */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                  {/* Meta column */}
                  <div style={{ width: 76, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {weekNum || formatDateShort(week.weekStart).split(' ')[1]}
                      </span>
                      {isCurrent && (
                        <span style={{
                          fontSize: 7, fontWeight: 500, padding: '1px 4px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-danger-bg)',
                          color: 'var(--color-danger-text)',
                        }}>
                          now
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                      {formatDateShort(week.weekStart)}–{formatDateShort(endDate).split(' ')[1]}
                    </div>
                    {week.compliance !== null && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{
                          height: 3, background: 'var(--color-bg-tertiary)',
                          borderRadius: 99, overflow: 'hidden', width: '100%',
                        }}>
                          <div
                            style={{
                              height: '100%', borderRadius: 99,
                              width: `${Math.round(week.compliance * 100)}%`,
                              backgroundColor: week.compliance >= 0.9
                                ? 'var(--color-success-text)'
                                : week.compliance >= 0.5
                                ? 'var(--color-accent)'
                                : 'var(--color-warning-text)',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 2, display: 'block' }}>
                          Done: {Math.round(week.compliance * 100)}%{isCurrent && week.compliance < 1 ? ' (prog.)' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Day blocks */}
                  <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'stretch', minHeight: 90 }}>
                    {week.days.map((day) => {
                      const di = day.dayIndex;
                      const dayIsFuture = isFuture || (isCurrent && di >= new Date().getDay() - 1);
                      const hasData = day.exercises.length > 0;
                      const faded = dayIsFuture && !isPast;

                      let dayBlockStyle: React.CSSProperties;
                      if (day.isRest) {
                        dayBlockStyle = {
                          background: isCurrent ? 'var(--color-accent-muted)' : 'var(--color-bg-secondary)',
                          opacity: isCurrent ? 0.4 : 0.3,
                          border: 'none',
                        };
                      } else if (isEmpty) {
                        dayBlockStyle = {
                          border: '1px dashed var(--color-border-tertiary)',
                          background: 'transparent',
                        };
                      } else if (faded) {
                        dayBlockStyle = {
                          border: `1px dashed ${isCurrent ? 'var(--color-accent-border)' : 'var(--color-border-secondary)'}`,
                          background: isCurrent ? 'rgba(255,255,255,0.7)' : 'var(--color-bg-secondary)',
                          opacity: 0.6,
                        };
                      } else {
                        dayBlockStyle = {
                          border: `1px solid ${isCurrent ? 'var(--color-accent-border)' : 'var(--color-border-tertiary)'}`,
                          background: 'var(--color-bg-primary)',
                          boxShadow: isCurrent ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                        };
                      }

                      return (
                        <div
                          key={di}
                          style={{
                            flex: 1, borderRadius: 'var(--radius-md)',
                            display: 'flex', flexDirection: 'column',
                            padding: '4px 4px 6px', minWidth: 0,
                            ...dayBlockStyle,
                          }}
                        >
                          {/* Day label */}
                          <div style={{
                            fontSize: 8, fontWeight: 500,
                            color: 'var(--color-text-secondary)',
                            textAlign: 'center', marginBottom: 4,
                          }}>
                            {DAY_LABELS[di]}
                          </div>

                          {/* Exercise bands */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                            {day.exercises.slice(0, 6).map((ex, ei) => (
                              <div
                                key={ei}
                                style={{
                                  borderRadius: 2, padding: '1px 4px',
                                  display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
                                  backgroundColor: ex.color + (faded ? '15' : '22'),
                                  borderLeft: `2.5px solid ${ex.color}${faded ? '55' : 'cc'}`,
                                }}
                              >
                                <span style={{
                                  fontSize: 9, lineHeight: 1.3, fontWeight: 500,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  color: faded ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                                }}>
                                  {ex.name}
                                </span>
                              </div>
                            ))}
                            {day.exercises.length > 6 && (
                              <span style={{ fontSize: 7, color: 'var(--color-text-tertiary)', paddingLeft: 4 }}>
                                +{day.exercises.length - 6}
                              </span>
                            )}
                          </div>

                          {/* Metric strip */}
                          {hasData && (
                            <div style={{ opacity: faded ? 0.4 : 1, marginTop: 4 }}>
                              <MetricStrip
                                metrics={day.dayMetrics}
                                visibleMetrics={visibleMetrics}
                                size="sm"
                                showLabels={false}
                                separator="·"
                                className="text-[8px] leading-tight justify-center"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Stats column */}
                  <div style={{
                    width: 170, flexShrink: 0, display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', paddingLeft: 12,
                    borderLeft: '0.5px solid var(--color-border-tertiary)',
                  }}>
                    {/* Column headers */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <div style={{ width: 40, fontSize: 8, color: 'var(--color-text-tertiary)' }} />
                      <div style={{ flex: 1, fontSize: 8, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
                        Target
                      </div>
                      <div style={{
                        flex: 1, fontSize: 8, fontWeight: 500,
                        color: 'var(--color-text-secondary)', textAlign: 'right',
                      }}>
                        Planned
                      </div>
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
                        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0' }}>
                          <div style={{
                            width: 40, fontSize: 9, fontWeight: 500,
                            color: 'var(--color-text-secondary)',
                          }}>
                            {m.label}
                          </div>
                          <div style={{
                            flex: 1, fontSize: 10, color: 'var(--color-text-tertiary)',
                            textAlign: 'right', fontFamily: 'var(--font-mono)',
                          }}>
                            {formatMetricValue(m.key, targetVal)}
                          </div>
                          <div style={{
                            flex: 1, fontSize: 10, fontWeight: 600,
                            color: 'var(--color-text-primary)',
                            textAlign: 'right', fontFamily: 'var(--font-mono)',
                          }}>
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
      <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', textAlign: 'center', paddingTop: 8 }}>
        Click any week to open the planner
      </div>
    </div>
  );
}
