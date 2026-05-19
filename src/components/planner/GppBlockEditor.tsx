/**
 * GppBlockEditor — modal the coach uses to fill in a GPP / circuit
 * section: title, optional description, and rows of
 * (Exercise, Reps, Sets, Load).
 *
 * Local state holds the in-flight edits; "Save" commits via the
 * onSave callback (which the parent wires to useWeekPlans.saveGppSection).
 * "Cancel" discards. Reads default-empty rows when no GPP payload
 * exists yet on the planned_exercise.
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { GppRow, GppSection } from '../../lib/database.types';

/** Supabase errors are plain objects (not Error). Pull the useful
 *  fields out so the modal shows the real reason — most often a missing
 *  column or RLS denial. Also logs the raw object for bug reports. */
function describeError(e: unknown): string {
  // eslint-disable-next-line no-console
  console.error('[GppBlockEditor]', e);
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === 'string') parts.push(obj.message);
    if (typeof obj.details === 'string') parts.push(obj.details);
    if (typeof obj.hint === 'string') parts.push(`hint: ${obj.hint}`);
    if (typeof obj.code === 'string') parts.push(`code ${obj.code}`);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(obj); } catch { /* noop */ }
  }
  return String(e);
}

interface GppBlockEditorProps {
  open: boolean;
  initial: GppSection | null;
  onClose: () => void;
  onSave: (section: GppSection) => Promise<void>;
}

const EMPTY_ROW: GppRow = { exercise: '', reps: '', sets: 1, load: '' };

const DEFAULT_SECTION: GppSection = {
  title: 'GPP',
  description: '',
  rows: [
    { ...EMPTY_ROW },
    { ...EMPTY_ROW },
    { ...EMPTY_ROW },
  ],
};

export function GppBlockEditor({ open, initial, onClose, onSave }: GppBlockEditorProps) {
  const [section, setSection] = useState<GppSection>(initial ?? DEFAULT_SECTION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSection(initial ?? DEFAULT_SECTION);
      setError(null);
    }
  }, [open, initial]);

  if (!open) return null;

  const updateRow = (i: number, patch: Partial<GppRow>) => {
    setSection(s => ({
      ...s,
      rows: s.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  };
  const addRow = () => setSection(s => ({ ...s, rows: [...s.rows, { ...EMPTY_ROW }] }));
  const removeRow = (i: number) =>
    setSection(s => ({ ...s, rows: s.rows.filter((_, idx) => idx !== i) }));

  const save = async () => {
    // eslint-disable-next-line no-console
    console.log('[GppBlockEditor] save() called, section =', section);
    // Strip rows where exercise name is blank — that's the noise from
    // empty default slots. Keeps the print/log view tidy.
    const cleaned: GppSection = {
      title: (section.title ?? '').trim() || 'GPP',
      description: (section.description ?? '').trim(),
      rows: (section.rows ?? [])
        .map(r => ({
          exercise: (r.exercise ?? '').trim(),
          reps: (r.reps ?? '').trim(),
          sets: Math.max(1, Math.round(r.sets || 1)),
          load: (r.load ?? '').trim(),
        }))
        .filter(r => r.exercise.length > 0),
    };
    // eslint-disable-next-line no-console
    console.log('[GppBlockEditor] cleaned payload =', cleaned);
    setSaving(true);
    setError(null);
    try {
      await onSave(cleaned);
      // eslint-disable-next-line no-console
      console.log('[GppBlockEditor] onSave resolved, closing');
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-lg shadow-xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">GPP block</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
              Title
            </label>
            <input
              value={section.title}
              onChange={e => setSection(s => ({ ...s, title: e.target.value }))}
              placeholder="Conditioning, Mobility, Warm-up…"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
              Description
            </label>
            <textarea
              value={section.description}
              onChange={e => setSection(s => ({ ...s, description: e.target.value }))}
              placeholder="e.g. 3 rounds for time, EMOM 10 min, …"
              rows={2}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">
                Rows
              </span>
              <button
                onClick={addRow}
                className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 hover:text-blue-700"
              >
                <Plus size={11} />
                Add row
              </button>
            </div>
            <div className="grid grid-cols-[1fr_64px_48px_72px_24px] gap-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold px-1 mb-1">
              <span>Exercise</span>
              <span>Reps</span>
              <span>Sets</span>
              <span>Load</span>
              <span />
            </div>
            <div className="space-y-1">
              {section.rows.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_64px_48px_72px_24px] gap-1 items-center"
                >
                  <input
                    value={row.exercise}
                    onChange={e => updateRow(i, { exercise: e.target.value })}
                    placeholder="Box jumps"
                    className="border border-gray-300 rounded px-2 py-1 text-[12px]"
                  />
                  <input
                    value={row.reps}
                    onChange={e => updateRow(i, { reps: e.target.value })}
                    placeholder="10"
                    className="border border-gray-300 rounded px-2 py-1 text-[12px] tabular-nums"
                  />
                  <input
                    type="number"
                    min={1}
                    value={row.sets || ''}
                    onChange={e => updateRow(i, { sets: parseInt(e.target.value, 10) || 1 })}
                    placeholder="3"
                    className="border border-gray-300 rounded px-2 py-1 text-[12px] tabular-nums"
                  />
                  <input
                    value={row.load}
                    onChange={e => updateRow(i, { load: e.target.value })}
                    placeholder="—"
                    className="border border-gray-300 rounded px-2 py-1 text-[12px]"
                  />
                  <button
                    onClick={() => removeRow(i)}
                    className="text-gray-400 hover:text-red-600 p-1"
                    aria-label="Remove row"
                    title="Remove row"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="px-2 py-1 bg-red-50 border border-red-200 rounded text-red-700 text-[11px]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="text-sm text-gray-700 hover:text-gray-900 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-300 text-white font-semibold px-3 py-1.5 rounded"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
