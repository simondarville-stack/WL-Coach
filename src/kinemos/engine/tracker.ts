/**
 * tracker — following the bar end, so the coach does not have to.
 *
 * The design doc's implementation note (§6.2) assumed opencv.js, hand-rolling a
 * tracker from `matchTemplate` + `calcOpticalFlowPyrLK` because the CSRT/KCF
 * trackers live in opencv_contrib and are not in the stock WASM build. Having
 * built it, the OpenCV dependency turns out to be unnecessary: the target here
 * is unusually kind — one large, high-contrast, **rotation-symmetric** disc,
 * anchored by the coach on frame one — and normalised cross-correlation over a
 * masked template is a few hundred lines and no 9 MB WASM payload. If it proves
 * inadequate on real footage the engine boundary means the implementation can
 * be swapped without anything above it noticing.
 *
 * Three decisions carry the accuracy:
 *
 *   1. **A CIRCULAR template — and, measured, not an annulus.** The design doc
 *      assumed the mask had to be a ring: plates spin, their branding turns with
 *      them, so excluding the face should make the template rotation-invariant.
 *      Measured against ground truth on a synthetic plate carrying realistic
 *      face branding through a full rotation, that is not what happens.
 *      Position error, by inner radius as a fraction of the outer:
 *
 *          0,00 → 0,038 px      0,45 → 0,050 px      0,70 → 0,089 px
 *          0,30 → 0,047 px      0,60 → 0,065 px      0,78 → 0,243 px
 *
 *      A ring does hold slightly higher correlation through the spin (0,84 vs
 *      0,79 at its best) — but correlation only has to clear the confidence
 *      threshold, while position error is the product. Cutting the middle out
 *      throws away most of the pixels that localise the disc, and the accuracy
 *      goes with them. The circular edge dominates the correlation regardless
 *      of what is printed inside it.
 *
 *      So the default masks nothing, and `innerRadiusFraction` stays a knob for
 *      footage where the face genuinely misbehaves — a mirror-finish plate, or
 *      a sticker with more contrast than the rim. The assumption was reasonable;
 *      it was just wrong, and it was cheap to find out.
 *
 *   2. **The template is never updated.** An adaptive template follows
 *      appearance changes and drifts — each frame's small error becomes the
 *      next frame's reference, and over 200 frames the track walks off the bar
 *      end onto a rack upright. Matching every frame against the coach's
 *      original anchor cannot drift; when the plate's appearance genuinely
 *      changes the confidence drops, which is a signal the coach can act on
 *      rather than a silent failure. A correction re-anchors, which is exactly
 *      when a new template is warranted.
 *
 *   3. **Sub-pixel refinement.** At ~2 mm/px a whole-pixel track cannot reach
 *      the accuracy tier the grade promises. Fitting a parabola through the
 *      correlation peak and its neighbours costs nothing and buys roughly a
 *      quarter-pixel.
 *
 * Engine purity: numbers in, numbers out. Frames arrive through `FrameSource`,
 * an interface the caller implements — the tracker knows nothing about the
 * frame server, WebCodecs or canvases.
 */

/** A greyscale frame. `data` is one value per pixel, row-major, any range. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** Where frames come from. The viewer adapts the frame server to this; the
 *  tests hand it synthetic images. */
import { medianInterval } from './signal';

export interface FrameSource {
  frameCount: number;
  timestamps: readonly number[];
  getGray(index: number): Promise<GrayImage>;
}

export interface TrackAnchor {
  index: number;
  x: number;
  y: number;
}

export interface TrackedPoint {
  index: number;
  t: number;
  x: number;
  y: number;
  /** Peak normalised cross-correlation, in [−1, 1]. Above ~0,8 is a solid
   *  match; below `minConfidence` the tracker has lost the bar. */
  confidence: number;
  /** How far the match landed from where the motion model expected it, px.
   *  A high-confidence match a long way from the prediction is the signature of
   *  the track jumping to a different object. */
  predictionErrorPx: number;
}

