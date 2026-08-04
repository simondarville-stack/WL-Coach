/**
 * ratioAnalysisDraft — device-local working copy of the Ratio Analysis sheet.
 *
 * The sheet is a scratchpad: pick an athlete, load a model, repoint rows, type
 * over Actual values. None of that is saved until the coach presses Save, which
 * is correct — a half-built comparison should not become a stored analysis.
 *
 * But the surface is a React component inside a route, so walking over to the
 * PR page to check a number unmounts it and threw the whole sheet away. That
 * made the obvious workflow — "what's his real 3RM again?" — cost the coach
 * everything they had set up.
 *
 * So the in-flight sheet is mirrored to localStorage on every change and
 * restored on mount. Device-local, not a server row, for the same reason
 * `logViewPrefs` is: it is unsaved working state, not athlete data, and it must
 * not need a migration or a round-trip.
 *
 * Storage is best-effort throughout — a private-mode browser simply behaves the
 * way it did before.
 */

const DRAFT_KEY = 'emos.ratioAnalysis.draft';

/** Bumped when the sheet shape changes incompatibly; older drafts are dropped. */
const DRAFT_VERSION = 1;

interface Envelope<T> {
  v: number;
  savedAt: number;
  sheet: T;
}

/**
 * Restore the last in-flight sheet, or null when there is none / it is
 * unreadable / it was written by an older shape.
 *
 * Deliberately untyped in the payload: the caller owns `SheetState` and knows
 * how to validate it. A draft is a convenience, so anything suspicious is
 * discarded rather than repaired.
 */
export function loadRatioDraft<T>(isValid: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<unknown>;
    if (!parsed || parsed.v !== DRAFT_VERSION) return null;
    return isValid(parsed.sheet) ? parsed.sheet : null;
  } catch {
    return null;
  }
}

export function saveRatioDraft<T>(sheet: T): void {
  try {
    const envelope: Envelope<T> = { v: DRAFT_VERSION, savedAt: Date.now(), sheet };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    /* quota / private mode — the sheet just won't survive a remount */
  }
}

export function clearRatioDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* best-effort */
  }
}
