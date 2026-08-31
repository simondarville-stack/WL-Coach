/**
 * useDraggable — make a floating panel draggable by its header.
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   const { containerStyle, handleProps } = useDraggable(containerRef);
 *   return (
 *     <div ref={containerRef} className="fixed bottom-4 right-4 ..." style={containerStyle}>
 *       <div {...handleProps}>...header...</div>
 *       ...body...
 *     </div>
 *   );
 *
 * Before the first drag the panel honours whatever positioning its
 * className specifies (e.g. Tailwind "bottom-4 right-4"). The first
 * pointerdown on the handle captures the current rect and switches to
 * inline left/top — including explicit `right: auto, bottom: auto` so
 * the original Tailwind anchors don't fight the new coordinates.
 *
 * Pointer events cover both mouse and touch. Clicks on interactive
 * children (button, input, textarea, select, a) inside the handle do
 * not initiate a drag, so close buttons in the header keep working.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

interface Position {
  left: number;
  top: number;
}

interface UseDraggableResult {
  containerStyle: CSSProperties;
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /**
   * Switch the panel to explicit left/top at its current on-screen rect
   * without a drag. Call this before resizing a panel programmatically so
   * it grows from a fixed corner instead of from its Tailwind anchor.
   */
  pin: () => void;
}

export function useDraggable(containerRef: RefObject<HTMLElement | null>): UseDraggableResult {
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef<{ x: number; y: number } | null>(null);

  const clampToViewport = useCallback(
    (left: number, top: number): Position => {
      const el = containerRef.current;
      if (!el) return { left, top };
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      return {
        left: Math.min(Math.max(0, left), maxLeft),
        top: Math.min(Math.max(0, top), maxTop),
      };
    },
    [containerRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Primary button only; ignore right-click, middle-click, etc.
      if (e.button !== 0) return;
      // Let interactive children (close X, inputs in the header) own the
      // event without starting a drag.
      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, select, a')) return;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setPosition(clampToViewport(rect.left, rect.top));
      setDragging(true);
      // Capture on the handle element (e.currentTarget) so we keep
      // receiving move/up even if the pointer leaves the header bar.
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [clampToViewport, containerRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const off = offsetRef.current;
      if (!off) return;
      setPosition(clampToViewport(e.clientX - off.x, e.clientY - off.y));
    },
    [clampToViewport],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    offsetRef.current = null;
    setDragging(false);
  }, []);

  const pin = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition(clampToViewport(rect.left, rect.top));
  }, [clampToViewport, containerRef]);

  // Re-clamp on window resize so a panel can't drift permanently off-screen.
  useEffect(() => {
    if (!position) return;
    const handler = () => setPosition(p => (p ? clampToViewport(p.left, p.top) : p));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [position, clampToViewport]);

  // A pinned panel that grows (e.g. the user resizes it) must stay on screen
  // too. Subscribed once per pin, not per pointer move.
  const pinned = position !== null;
  useEffect(() => {
    const el = containerRef.current;
    if (!pinned || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setPosition(p => (p ? clampToViewport(p.left, p.top) : p));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pinned, clampToViewport, containerRef]);

  const containerStyle: CSSProperties = position
    ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' }
    : {};

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    style: {
      cursor: dragging ? 'grabbing' : 'grab',
      touchAction: 'none',
      userSelect: 'none',
    } as CSSProperties,
  };

  return { containerStyle, handleProps, pin };
}
