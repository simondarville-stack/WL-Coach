/**
 * OffPlanExerciseCard — athlete-added (off-plan) exercise in Today.
 *
 * No prescription to compare against; the athlete adds sets ad hoc.
 * - "+ Add set" appends ONE editable blank row. New rows pre-fill with
 *   the last completed set's load/reps as the placeholder default, so
 *   tapping ✓ on a row left untouched logs "same as last".
 * - Each row gets a per-set delete (Trash) so accidental presses are
 *   reversible.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  TrainingLogSet,
  TrainingLogExercise,
  TrainingLogVideo,
  Exercise,
  ExerciseStub,
} from '../../../lib/database.types';
import type { ClipTag } from '../../../lib/clipTag';
import { LogVideoStrip } from '../../../components/planner/LogVideoStrip';
import { SetEntryRow } from './SetEntryRow';
import { useNoteDraft } from '../lib/useNoteDraft';
import { AutoGrowTextarea } from '../../../components/ui';

interface OffPlanExerciseCardProps {
  logExercise: TrainingLogExercise;
  // Stub is the optimistic shape right after off-plan add — name+color
  // suffice for what this card renders.
  exercise: Exercise | ExerciseStub | null;
  loggedSets: TrainingLogSet[];
  onSaveSet: (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
  /** Remove the entire log_exercise (delete the card). The parent
   *  shows a confirm modal and dispatches the delete from there. */
  onDelete?: () => void;
  /** Remove a single set within this exercise. Same fire-and-forget
   *  pattern as onDelete. */
  onDeleteSet?: (setId: string) => void;
  /** Persists athlete-written notes on this exercise. */
  onUpdateNotes: (notes: string) => Promise<void>;
  /** Clips attached to this exercise. */
  videos?: TrainingLogVideo[];
  onAddVideo?: (file: File, tag: ClipTag) => Promise<void>;
  onRetagVideo?: (video: TrainingLogVideo, tag: ClipTag) => Promise<void>;
  onDeleteVideo?: (video: TrainingLogVideo) => void;
}

export function OffPlanExerciseCard({
  logExercise,
  exercise,
  loggedSets,
  onSaveSet,
  onDelete,
  onDeleteSet,
  onUpdateNotes,
  videos = [],
  onAddVideo,
  onRetagVideo,
  onDeleteVideo,
}: OffPlanExerciseCardProps) {
  // Persists on blur / debounce / app-background / unmount (mobile lock doesn't
  // fire blur), echo-safe so a save can't move the caret mid-sentence.
  const notes = useNoteDraft(logExercise.performed_notes ?? '', onUpdateNotes);
  const sortedSets = loggedSets.slice().sort((a, b) => a.set_number - b.set_number);
  /**
   * Number of empty trailing rows the user has explicitly requested via
   * "Add set". Persisted sets render before these; once a blank row's
   * data is saved, loggedSets gains the row and we decrement the
   * pendingBlanks count so it doesn't double up.
   */
  const [pendingBlanks, setPendingBlanks] = useState(0);
  /**
   * Track previous length so the pending-blank decrement only fires
   * when a set is ADDED (length increases). Without this, deleting a
   * set also decremented pendingBlanks, which made the trailing blank
   * row disappear and confused the athlete.
   */
  const prevSetCountRef = useRef(sortedSets.length);
  useEffect(() => {
    const prev = prevSetCountRef.current;
    const curr = sortedSets.length;
    if (curr > prev) {
      setPendingBlanks(p => Math.max(0, p - (curr - prev)));
    }
    prevSetCountRef.current = curr;
  }, [sortedSets.length]);

  // Athlete-authored combination: members + name + ribbon colour live on
  // the log row's metadata (the log schema has no is_combo column). When
  // present, the card renders the combo identity and lets the reps cells
  // accept tuple notation ("2+1").
  const combo = logExercise.metadata?.combo ?? null;
  const accent = combo?.color ?? exercise?.color ?? '#6b7280';
  const name = combo
    ? combo.name?.trim() ||
      combo.members.map(m => m.name).filter(Boolean).join(' + ') ||
      '(combination)'
    : exercise?.name ?? '(unknown exercise)';

  const lastCompleted = [...sortedSets].reverse().find(s => s.status === 'completed');
  const defaultLoad = lastCompleted?.performed_load ?? null;
  const defaultReps = lastCompleted?.performed_reps ?? null;
  const nextSetNumber =
    sortedSets.length > 0 ? Math.max(...sortedSets.map(s => s.set_number)) + 1 : 1;

  return (
    <div className="rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-3">
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white truncate">{name}</h3>
            <span className="text-[length:var(--text-micro)] bg-amber-900/40 text-amber-300 font-medium px-1.5 py-0.5 rounded">
              Added by you
            </span>
          </div>
          {combo && combo.members.length > 0 ? (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {combo.members.map((m, idx) => (
                <span key={m.exerciseId + idx} className="inline-flex items-center gap-1 text-[length:var(--text-caption)] text-[color:var(--color-text-primary)]">
                  {idx > 0 && <span className="text-[color:var(--color-text-secondary)]">+</span>}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.color ?? '#6b7280' }}
                    aria-hidden
                  />
                  <span>{m.name}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)] mt-0.5">No plan · log what you did</p>
          )}
        </div>
        {onDelete && (
          <button
            onClick={() => void onDelete()}
            className="tap p-1 text-[color:var(--color-text-secondary)] hover:text-red-400 flex-shrink-0"
            title="Remove this exercise"
            aria-label="Remove exercise"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="px-3 pb-3 space-y-1.5">
        {sortedSets.map(s => (
          <SetEntryRow
            key={s.id}
            input={{
              setNumber: s.set_number,
              plannedRepsText: '—',
              plannedLoadText: '—',
              plannedRepsValue: null,
              plannedLoadValue: null,
              comboReps: !!combo,
            }}
            logged={s}
            onSave={onSaveSet}
            onDelete={onDeleteSet ? () => onDeleteSet(s.id) : undefined}
          />
        ))}
        {Array.from({ length: pendingBlanks }).map((_, i) => (
          <SetEntryRow
            key={`blank-${nextSetNumber + i}`}
            input={{
              setNumber: nextSetNumber + i,
              plannedRepsText: defaultReps != null ? String(defaultReps) : '—',
              plannedLoadText: defaultLoad != null ? String(defaultLoad) : '—',
              plannedRepsValue: defaultReps,
              plannedLoadValue: defaultLoad,
              comboReps: !!combo,
            }}
            logged={null}
            onSave={onSaveSet}
            onDelete={() => setPendingBlanks(p => Math.max(0, p - 1))}
          />
        ))}
        <button
          onClick={() => setPendingBlanks(n => n + 1)}
          className="tap-y w-full inline-flex items-center justify-center gap-1 text-[11px] text-[color:var(--color-text-secondary)] hover:text-white py-1.5 border border-dashed border-[color:var(--color-border-secondary)] rounded"
        >
          <Plus size={12} />
          Add set
        </button>

        <LogVideoStrip
          videos={videos}
          theme="dark"
          onAdd={onAddVideo}
          onDelete={onDeleteVideo}
          sets={sortedSets}
          onRetag={onRetagVideo}
        />

        <div className="pt-1">
          <AutoGrowTextarea
            {...notes.bind}
            placeholder="Notes on this exercise…"
            rows={2}
            className="w-full text-xs bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-2 py-1.5 text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)]"
          />
        </div>
      </div>
    </div>
  );
}
