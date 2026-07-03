/**
 * FieldInboxScreen — the coach inbox, Field View flavour (/field/inbox).
 *
 * One row per athlete with message activity (unread first, then most
 * recent), mirroring the desktop CoachInbox's athlete-rooted model on
 * a phone screen. The rest of the squad lives behind "Start a
 * conversation" so the coach can message anyone without waiting for
 * the athlete to ping first. Tapping a row opens the conversation
 * screen (general thread + per-unit sub-threads).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Edit3, Loader2, RefreshCw } from 'lucide-react';
import { getOwnerId } from '../../lib/ownerContext';
import { fetchAccessibleAthletes } from '../../lib/accessScope';
import { fetchInboxThreads, type InboxThread } from '../../lib/trainingLogService';
import { formatDateShort, formatTime24 } from '../../lib/dateUtils';
import { EnvironmentSwitcher } from '../components/EnvironmentSwitcher';
import type { Athlete } from '../../lib/database.types';

interface AthleteSummary {
  athleteId: string;
  athleteName: string;
  athletePhotoUrl: string | null;
  totalUnread: number;
  unitThreadCount: number;
  lastActivityAt: string | null;
  preview: string;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Today → 24h time; within a week → weekday; older → DD/MM. */
function formatActivity(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return formatTime24(d);
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return WEEKDAY_SHORT[(d.getDay() + 6) % 7];
  }
  return formatDateShort(d.toISOString().slice(0, 10));
}

export function FieldInboxScreen() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [others, setOthers] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const ownerId = getOwnerId();
      const [t, accessible] = await Promise.all([
        fetchInboxThreads(ownerId),
        fetchAccessibleAthletes(ownerId, { activeOnly: true }),
      ]);
      setThreads(t);
      setOthers(accessible.athletes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVis = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [load]);

  // Fold the flat thread list into one summary per athlete; athletes
  // without any thread activity form the compose-new section.
  const { active, other } = useMemo(() => {
    const byAthlete = new Map<string, AthleteSummary>();
    for (const t of threads) {
      let s = byAthlete.get(t.athleteId);
      if (!s) {
        s = {
          athleteId: t.athleteId,
          athleteName: t.athleteName,
          athletePhotoUrl: t.athletePhotoUrl,
          totalUnread: 0,
          unitThreadCount: 0,
          lastActivityAt: null,
          preview: '',
        };
        byAthlete.set(t.athleteId, s);
      }
      if (t.kind === 'session') s.unitThreadCount += 1;
      s.totalUnread += t.unreadCount;
      if (!s.lastActivityAt || t.lastActivityAt > s.lastActivityAt) {
        s.lastActivityAt = t.lastActivityAt;
        // Coach-authored previews (coach-initiated threads) read as
        // "You: …" so they aren't mistaken for athlete messages.
        s.preview = t.lastMessageSender === 'coach' ? `You: ${t.lastMessage}` : t.lastMessage;
      }
    }
    const sorted = Array.from(byAthlete.values()).sort((a, b) => {
      if ((a.totalUnread > 0) !== (b.totalUnread > 0)) return a.totalUnread > 0 ? -1 : 1;
      return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');
    });
    const activeIds = new Set(sorted.map(s => s.athleteId));
    const rest = others
      .filter(a => !activeIds.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { active: sorted, other: rest };
  }, [threads, others]);

  return (
    <div className="max-w-2xl mx-auto px-3 pt-4">
      <div className="flex items-baseline justify-between px-1 mb-3">
        <div>
          <h1 className="text-lg font-bold text-white">Inbox</h1>
          {/* div, not p: the switcher renders a bottom-sheet (block content) */}
          <div className="text-xs text-gray-500">
            <EnvironmentSwitcher />
          </div>
        </div>
        <button
          onClick={() => void load()}
          className="p-2 text-gray-500 hover:text-gray-300"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="text-sm text-red-400 px-1 mb-3">{error}</p>}

      {loading && threads.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-600" />
        </div>
      ) : (
        <div className="pb-4">
          {active.length === 0 && (
            <p className="text-sm text-gray-500 px-1 mb-3">
              No conversations yet. Start one below.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {active.map(s => (
              <button
                key={s.athleteId}
                onClick={() => navigate(`/field/inbox/${s.athleteId}`)}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 flex items-center gap-3 text-left active:bg-gray-800/60"
              >
                <InitialsAvatar name={s.athleteName} photoUrl={s.athletePhotoUrl} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-white truncate flex-1">
                      {s.athleteName}
                    </span>
                    {s.lastActivityAt && (
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {formatActivity(s.lastActivityAt)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400 truncate flex-1">
                      {s.preview || 'No messages yet'}
                    </span>
                    {s.unitThreadCount > 0 && (
                      <span
                        className="text-[9px] text-gray-500 shrink-0"
                        title={`${s.unitThreadCount} unit ${s.unitThreadCount === 1 ? 'thread' : 'threads'}`}
                      >
                        ↳{s.unitThreadCount}
                      </span>
                    )}
                    {s.totalUnread > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white shrink-0">
                        {s.totalUnread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {other.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowOthers(v => !v)}
                className="w-full px-1 py-1.5 flex items-center gap-1.5 text-left"
                aria-expanded={showOthers}
              >
                {showOthers
                  ? <ChevronDown size={13} className="text-gray-600" />
                  : <ChevronRight size={13} className="text-gray-600" />}
                <span className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold flex items-center gap-1.5">
                  <Edit3 size={11} />
                  Start a conversation ({other.length})
                </span>
              </button>
              {showOthers && (
                <div className="flex flex-col gap-1 mt-1">
                  {other.map(a => (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/field/inbox/${a.id}`)}
                      className="w-full bg-gray-900/60 border border-gray-800/70 rounded-lg px-3 py-2 flex items-center gap-3 text-left active:bg-gray-800/60"
                    >
                      <InitialsAvatar name={a.name} photoUrl={a.photo_url} size={26} />
                      <span className="text-[13px] text-gray-300 truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InitialsAvatar({
  name,
  photoUrl,
  size = 32,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
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
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className="rounded-full bg-gray-800 text-gray-400 font-medium inline-flex items-center justify-center shrink-0"
    >
      {initials || '?'}
    </span>
  );
}
