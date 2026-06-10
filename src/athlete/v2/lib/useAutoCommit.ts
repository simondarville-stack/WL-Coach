import { useEffect, useRef } from 'react';

/**
 * useAutoCommit — debounce-on-type plus flush-on-hide for free-text fields.
 *
 * The athlete app persists notes on `onBlur`. On mobile the dominant way a
 * session ends — switching apps, locking the phone, the PWA being evicted —
 * does NOT fire blur, so the last note silently vanishes. This hook closes
 * that gap without changing the save path:
 *
 *   • a ~800 ms debounce commits shortly after the athlete stops typing, and
 *   • a `pagehide` / `visibilitychange` (hidden) listener flushes immediately
 *     when the tab is backgrounded or torn down, and
 *   • an unmount cleanup flushes when the card is swapped out (e.g. day change).
 *
 * `commit` MUST be idempotent and self-guard on whether `value` actually
 * differs from what is already persisted (the existing onBlur handlers
 * already do this), because it will be called speculatively. Keep the
 * field's existing `onBlur={commit}` — this is purely additive.
 */
export function useAutoCommit(value: string, commit: () => void, delayMs = 800): void {
  // Hold the latest commit closure in a ref so the listeners/timers always
  // see current state without being torn down and re-armed every render.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  // Debounce-on-type: fire `delayMs` after the last change. On mount the
  // value equals what's persisted, so the speculative call is a no-op.
  useEffect(() => {
    const t = setTimeout(() => commitRef.current(), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  // Flush when the page is hidden / unloading, and once on unmount.
  useEffect(() => {
    const flush = () => commitRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') commitRef.current();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      commitRef.current();
    };
  }, []);
}
