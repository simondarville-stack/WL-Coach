/**
 * assists — the OpenCV helpers, in the shape the viewer needs them.
 *
 * Each takes the frame server and returns plain numbers the viewer already
 * stores: a `PlateEllipse`, a list of track points. The cv layer is loaded
 * on the first call, which is when the coach first asks for one of these —
 * never before.
 */
import type { PlateEllipse } from '../engine/calibration';
import type { FrameServer } from '../engine/frameServer';
import { findPlate, refinePlateEllipse, type RefineOptions, type RefineResult } from '../cv/plate';
import { estimateCameraMotion, motionSummary, stabilisePoints } from '../cv/stabilise';
import type { KinemosTrackPoint } from '../../lib/database.types';
import { trackMarker } from '../engine/markerTracker';
import { trackerSourceFrom } from './trackerSource';

/** Plausible plate radii on this frame: 3–22 % of the frame height covers a
 *  phone at arm's length to a phone at the back of the hall. */
function radiusRange(server: FrameServer): { minRadiusPx: number; maxRadiusPx: number } {
  return {
    minRadiusPx: Math.max(6, Math.round(server.displayHeight * 0.03)),
    maxRadiusPx: Math.round(server.displayHeight * 0.22),
  };
}

/**
 * How the outline is fitted. `shape: 'circle'` is for a plate the coach knows
 * to be round, filmed square-on: three parameters, no orientation to invent,
 * and the radius is the scale. Off perpendicular the plate is an ellipse and
 * the default applies.
 */
export type OutlineFitOptions = Pick<RefineOptions, 'shape'>;

/** Find the plate on one frame with no outline at all. */
export async function findPlateOnFrame(
  server: FrameServer,
  index: number,
  near?: { x: number; y: number },
  fit: OutlineFitOptions = {},
): Promise<RefineResult | null> {
  const source = trackerSourceFrom(server);
  try {
    const gray = await source.getGray(index);
    return await findPlate(gray, { ...radiusRange(server), near, ...fit });
  } finally {
    source.dispose();
  }
}

/** Snap a drawn outline to the plate's edge on one frame. */
export async function snapEllipseOnFrame(
  server: FrameServer,
  index: number,
  ellipse: PlateEllipse,
  fit: OutlineFitOptions = {},
): Promise<RefineResult | null> {
  const source = trackerSourceFrom(server);
  try {
    const gray = await source.getGray(index);
    return await refinePlateEllipse(gray, ellipse, fit);
  } finally {
    source.dispose();
  }
}

export interface RecentreTrackResult {
  points: KinemosTrackPoint[];
  /** Frames whose point now sits on the fitted outline's centre. */
  recentred: number;
  /** Frames that kept the tracker's point — too little rim found. */
  kept: number;
  /** The largest move any point made, px. */
  largestMovePx: number;
  /**
   * The plate as fitted at MID-PULL: the median outline over the frames in
   * the middle third of the track's height, placed at the frame nearest that
   * band's centre. On the floor the plate's shadow merges with its bottom
   * edge and the camera looks slightly down on it, so its thickness shows
   * above the face; at the top the same happens the other way up. Mid-pull
   * the plate is at camera height and is only itself — on the first real
   * footage the floor-frame outline read 4–9 % large, the mid-pull one was
   * steady to under 1 % across the band, and the two views agreed once both
   * were read there (docs/KINEMOS_ACCURACY_STUDY.md §3.6). Null when fewer
   * than eight frames in the band could be fitted.
   */
  midPull: { ellipse: PlateEllipse; t: number; frames: number; residualPx: number } | null;
}

/**
 * Put every point on the centre of the plate's OUTLINE rather than on the
 * template match.
 *
 * The tracker follows the plate's appearance — the face pattern the coach
 * anchored on — and appearance moves relative to the plate's geometry: the
 * disc turns on the sleeve, blurs through the second pull, is lit from a
 * different angle at the top of the pull than at the bottom. On the first real
 * footage those moved the side view's peak velocity 5 % away from a second
 * view of the same lift, and re-fitting the outline on every frame brought
 * the two to within 1 % (docs/KINEMOS_ACCURACY_STUDY.md). The tracker's point
 * seeds each fit, so this is a refinement, not a replacement: a frame where
 * the rim is mostly hidden keeps the tracker's point, and says so.
 *
 * The edge is the plate's face (`DEFAULT_EDGE_PICK`), never the shadow's
 * below it or the rim's thickness above — for a centre that is what matters:
 * a shadow that grows and shrinks with the lighting along the pull would
 * otherwise pull the centre with it.
 */
export async function recentreTrackOnOutline(
  server: FrameServer,
  points: readonly KinemosTrackPoint[],
  axes: { semiMajorPx: number; semiMinorPx: number; tiltDeg: number },
  onProgress?: (done: number, total: number) => void,
  options: OutlineFitOptions = {},
): Promise<RecentreTrackResult> {
  const source = trackerSourceFrom(server);
  try {
    const out: KinemosTrackPoint[] = [];
    const fits: Array<{ t: number; fit: RefineResult }> = [];
    let recentred = 0;
    let kept = 0;
    let largestMovePx = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const gray = await source.getGray(server.nearestIndex(p.t));
      const fit = await refinePlateEllipse(
        gray,
        { cx: p.x, cy: p.y, semiMajorPx: axes.semiMajorPx, semiMinorPx: axes.semiMinorPx, tiltDeg: axes.tiltDeg },
        options,
      );
      if (fit && fit.support >= MIN_RECENTRE_SUPPORT) {
        largestMovePx = Math.max(largestMovePx, Math.hypot(fit.ellipse.cx - p.x, fit.ellipse.cy - p.y));
        out.push({ ...p, x: fit.ellipse.cx, y: fit.ellipse.cy });
        fits.push({ t: p.t, fit });
        recentred++;
      } else {
        out.push({ ...p });
        kept++;
      }
      onProgress?.(i + 1, points.length);
    }
    return { points: out, recentred, kept, largestMovePx, midPull: midPullOutline(fits) };
  } finally {
    source.dispose();
  }
}

