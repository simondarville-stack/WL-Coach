// @ts-nocheck
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { getMonday, toISODate, getDayOfWeek, dayLabel } from '../lib/dateHelpers';
import { LogSetModal } from './LogSetModal';
import { CheckCircle, ChevronRight, Clock, Dumbbell } from 'lucide-react';
import type { PlannedExercise, Exercise, PlannedSetLine, TrainingLogSession, TrainingLogExercise, TrainingLogSet } from '../../lib/database.types';

interface DayExercise extends PlannedExercise {
  exercise: Exercise;
  set_lines: PlannedSetLine[];
}

interface LoggedExercise extends TrainingLogExercise {
  sets: TrainingLogSet[];
}

export function TodayScreen() {
  const { athlete } = useAuth();
  const [exercises, setExercises] = useState<DayExercise[]>([]);
  const [logSession, setLogSession] = useState<TrainingLogSession | null>(null);
  const [loggedExercises, setLoggedExercises] = useState<Map<string, LoggedExercise>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loggingExercise, setLoggingExercise] = useState<DayExercise | null>(null);
  const [sessionDate, setSessionDate] = useState(() => toISODate(new Date()));
  const [dayIndex, setDayIndex] = useState(() => getDayOfWeek(toISODate(new Date())));

  useEffect(() => {
    if (athlete) loadTodaySession();
  }, [athlete, sessionDate]);

  async function loadTodaySession() {
    if (!athlete) return;
    setLoading(true);

    const weekStart = toISODate(getMonday(new Date(sessionDate + 'T00:00:00')));
    const currentDayIndex = getDayOfWeek(sessionDate);
    setDayIndex(currentDayIndex);

    const { data: weekPlan } = await supabase
      .from('week_plans')
      .select('id')
      .eq('athlete_id', athlete.id)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (!weekPlan) {
      await findNextSession(weekStart, currentDayIndex);
      setLoading(false);
      return;
    }

    const { data: plannedExercises } = await supabase
      .from('planned_exercises')
      .select('*, exercise:exercise_id(*)')
      .eq('weekplan_id', weekPlan.id)
      .eq('day_index', currentDayIndex)
      .order('position');

    if (!plannedExercises || plannedExercises.length === 0) {
      await findNextSession(weekStart, currentDayIndex);
      setLoading(false);
      return;
    }

    const exIds = plannedExercises.map(e => e.id);
    const { data: setLines } = await supabase
      .from('planned_set_lines')
      .select('*')
      .in('planned_exercise_id', exIds)
      .order('position');

    const setLineMap = new Map<string, PlannedSetLine[]>();
    (setLines || []).forEach(sl => {
      const arr = setLineMap.get(sl.planned_exercise_id) || [];
      arr.push(sl);
      setLineMap.set(sl.planned_exercise_id, arr);
    });

    const dayExercises: DayExercise[] = plannedExercises.map(pe => ({
      ...pe,
      exercise: pe.exercise,
      set_lines: setLineMap.get(pe.id) || [],
    }));

    setExercises(dayExercises);
    await loadLogData(currentDayIndex);
    setLoading(false);
  }

  async function findNextSession(currentWeekStart: string, currentDay: number) {
    if (!athlete) return;

    const { data: weekPlan } = await supabase
      .from('week_plans')
      .select('id, active_days, week_start')
      .eq('athlete_id', athlete.id)
      .gte('week_start', currentWeekStart)
      .order('week_start')
      .limit(2);

    if (!weekPlan || weekPlan.length === 0) {
      setExercises([]);
      return;
    }

    for (const wp of weekPlan) {
      const activeDays = (wp.active_days || [1, 2, 3, 4, 5]).sort();
      const startDay = wp.week_start === currentWeekStart ? currentDay + 1 : 1;

      for (const d of activeDays) {
        if (d < startDay) continue;

        const { data: exs } = await supabase
          .from('planned_exercises')
          .select('*, exercise:exercise_id(*)')
          .eq('weekplan_id', wp.id)
          .eq('day_index', d)
          .order('position');

        if (exs && exs.length > 0) {
          const exIds = exs.map(e => e.id);
          const { data: sls } = await supabase
            .from('planned_set_lines')
            .select('*')
            .in('planned_exercise_id', exIds)
            .order('position');

          const slMap = new Map<string, PlannedSetLine[]>();
          (sls || []).forEach(sl => {
            const arr = slMap.get(sl.planned_exercise_id) || [];
            arr.push(sl);
            slMap.set(sl.planned_exercise_id, arr);
          });

          setExercises(exs.map(pe => ({
            ...pe,
            exercise: pe.exercise,
            set_lines: slMap.get(pe.id) || [],
          })));
          setDayIndex(d);
          return;
        }
      }
    }

    setExercises([]);
  }

  async function loadLogData(di: number) {
    if (!athlete) return;

    const { data: session } = await supabase
      .from('training_log_sessions')
      .select('*')
      .eq('athlete_id', athlete.id)
      .eq('date', sessionDate)
      .maybeSingle();

    setLogSession(session);

    if (!session) {
      setLoggedExercises(new Map());
      return;
    }

    const { data: logExs } = await supabase
      .from('training_log_exercises')
      .select('*')
      .eq('session_id', session.id);

    if (!logExs || logExs.length === 0) {
      setLoggedExercises(new Map());
      return;
    }

    const logExIds = logExs.map(le => le.id);
    const { data: logSets } = await supabase
      .from('training_log_sets')
      .select('*')
      .in('log_exercise_id', logExIds)
      .order('set_number');

    const setsMap = new Map<string, TrainingLogSet[]>();
    (logSets || []).forEach(s => {
      const arr = setsMap.get(s.log_exercise_id) || [];
      arr.push(s);
      setsMap.set(s.log_exercise_id, arr);
    });

    const logMap = new Map<string, LoggedExercise>();
    logExs.forEach(le => {
      if (le.planned_exercise_id) {
        logMap.set(le.planned_exercise_id, {
          ...le,
          sets: setsMap.get(le.id) || [],
        });
      }
    });

    setLoggedExercises(logMap);
  }

  async function handleLogSaved() {
    setLoggingExercise(null);
    await loadLogData(dayIndex);
  }

  function formatPrescription(ex: DayExercise): string {
    if (ex.set_lines.length === 0) return ex.prescription_raw || 'No prescription';

    return ex.set_lines.map(sl => {
      const load = sl.load_value > 0 ? `${sl.load_value}` : '';
      const reps = sl.reps;
      const sets = sl.sets;
      if (load) {
        return sets > 1 ? `${sets}x${reps} @ ${load}kg` : `${reps} @ ${load}kg`;
      }
      return sets > 1 ? `${sets}x${reps}` : `${reps} reps`;
    }).join(', ');
  }

  function getLogStatus(plannedExId: string): 'none' | 'partial' | 'done' {
    const logged = loggedExercises.get(plannedExId);
    if (!logged || logged.sets.length === 0) return 'none';
    const completed = logged.sets.filter(s => s.status === 'completed').length;
    if (completed === 0) return 'none';
    const total = logged.sets.length;
    return completed >= total ? 'done' : 'partial';
  }

  function getLogSummary(plannedExId: string): string {
    const logged = loggedExercises.get(plannedExId);
    if (!logged || logged.sets.length === 0) return '';

    const completed = logged.sets.filter(s => s.status === 'completed');
    if (completed.length === 0) return '';

    const totalReps = completed.reduce((sum, s) => sum + (s.performed_reps || 0), 0);
    const maxLoad = Math.max(...completed.map(s => s.performed_load || 0));
    return `${completed.length}s / ${totalReps}r${maxLoad > 0 ? ` / ${maxLoad}kg` : ''}`;
  }

  const today = toISODate(new Date());
  const isToday = sessionDate === today;
  const totalPlannedSets = exercises.reduce((sum, ex) => sum + (ex.summary_total_sets || 0), 0);
  const totalPlannedReps = exercises.reduce((sum, ex) => sum + (ex.summary_total_reps || 0), 0);
  const completedCount = exercises.filter(ex => getLogStatus(ex.id) === 'done').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">
            {isToday ? 'Today' : dayLabel(dayIndex)}
          </h1>
          <p className="text-sm text-gray-500">
            {isToday ? dayLabel(dayIndex) : 'Next session'}
          </p>
        </div>
        {exercises.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Target</p>
            <p className="text-sm font-semibold text-gray-300">
              {totalPlannedSets}S / {totalPlannedReps}R
            </p>
          </div>
        )}
      </div>

      {exercises.length > 0 && completedCount > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>{completedCount} of {exercises.length} exercises</span>
            <span>{Math.round((completedCount / exercises.length) * 100)}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / exercises.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {exercises.length === 0 ? (
        <div className="text-center py-20">
          <Dumbbell size={48} className="text-gray-700 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">No session scheduled</p>
          <p className="text-gray-600 text-sm mt-1">Check with your coach for your next plan</p>
        </div>
      ) : (
        <div className="space-y-2">
          {exercises.filter(ex => ex.exercise?.exercise_code !== 'TEXT').map(ex => {
            const status = getLogStatus(ex.id);
            const summary = getLogSummary(ex.id);

            return (
              <button
                key={ex.id}
                onClick={() => setLoggingExercise(ex)}
                className={`w-full text-left rounded-xl border transition-all active:scale-[0.98] ${
                  status === 'done'
                    ? 'bg-green-950/30 border-green-800/40'
                    : status === 'partial'
                    ? 'bg-blue-950/20 border-blue-800/30'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="flex items-center gap-3 p-4">
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: ex.exercise?.color || '#3B82F6' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">
                        {ex.exercise?.name || 'Unknown'}
                      </p>
                      {status === 'done' && <CheckCircle size={14} className="text-green-500 flex-shrink-0" />}
                      {status === 'partial' && <Clock size={14} className="text-blue-400 flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{formatPrescription(ex)}</p>
                    {summary && (
                      <p className="text-xs text-blue-400 mt-1 font-medium">{summary}</p>
                    )}
                    {ex.notes && (
                      <p className="text-[11px] text-gray-600 mt-1 italic">{ex.notes}</p>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-gray-600 flex-shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {loggingExercise && athlete && (
        <LogSetModal
          athlete={athlete}
          exercise={loggingExercise}
          sessionDate={sessionDate}
          dayIndex={dayIndex}
          existingSession={logSession}
          existingLogExercise={loggedExercises.get(loggingExercise.id) || null}
          onClose={() => setLoggingExercise(null)}
          onSaved={handleLogSaved}
        />
      )}
    </div>
  );
}
