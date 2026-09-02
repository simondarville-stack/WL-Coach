/**
 * timing — repairing frames whose timestamps are wrong.
 *
 * A clip's frames carry real presentation timestamps, and the engine trusts
 * them (design §6.3). Sometimes they are wrong, in one of two ways:
 *
 *   - a SPIKE: one frame shows the picture from a different instant than its
 *     stamp says — an encoder that duplicated a frame, a transcode that
 *     re-stamped a variable-rate source onto a nominal grid. The track records
 *     a step that is (nearly) zero followed by one that is (nearly) double, or
 *     the reverse, and the bar carries on as before;
 *   - a STEP: from one frame on, every picture is early or late by the same
 *     amount — a field dropped in a 50i→50p conversion moves everything after
 *     it by half a frame, a dropped frame by a whole one. The track records a
 *     single long (or short) step and then normal steps again.
 *
 * Differentiated, either is an acceleration spike far beyond anything a
 * barbell does, and the low-pass does not remove it: on the first real
 * footage a half-frame step at the second pull moved peak velocity by 5 %
 * between two views of one lift (docs/KINEMOS_ACCURACY_STUDY.md).
 *
 * The detector needs no model of the lift, only a bound on its acceleration.
 * A step change beyond the bound marks a suspect. Then the curve the bar was
 * on BEFORE the suspect — a quadratic through the preceding frames — is
 * asked, for the suspect and the frames after it, at what time it passes
 * through each frame's position:
 *
 *   - the frames after all need the same shift ⇒ a step: the shift is applied
 *     to every frame from the suspect on;
 *   - only the suspect needs a shift ⇒ a spike: the suspect alone is re-timed;
 *   - the frames after fit at no consistent shift ⇒ an event — a catch, a
 *     bounce, a hand across the plate — and nothing is touched.
 *
 * The repair moves samples in TIME, never in space. Position is what was
 * measured; time is what was mislabelled; correcting the mislabelled one
 * keeps the measurement. A suspect the curve cannot reach at any shift within
 * the search window is dropped instead, and the resampler interpolates across
 * it — one fiftieth of a second of straight line, against a spurious
 * acceleration.
 *
 * Engine purity: numbers in, numbers out.
 */
import type { TrackPoint } from './calibration';

/**
 * The most a loaded barbell accelerates, m/s², for the purpose of calling a
 * step change impossible. Peak bar acceleration in a snatch second pull is
 * about 1,5–2 g; a catch decelerates harder but is not followed by the bar
 * carrying on, so it fails the curve test rather than this one. 40 m/s²
 * leaves a factor of two over the fastest pull on record. COACH-CONFIG
 * candidate — a jerk drive or a bounce test might want it higher.
 */
export const DEFAULT_MAX_BAR_ACCELERATION_MS2 = 40;

/** How far, in frames, a sample may be moved in time. */
const MAX_SHIFT_FRAMES = 1.5;

/** Below this the shift is within the noise of the fit and nothing is done. */
const MIN_SHIFT_FRAMES = 0.25;

/** Frames before a suspect the curve is fitted through, and frames after it
 *  that must agree for a step. */
const FIT_BEFORE = 6;
const CHECK_AFTER = 3;

export interface TimingRepair {
  /** Position of the sample in the SORTED input. */
  index: number;
  /** Its original timestamp, s. */
  t: number;
  /**
   * `retimed`: this one sample moved by `shiftFrames`.
   * `stepped`: this sample and every one after it moved by `shiftFrames`.
   * `dropped`: this sample removed.
   */
  action: 'retimed' | 'stepped' | 'dropped';
  shiftFrames: number;
  /** The step change that flagged it, px per frame. */
  stepChangePx: number;
}

export interface TimingRepairOptions {
  /** cm per pixel along the bar's travel — converts the acceleration bound to
   *  pixels per frame². Required: without a scale there is no "impossible". */
  cmPerPx: number;
  maxAccelerationMs2?: number;
}

export interface TimingRepairResult {
  points: TrackPoint[];
  repairs: TimingRepair[];
  /** Nominal frame interval the bound was evaluated at, s. */
  dt: number;
}

/**
 * Repair timing faults in a track. Input must be sorted by `t`; the output is
 * too, and keeps every point that was not dropped. Never throws: a track too
 * short to judge comes back untouched.
 */
