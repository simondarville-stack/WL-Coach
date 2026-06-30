/**
 * GppLogCard — athlete-side editable GPP block.
 *
 * Two modes:
 *  - Coach-seeded (default): shows the coach's planned section (title +
 *    description) and a table of rows. Each row is editable (reps / sets /
 *    load) with a done checkbox. Athlete edits are stored on
 *    training_log_exercises.metadata.gpp; the coach's planned section stays
 *    untouched as the fallback / "what was prescribed".
 *  - Authored (`authored`): the athlete built this block themselves off-plan,
 *    so there is no planned section. The title is editable and the athlete can
 *    add / delete rows. State still lives in metadata.gpp via the same onSave.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type {
  TrainingLogExercise,
  GppSection,
  GppRow,
} from '../../../lib/database.types';
import { useAutoCommit } from '../lib/useAutoCommit';

interface GppLogCardProps {
  /** Planned section the coach wrote, or null if blank / athlete-authored. */
  planned: GppSection | null;
  /** Athlete's log row, used to read existing edits via metadata.gpp. */
  loggedExercise: TrainingLogExercise | null;
  /** Persists the athlete-side GPP state. */
  onSave: (section: GppSection) => Promise<void>;
  /** Persists athlete-written notes on this exercise. */
  onUpdateNotes: (notes: string) => Promise<void>;
  /** Athlete-authored (off-plan) block: enables title editing + add/remove
   *  rows and shows an authoring-friendly empty state. */
  authored?: boolean;
  /** Remove the whole block (off-plan only). Parent shows a confirm modal. */
  onDelete?: () => void;
}

/** Merge planned rows with athlete-edited rows by position. Athlete
 *  fields override planned; `done` is athlete-only. */
function mergeRows(planned: GppRow[], athlete: GppRow[] | undefined): GppRow[] {
  if (!athlete || athlete.length === 0) return planned.map(r => ({ ...r, done: false }));
  // We trust the athlete copy if it exists — it'll have been seeded
  // from planned on first edit. Tail rows that only exist in planned
  // get appended so a coach who added rows after the athlete first
  // viewed still surfaces.
  if (athlete.length >= planned.length) return athlete;
  return [...athlete, ...planned.slice(athlete.length).map(r => ({ ...r, done: false }))];
}

