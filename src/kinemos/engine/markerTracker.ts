/**
 * markerTracker — design §6.2's tracking tier 2, the 0,02 m/s setup.
 *
 * A coach who is serious about a number puts a high-contrast sticker on the
 * bar end cap. That changes the tracking problem completely, and for the
 * better: the plate template tier follows a large disc whose appearance
 * rotates, blurs and passes behind a thigh, and does well to hold a pixel; a
 * marker is a small patch of one colour that nothing else in the gym shares,
 * and its centroid is an average over dozens of pixels — which is why the
 * grade prices this tier at 0,4 px against the template tier's 0,8.
 *
 * So the marker is not tracked by correlation at all. Its colour is sampled
 * where the coach clicked, and every frame the nearest patch of that colour
 * to where the marker was heading is found and its centroid taken. Rotation
 * cannot hurt it, motion blur only spreads the patch (the centroid survives),
 * and the search radius follows the same physics the template tracker uses.
 *
 * The frames arrive through an injected source rather than a `FrameServer`,
 * which is what lets the whole tier be tested on drawn frames with no video
 * and no browser.
 */
import type { PxPoint } from './calibration';
import { findColourBlob, sampleSpotColour, type PlateColourModel, type RgbaImage } from './plateColour';

/** Colour frames, however the caller has them. */
export interface RgbaSource {
  frameCount: number;
  timestamps: readonly number[];
  getRgba(index: number): Promise<RgbaImage>;
}

export interface MarkerAnchor {
  index: number;
  x: number;
  y: number;
}

export interface MarkerPoint {
  index: number;
  t: number;
  x: number;
  y: number;
  /** How much of a marker-sized disc the patch filled: 1 is the whole
   *  marker, less is a marker partly hidden or blurred thin. Stands in for
   *  the template tier's correlation. */
  confidence: number;
  predictionErrorPx: number;
}

export interface MarkerTrackOptions {
  /** The marker's on-screen radius, px. Default: a fortieth of the frame
   *  height, which is a 2 cm sticker on a phone clip at gym distance. */
  radiusPx?: number;
  /** How far from the prediction to look. Default follows the physics: a bar
   *  end reaches about 3 m/s, and a marker of radius r on a 5 cm cap covers
   *  2,5 cm, so 3·2·r/(0,05·fps) px per frame, with a floor. */
  searchRadiusPx?: number;
  /** Least fill to accept a patch as the marker. */
  minFill?: number;
  /** Consecutive misses before the track is given up. */
  giveUpAfter?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface MarkerTrackResult {
  points: MarkerPoint[];
  lowConfidenceIndices: number[];
  gaveUp: boolean;
  /** The colour it followed, or null when the anchor was not on one. */
  colour: PlateColourModel | null;
}

const DEFAULT_MIN_FILL = 0.35;
const DEFAULT_GIVE_UP = 8;

/** Where the marker is heading, from the last two points. */
function predict(points: readonly MarkerPoint[]): PxPoint {
  const n = points.length;
  const last = points[n - 1];
  if (n < 2) return { x: last.x, y: last.y };
  const before = points[n - 2];
  return { x: last.x + (last.x - before.x), y: last.y + (last.y - before.y) };
}

/**
 * Follow a marker from the coach's click, forwards then backwards.
 *
 * Null colour — the click was not on anything coloured — is a result, not an
 * error: it means this clip has no marker on the bar and the coach wants the
 * template tier.
 */
export async function trackMarker(
  source: RgbaSource,
  anchor: MarkerAnchor,
  options: MarkerTrackOptions = {},
): Promise<MarkerTrackResult> {
  const first = await source.getRgba(anchor.index);
  const radiusPx = options.radiusPx ?? Math.max(3, first.height / 40);
  const colour = sampleSpotColour(first, { x: anchor.x, y: anchor.y }, radiusPx);
  if (!colour) {
    return { points: [], lowConfidenceIndices: [], gaveUp: true, colour: null };
  }

  const dt = medianStep(source.timestamps);
  const fps = dt > 0 ? 1 / dt : 30;
  // Same physics as the template tracker's radius, in the marker's units.
  const searchRadiusPx = options.searchRadiusPx ?? Math.max(12, Math.ceil((3 * 2 * radiusPx) / (0.05 * fps)));
  const minFill = options.minFill ?? DEFAULT_MIN_FILL;
  const giveUpAfter = options.giveUpAfter ?? DEFAULT_GIVE_UP;

  const anchorPoint: MarkerPoint = {
    index: anchor.index,
    t: source.timestamps[anchor.index] ?? 0,
    x: anchor.x,
    y: anchor.y,
    // The coach put it there.
    confidence: 1,
    predictionErrorPx: 0,
  };

  let gaveUp = false;
  const low: number[] = [];
  const walk = async (direction: 1 | -1): Promise<MarkerPoint[]> => {
    const points: MarkerPoint[] = [anchorPoint];
    let misses = 0;
    for (let step = 1; ; step++) {
      const index = anchor.index + direction * step;
      if (index < 0 || index >= source.frameCount) break;
      const image = await source.getRgba(index);
      const prediction = predict(points);
      const blob = findColourBlob(image, colour, {
        near: prediction,
        // A miss widens the net: the marker moved further than expected, or
        // was hidden for a frame and has moved on since.
        searchRadiusPx: searchRadiusPx * (1 + misses * 0.5),
        radiusPx,
        step: 1,
        minFill,
      });
      if (!blob) {
        misses++;
        low.push(index);
        if (misses >= giveUpAfter) {
          gaveUp = true;
          break;
        }
        continue;
      }
      misses = 0;
      const point: MarkerPoint = {
        index,
        t: source.timestamps[index] ?? 0,
        x: blob.x,
        y: blob.y,
        confidence: Math.min(1, blob.fill),
        predictionErrorPx: Math.hypot(blob.x - prediction.x, blob.y - prediction.y),
      };
      if (point.confidence < minFill * 1.5) low.push(index);
      points.push(point);
      options.onProgress?.(step, source.frameCount);
    }
    // The anchor belongs to whichever walk is joined first; drop it here.
    return points.slice(1);
  };

  const forward = await walk(1);
  const backward = await walk(-1);
  const points = [...backward.reverse(), anchorPoint, ...forward];
  return {
    points,
    lowConfidenceIndices: [...new Set(low)].sort((a, b) => a - b),
    gaveUp,
    colour,
  };
}

function medianStep(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i] - timestamps[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}
