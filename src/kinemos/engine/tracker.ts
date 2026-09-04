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
 *   2. **The anchor template is never discarded — and it is not enough on its
 *      own.** A purely adaptive template drifts: each frame's small error
 *      becomes the next frame's reference, and over 200 frames the track walks
 *      off the bar end onto a rack upright. A purely fixed one dies: measured
 *      on real footage (the KinEMOS testset, 04/09/2026) the anchor patch's
 *      correlation decays steadily through every pull — 0,98 → 0,31 on a red
 *      ZKC 25, 0,90 → 0,48 on a black Eleiko — with the track still on the
 *      hub, until the threshold declares the bar lost at peak velocity, the
 *      one moment the coach wanted. It is not rotation, scale or motion blur
 *      alone (each was tried as a template variant and none recovered the
 *      score); it is the plate's appearance changing cumulatively as it rises
 *      half a metre past a camera two metres away.
 *
 *      So two templates. The coach's anchor is kept for the whole track and
 *      re-scored on every frame at the current peak; a second, *current*
 *      template is re-cut from the latest frame whenever a confident match has
 *      nonetheless drifted in appearance. The anchor wins ties, so whenever the
 *      plate looks the way it did when the coach clicked it, any drift the
 *      current template accumulated is reset to zero. A correction re-anchors
 *      both, which is exactly when a fresh reference is warranted.
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

/**
 * A greyscale image. `data` is one value per pixel, row-major, any range.
 *
 * It need not be the whole frame: a source may serve only the region the
 * tracker asked for, in which case `originX`/`originY` say where that region
 * sits in frame coordinates. Every coordinate the tracker speaks is a FRAME
 * coordinate; the origin is subtracted at the single point where a pixel is
 * read. Absent, the image starts at 0,0 — a full frame.
 */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
  originX?: number;
  originY?: number;
}

/** A rectangle in frame pixels, inclusive of its origin, exclusive of its far
 *  edge. */
export interface FrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where frames come from. The viewer adapts the frame server to this; the
 * tests hand it synthetic images.
 *
 * `region` is what the tracker will actually read on this frame — the search
 * window plus the template's reach. It is a hint: a source may ignore it and
 * return the full frame, or return any image that covers the region (clamped
 * to the frame) with its origin set. Honouring it is what makes tracking on
 * phone footage fast: reading back a whole 1080 × 1920 frame costs more than
 * decoding it, and the tracker looks at about 2 % of it.
 */
export interface FrameSource {
  frameCount: number;
  timestamps: readonly number[];
  getGray(index: number, region?: FrameRegion): Promise<GrayImage>;
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
  /**
   * How far from the prediction to look, px — a FLOOR. The radius actually
   * used is the larger of this and what the plate's size and the frame
   * interval imply (see `searchRadiusFor`): a bar accelerating at 30 m/s²
   * lands further from a constant-velocity guess on a 24 fps 8K clip than on
   * a 60 fps 720p one, and a fixed pixel count cannot cover both. Grown
   * automatically after a poor match, because a lost track is usually lost by
   * more than the usual step.
   */
  searchRadiusPx?: number;
  /**
   * Keep a second template current with the plate's changing appearance
   * (header decision 2). Off, the anchor template alone is matched — the
   * pre-testset behaviour, kept for measuring against.
   */
  adaptive?: boolean;
  /**
   * A match must score at least this to be trusted as a new reference. Below
   * it the current template is left alone: re-cutting from a doubtful match —
   * a hand across the plate, a half-lost peak — is how a track walks away.
   */
  refreshMinConfidence?: number;
  /**
   * Re-cut the current template when the match scores under this. Above it
   * the plate still looks like the reference and there is nothing to learn;
   * refreshing on every frame regardless would accumulate drift for no gain.
   */
  refreshBelowConfidence?: number;
  /**
   * How much of a refresh is the new frame, 0–1. The current template is
   * blended toward the latest look rather than replaced by it: a straight
   * replacement bakes the match's whole position error into the reference
   * every time — measured on a synthetic morph, a tenth of a pixel per
   * refresh, always the same way — while a blend bakes in only this
   * fraction of it and follows the appearance just as surely over a few
   * frames. (The classic template-update learning rate; MOSSE uses 0,125.)
   */
  refreshRate?: number;
  /**
   * Below this score a frame yields no point at all. A candidate can score
   * 0,1 on a plate that is mostly off the frame, or on nothing in particular,
   * and a point placed there is not "uncertain", it is invented — and it
   * feeds the motion model. Such frames are skipped, the last point stands
   * in, and they count toward giving up.
   */
  discardBelowConfidence?: number;
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
  adaptive: true,
  // Measured on a synthetic plate whose anchor correlation decays to 0,43 —
  // what the real clips did — and on a harsher one that inverts its
  // contrast: 0,5 / 0,6 tracked both, 0,3 / 0,7 lost the harsh one (the
  // template could not learn fast enough to stay above the refresh floor),
  // and a full replacement (rate 1) drifted twice as far.
  refreshMinConfidence: 0.6,
  refreshBelowConfidence: 0.9,
  refreshRate: 0.5,
  discardBelowConfidence: 0.3,
};

