/**
 * GppBlockEditor — the sheet the coach uses to fill in a GPP / circuit
 * section: title, optional description, and rows of
 * (Exercise, Reps, Sets, Load).
 *
 * **Autosaves.** It used to be the only editing surface in the coach app with
 * a Save button — prescriptions save on every cell interaction, notes on a
 * debounce, templates on a 350 ms debounce, and the athlete's own GPP card
 * persists every keystroke. Now this one does too: text edits debounce,
 * structural edits (add / remove row, tick done) commit immediately, and
 * closing flushes whatever is still pending. There is no Cancel, for the same
 * reason there isn't one on a prescription — nothing is held back to discard.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useSaveQueue } from '../../hooks/useSaveQueue';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
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

/** Text edits coalesce over this window; structural edits bypass it. */
const DEBOUNCE_MS = 350;

/**
 * The payload shape that actually gets persisted.
 *
 * The Exercise cell is the canonical "is this a real row?" signal — everything
 * else is metadata — so rows without a name are dropped. With the auto-grow
 * flow there is always a trailing blank row the coach hasn't filled, plus
 * possibly skipped rows in the middle. The trash button still removes filled
 * rows deliberately.
 */
function cleanSection(section: GppSection, includeDone: boolean): GppSection {
  return {
    title: (section.title ?? '').trim() || 'GPP',
    description: (section.description ?? '').trim(),
    rows: (section.rows ?? [])
      .map(r => ({
        exercise: (r.exercise ?? '').trim(),
        reps: (r.reps ?? '').trim(),
        sets: Math.max(1, Math.round(r.sets || 1)),
        load: (r.load ?? '').trim(),
        // Round-trip the done flag when the editor is in log-fix mode so a
        // coach un-ticking a row doesn't get clobbered on save.
        ...(includeDone ? { done: !!r.done } : {}),
      }))
      .filter(r => r.exercise.length > 0),
  };
}

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
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { enqueue, flush, status, error } = useSaveQueue<GppSection>(onSave, describeError);

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

  // Seed only on a closed → open transition. Re-seeding whenever `initial`
  // changes identity would, under autosave, stomp characters the coach is
  // still typing every time the parent refetches — the same trap GppLogCard
  // documents on the athlete side.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) setSection(initial ?? DEFAULT_SECTION);
    wasOpenRef.current = open;
  }, [open, initial]);

  const commit = useCallback((next: GppSection, immediate: boolean) => {
    setSection(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (immediate) {
      enqueue(cleanSection(next, showDoneColumn));
      return;
    }
    debounceRef.current = setTimeout(() => {
      enqueue(cleanSection(sectionRef.current, showDoneColumn));
    }, DEBOUNCE_MS);
  }, [enqueue, showDoneColumn]);

  /** Flush anything pending, then hand control back to the parent. */
  const handleClose = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    enqueue(cleanSection(sectionRef.current, showDoneColumn));
    void flush().finally(onClose);
  }, [enqueue, flush, onClose, showDoneColumn]);

  const backdrop = useBackdropDismiss(handleClose);

  // Escape closes (and therefore flushes), matching the app's other sheets.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  // Last-resort flush: an unmount that isn't routed through handleClose (a
  // navigation, the parent dropping the modal) must not lose the debounced tick.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  if (!open) return null;

  const updateRow = (i: number, patch: Partial<GppRow>) => {
    const nextRows = section.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    // Auto-grow: if the last row just got an Exercise name, append a
    // blank row so the coach can keep typing without reaching for
    // "+ Add row". Empty trailing rows are dropped on save.
    const isLast = i === section.rows.length - 1;
    const gainedName =
      !section.rows[i].exercise.trim() &&
      typeof patch.exercise === 'string' &&
      patch.exercise.trim().length > 0;
    if (isLast && gainedName) nextRows.push({ ...EMPTY_ROW });
    // Ticking done is a structural act, not typing — commit it at once.
    commit({ ...section, rows: nextRows }, 'done' in patch);
  };
  const addRow = () => commit({ ...section, rows: [...section.rows, { ...EMPTY_ROW }] }, true);
  const removeRow = (i: number) =>
    commit({ ...section, rows: section.rows.filter((_, idx) => idx !== i) }, true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      {...backdrop}
    >
      <div className="w-full max-w-xl bg-white rounded-lg shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">{titleProp ?? 'GPP block'}</h2>
          <button
            onClick={handleClose}
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
              onChange={e => commit({ ...section, title: e.target.value }, false)}
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
              onChange={e => commit({ ...section, description: e.target.value }, false)}
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
                  <SetsInput
                    value={row.sets}
                    onCommit={next => updateRow(i, { sets: next })}
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

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200">
          {/* No Cancel: nothing is held back to discard — every edit is already
              written, exactly like a prescription or a note. */}
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            {status === 'saving' && (<><Loader2 size={11} className="animate-spin" /> Saving…</>)}
            {status === 'saved' && (<><Check size={11} className="text-emerald-600" /> Saved</>)}
            {status === 'error' && <span className="text-red-600">Not saved</span>}
          </span>
          <button
            onClick={handleClose}
            className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SetsInput — sets cell with a draft buffer.
 *
 * A bare controlled number input snaps back to 1 the moment the coach clears
 * the box to retype it. That was merely irritating while the editor had a Save
 * button; under autosave it would also *persist* the 1. So the box keeps its
 * own text while focused and only commits a value on blur / Enter.
 */
function SetsInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Math.max(1, Math.round(parseInt(draft, 10) || 1));
    setDraft(null);
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? (value || '')}
      onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      placeholder="3"
      aria-label="Sets"
      className="border border-gray-300 rounded px-2 py-1 text-[12px] tabular-nums"
    />
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
