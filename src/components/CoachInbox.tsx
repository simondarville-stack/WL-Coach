/**
 * CoachInbox — athlete-rooted inbox.
 *
 * Left rail lists every accessible athlete (owned + shared), so a coach
 * can start a conversation with anyone without waiting for the athlete
 * to ping first. Athletes who have any thread activity bubble to the
 * top sorted by unread/recency; the rest live under "Other athletes"
 * as a compose-new affordance.
 *
 * Right pane shows the selected athlete's conversation: a general
 * chat with session sub-threads accessible via a collapsible panel.
 * Mirrors the athlete app's structure so both sides see the same
 * organization.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
  Loader2,
  Mail,
  MailOpen,
  MessageCircle,
  Search,
  Send,
  X as XIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  addComment,
  fetchCoachNamesForMessages,
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
import { useCoachStore } from '../store/coachStore';
import type { TrainingLogMessage } from '../lib/database.types';

interface AthleteSummary {
  athleteId: string;
  athleteName: string;
  athletePhotoUrl: string | null;
  generalThread: InboxThread | null;
  sessionThreads: InboxThread[];
  totalUnread: number;
  lastActivityAt: string | null;
  preview: string;
}

export function CoachInbox() {
  const ownerId = getOwnerId();
  const accessibleAthletes = useAthleteStore(s => s.athletes);

  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showOther, setShowOther] = useState(false);

  const loadThreads = useCallback(async () => {
    setError(null);
    try {
      const t = await fetchInboxThreads(ownerId);
      setThreads(t);
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

  // Refresh on tab focus — coaches often leave inbox in a background
  // tab while waiting for athletes to log.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) void loadThreads(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [loadThreads]);

  // Build per-athlete summaries from the flat thread list. Athletes
  // with no thread rows still appear via accessibleAthletes (compose-
  // new affordance). Sort: unread first, then activity desc.
  const { activeSummaries, otherAthletes } = useMemo(() => {
    const byAthlete = new Map<string, AthleteSummary>();
    for (const t of threads) {
      let s = byAthlete.get(t.athleteId);
      if (!s) {
        s = {
          athleteId: t.athleteId,
          athleteName: t.athleteName,
          athletePhotoUrl: t.athletePhotoUrl,
          generalThread: null,
          sessionThreads: [],
          totalUnread: 0,
          lastActivityAt: null,
          preview: '',
        };
        byAthlete.set(t.athleteId, s);
      }
      if (t.kind === 'general') s.generalThread = t;
      else s.sessionThreads.push(t);
      s.totalUnread += t.unreadCount;
      if (!s.lastActivityAt || t.lastActivityAt > s.lastActivityAt) {
        s.lastActivityAt = t.lastActivityAt;
        s.preview = t.lastMessage;
      }
    }
    const active = Array.from(byAthlete.values()).sort((a, b) => {
      if ((a.totalUnread > 0) !== (b.totalUnread > 0)) return a.totalUnread > 0 ? -1 : 1;
      return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');
    });
    const activeIds = new Set(active.map(s => s.athleteId));
    const other = accessibleAthletes
      .filter(a => a.is_active && !activeIds.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { activeSummaries: active, otherAthletes: other };
  }, [threads, accessibleAthletes]);

  // Search + unread filters compose with the active/other split.
  const q = searchQuery.trim().toLowerCase();
  const filteredActive = activeSummaries.filter(s => {
    if (unreadOnly && s.totalUnread === 0) return false;
    if (q && !s.athleteName.toLowerCase().includes(q)) return false;
    return true;
  });
  const filteredOther = unreadOnly ? [] : otherAthletes.filter(a => !q || a.name.toLowerCase().includes(q));

  const selectedSummary = activeSummaries.find(s => s.athleteId === selectedAthleteId) ?? null;
  const selectedOther = otherAthletes.find(a => a.id === selectedAthleteId) ?? null;

  return (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 16px)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      {/* Left rail */}
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
            {activeSummaries.length} active
          </span>
        </div>

        {/* Search + unread filter */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 12px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={11} style={{ position: 'absolute', left: 8, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search athlete"
              style={{
                flex: 1,
                padding: '4px 8px 4px 24px',
                fontSize: 11,
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 'var(--radius-sm)',
                outline: 'none',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                title="Clear"
                style={{ position: 'absolute', right: 4, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center' }}
              >
                <XIcon size={11} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setUnreadOnly(v => !v)}
              title="Show only athletes with unread messages"
              style={{
                padding: '2px 7px',
                fontSize: 10,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid ' + (unreadOnly ? 'var(--color-accent-border)' : 'var(--color-border-secondary)'),
                background: unreadOnly ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
                color: unreadOnly ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Mail size={10} />
              Unread
            </button>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => {
                setShowOther(true);
                setSearchQuery('');
              }}
              title="Start a new conversation with an athlete who hasn't messaged you"
              style={{
                padding: '2px 7px',
                fontSize: 10,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-secondary)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Edit3 size={10} />
              New
            </button>
          </div>
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
          ) : (
            <>
              {filteredActive.length === 0 && filteredOther.length === 0 ? (
                <EmptyInboxList hasFilters={!!(q || unreadOnly)} />
              ) : (
                <>
                  {filteredActive.map(s => (
                    <AthleteRow
                      key={s.athleteId}
                      name={s.athleteName}
                      photoUrl={s.athletePhotoUrl}
                      preview={s.preview}
                      lastActivity={s.lastActivityAt}
                      unread={s.totalUnread}
                      hasSubThreads={s.sessionThreads.length}
                      active={s.athleteId === selectedAthleteId}
                      onClick={() => { setSelectedAthleteId(s.athleteId); setShowOther(false); }}
                    />
                  ))}

                  {(showOther || filteredActive.length === 0) && filteredOther.length > 0 && (
                    <div>
                      <div
                        style={{
                          padding: '10px 16px 4px',
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          color: 'var(--color-text-tertiary)',
                          fontWeight: 600,
                          background: 'var(--color-bg-secondary)',
                          borderTop: '0.5px solid var(--color-border-tertiary)',
                        }}
                      >
                        Other athletes
                      </div>
                      {filteredOther.map(a => (
                        <AthleteRow
                          key={a.id}
                          name={a.name}
                          photoUrl={a.photo_url}
                          preview="No messages yet"
                          lastActivity={null}
                          unread={0}
                          hasSubThreads={0}
                          dimmed
                          active={a.id === selectedAthleteId}
                          onClick={() => setSelectedAthleteId(a.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: selected athlete's conversation */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selectedSummary ? (
          <AthleteConversation
            key={selectedSummary.athleteId}
            athleteId={selectedSummary.athleteId}
            athleteName={selectedSummary.athleteName}
            athletePhotoUrl={selectedSummary.athletePhotoUrl}
            ownerId={ownerId}
            generalThread={selectedSummary.generalThread}
            sessionThreads={selectedSummary.sessionThreads}
            onMessagesChanged={loadThreads}
          />
        ) : selectedOther ? (
          <AthleteConversation
            key={selectedOther.id}
            athleteId={selectedOther.id}
            athleteName={selectedOther.name}
            athletePhotoUrl={selectedOther.photo_url}
            ownerId={ownerId}
            generalThread={null}
            sessionThreads={[]}
            onMessagesChanged={loadThreads}
          />
        ) : (
          <PickAthlete />
        )}
      </div>
    </div>
  );
}

// ─── Athlete row ─────────────────────────────────────────────────────

interface AthleteRowProps {
  name: string;
  photoUrl: string | null;
  preview: string;
  lastActivity: string | null;
  unread: number;
  hasSubThreads: number;
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
}

function AthleteRow({ name, photoUrl, preview, lastActivity, unread, hasSubThreads, active, dimmed, onClick }: AthleteRowProps) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '10px 14px',
        background: active ? 'var(--color-accent-muted)' : 'transparent',
        borderLeft: active ? '2px solid var(--color-accent)' : '2px solid transparent',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        cursor: 'pointer',
        textAlign: 'left',
        opacity: dimmed ? 0.7 : 1,
      }}
    >
      <Avatar name={name} photoUrl={photoUrl} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {lastActivity && (
            <span style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
              {formatActivity(lastActivity)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              color: dimmed ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
              fontStyle: dimmed ? 'italic' : 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preview}
          </span>
          {hasSubThreads > 0 && (
            <span
              title={`${hasSubThreads} session ${hasSubThreads === 1 ? 'thread' : 'threads'}`}
              style={{ fontSize: 9, color: 'var(--color-text-tertiary)', flexShrink: 0 }}
            >
              ↳{hasSubThreads}
            </span>
          )}
          {unread > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '0 6px',
                background: 'var(--color-accent)',
                color: 'var(--color-text-on-accent)',
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              {unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Athlete conversation (general + sub-threads) ───────────────────

function AthleteConversation({
  athleteId,
  athleteName,
  athletePhotoUrl,
  ownerId,
  generalThread,
  sessionThreads,
  onMessagesChanged,
}: {
  athleteId: string;
  athleteName: string;
  athletePhotoUrl: string | null;
  ownerId: string;
  generalThread: InboxThread | null;
  sessionThreads: InboxThread[];
  onMessagesChanged: () => Promise<void>;
}) {
  type View = 'general' | { kind: 'session'; thread: InboxThread };
  const [view, setView] = useState<View>('general');

  const generalForChat: InboxThread =
    generalThread ?? syntheticGeneralThread(athleteId, athleteName, athletePhotoUrl);

  if (view !== 'general') {
    return (
      <ChatPane
        thread={view.thread}
        athleteId={athleteId}
        athleteName={athleteName}
        athletePhotoUrl={athletePhotoUrl}
        ownerId={ownerId}
        onBack={() => { setView('general'); void onMessagesChanged(); }}
        onMessagesChanged={onMessagesChanged}
        sessionThreads={sessionThreads}
        onSelectSubThread={t => setView({ kind: 'session', thread: t })}
        showSubThreadsPanel={false}
      />
    );
  }

  return (
    <ChatPane
      thread={generalForChat}
      athleteId={athleteId}
      athleteName={athleteName}
      athletePhotoUrl={athletePhotoUrl}
      ownerId={ownerId}
      onBack={null}
      onMessagesChanged={onMessagesChanged}
      sessionThreads={sessionThreads}
      onSelectSubThread={t => setView({ kind: 'session', thread: t })}
      showSubThreadsPanel
    />
  );
}

function SubThreadsPanel({
  sessions,
  onSelect,
}: {
  sessions: InboxThread[];
  onSelect: (t: InboxThread) => void;
}) {
  const [open, setOpen] = useState(false);
  const totalUnread = sessions.reduce((s, t) => s + t.unreadCount, 0);
  if (sessions.length === 0) return null;
  return (
    <div style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-bg-secondary)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {open
          ? <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          : <ChevronRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
        <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>
          Session discussions
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>({sessions.length})</span>
        {totalUnread > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 9.5,
              padding: '0 5px',
              fontWeight: 600,
              background: 'var(--color-accent)',
              color: 'var(--color-text-on-accent)',
              borderRadius: 7,
            }}
          >
            {totalUnread}
          </span>
        )}
      </button>
      {open && (
        <div style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
          {sessions.map(t => (
            <button
              key={t.sessionId ?? 'unknown'}
              onClick={() => onSelect(t)}
              style={{
                width: '100%',
                padding: '7px 16px',
                background: t.unreadCount > 0 ? 'var(--color-accent-muted)' : 'transparent',
                border: 'none',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 11.5,
              }}
            >
              <span style={{ color: 'var(--color-accent)' }}>↳</span>
              <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                {t.performedOn ? formatDate(t.performedOn) : 'Session'}
              </span>
              <span style={{ flex: 1, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                {t.lastMessage}
              </span>
              {t.unreadCount > 0 && (
                <span
                  style={{
                    fontSize: 9.5,
                    padding: '0 5px',
                    fontWeight: 600,
                    background: 'var(--color-accent)',
                    color: 'var(--color-text-on-accent)',
                    borderRadius: 7,
                  }}
                >
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

function ChatPane({
  thread,
  athleteId,
  athleteName,
  athletePhotoUrl,
  ownerId,
  onBack,
  onMessagesChanged,
  sessionThreads,
  onSelectSubThread,
  showSubThreadsPanel,
}: {
  thread: InboxThread;
  athleteId: string;
  athleteName: string;
  athletePhotoUrl: string | null;
  ownerId: string;
  onBack: (() => void) | null;
  onMessagesChanged: () => Promise<void>;
  sessionThreads: InboxThread[];
  onSelectSubThread: (t: InboxThread) => void;
  showSubThreadsPanel: boolean;
}) {
  const navigate = useNavigate();
  const setSelectedAthlete = useAthleteStore(s => s.setSelectedAthlete);
  const accessibleAthletes = useAthleteStore(s => s.athletes);
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);

  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [coachNames, setCoachNames] = useState<Map<string, string>>(new Map());
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
        : await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
      const names = await fetchCoachNamesForMessages(m);
      setCoachNames(names);
    } catch (e) {
      console.error('[CoachInbox] loadMessages failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [thread.kind, thread.sessionId, athleteId, ownerId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (thread.unreadCount === 0) return;
    const p = thread.kind === 'session' && thread.sessionId
      ? markMessagesRead(thread.sessionId, null, 'coach')
      : markGeneralThreadRead(athleteId, ownerId, 'coach');
    void p.then(onMessagesChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.kind, thread.sessionId, athleteId]);

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
          senderCoachId: activeCoachId,
        });
      } else {
        await sendGeneralMessage({
          athleteId,
          ownerId,
          message: body,
          senderType: 'coach',
          senderCoachId: activeCoachId,
        });
      }
      setReply('');
      await loadMessages();
      await onMessagesChanged();
    } catch (e) {
      console.error('[CoachInbox] send failed', e);
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  const onOpenSession = thread.kind === 'session' && thread.performedOn
    ? () => {
        // Set planner context to this athlete first, then navigate.
        const target = accessibleAthletes.find(a => a.id === thread.athleteId);
        if (target) setSelectedAthlete(target);
        const d = new Date(thread.performedOn! + 'T00:00:00Z');
        const weekday = d.getUTCDay();
        const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
        d.setUTCDate(d.getUTCDate() - daysFromMonday);
        const weekStart = d.toISOString().slice(0, 10);
        navigate(`/planner/${weekStart}`);
      }
    : null;

  const headerDate = thread.kind === 'session' && thread.performedOn
    ? formatDate(thread.performedOn)
    : null;

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
        {onBack && (
          <button
            onClick={onBack}
            style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'inline-flex' }}
            title="Back to general"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <Avatar name={athleteName} photoUrl={athletePhotoUrl} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {athleteName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {thread.kind === 'general'
              ? 'General thread'
              : `Session sub-thread · ${headerDate ?? ''}`}
          </div>
        </div>
        {onOpenSession && (
          <button
            type="button"
            onClick={onOpenSession}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ExternalLink size={11} />
            Open session
          </button>
        )}
      </div>

      {showSubThreadsPanel && (
        <SubThreadsPanel sessions={sessionThreads} onSelect={onSelectSubThread} />
      )}

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
          <div style={{ padding: 24, color: 'var(--color-text-tertiary)', textAlign: 'center', fontSize: 11 }}>
            <Loader2 size={14} className="animate-spin" style={{ display: 'inline-block', marginRight: 6 }} />
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--color-danger-text)' }}>{error}</div>
        ) : messages.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
            {thread.kind === 'general'
              ? 'No messages yet. Send the first one.'
              : 'No messages on this session yet.'}
          </div>
        ) : (
          messages.map(m => (
            <MessageBubble
              key={m.id}
              message={m}
              senderLabel={coachLabelFor(m, coachNames, activeCoachId, athleteName)}
            />
          ))
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 20px 12px',
          borderTop: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-bg-primary)',
        }}
      >
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
          placeholder={thread.kind === 'session' ? 'Comment on this session…' : `Message ${athleteName}…`}
          style={{
            flex: 1,
            resize: 'none',
            padding: '8px 10px',
            fontSize: 12,
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!reply.trim() || sending}
          style={{
            alignSelf: 'flex-end',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            background: 'var(--color-accent)',
            color: 'var(--color-text-on-accent)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: reply.trim() && !sending ? 'pointer' : 'not-allowed',
            opacity: reply.trim() && !sending ? 1 : 0.5,
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Empty states + helpers ──────────────────────────────────────────

function EmptyInboxList({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
      <MailOpen size={26} style={{ margin: '0 auto 8px', color: 'var(--color-text-tertiary)' }} />
      <div style={{ fontSize: 12 }}>
        {hasFilters ? 'No matches.' : 'No athletes accessible.'}
      </div>
    </div>
  );
}

function PickAthlete() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <MessageCircle size={28} style={{ margin: '0 auto 10px', color: 'var(--color-text-tertiary)' }} />
        <div style={{ fontSize: 13, marginBottom: 4 }}>Pick an athlete</div>
        <div style={{ fontSize: 11 }}>Choose someone from the list to read their messages or start a new conversation.</div>
      </div>
    </div>
  );
}

function MessageBubble({ message, senderLabel }: { message: TrainingLogMessage; senderLabel: string | null }) {
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
        {senderLabel && (
          <div style={{ fontSize: 9, opacity: 0.85, fontWeight: 600, marginBottom: 2, letterSpacing: '0.02em' }}>
            {senderLabel}
          </div>
        )}
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
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
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

/**
 * Sender label resolver — coach inbox variant. Coach bubbles get
 * "You" when written by the viewing coach, otherwise that coach's
 * display name. Athlete bubbles get the athlete's name. Pre-feature
 * coach rows (sender_coach_id null) collapse to no label.
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

/** Empty general-thread placeholder so the coach can write to an
 *  athlete who hasn't messaged yet. */
function syntheticGeneralThread(athleteId: string, athleteName: string, athletePhotoUrl: string | null): InboxThread {
  return {
    kind: 'general',
    sessionId: null,
    athleteId,
    athleteName,
    athletePhotoUrl,
    performedOn: null,
    lastMessage: '',
    lastActivityAt: new Date(0).toISOString(),
    unreadCount: 0,
    athleteMessageCount: 0,
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────

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
