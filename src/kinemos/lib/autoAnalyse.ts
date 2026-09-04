/**
 * autoAnalyse — the whole pipeline, no clicks.
 *
 * Design §3 lists zero-click tracking as an explicit v1 NON-goal, and §12
 * puts "80–99 % pre-analysed arrivals" in P5 behind a server and a model.
 * Both were written before P3d and P3g: finding the plate with no click
 * (`findPlate`), following it through a whole set and cutting the set into
 * reps (`trackSet`) are built, measured, and already run from one click in
 * the viewer. What separated that from zero clicks was the one remaining
 * click — the anchor — and the plate detector supplies it.
 *
 * So this is the same pipeline the coach drives, driven by nothing:
 *
 *   1. find the plate on a frame where the bar is still (the start, where a
 *      lift begins on the floor and nothing is moving);
 *   2. take its centre as the anchor;
 *   3. track the set, cut it into reps, calibrate each at its own rest;
 *   4. compute and store every rep.
 *
 * **It is not a replacement for the coach, and the grade says why.** Every
 * rep it writes is graded exactly as a hand-anchored one is — same tracker
 * tier, same calibration confidence, same peak stability — so an automatic
 * analysis that went wrong looks wrong, and one that went right is worth the
 * same as the one a coach would have produced by clicking. Nothing here is
 * marked coach-approved, because nothing here was.
 */
import { DEFAULT_FILTER } from '../engine/signal';
import { computeKinematics, summariseRep } from '../engine/kinematics';
import { computeLiftMetrics, proposePhases, spansFrom } from '../engine/phases';
import { toStoredMetrics } from '../engine/metricCatalogue';
import type { Calibration, PlateEllipse } from '../engine/calibration';
import type { FrameServer } from '../engine/frameServer';
import type { KinemosTrackPoint } from '../../lib/database.types';
import { ensureAnalysis, saveAnalysisState, saveCalibration, saveTrack } from './analysisService';
import { findPlateOnFrame } from './assists';
import { trackSet, type TrackedRep } from './setTracker';
import type { LibrarySource } from './videoLibrary';

export interface PersistRepArgs {
  source: LibrarySource;
  sourceId: string;
  repIndex: number;
  server: FrameServer;
  ownerId: string | null;
  points: KinemosTrackPoint[];
  ellipse: PlateEllipse;
  calibration: Calibration;
  /** Where the calibration was read, for the stored row. */
  calibratedAt: { index: number; t: number };
  massKg: number | null;
  massSource: 'logged' | 'manual' | null;
  camera: 'tripod' | 'stabilised' | 'handheld' | 'unknown';
  tier?: 'manual' | 'assisted' | 'marker' | 'ml';
}

/**
 * Store one rep: the analysis row, its track, its calibration and the cached
 * metrics. The one definition of what "a saved rep" means — the viewer's set
 * tracking and the automatic run both come through here, so the two cannot
 * drift into storing subtly different things.
 *
 * Returns the analysis id, so a caller that wants to show the rep it just
 * wrote does not have to look it up again.
 */
export async function persistRep(args: PersistRepArgs): Promise<string> {
  const analysis = await ensureAnalysis(
    args.source,
    args.sourceId,
    args.repIndex,
    {
      frameWidth: args.server.displayWidth,
      frameHeight: args.server.displayHeight,
      rotation: args.server.rotation,
    },
    args.ownerId,
  );
  await saveTrack(analysis.id, args.points, { tier: args.tier ?? 'assisted', ownerId: args.ownerId });
  await saveCalibration(analysis.id, args.ellipse, args.calibration, args.calibratedAt, args.ownerId);
  const series = computeKinematics(args.points, args.calibration, {
    massKg: args.massKg,
    filter: DEFAULT_FILTER,
  });
  if (series) {
    const proposal = proposePhases(series);
    const metrics = computeLiftMetrics(series, spansFrom(proposal.boundaries));
    await saveAnalysisState(analysis.id, {
      massKg: args.massKg,
      massSource: args.massSource,
      camera: args.camera,
      phaseBoundaries: proposal.boundaries,
      phaseSetId: 'default',
      metrics: toStoredMetrics(metrics, summariseRep(series)),
    });
  }
  return analysis.id;
}

