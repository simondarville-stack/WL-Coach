/**
 * comboHistory — resolving "which planned rows are THIS combo?" and
 * "which planned rows trained THIS exercise?".
 *
 * A combo's `planned_exercises.exercise_id` is only its FIRST member, so it
 * cannot identify the combo. "Vend", "Vend + Ben foran + Opadstød" and
 * "Vend + vend fra dyb hæng" all carry exercise_id = Vend, which means any
 * history query filtering on exercise_id alone returns all three mixed
 * together. Identity has to go through planned_exercise_combo_members.
 *
 * The two directions are deliberately different:
 *
 *   - a COMPLEX matches only rows with the same members in the same order;
 *   - an EXERCISE matches its standalone rows AND the complexes it appears in,
 *     because a combo is only a wrapper (see comboExpansion.expandForCounting)
 *     — work done inside a complex is still work on that lift, which is why a
 *     macro target can be hit by one.
 *
 * Kept out of the components because several history surfaces need the same
 * answers and must not disagree about them.
 */
import { supabase } from './supabase';

/**
 * Identity of a combo: its members IN ORDER.
 *
 * Deliberately NOT sorted — a complex is a sequence, so "Vend + Ben foran" and
 * "Ben foran + Vend" are different exercises and must not collapse onto each
 * other. Repeats are significant too ("Frivend + Frivend + PushPress").
 */
export function comboIdentity(memberExerciseIds: string[]): string {
  return memberExerciseIds.join('>');
}

export interface ComboPlannedRow {
  id: string;
  weekplan_id: string;
  /** Slot number within the week — the history chart places sessions by it. */
  day_index: number;
  prescription_raw: string | null;
  unit: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  is_combo: boolean;
  /** The complex's own label, when this row is one. Null for a plain row. */
  combo_notation: string | null;
}

// NB: the column list is repeated as a literal in each select rather than
// hoisted to a const — supabase-js infers the row type from the literal, and a
// const collapses it to GenericStringError.
/** Combo rows in these week plans, with their ordered member exercise ids. */
async function fetchCombosWithMembers(
  weekplanIds: string[],
): Promise<{ row: ComboPlannedRow; memberIds: string[] }[]> {
  const { data: candidates } = await supabase
    .from('planned_exercises')
    .select('id, weekplan_id, day_index, prescription_raw, unit, is_combo, combo_notation, summary_total_sets, summary_total_reps, summary_highest_load, summary_avg_load')
    .eq('is_combo', true)
    .in('weekplan_id', weekplanIds);
  if (!candidates?.length) return [];

  const { data: members } = await supabase
    .from('planned_exercise_combo_members')
    .select('planned_exercise_id, exercise_id, position')
    .in('planned_exercise_id', candidates.map(c => c.id))
    .order('position', { ascending: true });

  const membersByRow = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = membersByRow.get(m.planned_exercise_id) ?? [];
    list.push(m.exercise_id);
    membersByRow.set(m.planned_exercise_id, list);
  }
  return (candidates as ComboPlannedRow[]).map(row => ({
    row,
    memberIds: membersByRow.get(row.id) ?? [],
  }));
}

/**
 * Every planned row inside `weekplanIds` that is exactly this combo — the same
 * member exercises in the same order.
 *
 * Two round trips rather than one: PostgREST cannot express "the ordered child
 * list equals this", so candidates come back by `is_combo` and the member lists
 * decide. Candidates are scoped to the caller's week plans, which is already
 * one athlete's own history.
 */
export async function fetchComboPlannedRows(
  weekplanIds: string[],
  memberExerciseIds: string[],
): Promise<ComboPlannedRow[]> {
  if (weekplanIds.length === 0 || memberExerciseIds.length === 0) return [];
  const want = comboIdentity(memberExerciseIds);
  const combos = await fetchCombosWithMembers(weekplanIds);
  return combos.filter(c => comboIdentity(c.memberIds) === want).map(c => c.row);
}

/**
 * Every planned row inside `weekplanIds` in which `exerciseId` was trained:
 * its own rows, plus every complex that contains it.
 *
 * The complex rows keep their own prescription and notation rather than being
 * reduced to the member's share — a coach reading "what has he handled on
 * Vend" is better served by seeing that it was 100×1+2+1 inside a complex than
 * by a decontextualised 100×2.
 */
export async function fetchPlannedRowsForExercise(
  weekplanIds: string[],
  exerciseId: string,
): Promise<ComboPlannedRow[]> {
  if (weekplanIds.length === 0 || !exerciseId) return [];

  const [standalone, combos] = await Promise.all([
    supabase
      .from('planned_exercises')
      .select('id, weekplan_id, day_index, prescription_raw, unit, is_combo, combo_notation, summary_total_sets, summary_total_reps, summary_highest_load, summary_avg_load')
      .eq('exercise_id', exerciseId)
      .eq('is_combo', false)
      .in('weekplan_id', weekplanIds),
    fetchCombosWithMembers(weekplanIds),
  ]);

  return [
    ...((standalone.data ?? []) as ComboPlannedRow[]),
    ...combos.filter(c => c.memberIds.includes(exerciseId)).map(c => c.row),
  ];
}
