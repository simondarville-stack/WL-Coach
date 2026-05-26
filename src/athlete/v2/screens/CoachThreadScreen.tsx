/**
 * CoachThreadScreen — athlete-facing general thread with their coach.
 *
 * Pairs 1:1 with the coach's CoachInbox "General" thread for the same
 * athlete. Messages are session-independent: athlete_id is set,
 * session_id is NULL. Everything reads/writes through
 * trainingLogService so coach and athlete see the same data without
 * any custom routing or real-time layer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchGeneralThreadMessages,
  markGeneralThreadRead,
  sendGeneralMessage,
} from '../../../lib/trainingLogService';
import { describeError } from '../../../lib/errorMessage';
import type { TrainingLogMessage } from '../../../lib/database.types';

export function CoachThreadScreen() {
  const { athlete } = useAuth();
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const athleteId = athlete?.id ?? null;
  const ownerId = athlete?.owner_id ?? null;

  const load = useCallback(async () => {
    if (!athleteId || !ownerId) return;
    setError(null);
    try {
      const m = await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
    } catch (e) {
      console.error('[CoachThread] load failed', e);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [athleteId, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark coach messages read on open / re-focus.
  useEffect(() => {
    if (!athleteId || !ownerId) return;
    void markGeneralThreadRead(athleteId, ownerId, 'athlete').catch(() => {});
  }, [athleteId, ownerId, messages.length]);

  // Refresh when the tab comes back into focus — the only "polling"
  // we do on this screen.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [load]);

  // Auto-scroll the message list to the bottom whenever the message
  // count changes (new message arrives or reply sent).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = async () => {
    const body = reply.trim();
    if (!body || sending || !athleteId || !ownerId) return;
    setSending(true);
    setError(null);
    try {
      await sendGeneralMessage({
        athleteId,
        ownerId,
        message: body,
        senderType: 'athlete',
      });
      setReply('');
      await load();
    } catch (e) {
      console.error('[CoachThread] send failed', e);
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  if (!athlete) {
    return (
      <div className="px-4 py-6 text-sm text-gray-400">
        Pick an athlete from the profile picker to access the coach thread.
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      <header className="px-4 pt-4 pb-3 border-b border-gray-800">
        <h1 className="text-base font-semibold text-white">Message your coach</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">
          General thread — not tied to a session.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500 text-xs gap-1.5">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-400 px-2 py-3">{error}</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[11px] text-gray-500 italic py-12">
            No messages yet. Say hi to your coach.
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
