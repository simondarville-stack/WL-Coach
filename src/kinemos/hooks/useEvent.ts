/**
 * useEvent — a callback with one identity that always runs the latest body.
 *
 * The viewer re-renders on every frame, and most of its handlers close over
 * the current frame. Passing them straight to a memoised panel defeats the
 * memo: a new function each frame is a new prop. This keeps the identity and
 * swaps the body, so a panel that does not read the frame is not rendered
 * for it. Never call the result during render — it is for events.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
