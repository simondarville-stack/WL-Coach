// Shared modal for saving the current plan as a programme template.
//
// "Day" mode (mode='day') captures a single training unit. Name defaults
// to the day label; the resulting template is single-day.
//
// "Week" mode (mode='week') captures a whole week. The coach picks which
// active days to include (defaults to all non-empty days), optionally
// renames each, then a multi-day template is created. Days keep their
// source labels.
//
// In both modes the prescription content is copied verbatim — no kg→%
// back-conversion. Coaches build templates against the plan they already
// have; abstraction is a future concern (see plan).

import { useEffect, useState } from 'react';
import { X, Loader2, Save } from 'lucide-react';

export type SaveAsTemplateMode = 'day' | 'week';

interface DayChoice {
  index: number;
  label: string;
  exerciseCount: number;
}

export interface SaveAsTemplateInput {
  name: string;
  description: string | null;
  // Week mode only: per source day_index → label to use in the template.
  // Days missing from this map are excluded from the template.
  dayLabels?: Record<number, string>;
  /** If true, the caller routes the save through the kg → % converter
   *  modal before the template rows land in the database. The original
   *  plan is untouched. */
  convertToPercentages: boolean;
}

interface SaveAsTemplateModalProps {
  mode: SaveAsTemplateMode;
  defaultName: string;
  defaultDescription?: string;
  // Week mode only.
  availableDays?: DayChoice[];
  /** Whether the scope contains any kg prescriptions that would benefit
   *  from a kg → % conversion before saving. When false the convert
   *  checkbox is hidden to avoid clutter. */
  hasKgPrescriptions: boolean;
  onClose: () => void;
  onSave: (input: SaveAsTemplateInput) => Promise<void>;
}

export function SaveAsTemplateModal({
  mode,
  defaultName,
  defaultDescription,
  availableDays,
  hasKgPrescriptions,
  onClose,
  onSave,
}: SaveAsTemplateModalProps) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription ?? '');
  const [convertToPercentages, setConvertToPercentages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Week mode: per-day inclusion + label override. Default to including
  // every day that has at least one exercise.
  const [included, setIncluded] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    (availableDays ?? []).forEach(d => { init[d.index] = d.exerciseCount > 0; });
    return init;
  });
  const [dayLabels, setDayLabels] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    (availableDays ?? []).forEach(d => { init[d.index] = d.label; });
    return init;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const includedCount = mode === 'week'
    ? Object.values(included).filter(Boolean).length
    : 1;
  const canSave = name.trim().length > 0 && includedCount > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const labels: Record<number, string> | undefined = mode === 'week'
        ? Object.fromEntries(
            Object.entries(included)
              .filter(([, on]) => on)
              .map(([idx]) => [Number(idx), dayLabels[Number(idx)] ?? `Training unit`]),
          )
        : undefined;
      await onSave({
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        dayLabels: labels,
        convertToPercentages: hasKgPrescriptions && convertToPercentages,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
      setSaving(false);
    }
  };

  return (
    <div
      className="animate-backdrop-in"
      style={{
        position: 'fixed', inset: 0, zIndex: 55,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }}
        onClick={() => { if (!saving) onClose(); }}
      />
      <div
        className="animate-dialog-in"
        style={{
          position: 'relative', zIndex: 10,
          width: '100%', maxWidth: 520, maxHeight: '85vh',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Header
          title={mode === 'day' ? 'Save training unit as template' : 'Save week as template'}
          onClose={() => { if (!saving) onClose(); }}
          disabled={saving}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Template name"
              autoFocus
              style={inputStyle}
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this template is for, who it suits…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          {mode === 'week' && availableDays && availableDays.length > 0 && (
            <Field label={`Training units to include (${includedCount}/${availableDays.length})`}>
              <div
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  border: '0.5px solid var(--color-border-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 4,
                }}
              >
                {availableDays.map(d => {
                  const on = included[d.index] ?? false;
                  const isEmpty = d.exerciseCount === 0;
                  return (
                    <label
                      key={d.index}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 18px 1fr auto',
                        alignItems: 'center', gap: 8,
                        padding: '4px 6px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: isEmpty ? 'not-allowed' : 'pointer',
                        opacity: isEmpty ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={isEmpty}
                        onChange={e => setIncluded(prev => ({ ...prev, [d.index]: e.target.checked }))}
                        style={{ cursor: isEmpty ? 'not-allowed' : 'pointer' }}
                      />
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                        {d.index}
                      </span>
                      <input
                        type="text"
                        value={dayLabels[d.index] ?? ''}
                        onChange={e => setDayLabels(prev => ({ ...prev, [d.index]: e.target.value }))}
                        disabled={!on}
                        placeholder={d.label}
                        style={{
                          fontSize: 12,
                          padding: '2px 6px',
                          background: 'var(--color-bg-primary)',
                          border: '0.5px solid var(--color-border-tertiary)',
                          borderRadius: 'var(--radius-sm)',
                          outline: 'none',
                          color: on ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                        }}
                      />
                      <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                        {d.exerciseCount}×
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}

          {hasKgPrescriptions && (
            <label
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 10px',
                border: '0.5px solid var(--color-border-tertiary)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: convertToPercentages ? 'var(--color-accent-muted)' : 'transparent',
                transition: 'background var(--transition-fast)',
              }}
            >
              <input
                type="checkbox"
                checked={convertToPercentages}
                onChange={e => setConvertToPercentages(e.target.checked)}
                style={{ marginTop: 2, cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  Convert kg to percentages before saving
                </span>
                <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                  Opens the conversion dialog so you can pick the PR for each kg prescription.
                  The original plan stays untouched — only the template is converted.
                </span>
              </div>
            </label>
          )}

          {error && (
            <div style={{ fontSize: 11, color: 'var(--color-danger-text)', background: 'var(--color-danger-bg)', border: '0.5px solid var(--color-danger-border)', padding: 8, borderRadius: 'var(--radius-sm)' }}>
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 16px',
            borderTop: '0.5px solid var(--color-border-secondary)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <button
            onClick={() => { if (!saving) onClose(); }}
            disabled={saving}
            style={{
              fontSize: 11, padding: '6px 12px',
              background: 'transparent', color: 'var(--color-text-secondary)',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              fontSize: 11, padding: '6px 14px',
              background: 'var(--color-accent)', color: 'var(--color-text-on-accent)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              cursor: canSave ? 'pointer' : 'not-allowed',
              opacity: canSave ? 1 : 0.5,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Header({ title, onClose, disabled }: { title: string; onClose: () => void; disabled: boolean }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'var(--color-bg-secondary)',
        borderBottom: '0.5px solid var(--color-border-secondary)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
        {title}
      </span>
      <button
        onClick={onClose}
        disabled={disabled}
        style={{
          padding: 4, border: 'none', background: 'transparent',
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  background: 'var(--color-bg-primary)',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  color: 'var(--color-text-primary)',
};
