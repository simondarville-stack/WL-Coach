/**
 * trackedPoints — what a stored point remembers of the tracker's opinion.
 *
 * The tracker scores every frame (`TrackedPoint.confidence`, the peak
 * normalised cross-correlation) and the viewer used to keep only the list of
 * frames under the floor. The score itself is worth keeping: it is what the
 * confidence strip on "Tracking & correction" draws, and it is how the flagged
 * frames come back when a rep is reopened — the list alone was session state
 * and vanished on reload. So a tracked point carries `c`, two decimals, and a
 * hand-marked point carries none: a coach's click is not a correlation.
 *
 * Bands, from the tracker's own thresholds: ≥ 0,80 is a solid match (the
 * comment on `TrackedPoint.confidence`), under `minConfidence` the frame is
 * flagged, and between the two the match held but is worth a look.
 */
import type { KinemosTrackPoint } from '../../lib/database.types';
import { DEFAULT_TRACK_OPTIONS, type TrackedPoint } from '../engine/tracker';

/** Above this the tracker had a solid match. */
export const CONFIDENCE_SOLID = 0.8;
/** Below this the frame is flagged — the tracker's own floor. */
export const CONFIDENCE_FLAGGED = DEFAULT_TRACK_OPTIONS.minConfidence;

export type ConfidenceBand = 'manual' | 'solid' | 'doubtful' | 'flagged' | 'unscored';

/** The stored form of a tracked frame. */
export function toTrackPoint(p: TrackedPoint): KinemosTrackPoint {
  return { t: p.t, x: p.x, y: p.y, s: 't', c: Math.round(p.confidence * 100) / 100 };
}

export function bandOf(point: Pick<KinemosTrackPoint, 's' | 'c'>): ConfidenceBand {
  if (point.s === 'm') return 'manual';
  const c = point.c;
  if (c === undefined || c === null || !Number.isFinite(c)) return 'unscored';
  if (c >= CONFIDENCE_SOLID) return 'solid';
  if (c < CONFIDENCE_FLAGGED) return 'flagged';
  return 'doubtful';
}

export interface FrameConfidence {
  index: number;
  c: number | null;
  band: ConfidenceBand;
}

/**
 * Every stored point placed on its frame, in frame order. `nearestIndex` is
 * the frame server's; a point whose time it cannot place is left out rather
 * than drawn somewhere wrong. Two points on one frame: the later in the
 * list wins, which is the corrected one.
 */
export function frameConfidences(
  points: readonly KinemosTrackPoint[],
  nearestIndex: (t: number) => number,
): FrameConfidence[] {
  const byIndex = new Map<number, FrameConfidence>();
  for (const p of points) {
    const index = nearestIndex(p.t);
    if (!Number.isInteger(index) || index < 0) continue;
    byIndex.set(index, { index, c: p.s === 'm' ? null : (p.c ?? null), band: bandOf(p) });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** The frames a reopened rep should list as flagged — the same rule the
 *  tracker applied when it ran. */
export function lowConfidenceFrames(
  points: readonly KinemosTrackPoint[],
  nearestIndex: (t: number) => number,
): number[] {
  return frameConfidences(points, nearestIndex)
    .filter(f => f.band === 'flagged')
    .map(f => f.index);
}

export interface ConfidenceRun {
  /** First and last frame of the run, inclusive. */
  from: number;
  to: number;
  band: ConfidenceBand | 'none';
  /** Mean score over the run; null for hand marks, unscored and empty runs. */
  c: number | null;
}

/**
 * The frames grouped into runs of one band, covering the clip from frame 0
 * to `frameCount − 1`; frames with no point are runs of `'none'`. This is
 * what the strip draws — one rect per run rather than one per frame, which
 * on a 600-frame clip is the difference between a dozen nodes and six
 * hundred.
 */
export function confidenceRuns(frames: readonly FrameConfidence[], frameCount: number): ConfidenceRun[] {
  const runs: ConfidenceRun[] = [];
  let sum = 0;
  let scored = 0;
  const push = (from: number, to: number, band: ConfidenceRun['band']) => {
    runs.push({ from, to, band, c: scored > 0 ? sum / scored : null });
    sum = 0;
    scored = 0;
  };
  let cursor = 0;
  let open: { from: number; band: ConfidenceRun['band'] } | null = null;
  for (const f of frames) {
    if (f.index >= frameCount) break;
    if (f.index > cursor) {
      if (open) {
        push(open.from, cursor - 1, open.band);
        open = null;
      }
      push(cursor, f.index - 1, 'none');
    }
    if (open && open.band !== f.band) {
      push(open.from, f.index - 1, open.band);
      open = null;
    }
    if (!open) open = { from: f.index, band: f.band };
    if (f.c !== null) {
      sum += f.c;
      scored++;
    }
    cursor = f.index + 1;
  }
  if (open) push(open.from, cursor - 1, open.band);
  if (cursor < frameCount) push(cursor, frameCount - 1, 'none');
  return runs;
}