export interface TrackOptions {
  /** Outer radius of the annulus template, px. Should reach the plate's rim:
   *  for a 45 cm plate this is half its on-screen diameter. */
  templateRadiusPx?: number;
  /** Inner radius as a fraction of the outer. The hole excludes the hub, the
   *  lettering and the bar sleeve, all of which rotate or move independently. */
  innerRadiusFraction?: number;
  /** How far from the prediction to look, px. Grown automatically after a poor
   *  match, because a lost track is usually lost by more than the usual step. */
  searchRadiusPx?: number;
  /** Below this correlation the frame is reported but flagged; the caller
   *  decides whether to stop or to ask the coach. */
  minConfidence?: number;
  /** Stop after this many consecutive frames below `minConfidence`. Tracking on
   *  through a long failure wastes time and produces a track that looks
   *  complete and is not. */
  giveUpAfter?: number;
  /**
   * Cap on how many pixels the template samples.
   *
   * Cost per frame is (mask pixels × candidates), and both grow with the
   * footage: a 45 cm plate is ~50 px across on a 480 p clip and ~200 px on
   * 1080 p, which is sixteen times the mask for no extra information — the
   * plate's edge is just as findable from a subsampled ring of it. Above this
   * count the mask is decimated on a regular lattice, which keeps large-format
   * clips as fast as small ones.
   */
  maxTemplateSamples?: number;
  /** A template already cut, to track with instead of cutting one at the
   *  anchor. A set tracked in pieces keeps ONE template across its joins, so
   *  every piece centres the plate the same way and a join is not a step. */
  template?: Template;
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_TRACK_OPTIONS: Required<Omit<TrackOptions, 'onProgress' | 'template'>> = {
  templateRadiusPx: 26,
  // Zero: measured, not assumed. See decision 1 in the header.
  innerRadiusFraction: 0,
  searchRadiusPx: 14,
  minConfidence: 0.55,
  giveUpAfter: 8,
  maxTemplateSamples: 2200,
};

export interface TrackResult {
  points: TrackedPoint[];
  /** Frames the tracker was not confident about — the ones worth checking. */
  lowConfidenceIndices: number[];
  /** True when tracking stopped early because the bar was lost. */
  gaveUp: boolean;
}

// ── Template geometry ───────────────────────────────────────────────────────

/**
 * Pixel offsets of an annulus, as flat (dx, dy) pairs.
 *
 * Exported because the shape of the mask is the single most consequential
 * choice in this module and deserves to be checked directly rather than only
 * through a tracking result.
 */
export function annulusOffsets(
  outerR: number,
  innerFraction: number,
  maxSamples = Infinity,
): Int32Array {
  const inner = outerR * Math.min(0.95, Math.max(0, innerFraction));
  const innerSq = inner * inner;
  const outerSq = outerR * outerR;
  const r = Math.ceil(outerR);

  // How many pixels the full mask would hold, so the lattice step can be chosen
  // in one pass rather than by building and then thinning.
  const area = Math.PI * (outerSq - innerSq);
  const step = Number.isFinite(maxSamples)
    ? Math.max(1, Math.round(Math.sqrt(area / Math.max(1, maxSamples))))
    : 1;

  const out: number[] = [];
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      const d = dx * dx + dy * dy;
      if (d >= innerSq && d <= outerSq) out.push(dx, dy);
    }
  }
  return Int32Array.from(out);
}

/** A template: the masked pixel values at the anchor, pre-centred and with the
 *  normalisation terms already computed. */
export interface Template {
  offsets: Int32Array;
  /** Values with their mean already subtracted. */
  centred: Float32Array;
  /** √Σ(T−T̄)², the denominator's template half. Zero on a flat patch. */
  norm: number;
  /**
   * The fractional part of the anchor the template was cut at.
   *
   * A template can only be cut on whole pixels, but the coach clicks at
   * (120,37 · 170,61). The patch is therefore centred 0,37 px right and 0,39 px
   * up from the point it represents, and every later match inherits that
   * offset — a systematic error, the same on every frame, invisible to anyone
   * eyeballing the overlay and worth about half a pixel of accuracy. Carried
   * here and added back on every match.
   */
  anchorOffset: { x: number; y: number };
}

/**
 * Cut a template out of a frame at (cx, cy).
 *
 * Returns null when the annulus does not fit inside the frame or lands on a
 * patch with no contrast at all — matching a flat grey region would produce a
 * meaningless correlation that happens to be 1 everywhere.
 */
