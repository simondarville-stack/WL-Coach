/**
 * plate — finding the plate, and fitting its outline to the pixel.
 *
 * Two jobs the calibration ladder (design §6.1) wanted from the start:
 *
 *   - **Detection.** A plate is the one thing in a lifting clip that is
 *     reliably a large, high-contrast circle. A Hough circle transform over
 *     the expected radius range finds the candidates; the caller says which
 *     one it means (nearest to a click, or simply the strongest) and the
 *     coach confirms. One click becomes a glance.
 *   - **Refinement.** A coach dragging an outline lands within a pixel or two
 *     of the plate's edge. The calibration's scale is that outline's major
 *     axis, so a pixel of error on a 44 px plate is 2 % on every number. Edge
 *     detection in a ring around the outline, then a least-squares ellipse
 *     through the edge points, puts the outline on the real edge at sub-pixel
 *     — and reports how much of the circumference the fit actually stood on,
 *     so a half-occluded plate is not passed off as a measurement.
 *
 * Output is the engine's own `PlateEllipse`, tilt in the engine's convention
 * (clockwise rotation of the major axis from image vertical), so nothing
 * downstream knows OpenCV was involved.
 */
import type { PlateEllipse } from '../engine/calibration';
import { loadOpenCv, matFromGray, type CV, type GrayLike } from './opencv';

export interface PlateCandidate {
  cx: number;
  cy: number;
  /** Radius the circle transform saw, px. */
  r: number;
  /** Fraction of the circumference with an edge under it, 0–1. */
  support: number;
}

export interface DetectPlateOptions {
  /** Plausible on-screen radii, px. The clip's frame height is a fair guide:
   *  a 45 cm plate is 4–20 % of a portrait frame's height. */
  minRadiusPx: number;
  maxRadiusPx: number;
  /** Prefer candidates near here — the coach's rough click, or the previous
   *  frame's plate. */
  near?: { x: number; y: number };
  /** How many to return, best first. */
  limit?: number;
}

/**
 * Circles in the image that could be a plate, best first.
 *
 * "Best" is edge support, not the Hough vote count: votes favour big circles
 * and busy backgrounds, while support asks the question a coach would — is
 * there actually an edge all the way round? With `near`, distance to the hint
 * breaks ties and rules out candidates more than a radius away.
 */
export async function detectPlates(
  gray: GrayLike,
  options: DetectPlateOptions,
): Promise<PlateCandidate[]> {
  const cv = await loadOpenCv();
  const src = matFromGray(cv, gray);
  const blurred = new cv.Mat();
  const circles = new cv.Mat();
  try {
    cv.GaussianBlur(src, blurred, new cv.Size(5, 5), 1.2, 1.2, cv.BORDER_DEFAULT);
    // HOUGH_GRADIENT_ALT, not HOUGH_GRADIENT. The classic method with a low
    // accumulator threshold (18) took the tab down on a busy gym frame — a
    // 1280 × 720 view of a hall with plates on every wall has ~80 000 edge
    // pixels, and the classic method sorts distances to all of them for
    // every candidate centre; at threshold 40 it survived, in 4,7 s, with
    // 427 circles. The ALT method (Yuen et al.'s "perfectness" test) found
    // 16 in 257 ms on the same frame (testset, 04/09/2026). `param2` is how
    // perfect a circle must be, 0–1; a second, looser pass runs when a strict
    // one finds nothing — a plate part hidden by the lifter's shin is still
    // a plate.
    const minDist = Math.max(8, options.minRadiusPx);
    const minR = Math.round(options.minRadiusPx);
    const maxR = Math.round(options.maxRadiusPx);
    for (const perfectness of [0.85, 0.7]) {
      cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT_ALT, 1.5, minDist, 300, perfectness, minR, maxR);
      if (circles.cols > 0) break;
    }
    const step = circles.channels();
    const found: PlateCandidate[] = [];
    for (let i = 0; i < circles.cols; i++) {
      const cx = circles.data32F[i * step];
      const cy = circles.data32F[i * step + 1];
      const r = circles.data32F[i * step + 2];
      if (options.near && Math.hypot(cx - options.near.x, cy - options.near.y) > r * 1.25 + 8) continue;
      found.push({ cx, cy, r, support: edgeSupport(gray, cx, cy, r, r, 0) });
    }
    const near = options.near;
    found.sort((a, b) => {
      if (near) {
        // Within the hint's reach, support decides; both far from it, distance does.
        const da = Math.hypot(a.cx - near.x, a.cy - near.y);
        const db = Math.hypot(b.cx - near.x, b.cy - near.y);
        if (Math.abs(da - db) > Math.max(a.r, b.r) * 0.5) return da - db;
      }
      return b.support - a.support;
    });
    return found.slice(0, options.limit ?? 5);
  } finally {
    src.delete();
    blurred.delete();
    circles.delete();
  }
}

