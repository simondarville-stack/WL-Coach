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
