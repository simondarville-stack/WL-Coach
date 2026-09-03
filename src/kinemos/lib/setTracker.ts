/**
 * setTracker — a whole set from one click.
 *
 * A coach films a double or a triple, not a rep. The tracker follows the
 * plate through the first rep and loses it on the drop, which is fine: the
 * bar comes back to rest before the next rep, and a plate at rest near where
 * the set started can be found again. So a set is tracked as: track from the
 * anchor; when the tracker gives up, look for the plate again; track on from
 * there; repeat to the end. The joined track is then cut into reps by the
 * engine (`engine/reps.ts`), and each rep is calibrated on the plate as it
 * sat at ITS rest — the phone, or the bar, may have moved between reps.
 *
 * Finding the plate again happens two ways, tried in this order:
 *
 *   1. **In flight, by colour.** A competition plate is red, blue, yellow or
 *      green; its colour is sampled from the outline the coach drew and a
 *      plate-sized patch of it is looked for on the frames just after the
 *      loss, near where the plate was heading (`engine/plateColour.ts`). This
 *      is what recovers a pull that blurred in front of something round —
 *      the fan behind the platform in the first phone footage — and the
 *      drop after a catch, so the frames between a loss and the next rest
 *      are not simply gone. A black plate has no colour to use and this step
 *      is skipped.
 *   2. **At the next rest, by shape.** A round thing near where the set
 *      started, on later frames. Round is not enough — the fan is round —
 *      so the candidate must also be the plate's colour when there is one,
 *      or else correlate with the set's own template.
 *
 * A rest fit that disagrees with the set's by more than 8 % is not believed
 * (a lifter standing over the bar, the discs behind peeking out): the set's
 * calibration then stands for that rep.
 *
 * This is the lib layer: it may use the cv assists. The engine it calls stays
 * pure. `verify/track-clip.html?reps=1` runs exactly this function.
 */
import { calibrateFromEllipse, type Calibration, type PlateEllipse } from '../engine/calibration';
import type { FrameServer } from '../engine/frameServer';
import {
  colourMatchFraction,
  findColourBlob,
  samplePlateColour,
  type PlateColourModel,
} from '../engine/plateColour';
import { splitReps, type RepSegment } from '../engine/reps';
import { medianInterval } from '../engine/signal';
import {
  DEFAULT_TRACK_OPTIONS,
  trackDirection,
  trackFromAnchor,
  type FrameSource,
  type TrackOptions,
  type TrackedPoint,
} from '../engine/tracker';
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

export interface SetJoin {
  /** Frame the plate was found again on. */
  at: number;
  x: number;
  y: number;
  /** How: a plate-coloured patch in flight, or a round thing at rest. */
  how: 'colour' | 'rest';
  /** Frames tracked on from there. */
  frames: number;
}

export interface TrackSetResult {
  /** Every point tracked, all reps and the rests between. */
  points: KinemosTrackPoint[];
  /** The same, with the tracker's confidence per frame. */
  tracked: TrackedPoint[];
  lowConfidenceIndices: number[];
  reps: TrackedRep[];
  /** Each time the plate had to be found again. */
  joins: SetJoin[];
  /** Whether the tracker was lost at the end without finding the plate again. */
  lostAtEnd: boolean;
  /** The plate's colour, when it had one worth using. */
  colour: PlateColourModel | null;
}

export interface TrackSetOptions {
  /** The set's plate outline, from the anchor frame. */
  ellipse: PlateEllipse;
  plateDiameterCm: number;
  rollDeg?: number;
  /** Whether to use the plate's colour. On by default; off is for finding
   *  out what colour bought. */
  colour?: boolean;
  /** Passed through to the tracker. The template radius defaults to a little
   *  more than the outline's semi-major axis. */
  trackOptions?: Omit<TrackOptions, 'onProgress'>;
  onProgress?: (done: number, total: number) => void;
  /** Something worth telling: a join, a candidate turned down, the colour. */
  onLog?: (line: string) => void;
}

const REACQUIRE_STEP = 8;
const REACQUIRE_MIN_SUPPORT = 0.7;
const REACQUIRE_MIN_CORRELATION = 0.5;
const REACQUIRE_MIN_COLOUR = 0.4;
/** How long after a loss, in seconds, to look for the plate in flight. A
 *  drop from overhead to the floor is under a second. */
