import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MacroCycle, MacroWeek, MacroTrackedExerciseWithExercise, MacroTarget, MacroPhase, MacroCompetition } from '../lib/database.types';

export interface MacroActuals {
  totalReps: number;
  avgWeight: number;
  hiWeight: number;
  repsHi: number;
  setsHi: number;
}

// weekId → exerciseId → actuals
export type MacroActualsMap = Record<string, Record<string, MacroActuals>>;

function errMsg(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  if (err instanceof Error) return err.message;
  return fallback;
}

export function useMacroCycles() {
  const [macrocycles, setMacrocycles] = useState<MacroCycle[]>([]);
  const [macroWeeks, setMacroWeeks] = useState<MacroWeek[]>([]);
  const [trackedExercises, setTrackedExercises] = useState<MacroTrackedExerciseWithExercise[]>([]);
  const [targets, setTargets] = useState<MacroTarget[]>([]);
  const [phases, setPhases] = useState<MacroPhase[]>([]);
  const [competitions, setCompetitions] = useState<MacroCompetition[]>([]);
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
      setError(errMsg(err, 'Failed to load macrocycles'));
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
      setError(errMsg(err, 'Failed to create macrocycle'));
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
      setError(errMsg(err, 'Failed to delete macrocycle'));
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
      setError(errMsg(err, 'Failed to load weeks'));
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
      setError(errMsg(err, 'Failed to update week'));
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
      setError(errMsg(err, 'Failed to load tracked exercises'));
    }
  };

  const addTrackedExercise = async (macrocycleId: string, exerciseId: string, position: number) => {
    try {
      const { error } = await supabase
        .from('macro_tracked_exercises')
        .insert({ macrocycle_id: macrocycleId, exercise_id: exerciseId, position });
      if (error) throw error;
    } catch (err) {
      setError(errMsg(err, 'Failed to add tracked exercise'));
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
      setError(errMsg(err, 'Failed to move tracked exercise'));
      throw err;
    }
  };

  const removeTrackedExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_tracked_exercises').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(errMsg(err, 'Failed to remove tracked exercise'));
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
      setError(errMsg(err, 'Failed to load targets'));
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
      setError(errMsg(err, 'Failed to update target'));
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

  // --- Phase operations ---

  const fetchPhases = async (macrocycleId: string) => {
    try {
      const { data, error } = await supabase
        .from('macro_phases')
        .select('*')
        .eq('macrocycle_id', macrocycleId)
        .order('position');
      if (error) throw error;
      setPhases(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load phases'));
    }
  };

  const createPhase = async (phase: Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>): Promise<MacroPhase> => {
    try {
      const { data, error } = await supabase
        .from('macro_phases')
        .insert(phase)
        .select()
        .single();
      if (error) throw error;
      setPhases(prev => [...prev, data].sort((a, b) => a.position - b.position));
      return data;
    } catch (err) {
      setError(errMsg(err, 'Failed to create phase'));
      throw err;
    }
  };

  const updatePhase = async (id: string, updates: Partial<MacroPhase>) => {
    try {
      const { error } = await supabase.from('macro_phases').update(updates).eq('id', id);
      if (error) throw error;
      setPhases(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    } catch (err) {
      setError(errMsg(err, 'Failed to update phase'));
      throw err;
    }
  };

  const deletePhase = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_phases').delete().eq('id', id);
      if (error) throw error;
      setPhases(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      setError(errMsg(err, 'Failed to delete phase'));
      throw err;
    }
  };

  // --- Competition operations ---

  const fetchCompetitions = async (macrocycleId: string) => {
    try {
      const { data, error } = await supabase
        .from('macro_competitions')
        .select('*')
        .eq('macrocycle_id', macrocycleId)
        .order('competition_date');
      if (error) throw error;
      setCompetitions(data || []);
    } catch (err) {
      setError(errMsg(err, 'Failed to load competitions'));
    }
  };

  const createCompetition = async (comp: Omit<MacroCompetition, 'id' | 'created_at'>): Promise<MacroCompetition> => {
    try {
      const { data, error } = await supabase
        .from('macro_competitions')
        .insert(comp)
        .select()
        .single();
      if (error) throw error;
      setCompetitions(prev => [...prev, data].sort((a, b) => a.competition_date.localeCompare(b.competition_date)));
      return data;
    } catch (err) {
      setError(errMsg(err, 'Failed to create competition'));
      throw err;
    }
  };

  const deleteCompetition = async (id: string) => {
    try {
      const { error } = await supabase.from('macro_competitions').delete().eq('id', id);
      if (error) throw error;
      setCompetitions(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(errMsg(err, 'Failed to delete competition'));
      throw err;
    }
  };

  // --- Actuals computation across full macro ---

  const fetchMacroActuals = async (
    athleteId: string,
    macroWeeksData: MacroWeek[],
    trackedExercisesData: MacroTrackedExerciseWithExercise[],
  ): Promise<MacroActualsMap> => {
    if (macroWeeksData.length === 0 || trackedExercisesData.length === 0) return {};

    const startDate = macroWeeksData[0].week_start;
    const lastWeek = macroWeeksData[macroWeeksData.length - 1];
    // end date = last week start + 6 days
    const endDate = new Date(lastWeek.week_start);
    endDate.setDate(endDate.getDate() + 6);
    const endDateISO = endDate.toISOString().split('T')[0];

    try {
      // Fetch week_plans for this athlete in the macro date range
      const { data: weekPlans } = await supabase
        .from('week_plans')
        .select('id, week_start')
        .eq('athlete_id', athleteId)
        .eq('is_group_plan', false)
        .gte('week_start', startDate)
        .lte('week_start', endDateISO);

      if (!weekPlans || weekPlans.length === 0) return {};

      const weekPlanIds = weekPlans.map(wp => wp.id);

      // Fetch planned_exercises for all these week_plans
      const { data: plannedExercises } = await supabase
        .from('planned_exercises')
        .select('weekplan_id, exercise_id, unit, summary_total_reps, summary_avg_load, summary_highest_load, prescription_raw')
        .in('weekplan_id', weekPlanIds);

      // Fetch combos + items + set_lines
      const { data: combos } = await supabase
        .from('planned_combos')
        .select('id, weekplan_id, unit')
        .in('weekplan_id', weekPlanIds);

      const comboIds = (combos || []).map(c => c.id);

      const [{ data: comboItems }, { data: comboSetLines }] = await Promise.all([
        comboIds.length > 0
          ? supabase.from('planned_combo_items').select('planned_combo_id, exercise_id, position').in('planned_combo_id', comboIds)
          : Promise.resolve({ data: [] }),
        comboIds.length > 0
          ? supabase.from('planned_combo_set_lines').select('planned_combo_id, sets, reps_tuple_text, load_value').in('planned_combo_id', comboIds)
          : Promise.resolve({ data: [] }),
      ]);

      // Build week_start → week_plan_id map
      const weekStartToWpId = new Map<string, string>();
      weekPlans.forEach(wp => weekStartToWpId.set(wp.week_start, wp.id));

      const result: MacroActualsMap = {};
      const trackedExIds = trackedExercisesData.map(te => te.exercise_id);

      for (const macroWeek of macroWeeksData) {
        const wpId = weekStartToWpId.get(macroWeek.week_start);
        if (!wpId) continue;

        const weekExercises = (plannedExercises || []).filter(pe => pe.weekplan_id === wpId);
        const weekCombos = (combos || []).filter(c => c.weekplan_id === wpId);
        const weekComboIds = new Set(weekCombos.map(c => c.id));
        const weekComboItems = (comboItems || []).filter(ci => weekComboIds.has(ci.planned_combo_id));
        const weekComboSetLines = (comboSetLines || []).filter(csl => weekComboIds.has(csl.planned_combo_id));

        result[macroWeek.id] = {};

        for (const exerciseId of trackedExIds) {
          let totalReps = 0;
          let totalWeightedReps = 0;
          let hiWeight = 0;
          const allSets: { weight: number; reps: number; sets: number }[] = [];

          // Direct planned exercises
          weekExercises.filter(pe => pe.exercise_id === exerciseId).forEach(pe => {
            totalReps += pe.summary_total_reps || 0;
            if (pe.unit === 'absolute_kg' && pe.summary_avg_load) {
              totalWeightedReps += pe.summary_avg_load * (pe.summary_total_reps || 0);
            }
            if (pe.prescription_raw && pe.unit === 'absolute_kg') {
              pe.prescription_raw.split(',').forEach((seg: string) => {
                const m = seg.trim().match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)(?:\s*[x×]\s*(\d+))?/i);
                if (m) {
                  const w = parseFloat(m[1]);
                  const r = parseInt(m[2], 10);
                  const s = m[3] ? parseInt(m[3], 10) : 1;
                  allSets.push({ weight: w, reps: r, sets: s });
                  if (w > hiWeight) hiWeight = w;
                }
              });
            }
          });

          // Combo exercises
          weekComboItems.filter(ci => ci.exercise_id === exerciseId).forEach(ci => {
            const combo = weekCombos.find(c => c.id === ci.planned_combo_id);
            if (!combo || combo.unit !== 'absolute_kg') return;
            weekComboSetLines.filter(csl => csl.planned_combo_id === ci.planned_combo_id).forEach(line => {
              const repsTuple = line.reps_tuple_text.split('+').map((r: string) => parseInt(r.trim(), 10));
              const repsForEx = repsTuple[ci.position - 1] || 0;
              const weight = line.load_value || 0;
              const sets = line.sets || 1;
              const lineReps = repsForEx * sets;
              totalReps += lineReps;
              if (weight > 0) {
                totalWeightedReps += weight * lineReps;
                allSets.push({ weight, reps: repsForEx, sets });
                if (weight > hiWeight) hiWeight = weight;
              }
            });
          });

          let repsHi = 0;
          let setsHi = 0;
          if (hiWeight > 0) {
            allSets.forEach(s => {
              if (s.weight === hiWeight) {
                if (s.reps > repsHi) repsHi = s.reps;
                setsHi += s.sets;
              }
            });
          }

          const avgWeight = totalReps > 0 ? Math.round((totalWeightedReps / totalReps) * 10) / 10 : 0;
          result[macroWeek.id][exerciseId] = { totalReps, avgWeight, hiWeight, repsHi, setsHi };
        }
      }

      return result;
    } catch {
      return {};
    }
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
    phases,
    setPhases,
    competitions,
    setCompetitions,
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
    fetchPhases,
    createPhase,
    updatePhase,
    deletePhase,
    fetchCompetitions,
    createCompetition,
    deleteCompetition,
    fetchMacroActuals,
  };
}
