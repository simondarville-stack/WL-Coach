/**
 * useElementWidth — an element's content-box width, kept current.
 *
 * The viewer's three columns are sized in numbers, not fractions, so the
 * rail's share is whatever the window leaves — and on a 1440 px screen with
 * the app's sidebar open, a landscape clip's 600 px column left it 200 px
 * and its content clipped at the edge (08/09/2026). Knowing the row's width
 * lets the fixed columns give way before the rail does.
 *
 * A callback ref, not an effect on mount: the element this measures appears
 * only once the clip has loaded, long after the hook's first render, and an
 * effect that looked once would have found nothing and measured nothing.
 * jsdom has no ResizeObserver; the width stays 0 there, which every caller
 * treats as "unmeasured, no cap".
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') {
      setWidth(0);
      return;
    }
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setWidth(current => (Math.abs(current - rect.width) < 0.5 ? current : rect.width));
    });
    observer.observe(el);
    observerRef.current = observer;
    setWidth(el.getBoundingClientRect().width);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, width];
}
