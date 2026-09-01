/**
 * LogVideoStrip — the clip strip for one logged exercise.
 *
 * Shared by every surface that shows training footage: the athlete's own
 * ExerciseLogCard (dark, can add and delete), coach Log mode (light,
 * read-only) and the coach mobile app (dark, read-only). Keeping one
 * component means the tile, the player and the set labelling can't drift
 * between the athlete's view of a clip and the coach's.
 *
 * Picking a file does not upload it straight away: on a browser that can
 * re-encode (see `clipEditingSupported`) every clip goes through `ClipEditor`
 * first, so the athlete sends the lift rather than the four minutes around it.
 * A clip that is too long or too big to upload at all cannot skip the editor —
 * that is the only way such a clip gets sent.
 */
import { useRef, useState } from 'react';
import { FolderPlus, Scissors, Trash2, Video } from 'lucide-react';
import type { TrainingLogVideo } from '../../lib/database.types';
import { formatDateTimeShort } from '../../lib/dateUtils';
import {
  LOG_VIDEO_MAX_BYTES,
  LOG_VIDEO_MAX_SECONDS,
  VideoTooLargeError,
} from '../../lib/videoLimits';
import { useClipEditor } from './useClipEditor';
import { VideoLightbox } from './VideoLightbox';
import { VideoThumb } from './VideoThumb';
import { Spinner } from '../ui';

interface LogVideoStripProps {
  videos: TrainingLogVideo[];
  theme: 'dark' | 'light';
  /** Provide to show the Film and Attach tiles. Omit for a read-only strip.
   *  Called once per file; a multi-file attach calls it repeatedly. */
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
  /** Which button is mid-upload, so the spinner lands on the one tapped. */
  const [busySource, setBusySource] = useState<'film' | 'attach' | null>(null);
  /** Sequential upload position, so a multi-file attach shows "2/5". */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A clip whose upload failed on size — offered back with a Trim & shrink
   *  button, because the fix is one edit away and re-picking the file is not. */
  const [oversized, setOversized] = useState<File | null>(null);
  const filmRef = useRef<HTMLInputElement | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  const clipEditor = useClipEditor({
    maxBytes: LOG_VIDEO_MAX_BYTES,
    maxSeconds: LOG_VIDEO_MAX_SECONDS,
  });

  if (videos.length === 0 && !onAdd) return null;

  /** Bridge from the two hidden file inputs into the upload loop. */
  const handleFiles = async (
    fileList: FileList | null,
    source: 'film' | 'attach',
  ) => {
    const ref = source === 'film' ? filmRef : attachRef;
    const files = Array.from(fileList ?? []);
    try {
      await uploadAll(files, source);
    } finally {
      // Clearing lets the same file be picked again after a failure — without
      // this the input's change event never refires for an identical pick.
      if (ref.current) ref.current.value = '';
    }
  };

  /**
   * Upload the picked files one at a time.
   *
   * Sequential rather than concurrent: gym wifi is the constraint, a parallel
   * burst of several clips tends to starve them all, and doing one at a time
   * means a failure names the file that failed and leaves the rest attached.
   */
  const uploadAll = async (files: File[], source: 'film' | 'attach', afterRejection = false) => {
    if (files.length === 0 || !onAdd) return;
    setError(null);
    setOversized(null);
    const failures: string[] = [];
    let skipped = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? { done: i, total: files.length } : null);
        // The editor runs outside the busy state: it *is* the athlete's turn,
        // and a spinner over a tile they are dragging handles on reads as a hang.
        const prepared = afterRejection
          ? await clipEditor.prepareAfterRejection(files[i])
          : await clipEditor.prepare(files[i]);
        if (!prepared) {
          skipped += 1;
          continue;
        }
        setBusySource(source);
        try {
          await onAdd(prepared);
        } catch (e) {
          if (e instanceof VideoTooLargeError && clipEditor.supported) setOversized(prepared);
          failures.push(`${files[i].name}: ${e instanceof Error ? e.message : 'upload failed'}`);
        } finally {
          setBusySource(null);
        }
      }
    } finally {
      setBusySource(null);
      setProgress(null);
    }
    const attempted = files.length - skipped;
    if (attempted > 0 && failures.length === attempted) {
      setError(attempted === 1 ? failures[0] : `None of the ${attempted} clips uploaded. ${failures[0]}`);
    } else if (failures.length > 0) {
      setError(`${failures.length} of ${attempted} failed — ${failures.join('; ')}`);
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
                  unreviewed ? 'ring-1 ring-[color:var(--color-accent)]' : ''
                }`}
              >
                {/* Stored/Stream JPEG when available; otherwise a lazy
                    <video> poster that only loads near the viewport. */}
                <VideoThumb video={v} />
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
            {/* Two inputs, because `capture` and `multiple` are mutually
                exclusive in practice: a phone honouring `capture` opens the
                camera and returns exactly one clip, ignoring `multiple`.
                Splitting them keeps the one-tap film-now path for the
                platform and still allows a batch attach from the roll. */}
            <input
              ref={filmRef}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={e => { void handleFiles(e.target.files, 'film'); }}
            />
            <input
              ref={attachRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={e => { void handleFiles(e.target.files, 'attach'); }}
            />
            <button
              type="button"
              disabled={disabled || busySource !== null}
              onClick={() => filmRef.current?.click()}
              title="Film a clip now"
              aria-label="Film a clip now"
              className={`w-[68px] h-[46px] rounded border border-dashed inline-flex flex-col items-center justify-center gap-0.5 text-[9px] ${t.addTile} disabled:opacity-50`}
            >
              {busySource === 'film' ? (
                <Spinner size={14} />
              ) : (
                <>
                  <Video size={13} strokeWidth={1.8} />
                  Film
                </>
              )}
            </button>
            <button
              type="button"
              disabled={disabled || busySource !== null}
              onClick={() => attachRef.current?.click()}
              title="Attach clips you already recorded (several at once)"
              aria-label="Attach existing clips"
              className={`w-[68px] h-[46px] rounded border border-dashed inline-flex flex-col items-center justify-center gap-0.5 text-[9px] ${t.addTile} disabled:opacity-50`}
            >
              {busySource === 'attach' ? (
                <>
                  <Spinner size={14} />
                  {progress && <span>{progress.done + 1}/{progress.total}</span>}
                </>
              ) : (
                <>
                  <FolderPlus size={13} strokeWidth={1.8} />
                  Attach
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* State the limit up front rather than reporting it after a failed
          upload — saves the athlete a trim-and-retry round trip. */}
      {onAdd && !error && (
        <p className={`mt-1 text-[10px] ${t.label}`}>
          {clipEditor.supported
            ? `Clips up to ${LOG_VIDEO_MAX_SECONDS} s — trimmed to the lift before sending.`
            : `Clips up to ${LOG_VIDEO_MAX_SECONDS} s.`}
        </p>
      )}
      {error && (
        <p className={`mt-1 text-[10px] ${t.error}`}>
          {error}
          {oversized && (
            <button
              type="button"
              onClick={() => { void uploadAll([oversized], 'attach', true); }}
              className="ml-1.5 underline underline-offset-2 inline-flex items-center gap-0.5"
            >
              <Scissors size={9} />
              Trim &amp; shrink
            </button>
          )}
        </p>
      )}

      {clipEditor.editor}

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
