/**
 * OffPlanNoteCard — athlete-authored free-text note line (TEXT sentinel).
 *
 * The coach's equivalent reads its body from planned_exercises.notes; an
 * off-plan note has no planned row, so the body lives on the log row's
 * metadata.text and is persisted via setLogExerciseText. Auto-commits on
 * blur / debounce / app-background like the other free-text fields so a note
 * typed right before the phone locks isn't lost.
 */
import { useEffect, useState } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import type { TrainingLogExercise } from '../../../lib/database.types';
import { useAutoCommit } from '../lib/useAutoCommit';

interface OffPlanNoteCardProps {
  logExercise: TrainingLogExercise;
  /** Persists the note body into training_log_exercises.metadata.text. */
  onUpdateText: (text: string) => Promise<void>;
  /** Remove the whole note. Parent shows a confirm modal. */
  onDelete?: () => void;
}

export function OffPlanNoteCard({ logExercise, onUpdateText, onDelete }: OffPlanNoteCardProps) {
  const initial = logExercise.metadata?.text ?? '';
  const [text, setText] = useState(initial);
  useEffect(() => {
    setText(logExercise.metadata?.text ?? '');
  }, [logExercise.metadata?.text]);

  const commit = () => {
    if ((logExercise.metadata?.text ?? '') !== text) void onUpdateText(text);
  };
  useAutoCommit(text, commit);

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5 bg-gray-500" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StickyNote size={13} className="text-gray-400 flex-shrink-0" />
            <span className="text-[9px] bg-amber-900/40 text-amber-300 font-medium px-1.5 py-0.5 rounded">
              Added by you
            </span>
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            placeholder="Write a note…"
            rows={2}
            className="w-full mt-2 text-sm bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none italic"
          />
        </div>
        {onDelete && (
          <button
            onClick={() => void onDelete()}
            className="p-1 text-gray-500 hover:text-red-400 flex-shrink-0"
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
