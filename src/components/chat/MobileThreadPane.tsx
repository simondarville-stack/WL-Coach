/**
 * MobileThreadPane — the shared message-list + composer for the two mobile
 * chat surfaces (the athlete app's coach thread and the coach field app).
 *
 * These two were near-identical Tailwind: the same scroll container, loading
 * spinner, empty state, bubble, error strip and composer, differing only in a
 * few strings, whose message aligns right, and iOS safe-area padding. They are
 * one thing now. The desktop coach inbox is deliberately NOT here — it is
 * styled with inline CSS-var tokens, a different rendering system.
 *
 * This owns the message list and composer only. Each surface keeps its own
 * chrome: the athlete app wraps this with a header + a session-discussions
 * panel; the field app's parent screen renders those above it. So this returns
 * a fragment, to drop into either surface's flex column.
 *
 * It calls useThreadChat itself — the surface passes the hook config plus the
 * presentation props, and holds no thread state of its own.
 */
import { useEffect, useRef } from 'react';
import { Loader2, MessageCircle, Paperclip, Send } from 'lucide-react';
import { useThreadChat, type UseThreadChatArgs } from '../../hooks/useThreadChat';
import { formatTime24, formatDateTimeShort } from '../../lib/dateUtils';
import type { TrainingLogMessage } from '../../lib/database.types';

export interface MobileThreadPaneProps {
  /** Thread state/logic config — passed straight to useThreadChat. */
  chat: UseThreadChatArgs;
  /** Bubble label for a message (coach name / "You" / athlete name / null).
   *  Role-specific, so each surface supplies its own. */
  senderLabelFor: (m: TrainingLogMessage, coachNames: Map<string, string>) => string | null;
  /** Second line of the empty state ("No messages yet" is the shared first). */
  emptyHint: string;
  /** Composer textarea placeholder. */
  placeholder: string;
  /** Paperclip attach handler; the button is hidden when null. */
  onAttach?: (() => void) | null;
  /** aria-label / title for the attach button. */
  attachLabel?: string;
  /** Add iOS safe-area bottom padding to the composer (field app). */
  safeArea?: boolean;
}

export function MobileThreadPane({
  chat,
  senderLabelFor,
  emptyHint,
  placeholder,
  onAttach = null,
  attachLabel = 'Attach a training unit',
  safeArea = false,
}: MobileThreadPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { messages, coachNames, loading, sending, error, draft, setDraft, send } = useThreadChat(chat);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : messages.length === 0 ? (
          // Suppress the "say hi" invitation when the load itself failed —
          // the error strip below carries the real state. Without this guard
          // a failed load reads as a successful empty thread AND an error.
          error ? null : (
            <div className="px-6 py-12 text-center text-gray-500 flex flex-col items-center gap-3">
              <MessageCircle size={26} className="text-gray-700" />
              <div className="text-sm">No messages yet</div>
              <div className="text-[11px] text-gray-600 max-w-xs">{emptyHint}</div>
            </div>
          )
        ) : (
          messages.map(m => (
            <MessageBubble
              key={m.id}
              message={m}
              isOwn={m.sender_type === chat.role}
              senderLabel={senderLabelFor(m, coachNames)}
            />
          ))
        )}
      </div>

      {/* Error strip below the list, not replacing it — a failed send must not
          blank the conversation. */}
      {error && <p className="text-[11px] text-red-400 px-4 pb-1">{error}</p>}

      <div
        className={`border-t border-gray-800 px-3 py-2.5 flex gap-2 shrink-0${
          safeArea ? ' pb-[max(0.625rem,env(safe-area-inset-bottom))]' : ''
        }`}
      >
        {onAttach && (
          <button
            type="button"
            onClick={onAttach}
            className="self-end h-9 w-9 inline-flex items-center justify-center rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200"
            aria-label={attachLabel}
            title={attachLabel}
          >
            <Paperclip size={14} />
          </button>
        )}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="flex-1 resize-none rounded-md bg-gray-900 border border-gray-800 text-white text-[13px] leading-snug px-3 py-2 outline-none focus:border-gray-700"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="self-end h-9 px-3 inline-flex items-center gap-1 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
      </div>
    </>
  );
}

function MessageBubble({
  message,
  isOwn,
  senderLabel,
}: {
  message: TrainingLogMessage;
  /** True when the viewer sent this message — right-aligned, accent bubble. */
  isOwn: boolean;
  senderLabel: string | null;
}) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] px-3 py-2 rounded-lg text-[12.5px] leading-snug whitespace-pre-wrap break-words ${
          isOwn ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100 border border-gray-700'
        }`}
      >
        {senderLabel && (
          <div className={`text-[10px] font-semibold opacity-90 mb-1${isOwn ? '' : ' text-blue-300'}`}>
            {senderLabel}
          </div>
        )}
        {message.message}
        <div className="text-[9px] mt-1 opacity-60 text-right">{formatStamp(message.created_at)}</div>
      </div>
    </div>
  );
}

/** Same-day: 24h time only; otherwise day-first date + 24h time. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? formatTime24(d) : formatDateTimeShort(d);
}
