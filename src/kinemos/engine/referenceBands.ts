/**
 * referenceBands — what the German material says a number should read.
 *
 * The BVDG's biomechanical orientation values (Rahmentrainingskonzeption
 * 2019, Tab. A1–A3, after Sandau, Jentsch & Lippmann; `KinEMOS Resources/`),
 * in EMOS units. They are stated per weight class — lower, middle, upper —
 * and, for the forces and the turnover time, per sex, for national-squad
 * lifters. So a band is never a verdict: it is shown beside a value, when
 * the coach asks for it, as the range the material expects, and the
 * everyday tier's ±0,05 m/s margin is as wide as most of them (P9 plan §6).
 *
 * Keyed by the metric catalogue's ids, so the panel that lists a metric
 * looks its band up by the same name. COACH-CONFIG candidate throughout: a
 * club will hold its own bands, and these are the defaults.
 *
 * Engine purity: data and a lookup.
 */
import type { LiftFamily } from './liftModels';

export type WeightClass = 'lower' | 'middle' | 'upper';
export type Sex = 'men' | 'women';

export const WEIGHT_CLASSES: ReadonlyArray<{ id: WeightClass; label: string }> = [
  { id: 'lower', label: 'lower classes' },
  { id: 'middle', label: 'middle classes' },
  { id: 'upper', label: 'upper classes' },
];
export const SEXES: ReadonlyArray<{ id: Sex; label: string }> = [
  { id: 'men', label: 'men' },
  { id: 'women', label: 'women' },
];

export interface Band {
  lo: number;
  hi: number;
  /** `range` — between lo and hi; `mean` — the material gives an average,
   *  lo = hi; `max` — up to hi; `min` — at least lo. */
  kind: 'range' | 'mean' | 'max' | 'min';
  /** A remark the material attaches ("ideally two force maxima"). */
  note?: string;
}

type ByClass = [Band, Band, Band];
type BySex = { men: Band; women: Band };
type Spec = Band | ByClass | BySex | { byClass: ByClass } | { bySex: BySex };

const range = (lo: number, hi: number, note?: string): Band => ({ lo, hi, kind: 'range', note });
const mean = (v: number, note?: string): Band => ({ lo: v, hi: v, kind: 'mean', note });
const max = (v: number, note?: string): Band => ({ lo: -Infinity, hi: v, kind: 'max', note });
const min = (v: number, note?: string): Band => ({ lo: v, hi: Infinity, kind: 'min', note });

/** Tab. A1 — snatch. */
const SNATCH: Record<string, Spec> = {
  firstPull: { byClass: [range(1.2, 1.3), range(1.3, 1.45), range(1.4, 1.5)] },
  v2: { byClass: [range(1.1, 1.3), range(1.2, 1.45), range(1.3, 1.5)] },
  transitionLoss: max(0.1, 'up to 10 cm/s lost through the knee'),
  peakVelocity: { byClass: [range(1.5, 1.7), range(1.7, 1.85), range(1.8, 1.95)] },
  vmin: min(-0.85, 'down to −0,85 m/s'),
  f1: { bySex: { men: mean(137), women: mean(132) } },
  f2: { bySex: { men: mean(100), women: mean(109) } },
  f3: { bySex: { men: mean(139), women: mean(149) } },
  fbr: max(145),
  sRemain: range(60, 75),
  tTurn: { bySex: { men: range(0.375, 0.385), women: max(0.39) } },
};

/** Tab. A2 — clean. */
const CLEAN: Record<string, Spec> = {
  firstPull: { byClass: [range(0.9, 1.1), range(1.05, 1.25), range(1.15, 1.35)] },
  v2: { byClass: [range(0.8, 1.1), range(0.95, 1.25), range(1.05, 1.35)] },
  transitionLoss: max(0.1, 'up to 10 cm/s lost through the knee'),
  peakVelocity: { byClass: [range(1.0, 1.2), range(1.2, 1.4), range(1.3, 1.5)] },
  vmin: min(-1.45, 'down to −1,45 m/s'),
  f1: { bySex: { men: mean(134), women: mean(127) } },
  f2: { bySex: { men: mean(89), women: mean(99) } },
  f3: { bySex: { men: mean(130), women: mean(137) } },
  fbr: range(160, 180, 'ideally two force maxima'),
  sRemain: range(70, 80),
  tTurn: { bySex: { men: range(0.355, 0.365), women: range(0.37, 0.38) } },
};

