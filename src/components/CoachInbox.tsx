import { useCallback, useEffect, useState } from 'react';
import { Mail, Send, Loader2, MailOpen, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  addComment,
  fetchGeneralThreadMessages,
  fetchInboxThreads,
  fetchSessionMessages,
  markGeneralThreadRead,
  markMessagesRead,
  sendGeneralMessage,
  type InboxThread,
} from '../lib/trainingLogService';
import { getOwnerId } from '../lib/ownerContext';
import { describeError } from '../lib/errorMessage';
import { useAthleteStore } from '../store/athleteStore';
import type { TrainingLogMessage } from '../lib/database.types';

/**
 * Coach-facing inbox: every athlete-sent message lands here grouped by
 * session. Left pane lists threads (unread first, newest activity within
 * each group), right pane shows the selected thread with a reply box.
 *
 * Schema reuses training_log_messages (already in place from UF-10);
 * "thread" is a virtual grouping by session_id — no extra tables needed.
 */
export function CoachInbox() {
  const navigate = useNavigate();
  const ownerId = getOwnerId();
  const setSelectedAthlete = useAthleteStore(s => s.setSelectedAthlete);
  const accessibleAthletes = useAthleteStore(s => s.athletes);

  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A thread can be session-bound (key = sessionId) or general
  // (key = "general:<athleteId>"); we store the composite key so both
  // shapes can be selected the same way.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    setError(null);
    try {
      const t = await fetchInboxThreads(ownerId);
      setThreads(t);
      // Auto-select the first thread on initial load so the right pane
      // isn't blank. Subsequent loads (refresh after reply) preserve
      // whatever the user had open.
      setSelectedKey(prev => prev ?? (t[0] ? threadKey(t[0]) : null));
    } catch (e) {
      console.error('[CoachInbox] loadThreads failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Refresh when the tab regains focus — coaches commonly leave the
  // inbox open in a background tab while waiting for athletes to log.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) void loadThreads();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [loadThreads]);

  const selectedThread = threads.find(t => threadKey(t) === selectedKey) ?? null;

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 16px)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      {/* Left: thread list */}
      <div
        style={{
          width: 320,
          flexShrink: 0,
          background: 'var(--color-bg-primary)',
          borderRight: '0.5px solid var(--color-border-secondary)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
          }}
        >
          <Mail size={14} style={{ color: 'var(--color-text-secondary)' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            Inbox
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {threads.length === 0 ? '0' : `${threads.length} thread${threads.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)' }}>
              <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
              <span style={{ fontSize: 11 }}>Loading…</span>
            </div>
          ) : error ? (
            <div style={{ padding: 16, fontSize: 11, color: 'var(--color-danger-text)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          ) : threads.length === 0 ? (
            <EmptyInbox />
          ) : (
            threads.map(t => {
              const k = threadKey(t);
              return (
                <ThreadRow
                  key={k}
                  thread={t}
                  active={k === selectedKey}
                  onClick={() => setSelectedKey(k)}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Right: selected thread */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selectedThread ? (
          <ThreadView
            thread={selectedThread}
            ownerId={ownerId}
            onMessagesChanged={loadThreads}
            onOpenSession={
              selectedThread.kind === 'session' && selectedThread.performedOn
                ? () => {
                    // Set the planner context to the thread's athlete first,
                    // otherwise the planner lands on whoever was previously
                    // selected. Then navigate to the week containing the
                    // session.
                    const target = accessibleAthletes.find(
                      a => a.id === selectedThread.athleteId,
                    );
                    if (target) setSelectedAthlete(target);
                    const d = new Date(selectedThread.performedOn + 'T00:00:00Z');
                    const weekday = d.getUTCDay(); // 0 = Sun, 1 = Mon
                    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
                    d.setUTCDate(d.getUTCDate() - daysFromMonday);
                    const weekStart = d.toISOString().slice(0, 10);
                    navigate(`/planner/${weekStart}`);
                  }
                : null
            }
          />
        ) : !loading && threads.length === 0 ? null : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-tertiary)',
              fontSize: 12,
              fontStyle: 'italic',
            }}
          >
            Select a thread
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyInbox() {
  return (
    <div
      style={{
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        color: 'var(--color-text-tertiary)',
        textAlign: 'center',
      }}
    >
      <MailOpen size={20} />
      <span style={{ fontSize: 11, fontStyle: 'italic' }}>
        No messages yet. When an athlete comments on a session, it'll show up here.
      </span>
    </div>
  );
}

interface ThreadRowProps {
  thread: InboxThread;
  active: boolean;
  onClick: () => void;
}

function ThreadRow({ thread, active, onClick }: ThreadRowProps) {
  const unread = thread.unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        gap: 10,
        padding: '10px 14px',
        background: active ? 'var(--color-accent-muted)' : 'transparent',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        borderLeft: active ? '2px solid var(--color-accent)' : '2px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background var(--transition-fast)',
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <Avatar name={thread.athleteName} photoUrl={thread.athletePhotoUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: unread ? 600 : 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {thread.athleteName}
          </span>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
            {formatActivity(thread.lastActivityAt)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span
            style={{
              flex: 1,
              fontSize: 11,
              color: unread ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: unread ? 500 : 400,
            }}
          >
            {thread.lastMessage}
          </span>
          {unread && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 16,
                height: 16,
                padding: '0 5px',
                fontSize: 9,
                fontWeight: 600,
                background: 'var(--color-accent)',
                color: 'var(--color-text-on-accent)',
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              {thread.unreadCount}
            </span>
          )}
        </div>
        <div style={{ marginTop: 2, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
          {thread.kind === 'general'
            ? 'General'
            : `Session ${thread.performedOn ? formatDate(thread.performedOn) : ''}`}
        </div>
      </div>
    </button>
  );
}

interface ThreadViewProps {
  thread: InboxThread;
  ownerId: string;
  onMessagesChanged: () => void | Promise<void>;
  /** Null for general threads — there's no session week to open. */
  onOpenSession: (() => void) | null;
}

function ThreadView({ thread, ownerId, onMessagesChanged, onOpenSession }: ThreadViewProps) {
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const m = thread.kind === 'session' && thread.sessionId
        ? await fetchSessionMessages(thread.sessionId)
        : await fetchGeneralThreadMessages(thread.athleteId, ownerId);
      setMessages(m);
    } catch (e) {
      console.error('[CoachInbox] loadMessages failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [thread.kind, thread.sessionId, thread.athleteId, ownerId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  // Mark the thread read once we have it open. Fire-and-forget — even if
  // it fails the user can still read the messages; the unread state will
  // simply stay until the next click.
  useEffect(() => {
    if (thread.unreadCount === 0) return;
    const p = thread.kind === 'session' && thread.sessionId
      ? markMessagesRead(thread.sessionId, null, 'coach')
      : markGeneralThreadRead(thread.athleteId, ownerId, 'coach');
    void p.then(onMessagesChanged).catch(() => {});
    // Only when the active thread changes — not on every messages refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.kind, thread.sessionId, thread.athleteId]);

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
          senderType: 'coach',
        });
      } else {
        await sendGeneralMessage({
          athleteId: thread.athleteId,
          ownerId,
          message: body,
          senderType: 'coach',
        });
      }
      setReply('');
      await loadMessages();
      await onMessagesChanged();
    } catch (e) {
      console.error('[CoachInbox] handleSend failed', e);
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 20px',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-bg-primary)',
        }}
      >
        <Avatar name={thread.athleteName} photoUrl={thread.athletePhotoUrl} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {thread.athleteName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {thread.kind === 'general'
              ? 'General thread'
              : `Session ${thread.performedOn ? formatDate(thread.performedOn) : ''}`}
          </div>
        </div>
        {onOpenSession && (
          <button
            type="button"
            onClick={onOpenSession}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              background: 'var(--color-bg-primary)',
              border: '0.5px solid var(--color-border-secondary)',
              color: 'var(--color-text-secondary)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-primary)';
            }}
            title="Open this week's plan in the planner"
          >
            Open week
          </button>
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'var(--color-bg-secondary)',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, color: 'var(--color-text-tertiary)' }}>
            <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
            <span style={{ fontSize: 11 }}>Loading thread…</span>
          </div>
        ) : error ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--color-danger-text)' }}>{error}</div>
        ) : messages.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
            No messages on this session.
          </div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 20px 14px',
          borderTop: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-bg-primary)',
        }}
      >
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => {
            // Cmd/Ctrl+Enter sends — a textarea Enter inserts a newline.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="Write a reply…  (⌘/Ctrl + Enter to send)"
          style={{
            flex: 1,
            resize: 'none',
            fontSize: 12,
            lineHeight: 1.45,
            padding: '8px 10px',
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!reply.trim() || sending}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            background: 'var(--color-accent)',
            color: 'var(--color-text-on-accent)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: !reply.trim() || sending ? 'not-allowed' : 'pointer',
            opacity: !reply.trim() || sending ? 0.5 : 1,
            alignSelf: 'flex-end',
            height: 32,
          }}
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: TrainingLogMessage }) {
  const fromCoach = message.sender_type === 'coach';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: fromCoach ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '7px 11px',
          background: fromCoach ? 'var(--color-accent)' : 'var(--color-bg-primary)',
          color: fromCoach ? 'var(--color-text-on-accent)' : 'var(--color-text-primary)',
          border: fromCoach ? 'none' : '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.message}
        <div
          style={{
            fontSize: 9,
            marginTop: 4,
            opacity: 0.6,
            textAlign: 'right',
          }}
        >
          {formatTimeStamp(message.created_at)}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, photoUrl, size = 32 }: { name: string; photoUrl: string | null; size?: number }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
        onError={e => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.4),
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {initials || '?'}
    </div>
  );
}

/** Stable key for a thread that works for both session-bound and general
 *  threads. Matches the keying used by fetchInboxUnreadCount so badge
 *  counts and selected-row state stay consistent. */
function threadKey(t: InboxThread): string {
  return t.kind === 'session' && t.sessionId
    ? t.sessionId
    : `general:${t.athleteId}`;
}

// ─── Date helpers ─────────────────────────────────────────────────────────

function formatActivity(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (diff < oneDayMs && now.getDate() === d.getDate()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * oneDayMs) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimeStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = isToday(d);
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
