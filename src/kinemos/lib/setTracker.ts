/**
 * setTracker — a whole set from one click.
 *
 * A coach films a double or a triple, not a rep. The tracker follows the
 * plate through the first rep and loses it on the drop, which is fine: the
 * bar comes back to rest before the next rep, and a plate at rest near where
 * the set started can be found again. So a set is tracked as: track from the
 * anchor; when the tracker gives up, look for the plate on later frames near
 * the set's start; track on from there; repeat to the end. The joined track
 * is then cut into reps by the engine (`engine/reps.ts`), and each rep is
 * calibrated on the plate as it sat at ITS rest — the phone, or the bar, may
 * have moved between reps.
 *
 * Two things a naive version got wrong on the first sets, both kept here:
 *
 *   - **Round is not enough.** A fan behind the platform is round, and
 *     `findPlate` will return it with a straight face. A candidate has to
 *     look like the plate the set started with: the anchor's own template,
 *     matched on the candidate's frame, must correlate.
 *   - **A rest fit that disagrees with the set's by more than 8 % is not
 *     believed.** A lifter standing over the bar, the discs behind peeking
 *     out — the set's calibration then stands for that rep.
 *
 * This is the lib layer: it may use the cv assists. The engine it calls stays
 * pure. The same procedure runs in `verify/track-clip.html?reps=1`.
 */
import { calibrateFromEllipse, type Calibration, type PlateEllipse } from '../engine/calibration';
import type { FrameServer } from '../engine/frameServer';
import { splitReps, type RepSegment } from '../engine/reps';
import { trackDirection, trackFromAnchor, type FrameSource, type TrackedPoint } from '../engine/tracker';
import { findPlate, refinePlateEllipse } from '../cv/plate';
import type { KinemosTrackPoint } from '../../lib/database.types';
import { trackerSourceFrom } from './trackerSource';

export interface TrackedRep {
  rep: number;
  segment: RepSegment;
  /** The rep's own samples, lift-off to catch. */
  points: KinemosTrackPoint[];
  /** The plate as outlined at this rep's rest, or the set's outline when the
   *  rest fit was not believed. */
  ellipse: PlateEllipse;
  calibration: Calibration;
  /** True when the rep carries its own calibration. */
  ownCalibration: boolean;
  /** Frames in this rep the tracker was unsure about. */
  lowConfidenceIndices: number[];
}

export interface TrackSetResult {
  /** Every point tracked, all reps and the rests between. */
  points: KinemosTrackPoint[];
  reps: TrackedRep[];
  /** How many times the plate had to be found again. */
  joins: number;
  /** Whether the tracker was lost at the end without finding the plate again. */
  lostAtEnd: boolean;
}

export interface TrackSetOptions {
  /** The set's plate outline, from the anchor frame. */
  ellipse: PlateEllipse;
  plateDiameterCm: number;
  rollDeg?: number;
  onProgress?: (done: number, total: number) => void;
}

const REACQUIRE_STEP = 8;
const REACQUIRE_MIN_SUPPORT = 0.7;
const REACQUIRE_MIN_CORRELATION = 0.5;
const REST_FIT_FRAMES = 10;
const REST_FIT_TOLERANCE = 0.08;