export interface RefineResult {
  ellipse: PlateEllipse;
  /** Fraction of the circumference with an edge point on it, 0–1. Below ~0,6
   *  the plate is probably part hidden and the fit is worth a look. */
  support: number;
  /** How many edge points the final fit used. */
  points: number;
  /** RMS distance of the kept edge points from the outline, px. A round
   *  plate seen square-on fits its circle to under half a pixel; a fit that
   *  had to average two edges reads a pixel or more. */
  residualPx: number;
}

/**
 * Which of the edges round a plate is the plate.
 *
 * A bumper plate on a bar is not one edge but three, a few pixels apart:
 * the boundary of its FACE against whatever is behind it; outside that at the
 * top, the plate's own thickness — the rim of a cylinder seen slightly from
 * above while the bar is on the floor, a lighter crescent; outside that at the
 * bottom, its shadow. The 45 cm is the face. On the first real footage the
 * outermost edge per bin (the P3d default) read the shadow and the crescent
 * and made the plate 9 % bigger than it was; the strongest edge splits the
 * difference. The face is the largest edge the WHOLE circumference agrees
 * on: the crescent lives only in the top bins and the shadow only in the
 * bottom ones, so a fit through the outermost edge per bin, with the points
 * that sit outside it thrown out and the fit repeated until none do, settles
 * on the face — to 0,4 px RMS on the side clip — while a plate whose outer
 * rim really is its outermost edge all the way round keeps it
 * (docs/KINEMOS_ACCURACY_STUDY.md §6).
 */
export type EdgePick = 'face' | 'strongest' | 'outermost';

export interface RefineOptions {
  ringFraction?: number;
  pick?: EdgePick;
  /**
   * `circle` fits a circle — three parameters instead of five. For a plate a
   * coach knows to be round, filmed square-on, it is the right model: the
   * orientation a free ellipse would invent is gone and the radius is the
   * scale directly. `ellipse` (the default) is needed as soon as the camera
   * is off perpendicular, because then the plate really is an ellipse.
   */
  shape?: 'ellipse' | 'circle';
}

export const DEFAULT_EDGE_PICK: EdgePick = 'face';

/**
 * Snap an ellipse to the plate edge it is nearly on.
 *
 * Canny edges in a ring around the given outline, a direct least-squares fit
 * through them, then once more through only the points within a few pixels
 * of that first fit — the second pass drops the rim of a second plate, a
 * collar or a bar sleeve that the ring caught — and a last pass through the
 * intensity itself at sub-pixel, with points more than 1,5 px off the outline
 * rejected. Null when there are not enough edge points to fit anything,
 * which is itself the answer.
 */
