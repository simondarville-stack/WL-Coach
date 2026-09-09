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
 *   - a REST is a run of samples in which the bar barely moves — and, for a
 *     lift from the floor, sits near the lowest height on the track;
 *   - LIFT-OFF is the last rest sample before the bar rises past a threshold
 *     and keeps rising;
 *   - the CATCH is the first moment after the rep's peak vertical velocity
 *     at which the bar stops rising.
 *
 * P9 added the second signature, the DIP-AND-DRIVE: a bar resting high that
 * goes DOWN first — a jerk's 17–22 cm Auftakt — and then rises past where it
 * started. Which signature a rest is read for is the track's `shape`
 * (`phases.ts` `MotionShape`); a compound clip — a clean and jerk — is cut
 * on every rest and each segment is classified by what the bar did first.
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
import type { MotionShape } from './phases';

/** What a cut rep turned out to be, from the bar alone. */
export type RepKind = 'pull' | 'dip-drive';

export interface RepSegment {
  /** Positions in the SORTED input of the rest sample the rep starts from
   *  and the sample it ends at — the deepest point of the catch plus a short
   *  tail (`tailS`) so the settle is in the rep — inclusive. */
  from: number;
  to: number;
  /** Lift-off: the last rest sample, s. For a dip-and-drive, where the dip
   *  began. */
  liftOffT: number;
  /** The top of the bar's flight — the first stop after peak velocity, s. */
  apexT: number;
  /** The deepest point of the catch after the apex, s. The rep ends here, so
   *  the drop under and the braking are in it (the analyzer's Vmin, S_sit,
   *  S_fall and Fbr) and the recovery is not. */
  catchT: number;
  /** Height at the apex above the rest, cm. */
  riseCm: number;
  /** What the bar did first: rose from its rest, or dipped below it. */
  kind: RepKind;
  /** How far the bar dipped below its rest before rising, cm. Zero for a
   *  pull. */
  dipCm: number;
}

export interface SplitRepsOptions {
  /**
   * Which signature to read the rests for. `pull-catch` and `pull` look for
   * a rise from a rest near the floor; `dip-drive` for a descent from a rest
   * at any height; `free` and `compound` accept either, from any rest, and
   * classify each rep by what came first. Default: `pull-catch`.
   */
  shape?: MotionShape;
  /**
   * Whether a rest must be near the floor. Default: yes for the pull shapes,
   * no for the others. A lift from the hang or blocks is a pull whose rest
   * is a knee's height above where the bar ends up, so its model says no.
   */
  fromFloor?: boolean;
  /** A rep must rise at least this far above its rest, cm. Below it the bar
   *  was shifted, not lifted. COACH-CONFIG candidate. */
  minRiseCm?: number;
  /** The same for a dip-and-drive, whose rest is already at the shoulders:
   *  rack to overhead is 40–60 cm on a tall lifter and under 40 on a short
   *  one (2009 bench: 39 cm on the jerk from the side). COACH-CONFIG
   *  candidate. */
  minRiseDipCm?: number;
  /** A dip-and-drive must descend at least this far below its rest before
   *  rising, cm — a jerk's Auftakt is 16–22 cm; a dynamic start in the
   *  snatch is a few. COACH-CONFIG candidate. */
  minDipCm?: number;
  /** The bar is at rest below this speed, m/s. */
  restSpeedMs?: number;
  /** How long the bar must hold still to count as a rest, s. */
  minRestS?: number;
  /** For lifts from the floor: a rest must be within this height of the
   *  track's lowest point, cm — the floor, not a pause at the hip. */
  restBandCm?: number;
  /** Faster than this, vertically, between two samples is not a barbell:
   *  the tracker lost the plate, and the rep ends before it. */
  maxSpeedMs?: number;
  /**
   * Downward speed past which the bar is being DROPPED, m/s, not caught. A
   * catch brings the bar down at up to ~1,5 m/s and stops; a bar let go from
   * the catch, or from overhead, passes 2 m/s within a fifth of a second and
   * keeps going to the floor. The rep ends at the last sample before that,
   * so a missed lift is measured to where the lifter lost it, not to the
   * platform — the testset's snatch double (04/09/2026) had rep 1 "caught"
   * 126 cm below its apex, on the floor. COACH-CONFIG candidate.
   */
  dropSpeedMs?: number;
  /** How far either side of a rest, s, the local floor is looked for. */
  localFloorS?: number;
  /** How long past the sit a rep's samples run, s, so the settle is in the
   *  rep. Cut short by a drop or the next rest. */
  tailS?: number;
}

