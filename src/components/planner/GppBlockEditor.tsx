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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Exercise, GppRow, GppSection } from '../../lib/database.types';

/** Supabase errors are plain objects (not Error). Pull the useful
 *  fields out so the modal shows the real reason — most often a missing
 *  column or RLS denial. Also logs the raw object for bug reports. */
function describeError(e: unknown): string {
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
  /** Exercises the coach has in their library. Used to surface
   *  typeahead suggestions while typing in the Exercise cell. Free
   *  text is always accepted; suggestions are a shortcut, not a gate. */
  exerciseCatalogue?: Exercise[];
  /** When true, render a leading "Done" checkbox column so the coach
   *  can tick / untick rows. Used from the coach Log view to fix
   *  missed check-offs without leaving the keyboard. Defaults to false
   *  (planner usage — done flags aren't meaningful while prescribing). */
  showDoneColumn?: boolean;
  /** Modal heading override; defaults to "GPP block". */
  title?: string;
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

export function GppBlockEditor({
  open,
  initial,
  exerciseCatalogue = [],
  showDoneColumn = false,
  title: titleProp,
  onClose,
  onSave,
}: GppBlockEditorProps) {
  const [section, setSection] = useState<GppSection>(initial ?? DEFAULT_SECTION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Filter the catalogue down to '— System' free exercises, sorted
   *  by name so the suggestion list is predictable. Sentinels (TEXT /
   *  IMAGE / VIDEO / GPP) shouldn't appear. */
  const filteredCatalogue = useMemo(
    () =>
      (exerciseCatalogue ?? [])
        .filter(e => e.category !== '— System')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [exerciseCatalogue],
  );

  useEffect(() => {
    if (open) {
      setSection(initial ?? DEFAULT_SECTION);
      setError(null);
    }
  }, [open, initial]);

  if (!open) return null;

  const updateRow = (i: number, patch: Partial<GppRow>) => {
    setSection(s => {
      const nextRows = s.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      // Auto-grow: if the last row just got an Exercise name, append a
      // blank row so the coach can keep typing without reaching for
      // "+ Add row". Empty trailing rows are dropped on save.
      const isLast = i === s.rows.length - 1;
      const gainedName =
        !s.rows[i].exercise.trim() &&
        typeof patch.exercise === 'string' &&
        patch.exercise.trim().length > 0;
      if (isLast && gainedName) {
        nextRows.push({ ...EMPTY_ROW });
      }
      return { ...s, rows: nextRows };
    });
  };
  const addRow = () => setSection(s => ({ ...s, rows: [...s.rows, { ...EMPTY_ROW }] }));
  const removeRow = (i: number) =>
    setSection(s => ({ ...s, rows: s.rows.filter((_, idx) => idx !== i) }));

  const save = async () => {
    // Drop rows that have no Exercise name. With the auto-grow flow we
    // always end up with a trailing blank row the coach hasn't filled,
    // and possibly skipped rows in the middle they didn't want. The
    // Exercise cell is the canonical "is this a real row?" signal —
    // everything else is metadata. Trash button still works for
    // intentionally removing filled rows.
    const cleaned: GppSection = {
      title: (section.title ?? '').trim() || 'GPP',
      description: (section.description ?? '').trim(),
      rows: (section.rows ?? [])
        .map(r => ({
          exercise: (r.exercise ?? '').trim(),
          reps: (r.reps ?? '').trim(),
          sets: Math.max(1, Math.round(r.sets || 1)),
          load: (r.load ?? '').trim(),
          // Round-trip the done flag when the editor is in log-fix mode so
          // a coach un-ticking a row doesn't get clobbered on save.
          ...(showDoneColumn ? { done: !!r.done } : {}),
        }))
        .filter(r => r.exercise.length > 0),
    };
    setSaving(true);
    setError(null);
    try {
      await onSave(cleaned);
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
          <h2 className="text-sm font-bold text-gray-900">{titleProp ?? 'GPP block'}</h2>
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
            <div
              className="grid gap-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold px-1 mb-1"
              style={{
                gridTemplateColumns: showDoneColumn
                  ? '32px 1fr 64px 48px 72px 24px'
                  : '1fr 64px 48px 72px 24px',
              }}
            >
              {showDoneColumn && <span>✓</span>}
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
                  className="grid gap-1 items-center"
                  style={{
                    gridTemplateColumns: showDoneColumn
                      ? '32px 1fr 64px 48px 72px 24px'
                      : '1fr 64px 48px 72px 24px',
                  }}
                >
                  {showDoneColumn && (
                    <input
                      type="checkbox"
                      checked={!!row.done}
                      onChange={e => updateRow(i, { done: e.target.checked })}
                      className="justify-self-center w-4 h-4 accent-emerald-600 cursor-pointer"
                      aria-label="Mark this row done"
                    />
                  )}
                  <ExerciseAutocomplete
                    value={row.exercise}
                    placeholder={`Exercise ${i + 1}`}
                    catalogue={filteredCatalogue}
                    onChange={next => updateRow(i, { exercise: next })}
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

/**
 * ExerciseAutocomplete — text input with a typeahead dropdown that
 * filters the coach's exercise catalogue. Free text is always
 * accepted: the dropdown is a shortcut, not a gate.
 *
 * Behaviour:
 *  - Empty input + focused → suggestions hidden (avoids dumping the
 *    whole catalogue into a tiny grid cell).
 *  - Non-empty input → up to 6 best matches (case-insensitive prefix
 *    first, then includes).
 *  - Click suggestion → fills the cell, dropdown closes.
 *  - Esc / blur → close the dropdown without committing anything new
 *    beyond whatever the user typed.
 */
function ExerciseAutocomplete({
  value,
  placeholder,
  catalogue,
  onChange,
}: {
  value: string;
  placeholder: string;
  catalogue: Exercise[];
  onChange: (next: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [] as Exercise[];
    const starts = catalogue.filter(e => e.name.toLowerCase().startsWith(q));
    const contains = catalogue.filter(
      e => !starts.includes(e) && e.name.toLowerCase().includes(q),
    );
    return [...starts, ...contains].slice(0, 6);
  }, [value, catalogue]);

  // Close the dropdown on outside click. We can't rely on blur alone
  // because clicking the dropdown item itself fires blur first; the
  // mousedown handler on suggestions prevents that.
  useEffect(() => {
    if (!focused) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [focused]);

  const showList = focused && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') setFocused(false);
        }}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded px-2 py-1 text-[12px]"
      />
      {showList && (
        <div className="absolute left-0 right-0 top-full z-10 mt-0.5 bg-white border border-gray-200 rounded shadow-md max-h-44 overflow-y-auto">
          {suggestions.map(s => (
            <button
              key={s.id}
              type="button"
              // mousedown fires before the input's blur — keeps the
              // dropdown alive long enough for the click to register.
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange(s.name);
                setFocused(false);
              }}
              className="w-full text-left px-2 py-1 text-[12px] hover:bg-blue-50 flex items-center gap-1.5"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: s.color || '#94a3b8' }}
                aria-hidden
              />
              <span className="text-gray-800 truncate">{s.name}</span>
              <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">{s.category}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
