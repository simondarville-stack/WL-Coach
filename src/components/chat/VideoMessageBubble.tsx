/**
 * VideoMessageBubble — a training clip rendered as a chat bubble.
 *
 * Session inbox threads interleave the session's clips with its messages by
 * timestamp, so a unit's footage and its discussion read as one conversation
 * (a coach's "📹 Snatch: …" comment lands right under the clip it answers).
 * Shared by the desktop CoachInbox (light theme) and the coach field app
 * (dark theme). Tapping the thumbnail opens the shared VideoLightbox; coach
 * surfaces pass onOpen to stamp coach_reviewed_at.
 */
import { useState } from 'react';
import type { TrainingLogVideo } from '../../lib/database.types';
import type { SessionVideoItem } from '../../lib/trainingLogService';
import { formatDateTimeShort, formatTime24 } from '../../lib/dateUtils';
import { isStreamPlaybackUrl, streamThumbnailUrl } from '../../lib/streamUploads';
import { VideoLightbox } from '../planner/VideoLightbox';

const THEMES = {
  dark: {
    bubble: 'bg-gray-800 border border-gray-700',
    bubbleOwn: 'bg-[var(--color-accent)]',
    label: 'text-blue-300',
    labelOwn: 'text-white/90',
    text: 'text-gray-100',
    textOwn: 'text-white',
    stamp: 'text-gray-400',
    stampOwn: 'text-white/60',
  },
  light: {
    bubble: 'bg-[var(--color-bg-primary)] border border-[color:var(--color-border-secondary)]',
    bubbleOwn: 'bg-[var(--color-accent)]',
    label: 'text-[color:var(--color-text-secondary)]',
    labelOwn: 'text-white/90',
    text: 'text-[color:var(--color-text-primary)]',
    textOwn: 'text-white',
    stamp: 'text-[color:var(--color-text-tertiary)]',
    stampOwn: 'text-white/60',
  },
} as const;

export function VideoMessageBubble({
  item,
  isOwn,
  senderLabel = null,
  theme,
  unreviewed = false,
  onOpen,
}: {
  item: SessionVideoItem;
  /** True when the viewer's side uploaded the clip — right-aligned. */
  isOwn: boolean;
  senderLabel?: string | null;
  theme: 'dark' | 'light';
  /** Accent-ring the thumbnail (coach surfaces, unwatched footage). */
  unreviewed?: boolean;
  /** Fired when the clip is opened — coach surfaces stamp coach_reviewed_at. */
  onOpen?: (video: TrainingLogVideo) => void;
}) {
  const t = THEMES[theme];
  const [playing, setPlaying] = useState(false);
  const v = item.video;

  const caption = [item.exerciseName ?? 'Clip', v.set_number != null ? `Set ${v.set_number}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] px-2 py-2 rounded-lg ${isOwn ? t.bubbleOwn : t.bubble} ${
          isOwn ? t.textOwn : t.text
        }`}
      >
        {senderLabel && (
          <div
            className={`text-[10px] font-semibold mb-1 px-1 ${isOwn ? t.labelOwn : t.label}`}
          >
            {senderLabel}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setPlaying(true);
            onOpen?.(v);
          }}
          title={`Play ${caption}`}
          aria-label={`Play ${caption}`}
          className={`relative block w-44 h-28 rounded-md overflow-hidden bg-black ${
            unreviewed ? 'ring-1 ring-[color:var(--color-accent)]' : ''
          }`}
        >
          {isStreamPlaybackUrl(v.video_url) ? (
            <img
              src={streamThumbnailUrl(v.video_url)}
              alt=""
              className="w-full h-full object-cover pointer-events-none"
            />
          ) : (
            /* #t=0.1 paints the frame at 0.1 s as a poster — the bubble shows
               the actual lift without stored thumbnails (same trick as
               LogVideoStrip). */
            <video
              src={`${v.video_url}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              className="w-full h-full object-cover pointer-events-none"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
            <span className="w-0 h-0 border-y-[8px] border-y-transparent border-l-[13px] border-l-white ml-1" />
          </span>
          <span className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-[10px] font-medium text-white bg-black/60 truncate text-left">
            {caption}
          </span>
        </button>
        {v.description && (
          <div className="text-[11px] mt-1 px-1 whitespace-pre-wrap break-words">
            {v.description}
          </div>
        )}
        <div className={`text-[9px] mt-1 px-1 text-right ${isOwn ? t.stampOwn : t.stamp}`}>
          {formatStamp(v.created_at)}
        </div>
      </div>
      {playing && (
        <VideoLightbox
          src={v.video_url}
          caption={caption}
          onClose={() => setPlaying(false)}
        />
      )}
    </div>
  );
}

/** Same-day: 24h time only; otherwise day-first date + 24h time — matches the
 *  message bubbles either side of it. */
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
