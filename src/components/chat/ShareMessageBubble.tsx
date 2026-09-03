/**
 * ShareMessageBubble — an analysed lift, handed over, as a chat bubble.
 *
 * The coach's words are an ordinary message in the thread; this is the card
 * that goes with them: the frame with the bar path drawn, what the lift was,
 * and the numbers as they stood when it was shared. Tapping the picture opens
 * it full size; when the clip itself may be watched, a second action plays
 * it. Shared by the athlete app (dark) and the desktop coach inbox (light),
 * like VideoMessageBubble.
 *
 * No judgement is printed. A number is what the coach chose to send; what
 * it means is the message beside it.
 */
import { useState } from 'react';
import { Mic, Play } from 'lucide-react';
import type { KinemosShare } from '../../lib/database.types';
import { formatDateShort, formatDateTimeShort, formatTime24 } from '../../lib/dateUtils';
import { kinemosObjectUrl } from '../../kinemos/lib/kinemosStorage';
import { ImageLightbox } from '../planner/ImageLightbox';
import { VideoLightbox } from '../planner/VideoLightbox';

const THEMES = {
  dark: {
    bubble: 'bg-gray-800 border border-gray-700',
    bubbleOwn: 'bg-[var(--color-accent)]',
    label: 'text-blue-300',
    labelOwn: 'text-white/90',
    text: 'text-gray-100',
    textOwn: 'text-white',
    muted: 'text-gray-400',
    mutedOwn: 'text-white/70',
    stamp: 'text-gray-400',
    stampOwn: 'text-white/60',
    chip: 'bg-gray-900/60 text-gray-100',
    chipOwn: 'bg-white/15 text-white',
  },
  light: {
    bubble: 'bg-[var(--color-bg-primary)] border border-[color:var(--color-border-secondary)]',
    bubbleOwn: 'bg-[var(--color-accent)]',
    label: 'text-[color:var(--color-text-secondary)]',
    labelOwn: 'text-white/90',
    text: 'text-[color:var(--color-text-primary)]',
    textOwn: 'text-white',
    muted: 'text-[color:var(--color-text-tertiary)]',
    mutedOwn: 'text-white/70',
    stamp: 'text-[color:var(--color-text-tertiary)]',
    stampOwn: 'text-white/60',
    chip: 'bg-[var(--color-bg-secondary)] text-[color:var(--color-text-primary)]',
    chipOwn: 'bg-white/15 text-white',
  },
} as const;

export function ShareMessageBubble({
  share,
  isOwn,
  senderLabel = null,
  theme,
  onOpen,
}: {
  share: KinemosShare;
  /** True when the viewer's side sent it — right-aligned, accent bubble. */
  isOwn: boolean;
  senderLabel?: string | null;
  theme: 'dark' | 'light';
  /** Fired when the picture or the clip is opened — the athlete app stamps
   *  athlete_read_at. */
  onOpen?: (share: KinemosShare) => void;
}) {
  const t = THEMES[theme];
  const [showing, setShowing] = useState<'image' | 'clip' | 'talkover' | null>(null);
  const s = share.summary;
  const imageUrl = share.asset_key ? kinemosObjectUrl(share.asset_key) : null;

  const what = [s.exerciseName ?? 'Lift', s.loadKg !== null ? `${num(s.loadKg, Number.isInteger(s.loadKg) ? 0 : 1)} kg` : null]
    .filter(Boolean)
    .join(' · ');
  const when = s.date ? formatDateShort(s.date) : null;
  const caption = [what, when, s.repIndex > 1 || s.label ? (s.label ?? `rep ${s.repIndex}`) : null]
    .filter(Boolean)
    .join(' · ');

  const numbers: Array<{ label: string; value: string }> = [];
  if (s.vmaxMs !== null) numbers.push({ label: 'Vmax', value: `${num(s.vmaxMs, 2)} m/s` });
  if (s.peakHeightCm !== null) numbers.push({ label: 'Height', value: `${num(s.peakHeightCm, 0)} cm` });
  if (s.grade) numbers.push({ label: 'Grade', value: s.grade });

  const open = (what: 'image' | 'clip' | 'talkover') => {
    setShowing(what);
    onOpen?.(share);
  };

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] px-2 py-2 rounded-lg ${isOwn ? t.bubbleOwn : t.bubble} ${isOwn ? t.textOwn : t.text}`}>
        {senderLabel && (
          <div className={`text-[10px] font-semibold mb-1 px-1 ${isOwn ? t.labelOwn : t.label}`}>{senderLabel}</div>
        )}
        <div className={`text-[10px] font-semibold uppercase tracking-wide px-1 mb-1 ${isOwn ? t.mutedOwn : t.muted}`}>
          Lift analysis
        </div>
        {imageUrl ? (
          <button
            type="button"
            onClick={() => open('image')}
            title={`Open ${caption}`}
            aria-label={`Open ${caption}`}
            className="relative block w-44 rounded-md overflow-hidden bg-black"
          >
            <img src={imageUrl} alt={caption} loading="lazy" className="block w-full h-auto" />
            <span className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-[10px] font-medium text-white bg-black/60 truncate text-left">
              {caption}
            </span>
          </button>
        ) : (
          <div className="px-1 text-[11px] font-medium">{caption}</div>
        )}
        {numbers.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 px-0.5">
            {numbers.map(n => (
              <span
                key={n.label}
                className={`inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 text-[11px] ${isOwn ? t.chipOwn : t.chip}`}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                <span className={`text-[9px] uppercase ${isOwn ? t.mutedOwn : t.muted}`}>{n.label}</span>
                <span className="font-semibold">{n.value}</span>
              </span>
            ))}
          </div>
        )}
        {(s.clipUrl || s.talkoverUrl) && (
          <div className="flex flex-wrap gap-x-3 mt-1.5">
            {s.talkoverUrl && (
              <button
                type="button"
                onClick={() => open('talkover')}
                className={`inline-flex items-center gap-1 px-1 text-[11px] font-medium ${isOwn ? t.textOwn : t.text} underline-offset-2 hover:underline`}
              >
                <Mic size={11} />
                Hear the coach
              </button>
            )}
            {s.clipUrl && (
              <button
                type="button"
                onClick={() => open('clip')}
                className={`inline-flex items-center gap-1 px-1 text-[11px] font-medium ${isOwn ? t.textOwn : t.text} underline-offset-2 hover:underline`}
              >
                <Play size={11} />
                Watch the clip
              </button>
            )}
          </div>
        )}
        <div className={`text-[9px] mt-1 px-1 text-right ${isOwn ? t.stampOwn : t.stamp}`}>{formatStamp(share.created_at)}</div>
      </div>
      {showing === 'image' && imageUrl && <ImageLightbox src={imageUrl} onClose={() => setShowing(null)} />}
      {showing === 'clip' && s.clipUrl && (
        <VideoLightbox src={s.clipUrl} caption={caption} onClose={() => setShowing(null)} />
      )}
      {showing === 'talkover' && s.talkoverUrl && (
        <VideoLightbox src={s.talkoverUrl} caption={`${caption} · talkover`} onClose={() => setShowing(null)} />
      )}
    </div>
  );
}

/** Comma decimals, as everywhere in EMOS. */
function num(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

/** Same-day: 24h time only; otherwise day-first date + 24h time — matches the
 *  message bubbles either side of it. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? formatTime24(d) : formatDateTimeShort(d);
}
