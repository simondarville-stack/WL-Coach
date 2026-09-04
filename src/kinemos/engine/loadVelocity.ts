/**
 * loadVelocity — what the bar's speed says about the load.
 *
 * Design §12 puts velocity-based training at the end of the road: *"the
 * end-game (velocity-loss cutoffs, load-velocity-profile-driven
 * prescriptions feeding the planner), but only once enough data exists.
 * Metrics-into-planner DISPLAY precedes metrics-driving-planner LOGIC."*
 * This module is the display half — the arithmetic that turns a season of
 * analysed reps into the two things a coach can act on — and it deliberately
 * proposes nothing to the planner on its own.
 *
 * **The load–velocity profile.** Across submaximal loads, peak bar velocity
 * falls close to linearly with load. Fit that line for one athlete and one
 * exercise and it answers two questions from one afternoon's data: what load
 * would move at the velocity I want today, and — extrapolating to the speed
 * at which this athlete's maximum actually moves — roughly where their
 * maximum is.
 *
 * Three honesty rules are built into the model rather than written next to
 * it, because in Olympic lifting this line is genuinely noisier than the
 * squat-and-bench literature it comes from:
 *
 *   1. **A profile needs a spread of loads.** Three reps at 80, 82 and 85 kg
 *      fit a line with an excellent r² that predicts nothing at 60 or 120.
 *      `fitLoadVelocityProfile` refuses a load range narrower than
 *      `minLoadSpread` of the heaviest load, and reports the range it did
 *      cover so an extrapolation can be judged.
 *   2. **The minimal velocity threshold is the athlete's, not a constant.**
 *      A 1RM estimate is the profile evaluated at the speed that athlete's
 *      true maximum moves at, and that speed differs between people and
 *      between the snatch and the clean. Where the athlete has an analysed
 *      near-maximal attempt, its measured velocity IS the threshold and
 *      `thresholdFrom` returns it; otherwise the caller supplies one and the
 *      result says it was assumed. COACH-CONFIG throughout.
 *   3. **Technique changes with load in a way it does not in a squat.** A
 *      light snatch is often pulled with a deliberately patient first pull
 *      and a heavy one is not, so the residual scatter is a property of the
 *      lift and not only of the measurement. `r2` and `residualMs` are
 *      returned so a coach can see the line is a guide, not a law.
 *
 * **Velocity loss** is the other half and needs no profile at all: within one
 * set, how far the last rep dropped from the best. It is the most-used VBT
 * autoregulation cue there is, and it is a subtraction.
 *
 * Engine purity: numbers in, numbers out.
 */

/** One analysed rep, as this module needs it. */
export interface LoadVelocityPoint {
  loadKg: number;
  /** Peak vertical bar velocity for that rep, m/s. */
  velocityMs: number;
  /** For weighting and for saying which reps a profile rests on. */
  grade?: 'A' | 'B' | 'C' | null;
  date?: string | null;
  analysisId?: string;
}

export interface LoadVelocityProfile {
  /** v = interceptMs + slopeMsPerKg · load. Slope is negative. */
  interceptMs: number;
  slopeMsPerKg: number;
  /** Goodness of fit, 0–1. */
  r2: number;
  /** RMS of the residuals, m/s — how far a real rep sits from the line. */
  residualMs: number;
  n: number;
  minLoadKg: number;
  maxLoadKg: number;
  /** The load range as a share of the heaviest load. A profile fitted over a
   *  narrow band extrapolates badly and this is the number that says so. */
  loadSpread: number;
}

export interface FitOptions {
  /** Least load range, as a share of the heaviest load, for a profile to be
   *  offered at all. */
  minLoadSpread?: number;
  /** Fewest reps. */
  minPoints?: number;
  /** Drop C-graded reps. On by default: a profile is a line through
   *  measurements, and the grade is what says which measurements to trust. */
  excludeWeakGrades?: boolean;
}