export async function refinePlateEllipse(
  gray: GrayLike,
  guess: PlateEllipse,
  options: RefineOptions = {},
): Promise<RefineResult | null> {
  const pick = options.pick ?? DEFAULT_EDGE_PICK;
  const shape = options.shape ?? 'ellipse';
  const cv = await loadOpenCv();
  const ring = options.ringFraction ?? 0.22;
  const src = matFromGray(cv, gray);
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  try {
    cv.GaussianBlur(src, blurred, new cv.Size(3, 3), 0.8, 0.8, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 40, 120, 3, false);

    // A plate's rim is a few pixels wide and Canny finds both of its edges.
    // The plate's DIAMETER is the outer one, so in every angular bin round
    // the guess only the outermost edge pixel within the ring is kept — a fit
    // through both edges would land between them, a pixel or two small.
    //
    // Three passes. The first fits through everything in the ring — both rim
    // edges and whatever texture the ring caught — which is biased small but
    // finds the centre. The next two work in a tight band round the previous
    // fit, keeping only edge pixels with real contrast across them and, per
    // bin, the outermost: the band excludes texture beyond the rim, the
    // contrast test excludes texture inside it, and "outermost" chooses the
    // rim's outer edge over its inner one.
    const fitPoints = (points: Array<[number, number]>): PlateEllipse | null =>
      shape === 'circle' ? fitCircleFromPoints(points) : fitEllipseFromPoints(cv, points);

    let pts = edgePointsNear(edges, gray, guess, ring, 0);
    if (pts.length < 12) return null;
    let fit = fitPoints(pts);
    if (!fit) return null;

    for (let pass = 0; pass < 2; pass++) {
      const tight = Math.max(0.06, 2.5 / Math.max(fit.semiMajorPx, 1));
      let next = perBin(edgePointsNear(edges, gray, fit, tight, 18), fit, pick, gray);
      if (next.length < 12) break;
      let fitNext = fitPoints(next);
      if (!fitNext) break;
      if (pick === 'face') {
        // The largest edge the whole circumference agrees on. A free ellipse
        // has enough freedom to absorb a partial arc of shadow or rim
        // thickness as elongation, so the agreement is first settled with a
        // CIRCLE — three parameters cannot bend round an arc — by dropping
        // the points that sit outside it and fitting again until none do.
        // The plate is round, so its true outline lies within a few per cent
        // of that circle at any angle the model covers (cos 30° = 0,87):
        // only points in that band go to the requested shape.
        let circle = fitCircleFromPoints(next);
        let ring = next;
        for (let round = 0; circle && round < 4; round++) {
          const current = circle;
          const inside = ring.filter(p => distanceFromOutline(current, p) <= 1);
          if (inside.length === ring.length || inside.length < Math.max(12, ring.length * 0.5)) break;
          const again = fitCircleFromPoints(inside);
          if (!again) break;
          ring = inside;
          circle = again;
        }
        if (circle) {
          const band = Math.max(1.5, 0.08 * circle.semiMajorPx);
          const c = circle;
          const agreed = next.filter(p => Math.abs(distanceFromOutline(c, p)) <= band);
          const fitAgreed = agreed.length >= 12 ? fitPoints(agreed) : null;
          if (fitAgreed) {
            next = agreed;
            fitNext = fitAgreed;
          }
        }
      }
      fit = fitNext;
      pts = next;
    }

    // Canny marks whole pixels. The last word goes to the intensity itself:
    // along the radial through each kept point, the outline is where the
    // intensity changes fastest, found to a fraction of a pixel from a
    // parabola through the gradient peak. This is what "sub-pixel" means
    // here, and it takes about a third of a pixel of bias out of the axes.
    // Points the sub-pixel step leaves more than 1,5 px off the outline are
    // another edge — the shadow's, a collar's — and are dropped before the
    // final fit.
    const around: PlateEllipse = fit;
    let refined = pts.map(p => subpixelAlongRadial(gray, p, around)).filter((p): p is [number, number] => p !== null);
    if (refined.length >= 12) {
      const fitSub = fitPoints(refined);
      if (fitSub) {
        const kept = refined.filter(p => Math.abs(distanceFromOutline(fitSub, p)) <= 1.5);
        const fitKept = kept.length >= 12 && kept.length < refined.length ? fitPoints(kept) : null;
        if (fitKept) {
          fit = fitKept;
          refined = kept;
        } else {
          fit = fitSub;
        }
        pts = refined;
      }
    }
    let sum = 0;
    for (const p of pts) sum += distanceFromOutline(fit, p) ** 2;
    return {
      ellipse: fit,
      support: edgeSupport(gray, fit.cx, fit.cy, fit.semiMajorPx, fit.semiMinorPx, fit.tiltDeg, edges),
      points: pts.length,
      residualPx: pts.length > 0 ? Math.sqrt(sum / pts.length) : 0,
    };
  } finally {
    src.delete();
    blurred.delete();
    edges.delete();
  }
}

