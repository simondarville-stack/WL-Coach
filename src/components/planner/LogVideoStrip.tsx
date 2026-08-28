/**
 * LogVideoStrip — the clip strip for one logged exercise.
 *
 * Shared by every surface that shows training footage: the athlete's own
 * ExerciseLogCard (dark, can add and delete), coach Log mode (light,
 * read-only) and the coach mobile app (dark, read-only). Keeping one
 * component means the tile, the player and the set labelling can't drift
 * between the athlete's view of a clip and the coach's.
 */
import { useRef, useState } from 'react';
import { Trash2, Video } from 'lucide-react';
import type { TrainingLogVideo } from '../../lib/database.types';
import { formatDateTimeShort } from '../../lib/dateUtils';
import { VideoLightbox } from './VideoLightbox';

interface LogVideoStripProps {
  videos: TrainingLogVideo[];
  theme: 'dark' | 'light';
  /** Provide to show the record/attach tile. Omit for a read-only strip. */
  onAdd?: (file: File) => Promise<void>;
  /** Provide to show a delete affordance on each clip. */
  onDelete?: (video: TrainingLogVideo) => void;
  /** Fired when a clip is opened — the coach surfaces use it to stamp
   *  coach_reviewed_at. */
  onOpen?: (video: TrainingLogVideo) => void;
  /** Ring an unreviewed clip so new footage is findable at a glance.
   *  Only meaningful on coach surfaces. */
  highlightUnreviewed?: boolean;
  /** Disable the add tile while a session-level save is in flight. */
  disabled?: boolean;
}

const THEMES = {
  dark: {
    tile: 'border-gray-700 bg-gray-800',
    addTile: 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500',
    label: 'text-gray-400',
    error: 'text-red-400',
  },
  light: {
    tile: 'border-gray-200 bg-gray-50',
    addTile: 'border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400',
    label: 'text-gray-500',
    error: 'text-red-600',
  },
} as const;

function captionFor(v: TrainingLogVideo): string {
  const set = v.set_number != null ? `Set ${v.set_number}` : 'Clip';
  return `${set} · ${formatDateTimeShort(v.created_at)}`;
}

export function LogVideoStrip({
  videos,
  theme,
  onAdd,
  onDelete,
  onOpen,
  highlightUnreviewed = false,
  disabled = false,
}: LogVideoStripProps) {
  const t = THEMES[theme];
  const [playing, setPlaying] = useState<TrainingLogVideo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (videos.length === 0 && !onAdd) return null;

  const handleFile = async (file: File | undefined) => {
    if (!file || !onAdd) return;
    setError(null);
    setUploading(true);
    try {
      await onAdd(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
      // Clearing lets the same file be picked again after a failure —
      // without this the input's change event never refires.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const open = (v: TrainingLogVideo) => {
    setPlaying(v);
    onOpen?.(v);
  };

  return (
    <div className="pt-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {videos.map(v => {
          const unreviewed = highlightUnreviewed && v.coach_reviewed_at === null;
          return (
            <div key={v.id} className="relative group">
              <button
                type="button"
                onClick={() => open(v)}
                title={captionFor(v)}
                aria-label={`Play ${captionFor(v)}`}
                className={`relative block w-[68px] h-[46px] rounded overflow-hidden border ${t.tile} ${
                  unreviewed ? 'ring-1 ring-blue-500' : ''
                }`}
              >
                {/* The #t=0.1 media fragment makes the browser paint the frame
                    at 0.1 s as a poster, so the strip shows the actual lift
                    without us generating and storing thumbnails. */}
                <video
                  src={`${v.video_url}#t=0.1`}
                  preload="metadata"
                  muted
                  playsInline
                  tabIndex={-1}
                  className="w-full h-full object-cover pointer-events-none"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <span className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-white ml-0.5" />
                </span>
                {v.set_number != null && (
                  <span className="absolute bottom-0 left-0 px-1 text-[9px] font-semibold text-white bg-black/60 rounded-tr">
                    S{v.set_number}
                  </span>
                )}
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(v)}
                  aria-label={`Delete ${captionFor(v)}`}
                  title="Delete clip"
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-gray-900 text-gray-400 border border-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })}

        {onAdd && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              // `capture` makes a phone offer the camera first, which is what
              // an athlete standing on the platform actually wants. Desktop
              // browsers ignore it and show the file picker.
              capture="environment"
              className="hidden"
              onChange={e => { void handleFile(e.target.files?.[0]); }}
            />
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
              className={`w-[68px] h-[46px] rounded border border-dashed inline-flex flex-col items-center justify-center gap-0.5 text-[9px] ${t.addTile} disabled:opacity-50`}
            >
              {uploading ? (
                <span className="w-3.5 h-3.5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
              ) : (
                <>
                  <Video size={13} strokeWidth={1.8} />
                  Video
                </>
              )}
            </button>
          </>
        )}
      </div>

      {error && <p className={`mt-1 text-[10px] ${t.error}`}>{error}</p>}

      {playing && (
        <VideoLightbox
          src={playing.video_url}
          caption={captionFor(playing)}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
