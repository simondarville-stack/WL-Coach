/**
 * exerciseRanker — shared exercise search ranking.
 *
 * Single source of truth for the "type a name or code, get the best matches
 * first" behaviour used by the coach planner search (ExerciseSearch), the
 * combo builder (ComboCreatorModal) and the athlete-app add-training sheet.
 * Previously this scoring was duplicated verbatim in two components; keep it
 * here so the three surfaces can never drift.
 *
 * Ranking order (lower score = better, ties preserve incoming order via a
 * stable sort): exact code > code prefix > name prefix > code contains >
 * name contains. A non-match scores Infinity and is dropped.
 *
 * The ranker does NOT filter '— System' sentinels — callers decide whether to
 * exclude them (coach search and the athlete exercise picker do; the combo
 * builder historically does not).
 */

export interface RankableExercise {
  name: string;
  exercise_code: string | null;
}

/**
 * Score one exercise against an already-lowercased, trimmed query.
 * Returns Infinity when nothing matches.
 */
export function scoreExerciseMatch(ex: RankableExercise, q: string): number {
  const code = ex.exercise_code?.toLowerCase() ?? '';
  const name = ex.name.toLowerCase();
  if (code && code === q) return 0;
  if (code && code.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (code && code.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return Infinity;
}

/**
 * Rank and filter a list of exercises by a raw query string, best first.
 * An empty / whitespace-only query returns []. `limit` caps the result count.
 */
export function rankExercises<T extends RankableExercise>(
  exercises: T[],
  rawQuery: string,
  limit = 12,
): T[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  return exercises
    .map(ex => ({ ex, score: scoreExerciseMatch(ex, q) }))
    .filter(s => s.score !== Infinity)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(s => s.ex);
}
