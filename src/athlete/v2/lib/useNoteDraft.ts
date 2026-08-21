import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useAutoCommit } from './useAutoCommit';

/**
 * useNoteDraft — an echo-safe draft for a free-text field backed by the server.
 *
 * Every athlete note field used to be written as:
 *
 *   const [notes, setNotes] = useState(row?.performed_notes ?? '');
 *   useEffect(() => setNotes(row?.performed_notes ?? ''), [row?.performed_notes]);
 *   useAutoCommit(notes, commitNotes);
 *
 * which is a race. The debounce commits ~800 ms after the last keystroke; on a
 * phone the round-trip (getOrCreateSession → update → merge) easily outlasts
 * the gap to the next keystroke. The saved text then comes back as a new
 * `performed_notes`, the sync effect fires, and `setNotes(server)` overwrites
 * the box with a stale snapshot. Two things happen at once:
 *
 *   • the browser rewrites a controlled <textarea> value and drops the caret at
 *     the END — the reported "cursor skips to the end", and the reason it was
 *     impossible to tap back into the middle of a sentence and fix a typo, and
 *   • the characters typed during the round-trip are gone, and the old guard
 *     (`if (server !== notes) persist()`) then saw them as equal and never
 *     re-saved — so the correction was silently lost.
 *
 * The rule here: the athlete owns the field. A server value is written into the
 * box only when the box is *idle* — nothing focused, and no local edit ahead of
 * the last thing we sent. Our own write echoing back is recognised by comparing
 * against `sentRef`, never against the box, so it can never clobber the caret.
 *
 * Commit cadence is unchanged (blur + debounce + pagehide/visibilitychange/
 * unmount via useAutoCommit) — this only fixes who wins on a collision.
 */
export interface NoteDraft {
  /** Current draft text. */
  value: string;
  /** Persist now if the draft differs from the last text sent. Idempotent. */
  commit: () => void;
  /** Spread onto the textarea — value + change/focus/blur wiring. */
  bind: {
    value: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

export function useNoteDraft(
  /** What the server currently holds for this field ('' when unset). */
  remote: string,
  /** Writes `value` to the server. Called with the latest draft only. */
  persist: (value: string) => void | Promise<void>,
  delayMs = 800,
): NoteDraft {
  const [value, setValue] = useState(remote);

  const valueRef = useRef(value);
  valueRef.current = value;

  /** The last text handed to `persist`, seeded with what the server had at
   *  mount. A `remote` equal to this is our own write coming back. */
  const sentRef = useRef(remote);
  const focusedRef = useRef(false);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Accept a server value only into an idle box. Both guards matter: `focused`
  // covers the athlete pausing mid-sentence (draft momentarily equal to what we
  // sent, caret still parked in the middle), and the draft/sent comparison
  // covers an unfocused field with a debounce still pending.
  useEffect(() => {
    if (focusedRef.current) return;
    if (valueRef.current !== sentRef.current) return;
    sentRef.current = remote;
    setValue(remote);
  }, [remote]);

  const commit = useCallback(() => {
    const next = valueRef.current;
    if (next === sentRef.current) return;
    const previous = sentRef.current;
    // Mark as sent BEFORE awaiting: the debounce and blur can both fire around
    // the same keystroke, and without this they'd write the same text twice.
    sentRef.current = next;
    void (async () => {
      try {
        await persistRef.current(next);
      } catch {
        // The write failed — forget we sent it so the next blur or debounce
        // retries instead of treating the text as safely stored.
        if (sentRef.current === next) sentRef.current = previous;
      }
    })();
  }, []);

  // Blur + debounce-on-type + flush on pagehide / app-background / unmount.
  useAutoCommit(value, commit, delayMs);

  return {
    value,
    commit,
    bind: {
      value,
      onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value),
      onFocus: () => {
        focusedRef.current = true;
      },
      onBlur: () => {
        focusedRef.current = false;
        commit();
      },
    },
  };
}
