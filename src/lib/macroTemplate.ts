/**
 * macroTemplate — build and materialize macro-cycle templates.
 *
 * Two modes:
 *  - 'kg'  (exact copy): loads stored in kilograms, re-applied unchanged.
 *  - 'pct' (general model): every load stored as % of its exercise's
 *    reference — the template carries no kg at all, it is pure shape. On
 *    apply, the coach supplies a reference per exercise (defaulting to the
 *    stored one) and the numbers re-materialize, rounded to 2,5 kg. This is
 *    what lets a model be laid on another athlete, or reused later when the
 *    athlete has reached a higher level.
 *
 * Reps, Σreps, reps@max/sets@max and notes are level-independent and stay
 * absolute in both modes. Pure module — no Supabase, no React.
 */
import type {
  MacroPhase,
  MacroTarget,
  MacroTrackedExerciseWithExercise,
  MacroWeek,
} from './database.types';
import { roundToStep, DEFAULT_LOAD_ROUNDING_KG } from './macroFillGuide';

export type MacroTemplateMode = 'kg' | 'pct';

export interface MacroTemplateWeek {
  week_number: number;
  week_type: string;
  week_type_text: string;
  total_reps_target: number | null;
}

export interface MacroTemplatePhase {
  name: string;
  phase_type: string;
  start_week_number: number;
  end_week_number: number;
  color: string;
  notes: string;
  position: number;
}

export interface MacroTemplateTargetCell {
  week_number: number;
  /** kg in 'kg' mode, % of reference (1 decimal) in 'pct' mode. */
  max: number | null;
  avg: number | null;
  reps: number | null;
  reps_at_max: number | null;
  sets_at_max: number | null;
  note: string | null;
}

export interface MacroTemplateExercise {
  exercise_id: string;
  /** Display fallback if the exercise is renamed/archived later. */
  exercise_name: string;
  position: number;
  /** The reference the template was built against (pct mode) — the default
   *  suggestion when applying; null when the source had no loads. */
  reference_kg: number | null;
  targets: MacroTemplateTargetCell[];
}

export interface MacroTemplatePayload {
  weeks: MacroTemplateWeek[];
  phases: MacroTemplatePhase[];
  exercises: MacroTemplateExercise[];
}

export interface MacroTemplateRow {
  id: string;
  owner_id: string;
  name: string;
  mode: MacroTemplateMode;
  week_count: number;
  payload: MacroTemplatePayload;
  created_at: string;
  updated_at: string;
}

/** Materialized template, ready to write into a freshly created cycle. */
export interface MaterializedTemplate {
  weeks: MacroTemplateWeek[];
  phases: MacroTemplatePhase[];
  exercises: Array<{ exercise_id: string; position: number; reference_kg: number | null }>;
  targets: Array<{
    week_number: number;
    exercise_id: string;
    fields: Partial<Pick<MacroTarget,
      'target_max' | 'target_avg' | 'target_reps' | 'target_reps_at_max' | 'target_sets_at_max' | 'note'>>;
  }>;
}

const pct1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Serialize the current cycle into a template payload.
 *
 * pct mode reference resolution, per exercise: the saved reference_kg when
 * set, otherwise the exercise's peak target_max in the cycle (so the heaviest
 * week reads 100 %). Exercises with neither keep null loads.
 */
