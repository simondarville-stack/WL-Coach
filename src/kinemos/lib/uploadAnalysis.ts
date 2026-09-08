/**
 * uploadAnalysis — the pure half of analysing an athlete's upload on the
 * athlete's own phone (P8 plan).
 *
 * The clip an athlete films goes straight from the phone to Cloudflare
 * Stream and is an iframe embed from then on — the one kind of clip no
 * coach's browser can ever analyse. But at upload time the phone holds the
 * file, and a phone with WebCodecs can run the same pipeline the coach's
 * import does. What is here is everything about that which does not need
 * React or a browser: the preference, the mass rule, and the sentence.
 * The queue and the gate's reader live in the athlete app's hook.
 */
import type { ArrivalOutcome } from './arrivals';

const PREF_KEY = 'kinemos.analyseOnUpload';

/**
 * Whether the athlete's phone analyses a clip as it uploads it. Default on.
 * Separate from the coach's `kinemos.analyseOnImport`: that one lives in
 * the coach's browser and says nothing about a phone. No UI yet (plan §2);
 * COACH-CONFIG candidate for the Profile screen.
 */
export function analyseOnUploadEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAnalyseOnUpload(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the feature stays on, which is the safer failure */
  }
}

/** The two columns the mass rule reads from a logged set. */
export interface LoggedSetLoad {
  performed_load: number | null;
  status: string | null;
}

/**
 * The bar's mass for an upload: the heaviest COMPLETED set of the exercise
 * at upload time. An athlete's upload names no set, so this is the same
 * best guess the library shows on the row (`videoLibrary.ts`, the top set
 * standing in). Null when nothing is logged yet — the rep is then stored
 * with velocities and no power, as any unmassed rep is.
 */
export function massForUpload(sets: readonly LoggedSetLoad[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (s.status !== 'completed' || s.performed_load == null) continue;
    if (best === null || s.performed_load > best) best = s.performed_load;
  }
  return best;
}

/**
 * The one line the athlete sees when a run ends, or null for silence.
 * Only success speaks: a phone that says "no plate found on the first
 * frame" to someone who just racked the bar is noise, and there is nothing
 * for them to do about it. The coach sees the outcome in the library.
 */
export function describeUploadOutcome(outcome: ArrivalOutcome): string | null {
  const result = outcome.result;
  if (!result || result.problem || result.reps.length === 0) return null;
  const n = result.reps.length;
  return `${n} rep${n === 1 ? '' : 's'} analysed`;
}

/** What the line says while a run is going. */
export const ANALYSING_LINE = 'Analysing your lift…';

/**
 * What the coach's viewer says over a Stream embed (P8 plan §4). The
 * frames are behind an iframe, so the stage cannot step through them; the
 * stored reps — track, outline, metrics, grade — are shown from the rows.
 */
export const EMBED_ANALYSED_NOTE =
  'This clip streams from Cloudflare; the reps below were analysed on the athlete’s phone at upload. ' +
  'Frame-by-frame viewing needs the original file.';
export const EMBED_UNANALYSED_NOTE =
  'This clip streams from Cloudflare and has no stored reps. A clip is analysed on the athlete’s phone ' +
  'at upload when the phone can; frame-by-frame viewing needs the original file — import it into the library.';

/** How long the count stays on screen, ms. */
export const OUTCOME_LINE_MS = 6000;
