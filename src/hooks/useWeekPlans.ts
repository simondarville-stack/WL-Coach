import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  WeekPlan,
  PlannedExercise,
  Exercise,
  AthletePR,
  PlannedComboSetLine,
  PlannedSetLine,
  DefaultUnit,
} from '../lib/database.types';
import { DAYS_OF_WEEK } from '../lib/constants';
import { parsePrescription, parseFreeTextPrescription } from '../lib/prescriptionParser';

export interface PlanSelection {
  type: 'individual' | 'group';
  athlete: { id: string } | null;
  group: { id: string } | null;
}

export function useWeekPlans() {
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  const [weekComboSetLines, setWeekComboSetLines] = useState<(PlannedComboSetLine & { unit: string; day_index: number })[]>([]);
  const [weekComboItems, setWeekComboItems] = useState<{ combo_id: string; exercise: Exercise; position: number }[]>([]);
  const [comboExerciseIds, setComboExerciseIds] = useState<Set<string>>(new Set());
  const [athletePRs, setAthletePRs] = useState<AthletePR[]>([]);
  const [macroWeekTarget, setMacroWeekTarget] = useState<number | null>(null);
  const [macroWeekTypeText, setMacroWeekTypeText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrCreateWeekPlan = async (selectedDate: string, planSelection: PlanSelection): Promise<WeekPlan | null> => {
    const { type, athlete, group } = planSelection;
    if (!athlete && !group) return null;

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('week_plans')
        .select('*')
        .eq('week_start', selectedDate);

      if (type === 'individual' && athlete) {
        query = query.eq('athlete_id', athlete.id).is('group_id', null);
      } else if (type === 'group' && group) {
        query = query.eq('group_id', group.id).is('athlete_id', null);
      }

      const { data: existingPlan, error: searchError } = await query.maybeSingle();
      if (searchError) throw searchError;

      let plan = existingPlan;
      if (!plan) {
        const insertData: Record<string, unknown> = {
          week_start: selectedDate,
          is_group_plan: type === 'group',
        };

        if (type === 'individual' && athlete) {
          insertData.athlete_id = athlete.id;
          insertData.group_id = null;
        } else if (type === 'group' && group) {
          insertData.group_id = group.id;
          insertData.athlete_id = null;
        }

        const { data: newPlan, error: createError } = await supabase
          .from('week_plans')
          .insert([insertData])
          .select()
          .single();

        if (createError) {
          if (createError.code === '23505') {
            const { data: retryPlan, error: retryError } = await query.maybeSingle();
            if (retryError) throw retryError;
            if (retryPlan) {
              plan = retryPlan;
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        } else {
          plan = newPlan;
        }
      }

      setWeekPlan(plan);
      return plan;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load week plan');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const fetchPlannedExercises = async (weekPlanId: string, dayLabels?: Record<number, string> | null) => {
    try {
      const { data, error } = await supabase
        .from('planned_exercises')
        .select(`*, exercise:exercise_id(*)`)
        .eq('weekplan_id', weekPlanId)
        .order('day_index')
        .order('position');
      if (error) throw error;

      const grouped: Record<number, (PlannedExercise & { exercise: Exercise })[]> = {};

      if (dayLabels) {
        Object.keys(dayLabels).forEach(key => {
          grouped[parseInt(key)] = [];
        });
      } else {
        DAYS_OF_WEEK.forEach(day => {
          grouped[day.index] = [];
        });
      }

      (data || []).forEach(item => {
        if (!grouped[item.day_index]) {
          grouped[item.day_index] = [];
        }
        grouped[item.day_index].push(item);
      });

      setPlannedExercises(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load planned exercises');
    }
  };

  const fetchWeekCombos = async (weekPlanId: string) => {
    try {
      const { data: combos } = await supabase
        .from('planned_combos')
        .select('id, unit, day_index')
        .eq('weekplan_id', weekPlanId);

      if (!combos || combos.length === 0) {
        setWeekComboSetLines([]);
        setWeekComboItems([]);
        setComboExerciseIds(new Set());
        return;
      }

      const comboIds = combos.map(c => c.id);
      const comboUnitMap: Record<string, { unit: string; day_index: number }> = {};
      combos.forEach(c => { comboUnitMap[c.id] = { unit: c.unit, day_index: c.day_index }; });

      const { data: setLines } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .in('planned_combo_id', comboIds);

      const enriched = (setLines || []).map(line => ({
        ...line,
        unit: comboUnitMap[line.planned_combo_id]?.unit || 'absolute_kg',
        day_index: comboUnitMap[line.planned_combo_id]?.day_index || 0,
      }));
      setWeekComboSetLines(enriched);

      const { data: items } = await supabase
        .from('planned_combo_items')
        .select('planned_exercise_id, planned_combo_id, position, exercise:exercise_id(*)')
        .in('planned_combo_id', comboIds)
        .order('position');

      const ids = new Set<string>((items || []).map((i: any) => i.planned_exercise_id));
      setComboExerciseIds(ids);

      const comboItemsForCategories = (items || []).map((i: any) => ({
        combo_id: i.planned_combo_id,
        exercise: i.exercise as Exercise,
        position: i.position as number,
      }));
      setWeekComboItems(comboItemsForCategories);
    } catch (err) {
    }
  };

  const fetchMacroWeekTarget = async (athleteId: string, selectedDate: string) => {
    try {
      const { data: macrocycles, error: macroError } = await supabase
        .from('macrocycles')
        .select('id, start_date, end_date')
        .eq('athlete_id', athleteId)
        .lte('start_date', selectedDate)
        .gte('end_date', selectedDate);

      if (macroError) throw macroError;

      if (!macrocycles || macrocycles.length === 0) {
        setMacroWeekTarget(null);
        return;
      }

      const { data: macroWeeks, error: weekError } = await supabase
        .from('macro_weeks')
        .select('id, total_reps_target, week_type_text')
        .eq('macrocycle_id', macrocycles[0].id)
        .lte('week_start', selectedDate)
        .gte('week_start', new Date(new Date(selectedDate).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('week_start', { ascending: false })
        .limit(1);

      const macroWeek = macroWeeks && macroWeeks.length > 0 ? macroWeeks[0] : null;
      if (weekError) throw weekError;

      setMacroWeekTarget(macroWeek?.total_reps_target || null);
      setMacroWeekTypeText(macroWeek?.week_type_text || null);
    } catch (err) {
      setMacroWeekTarget(null);
      setMacroWeekTypeText(null);
    }
  };

  const fetchAthletePRs = async (athleteId: string) => {
    try {
      const { data, error } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('athlete_id', athleteId);
      if (error) throw error;
      setAthletePRs(data || []);
    } catch (err) {
      setAthletePRs([]);
    }
  };

  const deletePlannedExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('planned_exercises').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
      throw err;
    }
  };

  const updateWeekPlan = async (id: string, updates: Partial<WeekPlan>) => {
    try {
      const { error } = await supabase.from('week_plans').update(updates).eq('id', id);
      if (error) throw error;
      setWeekPlan(prev => prev ? { ...prev, ...updates } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update week plan');
      throw err;
    }
  };

  const reorderExercises = async (weekPlanId: string, orderedIds: string[]) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', orderedIds[i]);
    }
  };

  const moveExercise = async (
    weekPlanId: string,
    exerciseId: string,
    fromDayIndex: number,
    toDayIndex: number,
  ) => {
    const { data: toCombos } = await supabase
      .from('planned_combos')
      .select('id')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', toDayIndex);

    const { data: toExercises } = await supabase
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', toDayIndex);

    const { data: toComboItems } = (toCombos && toCombos.length > 0)
      ? await supabase.from('planned_combo_items').select('planned_exercise_id').in('planned_combo_id', toCombos.map((c: any) => c.id))
      : { data: [] };

    const toComboExIds = new Set((toComboItems || []).map((i: any) => i.planned_exercise_id));
    const toVisibleCount = (toExercises || []).filter((ex: any) => !toComboExIds.has(ex.id)).length;
    const newToPosition = toVisibleCount + (toCombos?.length || 0) + 1;

    await supabase
      .from('planned_exercises')
      .update({ day_index: toDayIndex, position: newToPosition })
      .eq('id', exerciseId);

    await Promise.all([
      normalizePositions(weekPlanId, fromDayIndex),
      normalizePositions(weekPlanId, toDayIndex),
    ]);
  };

  const normalizePositions = async (weekPlanId: string, dayIndex: number) => {
    const [{ data: exData }, { data: comboData }] = await Promise.all([
      supabase
        .from('planned_exercises')
        .select('id, position')
        .eq('weekplan_id', weekPlanId)
        .eq('day_index', dayIndex)
        .order('position'),
      supabase
        .from('planned_combos')
        .select('id, position')
        .eq('weekplan_id', weekPlanId)
        .eq('day_index', dayIndex)
        .order('position'),
    ]);

    const comboIds = (comboData || []).map((c: any) => c.id);
    const { data: comboItemData } = comboIds.length > 0
      ? await supabase.from('planned_combo_items').select('planned_exercise_id').in('planned_combo_id', comboIds)
      : { data: [] };

    const comboExerciseIdSet = new Set((comboItemData || []).map((i: any) => i.planned_exercise_id));
    const visibleExercises = (exData || []).filter((ex: any) => !comboExerciseIdSet.has(ex.id));

    const allItems: Array<{ table: 'planned_exercises' | 'planned_combos'; id: string; position: number }> = [
      ...visibleExercises.map((ex: any) => ({ table: 'planned_exercises' as const, id: ex.id, position: ex.position })),
      ...(comboData || []).map((c: any) => ({ table: 'planned_combos' as const, id: c.id, position: c.position })),
    ].sort((a, b) => a.position - b.position);

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      await supabase.from(item.table).update({ position: i + 1 }).eq('id', item.id);
    }
  };

  // --- Set line operations ---

  const fetchSetLines = async (plannedExerciseId: string): Promise<PlannedSetLine[]> => {
    const { data, error } = await supabase
      .from('planned_set_lines')
      .select('*')
      .eq('planned_exercise_id', plannedExerciseId)
      .order('position');
    if (error) throw error;
    return data || [];
  };

  const addSetLine = async (
    plannedExerciseId: string,
    position: number,
  ): Promise<PlannedSetLine> => {
    const { data, error } = await supabase
      .from('planned_set_lines')
      .insert([{ planned_exercise_id: plannedExerciseId, sets: 3, reps: 3, load_value: 0, position }])
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const deleteSetLine = async (lineId: string): Promise<void> => {
    const { error } = await supabase.from('planned_set_lines').delete().eq('id', lineId);
    if (error) throw error;
  };

  const normalizeSetLinePositions = async (lines: PlannedSetLine[]): Promise<void> => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].position !== i + 1) {
        await supabase.from('planned_set_lines').update({ position: i + 1 }).eq('id', lines[i].id);
      }
    }
  };

  const saveSetLinesWithSummary = async (
    plannedExerciseId: string,
    setLines: PlannedSetLine[],
  ): Promise<void> => {
    for (const line of setLines) {
      await supabase
        .from('planned_set_lines')
        .update({ sets: line.sets, reps: line.reps, load_value: line.load_value })
        .eq('id', line.id);
    }

    const total_sets = setLines.reduce((sum, l) => sum + l.sets, 0);
    const total_reps = setLines.reduce((sum, l) => sum + l.sets * l.reps, 0);
    const highest_load = setLines.length > 0 ? Math.max(...setLines.map(l => l.load_value)) : null;
    const weighted = setLines.reduce((sum, l) => sum + l.load_value * l.sets * l.reps, 0);
    const avg_load = total_reps > 0 ? weighted / total_reps : null;

    await supabase
      .from('planned_exercises')
      .update({ summary_total_sets: total_sets, summary_total_reps: total_reps, summary_highest_load: highest_load, summary_avg_load: avg_load })
      .eq('id', plannedExerciseId);
  };

  const savePrescription = async (
    plannedExId: string,
    data: { prescription: string; notes: string; unit: DefaultUnit },
  ): Promise<void> => {
    const { prescription, notes, unit } = data;
    const isFreeText = unit === 'free_text';
    const isRPE = unit === 'rpe';
    const isOtherUnit = unit === 'other';
    const isTextBased = isFreeText || isRPE;
    const isNonNumeric = isFreeText || isOtherUnit;

    const parsed = isNonNumeric ? [] : parsePrescription(prescription);
    const parsedText = isTextBased ? parseFreeTextPrescription(prescription) : [];

    await supabase.from('planned_set_lines').delete().eq('planned_exercise_id', plannedExId);

    if (parsed.length > 0 && !isNonNumeric) {
      const lines = parsed.map((line, idx) => ({
        planned_exercise_id: plannedExId,
        sets: line.sets,
        reps: line.reps,
        load_value: line.load,
        position: idx + 1,
      }));
      await supabase.from('planned_set_lines').insert(lines);

      const totalSets = parsed.reduce((sum, l) => sum + l.sets, 0);
      const totalReps = parsed.reduce((sum, l) => sum + l.sets * l.reps, 0);
      const highestLoad = Math.max(...parsed.map(l => l.load));
      const weightedSum = parsed.reduce((sum, l) => sum + l.load * l.sets * l.reps, 0);
      const avgLoad = totalReps > 0 ? weightedSum / totalReps : null;

      await supabase.from('planned_exercises').update({
        prescription_raw: prescription,
        notes: notes.trim() || null,
        unit,
        summary_total_sets: totalSets,
        summary_total_reps: totalReps,
        summary_highest_load: highestLoad,
        summary_avg_load: avgLoad,
      }).eq('id', plannedExId);
    } else if (parsedText.length > 0 && isTextBased) {
      const totalSets = parsedText.reduce((sum, l) => sum + l.sets, 0);
      const totalReps = parsedText.reduce((sum, l) => sum + l.sets * l.reps, 0);

      await supabase.from('planned_exercises').update({
        prescription_raw: prescription,
        notes: notes.trim() || null,
        unit,
        summary_total_sets: totalSets,
        summary_total_reps: totalReps,
        summary_highest_load: null,
        summary_avg_load: null,
      }).eq('id', plannedExId);
    } else {
      await supabase.from('planned_exercises').update({
        prescription_raw: prescription,
        notes: notes.trim() || null,
        unit,
        summary_total_sets: 0,
        summary_total_reps: 0,
        summary_highest_load: null,
        summary_avg_load: null,
      }).eq('id', plannedExId);
    }
  };

  const saveNotes = async (plannedExId: string, notes: string): Promise<void> => {
    const { error } = await supabase
      .from('planned_exercises')
      .update({ notes: notes.trim() || null })
      .eq('id', plannedExId);
    if (error) throw error;
  };

  const fetchOtherDayPrescriptions = async (
    weekplanId: string,
    exerciseId: string,
    excludeId: string,
  ): Promise<{ dayIndex: number; prescriptionRaw: string | null; totalSets: number | null; totalReps: number | null }[]> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .select('day_index, prescription_raw, summary_total_sets, summary_total_reps')
      .eq('weekplan_id', weekplanId)
      .eq('exercise_id', exerciseId)
      .neq('id', excludeId);
    if (error) throw error;
    return (data || []).map(ex => ({
      dayIndex: ex.day_index,
      prescriptionRaw: ex.prescription_raw,
      totalSets: ex.summary_total_sets,
      totalReps: ex.summary_total_reps,
    }));
  };

  // --- Day-level exercise operations (used by DayColumn) ---

  const addExerciseToDay = async (
    weekPlanId: string,
    dayIndex: number,
    exerciseId: string,
    position: number,
    unit: DefaultUnit,
    extras?: { prescription_raw?: string | null; notes?: string | null; summary_total_sets?: number; summary_total_reps?: number; summary_highest_load?: number | null; summary_avg_load?: number | null },
  ): Promise<PlannedExercise & { id: string }> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .insert([{
        weekplan_id: weekPlanId,
        day_index: dayIndex,
        exercise_id: exerciseId,
        position,
        unit,
        summary_total_sets: extras?.summary_total_sets ?? 0,
        summary_total_reps: extras?.summary_total_reps ?? 0,
        summary_highest_load: extras?.summary_highest_load ?? null,
        summary_avg_load: extras?.summary_avg_load ?? null,
        prescription_raw: extras?.prescription_raw ?? null,
        notes: extras?.notes ?? null,
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const copyExerciseWithSetLines = async (
    sourceEx: PlannedExercise,
    weekPlanId: string,
    dayIndex: number,
    position: number,
  ): Promise<string> => {
    const newEx = await addExerciseToDay(weekPlanId, dayIndex, sourceEx.exercise_id, position, sourceEx.unit as DefaultUnit, {
      prescription_raw: sourceEx.prescription_raw,
      summary_total_sets: sourceEx.summary_total_sets ?? 0,
      summary_total_reps: sourceEx.summary_total_reps ?? 0,
      summary_highest_load: sourceEx.summary_highest_load,
      summary_avg_load: sourceEx.summary_avg_load,
    });

    if (sourceEx.prescription_raw) {
      const { data: setLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', sourceEx.id);

      if (setLines && setLines.length > 0) {
        await supabase.from('planned_set_lines').insert(
          setLines.map(line => ({
            planned_exercise_id: newEx.id,
            sets: line.sets,
            reps: line.reps,
            load_value: line.load_value,
            position: line.position,
          }))
        );
      }
    }

    return newEx.id;
  };

  const copyDayExercises = async (
    sourceExercises: PlannedExercise[],
    targetWeekPlanId: string,
    targetDayIndex: number,
    basePosition: number,
  ): Promise<void> => {
    for (let i = 0; i < sourceExercises.length; i++) {
      await copyExerciseWithSetLines(sourceExercises[i], targetWeekPlanId, targetDayIndex, basePosition + i);
    }
  };

  const deleteDayExercises = async (exerciseIds: string[]): Promise<void> => {
    if (exerciseIds.length === 0) return;
    await supabase.from('planned_set_lines').delete().in('planned_exercise_id', exerciseIds);
    await supabase.from('planned_exercises').delete().in('id', exerciseIds);
  };

  const fetchExercisesForDay = async (weekPlanId: string, dayIndex: number): Promise<PlannedExercise[]> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');
    if (error) throw error;
    return data || [];
  };

  const updateItemPosition = async (table: 'planned_exercises' | 'planned_combos', id: string, position: number): Promise<void> => {
    await supabase.from(table).update({ position }).eq('id', id);
  };

  const fetchExerciseByCode = async (code: string): Promise<Exercise | null> => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('exercise_code', code)
      .maybeSingle();
    return data || null;
  };

  const fetchPlannedExerciseById = async (id: string): Promise<PlannedExercise | null> => {
    const { data } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return data || null;
  };

  const fetchWeekPlanForAthlete = async (athleteId: string, weekStart: string): Promise<WeekPlan | null> => {
    const { data, error } = await supabase
      .from('week_plans')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const fetchPlannedExercisesFlat = async (weekPlanId: string): Promise<(PlannedExercise & { exercise: Exercise })[]> => {
    const { data, error } = await supabase
      .from('planned_exercises')
      .select(`*, exercise:exercises(*)`)
      .eq('weekplan_id', weekPlanId)
      .order('day_index')
      .order('position');
    if (error) throw error;
    return data || [];
  };

  return {
    weekPlan,
    setWeekPlan,
    plannedExercises,
    setPlannedExercises,
    weekComboSetLines,
    weekComboItems,
    comboExerciseIds,
    athletePRs,
    setAthletePRs,
    macroWeekTarget,
    setMacroWeekTarget,
    macroWeekTypeText,
    setMacroWeekTypeText,
    loading,
    error,
    setError,
    fetchOrCreateWeekPlan,
    fetchPlannedExercises,
    fetchWeekCombos,
    fetchMacroWeekTarget,
    fetchAthletePRs,
    deletePlannedExercise,
    updateWeekPlan,
    reorderExercises,
    moveExercise,
    normalizePositions,
    fetchSetLines,
    addSetLine,
    deleteSetLine,
    normalizeSetLinePositions,
    saveSetLinesWithSummary,
    savePrescription,
    saveNotes,
    fetchOtherDayPrescriptions,
    addExerciseToDay,
    copyExerciseWithSetLines,
    copyDayExercises,
    deleteDayExercises,
    fetchExercisesForDay,
    updateItemPosition,
    fetchExerciseByCode,
    fetchPlannedExerciseById,
    fetchWeekPlanForAthlete,
    fetchPlannedExercisesFlat,
  };
}
