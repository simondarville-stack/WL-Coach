// Copy a logged/reviewed week's plan into the following week as a starting
// draft — the "plan next week from this one" action of the review panel.
// Individual plans only (the review panel is athlete-scoped).
//
// Copies planned_exercises with their set lines and combo members, mirroring
// the clipboard snapshot round-trip fields (metadata carries sentinels/GPP).
// It never overwrites: a target week that already has planned work is left
// untouched ('occupied').

import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import type { WeekPlan } from './database.types';

export type CopyWeekResult = 'copied' | 'occupied' | 'empty';

interface PlannedRow {
  id: string;
  day_index: number;
  exercise_id: string;
  position: number;
  notes: string | null;
  unit: string | null;
  prescription_raw: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  variation_note: string | null;
  is_combo: boolean;
  combo_notation: string | null;
  combo_color: string | null;
  metadata: Record<string, unknown> | null;
}

async function fetchIndividualPlan(athleteId: string, weekStart: string): Promise<WeekPlan | null> {
  const { data } = await supabase
    .from('week_plans')
    .select('*')
    .eq('week_start', weekStart)
    .eq('athlete_id', athleteId)
    .is('group_id', null)
    .maybeSingle();
  return (data as WeekPlan | null) ?? null;
}

export async function copyWeekAsDraft(
  athleteId: string,
  sourceWeekStart: string,
  targetWeekStart: string
): Promise<CopyWeekResult> {
  const sourcePlan = await fetchIndividualPlan(athleteId, sourceWeekStart);
  if (!sourcePlan) return 'empty';

  const { data: sourceExRaw, error: exErr } = await supabase
    .from('planned_exercises')
    .select('id, day_index, exercise_id, position, notes, unit, prescription_raw, summary_total_sets, summary_total_reps, summary_highest_load, summary_avg_load, variation_note, is_combo, combo_notation, combo_color, metadata')
    .eq('weekplan_id', sourcePlan.id)
    .order('day_index')
    .order('position');
  if (exErr) throw exErr;
  const sourceExercises = (sourceExRaw as unknown as PlannedRow[]) ?? [];
  if (sourceExercises.length === 0) return 'empty';

  // ── Target plan: create if missing; refuse when it already has content ──
  let targetPlan = await fetchIndividualPlan(athleteId, targetWeekStart);
  if (targetPlan) {
    const { count } = await supabase
      .from('planned_exercises')
      .select('id', { count: 'exact', head: true })
      .eq('weekplan_id', targetPlan.id);
    if ((count ?? 0) > 0) return 'occupied';
  } else {
    const { data: created, error: createErr } = await supabase
      .from('week_plans')
      .insert([{
        week_start: targetWeekStart,
        athlete_id: athleteId,
        group_id: null,
        is_group_plan: false,
        // Same host-coach ownership rule as fetchOrCreateWeekPlan.
        owner_id: sourcePlan.owner_id ?? getOwnerId(),
        last_edited_by_coach_id: getOwnerId(),
        // Carry the week's day structure; the brief stays week-specific.
        active_days: sourcePlan.active_days,
        day_labels: sourcePlan.day_labels,
        day_display_order: sourcePlan.day_display_order,
        day_schedule: sourcePlan.day_schedule,
      }])
      .select()
      .single();
    if (createErr) throw createErr;
    targetPlan = created as WeekPlan;
  }

  // Days that carry exercises must be active in the target so the copied
  // rows render instead of becoming orphaned day_index entries.
  const sourceDays = [...new Set(sourceExercises.map(e => e.day_index))];
  const targetActive = targetPlan.active_days ?? [];
  const missingDays = sourceDays.filter(d => !targetActive.includes(d));
  if (missingDays.length > 0) {
    const nextActive = [...targetActive, ...missingDays].sort((a, b) => a - b);
    const nextLabels: Record<number, string> = { ...(targetPlan.day_labels ?? {}) };
    for (const d of missingDays) {
      const srcLabel = sourcePlan.day_labels?.[d];
      if (srcLabel && !nextLabels[d]) nextLabels[d] = srcLabel;
    }
    await supabase
      .from('week_plans')
      .update({ active_days: nextActive, day_labels: nextLabels })
      .eq('id', targetPlan.id);
  }

  // ── Copy exercises (bulk), then remap children by day|position ──
  const { data: insertedRaw, error: insertErr } = await supabase
    .from('planned_exercises')
    .insert(sourceExercises.map(ex => ({
      weekplan_id: targetPlan!.id,
      day_index: ex.day_index,
      exercise_id: ex.exercise_id,
      position: ex.position,
      notes: ex.notes,
      unit: ex.unit,
      prescription_raw: ex.prescription_raw,
      summary_total_sets: ex.summary_total_sets,
      summary_total_reps: ex.summary_total_reps,
      summary_highest_load: ex.summary_highest_load,
      summary_avg_load: ex.summary_avg_load,
      variation_note: ex.variation_note,
      is_combo: ex.is_combo,
      combo_notation: ex.combo_notation,
      combo_color: ex.combo_color,
      metadata: ex.metadata ?? undefined,
      source: 'individual' as const,
    })))
    .select('id, day_index, position');
  if (insertErr) throw insertErr;

  const newIdByKey = new Map(
    ((insertedRaw as { id: string; day_index: number; position: number }[]) ?? [])
      .map(r => [`${r.day_index}|${r.position}`, r.id])
  );
  const newIdFor = (ex: PlannedRow): string | undefined =>
    newIdByKey.get(`${ex.day_index}|${ex.position}`);

  const sourceIds = sourceExercises.map(e => e.id);

  // Set lines.
  const { data: setLinesRaw } = await supabase
    .from('planned_set_lines')
    .select('planned_exercise_id, sets, reps, reps_text, load_value, load_max, position')
    .in('planned_exercise_id', sourceIds);
  type SetLineRow = {
    planned_exercise_id: string; sets: number; reps: number;
    reps_text: string | null; load_value: number; load_max: number | null; position: number;
  };
  const bySourceId = new Map(sourceExercises.map(e => [e.id, e]));
  const setLineInserts = ((setLinesRaw as SetLineRow[]) ?? [])
    .map(l => {
      const srcEx = bySourceId.get(l.planned_exercise_id);
      const newId = srcEx ? newIdFor(srcEx) : undefined;
      if (!newId) return null;
      return {
        planned_exercise_id: newId,
        sets: l.sets,
        reps: l.reps,
        reps_text: l.reps_text,
        load_value: l.load_value,
        load_max: l.load_max,
        position: l.position,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  if (setLineInserts.length > 0) {
    const { error } = await supabase.from('planned_set_lines').insert(setLineInserts);
    if (error) throw error;
  }

  // Combo members.
  const comboSourceIds = sourceExercises.filter(e => e.is_combo).map(e => e.id);
  if (comboSourceIds.length > 0) {
    const { data: membersRaw } = await supabase
      .from('planned_exercise_combo_members')
      .select('planned_exercise_id, exercise_id, position')
      .in('planned_exercise_id', comboSourceIds);
    type MemberRow = { planned_exercise_id: string; exercise_id: string; position: number };
    const memberInserts = ((membersRaw as MemberRow[]) ?? [])
      .map(m => {
        const srcEx = bySourceId.get(m.planned_exercise_id);
        const newId = srcEx ? newIdFor(srcEx) : undefined;
        if (!newId) return null;
        return { planned_exercise_id: newId, exercise_id: m.exercise_id, position: m.position };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (memberInserts.length > 0) {
      const { error } = await supabase.from('planned_exercise_combo_members').insert(memberInserts);
      if (error) throw error;
    }
  }

  return 'copied';
}
