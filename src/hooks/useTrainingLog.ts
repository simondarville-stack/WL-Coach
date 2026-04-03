import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { parsePrescription } from '../lib/prescriptionParser';
import type {
  WeekPlan,
  PlannedExerciseWithExercise,
  TrainingLogSession,
  TrainingLogExerciseWithExercise,
  TrainingLogSet,
  TrainingLogMessage,
} from '../lib/database.types';

export function useTrainingLog() {
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExerciseWithExercise[]>([]);
  const [session, setSession] = useState<TrainingLogSession | null>(null);
  const [loggedExercises, setLoggedExercises] = useState<TrainingLogExerciseWithExercise[]>([]);
  const [saving, setSaving] = useState(false);
  const [setsMap, setSetsMap] = useState<Record<string, TrainingLogSet[]>>({});
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);

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
        started_at: null,
        completed_at: null,
        duration_minutes: null,
        session_rpe: null,
        bodyweight_kg: null,
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

  // ── New functions ──────────────────────────────────────────────────────────

  const fetchSetsForExercise = async (logExerciseId: string): Promise<void> => {
    const { data, error } = await supabase
      .from('training_log_sets')
      .select('*')
      .eq('log_exercise_id', logExerciseId)
      .order('set_number');
    if (error) throw error;
    setSetsMap(prev => ({ ...prev, [logExerciseId]: data || [] }));
  };

  const saveSet = async (
    set: Partial<TrainingLogSet> & { log_exercise_id: string; set_number: number }
  ): Promise<TrainingLogSet> => {
    const { data, error } = await supabase
      .from('training_log_sets')
      .insert({
        log_exercise_id: set.log_exercise_id,
        set_number: set.set_number,
        planned_load: set.planned_load ?? null,
        planned_reps: set.planned_reps ?? null,
        performed_load: set.performed_load ?? null,
        performed_reps: set.performed_reps ?? null,
        rpe: set.rpe ?? null,
        status: set.status ?? 'pending',
        notes: set.notes ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    setSetsMap(prev => ({
      ...prev,
      [set.log_exercise_id]: [...(prev[set.log_exercise_id] || []), data],
    }));
    return data;
  };

  const completeSet = async (
    setId: string,
    performed: { load: number | null; reps: number | null; rpe: number | null }
  ): Promise<void> => {
    const { data, error } = await supabase
      .from('training_log_sets')
      .update({
        performed_load: performed.load,
        performed_reps: performed.reps,
        rpe: performed.rpe,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', setId)
      .select()
      .single();
    if (error) throw error;
    setSetsMap(prev => {
      const exId = data.log_exercise_id;
      return {
        ...prev,
        [exId]: (prev[exId] || []).map(s => s.id === setId ? data : s),
      };
    });
  };

  const skipSet = async (setId: string): Promise<void> => {
    const { data, error } = await supabase
      .from('training_log_sets')
      .update({ status: 'skipped', updated_at: new Date().toISOString() })
      .eq('id', setId)
      .select()
      .single();
    if (error) throw error;
    setSetsMap(prev => {
      const exId = data.log_exercise_id;
      return {
        ...prev,
        [exId]: (prev[exId] || []).map(s => s.id === setId ? data : s),
      };
    });
  };

  const initSetsFromPlan = async (
    logExerciseId: string,
    prescriptionRaw: string | null,
    unit: string | null,
  ): Promise<void> => {
    // Delete existing sets first
    await supabase
      .from('training_log_sets')
      .delete()
      .eq('log_exercise_id', logExerciseId);

    if (!prescriptionRaw) {
      setSetsMap(prev => ({ ...prev, [logExerciseId]: [] }));
      return;
    }

    const parsed = parsePrescription(prescriptionRaw);
    if (parsed.length === 0) {
      setSetsMap(prev => ({ ...prev, [logExerciseId]: [] }));
      return;
    }

    // Expand set lines into individual sets
    const setsToInsert: Array<{
      log_exercise_id: string;
      set_number: number;
      planned_load: number | null;
      planned_reps: number | null;
      status: string;
    }> = [];

    let setNumber = 1;
    const isPercentage = unit === 'percentage';

    for (const line of parsed) {
      for (let i = 0; i < line.sets; i++) {
        setsToInsert.push({
          log_exercise_id: logExerciseId,
          set_number: setNumber++,
          planned_load: isPercentage ? null : line.load,
          planned_reps: line.reps,
          status: 'pending',
        });
      }
    }

    if (setsToInsert.length === 0) {
      setSetsMap(prev => ({ ...prev, [logExerciseId]: [] }));
      return;
    }

    const { data, error } = await supabase
      .from('training_log_sets')
      .insert(setsToInsert)
      .select();
    if (error) throw error;

    setSetsMap(prev => ({ ...prev, [logExerciseId]: data || [] }));
  };

  const startSession = async (sessionId: string): Promise<void> => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('training_log_sessions')
      .update({ started_at: now, status: 'in_progress' })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw error;
    setSession(data);
  };

  const completeSession = async (
    sessionId: string,
    opts?: { rpe?: number; notes?: string; bodyweight_kg?: number }
  ): Promise<void> => {
    const now = new Date().toISOString();

    // Fetch current session to compute duration
    const { data: current } = await supabase
      .from('training_log_sessions')
      .select('started_at')
      .eq('id', sessionId)
      .single();

    let durationMinutes: number | null = null;
    if (current?.started_at) {
      const start = new Date(current.started_at).getTime();
      const end = new Date(now).getTime();
      durationMinutes = Math.round((end - start) / 60000);
    }

    const { data, error } = await supabase
      .from('training_log_sessions')
      .update({
        completed_at: now,
        status: 'completed',
        duration_minutes: durationMinutes,
        session_rpe: opts?.rpe ?? null,
        session_notes: opts?.notes ?? undefined,
        bodyweight_kg: opts?.bodyweight_kg ?? null,
      })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw error;
    setSession(data);
  };

  const startExercise = async (logExerciseId: string): Promise<void> => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('training_log_exercises')
      .update({ status: 'in_progress', started_at: now })
      .eq('id', logExerciseId);
    if (error) throw error;
    setLoggedExercises(prev =>
      prev.map(e => e.id === logExerciseId ? { ...e, status: 'in_progress', started_at: now } : e)
    );
  };

  const completeExercise = async (logExerciseId: string, techniqueRating?: number): Promise<void> => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('training_log_exercises')
      .update({
        status: 'completed',
        completed_at: now,
        technique_rating: techniqueRating ?? null,
      })
      .eq('id', logExerciseId);
    if (error) throw error;
    setLoggedExercises(prev =>
      prev.map(e => e.id === logExerciseId
        ? { ...e, status: 'completed', completed_at: now, technique_rating: techniqueRating ?? null }
        : e
      )
    );
  };

  const skipExercise = async (logExerciseId: string, _reason?: string): Promise<void> => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('training_log_exercises')
      .update({ status: 'skipped', completed_at: now })
      .eq('id', logExerciseId);
    if (error) throw error;
    setLoggedExercises(prev =>
      prev.map(e => e.id === logExerciseId ? { ...e, status: 'skipped', completed_at: now } : e)
    );
  };

  const fetchMessages = async (sessionId: string): Promise<void> => {
    const { data, error } = await supabase
      .from('training_log_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at');
    if (error) throw error;
    setMessages(data || []);
  };

  const sendMessage = async (
    sessionId: string,
    exerciseId: string | null,
    message: string,
    senderType: 'athlete' | 'coach'
  ): Promise<void> => {
    const { data, error } = await supabase
      .from('training_log_messages')
      .insert({ session_id: sessionId, exercise_id: exerciseId, message, sender_type: senderType })
      .select()
      .single();
    if (error) throw error;
    setMessages(prev => [...prev, data]);
  };

  const checkAndRecordPR = async (
    athleteId: string,
    exerciseId: string,
    load: number,
    reps: number
  ): Promise<{ isPR: boolean; previousBest: { load: number; reps: number } | null }> => {
    const { data: existing } = await supabase
      .from('athlete_prs')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('exercise_id', exerciseId)
      .maybeSingle();

    const previousBest = existing?.pr_value_kg
      ? { load: existing.pr_value_kg, reps: 1 }
      : null;

    const isNewPR = !existing?.pr_value_kg || load > existing.pr_value_kg;

    if (isNewPR) {
      if (existing) {
        await supabase
          .from('athlete_prs')
          .update({ pr_value_kg: load, pr_date: new Date().toISOString().split('T')[0] })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('athlete_prs')
          .insert({
            athlete_id: athleteId,
            exercise_id: exerciseId,
            pr_value_kg: load,
            pr_date: new Date().toISOString().split('T')[0],
          });
      }
    }

    return { isPR: isNewPR, previousBest };
  };

  return {
    // Existing exports
    weekPlan,
    plannedExercises,
    session,
    setSession,
    loggedExercises,
    setLoggedExercises,
    saving,
    fetchWeekData,
    saveSession,
    // New exports
    setsMap,
    setSetsMap,
    messages,
    fetchSetsForExercise,
    saveSet,
    completeSet,
    skipSet,
    initSetsFromPlan,
    startSession,
    completeSession,
    startExercise,
    completeExercise,
    skipExercise,
    fetchMessages,
    sendMessage,
    checkAndRecordPR,
  };
}