export function GppLogCard({
  planned,
  loggedExercise,
  onSave,
  onUpdateNotes,
  authored = false,
  onDelete,
}: GppLogCardProps) {
  const athleteSection = loggedExercise?.metadata?.gpp;
  const initialRows = planned
    ? mergeRows(planned.rows, athleteSection?.rows)
    : athleteSection?.rows ?? [];

  const [rows, setRows] = useState<GppRow[]>(initialRows);
  const [notes, setNotes] = useState(loggedExercise?.performed_notes ?? '');
  // Authored blocks own their title/description (no planned section to read).
  const [authoredTitle, setAuthoredTitle] = useState(athleteSection?.title ?? '');
  const [authoredDescription, setAuthoredDescription] = useState(athleteSection?.description ?? '');

  useEffect(() => {
    setNotes(loggedExercise?.performed_notes ?? '');
  }, [loggedExercise?.performed_notes]);

  // Persist notes on blur AND on debounce / app-background / unmount (mobile
  // lock doesn't fire blur). GPP rows already persist immediately via the
  // save queue; this only covers the free-text note. Self-guards.
  const commitNotes = () => {
    if ((loggedExercise?.performed_notes ?? '') !== notes) void onUpdateNotes(notes);
  };
  useAutoCommit(notes, commitNotes);

  // Re-seed when the planned rows content changes — e.g. coach added,
  // removed, or reordered a row from the planner. A stable JSON hash
  // detects structural changes regardless of row count, so a reorder
  // without a count change is correctly caught. We deliberately do NOT
  // re-sync from athleteSection on every save round-trip: doing so
  // would stomp characters the athlete was still typing. Authored blocks
  // have no planned section, so this never runs for them.
  const plannedRowsHash = JSON.stringify(planned?.rows ?? null);
  useEffect(() => {
    if (!planned) return;
    setRows(prev => mergeRows(planned.rows, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedRowsHash]);

  const title = authored ? authoredTitle : planned?.title || 'GPP';
  const description = authored ? authoredDescription : planned?.description || '';

  /**
   * Serial save queue. Every edit (typing, ticking done) calls
   * enqueueSave with the current row state. While a save is in flight,
   * further edits just overwrite the pending payload so multiple
   * rapid keystrokes coalesce into one round-trip with the latest
   * state. Eliminates the race where parallel ensureLogExercise calls
   * would each try to insert a fresh training_log_exercise row,
   * landing duplicates and then erroring on subsequent .single() reads.
   */
  const pendingRef = useRef<GppSection | null>(null);
  const processingRef = useRef(false);

  const drainQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        try {
          await onSave(next);
        } catch (err) {
          // Bail out of the loop on error; the parent's runSave already
          // surfaces the message and reloads the day. The next user
          // change will retry.
          // eslint-disable-next-line no-console
          console.error('[GppLogCard] save failed', err);
          break;
        }
      }
    } finally {
      processingRef.current = false;
    }
  };

  const enqueueSave = (nextRows: GppRow[], currentTitle: string, currentDescription: string) => {
    pendingRef.current = { title: currentTitle, description: currentDescription, rows: nextRows };
    void drainQueue();
  };

  const updateRow = (i: number, patch: Partial<GppRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    enqueueSave(next, title, description);
  };

  const addRow = () => {
    const next: GppRow[] = [...rows, { exercise: '', reps: '', sets: 1, load: '', done: false }];
    setRows(next);
    enqueueSave(next, title, description);
  };

  const deleteRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    setRows(next);
    enqueueSave(next, title, description);
  };

  const changeTitle = (next: string) => {
    setAuthoredTitle(next);
    enqueueSave(rows, next, description);
  };

  const changeDescription = (next: string) => {
    setAuthoredDescription(next);
    enqueueSave(rows, title, next);
  };

  const allDone = rows.length > 0 && rows.every(r => r.done);

  return (
    <div className={`rounded-xl bg-gray-900 border ${allDone ? 'border-emerald-700/50' : 'border-gray-800'} overflow-hidden`}>
      <div className="flex items-start gap-2 px-3 py-3">
        <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-emerald-500" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {authored ? (
              <input
                value={authoredTitle}
                onChange={e => changeTitle(e.target.value)}
                placeholder="Block name (e.g. Core circuit)"
                className="text-sm font-bold text-white bg-transparent border-b border-gray-700 focus:border-emerald-500 focus:outline-none min-w-0 flex-1 placeholder-gray-600 pb-0.5"
              />
            ) : (
              <h3 className="text-sm font-bold text-white break-words min-w-0">{title}</h3>
            )}
            <span className="text-[9px] bg-emerald-900/50 text-emerald-200 font-medium px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">
              GPP
            </span>
            {authored && (
              <span className="text-[9px] bg-amber-900/40 text-amber-300 font-medium px-1.5 py-0.5 rounded flex-shrink-0">
                Added by you
              </span>
            )}
            {allDone && <Check size={14} className="text-emerald-400 flex-shrink-0" />}
          </div>
          {!authored && description && (
            <p className="text-[11px] text-gray-300 italic mt-0.5 whitespace-pre-wrap leading-snug">
              {description}
            </p>
          )}
        </div>
        {authored && onDelete && (
          <button
            onClick={() => void onDelete()}
            className="p-1 text-gray-500 hover:text-red-400 flex-shrink-0"
            title="Remove this block"
            aria-label="Remove GPP block"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="px-3 pb-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-[11px] text-gray-500 italic text-center py-3">
            {authored
              ? 'No exercises yet — add your first row below.'
              : "No rows yet — your coach hasn't filled this in."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-gray-500">
                  <th className="text-center px-1 py-1 w-8">Done</th>
                  <th className="text-left px-1 py-1">Exercise</th>
                  <th className="text-center px-1 py-1 w-12">Reps</th>
                  <th className="text-center px-1 py-1 w-10">Sets</th>
                  <th className="text-center px-1 py-1 w-14">Load</th>
                  {authored && <th className="px-1 py-1 w-8" aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-t border-gray-800 ${row.done ? 'bg-emerald-950/30' : ''}`}>
                    <td className="px-1 py-1 text-center">
                      <button
                        onClick={() => updateRow(i, { done: !row.done })}
                        className={`w-9 h-9 rounded-md flex items-center justify-center border transition-colors ${
                          row.done
                            ? 'bg-emerald-500 border-emerald-400 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-500 hover:bg-gray-700 hover:text-emerald-300'
                        }`}
                        title={row.done ? 'Mark not done' : 'Mark done'}
                        aria-pressed={row.done}
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>
                    </td>
                    <td className="px-1 py-1 align-top">
                      <AutoGrowExerciseInput
                        value={row.exercise}
                        onChange={next => updateRow(i, { exercise: next })}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={row.reps}
                        onChange={e => updateRow(i, { reps: e.target.value })}
                        className="w-full bg-gray-800/40 border border-gray-700 rounded px-1 py-1.5 text-gray-100 focus:outline-none focus:bg-gray-800 focus:border-gray-500 text-center tabular-nums text-[12px]"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <SetsInput value={row.sets} onCommit={sets => updateRow(i, { sets })} />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={row.load}
                        onChange={e => updateRow(i, { load: e.target.value })}
                        placeholder="—"
                        className="w-full bg-gray-800/40 border border-gray-700 rounded px-1 py-1.5 text-gray-100 placeholder-gray-600 focus:outline-none focus:bg-gray-800 focus:border-gray-500 text-center text-[12px]"
                      />
                    </td>
                    {authored && (
                      <td className="px-1 py-1 text-center">
                        <button
                          onClick={() => deleteRow(i)}
                          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-red-400"
                          title="Remove row"
                          aria-label="Remove row"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {authored && (
          <button
            onClick={addRow}
            className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-400 hover:text-white py-1.5 border border-dashed border-gray-700 hover:border-gray-500 rounded"
          >
            <Plus size={12} />
            Add row
          </button>
        )}

        {authored && (
          <input
            value={authoredDescription}
            onChange={e => changeDescription(e.target.value)}
            placeholder="Optional note for this block…"
            className="w-full text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
          />
        )}

        <div className="pt-1">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={commitNotes}
            placeholder="Notes on this exercise…"
            rows={2}
            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Single-line-by-default textarea that grows in height as the athlete
 * types a long exercise name. Native <input> is single-line and just
 * scrolls horizontally — on a narrow phone viewport that hides the
 * end of names like "Single-leg Romanian deadlift with kettlebell".
 *
 * We size to scrollHeight on every value change. resize: none prevents
 * the user from dragging the textarea handle; overflow: hidden keeps
 * the scrollbar out while we're in control of the height.
 */
function AutoGrowExerciseInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Exercise"
      className="w-full bg-transparent text-gray-100 focus:outline-none focus:bg-gray-800 focus:rounded focus:px-1 text-[12px] leading-snug placeholder-gray-600"
      style={{ resize: 'none', overflow: 'hidden' }}
    />
  );
}

/**
 * Numeric "sets" cell that the athlete can freely edit — including clearing
 * the box mid-edit. The committed value lives on GppRow.sets as a number, so
 * the intermediate (possibly empty) text is held in a LOCAL string buffer:
 * the previous implementation bound the input straight to row.sets with a
 * `parseInt(...) || 1` fallback, which snapped an emptied field back to "1"
 * on every keystroke and made it impossible to retype the count.
 *
 * Persistence cadence matches the sibling reps/load fields: each VALID
 * keystroke (a whole number >= 1) commits immediately via the same save
 * queue, so a value isn't lost if the card unmounts before blur. An empty or
 * invalid intermediate state is held only in the local buffer and never
 * persisted; on blur, an empty/invalid box snaps back to the last committed
 * value (sets must be >= 1).
 */
function SetsInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (sets: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // Re-sync only when the committed value changes from outside (e.g. a coach
  // re-seed via mergeRows). The parsed-draft guard avoids stomping a value the
  // athlete is mid-editing when our own onCommit round-trips back as `value`.
  useEffect(() => {
    if (parseInt(draft, 10) !== value) setDraft(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (raw: string) => {
    setDraft(raw);
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed !== value) onCommit(parsed);
  };

  const handleBlur = () => {
    const parsed = parseInt(draft, 10);
    // Empty / invalid on blur → restore the last committed value rather than
    // leaving a blank box.
    if (!(Number.isFinite(parsed) && parsed >= 1)) setDraft(String(value));
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      value={draft}
      onChange={e => handleChange(e.target.value)}
      onBlur={handleBlur}
      className="w-full bg-gray-800/40 border border-gray-700 rounded px-1 py-1.5 text-gray-100 focus:outline-none focus:bg-gray-800 focus:border-gray-500 text-center tabular-nums text-[12px]"
    />
  );
}