const DEFAULTS: Required<FitOptions> = {
  minLoadSpread: 0.15,
  minPoints: 4,
  excludeWeakGrades: true,
};

/**
 * Fit the line, or refuse. Null when there are too few reps, too narrow a
 * load range, or no downward relationship at all — the last being the case
 * where the data is measuring something other than load.
 */
export function fitLoadVelocityProfile(
  points: readonly LoadVelocityPoint[],
  options: FitOptions = {},
): LoadVelocityProfile | null {
  const opt = { ...DEFAULTS, ...options };
  const usable = points.filter(
    p =>
      Number.isFinite(p.loadKg) &&
      Number.isFinite(p.velocityMs) &&
      p.loadKg > 0 &&
      p.velocityMs > 0 &&
      (!opt.excludeWeakGrades || p.grade !== 'C'),
  );
  if (usable.length < opt.minPoints) return null;

  const loads = usable.map(p => p.loadKg);
  const minLoadKg = Math.min(...loads);
  const maxLoadKg = Math.max(...loads);
  const loadSpread = maxLoadKg > 0 ? (maxLoadKg - minLoadKg) / maxLoadKg : 0;
  if (loadSpread < opt.minLoadSpread) return null;

  const n = usable.length;
  let sx = 0;
  let sy = 0;
  for (const p of usable) {
    sx += p.loadKg;
    sy += p.velocityMs;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of usable) {
    const dx = p.loadKg - mx;
    sxx += dx * dx;
    sxy += dx * (p.velocityMs - my);
  }
  if (!(sxx > 0)) return null;
  const slopeMsPerKg = sxy / sxx;
  // A flat or rising line is not a load–velocity relationship. Refusing is
  // right: it means the reps differ by something other than load.
  if (!(slopeMsPerKg < 0)) return null;
  const interceptMs = my - slopeMsPerKg * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of usable) {
    const predicted = interceptMs + slopeMsPerKg * p.loadKg;
    ssRes += (p.velocityMs - predicted) ** 2;
    ssTot += (p.velocityMs - my) ** 2;
  }
  return {
    interceptMs,
    slopeMsPerKg,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    residualMs: Math.sqrt(ssRes / n),
    n,
    minLoadKg,
    maxLoadKg,
    loadSpread,
  };
}

/** The velocity the profile predicts at a load. */
export function velocityAtLoad(profile: LoadVelocityProfile, loadKg: number): number {
  return profile.interceptMs + profile.slopeMsPerKg * loadKg;
}

/** The load the profile predicts for a velocity. */
export function loadForVelocity(profile: LoadVelocityProfile, velocityMs: number): number {
  return (velocityMs - profile.interceptMs) / profile.slopeMsPerKg;
}

/** How far outside the fitted loads a prediction sits, as a share of the
 *  fitted range. Zero inside it; 1 means a whole range beyond the end. The
 *  number that decides whether a prediction is a reading or a guess. */
export function extrapolation(profile: LoadVelocityProfile, loadKg: number): number {
  const range = profile.maxLoadKg - profile.minLoadKg;
  if (!(range > 0)) return Infinity;
  if (loadKg > profile.maxLoadKg) return (loadKg - profile.maxLoadKg) / range;
  if (loadKg < profile.minLoadKg) return (profile.minLoadKg - loadKg) / range;
  return 0;
}

export interface OneRepMaxEstimate {
  loadKg: number;
  /** The velocity it was read at. */
  thresholdMs: number;
  /** Where the threshold came from — a measured near-maximal attempt, or a
   *  number the coach supplied. The estimate means quite different things in
   *  the two cases. */
  thresholdSource: 'measured' | 'assumed';
  /** How far past the fitted loads this estimate sits (see `extrapolation`).
   *  Above about 0,5 it is an opinion with a decimal point. */
  extrapolation: number;
}