export async function trackSet(
  server: FrameServer,
  anchor: { index: number; x: number; y: number },
  options: TrackSetOptions,
): Promise<TrackSetResult> {
  const source = trackerSourceFrom(server);
  try {
    const radius = Math.max(10, options.ellipse.semiMajorPx * 1.08);
    const total = server.frameCount;
    const report = (done: number) => options.onProgress?.(Math.min(done, total), total);

    const first = await trackFromAnchor(source, anchor, {
      templateRadiusPx: radius,
      onProgress: done => report(done),
    });
    const all: TrackedPoint[] = [...first.points];
    const low: number[] = [...first.lowConfidenceIndices];
    let joins = 0;
    let lostAtEnd = first.gaveUp;

    if (first.gaveUp) {
      const anchorGray = await source.getGray(anchor.index);
      const radiusOpts = {
        minRadiusPx: Math.max(6, Math.round(server.displayHeight * 0.03)),
        maxRadiusPx: Math.round(server.displayHeight * 0.22),
        near: { x: anchor.x, y: anchor.y },
      };
      let resumeFrom = all[all.length - 1].index + 10;
      while (resumeFrom < total - 10) {
        let found: { at: number; x: number; y: number } | null = null;
        for (let at = resumeFrom; at < total; at += REACQUIRE_STEP) {
          report(at);
          const gray = await source.getGray(at);
          const candidate = await findPlate(gray, radiusOpts);
          if (!candidate || candidate.support < REACQUIRE_MIN_SUPPORT) continue;
          const e = candidate.ellipse;
          const dist = Math.hypot(e.cx - anchor.x, e.cy - anchor.y);
          if (dist >= options.ellipse.semiMajorPx * 1.5) continue;
          // The set's template, matched on this frame near the candidate.
          const pair: FrameSource = {
            frameCount: 2,
            timestamps: [0, 1],
            getGray: i => Promise.resolve(i === 0 ? anchorGray : gray),
          };
          const check = await trackDirection(pair, { index: 0, x: anchor.x, y: anchor.y }, 1, {
            templateRadiusPx: radius,
            searchRadiusPx: dist + 12,
            giveUpAfter: 1,
          });
          const hit = check.points[1];
          if (hit && hit.confidence >= REACQUIRE_MIN_CORRELATION && Math.hypot(hit.x - e.cx, hit.y - e.cy) < options.ellipse.semiMajorPx * 0.5) {
            found = { at, x: e.cx, y: e.cy };
            break;
          }
        }
        if (!found) break;
        const sub: FrameSource = {
          frameCount: total - found.at,
          timestamps: source.timestamps.slice(found.at),
          getGray: i => source.getGray(i + found!.at),
        };
        const more = await trackDirection(sub, { index: 0, x: found.x, y: found.y }, 1, {
          templateRadiusPx: radius,
          onProgress: done => report(found!.at + done),
        });
        for (const p of more.points) p.index += found.at;
        all.push(...more.points);
        low.push(...more.lowConfidenceIndices.map(i => i + found!.at));
        joins++;
        lostAtEnd = more.gaveUp;
        if (!more.gaveUp) break;
        resumeFrom = all[all.length - 1].index + 10;
      }
    }

    all.sort((a, b) => a.index - b.index);
    const points: KinemosTrackPoint[] = all.map(p => ({ t: p.t, x: p.x, y: p.y, s: 't' as const }));
    const setCalibration = calibrateFromEllipse(options.ellipse, options.plateDiameterCm, { rollDeg: options.rollDeg ?? 0 });
    const segments = splitReps(points, setCalibration);

    const reps: TrackedRep[] = [];
    for (const [k, segment] of segments.entries()) {
      const repPoints = points.slice(segment.from, segment.to + 1);
      // The plate at this rep's rest: the median outline over the last frames
      // before lift-off, seeded by the tracked point.
      const restPoints = points.slice(Math.max(0, segment.from - REST_FIT_FRAMES), segment.from + 1);
      const fits: PlateEllipse[] = [];
      for (const p of restPoints) {
        const gray = await source.getGray(server.nearestIndex(p.t));
        const fit = await refinePlateEllipse(gray, { ...options.ellipse, cx: p.x, cy: p.y });
        if (fit && fit.support >= 0.6) fits.push(fit.ellipse);
      }
      let ellipse = options.ellipse;
      let calibration = setCalibration;
      let own = false;
      if (fits.length >= 3) {
        const median = (values: number[]): number => {
          const s = [...values].sort((a, b) => a - b);
          return s[s.length >> 1];
        };
        const rest: PlateEllipse = {
          cx: median(fits.map(f => f.cx)),
          cy: median(fits.map(f => f.cy)),
          semiMajorPx: median(fits.map(f => f.semiMajorPx)),
          semiMinorPx: median(fits.map(f => f.semiMinorPx)),
          tiltDeg: median(fits.map(f => f.tiltDeg)),
        };
        const cal = calibrateFromEllipse(rest, options.plateDiameterCm, { rollDeg: options.rollDeg ?? 0 });
        const ratio = cal.cmPerPxV / setCalibration.cmPerPxV;
        if (Math.abs(ratio - 1) <= REST_FIT_TOLERANCE) {
          ellipse = rest;
          calibration = cal;
          own = true;
        }
      }
      const fromIndex = server.nearestIndex(segment.liftOffT);
      const toIndex = server.nearestIndex(segment.catchT);
      reps.push({
        rep: k + 1,
        segment,
        points: repPoints,
        ellipse,
        calibration,
        ownCalibration: own,
        lowConfidenceIndices: low.filter(i => i >= fromIndex && i <= toIndex),
      });
    }

    return { points, reps, joins, lostAtEnd };
  } finally {
    source.dispose();
  }
}
