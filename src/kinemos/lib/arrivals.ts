/**
 * arrivals — clips that are already analysed when the coach first sees them.
 *
 * Design §12 puts "80–99 % pre-analysed arrivals" in P5, behind a server and
 * a model. P4c removed the model half: `autoAnalyse` finds the plate, follows
 * the set, cuts it into reps and stores them with no click at all. What is
 * left of the original plan is the server half — and EMOS is a pure
 * client-side SPA with nowhere to run one (CLAUDE.md, Hosting & deploy).
 *
 * So this module takes the other route to the same place: **run the pipeline
 * at the moment the clip is in the browser anyway.** Two moments qualify.
 *
 *   1. **On import.** `ImportControl` already holds the decoded, trimmed
 *      `File` — the same bytes it is about to upload. Analysing from that
 *      local file costs no download at all, which is the one thing a server
 *      could not have done better.
 *   2. **On sweep.** Everything that arrived before this existed, and
 *      everything that arrives from the athlete app (which never touches a
 *      coach's browser), is caught by `unanalysedClips` and worked through
 *      one clip at a time from the library.
 *
 * **Why a queue and not `Promise.all`.** A split competition recording is six
 * files at once, and each analysis holds a `VideoDecoder`, a full-resolution
 * frame buffer and a tracker running flat out. Six of those in parallel is
 * how a browser tab is killed. The queue is strictly sequential and can be
 * stopped between clips — never mid-clip, because a half-stored set is worse
 * than an unanalysed one.
 *
 * **Why it is a setting and not a behaviour.** Analysis is a minute of the
 * coach's own CPU per clip, on the laptop they are standing next to. Default
 * on, because that is the point of the feature, and off in one click for
 * anyone importing a season of footage on battery. COACH-CONFIG candidate:
 * this belongs in a settings row once KinEMOS has one.
 */
import { openFrameServer } from '../engine/frameServer';
import { autoAnalyse, describeAutoAnalysis, type AutoAnalyseResult } from './autoAnalyse';
import { clipKeyOf, listRecentAnalyses } from './analysisService';
import type { LibrarySource, LibraryVideo } from './videoLibrary';

const PREF_KEY = 'kinemos.analyseOnImport';

/** Whether an imported clip is analysed as it lands. Default on. */
export function analyseOnImportEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    // Private mode, or storage disabled. The feature still works; it just
    // cannot be turned off, which is the safer of the two failures.
    return true;
  }
}

export function setAnalyseOnImport(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* nothing to do — see above */
  }
}

export interface ArrivalTarget {
  source: LibrarySource;
  sourceId: string;
  /** What to show while it runs, and in the sentence afterwards. */
  label: string;
  /** Where the frames come from: a local file kept from the import, or a URL
   *  to fetch. A file is preferred wherever one exists — it is already here. */
  file?: File;
  url?: string;
  massKg?: number | null;
  massSource?: 'logged' | 'manual' | null;
}

export interface ArrivalOutcome {
  target: ArrivalTarget;
  result: AutoAnalyseResult | null;
  /** The sentence to show the coach, whether it worked or not. */
  message: string;
}

export interface ArrivalProgress {
  /** 1-based position in the queue, and its length. */
  index: number;
  total: number;
  label: string;
  /** What the pipeline is doing right now, and how far in. */
  stage: string;
  done: number;
  steps: number;
}

export interface ArrivalRunOptions {
  ownerId: string | null;
  onProgress?: (p: ArrivalProgress) => void;
  /** Called as each clip finishes, so a caller can refresh incrementally
   *  rather than waiting for a six-clip queue to end. */
  onDone?: (outcome: ArrivalOutcome) => void;
  /** Checked between clips. Returning true stops the queue. */
  shouldStop?: () => boolean;
}

/**
 * Analyse one clip. Opens its frames, runs the pipeline, closes them again.
 *
 * A local `File` is turned into an object URL and revoked afterwards: the
 * frame server takes a URL, and leaving one alive pins the whole file in
 * memory for the life of the tab.
 */
export async function analyseArrival(
  target: ArrivalTarget,
  options: { ownerId: string | null; onProgress?: (stage: string, done: number, total: number) => void },
): Promise<ArrivalOutcome> {
  const objectUrl = target.file ? URL.createObjectURL(target.file) : null;
  const url = objectUrl ?? target.url;
  if (!url) {
    return { target, result: null, message: `${target.label}: nothing to read the frames from.` };
  }
  let server: Awaited<ReturnType<typeof openFrameServer>> | null = null;
  try {
    server = await openFrameServer(url);
    const result = await autoAnalyse(server, {
      source: target.source,
      sourceId: target.sourceId,
      ownerId: options.ownerId,
      massKg: target.massKg ?? null,
      massSource: target.massSource ?? null,
      onProgress: options.onProgress,
    });
    return { target, result, message: describeAutoAnalysis(result, target.label) };
  } catch (e) {
    return {
      target,
      result: null,
      message: `${target.label}: ${e instanceof Error ? e.message : 'could not be analysed.'}`,
    };
  } finally {
    server?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Work through a queue of arrivals, one at a time.
 *
 * Never throws: a clip the pipeline cannot handle produces an outcome with a
 * message and the queue moves on. One bad import out of six must not cost the
 * other five.
 */
export async function runArrivalQueue(
  targets: ArrivalTarget[],
  options: ArrivalRunOptions,
): Promise<ArrivalOutcome[]> {
  const outcomes: ArrivalOutcome[] = [];
  for (const [i, target] of targets.entries()) {
    if (options.shouldStop?.()) break;
    const outcome = await analyseArrival(target, {
      ownerId: options.ownerId,
      onProgress: (stage, done, steps) =>
        options.onProgress?.({ index: i + 1, total: targets.length, label: target.label, stage, done, steps }),
    });
    outcomes.push(outcome);
    options.onDone?.(outcome);
  }
  return outcomes;
}

/**
 * The clips in the library that have never been analysed.
 *
 * Answered by set difference rather than a per-clip query: an analysis names
 * its source polymorphically, so "has this clip got any reps" is one round
 * trip per clip, and the library is hundreds of rows. One read of the
 * analyses and one of the library — which the library page has already done —
 * answers it for all of them at once.
 *
 * Embedded clips are excluded: their bytes are behind a Stream iframe, so
 * there is nothing for a frame server to open (design §P0 §4).
 */
export function unanalysedClips(rows: LibraryVideo[], analysed: Set<string>): LibraryVideo[] {
  return rows.filter(row => !row.isEmbed && !analysed.has(clipKeyOf(row.source, row.sourceId)));
}

/** The clip keys that already have at least one stored rep. */
export async function analysedClipKeys(): Promise<Set<string>> {
  const analyses = await listRecentAnalyses();
  return new Set(analyses.map(a => clipKeyOf(a.source_kind as LibrarySource, a.source_id)));
}

/** A library row as a queue target. */
export function targetFor(row: LibraryVideo): ArrivalTarget {
  return {
    source: row.source,
    sourceId: row.sourceId,
    label: [row.athleteName, row.exerciseName].filter(Boolean).join(' · ') || 'Clip',
    url: row.playbackUrl,
    massKg: row.loadKg,
    massSource: row.loadKg == null ? null : 'logged',
  };
}