export function extractTemplate(
  image: GrayImage,
  cx: number,
  cy: number,
  offsets: Int32Array,
): Template | null {
  const n = offsets.length / 2;
  const values = new Float32Array(n);
  const ix = Math.round(cx);
  const iy = Math.round(cy);

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = ix + offsets[i * 2];
    const y = iy + offsets[i * 2 + 1];
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const v = image.data[y * image.width + x];
    values[i] = v;
    sum += v;
  }

  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    values[i] -= mean;
    sq += values[i] * values[i];
  }
  const norm = Math.sqrt(sq);
  if (!(norm > 1e-6)) return null;
  return { offsets, centred: values, norm, anchorOffset: { x: cx - ix, y: cy - iy } };
}

/**
 * Normalised cross-correlation of `template` against `image` centred at
 * (cx, cy), in [−1, 1].
 *
 * Normalised, so a lift filmed under a flickering gym light or a plate passing
 * through shadow still matches: NCC is invariant to any affine change in
 * brightness. Out-of-bounds candidates score −1 rather than being skipped, so
 * the search never walks off the frame edge.
 */
export function nccAt(image: GrayImage, template: Template, cx: number, cy: number): number {
  const { offsets, centred, norm } = template;
  const n = offsets.length / 2;
  const ix = Math.round(cx);
  const iy = Math.round(cy);

  let sum = 0;
  const values = scratchFor(n);
  for (let i = 0; i < n; i++) {
    const x = ix + offsets[i * 2];
    const y = iy + offsets[i * 2 + 1];
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return -1;
    const v = image.data[y * image.width + x];
    values[i] = v;
    sum += v;
  }

  const mean = sum / n;
  let dot = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    dot += d * centred[i];
    sq += d * d;
  }
  const denom = Math.sqrt(sq) * norm;
  return denom > 1e-9 ? dot / denom : -1;
}

/** One reusable buffer for the candidate gather. The search evaluates hundreds
 *  of candidates per frame and allocating a Float32Array for each one is most
 *  of the time budget. */
let scratch = new Float32Array(0);
function scratchFor(n: number): Float32Array {
  if (scratch.length < n) scratch = new Float32Array(n);
  return scratch;
}

/**
 * Sub-pixel offset of a correlation peak, by parabola through three samples.
 *
 * Returns 0 when the three points do not describe a peak (a flat or inverted
 * neighbourhood), rather than the ±∞ the closed form would give.
 */
export function subPixelOffset(before: number, at: number, after: number): number {
  const denom = before - 2 * at + after;
  if (!(Math.abs(denom) > 1e-9)) return 0;
  const offset = (0.5 * (before - after)) / denom;
  // A parabola fitted to a genuine peak never moves it more than half a sample.
  return Math.abs(offset) <= 0.5 ? offset : 0;
}

/**
 * Where the bar is expected next, by constant velocity over the last two
 * points.
 *
 * Deliberately not acceleration-aware: the bar's acceleration through the
 * second pull is large and changes sign at the apex, and a quadratic
 * extrapolator overshoots exactly there — at the fastest, hardest-to-track part
 * of the lift. A linear guess is wrong by a bounded amount that the search
 * radius covers.
 */
export function predictNext(
  points: readonly { x: number; y: number }[],
  step: number,
): { x: number; y: number } {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: points[0].x, y: points[0].y };
  const last = points[n - 1];
  const prev = points[n - 2];
  return { x: last.x + (last.x - prev.x) * step, y: last.y + (last.y - prev.y) * step };
}

// ── The tracker ─────────────────────────────────────────────────────────────

/**
 * Track from the anchor in one direction.
 *
 * `direction` is +1 forward through the clip or −1 backward — the backward pass
 * is what makes a mid-lift correction useful, since a coach usually notices the
 * track is wrong some frames after it went wrong.
 */