/**
 * Physical bounds the search radius is derived from. A 45 cm plate is the
 * yardstick because the template radius is documented as reaching its rim, so
 * `2 · templateRadiusPx` pixels ≈ 0,45 m and the clip's scale follows without
 * a calibration. A smaller plate makes these conservative, never tight.
 */
const PLATE_DIAMETER_M = 0.45;
/** Upper bound on the bar's acceleration, m/s². Second pulls peak near 20;
 *  the catch impact and a bar being dropped exceed it briefly. 45 covers the
 *  largest prediction error seen on the testset (17 px at 30 fps on a 178 px
 *  plate) with room; a wider window buys nothing but a slower, and more
 *  distractible, search. */
const MAX_BAR_ACCELERATION_MS2 = 45;
/** Upper bound on the bar's speed, m/s — a fast snatch is ~2,2. Used only on
 *  the first step out of an anchor, where there is no velocity to predict
 *  from and the whole per-frame displacement has to fit in the window. */
const MAX_BAR_SPEED_MS = 2.8;

/**
 * Search radius for one step, in pixels.
 *
 * With two points to extrapolate from, the prediction is off by the
 * acceleration term alone, ½·a·Δt², so that is what the window has to cover.
 * With only the anchor, there is no velocity and the window must hold the
 * full per-frame travel, v·Δt. Both are converted to pixels through the
 * plate's on-screen size. `floorPx` (the option) is the least the window is
 * ever allowed to be.
 */
export function searchRadiusFor(
  templateRadiusPx: number,
  dtS: number,
  hasVelocity: boolean,
  floorPx: number,
): number {
  const pxPerM = (2 * templateRadiusPx) / PLATE_DIAMETER_M;
  const dt = Number.isFinite(dtS) && dtS > 0 ? dtS : 1 / 30;
  const metres = hasVelocity
    ? 0.5 * MAX_BAR_ACCELERATION_MS2 * dt * dt
    : MAX_BAR_SPEED_MS * dt;
  return Math.max(floorPx, Math.ceil(metres * pxPerM));
}

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
  const ix = Math.round(cx) - (image.originX ?? 0);
  const iy = Math.round(cy) - (image.originY ?? 0);

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
  return {
    offsets,
    centred: values,
    norm,
    anchorOffset: { x: cx - Math.round(cx), y: cy - Math.round(cy) },
  };
}

/** Bilinear read at a fractional frame coordinate. NaN off the image. */
function sampleBilinear(image: GrayImage, x: number, y: number): number {
  const lx = x - (image.originX ?? 0);
  const ly = y - (image.originY ?? 0);
  const x0 = Math.floor(lx);
  const y0 = Math.floor(ly);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= image.width || y0 + 1 >= image.height) return Number.NaN;
  const fx = lx - x0;
  const fy = ly - y0;
  const { data, width } = image;
  const i = y0 * width + x0;
  return (
    data[i] * (1 - fx) * (1 - fy) +
    data[i + 1] * fx * (1 - fy) +
    data[i + width] * (1 - fx) * fy +
    data[i + width + 1] * fx * fy
  );
}

/**
 * Cut a template centred on an exact, fractional point.
 *
 * Sampled bilinearly, so the template represents the point itself and carries
 * no anchor offset. This is how the current template is refreshed mid-track
 * (header decision 2): re-cutting on whole pixels would round the matched
 * position on every refresh, and those roundings are precisely the drift the
 * scheme is at pains to avoid.
 */
export function cutTemplateAt(
  image: GrayImage,
  cx: number,
  cy: number,
  offsets: Int32Array,
): Template | null {
  const n = offsets.length / 2;
  const values = new Float32Array(n);

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = sampleBilinear(image, cx + offsets[i * 2], cy + offsets[i * 2 + 1]);
    if (Number.isNaN(v)) return null;
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
  return { offsets, centred: values, norm, anchorOffset: { x: 0, y: 0 } };
}

