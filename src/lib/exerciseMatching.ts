/**
 * exerciseMatching — the single matching rule for "is this personal exercise
 * the same lift as that club exercise?".
 *
 * Used by the Phase-3 adopt wizard and the Phase-4 Duplicates panel (and any
 * future create-time duplicate detection), so the product never disagrees
 * with itself about what counts as a duplicate.
 *
 * Precedence: exercise code (case-insensitive) beats exact name beats alias
 * (in either direction). Codes are the coaches' own short keys and the most
 * reliable signal; aliases exist precisely to record alternative names.
 */

export type MatchBy = 'code' | 'name' | 'alias';

export interface MatchableExercise {
  id: string;
  name: string;
  exercise_code: string | null;
  aliases: string[] | null;
}

export function matchExercise<T extends MatchableExercise>(
  source: MatchableExercise,
  targets: T[],
): { match: T | null; matchBy: MatchBy | null } {
  const code = source.exercise_code?.trim().toLowerCase();
  if (code) {
    const byCode = targets.find(t => t.exercise_code?.trim().toLowerCase() === code);
    if (byCode) return { match: byCode, matchBy: 'code' };
  }
  const name = source.name.trim().toLowerCase();
  const byName = targets.find(t => t.name.trim().toLowerCase() === name);
  if (byName) return { match: byName, matchBy: 'name' };
  const byAlias = targets.find(t =>
    (t.aliases ?? []).some(a => a.trim().toLowerCase() === name)
    || (source.aliases ?? []).some(a => a.trim().toLowerCase() === t.name.trim().toLowerCase()),
  );
  if (byAlias) return { match: byAlias, matchBy: 'alias' };
  return { match: null, matchBy: null };
}
