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
 *
 * A column that is not in kilograms also exports a unit tag — `SN [%]`,
 * `SN [text]` — so the sheet says what its numbers mean. The tag sits BEFORE
 * the block suffix (`SN [%] (Target)`), so the suffix has to come off first;
 * stripping in the other order matches nothing, and the export then fails to
 * round-trip through its own import. `unitTag` is left undefined rather than
 * null when there is none, so callers comparing whole objects don't have to
 * care about columns that predate units.
 */
export type HeaderUnitTag = 'absolute_kg' | 'percentage' | 'free_text_reps';

/** The tags `unitLabel` emits, and nothing else — an exercise may legitimately
 *  be named "Snatch [comp]", and that is not a unit. */
const UNIT_TAGS: Record<string, HeaderUnitTag> = {
  kg: 'absolute_kg',
  '%': 'percentage',
  text: 'free_text_reps',
};

export function splitExerciseHeader(cell: string): {
  name: string;
  block: 'target' | 'actual' | 'plain';
  unitTag?: HeaderUnitTag;
} {
  const m = cell.match(/^(.*?)\s*\((Target|Actual)\)$/i);
  const rawName = m ? m[1].trim() : cell;
  const block = m ? (m[2].toLowerCase() as 'target' | 'actual') : 'plain';

  const tagged = rawName.match(/^(.*?)\s*\[([^\]]+)\]$/);
  const unitTag = tagged ? UNIT_TAGS[tagged[2].trim().toLowerCase()] : undefined;
  if (!unitTag) return { name: rawName, block };
  return { name: tagged![1].trim(), block, unitTag };
}
