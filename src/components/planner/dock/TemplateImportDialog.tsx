import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, ArrowRight } from 'lucide-react';
import {
  applyTemplateToPlan,
  fetchTemplateFull,
} from '../../../lib/templateService';
import type { ProgramTemplateFull } from '../../../lib/database.types';

interface TemplateImportDialogProps {
  templateId: string;
  weekPlanId: string;
  // Active week days in display order — { index, name }
  visibleDays: { index: number; name: string }[];
  // The day the coach dropped on (or the first active day if launched via
  // the "Import…" button). Seeds the sequential mapping default.
  startDayIndex: number;
  onClose: () => void;
  onApplied: () => void;
}

type DayMapping = Record<number, number | null>;

function buildDefaultMapping(
  template: ProgramTemplateFull,
  visibleDays: { index: number; name: string }[],
  startDayIndex: number,
): DayMapping {
  const startPos = Math.max(0, visibleDays.findIndex(d => d.index === startDayIndex));
  const mapping: DayMapping = {};
  for (let i = 0; i < template.days.length; i++) {
    const targetPos = startPos + i;
    mapping[template.days[i].day_index] =
      targetPos < visibleDays.length ? visibleDays[targetPos].index : null;
  }
  return mapping;
}

export function TemplateImportDialog({
  templateId,
  weekPlanId,
  visibleDays,
  startDayIndex,
  onClose,
  onApplied,
}: TemplateImportDialogProps) {
  const [template, setTemplate] = useState<ProgramTemplateFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [replace, setReplace] = useState(false);
  const [mapping, setMapping] = useState<DayMapping>({});

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
        setMapping(buildDefaultMapping(t, visibleDays, startDayIndex));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load template');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, visibleDays, startDayIndex]);

  // Esc closes the dialog (matches the existing dialog idiom in WeeklyPlanner).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, applying]);

  const mappedCount = useMemo(
    () => Object.values(mapping).filter(v => v != null).length,
    [mapping],
  );

  const handleApply = async () => {
    if (!template || mappedCount === 0) return;
    setApplying(true);
    setError(null);
    try {
      await applyTemplateToPlan(templateId, weekPlanId, mapping, { replace });
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template');
      setApplying(false);
    }
  };

  return (
    <div
      className="animate-backdrop-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }}
        onClick={() => { if (!applying) onClose(); }}
      />
      <div
        className="animate-dialog-in"
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: 640,
          maxHeight: '85vh',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Header
          title={template ? `Import "${template.name}"` : 'Import template'}
          subtitle={template ? `${template.days.length} template day${template.days.length === 1 ? '' : 's'}` : null}
          onClose={() => { if (!applying) onClose(); }}
          disabled={applying}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 0', color: 'var(--color-text-tertiary)', fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" />
              Loading template…
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: 'var(--color-danger-text)', background: 'var(--color-danger-bg)', border: '0.5px solid var(--color-danger-border)', padding: 10, borderRadius: 'var(--radius-sm)' }}>
              {error}
            </div>
          ) : template ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ColumnHeaders />
              {template.days.map(day => (
                <MappingRow
                  key={day.id}
                  templateDayIndex={day.day_index}
                  templateDayLabel={day.label}
                  exerciseCount={day.exercises.length}
                  selectedTarget={mapping[day.day_index] ?? null}
                  visibleDays={visibleDays}
                  onChange={target =>
                    setMapping(m => ({ ...m, [day.day_index]: target }))
                  }
                />
              ))}

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 12,
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={e => setReplace(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Replace existing exercises on target days (clears the day first)
              </label>
            </div>
          ) : null}
        </div>

        <Footer
          mappedCount={mappedCount}
          totalDays={template?.days.length ?? 0}
          applying={applying}
          disabled={loading || !!error || mappedCount === 0}
          onCancel={() => { if (!applying) onClose(); }}
          onApply={handleApply}
        />
      </div>
    </div>
  );
}

function Header({
  title, subtitle, onClose, disabled,
}: { title: string; subtitle: string | null; onClose: () => void; disabled: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '0.5px solid var(--color-border-secondary)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {subtitle}
          </span>
        )}
      </div>
      <button
        onClick={onClose}
        disabled={disabled}
        style={{
          padding: 4,
          border: 'none',
          background: 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: 'var(--color-text-secondary)',
          borderRadius: 'var(--radius-sm)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function ColumnHeaders() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 16px 1fr',
        gap: 8,
        fontSize: 'var(--text-caption)',
        color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        paddingBottom: 4,
        borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}
    >
      <span>Template day</span>
      <span />
      <span>Target week day</span>
    </div>
  );
}

interface MappingRowProps {
  templateDayIndex: number;
  templateDayLabel: string;
  exerciseCount: number;
  selectedTarget: number | null;
  visibleDays: { index: number; name: string }[];
  onChange: (target: number | null) => void;
}

function MappingRow({
  templateDayIndex,
  templateDayLabel,
  exerciseCount,
  selectedTarget,
  visibleDays,
  onChange,
}: MappingRowProps) {
  const isSkipped = selectedTarget == null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 16px 1fr',
        gap: 8,
        alignItems: 'center',
        padding: '6px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          background: isSkipped ? 'var(--color-bg-secondary)' : 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-sm)',
          opacity: isSkipped ? 0.55 : 1,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-tertiary)',
            minWidth: 14,
          }}
        >
          {templateDayIndex}
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {templateDayLabel}
        </span>
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
          }}
          title={`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`}
        >
          {exerciseCount}×
        </span>
      </div>
      <ArrowRight size={12} style={{ color: isSkipped ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)', margin: '0 auto' }} />
      <select
        value={selectedTarget == null ? '' : String(selectedTarget)}
        onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        style={{
          fontSize: 12,
          color: 'var(--color-text-primary)',
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          cursor: 'pointer',
        }}
      >
        <option value="">Skip</option>
        {visibleDays.map(d => (
          <option key={d.index} value={d.index}>{d.name}</option>
        ))}
      </select>
    </div>
  );
}

function Footer({
  mappedCount, totalDays, applying, disabled, onCancel, onApply,
}: {
  mappedCount: number;
  totalDays: number;
  applying: boolean;
  disabled: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderTop: '0.5px solid var(--color-border-secondary)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
        {totalDays > 0
          ? `${mappedCount} of ${totalDays} template day${totalDays === 1 ? '' : 's'} will be applied`
          : ''}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
          disabled={applying}
          style={{
            fontSize: 11,
            padding: '6px 12px',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-sm)',
            cursor: applying ? 'not-allowed' : 'pointer',
            opacity: applying ? 0.5 : 1,
          }}
        >
          Cancel
        </button>
        <button
          onClick={onApply}
          disabled={disabled || applying}
          style={{
            fontSize: 11,
            padding: '6px 14px',
            background: 'var(--color-accent)',
            color: 'var(--color-text-on-accent)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: disabled || applying ? 'not-allowed' : 'pointer',
            opacity: disabled || applying ? 0.5 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {applying && <Loader2 size={11} className="animate-spin" />}
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
