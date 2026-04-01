import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MacroCycle, MacroWeek, MacroTrackedExerciseWithExercise, MacroTarget } from '../lib/database.types';

export function useMacroCycles() {
  const [macrocycles, setMacrocycles] = useState<MacroCycle[]>([]);
  const [macroWeeks, setMacroWeeks] = useState<MacroWeek[]>([]);
  const [trackedExercises, setTrackedExercises] = useState<MacroTrackedExerciseWithExercise[]>([]);
  const [targets, setTargets] = useState<MacroTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMacrocycles = async (athleteId: string) => {
    try {
      const { data, error } = await supabase
        .from('macrocycles')
        .select('*')
        .eq('athlete_id', athleteId)
        .order('start_date', { ascending: false });
      if (error) throw error;
      setMacrocycles(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load macrocycles');
    }
  };

  const createMacrocycle = async (
    athleteId: string,
    name: string,
    startDate: string,
    endDate: string,
    weekInserts: Array<{ macrocycle_id: string; week_start: string; week_number: number; week_type: string; week_type_text: string; notes: string }>,
  ): Promise<MacroCycle> => {
    try {
      setLoading(true);
      const { data: macrocycle, error: macroError } = await supabase
        .from('macrocycles')
        .insert({ athlete_id: athleteId, name, start_date: startDate, end_date: endDate })
        .select()
        .single();
      if (macroError) throw macroError;

      const weeksWithId = weekInserts.map(w => ({ ...w, macrocycle_id: macrocycle.id }));
      const { error: weeksError } = await supabase.from('macro_weeks').insert(weeksWithId);
      if (weeksError) throw weeksError;

      return macrocycle;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create macrocycle');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const deleteMacrocycle = async (id: string) => {
    try {
      setLoading(true);
      const { error } = await supabase.from('macrocycles').delete().eq('id', id);
      if (error) throw error;
      setMacrocycles(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete macrocycle');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const fetchMacroWeeks = async (macrocycleId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('macro_weeks')
        .select('*')
        .eq('macrocycle_id', macrocycleId)
        .order('week_number');
      if (error) throw error;
      setMacroWeeks(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load weeks');
    } finally {
      setLoading(false);
    }
  };

  const updateMacroWeek = async (id: string, updates: Partial<MacroWeek>) => {
    try {
      const { error } = await supabase.from('macro_weeks').update(updates).eq('id', id);
      if (error) throw error;
      setMacroWeeks(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update week');
      throw err;
    }
  };

  const fetchTrackedExercises = async (macrocycleId: string) => {
    try {
      const { data, error } = await supabase
        .from('macro_tracked_exercises')
        .select(`*, exercise:exercises(*)`)
        .eq('macrocycle_id', macrocycleId)
        .order('position');
      if (error) throw error;
      setTrackedExercises(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracked exercises');
    }
  };

  const addTrackedExercise = async (macrocycleId: string, exerciseId: string, position: number) => {
    try {
      const { error } = await supabase
        .from('macro_tracked_exercises')
        .insert({ macrocycle_id: macrocycleId, exercise_id: exerciseId, position });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tracked exercise');
      throw err;
    }
  };

  const swapTrackedExercisePositions = async (id1: string, newPos1: number, id2: string, newPos2: number) => {
    try {
      const { error: e1 } = await supabase
        .from('macro_tracked_exercises')
        .update({ position: newPos1 })
        .eq('id', id1);
      const { error: e2 } = await supabase
        .from('macro_tracked_exercises')
        .update({ position: newPos2 })
        .eq('id', id2);
      if (e1 || e2) throw e1 || e2;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move tracked exercise');
      throw err;
    }
  };

  const removeTrackedExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_tracked_exercises').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove tracked exercise');
      throw err;
    }
  };

  const reorderTrackedExercise = async (id: string, newPosition: number) => {
    const { error } = await supabase
      .from('macro_tracked_exercises')
      .update({ position: newPosition })
      .eq('id', id);
    if (error) throw error;
  };

  const fetchTargets = async (weekIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('macro_targets')
        .select('*')
        .in('macro_week_id', weekIds);
      if (error) throw error;
      setTargets(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load targets');
    }
  };

  const upsertTarget = async (
    weekId: string,
    trackedExId: string,
    field: keyof MacroTarget,
    numValue: number | null,
    existingTarget?: MacroTarget,
  ): Promise<MacroTarget | null> => {
    try {
      if (existingTarget) {
        const { error } = await supabase
          .from('macro_targets')
          .update({ [field]: numValue })
          .eq('id', existingTarget.id);
        if (error) throw error;
        setTargets(prev => prev.map(t => t.id === existingTarget.id ? { ...t, [field]: numValue } : t));
        return { ...existingTarget, [field]: numValue };
      } else {
        const { data, error } = await supabase
          .from('macro_targets')
          .insert({ macro_week_id: weekId, tracked_exercise_id: trackedExId, [field]: numValue })
          .select()
          .single();
        if (error) throw error;
        setTargets(prev => [...prev, data]);
        return data;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update target');
      throw err;
    }
  };

  interface MacroTargetForExercise {
    target_reps: number | null;
    target_ave: number | null;
    target_hi: number | null;
    target_rhi: number | null;
    target_shi: number | null;
  }

  const fetchMacroTargetForExercise = async (
    weekplanId: string,
    exerciseId: string,
  ): Promise<MacroTargetForExercise | null> => {
    try {
      const { data: weekPlan } = await supabase
        .from('week_plans')
        .select('week_start, athlete_id')
        .eq('id', weekplanId)
        .maybeSingle();

      if (!weekPlan) return null;

      const { data: macrocycle } = await supabase
        .from('macrocycles')
        .select('id')
        .eq('is_active', true)
        .eq('athlete_id', weekPlan.athlete_id)
        .maybeSingle();

      if (!macrocycle) return null;

      const { data: macroWeek } = await supabase
        .from('macro_weeks')
        .select('id')
        .eq('macrocycle_id', macrocycle.id)
        .eq('week_start', weekPlan.week_start)
        .maybeSingle();

      if (!macroWeek) return null;

      const { data: trackedExercise } = await supabase
        .from('macro_tracked_exercises')
        .select('id')
        .eq('macrocycle_id', macrocycle.id)
        .eq('exercise_id', exerciseId)
        .maybeSingle();

      if (!trackedExercise) return null;

      const { data: target } = await supabase
        .from('macro_targets')
        .select('target_reps, target_ave, target_hi, target_rhi, target_shi')
        .eq('macro_week_id', macroWeek.id)
        .eq('tracked_exercise_id', trackedExercise.id)
        .maybeSingle();

      return target || null;
    } catch (err) {
      return null;
    }
  };

  interface MacroValidationData {
    macroTargets: Record<string, {
      id: string; macro_week_id: string; tracked_exercise_id: string; exercise_id: string;
      target_reps: number | null; target_ave: number | null; target_hi: number | null;
      target_rhi: number | null; target_shi: number | null;
    }>;
    trackedExercises: import('../lib/database.types').Exercise[];
  }

  const fetchMacroValidationData = async (
    athleteId: string,
    weekStart: string,
  ): Promise<MacroValidationData> => {
    const { data: macroWeeks, error: macroError } = await supabase
      .from('macro_weeks')
      .select(`id, macrocycle_id, week_start, macrocycles!inner(athlete_id, start_date, end_date)`)
      .eq('macrocycles.athlete_id', athleteId)
      .lte('week_start', weekStart)
      .gte('week_start', new Date(new Date(weekStart).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .lte('macrocycles.start_date', weekStart)
      .gte('macrocycles.end_date', weekStart)
      .order('week_start', { ascending: false })
      .limit(1);

    if (macroError) throw macroError;
    if (!macroWeeks || macroWeeks.length === 0) return { macroTargets: {}, trackedExercises: [] };

    const macroWeek = macroWeeks[0];

    const { data: trackedExercisesData } = await supabase
      .from('macro_tracked_exercises')
      .select('id, exercise_id, exercises(*)')
      .eq('macrocycle_id', macroWeek.macrocycle_id)
      .order('position');

    const exercises = ((trackedExercisesData || []).map((item: any) => item.exercises).filter(Boolean)) as import('../lib/database.types').Exercise[];

    const { data: targetsData } = await supabase
      .from('macro_targets')
      .select('*')
      .eq('macro_week_id', macroWeek.id);

    const trackedExerciseMap: Record<string, string> = {};
    (trackedExercisesData || []).forEach((te: any) => { trackedExerciseMap[te.exercise_id] = te.id; });

    const targetsMap: MacroValidationData['macroTargets'] = {};
    (targetsData || []).forEach((target: any) => {
      const trackedEx = (trackedExercisesData || []).find((te: any) => te.id === target.tracked_exercise_id);
      if (trackedEx) {
        targetsMap[trackedEx.exercise_id] = { ...target, exercise_id: trackedEx.exercise_id };
      }
    });

    return { macroTargets: targetsMap, trackedExercises: exercises };
  };

  return {
    macrocycles,
    setMacrocycles,
    macroWeeks,
    setMacroWeeks,
    trackedExercises,
    setTrackedExercises,
    targets,
    setTargets,
    loading,
    error,
    setError,
    fetchMacrocycles,
    createMacrocycle,
    deleteMacrocycle,
    fetchMacroWeeks,
    updateMacroWeek,
    fetchTrackedExercises,
    addTrackedExercise,
    swapTrackedExercisePositions,
    removeTrackedExercise,
    reorderTrackedExercise,
    fetchTargets,
    upsertTarget,
    fetchMacroTargetForExercise,
    fetchMacroValidationData,
  };
}
