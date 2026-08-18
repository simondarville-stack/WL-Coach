// Read-only preview of ANY parked clipboard item — an exercise, a training
// unit or a whole week. Opens on double-click from the dock and reads the
// in-memory snapshot, so no fetch is needed.
//
// Prescriptions render through StackedNotation, the canonical read-only visual
// (load above, reps below a divider, sets to the right). See
// docs/DISPLAY_CONVENTIONS.md — inline "load×reps×sets" is not used for
// coach-facing prescription display anywhere.

import { X } from 'lucide-react';
import type {
  ClipboardItem,
  ClipboardExerciseDisplay,
  ClipboardExerciseSnapshot,
} from './useClipboardState';
import { StackedNotation } from '../StackedNotation';
import { AdaptiveDialog } from '../../ui/AdaptiveDialog';

type PreviewExercise = { display: ClipboardExerciseDisplay; snapshot: ClipboardExerciseSnapshot };

interface PreviewSection {
  key: string;
  /** Null for a bare exercise, whose own name is already the dialog title. */
  label: string | null;
  exercises: PreviewExercise[];
}

/** Flatten the three clipboard shapes into one list of labelled sections, so
 *  the dialog body has a single rendering path. */
function toSections(item: ClipboardItem): { title: string; sections: PreviewSection[] } {
  if (item.kind === 'week') {
    return {
      title: item.label,
      sections: item.days.map(d => ({
        key: String(d.dayIndex),
        label: d.label,
        exercises: d.exercises,
      })),
    };
  }
  if (item.kind === 'day') {
    return {
      title: item.label,
      sections: [{ key: 'day', label: null, exercises: item.exercises }],
    };
  }
  return {
    title: item.display.label,
    sections: [{ key: 'exercise', label: null, exercises: [{ display: item.display, snapshot: item.snapshot }] }],
  };
}

interface ClipboardPreviewDialogProps {
  item: ClipboardItem;
  onClose: () => void;
}

export function ClipboardPreviewDialog({ item, onClose }: ClipboardPreviewDialogProps) {
  const { title, sections } = toSections(item);
  const numbered = item.kind === 'week';
  const emptyLabel = item.kind === 'week' ? 'This week has no training units.' : 'Nothing in this item.';

  return (
    <AdaptiveDialog onClose={onClose} maxWidth={640} ariaLabel="Clipboard item preview">
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--color-bg-secondary)',
          borderBottom: '0.5px solid var(--color-border-secondary)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <button
          onClick={onClose}
          style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)' }}
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
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 6,
                    paddingBottom: 4,
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
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
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 2,
                          padding: '4px 8px',
                          borderLeft: `3px solid ${s.combo_color || ex.display.color || '#94a3b8'}`,
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
              {emptyLabel}
            </div>
          )}
        </div>
      </div>
    </AdaptiveDialog>
  );
}
