/**
 * OffPlanNoteCard — athlete-authored free-text note line (TEXT sentinel).
 *
 * The coach's equivalent reads its body from planned_exercises.notes; an
 * off-plan note has no planned row, so the body lives on the log row's
 * metadata.text and is persisted via setLogExerciseText. Auto-commits on
 * blur / debounce / app-background like the other free-text fields so a note
 * typed right before the phone locks isn't lost.
 */
import { StickyNote, Trash2 } from 'lucide-react';
import type { TrainingLogExercise } from '../../../lib/database.types';
import { AutoGrowTextarea } from '../../../components/ui';
import { useNoteDraft } from '../lib/useNoteDraft';

interface OffPlanNoteCardProps {
  logExercise: TrainingLogExercise;
  /** Persists the note body into training_log_exercises.metadata.text. */
  onUpdateText: (text: string) => Promise<void>;
  /** Remove the whole note. Parent shows a confirm modal. */
  onDelete?: () => void;
}

export function OffPlanNoteCard({ logExercise, onUpdateText, onDelete }: OffPlanNoteCardProps) {
  const text = useNoteDraft(logExercise.metadata?.text ?? '', onUpdateText);

  return (
    <div className="rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5 bg-gray-500" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StickyNote size={13} className="text-[color:var(--color-text-secondary)] flex-shrink-0" />
            <span className="text-[length:var(--text-micro)] bg-amber-900/40 text-amber-300 font-medium px-1.5 py-0.5 rounded">
              Added by you
            </span>
          </div>
          <AutoGrowTextarea
            {...text.bind}
            placeholder="Write a note…"
            rows={2}
            className="w-full mt-2 text-sm bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-2 py-1.5 text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)] italic"
          />
        </div>
        {onDelete && (
          <button
            onClick={() => void onDelete()}
            className="tap p-1 text-[color:var(--color-text-secondary)] hover:text-red-400 flex-shrink-0"
            title="Remove this note"
            aria-label="Remove note"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