export interface AutoAnalyseOptions {
  source: LibrarySource;
  sourceId: string;
  ownerId: string | null;
  plateDiameterCm?: number;
  massKg?: number | null;
  massSource?: 'logged' | 'manual' | null;
  camera?: 'tripod' | 'stabilised' | 'handheld' | 'unknown';
  /** Which frame to look for the bar at rest on. Default: the start. */
  anchorIndex?: number;
  onProgress?: (stage: string, done: number, total: number) => void;
}

export interface AutoAnalyseResult {
  reps: TrackedRep[];
  /** Analysis ids written, in rep order. */
  analysisIds: string[];
  /** The outline the plate detector found, when it found one. */
  ellipse: PlateEllipse | null;
  joins: number;
  /** Why there is nothing, when there is nothing. */
  problem?: 'no-plate' | 'no-reps';
}

/**
 * Analyse a clip end to end without a click, and store what it finds.
 */
export async function autoAnalyse(
  server: FrameServer,
  options: AutoAnalyseOptions,
): Promise<AutoAnalyseResult> {
  const anchorIndex = options.anchorIndex ?? 0;
  options.onProgress?.('Looking for the plate', 0, 1);
  const found = await findPlateOnFrame(server, anchorIndex);
  if (!found) {
    return { problem: 'no-plate', reps: [], analysisIds: [], ellipse: null, joins: 0 };
  }
  const ellipse = found.ellipse;

  const result = await trackSet(
    server,
    { index: anchorIndex, x: ellipse.cx, y: ellipse.cy },
    {
      ellipse,
      plateDiameterCm: options.plateDiameterCm ?? 45,
      onProgress: (done, total) => options.onProgress?.('Following the bar', done, total),
    },
  );
  if (result.reps.length === 0) {
    return { problem: 'no-reps', reps: [], analysisIds: [], ellipse: null, joins: result.joins.length };
  }

  const analysisIds: string[] = [];
  for (const [k, rep] of result.reps.entries()) {
    options.onProgress?.('Storing the reps', k, result.reps.length);
    analysisIds.push(
      await persistRep({
        source: options.source,
        sourceId: options.sourceId,
        repIndex: rep.rep,
        server,
        ownerId: options.ownerId,
        points: rep.points,
        ellipse: rep.ellipse,
        calibration: rep.calibration,
        calibratedAt: { index: server.nearestIndex(rep.segment.liftOffT), t: rep.segment.liftOffT },
        massKg: options.massKg ?? null,
        massSource: options.massSource ?? null,
        camera: options.camera ?? 'unknown',
      }),
    );
  }
  return { reps: result.reps, analysisIds, ellipse, joins: result.joins.length };
}

/** What an automatic run did, in the coach's terms. */
export function describeAutoAnalysis(result: AutoAnalyseResult, clipLabel: string): string {
  if (result.problem === 'no-plate') {
    return `${clipLabel}: no plate found on the first frame. Open it and outline one — the rest runs from there.`;
  }
  if (result.problem === 'no-reps') {
    return `${clipLabel}: the plate was found and followed, but nothing in the track rises 40 cm from a rest. A clip that starts mid-pull needs the viewer.`;
  }
  const n = result.reps.length;
  const own = result.reps.filter(r => r.ownCalibration).length;
  return (
    `${clipLabel}: ${n} rep${n === 1 ? '' : 's'} analysed` +
    (result.joins > 0 ? `, the plate found again ${result.joins} time${result.joins === 1 ? '' : 's'}` : '') +
    `; ${own} calibrated at ${own === 1 ? 'its' : 'their'} own rest. Check the grade before quoting the numbers.`
  );
}
