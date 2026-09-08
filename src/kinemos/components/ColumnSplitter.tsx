/**
 * ColumnSplitter — the drag handle between two of the viewer's columns.
 *
 * The three columns (clip, bar path, rail) open at the wireframe's widths,
 * which fit a 1440 px screen with a portrait phone clip. A landscape clip, a
 * wider window or a coach who wants the rail to breathe all need different
 * numbers, and the honest way to give them is a handle, not a setting. A
 * drag resizes the column to its left; a double-click puts it back.
 *
 * Eight pixels wide to hit, one pixel drawn — the columns already have a gap
 * between them, and the handle lives in it.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface ColumnSplitterProps {
  /** The current width of the column to the left, so a drag is measured
   *  from where it started and not from wherever a clamp left it. */
  width: number;
  /** Called on every move with the width the drag asks for; the owner
   *  clamps and stores it. */
  onResize: (width: number) => void;
  /** A double-click: back to the default width. */
  onReset: () => void;
  label: string;
}

export function ColumnSplitter({ width, onResize, onReset, label }: ColumnSplitterProps) {
  const dragRef = useRef<{ fromX: number; fromWidth: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { fromX: e.clientX, fromWidth: width };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture: the drag still works while the pointer stays on the handle.
    }
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onResize(drag.fromWidth + (e.clientX - drag.fromX));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      className="kinemos-splitter"
      style={{
        flexShrink: 0,
        width: 8,
        margin: '0 -4px',
        alignSelf: 'stretch',
        cursor: 'col-resize',
        display: 'flex',
        justifyContent: 'center',
        touchAction: 'none',
        zIndex: 1,
      }}
    >
      <span className="kinemos-splitter-line" />
    </div>
  );
}