export async function trackDirection(
  source: FrameSource,
  anchor: TrackAnchor,
  direction: 1 | -1,
  options: TrackOptions = {},
): Promise<TrackResult> {
  const opts = { ...DEFAULT_TRACK_OPTIONS, ...options };
  // The search radius follows the physics unless the caller sets it. A bar
  // end reaches about 3 m/s; on a plate of radius R px (45 cm) at f frames a
  // second that is 300·2R/(45·f) ≈ 13·R/f px per frame, plus a margin for
  // the acceleration into the second pull. 14 px covers a 50 fps, 26 px
  // plate; a 30 fps phone clip with an 85 px plate needs 40.
  if (options.searchRadiusPx === undefined) {
    const fps = 1 / Math.max(1e-3, medianInterval(source.timestamps));
    opts.searchRadiusPx = Math.max(DEFAULT_TRACK_OPTIONS.searchRadiusPx, Math.ceil((15 * opts.templateRadiusPx) / fps));
  }
  const offsets = annulusOffsets(
    opts.templateRadiusPx,
    opts.innerRadiusFraction,
    opts.maxTemplateSamples,
  );

  const template =
    options.template ?? extractTemplate(await source.getGray(anchor.index), anchor.x, anchor.y, offsets);
  if (!template) {
    return { points: [], lowConfidenceIndices: [], gaveUp: true };
  }

  const points: TrackedPoint[] = [
    {
      index: anchor.index,
      t: source.timestamps[anchor.index] ?? 0,
      x: anchor.x,
      y: anchor.y,
      // The coach put it there; nothing correlates better than that.
      confidence: 1,
      predictionErrorPx: 0,
    },
  ];
  const lowConfidenceIndices: number[] = [];
  let consecutiveMisses = 0;
  let lowRun = 0;
  let gaveUp = false;

  const total =
    direction === 1 ? source.frameCount - anchor.index - 1 : anchor.index;

  for (let step = 1; ; step++) {
    const index = anchor.index + direction * step;
    if (index < 0 || index >= source.frameCount) break;

    const image = await source.getGray(index);
    // Prediction runs in tracking order, so the two most recent points are the
    // last two entries whichever way we are walking.
    const prediction = predictNext(points, 1);
    // A poor last match usually means the bar moved further than usual, or the
    // template was matched somewhere wrong — either way, look wider.
    const radius = opts.searchRadiusPx * (consecutiveMisses > 0 ? 1 + consecutiveMisses * 0.5 : 1);

    const match = searchAround(image, template, prediction.x, prediction.y, radius);
    const predictionErrorPx = Math.hypot(match.x - prediction.x, match.y - prediction.y);

    points.push({
      index,
      t: source.timestamps[index] ?? 0,
      x: match.x,
      y: match.y,
      confidence: match.score,
      predictionErrorPx,
    });

    if (match.score < opts.minConfidence) {
      // Reported either way — the coach sees where the tracker was unsure.
      lowConfidenceIndices.push(index);
      // A MISS, the thing that ends a track, is a poor match that ALSO landed
      // far from where the bar was heading. A plate blurred through the
      // second pull of a 30 fps clip correlates at 0,3–0,4 for ten frames in
      // a row while moving exactly as predicted; giving up on the score alone
      // threw those reps away. A poor match that is at least plausible does
      // not count against the track — but it does not clear the count
      // either: only a confident match does, so a lost template wandering
      // inside its search window still runs out of patience.
      if (predictionErrorPx > 0.35 * radius) {
        consecutiveMisses++;
        if (consecutiveMisses >= opts.giveUpAfter) {
          gaveUp = true;
          break;
        }
      }
      // And a template that has not matched confidently for a long while is
      // lost whatever its motion looks like — sitting on a fan behind the
      // platform is perfectly plausible motion. A blurred pull is over in
      // fifteen frames; four times the patience is a second at 30 fps.
      lowRun++;
      if (lowRun >= 4 * opts.giveUpAfter) {
        gaveUp = true;
        break;
      }
    } else {
      consecutiveMisses = 0;
      lowRun = 0;
    }

    options.onProgress?.(step, Math.max(1, total));
  }

  // Backward tracks come out reversed; every consumer wants time order.
  if (direction === -1) points.reverse();
  return { points, lowConfidenceIndices, gaveUp };
}

/**
 * Track the whole clip from one anchor, forwards and backwards.
 *
 * This is the gesture from design §6.2: the coach clicks the bar end on any
 * frame and the track fills in around it. A correction later is the same call
 * with a new anchor, which is why re-tracking after a fix costs nothing extra
 * to implement.
 */
