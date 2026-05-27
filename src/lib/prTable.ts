/**
 * prTable — shared helpers for the PR grid that both the coach panel
 * (PRTrackingPanel) and the athlete app (PRsScreen / PRDetailScreen)
 * consume. Keeping the row-derivation logic and the athlete_prs
 * upsert here means the two surfaces never disagree about what the
 * "current" PR for a (rep_count) is.
 *
 * Two pieces:
 *  - buildPRRows: pure derivation of (current cell, phantom cell, e1RM)
 *    from raw athlete_pr_history rows. Identical to the old inline
 *    implementation in PRTrackingPanel.
 *  - syncAthletePRs: service-layer side-effect that re-derives the
 *    `athlete_prs` cache row (used by percentages, analysis charts,
 *    the dashboard) from the history after any insert / update / delete.
 */
import { supabase } from './supabase';
import { estimate1RM, estimateWeightAtReps, roundToHalf } from './xrmUtils';
import type { AthletePRHistory, Exercise } from './database.types';

export const REP_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type RepCount = (typeof REP_COUNTS)[number];

export interface PRCell {
  repCount: RepCount;
  /** Most-recent history entry for this rep count, or null if never set. */
  current: AthletePRHistory | null;
  /** Estimated weight at this rep count, derived from the best implied 1RM
   *  across the exercise's filled cells. Null when no PRs exist on the
   *  exercise. */
  phantom: number | null;
}

export interface ExerciseRow {
  exercise: Exercise;
  cells: PRCell[];
  /** Best implied 1RM across all filled rep counts, rounded to the nearest
   *  half-kg. Null when the exercise has no PRs yet. */
  implied1RM: number | null;
}

/**
 * Derive per-exercise PR rows from a flat list of history entries.
 * History must be sorted desc by (achieved_date, created_at) so the first
 * match per (exercise, rep_count) is the most recent. Returns one row per
 * input exercise in the same order.
 */
export function buildPRRows(
  exercises: Exercise[],
  history: AthletePRHistory[],
): ExerciseRow[] {
  return exercises.map(ex => {
    const currentByRep = new Map<RepCount, AthletePRHistory>();
    for (const entry of history) {
      if (entry.exercise_id !== ex.id) continue;
      if (entry.rep_count < 1 || entry.rep_count > 10) continue;
      const rc = entry.rep_count as RepCount;
      if (!currentByRep.has(rc)) currentByRep.set(rc, entry);
    }

    let best1RM: number | null = null;
    for (const [rep, entry] of currentByRep) {
      const implied = rep === 1 ? entry.value_kg : estimate1RM(entry.value_kg, rep);
      if (best1RM === null || implied > best1RM) best1RM = implied;
    }

    const cells: PRCell[] = REP_COUNTS.map(rc => {
      const current = currentByRep.get(rc) ?? null;
      const phantom =
        best1RM !== null && !current
          ? roundToHalf(estimateWeightAtReps(best1RM, rc))
          : null;
      return { repCount: rc, current, phantom };
    });

    return {
      exercise: ex,
      cells,
      implied1RM: best1RM !== null ? roundToHalf(best1RM) : null,
    };
  });
}

/**
 * Re-derive the athlete's `athlete_prs` cache row for one exercise from
 * its history, then upsert. Call after any history insert / update /
 * delete so percentage calculations and analysis stay in sync.
 *
 * Returns silently on failure — the cache is rebuildable on next call and
 * we don't want a sync glitch to break the originating edit.
 */
export async function syncAthletePRs(
  athleteId: string,
  exerciseId: string,
): Promise<void> {
  const { data: hist } = await supabase
    .from('athlete_pr_history')
    .select('rep_count, value_kg, achieved_date, created_at')
    .eq('athlete_id', athleteId)
    .eq('exercise_id', exerciseId)
    .order('achieved_date', { ascending: false })
    .order('created_at', { ascending: false });

  const rows =
    (hist as Pick<AthletePRHistory, 'rep_count' | 'value_kg' | 'achieved_date'>[] | null) ?? [];

  if (rows.length === 0) {
    await supabase
      .from('athlete_prs')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('exercise_id', exerciseId);
    return;
  }

  const recentByRep = new Map<number, { value_kg: number; achieved_date: string }>();
  for (const r of rows) {
    if (!recentByRep.has(r.rep_count)) {
      recentByRep.set(r.rep_count, { value_kg: r.value_kg, achieved_date: r.achieved_date });
    }
  }

  let best1RM = 0;
  let bestDate = '';
  for (const [rep, entry] of recentByRep) {
    const implied = rep === 1 ? entry.value_kg : estimate1RM(entry.value_kg, rep);
    if (implied > best1RM) {
      best1RM = implied;
      bestDate = entry.achieved_date;
    }
  }
  if (best1RM <= 0) return;

  const { error } = await supabase
    .from('athlete_prs')
    .upsert(
      {
        athlete_id: athleteId,
        exercise_id: exerciseId,
        pr_value_kg: roundToHalf(best1RM),
        pr_date: bestDate,
      },
      { onConflict: 'athlete_id,exercise_id' },
    );
  if (error) console.error('athlete_prs sync failed:', error);
}

/** Service helper: insert one PR history entry. Returns the new row. */
export async function insertPRHistory(args: {
  athleteId: string;
  exerciseId: string;
  repCount: number;
  valueKg: number;
  achievedDate: string;
  notes?: string | null;
}): Promise<AthletePRHistory> {
  const { data, error } = await supabase
    .from('athlete_pr_history')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
    .insert({
      athlete_id: args.athleteId,
      exercise_id: args.exerciseId,
      rep_count: args.repCount,
      value_kg: args.valueKg,
      achieved_date: args.achievedDate,
      notes: args.notes ?? null,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as AthletePRHistory;
}

/** Service helper: update an existing PR history entry by id. */
export async function updatePRHistory(
  id: string,
  patch: { valueKg?: number; achievedDate?: string; notes?: string | null },
): Promise<AthletePRHistory> {
  const supabasePatch: Record<string, unknown> = {};
  if (patch.valueKg != null) supabasePatch.value_kg = patch.valueKg;
  if (patch.achievedDate != null) supabasePatch.achieved_date = patch.achievedDate;
  if (patch.notes !== undefined) supabasePatch.notes = patch.notes;
  const { data, error } = await supabase
    .from('athlete_pr_history')
    .update(supabasePatch as never)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as AthletePRHistory;
}

/** Service helper: delete a PR history entry by id. */
export async function deletePRHistory(id: string): Promise<void> {
  const { error } = await supabase
    .from('athlete_pr_history')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * Fetch every history entry for an athlete, sorted newest-first. The
 * coach panel and athlete PR screens both feed this directly into
 * buildPRRows.
 */
export async function fetchPRHistory(athleteId: string): Promise<AthletePRHistory[]> {
  const { data, error } = await supabase
    .from('athlete_pr_history')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('achieved_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AthletePRHistory[];
}