/**
 * Detect and refine in one go: the zero-click calibration. Returns the best
 * candidate's snapped outline, or null when nothing plate-like is there.
 */
export async function findPlate(
  gray: GrayLike,
  options: DetectPlateOptions & RefineOptions,
): Promise<(RefineResult & { candidate: PlateCandidate }) | null> {
  const candidates = await detectPlates(gray, { ...options, limit: 3 });
  for (const candidate of candidates) {
    const refined = await refinePlateEllipse(
      gray,
      { cx: candidate.cx, cy: candidate.cy, semiMajorPx: candidate.r, semiMinorPx: candidate.r, tiltDeg: 0 },
      { ringFraction: options.ringFraction, pick: options.pick, shape: options.shape },
    );
    if (refined && refined.support >= 0.4) return { ...refined, candidate };
  }
  return null;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** The engine's tilt: clockwise rotation of the major axis from image
 *  vertical. Unit vectors of the major (u) and minor (v) axes in image
 *  coordinates (y down). */
function axes(tiltDeg: number): { ux: number; uy: number; vx: number; vy: number } {
  const t = (tiltDeg * Math.PI) / 180;
  return { ux: -Math.sin(t), uy: Math.cos(t), vx: Math.cos(t), vy: Math.sin(t) };
}

/** Normalised radius of a point on an ellipse: 1 on the outline. */
function normRadius(e: PlateEllipse, x: number, y: number): number {
  const { ux, uy, vx, vy } = axes(e.tiltDeg);
  const dx = x - e.cx;
  const dy = y - e.cy;
  const u = dx * ux + dy * uy;
  const v = dx * vx + dy * vy;
  return Math.hypot(u / Math.max(e.semiMajorPx, 1e-6), v / Math.max(e.semiMinorPx, 1e-6));
}

/** Edge pixels whose normalised radius is within ±ring of 1 and, when
 *  `minContrast` is set, whose intensity changes by at least that much across
 *  the outline — the rim of a plate, not the grain of a wall. */
function edgePointsNear(
  edges: CV,
  gray: GrayLike,
  e: PlateEllipse,
  ring: number,
  minContrast: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const reach = Math.ceil(e.semiMajorPx * (1 + ring) + 2);
  const x0 = Math.max(0, Math.floor(e.cx - reach));
  const x1 = Math.min(edges.cols - 1, Math.ceil(e.cx + reach));
  const y0 = Math.max(0, Math.floor(e.cy - reach));
  const y1 = Math.min(edges.rows - 1, Math.ceil(e.cy + reach));
  const data: Uint8Array = edges.data;
  const cols: number = edges.cols;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[y * cols + x] === 0) continue;
      const nr = normRadius(e, x, y);
      if (Math.abs(nr - 1) > ring) continue;
      if (minContrast > 0 && gradientAcross(gray, x, y, e.cx, e.cy) < minContrast) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** In each of 72 angular bins about the ellipse centre, one edge point: the
 *  one with the largest normalised radius (`outermost`, and the starting set
 *  for `face`, which then rejects what the circumference does not agree on)
 *  or the one with the strongest contrast across it. See `EdgePick`. */
function perBin(
  pts: Array<[number, number]>,
  e: PlateEllipse,
  pick: EdgePick,
  gray: GrayLike,
): Array<[number, number]> {
  const BINS = 72;
  const best = new Array<{ p: [number, number]; score: number } | null>(BINS).fill(null);
  for (const p of pts) {
    const phi = Math.atan2(p[1] - e.cy, p[0] - e.cx);
    const bin = Math.floor(((phi + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
    const score = pick === 'strongest' ? gradientAcross(gray, p[0], p[1], e.cx, e.cy) : normRadius(e, p[0], p[1]);
    const cur = best[bin];
    if (!cur || score > cur.score) best[bin] = { p, score };
  }
  return best.filter((b): b is { p: [number, number]; score: number } => b !== null).map(b => b.p);
}

/** Signed distance of a point from the outline, px — negative inside. Exact
 *  for a circle; for an ellipse the radial distance, which is what the fits
 *  here need it for. */
function distanceFromOutline(e: PlateEllipse, p: [number, number]): number {
  const { ux, uy, vx, vy } = axes(e.tiltDeg);
  const dx = p[0] - e.cx;
  const dy = p[1] - e.cy;
  const u = dx * ux + dy * uy;
  const v = dx * vx + dy * vy;
  const nr = Math.hypot(u / Math.max(e.semiMajorPx, 1e-6), v / Math.max(e.semiMinorPx, 1e-6));
  if (!(nr > 0)) return -e.semiMinorPx;
  return Math.hypot(dx, dy) * (1 - 1 / nr);
}

/**
 * Algebraic least-squares circle (Kåsa): linear in (cx, cy, r² − cx² − cy²),
 * solved directly. Three unknowns, so it needs no OpenCV and cannot invent an
 * orientation. Returned as a `PlateEllipse` with equal axes and no tilt.
 */
function fitCircleFromPoints(pts: Array<[number, number]>): PlateEllipse | null {
  if (pts.length < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Normal equations for z = 2a·x + 2b·y + c.
  const m = [
    [2 * sxx, 2 * sxy, sx, sxz],
    [2 * sxy, 2 * syy, sy, syz],
    [2 * sx, 2 * sy, n, sz],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  const a = m[0][3] / m[0][0];
  const b = m[1][3] / m[1][1];
  const c = m[2][3] / m[2][2];
  const r2 = c + a * a + b * b;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  return { cx: a, cy: b, semiMajorPx: r, semiMinorPx: r, tiltDeg: 0 };
}

/** OpenCV's RotatedRect → the engine's ellipse and tilt convention. */
function fitEllipseFromPoints(cv: CV, pts: Array<[number, number]>): PlateEllipse | null {
  if (pts.length < 5) return null;
  const flat = new Float32Array(pts.length * 2);
  pts.forEach(([x, y], i) => {
    flat[i * 2] = x;
    flat[i * 2 + 1] = y;
  });
  const mat = cv.matFromArray(pts.length, 1, cv.CV_32FC2, flat);
  try {
    const rr = cv.fitEllipse(mat);
    const w: number = rr.size.width;
    const h: number = rr.size.height;
    if (!(w > 0 && h > 0) || !Number.isFinite(rr.angle)) return null;
    // `angle` is the rotation of the width axis from +x, clockwise on screen.
    const majorFromX = w >= h ? rr.angle : rr.angle + 90;
    let tilt = majorFromX - 90; // from vertical
    while (tilt > 90) tilt -= 180;
    while (tilt <= -90) tilt += 180;
    const semiMajorPx = Math.max(w, h) / 2;
    const semiMinorPx = Math.min(w, h) / 2;
    // A plate seen nearly head-on is a circle, and a circle has no major axis:
    // the fit's tilt is then noise, and a noisy 88° would hand the calibration
    // a "vertical" that points sideways. Below 3 % eccentricity the tilt is
    // zero by definition.
    if ((semiMajorPx - semiMinorPx) / semiMajorPx < 0.03) tilt = 0;
    return { cx: rr.center.x, cy: rr.center.y, semiMajorPx, semiMinorPx, tiltDeg: tilt };
  } catch {
    return null;
  } finally {
    mat.delete();
  }
}

/**
 * Fraction of 48 angular bins round the outline that have a strong gradient
 * (or, when `edges` is given, a Canny edge pixel) within a pixel and a half
 * of the outline. The honest confidence: a plate half behind a thigh scores
 * about 0,5.
 */
function edgeSupport(
  gray: GrayLike,
  cx: number,
  cy: number,
  a: number,
  b: number,
  tiltDeg: number,
  edges?: CV,
): number {
  const { ux, uy, vx, vy } = axes(tiltDeg);
  const BINS = 48;
  let hit = 0;
  for (let k = 0; k < BINS; k++) {
    const phi = (k / BINS) * Math.PI * 2;
    const u = a * Math.cos(phi);
    const v = b * Math.sin(phi);
    const x = cx + u * ux + v * vx;
    const y = cy + u * uy + v * vy;
    if (edges) {
      if (hasEdgeNear(edges, x, y, 1.5)) hit++;
    } else if (gradientAcross(gray, x, y, cx, cy) > 12) {
      hit++;
    }
  }
  return hit / BINS;
}

function hasEdgeNear(edges: CV, x: number, y: number, reach: number): boolean {
  const data: Uint8Array = edges.data;
  const cols: number = edges.cols;
  const rows: number = edges.rows;
  for (let yy = Math.floor(y - reach); yy <= Math.ceil(y + reach); yy++) {
    if (yy < 0 || yy >= rows) continue;
    for (let xx = Math.floor(x - reach); xx <= Math.ceil(x + reach); xx++) {
      if (xx < 0 || xx >= cols) continue;
      if (data[yy * cols + xx] !== 0) return true;
    }
  }
  return false;
}

/** |intensity just outside − intensity just inside| along the radial through
 *  (x, y) from the centre: an edge sits where that is large. */
function gradientAcross(gray: GrayLike, x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx;
  const dy = y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const inner = sample(gray, x - nx * 1.5, y - ny * 1.5);
  const outer = sample(gray, x + nx * 1.5, y + ny * 1.5);
  return Math.abs(outer - inner);
}

/**
 * The point along the radial through `p` where |d(intensity)/d(radius)| peaks,
 * to sub-pixel by a parabola through the peak and its neighbours. Null when no
 * clear peak is within a pixel and a half of the Canny point.
 */
function subpixelAlongRadial(
  gray: GrayLike,
  p: [number, number],
  e: PlateEllipse,
): [number, number] | null {
  const dx = p[0] - e.cx;
  const dy = p[1] - e.cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const nx = dx / len;
  const ny = dy / len;
  const STEP = 0.25;
  const REACH = 1.5;
  const n = Math.round((2 * REACH) / STEP) + 1;
  const profile = new Float64Array(n + 2);
  for (let k = -1; k <= n; k++) {
    const s = -REACH + k * STEP;
    profile[k + 1] = bilinear(gray, p[0] + nx * (s + STEP), p[1] + ny * (s + STEP)) -
      bilinear(gray, p[0] + nx * (s - STEP), p[1] + ny * (s - STEP));
  }
  let best = 1;
  for (let k = 1; k <= n; k++) if (Math.abs(profile[k]) > Math.abs(profile[best])) best = k;
  if (Math.abs(profile[best]) < 4) return null;
  const a = Math.abs(profile[best - 1]);
  const b = Math.abs(profile[best]);
  const c = Math.abs(profile[best + 1]);
  const denom = a - 2 * b + c;
  const offset = Math.abs(denom) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  const s = -REACH + (best - 1 + offset) * STEP;
  return [p[0] + nx * s, p[1] + ny * s];
}

function bilinear(gray: GrayLike, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= gray.width || y0 + 1 >= gray.height) return sample(gray, x, y);
  const fx = x - x0;
  const fy = y - y0;
  const w = gray.width;
  const d = gray.data;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x0 + 1] * fx;
  const bottom = d[(y0 + 1) * w + x0] * (1 - fx) + d[(y0 + 1) * w + x0 + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function sample(gray: GrayLike, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= gray.width || yi >= gray.height) return 0;
  return gray.data[yi * gray.width + xi];
}