/**
 * Where the profile says this athlete's maximum is: the load at which the bar
 * would move at the speed their maximum actually moves.
 *
 * This is NOT a 1RM test and the return type is shaped so it cannot be
 * mistaken for one — the threshold and how far the line was extended both
 * travel with the number.
 */
export function estimateOneRepMax(
  profile: LoadVelocityProfile,
  threshold: { velocityMs: number; source: 'measured' | 'assumed' },
): OneRepMaxEstimate {
  const loadKg = loadForVelocity(profile, threshold.velocityMs);
  return {
    loadKg,
    thresholdMs: threshold.velocityMs,
    thresholdSource: threshold.source,
    extrapolation: extrapolation(profile, loadKg),
  };
}

/**
 * The athlete's own minimal velocity threshold, where their data contains a
 * near-maximal attempt: the velocity of the heaviest rep at or above
 * `nearMaxShare` of their heaviest load. Null when nothing is heavy enough,
 * in which case the caller must supply one and say it was assumed.
 */
export function thresholdFrom(
  points: readonly LoadVelocityPoint[],
  nearMaxShare = 0.95,
): { velocityMs: number; source: 'measured' } | null {
  const usable = points.filter(p => Number.isFinite(p.loadKg) && Number.isFinite(p.velocityMs) && p.grade !== 'C');
  if (usable.length === 0) return null;
  const heaviest = Math.max(...usable.map(p => p.loadKg));
  const near = usable.filter(p => p.loadKg >= heaviest * nearMaxShare);
  if (near.length === 0) return null;
  // The slowest of the near-maximal reps: the one that was actually hard.
  const velocityMs = Math.min(...near.map(p => p.velocityMs));
  return { velocityMs, source: 'measured' };
}

// ── Velocity loss ───────────────────────────────────────────────────────────

export interface VelocityLoss {
  bestMs: number;
  lastMs: number;
  /** Drop from the best rep to the last, as a percentage of the best. */
  lossPct: number;
  /** The largest drop from the best rep to any later rep. On a set where the
   *  lifter rallied, this is bigger than `lossPct` and is the honest number
   *  for "how far did it fall". */
  worstLossPct: number;
  reps: number;
  /** Index of the best rep, 0-based — a set whose best rep is its last has
   *  no fatigue to report, and probably was not taken far enough. */
  bestIndex: number;
}

/**
 * How much the bar slowed across a set. Reps in the order they were lifted.
 *
 * The convention is deliberately "from the BEST rep", not from the first: a
 * lifter's second rep is routinely faster than their first, and measuring
 * from the first would call that a negative loss.
 */
export function velocityLoss(velocitiesMs: readonly number[]): VelocityLoss | null {
  const reps = velocitiesMs.filter(v => Number.isFinite(v) && v > 0);
  if (reps.length < 2) return null;
  let bestIndex = 0;
  for (let i = 1; i < reps.length; i++) if (reps[i] > reps[bestIndex]) bestIndex = i;
  const bestMs = reps[bestIndex];
  const lastMs = reps[reps.length - 1];
  let worst = 0;
  for (let i = bestIndex + 1; i < reps.length; i++) {
    worst = Math.max(worst, ((bestMs - reps[i]) / bestMs) * 100);
  }
  return {
    bestMs,
    lastMs,
    lossPct: ((bestMs - lastMs) / bestMs) * 100,
    worstLossPct: worst,
    reps: reps.length,
    bestIndex,
  };
}

/**
 * Which rep a velocity-loss cutoff would have stopped the set on, 1-based,
 * or null when the set never dropped that far. The cue itself: "stop when
 * the bar has slowed 10 % from your best".
 */
export function repAtLossCutoff(velocitiesMs: readonly number[], cutoffPct: number): number | null {
  const reps = velocitiesMs.filter(v => Number.isFinite(v) && v > 0);
  let best = 0;
  for (let i = 0; i < reps.length; i++) {
    best = Math.max(best, reps[i]);
    if (((best - reps[i]) / best) * 100 >= cutoffPct) return i + 1;
  }
  return null;
}
