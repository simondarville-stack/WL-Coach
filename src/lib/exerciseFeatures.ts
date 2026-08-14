/**
 * Exercise features — optional per-exercise enrichments of a prescription.
 *
 * A feature is active when its key is present on
 * planned_exercises.metadata.features (ExerciseFeatures in database.types).
 * The registry here drives the planner's "+" feature menu; adding an entry
 * (and a renderer where it surfaces) is all a future feature needs.
 *
 * Two kinds today:
 *   - Athlete-visible prescription content: totalTime (⏱, seconds).
 *   - Coach-only summary overrides: totalReps (Σ), avgLoad (Ø) — they
 *     overwrite the computed summary_total_reps / summary_avg_load so a
 *     soft prescription (signs, ranges) still feeds honest weekly totals.
 *
 * The load sign (≥ ≈ ≤) is also presented as a feature in the planner menu,
 * but it lives inside the prescription string itself (see LoadCmp in
 * prescriptionParser.ts), not in this metadata bag.
 */
import type { ExerciseFeatures } from './database.types';
import type { PrescriptionSummary } from './prescriptionParser';

export type { ExerciseFeatures };

export interface FeatureDefinition {
  key: keyof ExerciseFeatures;
  icon: string;         // registry glyph shown in the menu / chips
  label: string;        // menu label
  coachOnly: boolean;   // true = never rendered athlete-side
}

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key: 'totalTime', icon: '⏱', label: 'Total time', coachOnly: false },
  { key: 'totalReps', icon: 'Σ', label: 'Total reps — overwrites summation', coachOnly: true },
  { key: 'avgLoad', icon: 'Ø', label: 'Avg load — overwrites', coachOnly: true },
];

/**
 * Apply the coach's summary overrides on top of a computed prescription
 * summary. Single source of truth for both the save path (which persists
 * the overridden numbers into summary_*) and any live recompute.
 */
export function applyFeatureOverrides(
  summary: PrescriptionSummary,
  features: ExerciseFeatures | undefined | null,
): PrescriptionSummary {
  if (!features) return summary;
  return {
    ...summary,
    total_reps: features.totalReps ?? summary.total_reps,
    avg_load: features.avgLoad ?? summary.avg_load,
  };
}

/** 720 → "12′", 90 → "90″", 630 → "10,5′". European comma decimals. */
export function formatSeconds(sec: number): string {
  const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
  if (sec < 60 || sec % 60 !== 0) {
    if (sec >= 60) return `${fmt(sec / 60)}′`;
    return `${fmt(sec)}″`;
  }
  return `${fmt(sec / 60)}′`;
}

/**
 * Parse a coach-typed duration. Plain numbers are minutes ("12" → 720 s);
 * a trailing s/″ means seconds ("90s" → 90). Comma decimals accepted.
 */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(',', '.').replace('′', '').replace('″', 's');
  if (!s) return null;
  if (s.endsWith('s')) {
    const n = parseFloat(s.slice(0, -1));
    return isNaN(n) || n <= 0 ? null : Math.round(n);
  }
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : Math.round(n * 60);
}
