import { supabase } from '../lib/supabase';
import type { Exercise, ComboMemberEntry } from '../lib/database.types';

export function useCombos() {
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
    const sourceQuery = buildOwnerFilter(
      supabase.from('week_plans').select('*').eq('week_start', sourceWeekStart),
      sourceAthleteId, sourceGroupId,
    );
    const { data: sourceWeekPlan, error: sourceError } = await sourceQuery.maybeSingle();
    if (sourceError) throw sourceError;
    if (!sourceWeekPlan) throw new Error('Source week has no data to paste');

    // 2. Delete destination if exists
    if (destinationHasData) {
      const deleteQuery = buildOwnerFilter(
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

    // 4. Copy planned exercises (including is_combo ones)
    const { data: sourceExercises, error: exercisesError } = await supabase
      .from('planned_exercises')
      .select('*')
      .eq('weekplan_id', sourceWeekPlan.id);
    if (exercisesError) throw exercisesError;

    const exerciseIdMap = new Map<string, string>();
    if (sourceExercises && sourceExercises.length > 0) {
      for (const ex of sourceExercises) {
        const { id: oldExId, created_at: _c, updated_at: _u, weekplan_id: _wpId, ...exData } = ex;
        const { data: newExercise, error: insertExError } = await supabase
          .from('planned_exercises')
          .insert([{ ...exData, weekplan_id: createdWeekPlan.id }])
          .select()
          .single();
        if (insertExError) throw insertExError;
        if (newExercise) exerciseIdMap.set(oldExId, newExercise.id);
      }
    }

    // 5. Copy planned_set_lines for all exercises
    if (exerciseIdMap.size > 0) {
      const { data: sourceSetLines } = await supabase
        .from('planned_set_lines')
        .select('*')
        .in('planned_exercise_id', Array.from(exerciseIdMap.keys()));

      if (sourceSetLines && sourceSetLines.length > 0) {
        const newLines = sourceSetLines.map((line: any) => {
          const { id: _id, created_at: _c, updated_at: _u, planned_exercise_id: oldExId, ...lineData } = line;
          return { ...lineData, planned_exercise_id: exerciseIdMap.get(oldExId)! };
        });
        await supabase.from('planned_set_lines').insert(newLines);
      }

      // 6. Copy combo members
      const { data: sourceMembers } = await supabase
        .from('planned_exercise_combo_members')
        .select('*')
        .in('planned_exercise_id', Array.from(exerciseIdMap.keys()));

      if (sourceMembers && sourceMembers.length > 0) {
        const newMembers = sourceMembers.map((m: any) => {
          const { id: _id, created_at: _c, planned_exercise_id: oldExId, ...mData } = m;
          return { ...mData, planned_exercise_id: exerciseIdMap.get(oldExId)! };
        });
        await supabase.from('planned_exercise_combo_members').insert(newMembers);
      }
    }
  };

  // Returns comboMembers map for a week plan (used by PrintWeek, AthleteProgramme)
  const fetchProgrammeData = async (
    weekPlanId: string,
  ): Promise<{ comboMembers: Record<string, ComboMemberEntry[]> }> => {
    const { data: comboExs } = await supabase
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', weekPlanId)
      .eq('is_combo', true);

    if (!comboExs?.length) return { comboMembers: {} };

    const { data: members } = await supabase
      .from('planned_exercise_combo_members')
      .select('*, exercise:exercise_id(*)')
      .in('planned_exercise_id', comboExs.map((e: any) => e.id))
      .order('position');

    const membersMap: Record<string, ComboMemberEntry[]> = {};
    (members || []).forEach((m: any) => {
      if (!membersMap[m.planned_exercise_id]) membersMap[m.planned_exercise_id] = [];
      membersMap[m.planned_exercise_id].push({
        exerciseId: m.exercise_id,
        exercise: m.exercise as Exercise,
        position: m.position,
      });
    });

    return { comboMembers: membersMap };
  };

  return {
    checkDestinationWeekHasData,
    copyWeekPlan,
    fetchProgrammeData,
  };
}
