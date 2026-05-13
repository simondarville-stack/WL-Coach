// Read-only preview of a programme template — opens from the dock on
// double-click and shows the full content (training units + their
// exercises + prescriptions) without committing to a drop. Lets coaches
// inspect a template before applying it.

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { fetchTemplateFull } from '../../../lib/templateService';
import type { ProgramTemplateFull } from '../../../lib/database.types';
import {
  parsePrescription,
  parseFreeTextPrescription,
  parseComboPrescription,
} from '../../../lib/prescriptionParser';

interface TemplatePreviewDialogProps {
  templateId: string;
  onClose: () => void;
}

export function TemplatePreviewDialog({ templateId, onClose }: TemplatePreviewDialogProps) {
  const [template, setTemplate] = useState<ProgramTemplateFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await fetchTemplateFull(templateId);
        if (cancelled) return;
        if (!t) {
          setError('Template not found');
          setLoading(false);
          return;
        }
        setTemplate(t);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load template');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

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
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }}
        onClick={onClose}
      />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {template?.name ?? 'Template preview'}
            </span>
            {template?.description && (
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                {template.description}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: 4, border: 'none', background: 'transparent',
              cursor: 'pointer', color: 'var(--color-text-secondary)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 0', color: 'var(--color-text-tertiary)', fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: 'var(--color-danger-text)', background: 'var(--color-danger-bg)', border: '0.5px solid var(--color-danger-border)', padding: 10, borderRadius: 'var(--radius-sm)' }}>
              {error}
            </div>
          ) : template ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {template.days.map(day => (
                <DayPreview key={day.id} day={day} />
              ))}
              {template.days.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>
                  This template has no training units yet.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DayPreview({ day }: { day: ProgramTemplateFull['days'][number] }) {
  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'baseline', gap: 6,
          paddingBottom: 4,
          borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}
      >
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
          {day.day_index}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {day.label}
        </span>
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
          {day.exercises.map(ex => (
            <ExercisePreview key={ex.id} ex={ex} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExercisePreview({ ex }: { ex: ProgramTemplateFull['days'][number]['exercises'][number] }) {
  const lines = readableLines(ex.prescription_raw, ex.unit, ex.is_combo);
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        padding: '4px 8px',
        borderLeft: `3px solid ${ex.combo_color || ex.exercise.color || '#94a3b8'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {ex.exercise.name}
        </span>
        {ex.variation_note && (
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            {ex.variation_note}
          </span>
        )}
      </div>
      {lines.length > 0 && (
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
          {lines.join('  ·  ')}
        </span>
      )}
      {ex.notes && (
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          {ex.notes}
        </span>
      )}
    </div>
  );
}

/** Pretty-print the prescription_raw for read-only display in the
 *  preview. Falls back to the raw string if parsing fails. */
function readableLines(raw: string | null, unit: string | null, isCombo: boolean): string[] {
  if (!raw) return [];
  const sym = unit === 'percentage' ? '%' : '';
  try {
    if (unit === 'free_text_reps') {
      const lines = parseFreeTextPrescription(raw);
      return lines.map(l =>
        l.sets > 1
          ? `${l.loadText}×${l.reps}×${l.sets}`
          : `${l.loadText}×${l.reps}`,
      );
    }
    if (isCombo) {
      const lines = parseComboPrescription(raw);
      return lines.map(l => {
        const load = l.loadText
          ? l.loadText
          : l.loadMax != null
          ? `${l.load}-${l.loadMax}${sym}`
          : `${l.load}${sym}`;
        return l.sets > 1 ? `${load}×${l.repsText}×${l.sets}` : `${load}×${l.repsText}`;
      });
    }
    const lines = parsePrescription(raw);
    return lines.map(l => {
      const load = l.loadMax != null ? `${l.load}-${l.loadMax}${sym}` : `${l.load}${sym}`;
      return l.sets > 1 ? `${load}×${l.reps}×${l.sets}` : `${load}×${l.reps}`;
    });
  } catch {
    return [raw];
  }
}
