// Read-only preview of a parked clipboard item — an exercise, a training unit
// or a whole week. Opens on double-click from the dock.
//
// Deliberately NOT an AdaptiveDialog. That primitive is modal by contract:
// dimmed backdrop, focus trap, `aria-modal`, scroll lock — all correct for a
// dialog, and all fatal here. The point of this panel is to sit OPEN beside the
// planner while a coach builds the next week, dragging days and single
// exercises out of it onto the grid behind. A backdrop would swallow every one
// of those drops, and a focus trap would fight the planner. So it is a floating
// palette: non-modal, movable by its header, closed by Escape or ×.
//
// Prescriptions render through StackedNotation — see docs/DISPLAY_CONVENTIONS.md.

import { useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import type {
  ClipboardItem,
  ClipboardExerciseDisplay,
  ClipboardExerciseSnapshot,
} from './useClipboardState';
import { StackedNotation } from '../StackedNotation';
import { MARK_CLIPBOARD } from '../dragPayload';

type PreviewExercise = { display: ClipboardExerciseDisplay; snapshot: ClipboardExerciseSnapshot };

interface PreviewSection {
  key: string;
  /** Null for a bare exercise, whose own name is already the panel title. */
  label: string | null;
  /** Source day index inside a parked week, for the drag payloads. */
  dayIndex: number | null;
  exercises: PreviewExercise[];
}

function toSections(item: ClipboardItem): { title: string; sections: PreviewSection[] } {
  if (item.kind === 'week') {
    return {
      title: item.label,
      sections: item.days.map(d => ({
        key: String(d.dayIndex),
        label: d.label,
        dayIndex: d.dayIndex,
        exercises: d.exercises,
      })),
    };
  }
  if (item.kind === 'day') {
    return {
      title: item.label,
      sections: [{ key: 'day', label: null, dayIndex: null, exercises: item.exercises }],
    };
  }
  return {
    title: item.display.label,
    sections: [{
      key: 'exercise',
      label: null,
      dayIndex: null,
      exercises: [{ display: item.display, snapshot: item.snapshot }],
    }],
  };
}

interface ClipboardPreviewDialogProps {
  item: ClipboardItem;
  onClose: () => void;
}

export function ClipboardPreviewDialog({ item, onClose }: ClipboardPreviewDialogProps) {
  const { title, sections } = toSections(item);
  const numbered = item.kind === 'week';
  const isWeek = item.kind === 'week';

  // Position is the panel's own state so it can be dragged anywhere. Starts
  // left of centre, clear of the dock on the right.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(16, Math.round(window.innerWidth / 2) - 500),
    y: 90,
  }));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pointer events, not HTML5 drag: the header must move the panel, while the
  // rows inside it stay native drag SOURCES for the planner behind.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragRef.current) return;
      // Keep a grabbable strip on screen, but only clamp when the viewport is
      // actually bigger than that strip. A naive
      // `min(innerWidth - 240, x)` goes NEGATIVE on a narrow window and pins
      // the panel to the top-left corner mid-drag.
      const maxX = Math.max(0, window.innerWidth - 240);
      const maxY = Math.max(0, window.innerHeight - 60);
      const rawX = e.clientX - dragRef.current.dx;
      const rawY = e.clientY - dragRef.current.dy;
      setPos({
        x: Math.max(0, maxX > 0 ? Math.min(maxX, rawX) : rawX),
        y: Math.max(0, maxY > 0 ? Math.min(maxY, rawY) : rawY),
      });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const rowDrag = (payload: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', payload);
      e.dataTransfer.setData(MARK_CLIPBOARD, '1');
      e.dataTransfer.effectAllowed = 'copy';
    },
  });

  return (
    <div
      // Excluded from the planner's throw-away gesture: the panel is chrome,
      // not something that can be dropped into a bin.
      data-emos-no-throw
      role="region"
      aria-label="Clipboard item preview"
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 60,
        width: 'min(560px, calc(100vw - 32px))',
        maxHeight: 'min(70vh, 720px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 10px 34px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
    >
      <div
        onPointerDown={e => {
          dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 12px',
          background: 'var(--color-bg-secondary)',
          borderBottom: '0.5px solid var(--color-border-secondary)',
          cursor: 'grab', userSelect: 'none',
        }}
      >
        <GripVertical size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <span style={{
          fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        {isWeek && (
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
            drag a day or an exercise onto the week
          </span>
        )}
        <button
          onClick={onClose}
          onPointerDown={e => e.stopPropagation()}
          title="Close preview"
          style={{
            marginLeft: 'auto', padding: 4, border: 'none', background: 'transparent',
            cursor: 'pointer', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)',
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sections.map((section, i) => (
            <div key={section.key}>
              {section.label !== null && (
                <div
                  {...(isWeek && section.dayIndex !== null
                    ? rowDrag(`CLIPBOARD:week-day:${item.id}:${section.dayIndex}`)
                    : {})}
                  title={isWeek ? 'Drag this whole day onto a unit' : undefined}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 6,
                    paddingBottom: 4,
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    cursor: isWeek ? 'grab' : 'default',
                  }}
                >
                  {numbered && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{section.label}</span>
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                    {section.exercises.length} {section.exercises.length === 1 ? 'exercise' : 'exercises'}
                  </span>
                </div>
              )}

              {section.exercises.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '6px 0 0' }}>
                  No exercises in this training unit.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: section.label !== null ? 6 : 0 }}>
                  {section.exercises.map((ex, j) => {
                    const s = ex.snapshot;
                    return (
                      <div
                        key={j}
                        {...(isWeek && section.dayIndex !== null
                          ? rowDrag(`CLIPBOARD:week-ex:${item.id}:${section.dayIndex}:${j}`)
                          : {})}
                        title={isWeek ? 'Drag this exercise onto a unit' : undefined}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 2,
                          padding: '4px 8px',
                          borderLeft: `3px solid ${s.combo_color || ex.display.color || '#94a3b8'}`,
                          cursor: isWeek ? 'grab' : 'default',
                          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                        }}
                        onMouseEnter={e => {
                          if (isWeek) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{ex.display.label}</span>
                          {!s.notes?.trim() && s.variation_note && (
                            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{s.variation_note}</span>
                          )}
                        </div>
                        {s.notes && (
                          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{s.notes}</span>
                        )}
                        <StackedNotation raw={s.prescription_raw} unit={s.unit} isCombo={s.is_combo} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {sections.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>
              This week has no training units.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
