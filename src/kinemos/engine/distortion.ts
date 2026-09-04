/**
 * distortion — the lens, as one number.
 *
 * Design §6.1's calibration ladder has three distortion tiers: assume it away
 * (the convention tier), look the phone up in a table (the model tier), or
 * measure it (the profile tier). This module is the arithmetic all three
 * share, and the reason the ladder is affordable at all: **KinEMOS tracks
 * points, never images.** A bar end is a point, a plate outline is four
 * points, and the numbers a coach reads are differences between points. So
 * nothing here has to undistort a picture — which is the expensive part, and
 * the part the shipped OpenCV build cannot do anyway (`undistortPoints`,
 * `calibrateCamera` and `findChessboardCorners` are all absent from it). A
 * few dozen lines of pure arithmetic cover the whole ladder.
 *
 * **The model is Fitzgibbon's division model with a single parameter.**
 *
 *     r_undistorted = r_distorted / (1 + k1 · r_distorted²)
 *
 * with radii measured from the distortion centre and normalised by half the
 * image diagonal, so k1 is dimensionless and means the same thing at 720p as
 * at 4K. Two reasons for this model over the Brown–Conrady polynomial every
 * calibration textbook starts with:
 *
 *   1. **It inverts in closed form, in the direction we need.** Undistorting
 *      a point is a divide. Brown–Conrady undistorts by iteration, which is
 *      fine offline and silly for a per-frame path.
 *   2. **One parameter is all this footage can support.** The distortion left
 *      on a modern phone's main lens after its own ISP correction is small
 *      and almost purely radial; fitting k2 and k3 to a gym clip fits noise.
 *      Where the coach shoots ultrawide it is not small, and k1 still carries
 *      most of it.
 *
 * Sign convention: **k1 < 0 is barrel** (the usual for a wide phone lens —
 * straight lines bow outward, and undistorting pushes points away from the
 * centre); k1 > 0 is pincushion. k1 = 0 is the convention tier, and is what
 * every analysis uses until something better is measured.
 *
 * Engine purity: numbers in, numbers out. No DOM, no OpenCV, no EMOS imports.
 */
import type { PlateEllipse, PxPoint } from './calibration';

/**
 * A lens, as KinEMOS models it. The centre is in display-space pixels and
 * defaults to the middle of the frame — a real principal point sits within a
 * per cent or two of it, and the difference is far below what a gym clip can
 * resolve.
 */
export interface DistortionModel {
  k1: number;
  /** Distortion centre, display-space px. */
  cx: number;
  cy: number;
  /** Half the image diagonal, px: what radii are normalised by. */
  scalePx: number;
}

/** Where a model came from. Mirrors `kinemos_calibrations.distortion_source`
 *  and design §6.1's three tiers. */
export type DistortionSource = 'none' | 'model' | 'profile';

/** The identity lens for a frame — the convention tier, stated rather than
 *  implied. */
export function noDistortion(width: number, height: number): DistortionModel {
  return { k1: 0, cx: width / 2, cy: height / 2, scalePx: Math.hypot(width, height) / 2 };
}

/** A model for a frame of this size with this k1. */
export function distortionFor(width: number, height: number, k1: number): DistortionModel {
  return { ...noDistortion(width, height), k1 };
}

/**
 * Where a point really is, given the lens that recorded it. The identity when
 * k1 is zero, so callers need no branch of their own.
 */
export function undistortPoint(model: DistortionModel, p: PxPoint): PxPoint {
  if (!model.k1) return p;
  const dx = (p.x - model.cx) / model.scalePx;
  const dy = (p.y - model.cy) / model.scalePx;
  const factor = 1 / (1 + model.k1 * (dx * dx + dy * dy));
  return { x: model.cx + dx * factor * model.scalePx, y: model.cy + dy * factor * model.scalePx };
}

export function undistortPoints<T extends PxPoint>(model: DistortionModel, points: readonly T[]): T[] {
  if (!model.k1) return [...points];
  return points.map(p => ({ ...p, ...undistortPoint(model, p) }));
}

/**
 * The inverse: where the lens would have put a point that truly sits here.
 * Needed to draw a corrected outline back onto the frame the coach is
 * looking at. Closed form — the division model's quadratic — with the root
 * that keeps the point on its own side of the centre.
 */
