/**
 * reps — cutting a track of several lifts into the lifts.
 *
 * A coach films a double, a triple, a whole set; the tracker follows the
 * plate through all of it, drop included, and the pipeline needs one rep at a
 * time: lift-off to catch, with the bar's rest before it as the height
 * reference. This module finds those cuts from the track alone.
 *
 * The signature of a rep is in the height and speed of the bar, nothing more:
 *
 *   - a REST is a run of samples in which the bar barely moves and sits near
 *     the lowest height on the track — the bar on the floor, between reps;
 *   - LIFT-OFF is the last rest sample before the bar rises past a threshold
 *     and keeps rising;
 *   - the CATCH is the first moment after the rep's peak vertical velocity
 *     at which the bar stops rising.
 *
 * Every rest followed by a rise that reaches a minimum height is a rep. The
 * drop after the catch and the walk back to the start are not; a tracker
 * that lost the plate on the drop produces no samples there and the next rep
 * still begins at its own rest. Thresholds are in centimetres and metres per
 * second, so they mean the same on every clip; the calibration converts.
 *
 * Engine purity: numbers in, numbers out.
 */
import type { Calibration, TrackPoint } from './calibration';
import { displacementToCm } from './calibration';

export interface RepSegment {
  /** Positions in the SORTED input of the rest sample the rep starts from
   *  and the catch sample it ends at, inclusive. */
  from: number;
  to: number;
  /** Timestamps of the same, s. */
  liftOffT: number;
  catchT: number;
  /** Height at the catch above the rest, cm. */
  riseCm: number;
}

export interface SplitRepsOptions {
  /** A rep must rise at least this far, cm. Below it the bar was shifted,
   *  not lifted. COACH-CONFIG candidate. */
  minRiseCm?: number;
  /** The bar is at rest below this speed, m/s. */
  restSpeedMs?: number;
  /** How long the bar must hold still to count as a rest, s. */
  minRestS?: number;
  /** A rest must be within this height of the track's lowest point, cm —
   *  the floor, not a pause at the hip. */
  restBandCm?: number;
  /** Faster than this, vertically, between two samples is not a barbell:
   *  the tracker lost the plate, and the rep ends before it. */
  maxSpeedMs?: number;
  /** How far either side of a rest, s, the local floor is looked for. */
  localFloorS?: number;
}

const DEFAULTS: Required<SplitRepsOptions> = {
  minRiseCm: 40,
  restSpeedMs: 0.25,
  minRestS: 0.15,
  restBandCm: 15,
  maxSpeedMs: 6,
  localFloorS: 5,
};

/**
 * The reps in a track, in time order. Empty when the track has no rest
 * followed by a rise — a clip that starts mid-pull is one rep the caller
 * already knows about.
 */
export function splitReps(
  points: readonly TrackPoint[],
  calibration: Calibration,
  options: SplitRepsOptions = {},
): RepSegment[] {
  const opt = { ...DEFAULTS, ...options };
  const n = points.length;
  if (n < 4 || !(calibration.cmPerPxV > 0)) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const origin = sorted[0];
  // Height in cm, up positive, and a speed from a central difference — raw,
  // because a rest is a matter of centimetres over tenths of a second and
  // needs no filter.
  const h = sorted.map(p => displacementToCm(calibration, p.x - origin.x, p.y - origin.y).y);
  const speed = sorted.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dt = sorted[b].t - sorted[a].t;
    return dt > 0 ? Math.abs(h[b] - h[a]) / 100 / dt : 0;
  });
  // Slow runs, then the ones that are on the floor. The floor is LOCAL: the
  // lowest slow sample within a few seconds either side. A phone that moved
  // between two reps puts the second rest at a different image height, and
  // a tracker that wandered off during a drop can put samples anywhere, so
  // neither a global minimum nor a global floor would do. A pause at the
  // knee is 30 cm above its own local floor and is not a rest.
  const slowRuns: Array<{ from: number; to: number }> = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const slow = i < n && speed[i] <= opt.restSpeedMs;
    if (slow && start < 0) start = i;
    if (!slow && start >= 0) {
      const long = sorted[i - 1].t - sorted[start].t >= opt.minRestS;
      // The first samples of a clip count even when short: a coach often
      // starts filming as the lifter is already set.
      if (long || (start === 0 && i - 1 >= 1)) slowRuns.push({ from: start, to: i - 1 });
      start = -1;
    }
  }
  const rests = slowRuns.filter(run => {
    const t0 = sorted[run.from].t;
    let local = Infinity;
    for (let i = 0; i < n; i++) {
      if (speed[i] <= opt.restSpeedMs && Math.abs(sorted[i].t - t0) <= opt.localFloorS) local = Math.min(local, h[i]);
    }
    const height = Math.min(...h.slice(run.from, run.to + 1));
    return height - local <= opt.restBandCm;
  });

  const reps: RepSegment[] = [];
  for (let r = 0; r < rests.length; r++) {
    const liftOff = rests[r].to;
    let limit = r + 1 < rests.length ? rests[r + 1].from : n - 1;
    // A step no barbell makes — faster than `maxSpeedMs` — is the tracker
    // losing the plate, usually on the drop. The rep ends there, whatever
    // the samples after it say.
    for (let i = liftOff + 1; i <= limit; i++) {
      const dt = sorted[i].t - sorted[i - 1].t;
      const v = dt > 0 ? Math.hypot(h[i] - h[i - 1], 0) / 100 / dt : 0;
      if (v > opt.maxSpeedMs) {
        limit = i - 1;
        break;
      }
    }
    if (limit <= liftOff + 2) continue;
    const base = h[liftOff];
    // Peak vertical velocity between this rest and the next.
    let peakI = -1;
    let peakV = 0;
    for (let i = liftOff + 1; i <= limit; i++) {
      const v = (h[i] - h[i - 1]) / 100 / Math.max(1e-6, sorted[i].t - sorted[i - 1].t);
      if (v > peakV) {
        peakV = v;
        peakI = i;
      }
    }
    if (peakI < 0) continue;
    // The catch: the first sample after the peak where the bar stops rising.
    let catchI = limit;
    for (let i = peakI + 1; i <= limit; i++) {
      if (h[i] <= h[i - 1]) {
        catchI = i - 1;
        break;
      }
    }
    const rise = h[catchI] - base;
    if (rise < opt.minRiseCm) continue;
    reps.push({
      from: liftOff,
      to: catchI,
      liftOffT: sorted[liftOff].t,
      catchT: sorted[catchI].t,
      riseCm: rise,
    });
  }
  return reps;
}
