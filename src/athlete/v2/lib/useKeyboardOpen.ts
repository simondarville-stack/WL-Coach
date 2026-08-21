import { useEffect, useState } from 'react';

/**
 * useKeyboardOpen — true while the phone's software keyboard covers the page.
 *
 * Read from the visual viewport: opening the keyboard shrinks the *visual*
 * viewport while the layout viewport stays its full height. iOS Safari never
 * reflows the page for the keyboard, so a `position: fixed` bottom bar sits
 * underneath it and visibly slides around as the page scrolls — a large part of
 * the "the view jumps around while I type" the athletes report.
 *
 * Falls back to `false` (bar always shown) where VisualViewport is missing.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // A keyboard eats a big slice of the viewport; a collapsing URL bar eats
      // a small one. 140 px sits well clear of browser chrome on every phone
      // and well under the shortest software keyboard.
      setOpen(window.innerHeight - vv.height > 140);
    };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  return open;
}