export function distortPoint(model: DistortionModel, p: PxPoint): PxPoint {
  if (!model.k1) return p;
  const dx = (p.x - model.cx) / model.scalePx;
  const dy = (p.y - model.cy) / model.scalePx;
  const ru = Math.hypot(dx, dy);
  if (ru < 1e-9) return p;
  const disc = 1 - 4 * model.k1 * ru * ru;
  // Past the fold the model stops being invertible; the point is beyond
  // anything a real lens produced, so it is left where it is rather than
  // moved somewhere arbitrary.
  if (disc < 0) return p;
  const rd = (1 - Math.sqrt(disc)) / (2 * model.k1 * ru);
  const factor = rd / ru;
  return { x: model.cx + dx * factor * model.scalePx, y: model.cy + dy * factor * model.scalePx };
}

/**
 * A plate outline as it would look through a corrected lens.
 *
 * The outline is not a point, so it cannot simply be moved: distortion
 * changes its size, and its size IS the scale every measurement rests on. So
 * the four axis extremes are undistorted and the ellipse refitted from them
 * — the centre from the two midpoints, each semi-axis from its own pair.
 * Over a plate-sized patch the distortion is very nearly linear, which is
 * what makes this faithful rather than merely convenient.
 */
export function undistortEllipse(model: DistortionModel, ellipse: PlateEllipse): PlateEllipse {
  if (!model.k1) return ellipse;
  const phi = (ellipse.tiltDeg * Math.PI) / 180;
  // `up` along the major axis, `right` across it — the stage's own convention.
  const up = { x: Math.sin(phi), y: -Math.cos(phi) };
  const right = { x: Math.cos(phi), y: Math.sin(phi) };
  const at = (dir: { x: number; y: number }, r: number) =>
    undistortPoint(model, { x: ellipse.cx + dir.x * r, y: ellipse.cy + dir.y * r });

  const top = at(up, ellipse.semiMajorPx);
  const bottom = at(up, -ellipse.semiMajorPx);
  const left = at(right, -ellipse.semiMinorPx);
  const rightPt = at(right, ellipse.semiMinorPx);

  const cx = (top.x + bottom.x + left.x + rightPt.x) / 4;
  const cy = (top.y + bottom.y + left.y + rightPt.y) / 4;
  const semiMajorPx = Math.hypot(top.x - bottom.x, top.y - bottom.y) / 2;
  const semiMinorPx = Math.hypot(rightPt.x - left.x, rightPt.y - left.y) / 2;
  // The tilt is re-read from the undistorted major axis: correcting a lens
  // rotates the outline slightly when it sits off-centre.
  const tiltDeg = (Math.atan2(top.x - bottom.x, -(top.y - bottom.y)) * 180) / Math.PI;
  return { cx, cy, semiMajorPx, semiMinorPx, tiltDeg };
}

/**
 * RMS distance of a chain of points from the straight line that best fits
 * them, in pixels. Total least squares — the perpendicular fit — because a
 * vertical rack upright has no slope in the y-on-x sense and would break an
 * ordinary regression.
 *
 * This is the whole of the plumb-line principle: a straight edge in the gym
 * is straight in the world, so whatever k1 makes the most edges straightest
 * is the lens.
 */
