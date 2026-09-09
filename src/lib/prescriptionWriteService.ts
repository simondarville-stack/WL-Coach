// The ONE definition of what a prescription write touches.
//
// `planned_exercises.prescription_raw` is the source of truth for a planned
// line, but four other things are derived from it and stored alongside: the
// summary columns (sets / reps / highest / average load), the per-line cache
// in `planned_set_lines`, the feature overrides re-applied on top of the
// summary, and the group→individual promotion. Ten planner surfaces (day
// editor, print designer, log summary, clipboard, analysis …) read those
// caches rather than re-parsing the raw string, so a writer that updates only
// `prescription_raw` leaves the app showing stale numbers.
//
// The planner hook (`useWeekPlans.writePrescription`) and the assistant verbs
// (`loadScaleService`, the `npm run emos` CLI) therefore both call THIS
// function. It takes the Supabase client as an argument so it runs unchanged
// in the browser and in a Node script; it imports nothing React- or
// store-bound (CLAUDE.md principle 2 — domain logic in a module, and
// principle 3 — one source of truth per concept).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DefaultUnit, PlannedExerciseMetadata } from './database.types';
import {
  parsePrescription,
  parseComboPrescription,
  computePrescriptionSummary,
  type LoadCmp,
} from './prescriptionParser';
import { applyFeatureOverrides } from './exerciseFeatures';

export type EmosClient = SupabaseClient<Database>;

export interface PrescriptionWrite {
  prescription: string;
  unit: DefaultUnit;
  isCombo?: boolean;
}

/** One `planned_set_lines` row as written by the cache rebuild. */
export type SetLineInsert = {
  planned_exercise_id: string;
  sets: number;
  sets_max: number | null;
  reps: number;
  reps_max: number | null;
  reps_text: string | null;
  load_value: number;
  load_max: number | null;
  load_cmp: LoadCmp | null;
  position: number;
};

/**
 * Pure: the set-line rows a prescription derives to. Non-numeric units
 * (`free_text`, `other`, `free_text_reps`) derive to no rows at all — their
 * text is display-only and the counting layer reads the raw string.
 */
export function buildSetLineRows(
  plannedExId: string,
  prescription: string,
  unit: DefaultUnit,
  isCombo: boolean,
): SetLineInsert[] {
  if (isCombo) {
    return parseComboPrescription(prescription).map((line, idx) => {
      // Round multiplier scales the per-set reps (m rounds of the tuple) but
      // not the set count (Option A). reps_text carries the grouped display
      // ("2(1+2)") so the athlete sees the rounds; it is display-only —
      // per-member attribution reads prescription_raw, not this cache.
      // Set ranges store the lower bound in `sets` (the guaranteed minimum
      // the athlete expands) and the upper bound in `sets_max`.
      const m = line.multiplier ?? 1;
      return {
        planned_exercise_id: plannedExId,
        sets: line.sets,
        sets_max: line.setsMax ?? null,
        reps: line.totalReps * m,
        reps_max: null,
        reps_text: line.multiplier != null ? `${m}(${line.repsText})` : line.repsText,
        load_value: line.load,
        load_max: line.loadMax ?? null,
        load_cmp: line.loadCmp ?? null,
        position: idx + 1,
      };
    });
  }

  const isNonNumeric = unit === 'free_text' || unit === 'other';
  if (isNonNumeric || unit === 'free_text_reps') return [];
  return parsePrescription(prescription).map((line, idx) => ({
    planned_exercise_id: plannedExId,
    sets: line.sets,
    sets_max: line.setsMax ?? null,
    reps: line.reps,
    reps_max: line.repsMax ?? null,
    reps_text: null,
    load_value: line.load,
    load_max: line.loadMax ?? null,
    load_cmp: line.loadCmp ?? null,
    position: idx + 1,
  }));
}

/**
 * Replace a planned exercise's set lines. Upserts on (planned_exercise_id,
 * position) so concurrent editors converge instead of colliding, then trims
 * any rows left over when the new prescription has fewer lines than the old.
 *
 * Every line carries the full column set (reps_text / load_max defaulted to
 * null) so an upsert UPDATE always overwrites a row's previous shape — e.g. a
 * line that used to be a combo member won't keep a stale reps_text.
 */
export async function replaceSetLines(
  client: EmosClient,
  plannedExId: string,
  lines: SetLineInsert[],
): Promise<void> {
  if (lines.length > 0) {
    const { error: upsertError } = await client
      .from('planned_set_lines')
      .upsert(lines, { onConflict: 'planned_exercise_id,position' });
    if (upsertError) throw upsertError;
  }
  const { error: trimError } = await client
    .from('planned_set_lines')
    .delete()
    .eq('planned_exercise_id', plannedExId)
    .gt('position', lines.length);
  if (trimError) throw trimError;
}

/**
 * Persist a prescription: raw string, unit, summary cache, set-line cache,
 * and the group→individual promotion. Feature overrides (Σ total reps / Ø avg
 * load) are re-read and re-applied on every write so a prescription edit
 * can't clobber a standing override.
 */
export async function writePrescriptionRecord(
  client: EmosClient,
  plannedExId: string,
  data: PrescriptionWrite,
): Promise<void> {
  const { prescription, unit } = data;
  const isCombo = !!data.isCombo;

  const { data: metaRow } = await client
    .from('planned_exercises')
    .select('metadata')
    .eq('id', plannedExId)
    .single();
  const features = ((metaRow as { metadata?: PlannedExerciseMetadata } | null)?.metadata ?? {}).features;
  const summary = applyFeatureOverrides(
    computePrescriptionSummary(prescription, unit, isCombo),
    features,
  );

  await replaceSetLines(client, plannedExId, buildSetLineRows(plannedExId, prescription, unit, isCombo));

  const { error: updateError } = await client
    .from('planned_exercises')
    .update({
      prescription_raw: prescription,
      unit,
      summary_total_sets: summary.total_sets,
      summary_total_reps: summary.total_reps,
      summary_highest_load: summary.highest_load,
      summary_avg_load: summary.avg_load,
    })
    .eq('id', plannedExId);
  if (updateError) throw updateError;

  // Promote a group-sourced exercise to individual once the coach edits it.
  const { error: promoteError } = await client
    .from('planned_exercises')
    .update({ source: 'individual' })
    .eq('id', plannedExId)
    .eq('source', 'group');
  if (promoteError) throw promoteError;
}
