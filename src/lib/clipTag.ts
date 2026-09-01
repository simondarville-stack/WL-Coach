/**
 * clipTag — what a training clip is *of*.
 *
 * A strip of five clips against one exercise told a coach nothing about which
 * lift each one showed; they had to open all five to find the 105 kg single.
 * A tag answers that: either the clip points at a logged set, or the athlete
 * states the load and reps directly.
 *
 * ## Precedence, and why it is not "whichever is set"
 *
 * When a clip names a set, that set row is the source of truth for load and
 * reps — the clip stores only the link. Copying the numbers onto the clip as
 * well would mean two places to change one value, and they would drift the
 * first time an athlete corrected a set after filming it.
 *
 * The clip's own `performed_load` / `performed_reps` exist for the footage a
 * set cannot describe: a warm-up single, an extra attempt, a lift filmed
 * before any set rows existed. They are read only when there is no set link,
 * or when the linked set has gone (a deleted set leaves `set_number` pointing
 * at nothing, and a clip that still says "S3" beats a clip that says nothing).
 */
import type { TrainingLogSet, TrainingLogVideo } from './database.types';

/** What an athlete can say about a clip. */
export interface ClipTag {
  /** Logged set this clip shows, or null for footage outside the set list. */
  setNumber: number | null;
  /** Only meaningful when `setNumber` is null — otherwise the set row wins. */
  performedLoad: number | null;
  performedReps: number | null;
}

export const EMPTY_CLIP_TAG: ClipTag = {
  setNumber: null,
  performedLoad: null,
  performedReps: null,
};

/** The load and reps to show for a clip, resolved against its exercise's sets. */
export interface ResolvedClipTag {
  setNumber: number | null;
  load: number | null;
  reps: number | null;
  /** True when the numbers came from a linked set rather than the clip. */
  fromSet: boolean;
}

export function resolveClipTag(
  video: Pick<TrainingLogVideo, 'set_number' | 'performed_load' | 'performed_reps'>,
  sets: readonly TrainingLogSet[] = [],
): ResolvedClipTag {
  const setNumber = video.set_number;
  if (setNumber != null) {
    const set = sets.find(s => s.set_number === setNumber);
    if (set) {
      return {
        setNumber,
        load: set.performed_load,
        reps: set.performed_reps,
        fromSet: true,
      };
    }
  }
  return {
    setNumber,
    load: video.performed_load,
    reps: video.performed_reps,
    fromSet: false,
  };
}

/** Comma decimals and no trailing ",0" — 102,5 kg, but 100 kg. */
export function formatClipLoad(load: number): string {
  return (Math.round(load * 10) / 10).toString().replace('.', ',');
}

/**
 * One-line description of what a clip shows: `S3 · 105 × 2`, `105 × 2`, `S3`,
 * or null when the athlete said nothing at all.
 *
 * Deliberately terse — it sits under a 68 px tile and beside a timestamp, and
 * a coach scanning a strip is matching numbers, not reading prose.
 */
export function describeClipTag(
  video: Pick<TrainingLogVideo, 'set_number' | 'performed_load' | 'performed_reps'>,
  sets: readonly TrainingLogSet[] = [],
): string | null {
  const { setNumber, load, reps } = resolveClipTag(video, sets);
  const parts: string[] = [];
  if (setNumber != null) parts.push(`S${setNumber}`);
  if (load != null && reps != null) parts.push(`${formatClipLoad(load)} × ${reps}`);
  else if (load != null) parts.push(`${formatClipLoad(load)} kg`);
  else if (reps != null) parts.push(`× ${reps}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Label for one set in the tag picker: `S2 · 105 × 2`, falling back to the
 *  planned numbers when the athlete has not logged the set yet. */
export function describeSetOption(set: TrainingLogSet): string {
  const load = set.performed_load ?? set.planned_load;
  const reps = set.performed_reps ?? set.planned_reps;
  if (load == null && reps == null) return `S${set.set_number}`;
  if (load == null) return `S${set.set_number} · × ${reps}`;
  if (reps == null) return `S${set.set_number} · ${formatClipLoad(load)} kg`;
  return `S${set.set_number} · ${formatClipLoad(load)} × ${reps}`;
}

/**
 * Which set a newly attached clip most likely shows.
 *
 * Sets that already have a clip are skipped — an athlete filming a second lift
 * is almost never filming the one they just filmed — and completed sets are
 * preferred over pending ones, because you film a lift after doing it. Returns
 * null when there is nothing worth guessing, which leaves the picker blank
 * rather than wrong.
 */
export function suggestSetForClip(
  sets: readonly TrainingLogSet[],
  alreadyTagged: readonly (number | null)[],
): number | null {
  const taken = new Set(alreadyTagged.filter((n): n is number => n != null));
  const free = sets.filter(s => !taken.has(s.set_number));
  const done = free.filter(s => s.status === 'completed');
  const pool = done.length > 0 ? done : free;
  if (pool.length === 0) return null;
  // The most recent completed set is the one just filmed; with none completed,
  // the first untagged set is the best neutral guess.
  return done.length > 0
    ? pool[pool.length - 1].set_number
    : pool[0].set_number;
}
