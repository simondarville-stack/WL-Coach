// @ts-nocheck
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { getMonday, toISODate, addDays, dayLabel, formatDateShort } from '../lib/dateHelpers';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Dumbbell } from 'lucide-react';
import type { PlannedExercise, Exercise, PlannedSetLine, WeekPlan } from '../../lib/database.types';

interface DayData {
  dayIndex: number;
  label: string;
  dateStr: string;
  exercises: (PlannedExercise & { exercise: Exercise; set_lines: PlannedSetLine[] })[];
}

export function WeekScreen() {
  const { athlete } = useAuth();
  const [weekStart, setWeekStart] = useState(() => toISODate(getMonday(new Date())));
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [days, setDays] = useState<DayData[]>([]);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (athlete) loadWeek();
  }, [athlete, weekStart]);

  async function loadWeek() {
    if (!athlete) return;
    setLoading(true);

    const { data: wp } = await supabase
      .from('week_plans')
      .select('*')
      .eq('athlete_id', athlete.id)
      .eq('week_start', weekStart)
      .maybeSingle();

    setWeekPlan(wp);

    if (!wp) {
      setDays([]);
      setLoading(false);
      return;
    }

    const activeDays = (wp.active_days || [1, 2, 3, 4, 5]).sort();

    const { data: allExercises } = await supabase
      .from('planned_exercises')
      .select('*, exercise:exercise_id(*)')
      .eq('weekplan_id', wp.id)
      .order('position');

    const exIds = (allExercises || []).map(e => e.id);
    let setLineMap = new Map<string, PlannedSetLine[]>();

    if (exIds.length > 0) {
      const { data: setLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .in('planned_exercise_id', exIds)
        .order('position');

      (setLines || []).forEach(sl => {
        const arr = setLineMap.get(sl.planned_exercise_id) || [];
        arr.push(sl);
        setLineMap.set(sl.planned_exercise_id, arr);
      });
    }

    const monday = new Date(weekStart + 'T00:00:00');
    const dayDataList: DayData[] = activeDays.map(di => {
      const dateForDay = addDays(monday, di - 1);
      const customLabel = wp.day_labels?.[di];
      return {
        dayIndex: di,
        label: customLabel || dayLabel(di),
        dateStr: formatDateShort(toISODate(dateForDay)),
        exercises: (allExercises || [])
          .filter(e => e.day_index === di)
          .map(e => ({ ...e, exercise: e.exercise, set_lines: setLineMap.get(e.id) || [] })),
      };
    });

    setDays(dayDataList);

    const todayIdx = new Date().getDay();
    const todayDayIndex = todayIdx === 0 ? 7 : todayIdx;
    if (activeDays.includes(todayDayIndex)) {
      setExpandedDay(todayDayIndex);
    } else if (dayDataList.length > 0) {
      setExpandedDay(dayDataList[0].dayIndex);
    }

    setLoading(false);
  }

  function navigateWeek(direction: -1 | 1) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + direction * 7);
    setWeekStart(toISODate(d));
  }

  function formatPrescription(ex: PlannedExercise & { set_lines: PlannedSetLine[] }): string {
    if (ex.set_lines.length === 0) return ex.prescription_raw || '';
    return ex.set_lines.map(sl => {
      const load = sl.load_value > 0 ? `${sl.load_value}kg` : '';
      return sl.sets > 1
        ? `${sl.sets}x${sl.reps}${load ? ' @ ' + load : ''}`
        : `${sl.reps}${load ? ' @ ' + load : ''}`;
    }).join(', ');
  }

  const totalSets = days.reduce((sum, d) =>
    sum + d.exercises.reduce((s, ex) => s + (ex.summary_total_sets || 0), 0), 0);
  const totalReps = days.reduce((sum, d) =>
    sum + d.exercises.reduce((s, ex) => s + (ex.summary_total_reps || 0), 0), 0);
  const tonnage = days.reduce((sum, d) =>
    sum + d.exercises
      .filter(ex => ex.unit === 'absolute_kg')
      .reduce((s, ex) => s + (ex.summary_avg_load || 0) * (ex.summary_total_reps || 0), 0), 0);
  const sessionCount = days.filter(d => d.exercises.filter(e => e.exercise?.exercise_code !== 'TEXT').length > 0).length;

  const monday = new Date(weekStart + 'T00:00:00');
  const isCurrentWeek = weekStart === toISODate(getMonday(new Date()));
  const todayDayIndex = (() => { const d = new Date().getDay(); return d === 0 ? 7 : d; })();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigateWeek(-1)} className="p-2 text-gray-400 hover:text-white">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold text-white">
            {isCurrentWeek ? 'This Week' : `Week of ${formatDateShort(weekStart)}`}
          </h1>
          {weekPlan?.week_description && (
            <p className="text-xs text-gray-500 mt-0.5">{weekPlan.week_description}</p>
          )}
        </div>
        <button onClick={() => navigateWeek(1)} className="p-2 text-gray-400 hover:text-white">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {[1, 2, 3, 4, 5, 6, 7].map(di => {
          const dateForDay = addDays(monday, di - 1);
          const hasSession = days.some(d => d.dayIndex === di && d.exercises.filter(e => e.exercise?.exercise_code !== 'TEXT').length > 0);
          const isToday = isCurrentWeek && di === todayDayIndex;

          return (
            <button
              key={di}
              onClick={() => {
                const dayData = days.find(d => d.dayIndex === di);
                if (dayData) setExpandedDay(expandedDay === di ? null : di);
              }}
              className={`flex-1 min-w-[42px] py-2 rounded-lg text-center transition-colors ${
                isToday
                  ? 'bg-blue-600 text-white'
                  : hasSession
                  ? 'bg-gray-800 text-gray-200'
                  : 'bg-gray-900/50 text-gray-600'
              }`}
            >
              <p className="text-[10px] font-medium">{dayLabel(di).substring(0, 2)}</p>
              <p className="text-xs font-semibold">{dateForDay.getDate()}</p>
              {hasSession && <div className={`w-1 h-1 rounded-full mx-auto mt-0.5 ${isToday ? 'bg-white' : 'bg-blue-400'}`} />}
            </button>
          );
        })}
      </div>

      {days.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5 bg-gray-900 rounded-xl p-3">
          <div className="text-center">
            <p className="text-xs text-gray-500">Sessions</p>
            <p className="text-lg font-bold text-white">{sessionCount}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Total Reps</p>
            <p className="text-lg font-bold text-white">{totalReps}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Tonnage</p>
            <p className="text-lg font-bold text-white">{Math.round(tonnage)}kg</p>
          </div>
        </div>
      )}

      {days.length === 0 ? (
        <div className="text-center py-16">
          <Dumbbell size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No plan for this week</p>
        </div>
      ) : (
        <div className="space-y-2">
          {days.map(day => {
            const realExercises = day.exercises.filter(e => e.exercise?.exercise_code !== 'TEXT');
            if (realExercises.length === 0) return null;
            const isExpanded = expandedDay === day.dayIndex;

            return (
              <div key={day.dayIndex} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
                <button
                  onClick={() => setExpandedDay(isExpanded ? null : day.dayIndex)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white">{day.label}</span>
                    <span className="text-xs text-gray-500">{day.dateStr}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {realExercises.length} exercise{realExercises.length !== 1 ? 's' : ''}
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-3 space-y-2 border-t border-gray-800 pt-3">
                    {realExercises.map(ex => (
                      <div key={ex.id} className="flex items-center gap-3 py-1.5">
                        <div
                          className="w-0.5 h-6 rounded-full flex-shrink-0"
                          style={{ backgroundColor: ex.exercise?.color || '#3B82F6' }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200 truncate">{ex.exercise?.name}</p>
                          <p className="text-xs text-gray-500">{formatPrescription(ex)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
