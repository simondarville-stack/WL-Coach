/**
 * useMediaQuery — a CSS media query as a boolean, kept current.
 *
 * The viewer's columns are inline styles, which cannot carry a media query;
 * this is how the panel rail knows to drop under the plots on a narrow
 * window rather than shrink beside them. jsdom has no `matchMedia`, so the
 * hook answers `fallback` there and the layout renders at its desktop shape.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string, fallback = true): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
