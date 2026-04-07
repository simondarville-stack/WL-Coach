// TODO: Consider splitting into useWeekPlanData (loading) and useWeekPlanMutations (writes)
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type {
  WeekPlan,
  PlannedExercise,
  Exercise,
  AthletePR,
  PlannedSetLine,
  DefaultUnit,
  ComboMemberEntry,
} from '../lib/database.types';
import { DAYS_OF_WEEK } from '../lib/constants';
import { parsePrescription, parseFreeTextPrescription, parseComboPrescription } from '../lib/prescriptionParser';

export interface PlanSelection {
  type: 'individual' | 'group';
  athlete: { id: string } | null;
  group: { id: string } | null;
}

export function useWeekPlans() {
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  const [comboMembers, setComboMembers] = useState<Record<string, ComboMemberEntry[]>>({});
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
        .eq('owner_id', getOwnerId())
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
          owner_id: getOwnerId(),
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

      // Load combo members for any is_combo exercises
      const comboExs = (data || []).filter(e => e.is_combo);
      if (comboExs.length > 0) {
        const { data: members } = await supabase
          .from('planned_exercise_combo_members')
          .select('*, exercise:exercise_id(*)')
          .in('planned_exercise_id', comboExs.map(e => e.id))
          .order('position');
        const membersMap: Record<string, ComboMemberEntry[]> = {};
        type MemberRow = { planned_exercise_id: string; exercise_id: string; position: number; exercise: Exercise };
        (members || []).forEach((m: MemberRow) => {
          if (!membersMap[m.planned_exercise_id]) membersMap[m.planned_exercise_id] = [];
          membersMap[m.planned_exercise_id].push({
            exerciseId: m.exercise_id,
            exercise: m.exercise,
            position: m.position,
          });
        });
        setComboMembers(membersMap);
      } else {
        setComboMembers({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load planned exercises');
    }
  };

  // Kept for backward compat — combo members are now loaded in fetchPlannedExercises
  const fetchWeekCombos = async (_weekPlanId: string) => { /* no-op */ };

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
      const { data: existing } = await supabase.from('week_plans').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Access denied: resource belongs to another environment');
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
    const { data: toExercises } = await supabase
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', toDayIndex);

    const newToPosition = (toExercises?.length ?? 0) + 1;

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
    const { data: exData } = await supabase
      .from('planned_exercises')
      .select('id, position')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');

    const items = (exData || []).sort((a, b) => a.position - b.position);
    for (let i = 0; i < items.length; i++) {
      await supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', items[i].id);
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
    data: { prescription: string; unit: DefaultUnit; isCombo?: boolean },
  ): Promise<void> => {
    const { prescription, unit, isCombo } = data;
    const isFreeText = unit === 'free_text';
    const isRPE = unit === 'rpe';
    const isOtherUnit = unit === 'other';
    const isFreeTextReps = unit === 'free_text_reps';
    const isTextBased = isFreeText || isRPE || isFreeTextReps;
    const isNonNumeric = isFreeText || isOtherUnit;

    const { error: deleteError } = await supabase.from('planned_set_lines').delete().eq('planned_exercise_id', plannedExId);
    if (deleteError) throw deleteError;

    if (isCombo) {
      const parsed = parseComboPrescription(prescription);
      if (parsed.length > 0) {
        const lines = parsed.map((line, idx) => ({
          planned_exercise_id: plannedExId,
          sets: line.sets,
          reps: line.totalReps,
          reps_text: line.repsText,
          load_value: line.load,
          load_max: line.loadMax ?? null,
          position: idx + 1,
        }));
        const { error: insertError } = await supabase.from('planned_set_lines').insert(lines);
        if (insertError) throw insertError;

        const totalSets = parsed.reduce((sum, l) => sum + l.sets, 0);
        const totalReps = parsed.reduce((sum, l) => sum + l.sets * l.totalReps, 0);
        const highestLoad = Math.max(...parsed.map(l => l.loadMax ?? l.load));
        const effectiveLoad = (l: typeof parsed[0]) =>
          l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load;
        const weightedSum = parsed.reduce((sum, l) => sum + effectiveLoad(l) * l.sets * l.totalReps, 0);
        const avgLoad = totalReps > 0 ? weightedSum / totalReps : null;

        await supabase.from('planned_exercises').update({
          prescription_raw: prescription,
          unit,
          summary_total_sets: totalSets,
          summary_total_reps: totalReps,
          summary_highest_load: highestLoad,
          summary_avg_load: avgLoad,
        }).eq('id', plannedExId);
      } else {
        await supabase.from('planned_exercises').update({
          prescription_raw: prescription,
          unit,
          summary_total_sets: 0,
          summary_total_reps: 0,
          summary_highest_load: null,
          summary_avg_load: null,
        }).eq('id', plannedExId);
      }
      return;
    }

    const parsed = isNonNumeric ? [] : parsePrescription(prescription);
    const parsedText = isTextBased ? parseFreeTextPrescription(prescription) : [];

    if (parsed.length > 0 && !isNonNumeric && !isFreeTextReps) {
      const lines = parsed.map((line, idx) => ({
        planned_exercise_id: plannedExId,
        sets: line.sets,
        reps: line.reps,
        load_value: line.load,
        load_max: line.loadMax ?? null,
        position: idx + 1,
      }));
      const { error: insertLinesError } = await supabase.from('planned_set_lines').insert(lines);
      if (insertLinesError) throw insertLinesError;

      const totalSets = parsed.reduce((sum, l) => sum + l.sets, 0);
      const totalReps = parsed.reduce((sum, l) => sum + l.sets * l.reps, 0);
      const highestLoad = Math.max(...parsed.map(l => l.loadMax ?? l.load));
      const effectiveLoad = (l: typeof parsed[0]) =>
        l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load;
      const weightedSum = parsed.reduce((sum, l) => sum + effectiveLoad(l) * l.sets * l.reps, 0);
      const avgLoad = totalReps > 0 ? weightedSum / totalReps : null;

      await supabase.from('planned_exercises').update({
        prescription_raw: prescription,
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
        unit,
        summary_total_sets: totalSets,
        summary_total_reps: totalReps,
        summary_highest_load: null,
        summary_avg_load: null,
      }).eq('id', plannedExId);
    } else {
      await supabase.from('planned_exercises').update({
        prescription_raw: prescription,
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
    extras?: {
      prescription_raw?: string | null;
      notes?: string | null;
      summary_total_sets?: number;
      summary_total_reps?: number;
      summary_highest_load?: number | null;
      summary_avg_load?: number | null;
      is_combo?: boolean;
      combo_notation?: string | null;
      combo_color?: string | null;
    },
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
        is_combo: extras?.is_combo ?? false,
        combo_notation: extras?.combo_notation ?? null,
        combo_color: extras?.combo_color ?? null,
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
      is_combo: sourceEx.is_combo,
      combo_notation: sourceEx.combo_notation,
      combo_color: sourceEx.combo_color,
    });

    if (sourceEx.prescription_raw) {
      const { data: setLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', sourceEx.id);

      if (setLines && setLines.length > 0) {
        const { error: copyLinesError } = await supabase.from('planned_set_lines').insert(
          setLines.map(line => ({
            planned_exercise_id: newEx.id,
            sets: line.sets,
            reps: line.reps,
            reps_text: line.reps_text ?? null,
            load_value: line.load_value,
            load_max: line.load_max ?? null,
            position: line.position,
          }))
        );
        if (copyLinesError) throw copyLinesError;
      }
    }

    // Copy combo members if this is a combo exercise
    if (sourceEx.is_combo) {
      const { data: members } = await supabase
        .from('planned_exercise_combo_members')
        .select('exercise_id, position')
        .eq('planned_exercise_id', sourceEx.id)
        .order('position');

      if (members && members.length > 0) {
        const { error: copyMembersError } = await supabase.from('planned_exercise_combo_members').insert(
          members.map((m: { exercise_id: string; position: number }) => ({
            planned_exercise_id: newEx.id,
            exercise_id: m.exercise_id,
            position: m.position,
          }))
        );
        if (copyMembersError) throw copyMembersError;
      }
    }

    return newEx.id;
  };

  const createComboExercise = async (
    weekPlanId: string,
    dayIndex: number,
    position: number,
    data: {
      exercises: { exercise: Exercise; position: number }[];
      unit: DefaultUnit;
      comboName: string;
      color: string;
    },
  ): Promise<void> => {
    const autoNotation = data.exercises.map(e => e.exercise.name).join(' + ');
    const { data: comboEx, error } = await supabase
      .from('planned_exercises')
      .insert({
        weekplan_id: weekPlanId,
        day_index: dayIndex,
        exercise_id: data.exercises[0].exercise.id,
        position,
        unit: data.unit,
        is_combo: true,
        combo_notation: data.comboName || autoNotation,
        combo_color: data.color,
        summary_total_sets: 0,
        summary_total_reps: 0,
      })
      .select()
      .single();
    if (error) throw error;

    for (const part of data.exercises) {
      await supabase.from('planned_exercise_combo_members').insert({
        planned_exercise_id: comboEx.id,
        exercise_id: part.exercise.id,
        position: part.position,
      });
    }
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
    const { error: delLinesError } = await supabase.from('planned_set_lines').delete().in('planned_exercise_id', exerciseIds);
    if (delLinesError) throw delLinesError;
    const { error: delExError } = await supabase.from('planned_exercises').delete().in('id', exerciseIds);
    if (delExError) throw delExError;
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

  const updateItemPosition = async (_table: 'planned_exercises', id: string, position: number): Promise<void> => {
    await supabase.from('planned_exercises').update({ position }).eq('id', id);
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
      .eq('owner_id', getOwnerId())
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

  /**
   * Sync a group week plan to all active members of the group.
   * For each athlete, existing `source='group'` exercises are replaced with
   * a fresh copy from the group plan. Exercises the athlete has individually
   * overridden (`source='individual'`) are left untouched.
   */
  const syncGroupPlanToAthletes = async (groupPlanId: string, groupId: string, weekStart: string): Promise<void> => {
    // 1. Fetch group plan exercises
    const { data: groupExercises, error: exError } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('weekplan_id', groupPlanId)
      .order('day_index')
      .order('position');
    if (exError) throw exError;

    // 2. Fetch group plan set lines
    const groupExIds = (groupExercises || []).map(e => e.id);
    const { data: groupSetLines } = groupExIds.length > 0
      ? await supabase.from('planned_set_lines').select('*').in('planned_exercise_id', groupExIds)
      : { data: [] };
    const setLinesByExId = new Map<string, typeof groupSetLines>();
    (groupSetLines || []).forEach((l: { planned_exercise_id: string }) => {
      const arr = setLinesByExId.get(l.planned_exercise_id) || [];
      arr.push(l);
      setLinesByExId.set(l.planned_exercise_id, arr);
    });

    // 3. Fetch group members (active only)
    const { data: members, error: memError } = await supabase
      .from('group_members')
      .select('athlete_id')
      .eq('group_id', groupId)
      .is('left_at', null);
    if (memError) throw memError;

    for (const member of members || []) {
      const athleteId = member.athlete_id;

      // 4a. Get or create athlete's week plan
      const { data: existingPlan } = await supabase
        .from('week_plans')
        .select('id')
        .eq('owner_id', getOwnerId())
        .eq('athlete_id', athleteId)
        .eq('week_start', weekStart)
        .is('group_id', null)
        .maybeSingle();

      let athletePlanId: string;
      if (existingPlan) {
        athletePlanId = existingPlan.id;
      } else {
        const { data: newPlan, error: createError } = await supabase
          .from('week_plans')
          .insert([{ week_start: weekStart, athlete_id: athleteId, group_id: null, is_group_plan: false, owner_id: getOwnerId(), source_group_plan_id: groupPlanId }])
          .select('id')
          .single();
        if (createError) throw createError;
        athletePlanId = newPlan.id;
      }

      // 4b. Update source_group_plan_id on the athlete's plan
      await supabase.from('week_plans').update({ source_group_plan_id: groupPlanId }).eq('id', athletePlanId);

      // 4c. Delete existing group-sourced exercises
      const { data: existingGroupExs } = await supabase
        .from('planned_exercises')
        .select('id')
        .eq('weekplan_id', athletePlanId)
        .eq('source', 'group');
      const toDelete = (existingGroupExs || []).map((e: { id: string }) => e.id);
      if (toDelete.length > 0) {
        await supabase.from('planned_set_lines').delete().in('planned_exercise_id', toDelete);
        await supabase.from('planned_exercises').delete().in('id', toDelete);
      }

      // 4d. Insert copies of group exercises with source='group'
      for (const ex of groupExercises || []) {
        const { data: newEx, error: insError } = await supabase
          .from('planned_exercises')
          .insert([{
            weekplan_id: athletePlanId,
            exercise_id: ex.exercise_id,
            day_index: ex.day_index,
            position: ex.position,
            unit: ex.unit,
            prescription_raw: ex.prescription_raw,
            notes: ex.notes,
            summary_total_sets: ex.summary_total_sets,
            summary_total_reps: ex.summary_total_reps,
            summary_highest_load: ex.summary_highest_load,
            summary_avg_load: ex.summary_avg_load,
            is_combo: ex.is_combo,
            combo_notation: ex.combo_notation,
            combo_color: ex.combo_color,
            source: 'group',
          }])
          .select('id')
          .single();
        if (insError) throw insError;

        // Copy set lines
        const lines = setLinesByExId.get(ex.id) || [];
        if (lines.length > 0) {
          await supabase.from('planned_set_lines').insert(
            lines.map((l: { sets: number; reps: number; reps_text: string | null; load_value: number; load_max: number | null; position: number }) => ({
              planned_exercise_id: newEx.id,
              sets: l.sets,
              reps: l.reps,
              reps_text: l.reps_text ?? null,
              load_value: l.load_value,
              load_max: l.load_max ?? null,
              position: l.position,
            }))
          );
        }
      }
    }
  };

  /**
   * Promote a group-sourced exercise to an individual override.
   * The exercise will no longer be replaced on next group plan sync.
   */
  const promoteToIndividual = async (plannedExerciseId: string): Promise<void> => {
    const { error } = await supabase
      .from('planned_exercises')
      .update({ source: 'individual' })
      .eq('id', plannedExerciseId);
    if (error) throw error;
  };

  return {
    weekPlan,
    setWeekPlan,
    plannedExercises,
    setPlannedExercises,
    comboMembers,
    setComboMembers,
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
    createComboExercise,
    syncGroupPlanToAthletes,
    promoteToIndividual,
  };
}
