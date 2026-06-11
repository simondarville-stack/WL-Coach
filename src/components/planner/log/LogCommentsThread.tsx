/**
 * LogCommentsThread — message thread for one session-or-exercise scope.
 *
 * Renders existing messages chronologically and a compact composer for
 * the coach. The component is presentational: posting and refresh are
 * orchestrated by the parent (LogModeView) so optimistic updates and
 * error handling stay in one place.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import type { TrainingLogMessage } from '../../../lib/database.types';
import { formatTimestamp } from '../../../lib/logFormatUtils';
import { Button } from '../../ui';

interface LogCommentsThreadProps {
  messages: TrainingLogMessage[];
  /** Compact mode: smaller text and tighter spacing for inline exercise threads. */
  compact?: boolean;
  /** Called when the coach hits Send. Parent persists + refreshes. */
  onPost: (body: string) => Promise<void>;
}

const SENDER_LABEL: Record<string, string> = {
  athlete: 'Athlete',
  coach: 'Coach',
};

const SENDER_CLASS: Record<string, string> = {
  athlete: 'bg-gray-100 text-gray-700',
  coach: 'bg-blue-50 text-blue-800',
};

export function LogCommentsThread({ messages, compact, onPost }: LogCommentsThreadProps) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    const body = draft.trim();
    if (body === '' || posting) return;
    setPosting(true);
    try {
      await onPost(body);
      setDraft('');
    } finally {
      setPosting(false);
    }
  };

  const textSize = compact ? 'text-[11px]' : 'text-xs';

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {messages.length === 0 ? (
        <p className={`${textSize} text-gray-400 italic`}>No comments yet.</p>
      ) : (
        <ul className={compact ? 'space-y-1' : 'space-y-1.5'}>
          {messages.map(m => (
            <li key={m.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                    SENDER_CLASS[m.sender_type] ?? SENDER_CLASS.coach
                  }`}
                >
                  {SENDER_LABEL[m.sender_type] ?? m.sender_type}
                </span>
                <span className="text-[9px] text-gray-400">{formatTimestamp(m.created_at)}</span>
              </div>
              <p
                className={`${textSize} text-gray-800 whitespace-pre-wrap leading-snug`}
              >
                {m.message}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || (e.key === 'Enter' && !e.shiftKey && compact)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Comment as coach…"
          rows={compact ? 1 : 2}
          className={`flex-1 ${textSize} bg-white border rounded px-2 py-1 text-gray-900 placeholder-gray-400 focus:outline-none border-[color:var(--color-border-tertiary)] focus:border-[color:var(--color-accent)] resize-none`}
          disabled={posting}
        />
        <Button
          variant="primary"
          size="sm"
          iconOnly
          icon={<Send size={12} />}
          onClick={submit}
          disabled={posting || draft.trim() === ''}
          className="flex-shrink-0"
          title="Post comment"
          aria-label="Post comment"
        />
      </div>
    </div>
  );
}
