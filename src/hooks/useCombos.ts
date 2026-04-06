import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
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
      .eq('owner_id', getOwnerId())
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

    type ChainableQuery = { eq(c: string, v: string): ChainableQuery; is(c: string, v: null): ChainableQuery };
    const buildOwnerFilter = (query: ChainableQuery, athleteId: string | null, groupId: string | null): ChainableQuery => {
      if (athleteId) return query.eq('athlete_id', athleteId).is('group_id', null);
      if (groupId) return query.eq('group_id', groupId).is('athlete_id', null);
      return query.is('athlete_id', null).is('group_id', null);
    };

    // 1. Fetch source week plan
    const sourceQuery = buildOwnerFilter(
      supabase.from('week_plans').select('*').eq('owner_id', getOwnerId()).eq('week_start', sourceWeekStart),
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
        owner_id: getOwnerId(),
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
        const newLines = sourceSetLines.map((line: { id: string; created_at: string; updated_at: string; planned_exercise_id: string } & Record<string, unknown>) => {
          const { id: _id, created_at: _c, updated_at: _u, planned_exercise_id: oldExId, ...lineData } = line;
          return { ...lineData, planned_exercise_id: exerciseIdMap.get(oldExId as string)! };
        });
        await supabase.from('planned_set_lines').insert(newLines);
      }

      // 6. Copy combo members
      const { data: sourceMembers } = await supabase
        .from('planned_exercise_combo_members')
        .select('*')
        .in('planned_exercise_id', Array.from(exerciseIdMap.keys()));

      if (sourceMembers && sourceMembers.length > 0) {
        const newMembers = sourceMembers.map((m: { id: string; created_at: string; planned_exercise_id: string } & Record<string, unknown>) => {
          const { id: _id, created_at: _c, planned_exercise_id: oldExId, ...mData } = m;
          return { ...mData, planned_exercise_id: exerciseIdMap.get(oldExId as string)! };
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
      .in('planned_exercise_id', comboExs.map((e: { id: string }) => e.id))
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

    return { comboMembers: membersMap };
  };

  return {
    checkDestinationWeekHasData,
    copyWeekPlan,
    fetchProgrammeData,
  };
}
