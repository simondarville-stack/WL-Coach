/**
 * useThreadChat — the one implementation of a coach↔athlete message thread.
 *
 * Three surfaces render a thread: the desktop coach inbox (`CoachInbox`), the
 * athlete app (`CoachThreadScreen`), and the coach's field app
 * (`FieldConversationScreen`). Their *presentation* genuinely differs — the
 * desktop pane is styled with inline CSS-var tokens, the two mobile views with
 * Tailwind, and each owns a different chrome/back/jump arrangement. Their
 * *logic* was identical, and had been copy-pasted three times.
 *
 * That duplication was not cosmetic, it was a defect generator: the same two
 * bugs existed in every copy, and fixing them took three separate edits — the
 * third (the field app) was missed on the first pass and only caught in review.
 * The logic lives here now so the next fix lands once.
 *
 * The surfaces differ only in parameters, not branches:
 *   role            'coach' | 'athlete' — who is reading and sending
 *   kind            'general' (the standing conversation) | 'session' (a unit)
 *   ownerId         env scoping the general thread
 *   sessionOwnerId  env stamped on a lazily-created session (the athlete's host)
 *   senderCoachId   labels which coach wrote a bubble in a shared inbox
 *
 * Returns state + a `send`; each surface renders it however it likes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addComment,
  ensureSession,
  fetchCoachNamesForMessages,
  fetchGeneralThreadMessages,
  fetchSessionMessages,
  markGeneralThreadRead,
  markMessagesRead,
  sendGeneralMessage,
} from '../lib/trainingLogService';
import { describeError } from '../lib/errorMessage';
import type { TrainingLogMessage } from '../lib/database.types';

/**
 * A training unit targeted by the attach ("ask about a day") flow. `sessionId`
 * is null until the first message creates the log session row — browsing the
 * picker must never write one.
 */
export interface ThreadChatUnit {
  sessionId: string | null;
  weekStart: string;
  dayIndex: number;
  label: string;
  date: string;
}

export interface UseThreadChatArgs {
  /** 'session' binds the thread to one training unit; 'general' is the standing chat. */
  kind: 'general' | 'session';
  /** Session id when the thread already has one; null for a not-yet-logged unit. */
  initialSessionId: string | null;
  /** Attach-flow target — required to create the session on first send. */
  unit?: ThreadChatUnit | null;
  athleteId: string;
  /** Owner env scoping the general thread. */
  ownerId: string;
  /**
   * Owner env to stamp on a session created here. Defaults to ownerId, which is
   * right for the athlete (they are in their own env) but not for a coach, who
   * must stamp the ATHLETE's host env or the athlete app won't find the session.
   */
  sessionOwnerId?: string;
  role: 'coach' | 'athlete';
  /** Active coach for coach sends; ignored for athlete sends. */
  senderCoachId?: string | null;
  /** Unread count for THIS thread. Drives mark-on-open — see the effect below. */
  unreadCount: number;
  /** Called after any write, so the parent can refresh its thread list. */
  onMessagesChanged: () => Promise<void>;
}

