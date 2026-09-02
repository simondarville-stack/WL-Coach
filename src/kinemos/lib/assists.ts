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
import { findPlate, refinePlateEllipse, type RefineResult } from '../cv/plate';
import { estimateCameraMotion, motionSummary, stabilisePoints } from '../cv/stabilise';
import type { KinemosTrackPoint } from '../../lib/database.types';
import { trackerSourceFrom } from './trackerSource';

/** Plausible plate radii on this frame: 3–22 % of the frame height covers a
 *  phone at arm's length to a phone at the back of the hall. */
function radiusRange(server: FrameServer): { minRadiusPx: number; maxRadiusPx: number } {
  return {
    minRadiusPx: Math.max(6, Math.round(server.displayHeight * 0.03)),
    maxRadiusPx: Math.round(server.displayHeight * 0.22),
  };
}

/** Find the plate on one frame with no outline at all. */
export async function findPlateOnFrame(
  server: FrameServer,
  index: number,
  near?: { x: number; y: number },
): Promise<RefineResult | null> {
  const source = trackerSourceFrom(server);
  try {
    const gray = await source.getGray(index);
    return await findPlate(gray, { ...radiusRange(server), near });
  } finally {
    source.dispose();
  }
}

/** Snap a drawn outline to the plate's edge on one frame. */
export async function snapEllipseOnFrame(
  server: FrameServer,
  index: number,
  ellipse: PlateEllipse,
): Promise<RefineResult | null> {
  const source = trackerSourceFrom(server);
  try {
    const gray = await source.getGray(index);
    return await refinePlateEllipse(gray, ellipse);
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
 * `strongest` picks the plate's own edge over the shadow's below it, which
 * for a centre is what matters — a shadow that grows and shrinks with the
 * lighting along the pull would otherwise pull the centre with it.
 */
export async function recentreTrackOnOutline(
  server: FrameServer,
  points: readonly KinemosTrackPoint[],
  axes: { semiMajorPx: number; semiMinorPx: number; tiltDeg: number },
  onProgress?: (done: number, total: number) => void,
): Promise<RecentreTrackResult> {
  const source = trackerSourceFrom(server);
  try {
    const out: KinemosTrackPoint[] = [];
    let recentred = 0;
    let kept = 0;
    let largestMovePx = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const gray = await source.getGray(server.nearestIndex(p.t));
      const fit = await refinePlateEllipse(
        gray,
        { cx: p.x, cy: p.y, semiMajorPx: axes.semiMajorPx, semiMinorPx: axes.semiMinorPx, tiltDeg: axes.tiltDeg },
        { pick: 'strongest' },
      );
      if (fit && fit.support >= MIN_RECENTRE_SUPPORT) {
        largestMovePx = Math.max(largestMovePx, Math.hypot(fit.ellipse.cx - p.x, fit.ellipse.cy - p.y));
        out.push({ ...p, x: fit.ellipse.cx, y: fit.ellipse.cy });
        recentred++;
      } else {
        out.push({ ...p });
        kept++;
      }
      onProgress?.(i + 1, points.length);
    }
    return { points: out, recentred, kept, largestMovePx };
  } finally {
    source.dispose();
  }
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
