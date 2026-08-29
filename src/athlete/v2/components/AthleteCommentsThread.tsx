/**
 * AthleteCommentsThread — dark-themed message thread for the athlete.
 *
 * Mirrors the coach's LogCommentsThread but uses the athlete app's
 * dark surface. The athlete sees coach replies and their own posts.
 */
import { useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import type { TrainingLogMessage } from '../../../lib/database.types';
import { AutoGrowTextarea } from '../../../components/ui';
import { formatTimestamp } from '../../../lib/logFormatUtils';

interface AthleteCommentsThreadProps {
  messages: TrainingLogMessage[];
  onPost: (body: string) => Promise<void>;
  /** Compact mode for inline use (e.g., per-exercise thread). */
  compact?: boolean;
}

const SENDER_CLASS: Record<string, string> = {
  athlete: 'bg-[var(--color-bg-secondary)] text-[color:var(--color-text-primary)]',
  coach: 'bg-blue-900/60 text-[color:var(--color-accent)]',
};

const SENDER_LABEL: Record<string, string> = {
  athlete: 'You',
  coach: 'Coach',
};

export function AthleteCommentsThread({ messages, onPost, compact }: AthleteCommentsThreadProps) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const body = draft.trim();
    if (body === '' || posting) return;
    setPosting(true);
    setError(null);
    try {
      await onPost(body);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  const textSize = compact ? 'text-[11px]' : 'text-xs';

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {messages.length === 0 ? (
        <p className={`${textSize} text-[color:var(--color-text-secondary)] italic flex items-center gap-1.5`}>
          <MessageSquare size={11} /> No messages yet.
        </p>
      ) : (
        <ul className={compact ? 'space-y-1' : 'space-y-1.5'}>
          {messages.map(m => (
            <li key={m.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-[length:var(--text-micro)] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                    SENDER_CLASS[m.sender_type] ?? SENDER_CLASS.athlete
                  }`}
                >
                  {SENDER_LABEL[m.sender_type] ?? m.sender_type}
                </span>
                <span className="text-[length:var(--text-micro)] text-[color:var(--color-text-secondary)]">{formatTimestamp(m.created_at)}</span>
              </div>
              <p className={`${textSize} text-[color:var(--color-text-primary)] whitespace-pre-wrap leading-snug`}>
                {m.message}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-1.5">
        <AutoGrowTextarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (
              (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ||
              (e.key === 'Enter' && !e.shiftKey && compact)
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Message your coach…"
          rows={compact ? 1 : 2}
          style={{ maxHeight: '9rem' }}
          className={`flex-1 ${textSize} bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded px-2 py-1 text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)]`}
          disabled={posting}
        />
        <button
          onClick={submit}
          disabled={posting || draft.trim() === ''}
          className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:cursor-not-allowed"
          title="Send"
        >
          <Send size={12} />
        </button>
      </div>
      {error && <p className="text-[length:var(--text-caption)] text-red-300 break-all">{error}</p>}
    </div>
  );
}
