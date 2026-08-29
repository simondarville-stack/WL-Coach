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
import { Fragment, useEffect, useRef } from 'react';
import { Loader2, MessageCircle, Paperclip, Send } from 'lucide-react';
import { useThreadChat, type UseThreadChatArgs } from '../../hooks/useThreadChat';
import { AutoGrowTextarea } from '../ui';
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
  const firstUnreadRef = useRef<HTMLDivElement | null>(null);
  const { messages, coachNames, loading, sending, error, draft, setDraft, send, firstUnreadId } = useThreadChat(chat);

  // Open on the first unread message when there is one; otherwise at the
  // bottom, as before. Jumping to the bottom past a block of unread messages is
  // exactly how a reader misses them.
  //
  // The unread jump happens once per boundary: firstUnreadId is frozen for the
  // thread, so without the guard every later send would yank the view back up
  // to the divider instead of following the message just written.
  const unreadScrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (firstUnreadId && unreadScrolledRef.current !== firstUnreadId && firstUnreadRef.current) {
      unreadScrolledRef.current = firstUnreadId;
      firstUnreadRef.current.scrollIntoView({ block: 'center' });
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading, firstUnreadId]);

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
            <Fragment key={m.id}>
              {/* Where the reader left off. Same marker the coach inbox draws,
                  from the same frozen boundary in useThreadChat. */}
              {m.id === firstUnreadId && (
                <div ref={firstUnreadRef} className="flex items-center gap-2 py-0.5">
                  <span className="flex-1 h-px bg-blue-500/40" />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-blue-400">
                    New
                  </span>
                  <span className="flex-1 h-px bg-blue-500/40" />
                </div>
              )}
              <MessageBubble
                message={m}
                isOwn={m.sender_type === chat.role}
                senderLabel={senderLabelFor(m, coachNames)}
              />
            </Fragment>
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
        {/* Grows with the message instead of scrolling inside two lines — a
            paragraph typed on a phone was previously invisible above the last
            line, which made it impossible to proof-read or tap back into.
            Capped so a long message can't push the Send button off-screen. */}
        <AutoGrowTextarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          style={{ maxHeight: '9rem' }}
          placeholder={placeholder}
          className="flex-1 rounded-md bg-gray-900 border border-gray-800 text-white text-[13px] leading-snug px-3 py-2 outline-none focus:border-gray-700"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="self-end h-9 px-3 inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
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
        className={`max-w-[78%] px-3 py-2 rounded-lg text-[length:var(--text-label)] leading-snug whitespace-pre-wrap break-words ${
          isOwn ? 'bg-[var(--color-accent)] text-white' : 'bg-gray-800 text-gray-100 border border-gray-700'
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
