/**
 * calibration — pixels to centimetres, honestly.
 *
 * A weight plate is a circle of known diameter standing in the movement plane.
 * Filmed from anywhere but dead perpendicular it projects to an ellipse, and
 * that ellipse carries two separate pieces of information:
 *
 *   - its MAJOR axis is the plate's true diameter, unforeshortened. That is the
 *     scale along the direction the bar actually travels.
 *   - its MINOR axis is the same diameter squashed by cos θ, where θ is how far
 *     off perpendicular the camera sits. So the minor axis both reveals θ and
 *     gives the scale across the frame.
 *
 * Which means the vertical and horizontal scales are DIFFERENT NUMBERS. A
 * single "cm per pixel" would silently under-report every horizontal excursion
 * — exactly the loop-back the coach is looking at — by cos θ, 13 % at 30°. The
 * interface must never imply one scale, and neither does this module: it
 * returns both, plus θ, plus how far to trust the result.
 *
 * **Which way is up is NOT read off the ellipse.** The first version rotated
 * every displacement onto the fitted ellipse's axes, on the reasoning that the
 * major axis is the bar's travel direction. On real footage that was the
 * single largest error KinEMOS had (docs/KINEMOS_ACCURACY_STUDY.md): a plate
 * a few degrees off perpendicular is a few per cent from circular, and the
 * orientation of a nearly circular ellipse is noise — ±15° on the two clips
 * studied — so the rotation smeared a 160 cm vertical pull into a 40 cm
 * sideways "loop" and moved peak velocity by 7 % between two views of one
 * lift. Gravity is the reference a bar path actually has: on a tripod it is
 * the image vertical, and a rolled camera is a separate, small, explicit
 * number (`rollDeg`). The ellipse contributes its two scales and, through its
 * orientation, only how those scales are shared between the image axes — a
 * quantity that vanishes smoothly as the ellipse becomes a circle, which is
 * exactly the robustness the rotation lacked. See `displacementToCm`.
 *
 * Validity: ±30° off perpendicular (design §6.1). Beyond that the flat-circle
 * model breaks down (the plate's own thickness starts to show, and the residual
 * depth change of the bar through the lift stops being second-order), so the
 * result is returned but marked `wide`.
 *
 * Engine purity: no DOM, no React, no EMOS imports. Pure functions over
 * numbers (design §4 rule 1).
 */

/** A point in display-space pixels — the coordinate system the frame server
 *  serves and the viewer stores (P1 plan decision 3). x right, y DOWN. */
export interface PxPoint {
  x: number;
  y: number;
}

/** A point in the movement plane, centimetres, y UP. Origin is whatever the
 *  caller measured from; only differences are meaningful. */
export interface CmPoint {
  x: number;
  y: number;
}

/**
 * The plate outline the coach confirmed.
 *
 * `tiltDeg` is the clockwise rotation of the MAJOR axis away from image
 * vertical. It describes the outline's shape — which way the foreshortening
 * runs — and nothing else: it is not the camera's roll and is never used as
 * one (see the module comment). On a nearly circular plate it is barely
 * determined, and the maths below is written so that does not matter.
 */
export interface PlateEllipse {
  cx: number;
  cy: number;
  /** Half the major axis, px. */
  semiMajorPx: number;
  /** Half the minor axis, px. */
  semiMinorPx: number;
  tiltDeg: number;
}

/** IWF competition plate. Coach-configurable — training discs and change
 *  plates are smaller, and a coach filming a 5 kg disc who is handed 45 cm gets
 *  every number wrong by a factor of two. COACH-CONFIG candidate. */
export const DEFAULT_PLATE_DIAMETER_CM = 45;

/**
 * The bar's sleeve end — the ø50 mm disc at the very tip of the bar, at the
 * plate's centre. A second known dimension in every clip, and the better one
 * when the resolution allows: it IS the bar's axis (the plate merely sits on
 * it), it is small enough that motion blur barely touches it, it has no rim,
 * thickness or shadow to confuse an edge with, and it is round from any
 * angle a coach films at. At 384×288 it is six pixels across and useless as
 * a scale; on 1080p phone footage it is 25–40 px and a tracking target in
 * its own right. Recorded here as the reference the next accuracy step
 * should build on (docs/KINEMOS_ACCURACY_STUDY.md §6).
 */
export const BAR_SLEEVE_END_DIAMETER_CM = 5;

/** Common plate faces, for the calibration panel's quick picks. Diameters are
 *  the disc's outer diameter in cm. */
