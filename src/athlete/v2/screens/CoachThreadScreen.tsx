/**
 * CoachThreadScreen — athlete-facing inbox.
 *
 * Model: the conversation between an athlete and their coach is a
 * single general chat (the parent). Sessions that have been commented
 * on are sub-threads underneath that parent. Default view is the
 * general chat; a "Session discussions" panel at the top exposes the
 * sub-threads inline. Tapping a sub-thread switches into that
 * session's chat with a back button that returns to general.
 *
 * Session sub-threads carry a "View session" button so the athlete can
 * jump straight to that day on the Today screen for context.
 *
 * The paperclip attach flow mirrors both coach inboxes: pick any
 * training unit ("ask about a day") and the message lands in that
 * unit's session thread — the log session row is created on demand
 * with the first message, never by just browsing the picker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Loader2, MessageCircle, Paperclip, Send } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  defaultSlotLabel,
  ensureSession,
  fetchAthleteInboxThreads,
  fetchCoachNamesForMessages,
  fetchGeneralThreadMessages,
  fetchSessionMessages,
  fetchSessionRowForSlot,
  fetchSessionSlotRefs,
  fetchWeekOverview,
  markGeneralThreadRead,
  markMessagesRead,
  sendGeneralMessage,
  addComment,
  type InboxThread,
  type SessionSlotRef,
} from '../../../lib/trainingLogService';
import { formatWeekdayDateShort, formatTime24, formatDateTimeShort } from '../../../lib/dateUtils';
import { describeError } from '../../../lib/errorMessage';
import { UnitPickerSheet, type PickedUnit } from '../components/UnitPickerSheet';
import type { TrainingLogMessage } from '../../../lib/database.types';

/** A unit-thread target from the attach flow. sessionId stays null
 *  until the first message creates the log session row. */
interface UnitTarget {
  sessionId: string | null;
  weekStart: string;
  dayIndex: number;
  label: string;
  date: string;
}

type ViewMode =
  | 'general'
  | { kind: 'session'; thread: InboxThread }
  | { kind: 'unit'; unit: UnitTarget };