export async function trackFromAnchor(
  source: FrameSource,
  anchor: TrackAnchor,
  options: TrackOptions = {},
): Promise<TrackResult> {
  const forward = await trackDirection(source, anchor, 1, options);
  const backward = await trackDirection(source, anchor, -1, options);

  // The anchor frame appears in both passes; keep it once.
  const merged = [...backward.points.filter(p => p.index !== anchor.index), ...forward.points];
  merged.sort((a, b) => a.index - b.index);

  return {
    points: merged,
    lowConfidenceIndices: [...backward.lowConfidenceIndices, ...forward.lowConfidenceIndices].sort(
      (a, b) => a - b,
    ),
    gaveUp: forward.gaveUp || backward.gaveUp,
  };
}

/**
 * Best correlation within `radius` of (px, py), refined to sub-pixel.
 *
 * Two passes. A stride-2 lattice finds the neighbourhood — the correlation
 * surface of a disc is several pixels wide, so a stride of two cannot step over
 * the peak — and a full-resolution sweep of ±2 around the winner finds the
 * pixel. That is about a quarter of the candidates of an exhaustive search,
 * which together with the template's sample cap is what keeps a 1080 p clip as
 * fast as a 480 p one.
 */
export function searchAround(
  image: GrayImage,
  template: Template,
  px: number,
  py: number,
  radius: number,
): { x: number; y: number; score: number } {
  const r = Math.max(2, Math.round(radius));
  const cx = Math.round(px);
  const cy = Math.round(py);
  const width = 2 * r + 1;

  // Memoised correlation, so the coarse pass, the fine pass and the sub-pixel
  // refinement never evaluate the same candidate twice. NaN marks "not yet
  // computed"; −1 is a real score (out of frame).
  const scores = new Float32Array(width * width).fill(Number.NaN);
  const scoreAt = (dx: number, dy: number): number => {
    if (dx < -r || dx > r || dy < -r || dy > r) return -1;
    const slot = (dy + r) * width + (dx + r);
    if (!Number.isNaN(scores[slot])) return scores[slot];
    const score = nccAt(image, template, cx + dx, cy + dy);
    scores[slot] = score;
    return score;
  };

  let bestScore = -Infinity;
  let bestDx = 0;
  let bestDy = 0;
  const consider = (dx: number, dy: number) => {
    const score = scoreAt(dx, dy);
    if (score > bestScore) {
      bestScore = score;
      bestDx = dx;
      bestDy = dy;
    }
  };

  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) consider(dx, dy);
  }
  const coarseDx = bestDx;
  const coarseDy = bestDy;
  for (let dy = coarseDy - 2; dy <= coarseDy + 2; dy++) {
    for (let dx = coarseDx - 2; dx <= coarseDx + 2; dx++) consider(dx, dy);
  }

  // The peak is fixed from here: the neighbour lookups below must not be able
  // to move it out from under the refinement that is using it.
  const peakDx = bestDx;
  const peakDy = bestDy;

  let subX = 0;
  let subY = 0;
  // A peak on the edge of the window has no neighbour to fit through, and is
  // already suspect enough not to deserve refining.
  if (Math.abs(peakDx) < r && Math.abs(peakDy) < r) {
    const at = scoreAt(peakDx, peakDy);
    subX = subPixelOffset(scoreAt(peakDx - 1, peakDy), at, scoreAt(peakDx + 1, peakDy));
    subY = subPixelOffset(scoreAt(peakDx, peakDy - 1), at, scoreAt(peakDx, peakDy + 1));
  }

  // The template's own fractional origin goes back on here: the patch was cut
  // up to half a pixel off the point it stands for, and without this every
  // match repeats that offset on every frame.
  return {
    x: cx + peakDx + subX + template.anchorOffset.x,
    y: cy + peakDy + subY + template.anchorOffset.y,
    score: bestScore,
  };
}

/**
 * Turn an RGBA buffer into the greyscale the tracker works on.
 *
 * Rec. 601 luma, matching what a video decoder produces natively — the plate's
 * contrast against a platform is a luminance edge, and weighting the channels
 * this way is what makes a red plate on a blue platform separate at all.
 */
export function grayFromRgba(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return { width, height, data };
}