/** Tab. A3 — jerk (and the push press, which shares the family). */
const JERK: Record<string, Spec> = {
  vDip: range(-1.1, -1.0),
  peakVelocity: { byClass: [range(1.4, 1.5), range(1.5, 1.6), range(1.6, 1.7)] },
  vmin: min(-0.35, 'down to −0,35 m/s'),
  fDip: mean(180),
  fDrive: range(180, 230, '180–190 % with two maxima, 220–230 % with one'),
  fbr: range(125, 130),
  sDip: { byClass: [range(16, 18), range(18, 20), range(20, 22)] },
  sFall: range(2, 6),
  sRemain: range(60, 80),
  tTurn: mean(0.33),
};

const BY_FAMILY: Partial<Record<LiftFamily, Record<string, Spec>>> = {
  snatch: SNATCH,
  clean: CLEAN,
  jerk: JERK,
};

const CLASS_INDEX: Record<WeightClass, 0 | 1 | 2> = { lower: 0, middle: 1, upper: 2 };

/**
 * The band for a metric of a lift family at a weight class and sex, or null
 * when the material has none — a pull's phases, the universal set, a family
 * the tables do not cover.
 */
export function referenceBand(metricId: string, family: LiftFamily, weightClass: WeightClass, sex: Sex): Band | null {
  const spec = BY_FAMILY[family]?.[metricId];
  if (!spec) return null;
  if (Array.isArray(spec)) return spec[CLASS_INDEX[weightClass]];
  if ('byClass' in spec) return spec.byClass[CLASS_INDEX[weightClass]];
  if ('bySex' in spec) return spec.bySex[sex];
  return spec as Band;
}

/**
 * One number to stand for a band: the middle of a range, the mean itself, or
 * the single bound of a one-sided one. What a surface uses when it needs a
 * value rather than a range — an assumed velocity threshold, say.
 */
export function bandMidpoint(band: Band | null): number | null {
  if (!band) return null;
  switch (band.kind) {
    case 'range':
      return (band.lo + band.hi) / 2;
    case 'mean':
      return band.lo;
    case 'max':
      return Number.isFinite(band.hi) ? band.hi : null;
    case 'min':
      return Number.isFinite(band.lo) ? band.lo : null;
  }
}

/** Whether a value sits inside a band. Null when there is nothing to say. */
export function withinBand(value: number | null, band: Band | null): boolean | null {
  if (value === null || !band || !Number.isFinite(value)) return null;
  switch (band.kind) {
    case 'range':
      return value >= band.lo && value <= band.hi;
    case 'mean':
      return true;
    case 'max':
      return value <= band.hi;
    case 'min':
      return value >= band.lo;
  }
}

/**
 * The band as the panel prints it, in the metric's own unit and decimals,
 * comma-decimal as everywhere in EMOS: `1,50–1,60`, `Ø 137`, `≤ 145`, `≥ −0,85`.
 */
export function formatBand(band: Band, decimals: number): string {
  const f = (v: number) => v.toFixed(decimals).replace('.', ',').replace('-', '−');
  switch (band.kind) {
    case 'range':
      // A dash between two negative numbers reads as a sum; say "to".
      return band.lo < 0 || band.hi < 0 ? `${f(band.lo)} to ${f(band.hi)}` : `${f(band.lo)}–${f(band.hi)}`;
    case 'mean':
      return `Ø ${f(band.lo)}`;
    case 'max':
      return `≤ ${f(band.hi)}`;
    case 'min':
      return `≥ ${f(band.lo)}`;
  }
}