/**
 * The least of the template that must be inside the frame for a match to be
 * scored at all. A plate at the frame edge is matched on the part that is
 * visible; below half of it, the visible part is an arc, which localises the
 * disc along one axis only.
 */
const MIN_VISIBLE_FRACTION = 0.5;

/**
 * Normalised cross-correlation of `template` against `image` centred at
 * (cx, cy), in [−1, 1].
 *
 * Normalised, so a lift filmed under a flickering gym light or a plate passing
 * through shadow still matches: NCC is invariant to any affine change in
 * brightness.
 *
 * A template that overhangs the frame edge is scored on the samples that are
 * inside it, against the corresponding subset of the template — both
 * re-centred on that subset, so the statistic stays a true correlation. It
 * costs one extra pass, paid only on frames where the edge is actually in
 * play. Below `MIN_VISIBLE_FRACTION` the candidate scores −1, which is also
 * what an image with no evaluable pixels scores: "not a match", never an
 * error — the search then cannot walk off the frame.
 *
 * Why it matters: on the KinEMOS testset (04/09/2026) a clip whose bar ends
 * a plate's width from the bottom edge lost its track a frame before the
 * plate left the picture, and everything from lift-off to the catch was
 * inside that margin on several others.
 */
export function nccAt(image: GrayImage, template: Template, cx: number, cy: number): number {
  const { offsets, centred, norm } = template;
  const n = offsets.length / 2;
  const ix = Math.round(cx) - (image.originX ?? 0);
  const iy = Math.round(cy) - (image.originY ?? 0);

  let sum = 0;
  let inside = 0;
  const values = scratchFor(n);
  const visible = visibleFor(n);
  for (let i = 0; i < n; i++) {
    const x = ix + offsets[i * 2];
    const y = iy + offsets[i * 2 + 1];
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
      visible[i] = 0;
      continue;
    }
    const v = image.data[y * image.width + x];
    values[i] = v;
    visible[i] = 1;
    sum += v;
    inside++;
  }

  if (inside === n) {
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

  if (inside < n * MIN_VISIBLE_FRACTION) return -1;

  // Partial: the template's own mean over the visible subset shifts too.
  let tSum = 0;
  for (let i = 0; i < n; i++) if (visible[i]) tSum += centred[i];
  const mean = sum / inside;
  const tMean = tSum / inside;
  let dot = 0;
  let sq = 0;
  let tSq = 0;
  for (let i = 0; i < n; i++) {
    if (!visible[i]) continue;
    const d = values[i] - mean;
    const t = centred[i] - tMean;
    dot += d * t;
    sq += d * d;
    tSq += t * t;
  }
  const denom = Math.sqrt(sq) * Math.sqrt(tSq);
  return denom > 1e-9 ? dot / denom : -1;
}

/** Reusable buffers for the candidate gather. The search evaluates hundreds
 *  of candidates per frame and allocating a Float32Array for each one is most
 *  of the time budget. */
