/**
 * stabilise — taking the camera's motion out of the bar's.
 *
 * A handheld phone moves. Every pixel of that motion lands in the track as
 * bar motion, and the grade knows it: `camera: 'handheld'` is worth about half
 * the error budget (engine/grade.ts). The stabiliser estimates the camera's
 * motion frame to frame from the BACKGROUND — corners on the wall, the rack,
 * the platform — and maps every tracked point back into the anchor frame's
 * coordinates, so the bar path is measured against the gym rather than
 * against the phone.
 *
 * Only the points are corrected, never the video. Re-rendering a stabilised
 * clip is a P4 luxury; correcting a few hundred coordinates is a few
 * milliseconds and leaves the footage the coach sees untouched.
 *
 * The model is a SIMILARITY — translation, rotation and one scale — from
 * each frame to the ANCHOR frame, fitted with RANSAC so the lifter and the
 * bar, which move on their own, are outliers rather than signal. A similarity
 * rather than a full affine because a phone in a hand does translate, roll
 * and move nearer or further, but it does not shear, and the two degrees of
 * freedom a full affine adds are two more ways for a handful of blurred
 * corners to be fitted wrongly. Corners inside the plate's own circle are excluded up
 * front for the same reason. Corners are carried by optical flow one frame
 * at a time, because consecutive frames overlap almost entirely and a frame
 * two seconds away often does not — but the fit is always against the
 * anchor's coordinates, never chained, because chaining compounds each fit's
 * error into exactly the drift the stabiliser exists to remove.
 */
import type { FrameSource } from '../engine/tracker';
import { loadOpenCv, matFromGray, type CV, type GrayLike } from './opencv';

/** Row-major 2×3 affine mapping frame coordinates → anchor coordinates. */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export interface CameraMotion {
  index: number;
  /** frame → anchor. */
  toAnchor: Affine;
  /** Background corners the frame-to-frame fit stood on. Low means the
   *  estimate is a guess; zero means the identity was carried forward. */
  inliers: number;
}

