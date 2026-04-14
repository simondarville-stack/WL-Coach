import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import type { Athlete, TrainingGroup } from '../../lib/database.types';

// ── Types ──────────────────────────────────────────────────────────

interface WeekSummary {
  weekStart: string;           // ISO date string (Monday)
  weekPlanId: string | null;
  activeDays: number[];
  dayLabels: Record<number, string> | null;
  days: DaySummary[];
  totalReps: number;
  totalTonnage: number;        // in kg
  avgLoad: number | null;
  compliance: number | null;   // 0-1, null if no log data
  loggedDays: number;
  plannedDays: number;
}

interface DaySummary {
  dayIndex: number;
  exercises: { exerciseId: string; color: string; name: string }[];
  totalReps: number;
  tonnage: number;
  isRest: boolean;
  isLogged: boolean;
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
  startWeek: string;  // ISO date
  endWeek: string;    // ISO date
}

interface PlannerWeekOverviewProps {
  athlete: Athlete | null;
  group: TrainingGroup | null;
  onSelectWeek: (weekStart: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────

const WEEKS_BACK = 4;
const WEEKS_FORWARD = 8;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  High: { bg: 'rgba(226,75,74,0.1)', text: '#E24B4A' },
  Medium: { bg: 'rgba(239,159,39,0.1)', text: '#BA7517' },
  Low: { bg: 'rgba(29,158,117,0.1)', text: '#1D9E75' },
  Deload: { bg: 'rgba(93,202,165,0.1)', text: '#0F6E56' },
  Competition: { bg: 'rgba(55,138,221,0.1)', text: '#185FA5' },
  Taper: { bg: 'rgba(127,119,221,0.1)', text: '#534AB7' },
};

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function addWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

// ── Component ──────────────────────────────────────────────────────

export function PlannerWeekOverview({
  athlete,
  group,
  onSelectWeek,
}: PlannerWeekOverviewProps) {
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [macroBlocks, setMacroBlocks] = useState<MacroBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [centerDate, setCenterDate] = useState(() => getMondayOfWeekISO(new Date()));

  const today = getMondayOfWeekISO(new Date());
  const rangeStart = addWeeks(centerDate, -WEEKS_BACK);
  const rangeEnd = addWeeks(centerDate, WEEKS_FORWARD);

  const targetId = athlete?.id || null;
  const targetType = group ? 'group' : 'athlete';

  // ── Load data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!targetId && !group) {
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
      let exerciseMap = new Map<string, { dayIndex: number; exerciseId: string; color: string; name: string; reps: number; tonnage: number }[]>();

      if (wpIds.length > 0) {
        const { data: exercises } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, day_index, exercise_id, summary_total_reps, summary_avg_load, exercises(name, color, exercise_code)')
          .in('weekplan_id', wpIds);

        (exercises || []).forEach((ex: any) => {
          const key = ex.weekplan_id;
          if (!exerciseMap.has(key)) exerciseMap.set(key, []);
          const reps = ex.summary_total_reps || 0;
          const avgLoad = ex.summary_avg_load || 0;
          exerciseMap.get(key)!.push({
            dayIndex: ex.day_index,
            exerciseId: ex.exercise_id,
            color: ex.exercises?.color || '#888',
            name: ex.exercises?.exercise_code || ex.exercises?.name || '?',
            reps,
            tonnage: reps * avgLoad,
          });
        });
      }

      // 4. Fetch training log sessions for compliance
      let logMap = new Map<string, Set<number>>(); // weekStart → Set of day indices logged
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

      if (macros && macros.length > 0) {
        const macroIds = macros.map(m => m.id);
        const { data: phases } = await supabase
          .from('macro_phases')
          .select('*')
          .in('macrocycle_id', macroIds)
          .order('position');

        const { data: macroWeeks } = await supabase
          .from('macro_weeks')
          .select('macrocycle_id, week_number, week_start, week_type')
          .in('macrocycle_id', macroIds)
          .order('week_number');

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
        const wpExercises = wp ? (exerciseMap.get(wp.id) || []) : [];
        const activeDays = wp?.active_days || [];
        const logged = logMap.get(ws) || new Set<number>();

        // Build day summaries
        const days: DaySummary[] = [];
        for (let di = 0; di < 7; di++) {
          const dayExs = wpExercises.filter(e => e.dayIndex === di);
          const isRest = !activeDays.includes(di);
          days.push({
            dayIndex: di,
            exercises: dayExs.map(e => ({ exerciseId: e.exerciseId, color: e.color, name: e.name })),
            totalReps: dayExs.reduce((s, e) => s + e.reps, 0),
            tonnage: dayExs.reduce((s, e) => s + e.tonnage, 0),
            isRest: isRest && dayExs.length === 0,
            isLogged: logged.has(di),
          });
        }

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
        };
      });

      setWeeks(summaries);
    } catch (err) {
      console.error('Failed to load week overview:', err);
    } finally {
      setLoading(false);
    }
  }, [targetId, group, rangeStart, rangeEnd]);

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

  function getWeekTypeForWeek(weekStart: string): { type: string; text: string | null } | null {
    // Check macro_weeks for this week's type
    // Since we don't have macro_weeks in state, we'll skip for now
    // Claude Code can wire this up with the actual data
    return null;
  }

  // Group weeks by macro/phase for section labels
  function getPhaseLabel(weekStart: string, prevWeekStart: string | null): string | null {
    const current = getPhaseForWeek(weekStart);
    const prev = prevWeekStart ? getPhaseForWeek(prevWeekStart) : null;

    if (current && (!prev || prev.phase.phaseId !== current.phase.phaseId)) {
      return current.phase.phaseName;
    }

    // Check if entering a new macro
    const currentMacro = getMacroForWeek(weekStart);
    const prevMacro = prevWeekStart ? getMacroForWeek(prevWeekStart) : null;
    if (currentMacro && (!prevMacro || prevMacro.macroId !== currentMacro.macroId)) {
      return currentMacro.macroName;
    }

    return null;
  }

  // ── Determine macro context for header ───────────────────────────
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

  // Volume bar data
  const maxTonnage = Math.max(...weeks.map(w => w.totalTonnage), 1);

  return (
    <div className="flex flex-col gap-3 py-4 px-4 max-w-[800px] mx-auto">
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
          onClick={() => setCenterDate(addWeeks(centerDate, -4))}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          <ChevronLeft size={14} /> Earlier
        </button>
        <button
          onClick={() => setCenterDate(getMondayOfWeekISO(new Date()))}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <CalendarDays size={13} /> Today
        </button>
        <button
          onClick={() => setCenterDate(addWeeks(centerDate, 4))}
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

          // Phase separator
          const prevWeek = idx > 0 ? weeks[idx - 1].weekStart : null;
          const sectionLabel = getPhaseLabel(week.weekStart, prevWeek);

          // Macro week number
          const macro = getMacroForWeek(week.weekStart);
          let weekNum: string | null = null;
          if (macro) {
            const macroStart = new Date(macro.startDate);
            const weekDate = new Date(week.weekStart);
            const diffWeeks = Math.floor((weekDate.getTime() - macroStart.getTime()) / (7 * 86400000)) + 1;
            if (diffWeeks > 0) weekNum = `W${diffWeeks}`;
          }

          return (
            <div key={week.weekStart}>
              {sectionLabel && (
                <div className="flex items-center gap-2 py-2 mt-2">
                  <span className="text-[10px] text-gray-400 font-medium">{sectionLabel}</span>
                  <span className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              <div
                onClick={() => onSelectWeek(week.weekStart)}
                className={`flex gap-1.5 items-stretch py-2 px-2 -mx-2 rounded-lg cursor-pointer transition-colors ${
                  isCurrent
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                {/* Meta column */}
                <div className="w-[60px] flex-shrink-0 flex flex-col justify-center">
                  <div className="flex items-center gap-1">
                    <span className="text-[13px] font-medium text-gray-900">
                      {weekNum || formatDateShort(week.weekStart).split(' ')[1]}
                    </span>
                    {isCurrent && (
                      <span className="text-[7px] font-medium bg-red-100 text-red-600 px-1 py-px rounded">
                        now
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-0.5">
                    {formatDateShort(week.weekStart)}–{formatDateShort(endDate).split(' ')[1]}
                  </div>
                </div>

                {/* Day blocks */}
                <div className="flex-1 flex gap-0.5 items-stretch" style={{ minHeight: 44 }}>
                  {week.days.map((day, di) => {
                    const dayIsPast = isPast || (isCurrent && di < new Date().getDay() - 1);
                    const dayIsFuture = isFuture || (isCurrent && di >= new Date().getDay() - 1);

                    return (
                      <div
                        key={di}
                        className={`flex-1 rounded flex flex-col p-0.5 min-w-0 ${
                          day.isRest
                            ? 'bg-gray-50 opacity-40'
                            : isEmpty
                            ? 'border border-dashed border-gray-200'
                            : dayIsFuture && !isPast
                            ? 'border border-dashed border-gray-300'
                            : 'border border-gray-200 bg-white'
                        }`}
                      >
                        <div className="text-[7px] text-gray-400 text-center">{DAY_LABELS[di]}</div>
                        <div className="flex flex-col gap-px flex-1 mt-0.5">
                          {day.exercises.slice(0, 5).map((ex, ei) => (
                            <div
                              key={ei}
                              className="h-[3px] rounded-sm"
                              style={{
                                backgroundColor: ex.color,
                                opacity: dayIsFuture && !isPast ? 0.25 : 0.65,
                              }}
                            />
                          ))}
                        </div>
                        {day.tonnage > 0 && !day.isRest && (
                          <div className="text-[7px] font-mono text-gray-400 text-center mt-auto">
                            {(day.tonnage / 1000).toFixed(1)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Stats column */}
                <div className="w-[110px] flex-shrink-0 flex flex-col justify-center gap-0.5 pl-2 border-l border-gray-200">
                  <div className="flex justify-between text-[9px]">
                    <span className="text-gray-400">Reps</span>
                    <span className={`font-mono text-[10px] ${week.totalReps > 0 ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>
                      {week.totalReps > 0 ? (
                        isCurrent && week.compliance !== null && week.compliance < 1
                          ? `${Math.round(week.totalReps * (week.compliance || 0))} / ${week.totalReps}`
                          : week.totalReps
                      ) : (
                        isEmpty ? '—' : '0'
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-[9px]">
                    <span className="text-gray-400">Tonnage</span>
                    <span className={`font-mono text-[10px] ${week.totalTonnage > 0 ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>
                      {week.totalTonnage > 0 ? `${(week.totalTonnage / 1000).toFixed(1)}t` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[9px]">
                    <span className="text-gray-400">Avg</span>
                    <span className={`font-mono text-[10px] ${week.avgLoad ? 'text-gray-700' : 'text-gray-300'}`}>
                      {week.avgLoad ? `${week.avgLoad} kg` : '—'}
                    </span>
                  </div>
                  {/* Compliance bar */}
                  <div className="h-[3px] bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                    {week.compliance !== null && (
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round(week.compliance * 100)}%`,
                          backgroundColor: week.compliance >= 0.9 ? '#639922'
                            : week.compliance >= 0.5 ? '#378ADD'
                            : '#BA7517',
                        }}
                      />
                    )}
                  </div>
                  {week.compliance !== null && (
                    <span
                      className="text-[8px] font-medium px-1 py-px rounded self-start"
                      style={{
                        backgroundColor: week.compliance >= 0.9 ? 'rgba(99,153,34,0.1)'
                          : week.compliance >= 0.5 ? 'rgba(55,138,221,0.1)'
                          : 'rgba(186,117,23,0.1)',
                        color: week.compliance >= 0.9 ? '#3B6D11'
                          : week.compliance >= 0.5 ? '#185FA5'
                          : '#854F0B',
                      }}
                    >
                      {isCurrent && week.compliance < 1
                        ? `${Math.round(week.compliance * 100)}% in progress`
                        : `${Math.round(week.compliance * 100)}% done`}
                    </span>
                  )}
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
