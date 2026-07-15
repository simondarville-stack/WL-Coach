/**
 * FieldConversationScreen — one athlete's conversation in the Field
 * View inbox (/field/inbox/:athleteId).
 *
 * Same model as the desktop CoachInbox and the athlete app: the
 * general thread is the root view; messages attached to a specific
 * training unit live in that unit's session sub-thread. Two ways into
 * a unit thread:
 *   - the "Unit discussions" panel (existing threads), and
 *   - the paperclip attach flow: pick any training unit from the
 *     athlete's weeks and the next message lands in that unit's
 *     thread — the log session row is created on demand (ensureSession)
 *     when the first message is sent, never just by browsing.
 *
 * Unit threads are labelled with the unit's slot label + date and carry
 * an "Open unit" jump into the field drill-in screen for context.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageCircle,
  Paperclip,
  Send,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { useCoachStore } from '../../store/coachStore';
import {
  addComment,
  ensureSession,
  fetchCoachNamesForMessages,
  fetchGeneralThreadMessages,
  fetchInboxThreads,
  fetchSessionMessages,
  fetchSessionRowForSlot,
  fetchSessionSlotRefs,
  fetchWeekOverview,
  markGeneralThreadRead,
  markMessagesRead,
  sendGeneralMessage,
  defaultSlotLabel,
  type InboxThread,
  type SessionSlotRef,
} from '../../lib/trainingLogService';
import {
  formatDateShort,
  formatDateTimeShort,
  formatTime24,
  formatWeekdayDateShort,
} from '../../lib/dateUtils';
import { UnitPickerSheet, type PickedUnit } from '../../athlete/v2/components/UnitPickerSheet';
import { InitialsAvatar } from './FieldInboxScreen';
import type { TrainingLogMessage } from '../../lib/database.types';

/** A unit thread target. sessionId is null until the first message
 *  creates the session row (attach flow on a not-yet-logged unit). */
interface UnitTarget {
  sessionId: string | null;
  weekStart: string;
  dayIndex: number;
  label: string;
  date: string;
}

type View = { kind: 'general' } | { kind: 'unit'; unit: UnitTarget };