export interface StabiliseOptions {
  /** Where the plate was on each frame, to keep its corners out of the fit.
   *  Index → circle. */
  exclude?: (index: number) => { x: number; y: number; r: number } | null;
  /** Corners to try per frame. */
  maxCorners?: number;
  /** Minimum spacing between corners, px. */
  minDistancePx?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Estimate the camera's motion on every frame relative to the anchor frame.
 */
export async function estimateCameraMotion(
  source: FrameSource,
  anchorIndex: number,
  options: StabiliseOptions = {},
): Promise<CameraMotion[]> {
  const cv = await loadOpenCv();
  const motions = new Map<number, CameraMotion>();
  motions.set(anchorIndex, { index: anchorIndex, toAnchor: IDENTITY, inliers: 0 });
  const total = source.frameCount;
  const maxCorners = options.maxCorners ?? 160;
  const minDistance = options.minDistancePx ?? 10;
  let done = 1;

  for (const direction of [1, -1] as const) {
    // The corners are carried frame to frame by optical flow, which is
    // accurate over one frame, but the AFFINE is always fitted between where
    // those corners were in the ANCHOR frame and where they are now. Chaining
    // the fits instead would compound each one's error: over a 3 s clip that
    // is several pixels of drift, which is what the stabiliser exists to
    // remove. When corners are lost the set is re-seeded, and the new ones
    // are given anchor coordinates through the current estimate — the only
    // point where a little drift can re-enter.
    let prevGray = await source.getGray(anchorIndex);
    let toAnchor: Affine = IDENTITY;
    let anchorPts: Array<[number, number]> = [];
    let curPts: Array<[number, number]> = [];
    const seed = (gray: GrayLike, index: number) => {
      const fresh = pickCorners(cv, gray, options.exclude?.(index) ?? null, maxCorners, minDistance);
      curPts = fresh;
      anchorPts = fresh.map(([x, y]) => {
        const a = apply(toAnchor, x, y);
        return [a.x, a.y] as [number, number];
      });
    };
    seed(prevGray, anchorIndex);

    for (let i = anchorIndex + direction; i >= 0 && i < total; i += direction) {
      const gray = await source.getGray(i);
      let fit: { affine: Affine; inliers: number } | null = null;
      if (curPts.length >= 6) {
        const flowed = flow(cv, prevGray, gray, curPts);
        const keptAnchor: Array<[number, number]> = [];
        const keptCur: Array<[number, number]> = [];
        flowed.forEach((q, k) => {
          if (q) {
            keptAnchor.push(anchorPts[k]);
            keptCur.push(q);
          }
        });
        anchorPts = keptAnchor;
        curPts = keptCur;
        fit = fitSimilarity(curPts, anchorPts);
      }
      // A hand does not jump: a fit that moves the frame centre more than a
      // few pixels beyond where the previous frame put it is a wrong fit, not
      // a fast hand. Keep the previous estimate and start the corners afresh.
      if (fit && !plausibleStep(toAnchor, fit.affine, gray.width, gray.height)) fit = null;
      if (fit) toAnchor = fit.affine;
      motions.set(i, { index: i, toAnchor, inliers: fit?.inliers ?? 0 });

      // Re-seed once the set has thinned or the fit went weak.
      if (!fit || curPts.length < 40 || fit.inliers < 12) seed(gray, i);
      prevGray = gray;
      done += 1;
      options.onProgress?.(done, total);
    }
  }

  return [...motions.values()].sort((a, b) => a.index - b.index);
}

/** Map tracked points into the anchor frame's coordinates. A point on a frame
 *  with no motion estimate is left as it is. */
export function stabilisePoints<P extends { index: number; x: number; y: number }>(
  points: readonly P[],
  motions: readonly CameraMotion[],
): P[] {
  const byIndex = new Map(motions.map(m => [m.index, m.toAnchor]));
  return points.map(p => {
    const m = byIndex.get(p.index);
    if (!m) return p;
    const [a, b, c, d, e, f] = m;
    return { ...p, x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f };
  });
}

/** How much the camera moved, for the interface to say. */
export function motionSummary(motions: readonly CameraMotion[]): {
  maxShiftPx: number;
  rmsShiftPx: number;
  weakFrames: number;
} {
  let max = 0;
  let sum = 0;
  let weak = 0;
  for (const m of motions) {
    const shift = Math.hypot(m.toAnchor[2], m.toAnchor[5]);
    max = Math.max(max, shift);
    sum += shift * shift;
    if (m.inliers > 0 && m.inliers < 12) weak++;
  }
  return { maxShiftPx: max, rmsShiftPx: Math.sqrt(sum / Math.max(1, motions.length)), weakFrames: weak };
}

// ── Frame to frame ──────────────────────────────────────────────────────────

/** Where each point went in the next frame, by pyramidal Lucas–Kanade; null
 *  where the flow lost it or it left the frame. */
function flow(
  cv: CV,
  prev: GrayLike,
  next: GrayLike,
  pts: Array<[number, number]>,
): Array<[number, number] | null> {
  const prevMat = matFromGray(cv, prev);
  const nextMat = matFromGray(cv, next);
  const p0 = cv.matFromArray(pts.length, 1, cv.CV_32FC2, Float32Array.from(pts.flat()));
  const p1 = new cv.Mat();
  const status = new cv.Mat();
  const err = new cv.Mat();
  try {
    cv.calcOpticalFlowPyrLK(prevMat, nextMat, p0, p1, status, err, new cv.Size(21, 21), 3);
    const out: Array<[number, number] | null> = [];
    for (let i = 0; i < pts.length; i++) {
      const x = p1.data32F[i * 2];
      const y = p1.data32F[i * 2 + 1];
      const inside = x >= 4 && y >= 4 && x < next.width - 4 && y < next.height - 4;
      // LK's error is the mean intensity difference over the window; a
      // corner that landed on something else reads high.
      const good = status.data[i] === 1 && err.data32F[i] < 24;
      out.push(good && inside ? [x, y] : null);
    }
    return out;
  } finally {
    prevMat.delete();
    nextMat.delete();
    p0.delete();
    p1.delete();
    status.delete();
    err.delete();
  }
}

/**
 * The similarity mapping `from` → `to`: RANSAC over two-point samples, then a
 * closed-form least-squares refit over the inliers. Null below six inliers.
 * Deterministic — a fixed pseudo-random sequence — so the same clip
 * stabilises the same way twice.
 */
function fitSimilarity(
  from: Array<[number, number]>,
  to: Array<[number, number]>,
): { affine: Affine; inliers: number } | null {
  const n = from.length;
  if (n < 6) return null;
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const THRESH = 1.5;
  let bestInliers: number[] = [];
  const iterations = Math.min(400, n * 8);
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rand() * n);
    let j = Math.floor(rand() * n);
    if (j === i) j = (j + 1) % n;
    const m = similarityFromTwo(from[i], from[j], to[i], to[j]);
    if (!m) continue;
    const inl: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = apply(m, from[k][0], from[k][1]);
      if (Math.hypot(p.x - to[k][0], p.y - to[k][1]) <= THRESH) inl.push(k);
    }
    if (inl.length > bestInliers.length) bestInliers = inl;
    if (bestInliers.length > n * 0.9) break;
  }
  if (bestInliers.length < 6) return null;
  const refit = similarityLeastSquares(bestInliers.map(k => from[k]), bestInliers.map(k => to[k]));
  if (!refit) return null;
  // One more inlier pass against the refit, and a final refit — the usual
  // RANSAC polish.
  const inl2: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = apply(refit, from[k][0], from[k][1]);
    if (Math.hypot(p.x - to[k][0], p.y - to[k][1]) <= THRESH) inl2.push(k);
  }
  const final = inl2.length >= 6 ? similarityLeastSquares(inl2.map(k => from[k]), inl2.map(k => to[k])) : null;
  return final ? { affine: final, inliers: inl2.length } : { affine: refit, inliers: bestInliers.length };
}

