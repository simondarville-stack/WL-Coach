/**
 * metricDeltas — one lift's numbers against an earlier lift's, in words.
 *
 * A delta carries a direction WORD, not only a sign (docs/DISPLAY_CONVENTIONS,
 * and the viewer layout's "measurement honesty"): `+0,04 ↑ better`,
 * `+0,03 ↓ worse`, `±0,00 same`. Whether up is better is the metric's own
 * business (`betterWhen` in the catalogue); a metric with no better direction
 * gets neutral words — higher / lower, or the row's own pair (faster / slower,
 * later / earlier in the pull).
 *
 * A difference below the metric's threshold is "same", whatever its sign. For
 * velocities the threshold is the larger of the catalogue's `significant` and
 * the grade's error margin, so the table never says "↑ better" on a row the
 * verdict above it calls level.
 */
import { metricById, type BetterWhen, type ComputedLift } from '../engine/metricCatalogue';
import { num } from './viewerFormat';

export type DeltaTone = 'better' | 'worse' | 'same' | 'neutral';

export interface MetricDelta {
  /** Current minus earlier, in the metric's unit. */
  delta: number;
  /** `+0,04 ↑ better` — sign, magnitude, arrow, word. No unit: the row's
   *  value column carries it. */
  text: string;
  tone: DeltaTone;
}

export interface DeltaOptions {
  decimals: number;
  betterWhen: BetterWhen;
  /** Below this magnitude the difference is reported as "same". */
  threshold: number;
  /** The words for up and down when there is no better direction. */
  words?: [up: string, down: string];
}

export function describeDelta(current: number | null, earlier: number | null, options: DeltaOptions): MetricDelta | null {
  if (current === null || earlier === null || !Number.isFinite(current) || !Number.isFinite(earlier)) return null;
  const delta = current - earlier;
  const magnitude = num(Math.abs(delta), options.decimals);
  // Rounded to the shown decimals first, so a difference that prints as
  // 0,00 is "±0,00 same" and not "+0,00 same".
  const printsAsZero = Math.abs(delta) < 0.5 * 10 ** -options.decimals;
  const signed = printsAsZero ? `±${magnitude}` : `${delta > 0 ? '+' : '−'}${magnitude}`;
  if (Math.abs(delta) < options.threshold) {
    return { delta, text: `${signed} same`, tone: 'same' };
  }
  const up = delta > 0;
  // Where the metric has a better direction the arrow points at the QUALITY
  // — ↑ better, ↓ worse — so a bigger transition loss reads `+0,03 ↓ worse`.
  // Without one it points at the value: ↑ higher, ↓ lower.
  if (options.betterWhen !== null) {
    const better = options.betterWhen === 'higher' ? up : !up;
    return { delta, text: `${signed} ${better ? '↑ better' : '↓ worse'}`, tone: better ? 'better' : 'worse' };
  }
  const [wordUp, wordDown] = options.words ?? ['higher', 'lower'];
  return { delta, text: `${signed} ${up ? '↑' : '↓'} ${up ? wordUp : wordDown}`, tone: 'neutral' };
}

/** The threshold a velocity row is judged by: the catalogue's step, or the
 *  grade's margin when that is wider. */
export function velocityThreshold(significant: number, marginMs: number | null): number {
  return Math.max(significant, marginMs ?? 0);
}

/**
 * A catalogue metric's delta between two computed lifts. Null when either
 * lift lacks the number, or the id is not in the catalogue.
 */
export function catalogueDelta(
  id: string,
  current: ComputedLift,
  earlier: ComputedLift,
  marginMs: number | null,
  words?: [up: string, down: string],
): MetricDelta | null {
  const metric = metricById(id);
  if (!metric) return null;
  return describeDelta(metric.read(current), metric.read(earlier), {
    decimals: metric.decimals,
    betterWhen: metric.betterWhen,
    threshold: metric.unit === 'm/s' ? velocityThreshold(metric.significant, marginMs) : metric.significant,
    words,
  });
}