export function buildTemplatePayload(
  mode: MacroTemplateMode,
  macroWeeks: MacroWeek[],
  phases: MacroPhase[],
  trackedExercises: MacroTrackedExerciseWithExercise[],
  targets: MacroTarget[],
): MacroTemplatePayload {
  const weekById = new Map(macroWeeks.map(w => [w.id, w]));

  const weeks: MacroTemplateWeek[] = [...macroWeeks]
    .sort((a, b) => a.week_number - b.week_number)
    .map(w => ({
      week_number: w.week_number,
      week_type: w.week_type,
      week_type_text: w.week_type_text ?? '',
      total_reps_target: w.total_reps_target,
    }));

  const tplPhases: MacroTemplatePhase[] = [...phases]
    .sort((a, b) => a.position - b.position)
    .map(p => ({
      name: p.name,
      phase_type: p.phase_type,
      start_week_number: p.start_week_number,
      end_week_number: p.end_week_number,
      color: p.color,
      notes: p.notes ?? '',
      position: p.position,
    }));

  const exercises: MacroTemplateExercise[] = [...trackedExercises]
    .sort((a, b) => a.position - b.position)
    .map(te => {
      const exTargets = targets
        .filter(t => t.tracked_exercise_id === te.id && weekById.has(t.macro_week_id))
        .sort((a, b) => weekById.get(a.macro_week_id)!.week_number - weekById.get(b.macro_week_id)!.week_number);

      const peakMax = exTargets.reduce<number | null>(
        (best, t) => (t.target_max != null && t.target_max > (best ?? 0) ? t.target_max : best),
        null,
      );
      const reference = te.reference_kg ?? peakMax;
      const toStored = (kg: number | null): number | null => {
        if (kg == null) return null;
        if (mode === 'kg') return kg;
        return reference && reference > 0 ? pct1((kg / reference) * 100) : null;
      };

      return {
        exercise_id: te.exercise_id,
        exercise_name: te.exercise.exercise_code || te.exercise.name,
        position: te.position,
        reference_kg: reference,
        targets: exTargets
          .filter(t =>
            t.target_max != null || t.target_avg != null || t.target_reps != null ||
            t.target_reps_at_max != null || t.target_sets_at_max != null || t.note != null)
          .map(t => ({
            week_number: weekById.get(t.macro_week_id)!.week_number,
            max: toStored(t.target_max),
            avg: toStored(t.target_avg),
            reps: t.target_reps,
            reps_at_max: t.target_reps_at_max,
            sets_at_max: t.target_sets_at_max,
            note: t.note,
          })),
      };
    });

  return { weeks, phases: tplPhases, exercises };
}

/**
 * Resolve a template against per-exercise references (pct mode) into concrete
 * rows for a new cycle. In kg mode the references are ignored. In pct mode an
 * exercise whose reference is missing/≤0 keeps its reps and notes but drops
 * loads — never guess kilograms.
 */
export function materializeTemplate(
  template: Pick<MacroTemplateRow, 'mode' | 'payload'>,
  references: Record<string, number | null | undefined> = {},
  loadRoundingKg: number = DEFAULT_LOAD_ROUNDING_KG,
): MaterializedTemplate {
  const { mode, payload } = template;

  const targets: MaterializedTemplate['targets'] = [];
  const exercises = payload.exercises.map(ex => {
    const reference = mode === 'pct'
      ? (references[ex.exercise_id] !== undefined ? references[ex.exercise_id] : ex.reference_kg) ?? null
      : ex.reference_kg;
    const toKg = (stored: number | null): number | null => {
      if (stored == null) return null;
      if (mode === 'kg') return stored;
      return reference && reference > 0
        ? Math.max(0, roundToStep((reference * stored) / 100, loadRoundingKg))
        : null;
    };
    for (const cell of ex.targets) {
      const fields: MaterializedTemplate['targets'][number]['fields'] = {};
      const max = toKg(cell.max);
      const avg = toKg(cell.avg);
      if (max != null) fields.target_max = max;
      if (avg != null) fields.target_avg = avg;
      if (cell.reps != null) fields.target_reps = cell.reps;
      if (cell.reps_at_max != null) fields.target_reps_at_max = cell.reps_at_max;
      if (cell.sets_at_max != null) fields.target_sets_at_max = cell.sets_at_max;
      if (cell.note) fields.note = cell.note;
      if (Object.keys(fields).length > 0) {
        targets.push({ week_number: cell.week_number, exercise_id: ex.exercise_id, fields });
      }
    }
    return { exercise_id: ex.exercise_id, position: ex.position, reference_kg: reference };
  });

  return {
    weeks: payload.weeks,
    phases: payload.phases,
    exercises,
    targets,
  };
}