export const PLATE_PRESETS: ReadonlyArray<{ label: string; diameterCm: number }> = [
  { label: 'Competition / bumper (45 cm)', diameterCm: 45 },
  { label: '15 kg training disc (40 cm)', diameterCm: 40 },
  { label: '10 kg change plate (32,5 cm)', diameterCm: 32.5 },
  { label: '5 kg change plate (22,8 cm)', diameterCm: 22.8 },
  { label: '2,5 kg change plate (19 cm)', diameterCm: 19 },
];

/** Below this the ellipse is too few pixels to carry a scale worth quoting: at
 *  a 45 cm plate across 16 px, one pixel is nearly 3 cm. */
const MIN_TRUSTWORTHY_SEMI_MAJOR_PX = 8;

/** The documented validity limit of the flat-circle model (design §6.1). */
export const MAX_VALID_VIEWING_ANGLE_DEG = 30;

export type CalibrationConfidence = 'ok' | 'wide' | 'degenerate';

export interface Calibration {
  /** cm per pixel along the plate's major axis — the bar's travel direction. */
  cmPerPxV: number;
  /** cm per pixel across it. Always ≥ `cmPerPxV`: the frame is compressed in
   *  this direction, so each pixel spans more real distance. */
  cmPerPxH: number;
  /** How far off perpendicular the camera is, degrees. */
  viewingAngleDeg: number;
  /** Clockwise tilt of the outline's major axis from image vertical, degrees.
   *  Reported for the panel; it steers only how the two scales are shared
   *  between the image axes, never which way is up. */
  tiltDeg: number;
  /**
   * Clockwise roll of the camera from level, degrees: the direction gravity
   * points in the image. 0 for a tripod, which is the default and the case
   * every measured clip so far. It is deliberately NOT inferred from the plate
   * outline — a near-circular ellipse cannot say which way is up — and a
   * source for it (a plumb reference, a rack upright, the stabiliser's
   * rotation on a handheld clip) is a later assist. COACH-CONFIG candidate.
   */
  rollDeg: number;
  plateDiameterCm: number;
  confidence: CalibrationConfidence;
  /** Why the confidence is not `ok`. Null when it is. */
  reason: string | null;
}

/**
 * Build a calibration from a confirmed plate outline.
 *
 * Never throws and never refuses: an unusable ellipse comes back as
 * `degenerate` with the scales it would have implied, because a viewer that
 * silently drops a calibration is worse than one that shows a flagged number.
 */
export interface CalibrationOptions {
  /** Camera roll, degrees clockwise from level. See `Calibration.rollDeg`. */
  rollDeg?: number;
}

export function calibrateFromEllipse(
  ellipse: PlateEllipse,
  plateDiameterCm: number = DEFAULT_PLATE_DIAMETER_CM,
  options: CalibrationOptions = {},
): Calibration {
  const rollDeg = Number.isFinite(options.rollDeg) ? (options.rollDeg as number) : 0;
  // Whichever axis the coach dragged longer IS the major one; a UI that lets
  // both handles move will produce the other order sooner or later. Swapping
  // the axes rotates the frame by a quarter turn, so the tilt follows.
  const swapped = ellipse.semiMinorPx > ellipse.semiMajorPx;
  const a = Math.max(ellipse.semiMajorPx, ellipse.semiMinorPx);
  const b = Math.min(ellipse.semiMajorPx, ellipse.semiMinorPx);
  const tiltDeg = normaliseTilt(swapped ? ellipse.tiltDeg + 90 : ellipse.tiltDeg);

  const diameter = plateDiameterCm > 0 ? plateDiameterCm : DEFAULT_PLATE_DIAMETER_CM;

  if (!(a > 0) || !(b > 0)) {
    return {
      cmPerPxV: 0,
      cmPerPxH: 0,
      viewingAngleDeg: 0,
      tiltDeg,
      rollDeg,
      plateDiameterCm: diameter,
      confidence: 'degenerate',
      reason: 'The plate outline has no size — drag the handles onto the plate edge.',
    };
  }

  const cmPerPxV = diameter / (2 * a);
  const cmPerPxH = diameter / (2 * b);
  // b/a is cos θ by construction; clamp because a coach can drag the minor
  // handle a pixel past the major one on a nearly-perpendicular shot.
  const viewingAngleDeg = (Math.acos(Math.min(1, b / a)) * 180) / Math.PI;

  let confidence: CalibrationConfidence = 'ok';
  let reason: string | null = null;
  if (a < MIN_TRUSTWORTHY_SEMI_MAJOR_PX) {
    confidence = 'degenerate';
    reason =
      `The plate is only ${Math.round(2 * a)} px across — one pixel is ` +
      `${(cmPerPxV * 10).toFixed(0).replace('.', ',')} mm, so nothing measured here is worth quoting. ` +
      'Film closer, or analyse a clip with more resolution.';
  } else if (viewingAngleDeg > MAX_VALID_VIEWING_ANGLE_DEG) {
    confidence = 'wide';
    reason =
      `The camera is ${viewingAngleDeg.toFixed(0).replace('.', ',')}° off perpendicular, past the ` +
      `${MAX_VALID_VIEWING_ANGLE_DEG}° the flat-plate model is good for. Horizontal ` +
      'distances especially are approximate.';
  }

  return {
    cmPerPxV,
    cmPerPxH,
    viewingAngleDeg,
    tiltDeg,
    rollDeg,
    plateDiameterCm: diameter,
    confidence,
    reason,
  };
}