/**
 * The one definition of "dropped": downward speed past which a bar is being
 * let go, m/s (see `SplitRepsOptions.dropSpeedMs`). The tracker's
 * `stopAtDrop` ends a track on the same bound, so the two agree on where a
 * rep ends. COACH-CONFIG candidate.
 */
export const DROP_SPEED_MS = 2;

const DEFAULTS: Required<SplitRepsOptions> = {
  shape: 'pull-catch',
  // Read from `options`, not `opt`: the default is decided by the shape.
  fromFloor: true,
  minRiseCm: 40,
  minRiseDipCm: 25,
  minDipCm: 8,
  restSpeedMs: 0.25,
  minRestS: 0.15,
  restBandCm: 15,
  maxSpeedMs: 6,
  dropSpeedMs: DROP_SPEED_MS,
  localFloorS: 5,
  tailS: 0.5,
};

/**
 * Local minima of height that a rise of `minRiseCm` follows, outside any
 * still run: the turnarounds a hang or block lift is taken from. On a
 * plateau the last minimum before the rise is kept.
 */
function bottomsBeforeARise(
  h: readonly number[],
  medianDt: number,
  rests: ReadonlyArray<{ from: number; to: number }>,
  opt: Required<SplitRepsOptions>,
): Array<{ from: number; to: number }> {
  const n = h.length;
  const win = Math.max(1, Math.round(0.1 / medianDt));
  const near = Math.max(1, Math.round(0.3 / medianDt));
  const bottoms: number[] = [];
  for (let i = win; i < n - win; i++) {
    let isMin = true;
    for (let k = i - win; k <= i + win; k++) {
      if (h[k] < h[i]) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;
    if (rests.some(r => i >= r.from - near && i <= r.to + near)) continue;
    let rises = false;
    for (let j = i + 1; j < n; j++) {
      if (h[j] - h[i] >= opt.minRiseCm) {
        rises = true;
        break;
      }
      if (h[j] < h[i] - 2) break;
    }
    if (rises) bottoms.push(i);
  }
  const kept: Array<{ from: number; to: number }> = [];
  for (let k = 0; k < bottoms.length; k++) {
    if (k + 1 < bottoms.length && bottoms[k + 1] - bottoms[k] <= near) continue;
    kept.push({ from: bottoms[k], to: bottoms[k] });
  }
  return kept;
}

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
  const gaps = sorted.slice(1).map((p, i) => p.t - sorted[i].t).sort((a, b) => a - b);
  const medianDt = gaps[gaps.length >> 1] || 1 / 30;
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
  // Slow runs, then — for a lift from the floor — the ones that are on it.
  // The floor is LOCAL: the lowest slow sample within a few seconds either
  // side. A phone that moved between two reps puts the second rest at a
  // different image height, and a tracker that wandered off during a drop
  // can put samples anywhere, so neither a global minimum nor a global floor
  // would do. A pause at the knee is 30 cm above its own local floor and is
  // not a rest. A dip-and-drive rests high, and a compound clip rests on
  // the floor AND at the rack, so those shapes keep every still run.
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
  const fromFloor = options.fromFloor ?? (opt.shape === 'pull-catch' || opt.shape === 'pull');
  const rests = fromFloor
    ? slowRuns.filter(run => {
        const t0 = sorted[run.from].t;
        let local = Infinity;
        for (let i = 0; i < n; i++) {
          if (speed[i] <= opt.restSpeedMs && Math.abs(sorted[i].t - t0) <= opt.localFloorS) local = Math.min(local, h[i]);
        }
        const height = Math.min(...h.slice(run.from, run.to + 1));
        return height - local <= opt.restBandCm;
      })
    : [...slowRuns];
  // A lift that starts above the floor is often taken out of a turnaround
  // rather than a rest: the bar lowered to the hang and pulled straight out
  // of the bottom, still for a frame or two (2009 hang snatch: 0,08 s at
  // the hang, under the 0,15 s a rest needs). The lowest point before such
  // a rise is the rep's rest.
  if (!fromFloor && (opt.shape === 'pull-catch' || opt.shape === 'pull')) {
    for (const bottom of bottomsBeforeARise(h, medianDt, rests, opt)) rests.push(bottom);
    rests.sort((a, b) => a.from - b.from);
  }

  const reps: RepSegment[] = [];
  for (let r = 0; r < rests.length; r++) {
    const liftOff = rests[r].to;
    // A rep may run to the END of the next rest, not its start: a jerk's bar
    // is still the moment it is fixed overhead, and that stillness is both
    // where this rep settles and where the next movement starts from. A rep
    // that starts from that rest is judged on its own — a lowering to the
    // rack is a descent with no rise, and is not one.
    let limit = r + 1 < rests.length ? rests[r + 1].to : n - 1;
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

    // ── What the bar did first ────────────────────────────────────────────
    // A dip: the bar goes below its rest by `minDipCm` before it has risen
    // `minRiseCm` above it. The drive then starts at the lowest point.
    let kind: RepKind = 'pull';
    let dipCm = 0;
    let riseFrom = liftOff;
    if (opt.shape !== 'pull-catch' && opt.shape !== 'pull') {
      let lowI = liftOff;
      for (let i = liftOff + 1; i <= limit; i++) {
        if (h[i] < h[lowI]) lowI = i;
        if (h[i] - base >= opt.minRiseDipCm) break;
        // Turned upward after a real dip: the lowest point is the bottom.
        if (base - h[lowI] >= opt.minDipCm && h[i] > h[lowI] + 2) {
          kind = 'dip-drive';
          dipCm = base - h[lowI];
          riseFrom = lowI;
          break;
        }
      }
      if (opt.shape === 'dip-drive' && kind !== 'dip-drive') continue;
    }
    const minRise = kind === 'dip-drive' ? opt.minRiseDipCm : opt.minRiseCm;

    // The lift is the FIRST rise from the rest (or the dip's bottom) that
    // gets high enough: the first sample at which the bar, at least
    // `minRise` above the REST, stops rising is its apex. Not the fastest
    // rise between this rest and the next — a bar dropped from overhead
    // bounces off the platform faster than it was ever lifted, and a tracker
    // that follows the drop (found again by colour) would hand that bounce
    // to the rep.
    let apexI = -1;
    for (let i = riseFrom + 1; i <= limit; i++) {
      const stops = i === limit || h[i + 1] <= h[i];
      if (stops && h[i] - base >= minRise) {
        apexI = i;
        break;
      }
    }
    if (apexI < 0) continue;
    // Peak vertical velocity on the way up to it.
    let peakI = -1;
    let peakV = 0;
    for (let i = riseFrom + 1; i <= apexI; i++) {
      const v = (h[i] - h[i - 1]) / 100 / Math.max(1e-6, sorted[i].t - sorted[i - 1].t);
      if (v > peakV) {
        peakV = v;
        peakI = i;
      }
    }
    if (peakI < 0) continue;
    const rise = h[apexI] - base;
    // The catch: from the apex the bar comes down into the receiving
    // position and stops falling — the deepest point before the recovery
    // lifts it again. The search ends when the bar rises more than a couple
    // of centimetres off its low (the recovery), when it has come to rest
    // after falling (a bar set down, or dropped to the floor: then the
    // "catch" is the floor and S_fall is the whole height, which is what a
    // missed lift measures), or at a gap in the samples — a tracker that lost
    // the plate on the drop and found it again on the floor must not hand
    // the floor to the catch.
    let sitI = apexI;
    let falling = false;
    for (let i = apexI + 1; i <= limit; i++) {
      if (sorted[i].t - sorted[i - 1].t > 3 * medianDt) break;
      // Let go: the bar is falling faster than a catch ever lowers it. The
      // rep ended where the lifter lost it, at the low point before this.
      const vy = (h[i] - h[i - 1]) / 100 / Math.max(1e-6, sorted[i].t - sorted[i - 1].t);
      if (vy < -opt.dropSpeedMs) break;
      if (h[i] < h[sitI]) sitI = i;
      else if (h[i] > h[sitI] + 2) break;
      if (speed[i] > opt.restSpeedMs) falling = true;
      else if (falling) break;
    }
    // The rep carries on for a moment past the sit — the bar fixed overhead,
    // or the start of the recovery — so the phase layer can see it settle
    // (P9: a jerk cut at its sit had no fix and no settle to read). Never
    // through a drop, a gap in the samples, or into the next rest.
    let endI = sitI;
    const tailUntil = sorted[sitI].t + opt.tailS;
    for (let i = sitI + 1; i <= limit && sorted[i].t <= tailUntil; i++) {
      if (sorted[i].t - sorted[i - 1].t > 3 * medianDt) break;
      const vy = (h[i] - h[i - 1]) / 100 / Math.max(1e-6, sorted[i].t - sorted[i - 1].t);
      if (vy < -opt.dropSpeedMs) break;
      endI = i;
    }
    reps.push({
      from: liftOff,
      to: endI,
      liftOffT: sorted[liftOff].t,
      apexT: sorted[apexI].t,
      catchT: sorted[sitI].t,
      riseCm: rise,
      kind,
      dipCm,
    });

    // A dip-and-drive that starts with no rest: a competition clean & jerk
    // where the lifter stands out of the clean and dips straight into the
    // jerk, never still at the rack for the 0,15 s a rest needs (2009
    // bench, the clean & jerk from the side). The top of the recovery —
    // where the bar stops rising after this rep's sit — is where the jerk
    // starts, and it serves as the next rep's rest when the bar goes down
    // from it by `minDipCm` and up past it by `minRiseDipCm` before any
    // still run.
    if (!fromFloor) {
      const nextFrom = r + 1 < rests.length ? rests[r + 1].from : n;
      // The top: the highest the bar gets before it has come down a dip's
      // worth from there. Judged against `minDipCm`, not a couple of
      // centimetres, because a raw track jitters that much around a catch
      // (2009 bench: 23 → 19 → 23 → 40 cm across three frames).
      let top = sitI;
      for (let i = sitI + 1; i < nextFrom; i++) {
        if (h[i] > h[top]) top = i;
        else if (h[top] - h[i] >= opt.minDipCm) break;
      }
      if (top > sitI) {
        let low = top;
        let bottom = -1;
        for (let i = top + 1; i < nextFrom; i++) {
          if (h[i] < h[low]) low = i;
          if (h[top] - h[low] >= opt.minDipCm && h[i] > h[low] + 2) {
            bottom = low;
            break;
          }
        }
        let rises = false;
        if (bottom >= 0) {
          for (let i = bottom + 1; i < nextFrom; i++) {
            if (h[i] - h[top] >= opt.minRiseDipCm) {
              rises = true;
              break;
            }
          }
        }
        if (rises) rests.splice(r + 1, 0, { from: top, to: top });
      }
    }
  }
  return reps;
}