let scratch = new Float32Array(0);
let visibleScratch = new Uint8Array(0);
function scratchFor(n: number): Float32Array {
  if (scratch.length < n) scratch = new Float32Array(n);
  return scratch;
}
function visibleFor(n: number): Uint8Array {
  if (visibleScratch.length < n) visibleScratch = new Uint8Array(n);
  return visibleScratch;
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

/**
 * `(1 − rate) · a + rate · b`, sample by sample. Both inputs are zero-mean, so
 * the blend is too; only the norm needs recomputing. The two must represent
 * the same point (both cut with `cutTemplateAt`, so no anchor offset).
 */
export function blendTemplates(a: Template, b: Template, rate: number): Template {
  const n = a.centred.length;
  const values = new Float32Array(n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    values[i] = (1 - rate) * a.centred[i] + rate * b.centred[i];
    sq += values[i] * values[i];
  }
  return { offsets: a.offsets, centred: values, norm: Math.sqrt(sq), anchorOffset: { x: 0, y: 0 } };
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
  // The search radius follows the physics per step — see `searchRadiusFor`.
  // An earlier rule floored it at the bar's whole per-frame travel
  // (15·R/fps, 53 px on a 30 fps 1080p clip) because a fixed template
  // under motion blur matched off the prediction; with the current template
  // following the blur the prediction error stayed under 17 px on every
  // testset clip, and that floor made each frame's correlation six times
  // dearer (71 ms against 11 ms) for nothing.
  const offsets = annulusOffsets(
    opts.templateRadiusPx,
    opts.innerRadiusFraction,
    opts.maxTemplateSamples,
  );
  /** How far the template reaches from its centre, whole pixels. */
  const reach = Math.ceil(opts.templateRadiusPx) + 1;
  /** The pixels a search of `radius` around (px, py) can touch. */
  const regionFor = (px: number, py: number, radius: number): FrameRegion => {
    const half = Math.ceil(radius) + reach + 2;
    return {
      x: Math.round(px) - half,
      y: Math.round(py) - half,
      width: 2 * half + 1,
      height: 2 * half + 1,
    };
  };

  const anchorImage = await source.getGray(anchor.index, regionFor(anchor.x, anchor.y, 0));
  // A set tracked in pieces hands in the template it started with, so every
  // piece centres the plate the same way; the anchor frame is still read for
  // the first refresh's base.
  const anchorTemplate =
    options.template ?? extractTemplate(anchorImage, anchor.x, anchor.y, offsets);
  if (!anchorTemplate) {
    return { points: [], lowConfidenceIndices: [], gaveUp: true };
  }
  /** The reference that follows the plate's appearance; the anchor until the
   *  first confident refresh. */
  let current: Template = anchorTemplate;

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

    // Prediction runs in tracking order, so the two most recent points are the
    // last two entries whichever way we are walking. Velocity is per frame of
    // INDEX, so a gap of skipped frames (see below) is extrapolated across
    // rather than treated as one step.
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const gap = Math.abs(index - last.index);
    const prediction = prev
      ? {
          x: last.x + ((last.x - prev.x) / Math.max(1, Math.abs(last.index - prev.index))) * gap,
          y: last.y + ((last.y - prev.y) / Math.max(1, Math.abs(last.index - prev.index))) * gap,
        }
      : { x: last.x, y: last.y };
    const dt = Math.abs(
      (source.timestamps[index] ?? 0) - (source.timestamps[index - direction] ?? 0),
    );
    const base = searchRadiusFor(opts.templateRadiusPx, dt, points.length >= 2, opts.searchRadiusPx);
    // A poor last match usually means the bar moved further than usual, or the
    // template was matched somewhere wrong — either way, look wider.
    const radius = base * (consecutiveMisses > 0 ? 1 + consecutiveMisses * 0.5 : 1);

    const image = await source.getGray(index, regionFor(prediction.x, prediction.y, radius));
    let match = searchAround(image, current, prediction.x, prediction.y, radius);

    if (current !== anchorTemplate) {
      // The anchor gets its say at the same place. It wins a tie: the
      // current template can only have drifted, the anchor cannot.
      const byAnchor = searchAround(image, anchorTemplate, match.ix, match.iy, 3);
      if (byAnchor.score >= match.score - 0.02) match = byAnchor;
    }
    const predictionErrorPx = Math.hypot(match.x - prediction.x, match.y - prediction.y);

    // Nothing worth calling a match — the plate has left the frame, the
    // whole window is off it, or the best candidate is noise. Recording the
    // best of nothing as a point would feed the prediction a jump, and the
    // next prediction a bigger one: measured on the testset (04/09/2026),
    // eight such frames ran a track 557 px off the bottom of the picture and
    // the "peak velocity" to 15 m/s. So the frame yields no point: it is
    // listed as uncertain, the motion model carries on from the last real
    // match, and the miss counts toward giving up.
    if (!(match.score >= opts.discardBelowConfidence)) {
      lowConfidenceIndices.push(index);
      consecutiveMisses++;
      if (consecutiveMisses >= opts.giveUpAfter) {
        gaveUp = true;
        break;
      }
      options.onProgress?.(step, Math.max(1, total));
      continue;
    }

    // Learn the plate's new look — only from a match good enough to trust,
    // that landed where the motion said it would, and only when the look has
    // actually moved on from the reference.
    if (
      opts.adaptive &&
      match.score >= opts.refreshMinConfidence &&
      match.score < opts.refreshBelowConfidence &&
      predictionErrorPx <= Math.max(3, 0.5 * base)
    ) {
      const patch = cutTemplateAt(image, match.x, match.y, offsets);
      if (patch) {
        // The first refresh starts from the anchor's own look, resampled at
        // its exact point so that it and every later patch share an origin.
        const base =
          current === anchorTemplate
            ? (cutTemplateAt(anchorImage, anchor.x, anchor.y, offsets) ?? patch)
            : current;
        current = blendTemplates(base, patch, opts.refreshRate);
      }
    }

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
): { x: number; y: number; score: number; ix: number; iy: number } {
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
    // The whole-pixel peak, for anyone who wants to score something else
    // at the same place.
    ix: cx + peakDx,
    iy: cy + peakDy,
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
