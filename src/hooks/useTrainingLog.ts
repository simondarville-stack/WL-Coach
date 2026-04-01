import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  WeekPlan,
  PlannedExerciseWithExercise,
  TrainingLogSession,
  TrainingLogExerciseWithExercise,
} from '../lib/database.types';

export function useTrainingLog() {
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExerciseWithExercise[]>([]);
  const [session, setSession] = useState<TrainingLogSession | null>(null);
  const [loggedExercises, setLoggedExercises] = useState<TrainingLogExerciseWithExercise[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchWeekData = async (athleteId: string, weekStart: Date, selectedDayIndex: number) => {
    const weekStartISO = weekStart.toISOString().split('T')[0];

    const { data: weekData } = await supabase
      .from('week_plans')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStartISO)
      .maybeSingle();

    setWeekPlan(weekData);

    if (weekData) {
      const { data: plannedData } = await supabase
        .from('planned_exercises')
        .select('*, exercise:exercises(*)')
        .eq('weekplan_id', weekData.id)
        .eq('day_index', selectedDayIndex)
        .order('position');
      setPlannedExercises(plannedData || []);
    } else {
      setPlannedExercises([]);
    }

    const selectedDate = new Date(weekStart);
    selectedDate.setDate(selectedDate.getDate() + selectedDayIndex - 1);
    const dateISO = selectedDate.toISOString().split('T')[0];

    const { data: sessionData } = await supabase
      .from('training_log_sessions')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('date', dateISO)
      .maybeSingle();

    if (sessionData) {
      setSession(sessionData);
      const { data: logData } = await supabase
        .from('training_log_exercises')
        .select('*, exercise:exercises(*)')
        .eq('session_id', sessionData.id)
        .order('position');
      setLoggedExercises(logData || []);
    } else {
      setSession({
        id: '',
        athlete_id: athleteId,
        date: dateISO,
        week_start: weekStartISO,
        day_index: selectedDayIndex,
        session_notes: '',
        status: 'planned',
        raw_sleep: null,
        raw_physical: null,
        raw_mood: null,
        raw_nutrition: null,
        raw_total: null,
        raw_guidance: null,
        created_at: '',
        updated_at: '',
      });
      setLoggedExercises([]);
    }
  };

  const saveSession = async (
    currentSession: TrainingLogSession,
    athleteId: string,
    currentLoggedExercises: TrainingLogExerciseWithExercise[],
  ) => {
    try {
      setSaving(true);

      const hasRawScores =
        currentSession.raw_sleep || currentSession.raw_physical ||
        currentSession.raw_mood || currentSession.raw_nutrition;

      const rawTotal = hasRawScores
        ? (currentSession.raw_sleep || 0) + (currentSession.raw_physical || 0) +
          (currentSession.raw_mood || 0) + (currentSession.raw_nutrition || 0)
        : null;

      let rawGuidance = null;
      if (rawTotal !== null) {
        if (rawTotal >= 4 && rawTotal <= 6) {
          rawGuidance = "Reduce total volume by 25-30%:\n• Reduce session RPE by 2\n• Reduce sets by 1-2 per lift\n• Reduce reps by 2-4 per lift\n• Reduce session length by 25-30%\n• Increase rest by ~30 sec depending on session goal";
        } else if (rawTotal >= 7 && rawTotal <= 9) {
          rawGuidance = "Reduce total volume by 15-20%:\n• Reduce session RPE by 1\n• Reduce sets by 1 per lift\n• Reduce reps by 1-2 per lift\n• Reduce session length by 15-20%\n• Increase rest by ~30 sec depending on session goal";
        } else if (rawTotal >= 10 && rawTotal <= 12) {
          rawGuidance = "Good to train as hard as you desire within your ability level.";
        }
      }

      let sessionId = currentSession.id;

      if (currentSession.id) {
        const { error } = await supabase
          .from('training_log_sessions')
          .update({
            session_notes: currentSession.session_notes,
            status: currentSession.status,
            raw_sleep: currentSession.raw_sleep,
            raw_physical: currentSession.raw_physical,
            raw_mood: currentSession.raw_mood,
            raw_nutrition: currentSession.raw_nutrition,
            raw_total: rawTotal,
            raw_guidance: rawGuidance,
          })
          .eq('id', currentSession.id);
        if (error) throw error;
      } else {
        const { data: newSession, error } = await supabase
          .from('training_log_sessions')
          .insert({
            athlete_id: athleteId,
            date: currentSession.date,
            week_start: currentSession.week_start,
            day_index: currentSession.day_index,
            session_notes: currentSession.session_notes,
            status: currentSession.status,
            raw_sleep: currentSession.raw_sleep,
            raw_physical: currentSession.raw_physical,
            raw_mood: currentSession.raw_mood,
            raw_nutrition: currentSession.raw_nutrition,
            raw_total: rawTotal,
            raw_guidance: rawGuidance,
          })
          .select()
          .single();
        if (error) throw error;
        setSession(newSession);
        sessionId = newSession.id;
      }

      const existingIds = new Set(currentLoggedExercises.filter(e => e.id).map(e => e.id));
      const { data: currentLogged } = await supabase
        .from('training_log_exercises')
        .select('id')
        .eq('session_id', sessionId);

      const toDelete = (currentLogged || []).filter(e => !existingIds.has(e.id));
      for (const ex of toDelete) {
        await supabase.from('training_log_exercises').delete().eq('id', ex.id);
      }

      for (const logEx of currentLoggedExercises) {
        if (logEx.id) {
          await supabase
            .from('training_log_exercises')
            .update({ performed_raw: logEx.performed_raw, performed_notes: logEx.performed_notes, position: logEx.position })
            .eq('id', logEx.id);
        } else {
          await supabase
            .from('training_log_exercises')
            .insert({
              session_id: sessionId,
              exercise_id: logEx.exercise_id,
              planned_exercise_id: logEx.planned_exercise_id,
              performed_raw: logEx.performed_raw,
              performed_notes: logEx.performed_notes,
              position: logEx.position,
            });
        }
      }
    } catch (error) {
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return {
    weekPlan,
    plannedExercises,
    session,
    setSession,
    loggedExercises,
    setLoggedExercises,
    saving,
    fetchWeekData,
    saveSession,
  };
}
