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
 *   1. scan the clip for its lifts at thumbnail resolution (P7 plan;
 *      `lib/activityScan.ts`), when the clip's source is given;
 *   2. for each lift: find the plate on the still frame before it and take
 *      its centre as the anchor; track the set inside that stretch of the
 *      clip, cut it into reps, calibrate each at its own rest;
 *   3. with no lift found — or none that tracked to a rep — do as before:
 *      find the plate on the first frame and track the whole clip, so the
 *      scan can only ever save time, never lose a rep;
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
import {
  DEFAULT_PHASE_END_RULE,
  DEFAULT_PHASE_THRESHOLDS,
  computeLiftMetrics,
  proposePhases,
  spansFrom,
  type PhaseProposal,
} from '../engine/phases';
import { liftModelById, partForKind, type LiftModel } from '../engine/liftModels';
import { toStoredMetrics } from '../engine/metricCatalogue';
import { windowRanges, type LiftWindow } from '../engine/activity';
import type { Calibration, PlateEllipse } from '../engine/calibration';
import type { FrameServer, FrameSource as ClipSource } from '../engine/frameServer';
import type { KinemosTrackPoint } from '../../lib/database.types';
import { ensureAnalysis, saveAnalysisState, saveCalibration, saveTrack } from './analysisService';
import { scanActivity, secondsLabel, type ActivityScanResult } from './activityScan';
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
  /** The lift model this rep is segmented and stored under (P9). A
   *  compound's caller passes the PART — the clean or the jerk — not the
   *  compound. Default: a snatch from the floor, as before P9. */
  model?: LiftModel;
  /** The lifter's standing height, cm, for the jerk's dip as a share of it. */
  heightCm?: number | null;
}

/**
 * Propose the phases of a series under a lift model: its set, its end rule,
 * its shape, its thresholds. A model with no phases (an unspecified lift, a
 * compound not yet cut) proposes nothing. The one place the model's parts
 * are handed to the detector, so every caller segments the same way.
 */