export function FieldConversationScreen() {
  const navigate = useNavigate();
  const { athleteId } = useParams<{ athleteId: string }>();
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const ownerId = getOwnerId();

  const [athlete, setAthlete] = useState<{
    name: string;
    photoUrl: string | null;
    ownerId: string;
  } | null>(null);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [slotRefs, setSlotRefs] = useState<Map<string, SessionSlotRef>>(new Map());
  const [unitLabels, setUnitLabels] = useState<Map<string, string>>(new Map());
  const [view, setView] = useState<View>({ kind: 'general' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    if (!athleteId) return;
    try {
      const all = await fetchInboxThreads(ownerId);
      const mine = all.filter(t => t.athleteId === athleteId);
      setThreads(mine);
      const refs = await fetchSessionSlotRefs(
        mine.filter(t => t.kind === 'session' && t.sessionId).map(t => t.sessionId!),
      );
      setSlotRefs(refs);
      // Resolve unit labels (coach-named day labels) per involved week —
      // usually one or two overview fetches; fallback label is "Day N".
      const weekStarts = Array.from(new Set(Array.from(refs.values()).map(r => r.weekStart)));
      const labels = new Map<string, string>();
      await Promise.all(
        weekStarts.map(async ws => {
          try {
            const ov = await fetchWeekOverview(athleteId, ws);
            for (const d of ov.days) labels.set(`${ws}:${d.dayIndex}`, d.label);
          } catch {
            // Label lookup is cosmetic — the default "Day N" still renders.
          }
        }),
      );
      setUnitLabels(labels);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [athleteId, ownerId]);

  useEffect(() => {
    if (!athleteId) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('athletes')
        .select('name, photo_url, owner_id')
        .eq('id', athleteId)
        .maybeSingle();
      if (!alive) return;
      const row = data as { name: string; photo_url: string | null; owner_id: string } | null;
      if (row) setAthlete({ name: row.name, photoUrl: row.photo_url, ownerId: row.owner_id });
    })();
    void loadThreads();
    return () => { alive = false; };
  }, [athleteId, loadThreads]);

  const unitThreads = useMemo(
    () => threads.filter(t => t.kind === 'session'),
    [threads],
  );
  const generalThread = useMemo(
    () => threads.find(t => t.kind === 'general') ?? null,
    [threads],
  );

  const labelForSlot = useCallback(
    (weekStart: string, dayIndex: number) =>
      unitLabels.get(`${weekStart}:${dayIndex}`) ?? defaultSlotLabel(dayIndex),
    [unitLabels],
  );

  const openUnitThread = (t: InboxThread) => {
    const ref = t.sessionId ? slotRefs.get(t.sessionId) : null;
    if (!ref) return;
    setView({
      kind: 'unit',
      unit: {
        sessionId: ref.sessionId,
        weekStart: ref.weekStart,
        dayIndex: ref.dayIndex,
        label: labelForSlot(ref.weekStart, ref.dayIndex),
        date: ref.date,
      },
    });
  };

  const handlePickUnit = async (picked: PickedUnit) => {
    if (!athleteId) return;
    setPickerOpen(false);
    // Reuse an existing session when the unit already has one; otherwise
    // the thread starts empty and the session row is created on first send.
    let sessionId: string | null = null;
    try {
      const existing = await fetchSessionRowForSlot(athleteId, picked.weekStart, picked.dayIndex);
      sessionId = existing?.id ?? null;
    } catch {
      // Lookup failure degrades to lazy creation on send.
    }
    setView({ kind: 'unit', unit: { ...picked, sessionId } });
  };

  if (!athleteId) return null;

  const inUnit = view.kind === 'unit';
  const unit = inUnit ? view.unit : null;

  return (
    <div data-theme="dark" className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col" style={{ height: '100dvh' }}>
        {/* Header */}
        <header className="px-3 pt-3 pb-2 border-b border-gray-800 flex items-center gap-2 shrink-0">
          <button
            onClick={() => (inUnit ? setView({ kind: 'general' }) : navigate('/field/inbox'))}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400"
            aria-label={inUnit ? 'Back to general thread' : 'Back to inbox'}
          >
            <ArrowLeft size={16} />
          </button>
          <InitialsAvatar name={athlete?.name ?? ''} photoUrl={athlete?.photoUrl ?? null} size={28} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white truncate">
              {athlete?.name ?? 'Athlete'}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5 truncate">
              {unit
                ? `${unit.label} · ${formatWeekdayDateShort(unit.date)}`
                : 'General thread'}
            </div>
          </div>
          {unit && (
            <button
              onClick={() =>
                navigate(`/field/a/${athleteId}/d/${unit.dayIndex}?w=${unit.weekStart}`)
              }
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-gray-800 hover:bg-gray-700 text-blue-300 shrink-0"
              title="Open this training unit"
            >
              <ExternalLink size={11} />
              Open unit
            </button>
          )}
        </header>

        {/* Unit sub-threads panel (general view only) */}
        {!inUnit && (
          <UnitThreadsPanel
            threads={unitThreads}
            slotRefs={slotRefs}
            labelForSlot={labelForSlot}
            onSelect={openUnitThread}
          />
        )}

        {error && <p className="text-[11px] text-red-400 px-4 py-1">{error}</p>}

        <ThreadChat
          key={inUnit ? `unit:${unit!.weekStart}:${unit!.dayIndex}` : 'general'}
          athleteId={athleteId}
          athleteOwnerId={athlete?.ownerId ?? ownerId}
          ownerId={ownerId}
          athleteName={athlete?.name ?? 'Athlete'}
          activeCoachId={activeCoachId}
          unit={unit}
          unreadHint={
            inUnit
              ? unitThreads.find(t => t.sessionId === unit!.sessionId)?.unreadCount ?? 0
              : generalThread?.unreadCount ?? 0
          }
          onMessagesChanged={loadThreads}
          onAttach={!inUnit ? () => setPickerOpen(true) : null}
        />
      </div>

      {pickerOpen && (
        <UnitPickerSheet
          athleteId={athleteId}
          onPick={u => void handlePickUnit(u)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Unit sub-threads panel ──────────────────────────────────────────

function UnitThreadsPanel({
  threads,
  slotRefs,
  labelForSlot,
  onSelect,
}: {
  threads: InboxThread[];
  slotRefs: Map<string, SessionSlotRef>;
  labelForSlot: (weekStart: string, dayIndex: number) => string;
  onSelect: (t: InboxThread) => void;
}) {
  const [open, setOpen] = useState(false);
  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);
  if (threads.length === 0) return null;
  return (
    <div className="border-b border-gray-800 bg-gray-900/40 shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-gray-900/80"
        aria-expanded={open}
      >
        {open
          ? <ChevronDown size={14} className="text-gray-500" />
          : <ChevronRight size={14} className="text-gray-500" />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-300">
          Unit discussions
        </span>
        <span className="text-[10px] text-gray-500">({threads.length})</span>
        {totalUnread > 0 && (
          <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">
            {totalUnread}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-800">
          {threads.map(t => {
            const ref = t.sessionId ? slotRefs.get(t.sessionId) : null;
            const label = ref
              ? labelForSlot(ref.weekStart, ref.dayIndex)
              : 'Unit';
            return (
              <button
                key={t.sessionId ?? 'unknown'}
                onClick={() => onSelect(t)}
                className={`w-full px-4 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-gray-900 border-b border-gray-900 last:border-b-0 ${
                  t.unreadCount > 0 ? 'bg-blue-950/20' : ''
                }`}
              >
                <span className="text-blue-300 shrink-0">↳</span>
                <span className="flex-1 min-w-0">
                  <span className="text-white font-medium">
                    {label}
                    {t.performedOn && (
                      <span className="text-gray-500 font-normal"> · {formatDateShort(t.performedOn)}</span>
                    )}
                  </span>
                  <span className="text-gray-500 truncate ml-2 text-[11px]">
                    {t.lastMessageSender === 'coach' ? `You: ${t.lastMessage}` : t.lastMessage}
                  </span>
                </span>
                {t.unreadCount > 0 && (
                  <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white shrink-0">
                    {t.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Chat (general or one unit) ──────────────────────────────────────

function ThreadChat({
  athleteId,
  athleteOwnerId,
  ownerId,
  athleteName,
  activeCoachId,
  unit,
  unreadHint,
  onMessagesChanged,
  onAttach,
}: {
  athleteId: string;
  /** The athlete's host environment — sessions created by the attach
   *  flow must belong to it so the athlete app and host inbox see them. */
  athleteOwnerId: string;
  ownerId: string;
  athleteName: string;
  activeCoachId: string | null;
  /** Null → general thread. */
  unit: UnitTarget | null;
  unreadHint: number;
  onMessagesChanged: () => Promise<void>;
  onAttach: (() => void) | null;
}) {
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [coachNames, setCoachNames] = useState<Map<string, string>>(new Map());
  const [sessionId, setSessionId] = useState<string | null>(unit?.sessionId ?? null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const m = unit
        ? sessionId
          ? await fetchSessionMessages(sessionId)
          : []
        : await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
      setCoachNames(await fetchCoachNamesForMessages(m));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [unit, sessionId, athleteId, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark the other party's messages read on open, like every other
  // inbox surface. Failure is non-fatal — the next open retries.
  //
  // unreadHint is a dep on purpose — same reason as CoachInbox and the
  // athlete app's CoachThreadScreen: threads load async, so the general
  // view's first render sees a hint of 0 and bails, and without this the
  // effect would never re-run once the real count arrives, leaving the
  // messages unread forever. Re-running is safe (the update only touches
  // rows whose read column is still null).
  useEffect(() => {
    if (unreadHint === 0) return;
    const p = unit
      ? sessionId
        ? markMessagesRead(sessionId, null, 'coach')
        : Promise.resolve()
      : markGeneralThreadRead(athleteId, ownerId, 'coach');
    void p.then(onMessagesChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.sessionId, sessionId, athleteId, unreadHint]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  const handleSend = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      if (unit) {
        // First message on a not-yet-logged unit: create the session
        // row now so the message has its anchor.
        let sid = sessionId;
        if (!sid) {
          const session = await ensureSession({
            athleteId,
            ownerId: athleteOwnerId,
            date: unit.date,
            weekStart: unit.weekStart,
            dayIndex: unit.dayIndex,
          });
          sid = session.id;
          setSessionId(sid);
        }
        const sent = await addComment({
          sessionId: sid,
          exerciseId: null,
          message: text,
          senderType: 'coach',
          senderCoachId: activeCoachId,
        });
        setMessages(prev => [...prev, sent]);
      } else {
        const sent = await sendGeneralMessage({
          athleteId,
          ownerId,
          message: text,
          senderType: 'coach',
          senderCoachId: activeCoachId,
        });
        setMessages(prev => [...prev, sent]);
      }
      setBody('');
      await onMessagesChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500 flex flex-col items-center gap-3">
            <MessageCircle size={26} className="text-gray-700" />
            <div className="text-sm">No messages yet</div>
            <div className="text-[11px] text-gray-600 max-w-xs">
              {unit
                ? `Start the discussion about ${unit.label} — the athlete sees it attached to that unit.`
                : `Message ${athleteName}, or attach a training unit to ask about a specific session.`}
            </div>
          </div>
        ) : (
          messages.map(m => (
            <Bubble
              key={m.id}
              message={m}
              senderLabel={coachLabelFor(m, coachNames, activeCoachId, athleteName)}
            />
          ))
        )}
      </div>

      {error && <p className="text-[11px] text-red-400 px-4 pb-1">{error}</p>}

      <div className="border-t border-gray-800 px-3 py-2.5 flex gap-2 shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {onAttach && (
          <button
            type="button"
            onClick={onAttach}
            className="self-end h-9 w-9 inline-flex items-center justify-center rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200"
            aria-label="Attach a training unit"
            title="Attach a training unit"
          >
            <Paperclip size={14} />
          </button>
        )}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder={unit ? `Ask about ${unit.label}…` : 'Write a message…'}
          className="flex-1 resize-none rounded-md bg-gray-900 border border-gray-800 text-white text-[13px] leading-snug px-3 py-2 outline-none focus:border-gray-700"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!body.trim() || sending}
          className="self-end h-9 px-3 inline-flex items-center gap-1 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
      </div>
    </>
  );
}

function Bubble({
  message,
  senderLabel,
}: {
  message: TrainingLogMessage;
  senderLabel: string | null;
}) {
  const fromCoach = message.sender_type === 'coach';
  return (
    <div className={`flex ${fromCoach ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] px-3 py-2 rounded-lg text-[12.5px] leading-snug whitespace-pre-wrap break-words ${
          fromCoach
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-100 border border-gray-700'
        }`}
      >
        {senderLabel && (
          <div className="text-[10px] font-semibold opacity-90 mb-1">{senderLabel}</div>
        )}
        {message.message}
        <div className="text-[9px] mt-1 opacity-60 text-right">{formatStamp(message.created_at)}</div>
      </div>
    </div>
  );
}

/**
 * Sender label — coach inbox variant, mirrors the desktop CoachInbox:
 * own bubbles get "You", other coaches their display name, athlete
 * bubbles the athlete's name. Legacy coach rows without a
 * sender_coach_id collapse to no label.
 */
function coachLabelFor(
  m: TrainingLogMessage,
  names: Map<string, string>,
  viewingCoachId: string | null,
  athleteName: string,
): string | null {
  if (m.sender_type === 'athlete') return athleteName || null;
  if (!m.sender_coach_id) return null;
  if (m.sender_coach_id === viewingCoachId) return 'You';
  return names.get(m.sender_coach_id) ?? null;
}

/** Same-day: 24h time only; otherwise day-first date + 24h time. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return sameDay ? formatTime24(d) : formatDateTimeShort(d);
}
