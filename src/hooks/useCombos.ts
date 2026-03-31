import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ExerciseComboTemplateWithParts, PlannedComboWithDetails, Exercise, DefaultUnit } from '../lib/database.types';

export function useCombos() {
  const [templates, setTemplates] = useState<ExerciseComboTemplateWithParts[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('exercise_combo_templates')
        .select(`*, parts:exercise_combo_template_parts(*, exercise:exercise_id(*))`)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load combo templates');
    } finally {
      setLoading(false);
    }
  };

  const deleteCombo = async (comboId: string) => {
    try {
      const { error } = await supabase.from('planned_combos').delete().eq('id', comboId);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete combo');
      throw err;
    }
  };

  const checkDestinationWeekHasData = async (
    weekStart: string,
    athleteId: string | null,
    groupId: string | null,
  ): Promise<boolean> => {
    let query = supabase
      .from('week_plans')
      .select('id', { count: 'exact', head: true })
      .eq('week_start', weekStart);

    if (athleteId) {
      query = query.eq('athlete_id', athleteId).is('group_id', null);
    } else if (groupId) {
      query = query.eq('group_id', groupId).is('athlete_id', null);
    } else {
      query = query.is('athlete_id', null).is('group_id', null);
    }

    const { count } = await query;
    return (count ?? 0) > 0;
  };

  const copyWeekPlan = async (params: {
    sourceWeekStart: string;
    destinationWeekStart: string;
    sourceAthleteId: string | null;
    sourceGroupId: string | null;
    targetAthleteId: string | null;
    targetGroupId: string | null;
    destinationHasData: boolean;
  }) => {
    const {
      sourceWeekStart, destinationWeekStart,
      sourceAthleteId, sourceGroupId,
      targetAthleteId, targetGroupId,
      destinationHasData,
    } = params;

    const buildOwnerFilter = (query: any, athleteId: string | null, groupId: string | null) => {
      if (athleteId) return query.eq('athlete_id', athleteId).is('group_id', null);
      if (groupId) return query.eq('group_id', groupId).is('athlete_id', null);
      return query.is('athlete_id', null).is('group_id', null);
    };

    // 1. Fetch source week plan
    let sourceQuery = buildOwnerFilter(
      supabase.from('week_plans').select('*').eq('week_start', sourceWeekStart),
      sourceAthleteId, sourceGroupId,
    );
    const { data: sourceWeekPlan, error: sourceError } = await sourceQuery.maybeSingle();
    if (sourceError) throw sourceError;
    if (!sourceWeekPlan) throw new Error('Source week has no data to paste');

    // 2. Delete destination if exists
    if (destinationHasData) {
      let deleteQuery = buildOwnerFilter(
        supabase.from('week_plans').delete().eq('week_start', destinationWeekStart),
        targetAthleteId, targetGroupId,
      );
      const { error: deleteError } = await deleteQuery;
      if (deleteError) throw deleteError;
    }

    // 3. Create new week plan with destination owner
    const { id: _oldId, created_at: _created, ...weekPlanData } = sourceWeekPlan;
    const { data: createdWeekPlan, error: createError } = await supabase
      .from('week_plans')
      .insert([{
        ...weekPlanData,
        week_start: destinationWeekStart,
        athlete_id: targetAthleteId,
        group_id: targetGroupId,
        is_group_plan: !!targetGroupId,
      }])
      .select()
      .single();
    if (createError) throw createError;

    // 4. Copy planned exercises
    const { data: sourceExercises, error: exercisesError } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('weekplan_id', sourceWeekPlan.id);
    if (exercisesError) throw exercisesError;

    const exerciseIdMap = new Map<string, string>();
    if (sourceExercises && sourceExercises.length > 0) {
      for (const ex of sourceExercises) {
        const { id: oldExId, created_at: _c, weekplan_id: _wpId, ...exData } = ex;
        const { data: newExercise, error: insertExError } = await supabase
          .from('planned_exercises')
          .insert([{ ...exData, weekplan_id: createdWeekPlan.id }])
          .select()
          .single();
        if (insertExError) throw insertExError;
        if (newExercise) exerciseIdMap.set(oldExId, newExercise.id);
      }
    }

    // 5. Copy combos
    const { data: sourceCombos, error: combosError } = await supabase
      .from('planned_combos')
      .select('*')
      .eq('weekplan_id', sourceWeekPlan.id);
    if (combosError) throw combosError;

    if (sourceCombos && sourceCombos.length > 0) {
      const comboIdMap = new Map<string, string>();

      for (const combo of sourceCombos) {
        const { id: oldComboId, created_at: _c, weekplan_id: _wpId, ...comboData } = combo;
        const { data: newCombo, error: comboInsertError } = await supabase
          .from('planned_combos')
          .insert([{ ...comboData, weekplan_id: createdWeekPlan.id }])
          .select()
          .single();
        if (comboInsertError) throw comboInsertError;
        comboIdMap.set(oldComboId, newCombo.id);
      }

      const { data: sourceComboItems, error: comboItemsError } = await supabase
        .from('planned_combo_items')
        .select('*')
        .in('planned_combo_id', Array.from(comboIdMap.keys()));
      if (comboItemsError) throw comboItemsError;

      if (sourceComboItems && sourceComboItems.length > 0) {
        const newComboItems = sourceComboItems.map((item: any) => {
          const { id: _id, created_at: _c, planned_combo_id: oldComboId, planned_exercise_id: oldExId, ...itemData } = item;
          return {
            ...itemData,
            planned_combo_id: comboIdMap.get(oldComboId)!,
            planned_exercise_id: exerciseIdMap.get(oldExId)!,
          };
        });
        const { error: itemsInsertError } = await supabase.from('planned_combo_items').insert(newComboItems);
        if (itemsInsertError) throw itemsInsertError;
      }

      const { data: sourceSetLines, error: setLinesError } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .in('planned_combo_id', Array.from(comboIdMap.keys()));
      if (setLinesError) throw setLinesError;

      if (sourceSetLines && sourceSetLines.length > 0) {
        const newSetLines = sourceSetLines.map((line: any) => {
          const { id: _id, created_at: _c, planned_combo_id: oldComboId, ...lineData } = line;
          return { ...lineData, planned_combo_id: comboIdMap.get(oldComboId)! };
        });
        const { error: linesInsertError } = await supabase.from('planned_combo_set_lines').insert(newSetLines);
        if (linesInsertError) throw linesInsertError;
      }
    }
  };

  // --- Fetches all combos with full details for a day ---
  const loadDayCombos = async (
    weekPlanId: string,
    dayIndex: number,
  ): Promise<{ combos: PlannedComboWithDetails[]; comboExerciseIds: Set<string> }> => {
    const { data: combosData, error } = await supabase
      .from('planned_combos')
      .select('*')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');

    if (error) throw error;

    const combosWithDetails: PlannedComboWithDetails[] = [];
    const linkedExerciseIds = new Set<string>();

    for (const combo of combosData || []) {
      let template = null;
      if (combo.template_id) {
        const { data: tpl } = await supabase
          .from('exercise_combo_templates')
          .select('*')
          .eq('id', combo.template_id)
          .maybeSingle();
        template = tpl;
      }

      const { data: items } = await supabase
        .from('planned_combo_items')
        .select('*, exercise:exercise_id(*)')
        .eq('planned_combo_id', combo.id)
        .order('position');

      const { data: setLines } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .eq('planned_combo_id', combo.id)
        .order('position');

      if (items && items.length > 0) {
        combosWithDetails.push({
          ...combo,
          template,
          items: items.map(item => ({ ...item, exercise: item.exercise })),
          set_lines: setLines || [],
        });
        items.forEach(item => linkedExerciseIds.add(item.planned_exercise_id));
      }
    }

    return { combos: combosWithDetails, comboExerciseIds: linkedExerciseIds };
  };

  // --- Fetches all combos with full details for an entire week plan ---
  const fetchProgrammeData = async (
    weekPlanId: string,
  ): Promise<{ combos: PlannedComboWithDetails[]; comboExerciseIds: Set<string> }> => {
    const { data: combosData, error } = await supabase
      .from('planned_combos')
      .select('*')
      .eq('weekplan_id', weekPlanId)
      .order('day_index')
      .order('position');

    if (error) throw error;

    const combosWithDetails: PlannedComboWithDetails[] = [];
    const linkedIds = new Set<string>();

    for (const combo of combosData || []) {
      let template = null;
      if (combo.template_id) {
        const { data: tpl } = await supabase
          .from('exercise_combo_templates')
          .select('*')
          .eq('id', combo.template_id)
          .maybeSingle();
        template = tpl;
      }

      const { data: items, error: itemsError } = await supabase
        .from('planned_combo_items')
        .select('*, exercise:exercise_id(*)')
        .eq('planned_combo_id', combo.id)
        .order('position');

      if (itemsError) continue;

      const { data: setLines } = await supabase
        .from('planned_combo_set_lines')
        .select('*')
        .eq('planned_combo_id', combo.id)
        .order('position');

      if (items && items.length > 0) {
        combosWithDetails.push({
          ...combo,
          template,
          items: items.map(item => ({ ...item, exercise: item.exercise })),
          set_lines: setLines || [],
        });
        items.forEach(item => linkedIds.add(item.planned_exercise_id));
      }
    }

    return { combos: combosWithDetails, comboExerciseIds: linkedIds };
  };

  // --- Creates a new combo with exercises, items, and default set line ---
  const createCombo = async (
    weekPlanId: string,
    dayIndex: number,
    position: number,
    data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string },
  ): Promise<void> => {
    const defaultRepsTuple = data.exercises.map(() => '1').join('+');

    const { data: newCombo, error: comboError } = await supabase
      .from('planned_combos')
      .insert({
        weekplan_id: weekPlanId,
        day_index: dayIndex,
        position,
        template_id: null,
        combo_name: data.comboName || null,
        unit: data.unit,
        shared_load_value: 0,
        sets: 1,
        reps_tuple_text: defaultRepsTuple,
        color: data.color,
      })
      .select()
      .single();

    if (comboError) throw comboError;

    for (let i = 0; i < data.exercises.length; i++) {
      const part = data.exercises[i];

      const { data: plannedEx, error: exError } = await supabase
        .from('planned_exercises')
        .insert({
          weekplan_id: weekPlanId,
          day_index: dayIndex,
          exercise_id: part.exercise.id,
          position,
          unit: data.unit,
          summary_total_sets: 0,
          summary_total_reps: 0,
        })
        .select()
        .single();

      if (exError) throw exError;

      const { error: itemError } = await supabase
        .from('planned_combo_items')
        .insert({
          planned_combo_id: newCombo.id,
          exercise_id: part.exercise.id,
          position: i + 1,
          planned_exercise_id: plannedEx.id,
        });

      if (itemError) throw itemError;
    }

    const { error: setLineError } = await supabase
      .from('planned_combo_set_lines')
      .insert({
        planned_combo_id: newCombo.id,
        position: 1,
        load_value: 0,
        sets: 1,
        reps_tuple_text: defaultRepsTuple,
      });

    if (setLineError) throw setLineError;
  };

  // --- Deletes a combo and all its related exercises ---
  const deleteComboWithExercises = async (comboId: string, items?: { planned_exercise_id: string }[]): Promise<void> => {
    let plannedExIds: string[];

    if (items) {
      plannedExIds = items.map(i => i.planned_exercise_id);
    } else {
      const { data } = await supabase
        .from('planned_combo_items')
        .select('planned_exercise_id')
        .eq('planned_combo_id', comboId);
      plannedExIds = (data || []).map(i => i.planned_exercise_id);
    }

    if (plannedExIds.length > 0) {
      await supabase.from('planned_set_lines').delete().in('planned_exercise_id', plannedExIds);
    }
    await supabase.from('planned_combo_set_lines').delete().eq('planned_combo_id', comboId);
    await supabase.from('planned_combo_items').delete().eq('planned_combo_id', comboId);
    if (plannedExIds.length > 0) {
      await supabase.from('planned_exercises').delete().in('id', plannedExIds);
    }
    await supabase.from('planned_combos').delete().eq('id', comboId);
  };

  // --- Copies a combo to a target day/week ---
  const copyComboToDay = async (
    sourceComboId: string,
    sourceCombos: PlannedComboWithDetails[],
    targetWeekPlanId: string,
    targetDayIndex: number,
    targetPosition: number,
  ): Promise<void> => {
    const srcCombo = sourceCombos.find(c => c.id === sourceComboId);
    let sourceCombo: any = srcCombo;
    let sourceItems: any[] = srcCombo?.items || [];
    let sourceSetLines: any[] = srcCombo?.set_lines || [];

    if (!sourceCombo) {
      const { data: sc } = await supabase.from('planned_combos').select('*').eq('id', sourceComboId).single();
      if (!sc) return;
      sourceCombo = sc;
      const { data: si } = await supabase.from('planned_combo_items').select('*, exercise:exercise_id(*)').eq('planned_combo_id', sourceComboId).order('position');
      sourceItems = si?.map((item: any) => ({ ...item, exercise: item.exercise })) || [];
      const { data: ssl } = await supabase.from('planned_combo_set_lines').select('*').eq('planned_combo_id', sourceComboId).order('position');
      sourceSetLines = ssl || [];
    }

    const { data: newCombo, error: comboError } = await supabase
      .from('planned_combos')
      .insert({
        weekplan_id: targetWeekPlanId,
        day_index: targetDayIndex,
        position: targetPosition,
        template_id: sourceCombo.template_id || null,
        combo_name: sourceCombo.combo_name || null,
        unit: sourceCombo.unit,
        shared_load_value: sourceCombo.shared_load_value,
        sets: sourceCombo.sets,
        reps_tuple_text: sourceCombo.reps_tuple_text,
        notes: sourceCombo.notes,
      })
      .select()
      .single();

    if (comboError) throw comboError;

    for (const item of sourceItems) {
      const { data: srcExData } = await supabase
        .from('planned_exercises')
        .select('*')
        .eq('id', item.planned_exercise_id)
        .maybeSingle();

      const { data: plannedEx, error: exError } = await supabase
        .from('planned_exercises')
        .insert({
          weekplan_id: targetWeekPlanId,
          day_index: targetDayIndex,
          exercise_id: item.exercise_id,
          position: targetPosition,
          unit: sourceCombo.unit,
          summary_total_sets: srcExData?.summary_total_sets ?? 0,
          summary_total_reps: srcExData?.summary_total_reps ?? 0,
          summary_highest_load: srcExData?.summary_highest_load ?? null,
          summary_avg_load: srcExData?.summary_avg_load ?? null,
        })
        .select()
        .single();

      if (exError) throw exError;

      await supabase.from('planned_combo_items').insert({
        planned_combo_id: newCombo.id,
        exercise_id: item.exercise_id,
        position: item.position,
        planned_exercise_id: plannedEx.id,
      });

      const { data: srcSetLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', item.planned_exercise_id)
        .order('position');

      if (srcSetLines && srcSetLines.length > 0) {
        await supabase.from('planned_set_lines').insert(
          srcSetLines.map(line => ({
            planned_exercise_id: plannedEx.id,
            sets: line.sets,
            reps: line.reps,
            load_value: line.load_value,
            position: line.position,
          }))
        );
      }
    }

    for (const line of sourceSetLines) {
      await supabase.from('planned_combo_set_lines').insert({
        planned_combo_id: newCombo.id,
        position: line.position,
        load_value: line.load_value,
        sets: line.sets,
        reps_tuple_text: line.reps_tuple_text,
      });
    }
  };

  // --- Saves combo set lines with rollback on error ---
  const saveComboSetLines = async (
    combo: PlannedComboWithDetails,
    parsed: { loadValue: number; repsTuple: string; sets: number }[],
    notes: string,
  ): Promise<void> => {
    // Capture snapshots for rollback
    const { data: existingSetLines } = await supabase
      .from('planned_combo_set_lines')
      .select('*')
      .eq('planned_combo_id', combo.id)
      .order('position');

    const perItemSnapshots: { plannedExerciseId: string; setLines: any[]; summary: any }[] = [];
    for (const item of combo.items) {
      const { data: itemSetLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .eq('planned_exercise_id', item.planned_exercise_id)
        .order('position');
      const { data: itemSummary } = await supabase
        .from('planned_exercises')
        .select('summary_total_sets, summary_total_reps, summary_avg_load, summary_highest_load')
        .eq('id', item.planned_exercise_id)
        .maybeSingle();
      perItemSnapshots.push({ plannedExerciseId: item.planned_exercise_id, setLines: itemSetLines || [], summary: itemSummary });
    }

    const restore = async () => {
      await supabase.from('planned_combo_set_lines').delete().eq('planned_combo_id', combo.id);
      if (existingSetLines && existingSetLines.length > 0) {
        await supabase.from('planned_combo_set_lines').insert(existingSetLines.map(({ id: _id, ...rest }: any) => rest));
      }
      for (const snap of perItemSnapshots) {
        await supabase.from('planned_set_lines').delete().eq('planned_exercise_id', snap.plannedExerciseId);
        if (snap.setLines.length > 0) {
          await supabase.from('planned_set_lines').insert(snap.setLines.map(({ id: _id, ...rest }: any) => rest));
        }
        if (snap.summary) {
          await supabase.from('planned_exercises').update(snap.summary).eq('id', snap.plannedExerciseId);
        }
      }
    };

    try {
      const { error: delSetLinesError } = await supabase
        .from('planned_combo_set_lines')
        .delete()
        .eq('planned_combo_id', combo.id);
      if (delSetLinesError) throw delSetLinesError;

      for (let lineIdx = 0; lineIdx < parsed.length; lineIdx++) {
        const line = parsed[lineIdx];
        const { error: setLineError } = await supabase
          .from('planned_combo_set_lines')
          .insert({
            planned_combo_id: combo.id,
            position: lineIdx + 1,
            load_value: line.loadValue,
            sets: line.sets,
            reps_tuple_text: line.repsTuple,
          });
        if (setLineError) throw setLineError;
      }

      for (let i = 0; i < combo.items.length; i++) {
        const item = combo.items[i];
        const plannedExerciseId = item.planned_exercise_id;

        const { error: delLinesError } = await supabase
          .from('planned_set_lines')
          .delete()
          .eq('planned_exercise_id', plannedExerciseId);
        if (delLinesError) throw delLinesError;

        let totalSets = 0;
        let totalReps = 0;
        let totalLoadTimesReps = 0;
        let highestLoad = 0;

        for (let lineIdx = 0; lineIdx < parsed.length; lineIdx++) {
          const line = parsed[lineIdx];
          const repsParts = line.repsTuple.split('+').map(p => parseInt(p.trim()));
          const repsForPart = repsParts[i];

          const { error: lineError } = await supabase
            .from('planned_set_lines')
            .insert({
              planned_exercise_id: plannedExerciseId,
              sets: line.sets,
              reps: repsForPart,
              load_value: line.loadValue,
              position: lineIdx + 1,
            });
          if (lineError) throw lineError;

          totalSets += line.sets;
          totalReps += line.sets * repsForPart;
          totalLoadTimesReps += line.loadValue * (line.sets * repsForPart);
          highestLoad = Math.max(highestLoad, line.loadValue);
        }

        const avgLoad = totalReps > 0 ? totalLoadTimesReps / totalReps : 0;

        const { error: summaryError } = await supabase
          .from('planned_exercises')
          .update({
            summary_total_sets: totalSets,
            summary_total_reps: totalReps,
            summary_avg_load: avgLoad,
            summary_highest_load: highestLoad,
            updated_at: new Date().toISOString(),
          })
          .eq('id', plannedExerciseId);
        if (summaryError) throw summaryError;
      }

      const { error: comboError } = await supabase
        .from('planned_combos')
        .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', combo.id);
      if (comboError) throw comboError;
    } catch (innerErr) {
      await restore();
      throw innerErr;
    }
  };

  return {
    templates,
    loading,
    error,
    setError,
    fetchTemplates,
    deleteCombo,
    checkDestinationWeekHasData,
    copyWeekPlan,
    loadDayCombos,
    fetchProgrammeData,
    createCombo,
    deleteComboWithExercises,
    copyComboToDay,
    saveComboSetLines,
  };
}