/** Fold a tilt into (-90, 90]. A plate rotated 100° is a plate rotated -80°;
 *  keeping the small value makes the panel's readout legible. */
export function normaliseTilt(deg: number): number {
  let t = ((deg + 90) % 180 + 180) % 180 - 90;
  if (t === -90) t = 90;
  return t;
}

/** Unit vectors at `deg` clockwise from image vertical, in image coordinates
 *  (y down). `up` at 0° is (0,−1), the top of the frame; `right` is (1,0). */
function frameAxes(deg: number): { up: PxPoint; right: PxPoint } {
  const phi = (deg * Math.PI) / 180;
  return {
    up: { x: Math.sin(phi), y: -Math.cos(phi) },
    right: { x: Math.cos(phi), y: Math.sin(phi) },
  };
}

/**
 * Convert a pixel displacement to centimetres in the movement plane.
 *
 * The model. Under weak perspective a circle of radius R in the movement
 * plane maps to the image by a linear map M; the ellipse IS that map, up to a
 * rotation ψ within the plane that a circle cannot reveal. Inverting it:
 *
 *     N(δ) = ( (δ·n)·cmPerPxH , (δ·m)·cmPerPxV )
 *
 * with m, n the unit vectors along the major and minor axes — a displacement
 * measured in the plane, but in a frame rotated by the unknown ψ. Lengths and
 * angles in that frame are right; which way is up in it is not known.
 *
 * Gravity supplies it. Plane-up is what the image vertical (rotated by the
 * camera roll) maps to under the same N, so with ĝ = N(up)/|N(up)|:
 *
 *     y = N(δ)·ĝ        x = N(δ)·ĝ⊥
 *
 * Two properties make this the right model on real footage, and both are the
 * opposite of what "rotate onto the ellipse axes" did:
 *
 *   - a vertical image displacement is ALWAYS purely vertical in the result;
 *     no orientation noise can leak height into the loop;
 *   - as the ellipse tends to a circle, N tends to a uniform scale and the
 *     orientation drops out entirely — so the one case where the orientation
 *     is worst determined is the case where it matters least.
 *
 * At tilt 0 this is the plain anisotropic model (vertical by the major axis,
 * horizontal by the minor); at tilt 90 the scales swap, which is what a plate
 * foreshortened vertically — a camera looking down on the bar — needs. A
 * diagonal is still never `px · cmPerPxV`.
 */
export function displacementToCm(cal: Calibration, dxPx: number, dyPx: number): CmPoint {
  const axes = frameAxes(cal.tiltDeg);
  const map = (px: number, py: number): CmPoint => ({
    x: (px * axes.right.x + py * axes.right.y) * cal.cmPerPxH,
    y: (px * axes.up.x + py * axes.up.y) * cal.cmPerPxV,
  });
  const gravity = frameAxes(cal.rollDeg).up;
  const g = map(gravity.x, gravity.y);
  const gLen = Math.hypot(g.x, g.y);
  if (!(gLen > 0)) return { x: 0, y: 0 };
  const gx = g.x / gLen;
  const gy = g.y / gLen;
  const v = map(dxPx, dyPx);
  return {
    x: v.x * gy - v.y * gx,
    y: v.x * gx + v.y * gy,
  };
}

/** Distance in cm between two display-space points, honouring both scales. */
export function distanceCm(cal: Calibration, from: PxPoint, to: PxPoint): number {
  const d = displacementToCm(cal, to.x - from.x, to.y - from.y);
  return Math.hypot(d.x, d.y);
}