export interface ThreadChatState {
  messages: TrainingLogMessage[];
  coachNames: Map<string, string>;
  /** Live session id — may be born mid-conversation via the attach flow. */
  sessionId: string | null;
  loading: boolean;
  sending: boolean;
  error: string | null;
  draft: string;
  setDraft: (v: string) => void;
  send: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Stable identity for "which thread is this", used to reset per-thread state. */
function threadKeyOf(
  kind: 'general' | 'session',
  initialSessionId: string | null,
  unit: ThreadChatUnit | null | undefined,
): string {
  if (kind === 'general') return 'general';
  if (initialSessionId) return `session:${initialSessionId}`;
  return unit ? `unit:${unit.weekStart}:${unit.dayIndex}` : 'session:pending';
}

export function useThreadChat({
  kind,
  initialSessionId,
  unit = null,
  athleteId,
  ownerId,
  sessionOwnerId,
  role,
  senderCoachId = null,
  unreadCount,
  onMessagesChanged,
}: UseThreadChatArgs): ThreadChatState {
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [coachNames, setCoachNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The session id can be born mid-conversation: on a unit with no log session
  // yet, the first message creates the row (ensureSession) and the thread
  // continues on it. That created id is per-thread state, so it is reset when
  // the caller switches threads — via React's documented "adjust state during
  // render" pattern rather than an effect.
  //
  // This reset is why the hook is safe even if a caller forgets to key it. The
  // original bug was exactly that: the id was seeded once at mount and one call
  // site had no key, so switching into a session sub-thread kept the previous
  // thread's null — every sub-thread rendered empty and never marked itself
  // read. Owning the reset here means no caller can reintroduce it.
  const threadKey = threadKeyOf(kind, initialSessionId, unit);
  const [seenThreadKey, setSeenThreadKey] = useState(threadKey);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  if (seenThreadKey !== threadKey) {
    setSeenThreadKey(threadKey);
    setCreatedSessionId(null);
    setDraft('');
    setError(null);
  }
  const sessionId = initialSessionId ?? createdSessionId;

  // Refs, not deps: `unit` is an object literal at every call site and
  // `onMessagesChanged` is usually an inline closure, so depending on either
  // would churn identity every render and re-fire the effects below.
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const onMessagesChangedRef = useRef(onMessagesChanged);
  onMessagesChangedRef.current = onMessagesChanged;

  // `silent` skips the loading flag: the initial open shows a spinner, but a
  // post-send refetch must NOT — flipping loading there blanks the whole
  // conversation to a spinner on every message sent, which is jarring on the
  // gym-side field app in particular.
  const reload = useCallback(async (silent = false) => {
    setError(null);
    if (!silent) setLoading(true);
    try {
      const m =
        kind === 'session'
          ? sessionId
            ? await fetchSessionMessages(sessionId)
            : [] // a unit with no session row yet — nothing to show
          : await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
      setCoachNames(await fetchCoachNamesForMessages(m));
    } catch (e) {
      console.error('[useThreadChat] load failed', e);
      setError(describeError(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [kind, sessionId, athleteId, ownerId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Mark the other party's messages read on open.
  //
  // unreadCount is a dep on purpose: thread lists load async, so the first
  // render sees a placeholder count of 0 and bails. Without it the effect never
  // re-runs once the real count lands and the messages stay unread forever —
  // the bug behind every "the badge won't clear" report. Re-running is safe:
  // the write only touches rows whose read column is still null, and the
  // resulting refresh drives the count to 0, which bails again.
  useEffect(() => {
    if (unreadCount === 0) return;
    const p =
      kind === 'session'
        ? sessionId
          ? markMessagesRead(sessionId, null, role)
          : Promise.resolve()
        : markGeneralThreadRead(athleteId, ownerId, role);
    void p.then(() => onMessagesChangedRef.current()).catch(() => {
      // Non-fatal: the next open retries.
    });
  }, [kind, sessionId, athleteId, ownerId, role, unreadCount]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      if (kind === 'session') {
        let sid = sessionId;
        const target = unitRef.current;
        if (!sid && target) {
          const session = await ensureSession({
            athleteId,
            ownerId: sessionOwnerId ?? ownerId,
            date: target.date,
            weekStart: target.weekStart,
            dayIndex: target.dayIndex,
          });
          sid = session.id;
          setCreatedSessionId(sid);
        }
        if (!sid) throw new Error('No session to attach this message to.');
        await addComment({
          sessionId: sid,
          exerciseId: null,
          message: body,
          senderType: role,
          senderCoachId,
        });
        setDraft('');
        // Refetch with the (possibly just-created) id rather than appending the
        // sent row: it also picks up anything the other party sent meanwhile,
        // and refreshes the coach-name map for the new bubble.
        const m = await fetchSessionMessages(sid);
        setMessages(m);
        setCoachNames(await fetchCoachNamesForMessages(m));
      } else {
        await sendGeneralMessage({
          athleteId,
          ownerId,
          message: body,
          senderType: role,
          senderCoachId,
        });
        setDraft('');
        await reload(true); // silent — don't blank the thread to a spinner on send
      }
      await onMessagesChangedRef.current();
    } catch (e) {
      console.error('[useThreadChat] send failed', e);
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  }, [draft, sending, kind, sessionId, athleteId, ownerId, sessionOwnerId, role, senderCoachId, reload]);

  return {
    messages,
    coachNames,
    sessionId,
    loading,
    sending,
    error,
    draft,
    setDraft,
    send,
    reload,
  };
}
