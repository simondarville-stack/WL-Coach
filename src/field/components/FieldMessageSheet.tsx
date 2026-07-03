/**
 * FieldMessageSheet — quick coach→athlete message from the Field View.
 *
 * Bottom sheet over the drill-in screens: shows the general (no-session)
 * thread with the athlete and a one-box composer, reusing the existing
 * inbox infrastructure (fetchGeneralThreadMessages / sendGeneralMessage),
 * so messages land in the athlete's Coach tab and the desktop inbox.
 * Opening the sheet marks the thread read for the coach, mirroring the
 * desktop inbox behaviour.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import { getOwnerId } from '../../lib/ownerContext';
import {
  fetchGeneralThreadMessages,
  markGeneralThreadRead,
  sendGeneralMessage,
} from '../../lib/trainingLogService';
import { formatTime24, formatDateTimeShort } from '../../lib/dateUtils';
import type { TrainingLogMessage } from '../../lib/database.types';

interface FieldMessageSheetProps {
  athleteId: string;
  athleteName: string;
  onClose: () => void;
}

export function FieldMessageSheet({ athleteId, athleteName, onClose }: FieldMessageSheetProps) {
  const { activeCoach } = useCoachStore();
  const [messages, setMessages] = useState<TrainingLogMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const ownerId = getOwnerId();
      const m = await fetchGeneralThreadMessages(athleteId, ownerId);
      setMessages(m);
      // Coach is looking at the thread — clear the unread state like the
      // desktop inbox does. Failure here is non-fatal.
      void markGeneralThreadRead(athleteId, ownerId, 'coach').catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      const sent = await sendGeneralMessage({
        athleteId,
        ownerId: getOwnerId(),
        message: text,
        senderType: 'coach',
        senderCoachId: activeCoach?.id ?? null,
      });
      setMessages(prev => [...prev, sent]);
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-label={`Message ${athleteName}`}>
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />
      <div className="relative bg-gray-900 border-t border-gray-800 rounded-t-2xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-800">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white truncate">{athleteName}</div>
            <div className="text-[10px] text-gray-500">General thread · lands in their Coach tab</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-[120px]">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500 text-xs gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : messages.length === 0 ? (
            <p className="text-[11px] text-gray-500 text-center py-6">No messages yet.</p>
          ) : (
            messages.map(m => <Bubble key={m.id} message={m} />)
          )}
        </div>

        {error && <p className="text-[11px] text-red-400 px-4 pb-1">{error}</p>}

        <div className="border-t border-gray-800 px-3 py-2.5 flex gap-2 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
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
            placeholder="Write a message…"
            className="flex-1 resize-none rounded-md bg-gray-950 border border-gray-800 text-white text-[13px] leading-snug px-3 py-2 outline-none focus:border-gray-700"
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
      </div>
    </div>
  );
}

function Bubble({ message }: { message: TrainingLogMessage }) {
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