export function repairTiming(
  points: readonly TrackPoint[],
  options: TimingRepairOptions,
): TimingRepairResult {
  const n = points.length;
  const dt = medianStep(points);
  if (n < FIT_BEFORE + CHECK_AFTER + 2 || !(dt > 0) || !(options.cmPerPx > 0)) {
    return { points: [...points], repairs: [], dt };
  }
  const aMax = options.maxAccelerationMs2 ?? DEFAULT_MAX_BAR_ACCELERATION_MS2;
  const work: TrackPoint[] = points.map(p => ({ ...p }));
  const dropped = new Set<number>();
  const repairs: TimingRepair[] = [];
  const step = (i: number): number =>
    Math.hypot(work[i].x - work[i - 1].x, work[i].y - work[i - 1].y);

  // The bound in pixels per frame²: a·dt² metres, over metres per pixel. At
  // a high frame rate that is a fraction of a pixel — below the track's own
  // jitter, which would then flag every other frame. So the threshold is the
  // larger of the physical bound and five times the track's robust step-change
  // scatter: a fault has to stand out from the noise as well as from physics.
  const physicalPx = (aMax * dt * dt) / (options.cmPerPx / 100);
  const changes: number[] = [];
  for (let i = 2; i < n; i++) changes.push(Math.abs(step(i) - step(i - 1)));
  changes.sort((a, b) => a - b);
  const noisePx = 5 * 1.4826 * changes[changes.length >> 1];
  const limitPx = Math.max(physicalPx, noisePx);

  for (let i = 4; i <= n - 1 - CHECK_AFTER - 1; i++) {
    const change = step(i) - step(i - 1);
    if (Math.abs(change) <= limitPx) continue;
    // The motion must resume at the rate it had. A catch stops the bar, a
    // bounce sends it back slower: events, and a curve must not be bent to
    // fit them.
    const rateBefore = (step(i - 1) + step(i - 2)) / 2;
    const rateAfter = (step(i + 2) + step(i + 3)) / 2;
    if (Math.abs(rateAfter - rateBefore) > limitPx) continue;

    // The frames before and after the suspect, the suspect itself left out.
    const before: number[] = [];
    for (let k = Math.max(0, i - FIT_BEFORE); k < i; k++) if (!dropped.has(k)) before.push(k);
    const after: number[] = [];
    for (let k = i + 1; k <= i + CHECK_AFTER; k++) after.push(k);
    if (before.length < 4) continue;

    // One curve through both sides, with the frames after free to slide in
    // time: the slide that makes them one smooth curve is the step. Zero
    // slide means the frames after already sit on the curve — a spike — and
    // no slide fitting means an event.
    const joint = fitJoint(work, before, after, work[i].t, dt);
    if (!joint) continue;
    const { curve } = joint;
    let stepShift = joint.shift;
    const own = shiftOnto(curve, work[i], dt);

    if (Math.abs(stepShift) >= MIN_SHIFT_FRAMES) {
      // A step has to PERSIST. A plate that lurches ahead and settles back
      // over a few frames — a blurred second pull, the bar whipping on the
      // sleeve — passes the short window with the same shift a dropped field
      // would, and the first real footage had exactly that. So the shift is
      // measured again on a later window; a step gives the same answer there,
      // a transient does not, and a transient is treated as the one-frame
      // spike its first frame is.
      const later: number[] = [];
      for (let k = i + CHECK_AFTER + 1; k <= i + 2 * CHECK_AFTER + 1; k++) if (k < n) later.push(k);
      const confirm = later.length >= CHECK_AFTER ? fitJoint(work, before, later, work[i].t, dt) : null;
      if (!confirm || Math.abs(confirm.shift - stepShift) > MIN_SHIFT_FRAMES) stepShift = 0;
    }

    if (Math.abs(stepShift) >= MIN_SHIFT_FRAMES) {
      // A step: everything from here on moves together.
      for (let k = i; k < n; k++) work[k] = { ...work[k], t: work[k].t + stepShift * dt };
      repairs.push({ index: i, t: points[i].t, action: 'stepped', shiftFrames: stepShift, stepChangePx: change });
      // The suspect itself may sit off the step as well — a blurred plate the
      // tracker placed a little ahead — or nowhere on the curve at all.
      if (own === null) {
        dropped.add(i);
        repairs.push({ index: i, t: points[i].t, action: 'dropped', shiftFrames: 0, stepChangePx: change });
      } else if (Math.abs(own - stepShift) >= MIN_SHIFT_FRAMES) {
        work[i] = { ...work[i], t: points[i].t + own * dt };
        repairs.push({ index: i, t: points[i].t, action: 'retimed', shiftFrames: own, stepChangePx: change });
      }
      continue;
    }

    // The frames after sit on the old curve: only the suspect is off.
    if (own === null) {
      dropped.add(i);
      repairs.push({ index: i, t: points[i].t, action: 'dropped', shiftFrames: 0, stepChangePx: change });
    } else if (Math.abs(own) >= MIN_SHIFT_FRAMES) {
      work[i] = { ...work[i], t: points[i].t + own * dt };
      repairs.push({ index: i, t: points[i].t, action: 'retimed', shiftFrames: own, stepChangePx: change });
    }
    // The step out of a repaired spike is what would flag its neighbour.
    i += 1;
  }

  // Two samples re-timed onto (nearly) the same instant say the same thing
  // twice; the resampler would get a zero-length span. Keep the first.
  const kept: TrackPoint[] = [];
  work.forEach((p, i) => {
    if (dropped.has(i)) return;
    const last = kept[kept.length - 1];
    if (last && p.t - last.t < 0.25 * dt) {
      dropped.add(i);
      repairs.push({ index: i, t: points[i].t, action: 'dropped', shiftFrames: 0, stepChangePx: 0 });
      return;
    }
    kept.push(p);
  });
  kept.sort((a, b) => a.t - b.t);
  return { points: kept, repairs, dt };
}