export function proposePhasesFor(series: Parameters<typeof proposePhases>[0], model: LiftModel): PhaseProposal {
  if (!model.phaseSet || !model.endRule) return { boundaries: [], fullyDetected: true };
  return proposePhases(
    series,
    model.phaseSet,
    { ...DEFAULT_PHASE_THRESHOLDS, ...(model.thresholds ?? {}) },
    model.endRule ?? DEFAULT_PHASE_END_RULE,
    model.shape,
  );
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
    const model = args.model ?? liftModelById('snatch');
    const proposal = proposePhasesFor(series, model);
    const metrics = computeLiftMetrics(series, spansFrom(proposal.boundaries, model.phaseSet ?? []), { heightCm: args.heightCm ?? null });
    await saveAnalysisState(analysis.id, {
      massKg: args.massKg,
      massSource: args.massSource,
      camera: args.camera,
      phaseBoundaries: proposal.boundaries,
      phaseSetId: model.phaseSetId,
      liftModelId: model.id,
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
  /** The clip's lift model id (P9): how the set is cut into reps and which
   *  model each rep is stored under. A compound stores each rep under the
   *  part the bar's motion says it is. Default: a snatch from the floor. */
  liftModelId?: string | null;
  /** The athlete's standing height, cm, when the profile has it. */
  athleteHeightCm?: number | null;
  /** Which frame to look for the bar at rest on when the clip is tracked
   *  whole. Default: the start. */
  anchorIndex?: number;
  /**
   * The clip's source — the same URL or Blob the frame server was opened
   * on — for the activity scan (P7 plan §1), which opens its own thumbnail
   * server on it. With it, tracking stays inside the lifts the scan finds;
   * without it, and without `activity`, the whole clip is tracked as before.
   */
  src?: ClipSource;
  /** A scan already run (the viewer's, the bench's), so it is not repeated. */
  activity?: ActivityScanResult | null;
  /**
   * Asked throughout — by the scan per frame, by the tracker per frame,
   * and here before each stage and before anything is stored. True ends
   * the run with `problem: 'stopped'` and NOTHING written: a half-stored
   * set is worse than an unanalysed clip (P5 plan §5). Once storing has
   * begun it finishes; the writes are a handful of small rows. For the
   * athlete who leaves the screen an analysis is running behind (P8 plan).
   */
  shouldStop?: () => boolean;
  onProgress?: (stage: string, done: number, total: number) => void;
}

export interface AutoAnalyseResult {
  reps: TrackedRep[];
  /** Analysis ids written, in rep order. */
  analysisIds: string[];
  /** The outline the plate detector found, when it found one — the first
   *  lift's, when the clip was tracked by lifts. */
  ellipse: PlateEllipse | null;
  joins: number;
  /** Where the activity scan found the lifts; empty without a scan. */
  windows: LiftWindow[];
  /** The scan's cost, when one ran. */
  scan: { frames: number; totalMs: number; msPerFrame: number } | null;
  /** True when lifts were found but none of them tracked to a rep, and the
   *  whole clip was tracked instead. */
  fellBack: boolean;
  /** Why there is nothing, when there is nothing. `stopped`: the caller
   *  asked (`shouldStop`) before anything was stored. */
  problem?: 'no-plate' | 'no-reps' | 'stopped';
}

/**
 * Analyse a clip end to end without a click, and store what it finds.
 */
export async function autoAnalyse(
  server: FrameServer,
  options: AutoAnalyseOptions,
): Promise<AutoAnalyseResult> {
  const plateDiameterCm = options.plateDiameterCm ?? 45;
  const stopped = () => options.shouldStop?.() === true;
  const model = liftModelById(options.liftModelId ?? 'snatch');
  // An unspecified lift is cut on any rest for any motion; the shape the
  // set tracker reads is the model's.
  const shape = model.shape;
  const fromFloor = model.fromFloor;

  let activity: ActivityScanResult | null = options.activity ?? null;
  if (!activity && options.src !== undefined) {
    options.onProgress?.('Looking for the lifts', 0, server.frameCount);
    activity = await scanActivity(options.src, {
      shouldStop: options.shouldStop,
      onProgress: (done, total) => options.onProgress?.('Looking for the lifts', done, total),
    });
  }
  const windows = activity?.windows ?? [];
  const scan = activity ? { frames: activity.frames, totalMs: activity.totalMs, msPerFrame: activity.msPerFrame } : null;
  const empty = (): Pick<AutoAnalyseResult, 'reps' | 'analysisIds' | 'ellipse' | 'windows' | 'scan'> => ({
    reps: [],
    analysisIds: [],
    ellipse: null,
    windows,
    scan,
  });
  // A scan cut short has windows only up to where it was stopped; they are
  // not the clip's lifts, and nothing is tracked inside them.
  if (stopped() || activity?.stopped) {
    return { ...empty(), problem: 'stopped', joins: 0, fellBack: false };
  }

  // ── By lifts ─────────────────────────────────────────────────────────────
  if (windows.length > 0) {
    const ranges = windowRanges(windows, server.timestamps);
    const reps: TrackedRep[] = [];
    let joins = 0;
    let ellipse: PlateEllipse | null = null;
    let near: { x: number; y: number } | undefined;
    for (const [k, range] of ranges.entries()) {
      if (stopped()) return { ...empty(), problem: 'stopped', joins, fellBack: false };
      options.onProgress?.('Looking for the plate', k, ranges.length);
      // With the previous lift's plate centre as a hint first — `near` is a
      // hard constraint in the finder — and without it if that finds
      // nothing: the bar may have been rolled between reps.
      const found =
        (near ? await findPlateOnFrame(server, range.restIndex, near) : null) ??
        (await findPlateOnFrame(server, range.restIndex));
      if (!found) continue;
      ellipse ??= found.ellipse;
      near = { x: found.ellipse.cx, y: found.ellipse.cy };
      const result = await trackSet(
        server,
        { index: range.restIndex, x: found.ellipse.cx, y: found.ellipse.cy },
        {
          ellipse: found.ellipse,
          plateDiameterCm,
          shape,
          fromFloor,
          range: { from: range.from, to: range.to },
          shouldStop: options.shouldStop,
          onProgress: (done, total) => options.onProgress?.(`Following the bar, lift ${k + 1} of ${ranges.length}`, done, total),
        },
      );
      // A track cut short is a partial rep at best; none of it is kept.
      if (stopped()) return { ...empty(), problem: 'stopped', joins, fellBack: false };
      joins += result.joins.length;
      // Reps are numbered from 1 within a call; across lifts they run on.
      for (const rep of result.reps) reps.push({ ...rep, rep: reps.length + 1 });
    }
    if (reps.length > 0) {
      const analysisIds = await storeReps(server, options, reps);
      return { reps, analysisIds, ellipse, joins, windows, scan, fellBack: false };
    }
    // Nothing tracked to a rep inside the lifts: the whole clip, as before.
  }

  // ── The whole clip ───────────────────────────────────────────────────────
  const fellBack = windows.length > 0;
  if (stopped()) return { ...empty(), problem: 'stopped', joins: 0, fellBack };
  const anchorIndex = options.anchorIndex ?? 0;
  options.onProgress?.('Looking for the plate', 0, 1);
  const found = await findPlateOnFrame(server, anchorIndex);
  if (!found) {
    return { ...empty(), problem: 'no-plate', joins: 0, fellBack };
  }
  const ellipse = found.ellipse;

  const result = await trackSet(
    server,
    { index: anchorIndex, x: ellipse.cx, y: ellipse.cy },
    {
      ellipse,
      plateDiameterCm,
      shape,
      fromFloor,
      shouldStop: options.shouldStop,
      onProgress: (done, total) => options.onProgress?.('Following the bar', done, total),
    },
  );
  if (stopped()) {
    return { ...empty(), problem: 'stopped', joins: result.joins.length, fellBack };
  }
  if (result.reps.length === 0) {
    return { ...empty(), problem: 'no-reps', joins: result.joins.length, fellBack };
  }
  const analysisIds = await storeReps(server, options, result.reps);
  return { reps: result.reps, analysisIds, ellipse, joins: result.joins.length, windows, scan, fellBack };
}

async function storeReps(server: FrameServer, options: AutoAnalyseOptions, reps: TrackedRep[]): Promise<string[]> {
  const analysisIds: string[] = [];
  const model = liftModelById(options.liftModelId ?? 'snatch');
  for (const [k, rep] of reps.entries()) {
    options.onProgress?.('Storing the reps', k, reps.length);
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
        // A clean & jerk's reps land on the clean and the jerk by what the
        // bar did; a plain model is its own part.
        model: partForKind(model, rep.segment.kind),
        heightCm: options.athleteHeightCm ?? null,
      }),
    );
  }
  return analysisIds;
}