/**
 * Angle at `vertex` between two arms, degrees in [0, 180].
 *
 * Computed in CALIBRATED space when a calibration exists, because an angle read
 * off a foreshortened frame is simply the wrong angle: at 30° off perpendicular
 * a true 45° reads as 40°. Pass `null` to measure the frame as drawn.
 */
export function angleDeg(
  cal: Calibration | null,
  armA: PxPoint,
  vertex: PxPoint,
  armB: PxPoint,
): number {
  const toCm = (p: PxPoint): CmPoint =>
    cal ? displacementToCm(cal, p.x - vertex.x, p.y - vertex.y) : { x: p.x - vertex.x, y: -(p.y - vertex.y) };
  const a = toCm(armA);
  const b = toCm(armB);
  const magA = Math.hypot(a.x, a.y);
  const magB = Math.hypot(b.x, b.y);
  if (magA === 0 || magB === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (magA * magB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** One marked point on the bar's path. `t` is the frame's real presentation
 *  timestamp — never an index divided by a nominal fps (design §6.3). */
export interface TrackPoint {
  t: number;
  x: number;
  y: number;
}

/**
 * What geometry alone can say about a marked path.
 *
 * Deliberately no velocity: differentiating hand-placed clicks at ~2 mm/px
 * turns a one-pixel tremor into roughly ±0,1 m/s at 60 fps — twice the everyday
 * accuracy tier this product promises. Velocity arrives in P2 with the
 * Butterworth pipeline and the quality grade that make it honest
 * (docs/KINEMOS_P1_PLAN.md decision 5).
 */
export interface PathMetrics {
  pointCount: number;
  /** Seconds between the first and last marked frame. */
  durationS: number;
  /** Highest point minus lowest, along the bar's travel axis. */
  riseCm: number;
  /** Height gained from the FIRST marked point — what a coach means by "how
   *  high did it go" when the mark starts at the floor. */
  peakAboveStartCm: number;
  /** Total horizontal spread of the path: the loop, end to end. */
  loopWidthCm: number;
  /** Horizontal distance from the first mark to the last — where the bar
   *  finished relative to where it started. Signed: positive is to the right
   *  of frame, which is why the UI must say which way that is. */
  netDriftCm: number;
  /** Distance actually travelled along the path. */
  pathLengthCm: number;
  /** False when there is no calibration: every figure above is then in
   *  PIXELS, and the UI must say so rather than print a bare number. */
  calibrated: boolean;
}

/**
 * Path metrics from marked points. With `cal === null` the same numbers come
 * back in pixels and `calibrated` is false — the viewer stays useful before
 * calibration, and says which unit it is speaking.
 */
export function pathMetrics(points: readonly TrackPoint[], cal: Calibration | null): PathMetrics {
  const empty: PathMetrics = {
    pointCount: points.length,
    durationS: 0,
    riseCm: 0,
    peakAboveStartCm: 0,
    loopWidthCm: 0,
    netDriftCm: 0,
    pathLengthCm: 0,
    calibrated: cal !== null,
  };
  if (points.length < 2) return empty;

  const origin = points[0];
  // Map every point into the calibration frame (y up, cm) relative to the
  // first mark. Uncalibrated, the same relative frame in pixels.
  const rel = points.map(p =>
    cal
      ? displacementToCm(cal, p.x - origin.x, p.y - origin.y)
      : { x: p.x - origin.x, y: -(p.y - origin.y) },
  );

  let minY = rel[0].y;
  let maxY = rel[0].y;
  let minX = rel[0].x;
  let maxX = rel[0].x;
  let length = 0;
  for (let i = 0; i < rel.length; i++) {
    minY = Math.min(minY, rel[i].y);
    maxY = Math.max(maxY, rel[i].y);
    minX = Math.min(minX, rel[i].x);
    maxX = Math.max(maxX, rel[i].x);
    if (i > 0) length += Math.hypot(rel[i].x - rel[i - 1].x, rel[i].y - rel[i - 1].y);
  }

  return {
    pointCount: points.length,
    durationS: points[points.length - 1].t - points[0].t,
    riseCm: maxY - minY,
    peakAboveStartCm: maxY,
    loopWidthCm: maxX - minX,
    netDriftCm: rel[rel.length - 1].x,
    pathLengthCm: length,
    calibrated: cal !== null,
  };
}