/** The similarity taking two points onto two others. */
function similarityFromTwo(
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): Affine | null {
  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const la = dax * dax + day * day;
  if (la < 1e-6) return null;
  // Complex division (dbx + i dby) / (dax + i day) = s·e^{iθ}.
  const c = (dbx * dax + dby * day) / la;
  const d = (dby * dax - dbx * day) / la;
  const tx = b0[0] - (c * a0[0] - d * a0[1]);
  const ty = b0[1] - (d * a0[0] + c * a0[1]);
  return [c, -d, tx, d, c, ty];
}

/** Least-squares similarity over matched points (Umeyama without the
 *  reflection case, which a camera cannot produce). */
function similarityLeastSquares(
  from: Array<[number, number]>,
  to: Array<[number, number]>,
): Affine | null {
  const n = from.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  let nx = 0;
  let ny = 0;
  for (let k = 0; k < n; k++) {
    mx += from[k][0];
    my += from[k][1];
    nx += to[k][0];
    ny += to[k][1];
  }
  mx /= n;
  my /= n;
  nx /= n;
  ny /= n;
  let sxx = 0;
  let sxy = 0;
  let varA = 0;
  for (let k = 0; k < n; k++) {
    const ax = from[k][0] - mx;
    const ay = from[k][1] - my;
    const bx = to[k][0] - nx;
    const by = to[k][1] - ny;
    sxx += ax * bx + ay * by;
    sxy += ax * by - ay * bx;
    varA += ax * ax + ay * ay;
  }
  if (varA < 1e-9) return null;
  const c = sxx / varA;
  const d = sxy / varA;
  const tx = nx - (c * mx - d * my);
  const ty = ny - (d * mx + c * my);
  return [c, -d, tx, d, c, ty];
}

/** Whether going from the previous frame's estimate to this one is a motion
 *  a hand could make in a fiftieth of a second. */
function plausibleStep(prev: Affine, next: Affine, width: number, height: number): boolean {
  const cx = width / 2;
  const cy = height / 2;
  const a = apply(prev, cx, cy);
  const b = apply(next, cx, cy);
  if (Math.hypot(a.x - b.x, a.y - b.y) > 24) return false;
  const rotPrev = Math.atan2(prev[3], prev[0]);
  const rotNext = Math.atan2(next[3], next[0]);
  if (Math.abs(rotNext - rotPrev) > (4 * Math.PI) / 180) return false;
  const scalePrev = Math.hypot(prev[0], prev[3]);
  const scaleNext = Math.hypot(next[0], next[3]);
  return Math.abs(scaleNext / Math.max(scalePrev, 1e-6) - 1) < 0.06;
}

/**
 * Strong, well-spread corners outside the plate — goodFeaturesToTrack by hand,
 * since this OpenCV.js build does not export it: the minimum-eigenvalue
 * response, then greedy non-maximum picking with a spacing.
 */
function pickCorners(
  cv: CV,
  gray: GrayLike,
  exclude: { x: number; y: number; r: number } | null,
  maxCorners: number,
  minDistance: number,
): Array<[number, number]> {
  const src = matFromGray(cv, gray);
  const resp = new cv.Mat();
  try {
    cv.cornerMinEigenVal(src, resp, 3, 3, cv.BORDER_DEFAULT);
    const data: Float32Array = resp.data32F;
    const w = gray.width;
    const h = gray.height;
    let max = 0;
    for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
    const threshold = max * 0.02;
    const margin = 8;
    const candidates: Array<{ x: number; y: number; v: number }> = [];
    for (let y = margin; y < h - margin; y++) {
      for (let x = margin; x < w - margin; x++) {
        const v = data[y * w + x];
        if (v < threshold) continue;
        // Local maximum in its 3×3.
        if (
          v < data[(y - 1) * w + x] || v < data[(y + 1) * w + x] ||
          v < data[y * w + x - 1] || v < data[y * w + x + 1]
        ) continue;
        if (exclude && Math.hypot(x - exclude.x, y - exclude.y) < exclude.r * 1.6) continue;
        candidates.push({ x, y, v });
      }
    }
    candidates.sort((a, b) => b.v - a.v);
    const out: Array<[number, number]> = [];
    const minD2 = minDistance * minDistance;
    for (const c of candidates) {
      if (out.length >= maxCorners) break;
      let ok = true;
      for (const [ox, oy] of out) {
        const dx = ox - c.x;
        const dy = oy - c.y;
        if (dx * dx + dy * dy < minD2) {
          ok = false;
          break;
        }
      }
      if (ok) out.push([c.x, c.y]);
    }
    return out;
  } finally {
    src.delete();
    resp.delete();
  }
}

// ── Affine algebra ──────────────────────────────────────────────────────────

/** first, then second: second ∘ first. */
export function compose(second: Affine, first: Affine): Affine {
  const [a, b, c, d, e, f] = second;
  const [g, h, i, j, k, l] = first;
  return [a * g + b * j, a * h + b * k, a * i + b * l + c, d * g + e * j, d * h + e * k, d * i + e * l + f];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const ia = e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] };
}