const FLIGHT_WINDOW_S = 1.5;
const FLIGHT_STEP = 2;
const FLIGHT_MIN_FILL = 0.3;
const REST_FIT_FRAMES = 10;
const REST_FIT_TOLERANCE = 0.08;
const MAX_JOINS = 40;

export async function trackSet(
  server: FrameServer,
  anchor: { index: number; x: number; y: number },
  options: TrackSetOptions,
): Promise<TrackSetResult> {
  const source = trackerSourceFrom(server);
  const log = options.onLog ?? (() => undefined);
  try {
    const R = options.ellipse.semiMajorPx;
    const trackOptions: Omit<TrackOptions, 'onProgress'> = {
      templateRadiusPx: Math.max(10, R * 1.08),
      ...options.trackOptions,
    };
    const minConfidence = trackOptions.minConfidence ?? DEFAULT_TRACK_OPTIONS.minConfidence;
    const total = server.frameCount;
    const fps = 1 / Math.max(1e-3, medianInterval(source.timestamps));
    // The physics the tracker's search radius follows: a bar end at 3 m/s on
    // a plate of radius R px (45 cm) moves about 15·R/fps px a frame.
    const speedPxPerFrame = (15 * R) / fps;
    const report = (done: number) => options.onProgress?.(Math.min(done, total), total);

    // The plate's colour, from the face inside the coach's outline.
    let colour: PlateColourModel | null = null;
    if (options.colour !== false) {
      colour = samplePlateColour(await source.getRgba(anchor.index), options.ellipse);
      log(
        colour
          ? `plate colour: hue ${colour.hueDeg.toFixed(0)}° ±${colour.hueToleranceDeg.toFixed(0)}°, chroma ≥ ${colour.minChroma.toFixed(0)}, ${(colour.coverage * 100).toFixed(0)} % of the face`
          : 'plate colour: none worth using — a black or grey plate; finding it again by shape only',
      );
    }

    const first = await trackFromAnchor(source, anchor, { ...trackOptions, onProgress: done => report(done) });
    const all: TrackedPoint[] = [...first.points];
    const low: number[] = [...first.lowConfidenceIndices];
    const joins: SetJoin[] = [];
    let lostAtEnd = first.gaveUp;
    let gaveUp = first.gaveUp;

    const anchorGray = await source.getGray(anchor.index);
    const radiusOpts = {
      minRadiusPx: Math.max(6, Math.round(server.displayHeight * 0.03)),
      maxRadiusPx: Math.round(server.displayHeight * 0.22),
      near: { x: anchor.x, y: anchor.y },
    };

    // Where the next search may begin. Always moves forward, so a hit the
    // tracker could do nothing with — a plate half out of frame, where no
    // template can be cut — is not found again and again.
    let searchFrom = 0;
    let attempts = 0;
    while (gaveUp && attempts < MAX_JOINS) {
      attempts++;
      // A tracker that gave up spent its last frames unsure — on the fan, or
      // on nothing. Those points are not the bar; the search for it starts
      // from the last frame it was confident about.
      while (all.length > 1 && all[all.length - 1].confidence < minConfidence) all.pop();
      const lastGood = all[all.length - 1];
      const startAt = Math.max(lastGood.index + 1, searchFrom);
      let found: { at: number; x: number; y: number; how: SetJoin['how'] } | null = null;

      // 1. In flight, by colour: the frames just after the loss, near where
      //    the plate was heading, with a reach that grows with the frames
      //    since it was last seen.
      if (colour) {
        const until = Math.min(total - 1, lastGood.index + Math.round(FLIGHT_WINDOW_S * fps));
        for (let at = startAt; at <= until; at += FLIGHT_STEP) {
          report(at);
          const elapsed = at - lastGood.index;
          const reach = Math.min(4 * R, 1.2 * R + speedPxPerFrame * elapsed);
          const blob = findColourBlob(await source.getRgba(at), colour, {
            near: { x: lastGood.x, y: lastGood.y },
            searchRadiusPx: reach,
            radiusPx: R,
            minFill: FLIGHT_MIN_FILL,
          });
          if (blob) {
            found = { at, x: blob.x, y: blob.y, how: 'colour' };
            log(`plate found again by colour on frame ${at}, ${elapsed} frames after it was lost, at (${blob.x.toFixed(0)}, ${blob.y.toFixed(0)}) — ${(blob.fill * 100).toFixed(0)} % of a plate`);
            break;
          }
        }
      }

      // 2. At the next rest, by shape: a round thing near where the set
      //    started, on later frames — that is the plate's colour, or that
      //    correlates with the set's own template.
      if (!found) {
        const resumeFrom = Math.max(startAt, lastGood.index + 10);
        for (let at = resumeFrom; at < total - 10; at += REACQUIRE_STEP) {
          report(at);
          const gray = await source.getGray(at);
          const candidate = await findPlate(gray, radiusOpts);
          if (!candidate || candidate.support < REACQUIRE_MIN_SUPPORT) continue;
          const e = candidate.ellipse;
          const dist = Math.hypot(e.cx - anchor.x, e.cy - anchor.y);
          if (dist >= R * 1.5) continue;
          if (colour) {
            const match = colourMatchFraction(await source.getRgba(at), e, colour);
            if (match < REACQUIRE_MIN_COLOUR) {
              log(`round thing on frame ${at} at (${e.cx.toFixed(0)}, ${e.cy.toFixed(0)}) turned down — only ${(match * 100).toFixed(0)} % the plate's colour`);
              continue;
            }
          } else {
            const pair: FrameSource = {
              frameCount: 2,
              timestamps: [0, 1],
              getGray: i => Promise.resolve(i === 0 ? anchorGray : gray),
            };
            const check = await trackDirection(pair, { index: 0, x: anchor.x, y: anchor.y }, 1, {
              ...trackOptions,
              searchRadiusPx: dist + 12,
              giveUpAfter: 1,
            });
            const hit = check.points[1];
            const score = hit ? hit.confidence : 0;
            if (!hit || score < REACQUIRE_MIN_CORRELATION || Math.hypot(hit.x - e.cx, hit.y - e.cy) >= R * 0.5) {
              log(`round thing on frame ${at} at (${e.cx.toFixed(0)}, ${e.cy.toFixed(0)}) turned down — template correlation ${score.toFixed(2)}`);
              continue;
            }
          }
          found = { at, x: e.cx, y: e.cy, how: 'rest' };
          break;
        }
      }

      if (!found) {
        lostAtEnd = true;
        break;
      }
      const from = found.at;
      searchFrom = from + 1;
      const sub: FrameSource = {
        frameCount: total - from,
        timestamps: source.timestamps.slice(from),
        getGray: i => source.getGray(i + from),
      };
      const more = await trackDirection(sub, { index: 0, x: found.x, y: found.y }, 1, {
        ...trackOptions,
        onProgress: done => report(from + done),
      });
      if (more.points.length <= 1) {
        // No template could be cut there (a plate half out of frame), or
        // nothing followed. Not a join; look on from the next frame.
        log(`frame ${from}: the tracker could not take hold at (${found.x.toFixed(0)}, ${found.y.toFixed(0)}) — looking on`);
        continue;
      }
      for (const p of more.points) p.index += from;
      all.push(...more.points);
      low.push(...more.lowConfidenceIndices.map(i => i + from));
      joins.push({ at: from, x: found.x, y: found.y, how: found.how, frames: more.points.length });
      log(`join ${joins.length}: ${found.how === 'rest' ? 'plate found again at rest' : 'tracking on'} from frame ${from} at (${found.x.toFixed(1)}, ${found.y.toFixed(1)}), ${more.points.length} more frames${more.gaveUp ? ' until it was lost again' : ''}`);
      gaveUp = more.gaveUp;
      lostAtEnd = more.gaveUp;
    }

    all.sort((a, b) => a.index - b.index);
    const keptLow = new Set(all.map(p => p.index));
    const lowConfidenceIndices = [...new Set(low.filter(i => keptLow.has(i)))].sort((a, b) => a - b);
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
          log(`rep ${k + 1}: calibrated at its own rest from ${fits.length} frames: semi-axes ${rest.semiMajorPx.toFixed(2)}×${rest.semiMinorPx.toFixed(2)} px, ${cal.cmPerPxV.toFixed(4)} cm/px vertical (set: ${setCalibration.cmPerPxV.toFixed(4)})`);
        } else {
          log(`rep ${k + 1}: rest outline ${rest.semiMajorPx.toFixed(1)} px disagrees with the set's ${R.toFixed(1)} px by ${((ratio - 1) * 100).toFixed(0)} % — keeping the set's calibration`);
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
        lowConfidenceIndices: lowConfidenceIndices.filter(i => i >= fromIndex && i <= toIndex),
      });
    }

    return { points, tracked: all, lowConfidenceIndices, reps, joins, lostAtEnd, colour };
  } finally {
    source.dispose();
  }
}