export function straightnessResidualPx(points: readonly PxPoint[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Smaller eigenvalue of the scatter matrix is the summed squared distance
  // from the best-fit line.
  const half = (sxx + syy) / 2;
  const diff = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const smaller = Math.max(0, half - diff);
  return Math.sqrt(smaller / n);
}

/** How straight a set of edge chains is under a given lens: the RMS residual
 *  over all of them, weighted by length, in pixels. The quantity the fit
 *  minimises. */
export function totalStraightness(model: DistortionModel, chains: readonly (readonly PxPoint[])[]): number {
  let weighted = 0;
  let total = 0;
  for (const chain of chains) {
    if (chain.length < 3) continue;
    const residual = straightnessResidualPx(undistortPoints(model, chain));
    weighted += residual * residual * chain.length;
    total += chain.length;
  }
  return total === 0 ? 0 : Math.sqrt(weighted / total);
}

/** Bounds of the search. Beyond ±0,35 the division model is no longer
 *  describing a camera anyone films a lift with, and a fit that runs to the
 *  edge is a fit that failed. */
export const K1_LIMIT = 0.35;

/** A lens worth finding: about what an uncorrected phone wide-angle does.
 *  The scale the sensitivity probe asks its question at. */
export const K1_TYPICAL = 0.12;

/**
 * Whether these chains could tell a lens from no lens at all.
 *
 * The measurement that forced this function into existence: on a 576×1024
 * phone clip the gym gave 47 straight edges, but their median span was
 * 120 px, and bending them by a k1 of −0,12 moved the pooled residual from
 * 0,746 px to 0,744. The bow a real lens puts on a short edge near the frame
 * centre is a fiftieth of the noise on the edge itself. A fit on that data
 * refuses — correctly — but the REASON matters: "no correction helps" would
 * read as "this lens is clean" when the truth is "these edges cannot tell",
 * and the first is a claim the data does not support.
 *
 * So before believing a refusal, ask what a typical lens WOULD have done to
 * these chains. Returned as a share of the uncorrected residual: near zero
 * means the question is unanswerable here, whatever the answer.
 */
export function probeSensitivity(
  chains: readonly (readonly PxPoint[])[],
  width: number,
  height: number,
  probeK1 = K1_TYPICAL,
): number {
  const base = totalStraightness(distortionFor(width, height, 0), chains);
  const up = totalStraightness(distortionFor(width, height, probeK1), chains);
  const down = totalStraightness(distortionFor(width, height, -probeK1), chains);
  // Against the edges' own scatter, but never against less than the noise
  // floor: an edge detector marks whole pixels, so no edge is located better
  // than a fraction of one however clean the line is. Dividing by a residual
  // of nearly zero — which drawn, noiseless test data really does produce —
  // would call an immeasurably small bow infinitely informative.
  return Math.max(Math.abs(up - base), Math.abs(down - base)) / Math.max(base, EDGE_NOISE_FLOOR_PX);
}

/** How well an edge detector can place an edge, px. Canny marks whole
 *  pixels; sub-pixel interpolation gets to roughly a tenth. */
export const EDGE_NOISE_FLOOR_PX = 0.1;

/** Least sensitivity at which a refusal means anything about the lens. */
export const MIN_SENSITIVITY = 0.15;

export interface DistortionFit {
  model: DistortionModel;
  /** Straightness before and after, px. The pair is the evidence: a fit that
   *  does not improve on k1 = 0 is not believed. */
  residualBeforePx: number;
  residualAfterPx: number;
  /** Share of the residual the fit removed, 0–1. */
  improvement: number;
  chains: number;
  /** How many edge points went into it. */
  points: number;
}

/**
 * The k1 that makes a frame's straight edges straightest.
 *
 * Golden-section search: the residual is smooth and unimodal in k1 over any
 * sane range (one parameter, a sum of squares), so a bracketed line search
 * beats an optimiser and cannot wander.
 *
 * Null when there is too little to fit on — fewer than three usable chains,
 * or an improvement too small to be anything but noise. A refused fit is the
 * right answer for a gym with nothing straight in shot, and far better than
 * a confident k1 fitted to three curved cables.
 */
export function fitDistortion(
  chains: readonly (readonly PxPoint[])[],
  width: number,
  height: number,
  options: { minChains?: number; minImprovement?: number; minSensitivity?: number } = {},
): DistortionFit | null {
  const minChains = options.minChains ?? 3;
  const minImprovement = options.minImprovement ?? 0.08;
  const minSensitivity = options.minSensitivity ?? MIN_SENSITIVITY;
  const usable = chains.filter(c => c.length >= 8);
  if (usable.length < minChains) return null;

  const residualAt = (k1: number) => totalStraightness(distortionFor(width, height, k1), usable);
  const before = residualAt(0);
  if (!(before > 0)) return null;
  // Edges too short, too central or too noisy to register a lens at all: no
  // number fitted to them would mean anything.
  if (probeSensitivity(usable, width, height) < minSensitivity) return null;

  // Golden-section over [-K1_LIMIT, K1_LIMIT].
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = -K1_LIMIT;
  let hi = K1_LIMIT;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = residualAt(c);
  let fd = residualAt(d);
  for (let i = 0; i < 60 && hi - lo > 1e-5; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = residualAt(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = residualAt(d);
    }
  }
  const k1 = (lo + hi) / 2;
  const after = residualAt(k1);
  const improvement = (before - after) / before;
  if (improvement < minImprovement) return null;
  // A fit pinned to the edge of the range is the search running away, not a
  // lens.
  if (Math.abs(k1) > K1_LIMIT * 0.98) return null;
  return {
    model: distortionFor(width, height, k1),
    residualBeforePx: before,
    residualAfterPx: after,
    improvement,
    chains: usable.length,
    points: usable.reduce((n, c) => n + c.length, 0),
  };
}
