/**
 * Header parsing for the macro Excel import/export (MacroExcelIO).
 *
 * Pure, so it can be tested without the component — the round-trip bug this
 * guards against (export → import matched nothing) was invisible in types and
 * only reachable through a file.
 */

/**
 * Split an exported exercise band header into the exercise key and which
 * block it opens.
 *
 * The "with actuals" export writes `"<code> (Target)"` and
 * `"<code> (Actual)"` above each exercise's columns. Import must match the
 * `<code>` part against the tracked exercise, and must ignore the Actual
 * block — those are derived values (what the athlete did), never plan input.
 * A template export writes the bare code, which comes back as `'plain'`.
 *
 * Parentheses that belong to the exercise name ("Squat (front)") survive:
 * only a trailing `(Target)` / `(Actual)` is treated as the suffix.
 */
export function splitExerciseHeader(cell: string): { name: string; block: 'target' | 'actual' | 'plain' } {
  const m = cell.match(/^(.*?)\s*\((Target|Actual)\)$/i);
  if (!m) return { name: cell, block: 'plain' };
  return { name: m[1].trim(), block: m[2].toLowerCase() as 'target' | 'actual' };
}