/** "1,2 s and 6,9 s" — where the lifts start, for a message. */
function liftTimes(windows: readonly LiftWindow[]): string {
  const times = windows.map(w => `${secondsLabel(w.liftT)} s`);
  return times.length <= 1 ? times.join('') : `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

/** What an automatic run did, in the coach's terms. */
export function describeAutoAnalysis(result: AutoAnalyseResult, clipLabel: string): string {
  const n = result.windows.length;
  const lifts =
    n === 0 ? '' : `${n} lift${n === 1 ? '' : 's'} found at ${liftTimes(result.windows)}`;
  if (result.problem === 'stopped') {
    return `${clipLabel}: the analysis was stopped before anything was stored.`;
  }
  if (result.problem === 'no-plate') {
    return n > 0
      ? `${clipLabel}: ${lifts}, but no plate on the still frame before ${n === 1 ? 'it' : 'any of them'} or on the first frame. Open it and outline one — the rest runs from there.`
      : `${clipLabel}: no plate found on the first frame. Open it and outline one — the rest runs from there.`;
  }
  if (result.problem === 'no-reps') {
    return (
      `${clipLabel}: ` +
      (n > 0 ? `${lifts}, but nothing tracked there rises 40 cm from a rest, and neither does the whole clip` : 'the plate was found and followed, but nothing in the track rises 40 cm from a rest') +
      '. A clip that starts mid-pull needs the viewer.'
    );
  }
  const reps = result.reps.length;
  const own = result.reps.filter(r => r.ownCalibration).length;
  return (
    `${clipLabel}: ` +
    (n > 0 ? `${lifts}${result.fellBack ? ' but nothing tracked there, so the whole clip was tracked' : ''}; ` : '') +
    `${reps} rep${reps === 1 ? '' : 's'} analysed` +
    (result.joins > 0 ? `, the plate found again ${result.joins} time${result.joins === 1 ? '' : 's'}` : '') +
    `; ${own} calibrated at ${own === 1 ? 'its' : 'their'} own rest. Check the grade before quoting the numbers.`
  );
}
