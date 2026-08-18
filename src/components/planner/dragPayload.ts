/**
 * dragPayload — the planner's drag-and-drop grammar, in one place.
 *
 * The planner uses native HTML5 drag-and-drop. Every source writes an id into
 * `text/plain` and (now) a marker MIME type saying what kind of thing is
 * moving. The marker matters because `getData()` is blocked during `dragover`
 * — only the *type names* are readable — so anything that must decide while
 * the drag is still in the air has to read the kind off the type list.
 *
 * Custom type names must be all-lowercase: Chrome and Safari lowercase them,
 * so a mixed-case name would fail to match what the source wrote.
 */

/** Set by DayCard's exercise rows. */
export const MARK_EXERCISE = 'application/x-emos-exercise';
/** Set by DayCard's unit header (a whole training unit). */
export const MARK_DAY = 'application/x-emos-day';
/** Set by the unit header's grip handle — REORDERS the cards on the grid.
 *  Deliberately distinct from MARK_DAY: dragging the header itself moves a
 *  unit's CONTENT into another unit, which is a different gesture with a
 *  different (destructive) outcome, and the two must never be confused. Also
 *  deliberately not a ThrowKind — dragging a card to a new position and
 *  missing must not delete the unit. */
export const MARK_DAY_REORDER = 'application/x-emos-day-reorder';
/** Set by the clipboard panel's cards. */
export const MARK_CLIPBOARD = 'application/x-emos-clipboard';
/** Set by the dock's preset cards ("PRESET:<id>"). Deliberately NOT a
 *  ThrowKind — dragging a preset out of the dock must never delete it. */
export const MARK_PRESET = 'application/x-emos-preset';

/** Kinds that can be thrown away. Library and template drags are deliberately
 *  unmarked, and therefore un-throwable by construction — deleting a catalogue
 *  entry is not what a planner gesture should ever do. */
export type ThrowKind = 'exercise' | 'day' | 'clipboard';

export type ThrowPayload =
  | { kind: 'exercise'; fromDay: number; plannedExId: string }
  | { kind: 'day'; dayIndex: number }
  | { kind: 'clipboard'; itemId: string };

/** What kind of throwable thing is in the air, from the dragover type list. */
export function throwKindFromTypes(types: readonly string[]): ThrowKind | null {
  if (types.includes(MARK_EXERCISE)) return 'exercise';
  if (types.includes(MARK_DAY)) return 'day';
  if (types.includes(MARK_CLIPBOARD)) return 'clipboard';
  return null;
}

/**
 * Parse the `text/plain` payload written by the planner's drag sources.
 * Returns null for anything else — a file, selected text, a dock or template
 * drag — so an unrecognised drop is a no-op rather than a guess.
 */
export function parseThrowPayload(text: string): ThrowPayload | null {
  if (!text) return null;

  // A reorder drag carries no throwable thing — it moves a card's POSITION,
  // and there is nothing to delete if it lands nowhere. Checked before the
  // 'DAY:' prefix, which it would otherwise not match anyway.
  if (text.startsWith('DAYORDER:')) return null;

  if (text.startsWith('DAY:')) {
    const dayIndex = parseInt(text.slice(4), 10);
    return Number.isNaN(dayIndex) ? null : { kind: 'day', dayIndex };
  }

  if (text.startsWith('CLIPBOARD:')) {
    // CLIPBOARD:<exercise|day|week>:<id>. `week-day:<weekId>:<dayIndex>` is a
    // slice of a parked week, not an item of its own — there is nothing to
    // remove, so it is not throwable.
    const parts = text.split(':');
    if (parts.length < 3) return null;
    if (parts[1] === 'week-day') return null;
    return { kind: 'clipboard', itemId: parts[2] };
  }

  // <dayIndex>:exercise:<plannedExId>
  const parts = text.split(':');
  if (parts.length >= 3 && parts[1] === 'exercise') {
    const fromDay = parseInt(parts[0], 10);
    if (Number.isNaN(fromDay) || !parts[2]) return null;
    return { kind: 'exercise', fromDay, plannedExId: parts[2] };
  }

  return null;
}
