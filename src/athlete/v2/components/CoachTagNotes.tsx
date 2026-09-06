/**
 * CoachTagNotes — the coach's comments about ONE exercise, under its card.
 *
 * A coach reviewing the session tags a comment to a row (`#Snatch keep the
 * bar closer`). The full thread still shows it under "Session messages" at
 * the bottom of the day; this puts the same comment where the athlete is
 * looking — right beneath the exercise it names — so the note is read
 * against the sets it is about, not scrolled past.
 *
 * Read-only: replies go through the session thread, as before.
 */
import { MessageSquare } from 'lucide-react';
import type { TrainingLogMessage } from '../../../lib/database.types';
import { formatTimestamp } from '../../../lib/logFormatUtils';
import { isTaggedToExercise, messageTags } from '../../../lib/messageTags';
import { MessageText } from '../../../components/chat/MessageText';

export function CoachTagNotes({
  messages,
  logExerciseId,
}: {
  /** The day's session messages (any sender; filtered here). */
  messages: TrainingLogMessage[];
  /** The logged row this card shows; null when nothing is logged yet. */
  logExerciseId: string | null;
}) {
  if (!logExerciseId) return null;
  const notes = messages.filter(
    m => m.sender_type === 'coach' && isTaggedToExercise(m, logExerciseId),
  );
  if (notes.length === 0) return null;
  return (
    <div className="mx-2 -mt-1 rounded-b-xl border border-t-0 border-blue-900/50 bg-blue-950/30 px-3 pt-2 pb-2 space-y-1.5">
      {notes.map(m => (
        <div key={m.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
          <MessageSquare size={11} className="mt-0.5 shrink-0 text-[color:var(--color-accent)]" />
          <div className="min-w-0 flex-1 text-[color:var(--color-text-primary)] whitespace-pre-wrap break-words">
            <span className="text-[color:var(--color-text-secondary)]">
              Coach · {formatTimestamp(m.created_at)}
            </span>
            <br />
            <MessageText text={m.message} tags={messageTags(m)} variant="dark" />
          </div>
        </div>
      ))}
    </div>
  );
}