export function CoachThreadScreen() {
  const { athlete } = useAuth();
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('general');

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

  useEffect(() => {
    const onVis = () => { if (!document.hidden) void loadThreads(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [loadThreads]);

  const sessionThreads = useMemo(
    () => threads.filter(t => t.kind === 'session'),
    [threads],
  );
  const generalThread = useMemo(
    () => threads.find(t => t.kind === 'general') ?? syntheticGeneralThread(athleteId),
    [threads, athleteId],
  );

  // Resolve which training unit each session thread belongs to, plus
  // the coach's day labels for the involved weeks. Cosmetic — every
  // label falls back to "Day N".
  const sessionIdsKey = sessionThreads.map(t => t.sessionId).join(',');
  const [slotRefs, setSlotRefs] = useState<Map<string, SessionSlotRef>>(new Map());
  const [unitLabels, setUnitLabels] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!athleteId) return;
    let alive = true;
    (async () => {
      try {
        const refs = await fetchSessionSlotRefs(sessionIdsKey.split(',').filter(Boolean));
        if (!alive) return;
        setSlotRefs(refs);
        const weekStarts = Array.from(new Set(Array.from(refs.values()).map(r => r.weekStart)));
        const labels = new Map<string, string>();
        await Promise.all(
          weekStarts.map(async ws => {
            try {
              const ov = await fetchWeekOverview(athleteId, ws);
              for (const d of ov.days) labels.set(`${ws}:${d.dayIndex}`, d.label);
            } catch {
              // Label lookup failed — the "Day N" fallback still renders.
            }
          }),
        );
        if (alive) setUnitLabels(labels);
      } catch {
        // Slot refs are cosmetic + navigation sugar; threads still work.
      }
    })();
    return () => { alive = false; };
  }, [athleteId, sessionIdsKey]);

  const unitLabelFor = useCallback(
    (t: InboxThread): string | null => {
      const ref = t.sessionId ? slotRefs.get(t.sessionId) : null;
      if (!ref) return null;
      return unitLabels.get(`${ref.weekStart}:${ref.dayIndex}`) ?? defaultSlotLabel(ref.dayIndex);
    },
    [slotRefs, unitLabels],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const handlePickUnit = async (picked: PickedUnit) => {
    if (!athleteId) return;
    setPickerOpen(false);
    // Reuse the unit's existing session/thread when there is one;
    // otherwise the session row is created with the first message.
    let sessionId: string | null = null;
    try {
      const existing = await fetchSessionRowForSlot(athleteId, picked.weekStart, picked.dayIndex);
      sessionId = existing?.id ?? null;
    } catch {
      // Lookup failure degrades to lazy creation on send.
    }
    const existingThread = sessionId
      ? sessionThreads.find(t => t.sessionId === sessionId)
      : undefined;
    if (existingThread) setView({ kind: 'session', thread: existingThread });
    else setView({ kind: 'unit', unit: { ...picked, sessionId } });
  };

  if (!athlete || !athleteId || !ownerId) {
    return (
      <div className="px-4 py-6 text-sm text-gray-400">
        Pick an athlete from the profile picker to access the coach thread.
      </div>
    );
  }

  // Either we're inside a session/unit sub-thread (back button →
  // general) or we're on the general chat (sub-threads panel above it).
  let pane: React.ReactNode;
  if (view === 'general') {
    pane = (
      <ChatView
        thread={generalThread}
        athleteId={athleteId}
        ownerId={ownerId}
        onBack={null}
        onMessagesChanged={loadThreads}
        showSubThreadsPanel
        sessionThreads={sessionThreads}
        onSelectSubThread={t => setView({ kind: 'session', thread: t })}
        loadingThreads={loadingThreads}
        threadsError={error}
        unitLabelFor={unitLabelFor}
        onAttach={() => setPickerOpen(true)}
      />
    );
  } else if (view.kind === 'session') {
    pane = (
      <ChatView
        thread={view.thread}
        athleteId={athleteId}
        ownerId={ownerId}
        onBack={() => { setView('general'); void loadThreads(); }}
        onMessagesChanged={loadThreads}
        showSubThreadsPanel={false}
        sessionThreads={sessionThreads}
        onSelectSubThread={t => setView({ kind: 'session', thread: t })}
        unitLabelFor={unitLabelFor}
      />
    );
  } else {
    const u = view.unit;
    pane = (
      <ChatView
        key={`unit:${u.weekStart}:${u.dayIndex}`}
        thread={syntheticUnitThread(athleteId, u)}
        unit={u}
        athleteId={athleteId}
        ownerId={ownerId}
        onBack={() => { setView('general'); void loadThreads(); }}
        onMessagesChanged={loadThreads}
        showSubThreadsPanel={false}
        sessionThreads={sessionThreads}
        onSelectSubThread={t => setView({ kind: 'session', thread: t })}
        unitLabelFor={unitLabelFor}
      />
    );
  }

  return (
    <>
      {pane}
      {pickerOpen && (
        <UnitPickerSheet
          athleteId={athleteId}
          onPick={u => void handlePickUnit(u)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

// ── Sub-threads panel ────────────────────────────────────────────────

function SubThreadsPanel({
  sessions,
  onSelect,
  unitLabelFor,
}: {
  sessions: InboxThread[];
  onSelect: (t: InboxThread) => void;
  unitLabelFor: (t: InboxThread) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const totalUnread = sessions.reduce((s, t) => s + t.unreadCount, 0);

  if (sessions.length === 0) return null;

  return (
    <div className="border-b border-gray-800 bg-gray-900/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-gray-900/80"
        aria-expanded={open}
      >
        {open
          ? <ChevronDown size={14} className="text-gray-500" />
          : <ChevronRight size={14} className="text-gray-500" />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-300">
          Session discussions
        </span>
        <span className="text-[10px] text-gray-500">({sessions.length})</span>
        {totalUnread > 0 && (
          <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">
            {totalUnread}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-800">
          {sessions.map(t => (
            <button
              key={t.sessionId ?? 'unknown'}
              onClick={() => onSelect(t)}
              className={`w-full px-4 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-gray-900 border-b border-gray-900 last:border-b-0 ${
                t.unreadCount > 0 ? 'bg-blue-950/20' : ''
              }`}
            >
              <span className="text-blue-300 flex-shrink-0">↳</span>
              <span className="flex-1 min-w-0">
                <span className="text-white font-medium">
                  {unitLabelFor(t) ?? 'Session'}
                  {t.performedOn && (
                    <span className="text-gray-500 font-normal"> · {formatSessionDate(t.performedOn)}</span>
                  )}
                </span>
                <span className="text-gray-500 truncate ml-2 text-[11px]">
                  {t.lastMessageSender === 'athlete' ? `You: ${t.lastMessage}` : t.lastMessage}
                </span>
              </span>
              {t.unreadCount > 0 && (
                <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white flex-shrink-0">
                  {t.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat view ────────────────────────────────────────────────────────

function ChatView({
  thread,
  unit = null,
  athleteId,
  ownerId,
  onBack,
  onMessagesChanged,
  showSubThreadsPanel,
  sessionThreads,
  onSelectSubThread,
  loadingThreads = false,
  threadsError = null,
  unitLabelFor,
  onAttach = null,
}: {
  thread: InboxThread;
  /** Attach-flow target. When set (and the unit has no session row
   *  yet), the session is created with the first message. */
  unit?: UnitTarget | null;
  athleteId: string;
  ownerId: string;
  /** Null when this is the root general view; otherwise dismisses the
   *  session sub-thread back to general. */
  onBack: (() => void) | null;
  onMessagesChanged: () => Promise<void>;
  showSubThreadsPanel: boolean;
  sessionThreads: InboxThread[];
  onSelectSubThread: (t: InboxThread) => void;
  loadingThreads?: boolean;
  threadsError?: string | null;
  unitLabelFor: (t: InboxThread) => string | null;
  /** Shown as a paperclip in the composer (general view only). */
  onAttach?: (() => void) | null;
}) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [coachNames, setCoachNames] = useState<Map<string, string>>(new Map());
  // Session id can be born mid-conversation: the attach flow's first
  // message creates the log session row (ensureSession).
  const [sessionId, setSessionId] = useState<string | null>(thread.sessionId);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const m = thread.kind === 'session'
        ? sessionId
          ? await fetchSessionMessages(sessionId)
          : [] // attached unit without a session yet — empty thread
        : await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
      const names = await fetchCoachNamesForMessages(m);
      setCoachNames(names);
    } catch (e) {
      console.error('[CoachInbox] load chat failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [thread.kind, sessionId, athleteId, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark read on open. Both general and session-bound branches.
  useEffect(() => {
    if (thread.unreadCount === 0) return;
    const p = thread.kind === 'session'
      ? sessionId
        ? markMessagesRead(sessionId, null, 'athlete')
        : Promise.resolve()
      : markGeneralThreadRead(athleteId, ownerId, 'athlete');
    void p.then(onMessagesChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.kind, sessionId]);

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
      if (thread.kind === 'session') {
        let sid = sessionId;
        if (!sid && unit) {
          // First message on a not-yet-logged unit: create its session
          // row now so the message has an anchor.
          const session = await ensureSession({
            athleteId,
            ownerId,
            date: unit.date,
            weekStart: unit.weekStart,
            dayIndex: unit.dayIndex,
          });
          sid = session.id;
          setSessionId(sid);
        }
        if (!sid) throw new Error('No session to attach this message to.');
        await addComment({
          sessionId: sid,
          exerciseId: null,
          message: body,
          senderType: 'athlete',
        });
        setReply('');
        // Reload directly with the (possibly fresh) session id — the
        // load callback may still close over sessionId = null.
        const m = await fetchSessionMessages(sid);
        setMessages(m);
        setCoachNames(await fetchCoachNamesForMessages(m));
      } else {
        await sendGeneralMessage({
          athleteId,
          ownerId,
          message: body,
          senderType: 'athlete',
        });
        setReply('');
        await load();
      }
      await onMessagesChanged();
    } catch (e) {
      console.error('[CoachInbox] send failed', e);
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  const jumpTarget = unit
    ? { week: unit.weekStart, slot: unit.dayIndex }
    : thread.kind === 'session' && thread.performedOn
      ? (() => {
          const d = new Date(thread.performedOn + 'T00:00:00Z');
          const weekday = d.getUTCDay();
          const slot = weekday === 0 ? 6 : weekday - 1;
          const mon = new Date(d);
          mon.setUTCDate(mon.getUTCDate() - slot);
          return { week: mon.toISOString().slice(0, 10), slot };
        })()
      : null;
  const jumpToSession = jumpTarget
    ? () => navigate(`/athlete/today?week=${jumpTarget.week}&slot=${jumpTarget.slot}`)
    : null;

  const unitLabel = unit?.label ?? (thread.kind === 'session' ? unitLabelFor(thread) : null);
  const dateLabel = thread.kind === 'session'
    ? unit
      ? formatSessionDate(unit.date)
      : thread.performedOn
        ? formatSessionDate(thread.performedOn)
        : null
    : null;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      <header className="px-3 pt-3 pb-2 border-b border-gray-800 flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400"
            aria-label="Back to general thread"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white truncate">
            {thread.kind === 'session' ? `${unitLabel ?? 'Session'} · ${dateLabel ?? ''}` : 'Coach'}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {thread.kind === 'session' ? 'Unit discussion' : 'General thread with your coach'}
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

      {showSubThreadsPanel && !loadingThreads && !threadsError && (
        <SubThreadsPanel
          sessions={sessionThreads}
          onSelect={onSelectSubThread}
          unitLabelFor={unitLabelFor}
        />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-400 px-2 py-3">{error}</div>
        ) : messages.length === 0 ? (
          <EmptyChat kind={thread.kind} />
        ) : (
          messages.map(m => (
            <Bubble
              key={m.id}
              message={m}
              senderLabel={coachLabelForAthlete(m, coachNames)}
            />
          ))
        )}
      </div>

      <div className="border-t border-gray-800 px-3 py-2.5 flex gap-2">
        {onAttach && (
          <button
            type="button"
            onClick={onAttach}
            className="self-end h-9 w-9 inline-flex items-center justify-center rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200"
            aria-label="Ask about a training day"
            title="Ask about a training day"
          >
            <Paperclip size={14} />
          </button>
        )}
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
          placeholder={thread.kind === 'session' ? 'Ask about this unit…' : 'Write a message…'}
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

function Bubble({ message, senderLabel }: { message: TrainingLogMessage; senderLabel: string | null }) {
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
        {senderLabel && !fromAthlete && (
          <div className="text-[10px] font-semibold opacity-90 mb-1 text-blue-300">
            {senderLabel}
          </div>
        )}
        {message.message}
        <div className="text-[9px] mt-1 opacity-60 text-right">
          {formatStamp(message.created_at)}
        </div>
      </div>
    </div>
  );
}

function EmptyChat({ kind }: { kind: 'general' | 'session' }) {
  return (
    <div className="px-6 py-16 text-center text-gray-500 flex flex-col items-center gap-3">
      <MessageCircle size={28} className="text-gray-700" />
      <div className="text-sm">No messages yet</div>
      <div className="text-[11px] text-gray-600 max-w-xs">
        {kind === 'general'
          ? 'Say hi to your coach or ask a general question.'
          : 'Ask a question about this specific session.'}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Athlete-side bubble label. Athletes don't get "You" on their own
 * bubbles. Coach bubbles get the coach's name when sender_coach_id is
 * populated; legacy rows fall back to no label.
 */
function coachLabelForAthlete(
  m: TrainingLogMessage,
  names: Map<string, string>,
): string | null {
  if (m.sender_type !== 'coach') return null;
  if (!m.sender_coach_id) return null;
  return names.get(m.sender_coach_id) ?? null;
}

/**
 * Stub InboxThread for the general view when no general messages exist
 * yet. Lets ChatView render an empty general chat without special-casing.
 */
function syntheticGeneralThread(athleteId: string | null): InboxThread {
  return {
    kind: 'general',
    sessionId: null,
    athleteId: athleteId ?? '',
    athleteName: '',
    athletePhotoUrl: null,
    performedOn: null,
    lastMessage: '',
    lastMessageSender: 'athlete',
    lastActivityAt: new Date(0).toISOString(),
    unreadCount: 0,
    athleteMessageCount: 0,
  };
}

/** Thread placeholder for a unit picked via the attach flow that has
 *  no messages (and possibly no session row) yet. */
function syntheticUnitThread(athleteId: string, unit: UnitTarget): InboxThread {
  return {
    kind: 'session',
    sessionId: unit.sessionId,
    athleteId,
    athleteName: '',
    athletePhotoUrl: null,
    performedOn: unit.date,
    lastMessage: '',
    lastMessageSender: 'athlete',
    lastActivityAt: new Date(0).toISOString(),
    unreadCount: 0,
    athleteMessageCount: 0,
  };
}

function formatSessionDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return formatWeekdayDateShort(iso);
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  // Same-day: just the 24h time; otherwise day-first date + 24h time.
  return sameDay ? formatTime24(d) : formatDateTimeShort(d);
}
