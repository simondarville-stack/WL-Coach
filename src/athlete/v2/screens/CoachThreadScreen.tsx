/**
 * CoachThreadScreen — athlete-facing inbox.
 *
 * Shows a thread list (general thread + one per session that has any
 * messages) and switches to a chat view when a thread is opened.
 * Symmetric with the coach inbox: both sides see the same set of
 * threads with the same shape, so a session comment by the coach
 * surfaces here even if the athlete hasn't opened that session in the
 * log.
 *
 * Session-bound threads have a Jump to session button on the chat
 * header that navigates the athlete to that day on the Today screen,
 * so the message context (which set, which exercise) is one tap away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Loader2, Send, MessageCircle, Calendar } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchAthleteInboxThreads,
  fetchGeneralThreadMessages,
  fetchSessionMessages,
  markGeneralThreadRead,
  markMessagesRead,
  sendGeneralMessage,
  addComment,
  type InboxThread,
} from '../../../lib/trainingLogService';
import { describeError } from '../../../lib/errorMessage';
import type { TrainingLogMessage } from '../../../lib/database.types';

export function CoachThreadScreen() {
  const { athlete } = useAuth();
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const athleteId = athlete?.id ?? null;
  const ownerId = athlete?.owner_id ?? null;

  const loadThreads = useCallback(async () => {
    if (!athleteId) return;
    setError(null);
    try {
      const t = await fetchAthleteInboxThreads(athleteId);
      setThreads(t);
    } catch (e) {
      console.error('[CoachInbox] loadThreads failed', e);
      setError(describeError(e));
    } finally {
      setLoadingThreads(false);
    }
  }, [athleteId]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Refresh on tab focus so a new coach reply lands without manual
  // pull-to-refresh.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) void loadThreads(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [loadThreads]);

  const selectedThread = useMemo(
    () => threads.find(t => threadKeyOf(t) === selectedKey) ?? null,
    [threads, selectedKey],
  );

  if (!athlete) {
    return (
      <div className="px-4 py-6 text-sm text-gray-400">
        Pick an athlete from the profile picker to access the coach thread.
      </div>
    );
  }

  if (selectedThread && athleteId && ownerId) {
    return (
      <ChatView
        thread={selectedThread}
        athleteId={athleteId}
        ownerId={ownerId}
        onBack={() => { setSelectedKey(null); void loadThreads(); }}
        onMessagesChanged={loadThreads}
      />
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      <header className="px-4 pt-4 pb-3 border-b border-gray-800">
        <h1 className="text-base font-semibold text-white">Coach</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">
          General messages plus any comments from your coach on a session.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loadingThreads ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-400 px-4 py-3">{error}</div>
        ) : threads.length === 0 ? (
          <EmptyAthleteInbox />
        ) : (
          threads.map(t => (
            <ThreadRow
              key={threadKeyOf(t)}
              thread={t}
              onClick={() => setSelectedKey(threadKeyOf(t))}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Thread list row ──────────────────────────────────────────────────

function ThreadRow({ thread, onClick }: { thread: InboxThread; onClick: () => void }) {
  const isSession = thread.kind === 'session';
  const dateLabel = isSession && thread.performedOn ? formatSessionDate(thread.performedOn) : null;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800/70 hover:bg-gray-900/60 transition-colors flex items-start gap-3 ${
        thread.unreadCount > 0 ? 'bg-blue-950/20' : ''
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isSession ? 'bg-blue-900/40 text-blue-300' : 'bg-gray-800 text-gray-400'
      }`}>
        {isSession ? <Calendar size={14} /> : <MessageCircle size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white truncate">
            {isSession && dateLabel ? `Session · ${dateLabel}` : 'Coach'}
          </span>
          {thread.unreadCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">
              {thread.unreadCount}
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-500 flex-shrink-0">
            {formatStamp(thread.lastActivityAt)}
          </span>
        </div>
        <div className="text-[11px] text-gray-400 truncate mt-0.5">
          {thread.lastMessage || <span className="italic">No messages</span>}
        </div>
      </div>
    </button>
  );
}

// ── Chat view ────────────────────────────────────────────────────────

function ChatView({
  thread,
  athleteId,
  ownerId,
  onBack,
  onMessagesChanged,
}: {
  thread: InboxThread;
  athleteId: string;
  ownerId: string;
  onBack: () => void;
  onMessagesChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const m = thread.kind === 'session' && thread.sessionId
        ? await fetchSessionMessages(thread.sessionId)
        : await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
    } catch (e) {
      console.error('[CoachInbox] load chat failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [thread.kind, thread.sessionId, athleteId, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark this thread read on open. Session-bound: per session. General:
  // via the dedicated helper. Fire-and-forget; a failure leaves the
  // badge alone for next time.
  useEffect(() => {
    if (thread.unreadCount === 0) return;
    const p = thread.kind === 'session' && thread.sessionId
      ? markMessagesRead(thread.sessionId, null, 'athlete')
      : markGeneralThreadRead(athleteId, ownerId, 'athlete');
    void p.then(onMessagesChanged).catch(() => {});
    // Intentionally only on thread change; not on every message refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.kind, thread.sessionId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      if (thread.kind === 'session' && thread.sessionId) {
        await addComment({
          sessionId: thread.sessionId,
          exerciseId: null,
          message: body,
          senderType: 'athlete',
        });
      } else {
        await sendGeneralMessage({
          athleteId,
          ownerId,
          message: body,
          senderType: 'athlete',
        });
      }
      setReply('');
      await load();
      await onMessagesChanged();
    } catch (e) {
      console.error('[CoachInbox] send failed', e);
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  const jumpToSession = thread.kind === 'session' && thread.performedOn
    ? () => {
        // Athlete's TodayScreen accepts ?week=<MondayISO>&slot=<dayIndex>
        // where slot 0=Mon … 6=Sun. Compute both from performedOn.
        const d = new Date(thread.performedOn! + 'T00:00:00Z');
        const weekday = d.getUTCDay(); // 0 = Sun, 1 = Mon
        const slot = weekday === 0 ? 6 : weekday - 1;
        const mon = new Date(d);
        mon.setUTCDate(mon.getUTCDate() - slot);
        const weekISO = mon.toISOString().slice(0, 10);
        navigate(`/athlete/today?week=${weekISO}&slot=${slot}`);
      }
    : null;

  const dateLabel = thread.kind === 'session' && thread.performedOn
    ? formatSessionDate(thread.performedOn)
    : null;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      <header className="px-3 pt-3 pb-2 border-b border-gray-800 flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1.5 rounded hover:bg-gray-800 text-gray-400"
          aria-label="Back to inbox"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white truncate">
            {thread.kind === 'session' ? `Session · ${dateLabel ?? ''}` : 'Coach'}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {thread.kind === 'session' ? 'Session comments' : 'General thread'}
          </div>
        </div>
        {jumpToSession && (
          <button
            onClick={jumpToSession}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-gray-800 hover:bg-gray-700 text-blue-300"
            title="Open this session in Today"
          >
            <ExternalLink size={11} />
            View session
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-400 px-2 py-3">{error}</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[11px] text-gray-500 italic py-12">
            No messages yet.
          </div>
        ) : (
          messages.map(m => <Bubble key={m.id} message={m} />)
        )}
      </div>

      <div className="border-t border-gray-800 px-3 py-2.5 flex gap-2">
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="Write a message…"
          className="flex-1 resize-none rounded-md bg-gray-900 border border-gray-800 text-white text-[13px] leading-snug px-3 py-2 outline-none focus:border-gray-700"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!reply.trim() || sending}
          className="self-end h-9 px-3 inline-flex items-center gap-1 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: TrainingLogMessage }) {
  const fromAthlete = message.sender_type === 'athlete';
  return (
    <div className={`flex ${fromAthlete ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] px-3 py-2 rounded-lg text-[12.5px] leading-snug whitespace-pre-wrap break-words ${
          fromAthlete
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-100 border border-gray-700'
        }`}
      >
        {message.message}
        <div className="text-[9px] mt-1 opacity-60 text-right">
          {formatStamp(message.created_at)}
        </div>
      </div>
    </div>
  );
}

function EmptyAthleteInbox() {
  return (
    <div className="px-6 py-16 text-center text-gray-500 flex flex-col items-center gap-3">
      <MessageCircle size={28} className="text-gray-700" />
      <div className="text-sm">No messages yet</div>
      <div className="text-[11px] text-gray-600 max-w-xs">
        When your coach writes you — or comments on one of your sessions — it will show up here.
      </div>
    </div>
  );
}

// ── Utilities ────────────────────────────────────────────────────────

function threadKeyOf(t: InboxThread): string {
  return t.kind === 'session' && t.sessionId ? `s:${t.sessionId}` : 'general';
}

function formatSessionDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