/** See `RecentreTrackResult.midPull`. */
function midPullOutline(
  fits: ReadonlyArray<{ t: number; fit: RefineResult }>,
): RecentreTrackResult['midPull'] {
  if (fits.length < 8) return null;
  const ys = fits.map(f => f.fit.ellipse.cy);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const lo = yMin + (yMax - yMin) / 3;
  const hi = yMin + (2 * (yMax - yMin)) / 3;
  const band = fits.filter(f => f.fit.ellipse.cy >= lo && f.fit.ellipse.cy <= hi);
  if (band.length < 8) return null;
  const median = (values: number[]): number => {
    const s = [...values].sort((a, b) => a - b);
    return s[s.length >> 1];
  };
  const semiMajorPx = median(band.map(f => f.fit.ellipse.semiMajorPx));
  const semiMinorPx = median(band.map(f => f.fit.ellipse.semiMinorPx));
  const tiltDeg = median(band.map(f => f.fit.ellipse.tiltDeg));
  const residualPx = median(band.map(f => f.fit.residualPx));
  // The frame nearest the band's centre carries the outline, at its own
  // fitted centre, so the calibration frame shows the plate it describes.
  const mid = (lo + hi) / 2;
  let nearest = band[0];
  for (const f of band) if (Math.abs(f.fit.ellipse.cy - mid) < Math.abs(nearest.fit.ellipse.cy - mid)) nearest = f;
  return {
    ellipse: { cx: nearest.fit.ellipse.cx, cy: nearest.fit.ellipse.cy, semiMajorPx, semiMinorPx, tiltDeg },
    t: nearest.t,
    frames: band.length,
    residualPx,
  };
}

/** Below this much of the rim, the fit is not trusted over the tracker. */
const MIN_RECENTRE_SUPPORT = 0.6;

export interface StabiliseTrackResult {
  points: KinemosTrackPoint[];
  /** How far the camera moved over the clip, px. */
  maxShiftPx: number;
  /** The largest correction applied to any point, px. */
  maxCorrectionPx: number;
  /** Frames where the background gave too few corners to trust. */
  weakFrames: number;
}

/**
 * Take the camera's motion out of a track. The anchor is the frame nearest
 * the given time; the plate's own pixels are excluded from the background on
 * every frame, using the track itself to say where they are.
 */
export async function stabiliseTrack(
  server: FrameServer,
  anchorT: number,
  points: readonly KinemosTrackPoint[],
  plateRadiusPx: number,
  onProgress?: (done: number, total: number) => void,
): Promise<StabiliseTrackResult> {
  const source = trackerSourceFrom(server);
  try {
    const anchorIndex = server.nearestIndex(anchorT);
    const indexed = points.map(p => ({ ...p, index: server.nearestIndex(p.t) }));
    const byIndex = new Map(indexed.map(p => [p.index, p]));
    const motions = await estimateCameraMotion(source, anchorIndex, {
      exclude: i => {
        const p = byIndex.get(i);
        return p ? { x: p.x, y: p.y, r: plateRadiusPx } : null;
      },
      onProgress,
    });
    const corrected = stabilisePoints(indexed, motions);
    let maxCorrectionPx = 0;
    corrected.forEach((p, k) => {
      maxCorrectionPx = Math.max(maxCorrectionPx, Math.hypot(p.x - indexed[k].x, p.y - indexed[k].y));
    });
    const summary = motionSummary(motions);
    return {
      points: corrected.map(({ t, x, y, s }) => ({ t, x, y, s })),
      maxShiftPx: summary.maxShiftPx,
      maxCorrectionPx,
      weakFrames: summary.weakFrames,
    };
  } finally {
    source.dispose();
  }
}

/**
 * Follow a marker on the bar end from one click — design §6.2's tracking
 * tier 2. The engine does the work on colour frames; this hands it the
 * frame server's and converts the result to the points the viewer stores.
 */
export async function trackMarkerFrom(
  server: FrameServer,
  anchor: { index: number; x: number; y: number },
  onProgress?: (done: number, total: number) => void,
): Promise<{ points: KinemosTrackPoint[]; lowConfidenceIndices: number[]; gaveUp: boolean; found: boolean }> {
  const source = trackerSourceFrom(server);
  try {
    const result = await trackMarker(
      { frameCount: server.frameCount, timestamps: server.timestamps, getRgba: i => source.getRgba(i) },
      anchor,
      { onProgress },
    );
    return {
      points: result.points.map(p => ({ t: p.t, x: p.x, y: p.y, s: 't' as const })),
      lowConfidenceIndices: result.lowConfidenceIndices,
      gaveUp: result.gaveUp,
      found: result.colour !== null,
    };
  } finally {
    source.dispose();
  }
}
