// Read-only preview of a parked clipboard week — opens from the dock on
// double-click and shows the full content (training units + their exercises +
// prescriptions), mirroring the programme-template preview. Reads from the
// in-memory snapshot, so no fetch is needed.

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ClipboardWeekItem } from './useClipboardState';
import { readableLines } from './TemplatePreviewDialog';

interface ClipboardWeekPreviewDialogProps {
  week: ClipboardWeekItem;
  onClose: () => void;
}

export function ClipboardWeekPreviewDialog({ week, onClose }: ClipboardWeekPreviewDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="animate-backdrop-in"
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }} onClick={onClose} />
      <div
        className="animate-dialog-in"
        style={{
          position: 'relative', zIndex: 10,
          width: '100%', maxWidth: 640, maxHeight: '85vh',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--color-bg-secondary)',
            borderBottom: '0.5px solid var(--color-border-secondary)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {week.label}
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
            {week.days.map((day, i) => (
              <div key={day.dayIndex}>
                <div
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 6,
                    paddingBottom: 4,
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                  }}
                >
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{day.label}</span>
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                    {day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}
                  </span>
                </div>
                {day.exercises.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '6px 0 0' }}>
                    No exercises in this training unit.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
                    {day.exercises.map((ex, j) => {
                      const s = ex.snapshot;
                      const lines = readableLines(s.prescription_raw, s.unit, s.is_combo);
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
                          {lines.length > 0 && (
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{lines.join('  ·  ')}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {week.days.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>
                This week has no training units.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
