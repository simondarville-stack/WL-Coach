/**
 * verdict — the plain-language line on "This lift", gated on the grade.
 *
 * Measurement honesty is part of the interface (docs/KINEMOS_VIEWER_LAYOUT.md):
 * every analysis carries an error margin, and a difference smaller than that
 * margin is not a difference. So the wording is DERIVED from the delta against
 * the margin — "faster than" only when the delta clears it, "level with"
 * otherwise — and never renders a directional claim for a delta inside the
 * margin. Pure, so the rule can be tested without a screen.
 */
import { fromStoredMetrics, metricById, type StoredMetrics } from '../engine/metricCatalogue';
import type { ComparisonCandidate } from './comparisonService';
import { num } from './viewerFormat';
import { formatDateShort } from '../../lib/dateUtils';

export interface EarlierLift {
  analysisId: string;
  date: string | null;
  loadKg: number | null;
  peakVelocityMs: number;
  /** The stored grade's error margin, if the row carried one. */
  errorMs: number | null;
  /** Everything the cache column held, for the per-metric deltas. */
  metrics: StoredMetrics;
}

export type VerdictKind = 'faster' | 'slower' | 'level' | 'none';

/** A load the way the library prints it: whole kilos bare, half kilos with
 *  one decimal — `112,5 kg`, never `113 kg`. */
function loadLabel(kg: number): string {
  return `${num(kg, kg % 1 === 0 ? 0 : 1)} kg`;
}

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  detail: string;
  /** Signed, m/s — null when there is nothing to compare with. */
  deltaMs: number | null;
}

/** The stored metrics of an earlier analysis with its peak velocity, or
 *  null when the cache column does not carry one a reader can trust. */
function storedLift(candidate: ComparisonCandidate): { metrics: StoredMetrics; peak: number } | null {
  const stored = fromStoredMetrics(candidate.analysis.metrics);
  if (!stored) return null;
  const v = stored.analyzer?.vmaxMs ?? stored.peakVelocityMs;
  return v !== null && Number.isFinite(v) ? { metrics: stored, peak: v } : null;
}

/**
 * The lift to judge this one against: the athlete's own most recent analysed
 * lift of the same exercise at the same load, before this one. With none at
 * this load, the most recent at any load — and the verdict says so. Model
 * lifts are exemplars, not history, and are never "the last make".
 */
export function findEarlierLift(
  candidates: readonly ComparisonCandidate[],
  current: { date: string | null; loadKg: number | null },
): EarlierLift | null {
  const own = candidates
    .filter(c => c.sameExercise && !c.isModel)
    .filter(c => current.date === null || c.clip.date === null || c.clip.date < current.date)
    .map(c => {
      const stored = storedLift(c);
      return stored === null
        ? null
        : {
            analysisId: c.analysis.id,
            date: c.clip.date,
            loadKg: c.clip.loadKg,
            peakVelocityMs: stored.peak,
            errorMs: c.analysis.grade_error_ms,
            metrics: stored.metrics,
          };
    })
    .filter((c): c is EarlierLift => c !== null)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (own.length === 0) return null;
  const sameLoad = current.loadKg !== null ? own.find(c => c.loadKg === current.loadKg) : undefined;
  return sameLoad ?? own[0];
}

export function verdictFor(
  current: { peakVelocityMs: number | null; loadKg: number | null; errorMs: number | null },
  earlier: EarlierLift | null,
): Verdict {
  if (current.peakVelocityMs === null || !Number.isFinite(current.peakVelocityMs)) {
    return {
      kind: 'none',
      headline: 'No peak velocity',
      detail: 'Calibrate and track first.',
      deltaMs: null,
    };
  }
  if (!earlier) {
    return {
      kind: 'none',
      headline: 'Nothing earlier to compare with',
      detail: 'No earlier analysed lift of this exercise.',
      deltaMs: null,
    };
  }

  const delta = current.peakVelocityMs - earlier.peakVelocityMs;
  // The margin is the grade's one-sigma error on peak velocity. Two lifts
  // each carry one; the difference between them is uncertain by both, so the
  // larger of the two is the honest gate. An ungraded row falls back to the
  // catalogue's "significant" threshold for this metric.
  const fallback = metricById('peakVelocity')?.significant ?? 0.03;
  const margin = Math.max(current.errorMs ?? fallback, earlier.errorMs ?? 0);
  const when = earlier.date ? formatDateShort(earlier.date) : 'the earlier lift';
  const sameLoad = current.loadKg !== null && earlier.loadKg === current.loadKg;
  const at = sameLoad
    ? 'at this weight'
    : earlier.loadKg !== null
      ? `at ${loadLabel(earlier.loadKg)}`
      : 'at an unknown load';
  const signed = `${delta >= 0 ? '+' : '−'}${num(Math.abs(delta), 2)} m/s`;
  const marginText = `±${num(margin, 2)} m/s`;

  if (Math.abs(delta) > margin) {
    const faster = delta > 0;
    return {
      kind: faster ? 'faster' : 'slower',
      headline: `${faster ? 'Faster' : 'Slower'} than the last lift ${at}`,
      detail: `${signed} vs ${when} · outside ${marginText}`,
      deltaMs: delta,
    };
  }
  return {
    kind: 'level',
    headline: `Level with the last lift ${at}`,
    detail: `${signed} vs ${when} · inside ${marginText}`,
    deltaMs: delta,
  };
}