/** A quadratic in (t − t0)/dt for x and for y, with the scatter of the frames
 *  it was fitted through — the yardstick for "on the curve". */
interface Curve {
  t0: number;
  fx: Quadratic;
  fy: Quadratic;
  tolerancePx: number;
}

/** Quadratics in x and y over frame-unit times, with their rms residual. */
function fitCurve(ts: readonly number[], xs: readonly number[], ys: readonly number[]): { fx: Quadratic; fy: Quadratic; rms: number } | null {
  const fx = quadraticFit(ts, xs);
  const fy = quadraticFit(ts, ys);
  if (!fx || !fy) return null;
  let residual = 0;
  for (let k = 0; k < ts.length; k++) {
    residual += Math.hypot(evalQuadratic(fx, ts[k]) - xs[k], evalQuadratic(fy, ts[k]) - ys[k]) ** 2;
  }
  return { fx, fy, rms: Math.sqrt(residual / ts.length) };
}

/**
 * The curve through the frames before and after a suspect, with the frames
 * after slid in time by whatever makes the two sides one smooth curve. Null
 * when no slide within the window does — the sides are not one motion.
 *
 * Tolerance comes from the frames before on their own: their scatter is the
 * track's jitter, and the joint fit must be as good as that, with a floor of
 * one pixel so a clean synthetic track does not reject its own repair.
 */
function fitJoint(
  points: readonly TrackPoint[],
  before: readonly number[],
  after: readonly number[],
  t0: number,
  dt: number,
): { curve: Curve; shift: number } | null {
  const tb = before.map(k => (points[k].t - t0) / dt);
  const xb = before.map(k => points[k].x);
  const yb = before.map(k => points[k].y);
  const own = fitCurve(tb, xb, yb);
  if (!own) return null;
  const tolerancePx = Math.max(1, 3 * own.rms);

  const ta = after.map(k => (points[k].t - t0) / dt);
  const xs = [...xb, ...after.map(k => points[k].x)];
  const ys = [...yb, ...after.map(k => points[k].y)];
  let best: { rms: number; shift: number; fx: Quadratic; fy: Quadratic } | null = null;
  const steps = 150;
  for (let s = -steps; s <= steps; s++) {
    const shift = (s / steps) * MAX_SHIFT_FRAMES;
    const fit = fitCurve([...tb, ...ta.map(t => t + shift)], xs, ys);
    if (fit && (!best || fit.rms < best.rms)) best = { ...fit, shift };
  }
  if (!best || best.rms > tolerancePx) return null;
  return { curve: { t0, fx: best.fx, fy: best.fy, tolerancePx }, shift: best.shift };
}

/** The shift, in frames, that puts `p` on the curve — or null when no shift
 *  within the window brings the curve within tolerance. */
function shiftOnto(curve: Curve, p: TrackPoint, dt: number): number | null {
  const base = (p.t - curve.t0) / dt;
  let best = { error: Infinity, shift: 0 };
  const steps = 150;
  for (let s = -steps; s <= steps; s++) {
    const shift = (s / steps) * MAX_SHIFT_FRAMES;
    const error = Math.hypot(
      evalQuadratic(curve.fx, base + shift) - p.x,
      evalQuadratic(curve.fy, base + shift) - p.y,
    );
    if (error < best.error) best = { error, shift };
  }
  return best.error <= curve.tolerancePx ? best.shift : null;
}

interface Quadratic {
  c0: number;
  c1: number;
  c2: number;
}

function evalQuadratic(q: Quadratic, t: number): number {
  return q.c0 + q.c1 * t + q.c2 * t * t;
}

/** Least-squares quadratic through (t, v) pairs by the normal equations —
 *  three unknowns, so a direct solve is both adequate and exact enough. */
function quadraticFit(t: readonly number[], v: readonly number[]): Quadratic | null {
  const n = t.length;
  if (n < 3) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
  for (let k = 0; k < n; k++) {
    const x = t[k];
    const x2 = x * x;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    r0 += v[k];
    r1 += v[k] * x;
    r2 += v[k] * x2;
  }
  const solved = solve3([
    [n, s1, s2, r0],
    [s1, s2, s3, r1],
    [s2, s3, s4, r2],
  ]);
  return solved ? { c0: solved[0], c1: solved[1], c2: solved[2] } : null;
}

/** Gaussian elimination with partial pivoting on an augmented 3×4 system. */
function solve3(m: number[][]): number[] | null {
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

function medianStep(points: readonly TrackPoint[]): number {
  if (points.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i].t - points[i - 1].t);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}
