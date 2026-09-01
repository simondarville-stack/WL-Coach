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
 * vertical. It is usually a couple of degrees (a hand-held phone is never
 * quite level); it exists because assuming zero would tilt every measured
 * height by the same error.
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
  /** Clockwise tilt of the major axis from image vertical, degrees. */
  tiltDeg: number;
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
export function calibrateFromEllipse(
  ellipse: PlateEllipse,
  plateDiameterCm: number = DEFAULT_PLATE_DIAMETER_CM,
): Calibration {
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
      `${(cmPerPxV * 10).toFixed(0)} mm, so nothing measured here is worth quoting. ` +
      'Film closer, or analyse a clip with more resolution.';
  } else if (viewingAngleDeg > MAX_VALID_VIEWING_ANGLE_DEG) {
    confidence = 'wide';
    reason =
      `The camera is ${viewingAngleDeg.toFixed(0)}° off perpendicular, past the ` +
      `${MAX_VALID_VIEWING_ANGLE_DEG}° the flat-plate model is good for. Horizontal ` +
      'distances especially are approximate.';
  }

  return { cmPerPxV, cmPerPxH, viewingAngleDeg, tiltDeg, plateDiameterCm: diameter, confidence, reason };
}

/** Fold a tilt into (-90, 90]. A plate rotated 100° is a plate rotated -80°;
 *  keeping the small value makes the panel's readout legible. */
export function normaliseTilt(deg: number): number {
  let t = ((deg + 90) % 180 + 180) % 180 - 90;
  if (t === -90) t = 90;
  return t;
}

/** Unit vectors of the calibration frame, in image coordinates (y down).
 *  `up` runs along the major axis toward the top of frame; `right` across it. */
function frameAxes(tiltDeg: number): { up: PxPoint; right: PxPoint } {
  const phi = (tiltDeg * Math.PI) / 180;
  // tilt 0 ⇒ up = (0,-1) (image y grows downward), right = (1,0).
  return {
    up: { x: Math.sin(phi), y: -Math.cos(phi) },
    right: { x: Math.cos(phi), y: Math.sin(phi) },
  };
}

/**
 * Convert a pixel displacement to centimetres in the movement plane.
 *
 * This is the whole point of the anisotropic model: the displacement is
 * decomposed onto the plate's own axes and each component gets ITS scale. A
 * diagonal is not `px · cmPerPxV`, and a viewer that treats it as one reports a
 * loop-back 13 % short at 30°.
 */
export function displacementToCm(cal: Calibration, dxPx: number, dyPx: number): CmPoint {
  const { up, right } = frameAxes(cal.tiltDeg);
  const alongUp = dxPx * up.x + dyPx * up.y;
  const alongRight = dxPx * right.x + dyPx * right.y;
  return { x: alongRight * cal.cmPerPxH, y: alongUp * cal.cmPerPxV };
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
