/**
 * ClipEditor — trim, crop and shrink a clip on the phone that filmed it,
 * before a byte of it goes over gym wifi.
 *
 * Opens between picking a file and uploading it. Three controls, in the order
 * an athlete cares about them:
 *
 *   1. **Trim** — drag two handles to the lift itself. This is the one that
 *      matters: a coach wants the pull and the catch, not the 90 s of chalk
 *      and setup around it, and where the caller sets `maxSeconds` it is what
 *      keeps a clip inside that cap. The editor tries to do this *for* the
 *      athlete: `clipMotion` looks for the burst of movement that is the lift
 *      and pre-sets the handles around it, so the common case is a glance and
 *      a tap rather than two drags. The suggestion is always visible, always
 *      draggable, and one tap of "Whole clip" undoes it.
 *   2. **Crop** — drag a box onto the lifter. A phone filmed across a busy
 *      platform spends most of its pixels on other people.
 *   3. **Size** — a resolution ceiling. 4K of a barbell reviews no better than
 *      1080p and uploads four times slower.
 *
 * The editor is also the recovery path when a clip is too long or too large to
 * upload at all: it opens by itself, says why, and withholds "Upload original".
 *
 * Nothing here touches the source file — `applyClipEdit` returns a new File and
 * the caller decides what to upload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crop, Scissors, Split, Wand2, X } from 'lucide-react';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';
import { Spinner } from '../ui';

import {
  applyClipEdit,
  CLIP_RESOLUTIONS,
  ClipEditCanceledError,
  FULL_FRAME,
  isNoopEdit,
  outputDimensions,
  type ClipEdit,
  type ClipResolution,
} from '../../lib/videoClipEdit';
import {
  analyseClipMotion,
  findLifts,
  type LiftSegment,
  type MotionSample,
} from '../../lib/clipMotion';
import {
  clampCropToFrame,
  CROP_RATIOS,
  fitCropToRatio,
  moveCrop,
  ratioInFractionSpace,
  resizeCrop,
  type CropHandle,
} from '../../lib/clipCropGeometry';
import { readKeyframeTimes, snapToKeyframe } from '../../lib/losslessTrim';

interface ClipEditorProps {
  file: File;
  /**
   * Why the editor opened unasked ("Clip is 2:14 long — the limit is 60 s").
   * Null when the athlete asked for it.
   */
  reason?: string | null;
  /** When true the original cannot be uploaded, so no escape hatch is shown. */
  mustEdit?: boolean;
  /**
   * Whether this surface can take more than one clip back. True for the
   * training-log strip, which attaches a list; false for the surfaces that
   * store exactly one video against one row, where a split would have the
   * pieces overwrite each other.
   */
  allowSplit?: boolean;
  /** Resolution ceiling to open on. The caller sets one when the clip is too
   *  large to send, so the editor starts on a setting that actually fixes it. */
  defaultMaxEdge?: ClipResolution;
  /**
   * Hard cap on the trimmed length, enforced by the handles themselves. Null
   * for the surfaces that have no duration cap — a coach's technique demo or a
   * whole competition attempt is legitimately longer than a single lift.
   */
  maxSeconds?: number | null;
  /** Byte cap of the destination, when the caller knows one. Drives the
   *  kept-size readout in lossless mode — on long footage the byte cap binds
   *  long before any duration cap does. */
  maxBytes?: number | null;
  /**
   * Trim-only edits become a keyframe-aligned lossless packet copy (see
   * `applyClipEdit`). The editor then snaps the start handle to the keyframe
   * the cut will actually land on, and shows an honest kept-size estimate —
   * a copy's size is proportional to the kept time, unlike a re-encode's.
   */
  preferLossless?: boolean;
  onCancel: () => void;
  /**
   * Receives the edited files — or the original, if it was uploaded as is.
   * Always at least one; more only when a multi-lift clip was split and the
   * caller set `allowSplit`.
   */
  onDone: (files: File[]) => void;
}

/** Comma decimals, per the app's numeric conventions. */
const secs = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1).replace('.', ',')} s`;
const megabytes = (bytes: number) =>
  `${(Math.round((bytes / 1024 / 1024) * 10) / 10).toFixed(1).replace('.', ',')} MB`;

type Drag =
  | { kind: 'trim-start' | 'trim-end' | 'seek' }
  | { kind: 'crop-move'; grabX: number; grabY: number }
  | { kind: 'crop-resize'; handle: CropHandle };

export function ClipEditor({
  file,
  reason,
  mustEdit = false,
  allowSplit = false,
  defaultMaxEdge = null,
  maxSeconds = null,
  maxBytes = null,
  preferLossless = false,
  onCancel,
  onDone,
}: ClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const src = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  const [duration, setDuration] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  /** Rendered size of the stage, so the frame box can be laid out exactly and
   *  pointer positions can be mapped back into frame fractions. */
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [mode, setMode] = useState<'trim' | 'crop'>('trim');
  const [edit, setEdit] = useState<ClipEdit>({
    start: 0,
    end: 0,
    crop: null,
    maxEdge: defaultMaxEdge,
  });
  /** Mirrors `edit` for the pointer handlers, which need the live value while
   *  a drag is in flight and must stay free of side effects inside setState. */
  const editRef = useRef(edit);
  editRef.current = edit;
  const [ratio, setRatio] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  /** Motion signal for the whole clip, once the analysis pass finishes. */
  const [motion, setMotion] = useState<MotionSample[] | null>(null);
  /** Every lift the analysis could defend, in time order. */
  const [lifts, setLifts] = useState<LiftSegment[]>([]);
  /** True once the handles have been set from `lifts` — the "Lift found" state. */
  const [suggested, setSuggested] = useState(false);
  /** Emit one clip per lift instead of one clip for the selected window. */
  const [splitMode, setSplitMode] = useState(false);
  /**
   * Set the moment the athlete moves a handle. A suggestion that arrives after
   * that is discarded rather than yanking the window out from under them —
   * the analysis takes seconds on a long clip, and they may well have trimmed
   * it by hand in the meantime.
   */
  const touchedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Keyframe times of the source, loaded only in lossless mode — a packet
   *  copy can only cut at a keyframe, so the start handle snaps to them
   *  rather than promising a cut the file cannot make. Ref, not state: only
   *  the pointer-up handler reads it. */
  const keyframesRef = useRef<number[] | null>(null);
  useEffect(() => {
    keyframesRef.current = null;
    if (!preferLossless) return;
    let alive = true;
    void readKeyframeTimes(file)
      .then(times => {
        if (alive) keyframesRef.current = times;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [file, preferLossless]);

  const frameAspect = frame ? frame.w / frame.h : 1;
  const fractionRatio = ratio == null ? null : ratioInFractionSpace(ratio, frameAspect);

  // ── Source metadata ──────────────────────────────────────────────────────
  const handleMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    setFrame({ w: v.videoWidth || 1, h: v.videoHeight || 1 });
    // Pre-trim an over-length clip to a legal window rather than opening on a
    // selection that cannot be uploaded — the athlete then only has to slide
    // it onto the lift, not fix it first.
    setEdit(e => ({ ...e, start: 0, end: maxSeconds == null ? d : Math.min(d, maxSeconds) }));
    setPlayhead(0);
  };

  /**
   * The clip would not open for preview — an exotic container, or a codec this
   * browser cannot decode.
   *
   * Worth handling rather than leaving the editor stuck on a disabled button:
   * without a duration there is nothing to trim against, so say so and hand
   * back whatever route is still open. A clip that also *cannot* be uploaded
   * as it is has no route left in the browser, and saying that plainly beats
   * an editor that silently never becomes usable.
   */
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (duration != null) return;
    const timer = window.setTimeout(() => setUnreadable(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [duration]);

  // ── Stage measurement ────────────────────────────────────────────────────
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The letterboxed rectangle the video actually occupies inside the stage.
   *  Computed rather than left to `object-fit`, because the crop overlay has
   *  to sit exactly on it. */
  const box = useMemo(() => {
    if (!frame || stage.w === 0 || stage.h === 0) return null;
    const scale = Math.min(stage.w / frame.w, stage.h / frame.h);
    const w = frame.w * scale;
    const h = frame.h * scale;
    return { left: (stage.w - w) / 2, top: (stage.h - h) / 2, w, h };
  }, [frame, stage]);

  // ── Playback: loop the selection so the athlete previews the actual output ─
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        if (v.currentTime >= edit.end - 0.02) v.currentTime = edit.start;
        setPlayhead(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, edit.start, edit.end]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setPlayhead(t);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (v.currentTime < edit.start || v.currentTime >= edit.end - 0.02) v.currentTime = edit.start;
      void v.play().then(() => setPlaying(true)).catch(() => undefined);
    }
  };

  // ── Find the lift ────────────────────────────────────────────────────────
  // Runs independently of the <video> preview: the analysis decodes the file
  // itself and needs no metadata from the element. A failure is silent — the
  // editor is fully usable by hand, and an error banner about a *suggestion*
  // would be noise.
  useEffect(() => {
    const controller = new AbortController();
    analyseClipMotion(file, { signal: controller.signal })
      .then(samples => {
        if (!controller.signal.aborted) setMotion(samples);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMotion([]);
      });
    return () => controller.abort();
  }, [file]);

  useEffect(() => {
    if (!motion || motion.length === 0 || duration == null) return;
    if (touchedRef.current || suggested) return;
    const found = findLifts(motion, { duration, maxSeconds });
    if (found.length === 0) {
      // No clear burst: leave the handles where they are and say nothing. A
      // wrong suggestion costs more than a missing one.
      setMotion([]);
      return;
    }
    setLifts(found);
    setSuggested(true);
    // The handles go to the strongest lift. A set of singles is offered as a
    // split instead, but the window still has to mean something if the
    // athlete ignores that and just hits send.
    const best = found.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    setEdit(e => ({ ...e, start: best.start, end: best.end }));
    seek(best.start);
  }, [motion, duration, maxSeconds, suggested, seek]);

  /** Back to the whole clip (or the longest legal window). Also marks the
   *  handles touched, so the suggestion cannot reapply itself. */
  const clearSuggestion = () => {
    if (duration == null) return;
    touchedRef.current = true;
    setSuggested(false);
    setSplitMode(false);
    setLifts([]);
    setEdit(e => ({
      ...e,
      start: 0,
      end: maxSeconds == null ? duration : Math.min(duration, maxSeconds),
    }));
    seek(0);
  };

  /** Clips the export will produce: one per lift in split mode, otherwise the
   *  single window under the handles. */
  const exportRanges: { start: number; end: number }[] =
    splitMode && lifts.length > 1
      ? lifts.map(l => ({ start: l.start, end: l.end }))
      : [{ start: edit.start, end: edit.end }];

  // ── Pointer dragging (trim handles and crop box share one pipeline) ───────
  const applyDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag || duration == null) return;

      if (drag.kind === 'crop-move' || drag.kind === 'crop-resize') {
        if (!box) return;
        const fx = (clientX - (stageRef.current?.getBoundingClientRect().left ?? 0) - box.left) / box.w;
        const fy = (clientY - (stageRef.current?.getBoundingClientRect().top ?? 0) - box.top) / box.h;
        setEdit(e => {
          const current = e.crop ?? FULL_FRAME;
          if (drag.kind === 'crop-move') {
            return {
              ...e,
              crop: moveCrop(current, fx - drag.grabX - current.x, fy - drag.grabY - current.y),
            };
          }
          return { ...e, crop: resizeCrop(current, drag.handle, fx, fy, fractionRatio) };
        });
        return;
      }

      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const t = Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
      if (drag.kind === 'seek') {
        if (playing) videoRef.current?.pause();
        setPlaying(false);
        seek(t);
        return;
      }
      // Computed from a ref rather than inside the updater: seeking the
      // preview is a side effect, and React may call an updater twice.
      const e = editRef.current;
      if (drag.kind === 'trim-start') {
        const start = Math.max(0, Math.min(t, e.end - 0.2));
        // The window can never exceed the upload cap, so the handles
        // themselves enforce it and no upload can fail on length.
        const end = maxSeconds == null ? e.end : Math.min(e.end, start + maxSeconds);
        setEdit({ ...e, start, end });
        seek(start);
      } else {
        const end = Math.min(duration, Math.max(t, e.start + 0.2));
        const start = maxSeconds == null ? e.start : Math.max(e.start, end - maxSeconds);
        setEdit({ ...e, start, end });
        seek(end);
      }
    },
    [box, duration, fractionRatio, maxSeconds, playing, seek],
  );

  useEffect(() => {
    const move = (ev: PointerEvent) => {
      if (dragRef.current) applyDrag(ev.clientX, ev.clientY);
    };
    const up = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      // Lossless mode: on release, land the start handle where the packet
      // copy will actually cut — the keyframe at or before it. Snapping on
      // release rather than during the drag keeps the drag itself smooth.
      if (drag?.kind === 'trim-start' && keyframesRef.current) {
        const e = editRef.current;
        const snapped = snapToKeyframe(keyframesRef.current, e.start);
        if (snapped !== e.start) {
          const end = maxSeconds == null ? e.end : Math.min(e.end, snapped + maxSeconds);
          setEdit({ ...e, start: snapped, end });
          seek(snapped);
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [applyDrag, maxSeconds, seek]);

  const startDrag = (drag: Drag) => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    // Grabbing a handle is the moment the athlete takes over, so record it
    // here rather than once the drag has produced a new value — a grab that
    // lands before the track has laid out still counts. Scrubbing the
    // timeline deliberately does not: that is looking, not trimming, and a
    // suggestion is still welcome afterwards.
    if (drag.kind === 'trim-start' || drag.kind === 'trim-end') touchedRef.current = true;
    dragRef.current = drag;
    applyDrag(ev.clientX, ev.clientY);
  };

  // ── Crop mode helpers ────────────────────────────────────────────────────
  const crop = edit.crop;

  const enterCropMode = () => {
    setMode('crop');
    // Open on a generous box rather than the full frame: a crop box that sits
    // exactly on the edges reads as "no crop" and gives nothing to grab.
    if (!edit.crop) {
      setEdit(e => ({ ...e, crop: clampCropToFrame({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }) }));
    }
  };

  const pickRatio = (r: number | null) => {
    setRatio(r);
    setEdit(e => ({
      ...e,
      crop: fitCropToRatio(e.crop ?? FULL_FRAME, r == null ? null : ratioInFractionSpace(r, frameAspect)),
    }));
  };

  // ── Export ───────────────────────────────────────────────────────────────
  const selection = edit.end - edit.start;
  const out = frame ? outputDimensions(edit, frame.w, frame.h) : null;
  const unchanged = duration != null && isNoopEdit(edit, duration);

  /**
   * Kept-size estimate, shown only when the edit will be a lossless packet
   * copy — there the output size is simply the kept fraction of the source,
   * while a re-encode's size is unknowable until it runs. On long footage the
   * byte cap binds long before any duration cap, so this is the number that
   * tells the coach whether the import will clear it.
   */
  const losslessEstimate =
    preferLossless && edit.crop == null && edit.maxEdge == null && duration != null && duration > 0
      ? file.size *
        ((splitMode
          ? exportRanges.reduce((sum, r) => sum + (r.end - r.start), 0)
          : selection) /
          duration)
      : null;
  const estimateOverCap =
    losslessEstimate != null && maxBytes != null && losslessEstimate > maxBytes;

  const handleApply = async () => {
    if (duration == null) return;
    if (unchanged && !splitMode) {
      // Only reachable when the original was uploadable all along — a
      // must-edit clip keeps the button disabled until something changes.
      onDone([file]);
      return;
    }
    setError(null);
    setProgress(0);
    videoRef.current?.pause();
    setPlaying(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const out: File[] = [];
      for (let i = 0; i < exportRanges.length; i++) {
        const range = exportRanges[i];
        const edited = await applyClipEdit(
          file,
          { ...edit, start: range.start, end: range.end },
          {
            // One bar across the whole job, so splitting three lifts reads as
            // one wait rather than three that keep restarting.
            onProgress: p => setProgress((i + p) / exportRanges.length),
            signal: controller.signal,
            part: exportRanges.length > 1 ? i + 1 : undefined,
            preferLossless,
          },
        );
        out.push(edited);
      }
      onDone(out);
    } catch (e) {
      if (e instanceof ClipEditCanceledError) {
        setProgress(null);
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not process this clip.');
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  };

  const busy = progress != null;
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : '0%');

  return (
    <AdaptiveDialog
      onClose={busy ? () => undefined : onCancel}
      panel="bare"
      variant="media"
      dismiss="guarded"
      dirty
      ariaLabel="Trim and crop clip"
    >
      <div className="flex flex-col w-[min(96vw,720px)] max-h-[92vh] bg-gray-900 text-gray-100 rounded-lg overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide">Trim &amp; crop</div>
            <div className="text-[10px] text-gray-400 truncate">
              {file.name} · {megabytes(file.size)}
            </div>
          </div>
          {/* Labelled "Close editor", not "Cancel": the footer already has a
              Cancel, and two controls sharing an accessible name is a
              screen-reader coin toss. */}
          <button
            type="button"
            onClick={busy ? () => abortRef.current?.abort() : onCancel}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            aria-label={busy ? 'Cancel processing' : 'Close editor'}
          >
            <X size={16} />
          </button>
        </div>

        {reason && (
          <p className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
            {reason}
          </p>
        )}

        {/* Stage */}
        <div ref={stageRef} className="relative flex-1 min-h-[180px] bg-black overflow-hidden">
          <video
            ref={videoRef}
            src={src}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={handleMetadata}
            onError={() => setUnreadable(true)}
            onClick={togglePlay}
            className="absolute"
            style={
              box
                ? { left: box.left, top: box.top, width: box.w, height: box.h }
                : { inset: 0, width: '100%', height: '100%' }
            }
          />

          {mode === 'crop' && box && crop && (
            <div
              className="absolute"
              style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
            >
              {/* Dim everything outside the crop so the framing reads at a glance. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  boxShadow: 'inset 0 0 0 9999px rgba(0,0,0,0.55)',
                  clipPath: `polygon(0% 0%, 0% 100%, ${crop.x * 100}% 100%, ${crop.x * 100}% ${crop.y * 100}%, ${(crop.x + crop.w) * 100}% ${crop.y * 100}%, ${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%, ${crop.x * 100}% ${(crop.y + crop.h) * 100}%, ${crop.x * 100}% 100%, 100% 100%, 100% 0%)`,
                }}
              />
              <div
                role="group"
                aria-label="Crop area"
                onPointerDown={ev => {
                  if (!box) return;
                  const rect = stageRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const fx = (ev.clientX - rect.left - box.left) / box.w;
                  const fy = (ev.clientY - rect.top - box.top) / box.h;
                  startDrag({ kind: 'crop-move', grabX: fx - crop.x, grabY: fy - crop.y })(ev);
                }}
                className="absolute border border-white/90 cursor-move touch-none"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
              >
                {/* Thirds guides — the standard framing aid, and here also the
                    quickest way to centre a lifter in the box. */}
                <div className="absolute inset-0 pointer-events-none opacity-40">
                  <div className="absolute top-1/3 left-0 right-0 border-t border-white" />
                  <div className="absolute top-2/3 left-0 right-0 border-t border-white" />
                  <div className="absolute left-1/3 top-0 bottom-0 border-l border-white" />
                  <div className="absolute left-2/3 top-0 bottom-0 border-l border-white" />
                </div>
                {(['nw', 'ne', 'sw', 'se'] as CropHandle[]).map(h => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Resize crop ${h}`}
                    onPointerDown={startDrag({ kind: 'crop-resize', handle: h })}
                    // Generous 28px targets: this is dragged with a thumb, and
                    // the visible dot stays small so it doesn't hide the lifter.
                    className="absolute w-7 h-7 -m-3.5 rounded-full touch-none flex items-center justify-center"
                    style={{
                      left: h === 'nw' || h === 'sw' ? 0 : '100%',
                      top: h === 'nw' || h === 'ne' ? 0 : '100%',
                    }}
                  >
                    <span className="w-3 h-3 rounded-full bg-white border border-gray-900" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-2">
              <Spinner size={22} />
              <div className="w-40 h-1 rounded bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-[color:var(--color-accent)] transition-[width] duration-150"
                  style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-300">
                Processing {Math.round((progress ?? 0) * 100)}%
              </p>
            </div>
          )}
        </div>

        {/* Timeline — always visible: it is the control that matters most. */}
        <div className="px-3 pt-2.5 shrink-0">
          <div
            ref={trackRef}
            className="relative h-9 rounded bg-gray-800 touch-none select-none"
            onPointerDown={startDrag({ kind: 'seek' })}
          >
            {/* Every detected lift, faint, so a set of singles reads as a set
                even before the split is taken. */}
            {lifts.length > 1 &&
              lifts.map((lift, i) => (
                <div
                  key={`${lift.start}-${i}`}
                  className="absolute inset-y-0 bg-[color:var(--color-accent)]/20 border-x border-[color:var(--color-accent)]/50"
                  style={{ left: pct(lift.start), width: pct(lift.end - lift.start) }}
                >
                  {splitMode && (
                    <span className="absolute top-0.5 left-1 text-[8px] font-semibold text-white/80">
                      {i + 1}
                    </span>
                  )}
                </div>
              ))}
            {/* The window under the handles. Hidden in split mode, where the
                bands above are what gets exported. */}
            {!splitMode && (
              <div
                className="absolute inset-y-0 bg-[color:var(--color-accent)]/25 border-x-2 border-[color:var(--color-accent)]"
                style={{ left: pct(edit.start), width: pct(edit.end - edit.start) }}
              />
            )}
            <div
              className="absolute inset-y-0 w-0.5 bg-white pointer-events-none"
              style={{ left: pct(playhead) }}
            />
            {!splitMode &&
              (['trim-start', 'trim-end'] as const).map(kind => (
                <button
                  key={kind}
                  type="button"
                  aria-label={kind === 'trim-start' ? 'Trim start' : 'Trim end'}
                  onPointerDown={startDrag({ kind })}
                  className="absolute inset-y-0 w-7 -ml-3.5 touch-none flex items-center justify-center"
                  style={{ left: pct(kind === 'trim-start' ? edit.start : edit.end) }}
                >
                  <span className="w-1.5 h-6 rounded-full bg-[color:var(--color-accent)] border border-white/70" />
                </button>
              ))}
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-gray-400">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={togglePlay}
                disabled={busy}
                className="px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500 hover:text-white disabled:opacity-50"
              >
                {playing ? 'Pause' : 'Play selection'}
              </button>
              {/* The suggestion states itself and offers its own undo. Silent
                  auto-trimming would be the worst of both: the athlete would
                  not know why the handles moved, or how to get the rest back. */}
              {suggested ? (
                <>
                  <span className="inline-flex items-center gap-0.5 text-[color:var(--color-accent)]">
                    <Wand2 size={10} />
                    {lifts.length > 1 ? `${lifts.length} lifts found` : 'Lift found'}
                  </span>
                  {/* Offered only where the caller can take a list back. On a
                      surface storing one video per row the pieces would
                      overwrite each other. */}
                  {allowSplit && lifts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSplitMode(v => !v)}
                      disabled={busy}
                      className={`px-1.5 py-0.5 rounded border disabled:opacity-50 ${
                        splitMode
                          ? 'border-[color:var(--color-accent)] text-white'
                          : 'border-gray-700 hover:border-gray-500 hover:text-white'
                      }`}
                    >
                      <Split size={9} className="inline -mt-0.5 mr-0.5" />
                      {splitMode ? `Splitting into ${lifts.length}` : `Split into ${lifts.length}`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearSuggestion}
                    disabled={busy}
                    className="px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500 hover:text-white disabled:opacity-50"
                  >
                    Whole clip
                  </button>
                </>
              ) : (
                motion === null && <span className="text-gray-500">Finding the lift…</span>
              )}
            </div>
            {splitMode ? (
              <span>
                <span className="text-gray-200">{lifts.length} clips</span> ·{' '}
                {secs(exportRanges.reduce((sum, r) => sum + (r.end - r.start), 0))}
                {duration != null && <> of {secs(duration)}</>}
                {losslessEstimate != null && (
                  <span
                    className={estimateOverCap ? 'text-red-400' : undefined}
                    title={
                      estimateOverCap && maxBytes != null
                        ? `Over the ${Math.round(maxBytes / 1024 / 1024)} MB limit — trim tighter.`
                        : 'Estimated size of the lossless copy.'
                    }
                  >
                    {' '}
                    · ≈{megabytes(losslessEstimate)}
                  </span>
                )}
              </span>
            ) : (
              <span>
                {secs(edit.start)} → {secs(edit.end)} ·{' '}
                <span
                  className={
                    maxSeconds != null && selection > maxSeconds ? 'text-red-400' : 'text-gray-200'
                  }
                >
                  {secs(selection)}
                </span>
                {duration != null && <> of {secs(duration)}</>}
                {losslessEstimate != null && (
                  <span
                    className={estimateOverCap ? 'text-red-400' : undefined}
                    title={
                      estimateOverCap && maxBytes != null
                        ? `Over the ${Math.round(maxBytes / 1024 / 1024)} MB limit — trim tighter.`
                        : 'Estimated size of the lossless copy.'
                    }
                  >
                    {' '}
                    · ≈{megabytes(losslessEstimate)}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Mode switch + per-mode controls */}
        <div className="px-3 pt-2 shrink-0">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'trim' as const, label: 'Trim', Icon: Scissors },
                { id: 'crop' as const, label: 'Crop', Icon: Crop },
              ]
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={busy || (id === 'trim' && splitMode)}
                onClick={() => (id === 'crop' ? enterCropMode() : setMode('trim'))}
                className={`px-2 py-1 rounded text-[11px] inline-flex items-center gap-1 border disabled:opacity-50 ${
                  mode === id
                    ? 'border-[color:var(--color-accent)] text-white bg-[color:var(--color-accent)]/20'
                    : 'border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
            {mode === 'crop' && crop && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEdit(e => ({ ...e, crop: null }));
                  setRatio(null);
                  setMode('trim');
                }}
                className="ml-auto px-2 py-1 rounded text-[11px] border border-gray-700 text-gray-400 hover:text-white disabled:opacity-50"
              >
                Whole frame
              </button>
            )}
          </div>

          {mode === 'crop' && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              <span className="text-[10px] text-gray-500 mr-0.5">Ratio</span>
              {CROP_RATIOS.map(r => (
                <button
                  key={r.label}
                  type="button"
                  disabled={busy}
                  onClick={() => pickRatio(r.ratio)}
                  className={`px-1.5 py-0.5 rounded text-[10px] border disabled:opacity-50 ${
                    ratio === r.ratio
                      ? 'border-[color:var(--color-accent)] text-white'
                      : 'border-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <span className="text-[10px] text-gray-500 mr-0.5">Size</span>
            {CLIP_RESOLUTIONS.map(r => (
              <button
                key={r.label}
                type="button"
                disabled={busy}
                onClick={() => setEdit(e => ({ ...e, maxEdge: r.maxEdge as ClipResolution }))}
                className={`px-1.5 py-0.5 rounded text-[10px] border disabled:opacity-50 ${
                  edit.maxEdge === r.maxEdge
                    ? 'border-[color:var(--color-accent)] text-white'
                    : 'border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
            {out && (
              <span className="ml-auto text-[10px] text-gray-500 tabular-nums">
                {out.width}×{out.height}
              </span>
            )}
          </div>
        </div>

        {unreadable && duration == null && (
          <p className="px-3 pt-2 text-[11px] text-amber-300 shrink-0">
            {mustEdit
              ? 'This browser cannot open the clip, so it cannot be trimmed here — shorten it in your phone\u2019s gallery app and attach it again.'
              : 'This browser cannot open the clip for editing. You can still upload it as it is.'}
          </p>
        )}
        {error && <p className="px-3 pt-2 text-[11px] text-red-400 shrink-0">{error}</p>}

        {/* Footer */}
        <div className="flex items-center gap-2 px-3 py-2.5 mt-2 border-t border-gray-800 shrink-0">
          {!mustEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDone([file])}
              className="px-2.5 py-1.5 rounded text-[11px] border border-gray-700 text-gray-300 hover:text-white disabled:opacity-50"
            >
              Upload original
            </button>
          )}
          <button
            type="button"
            onClick={busy ? () => abortRef.current?.abort() : onCancel}
            className="px-2.5 py-1.5 rounded text-[11px] border border-gray-700 text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              busy ||
              duration == null ||
              (!splitMode && maxSeconds != null && selection > maxSeconds) ||
              (mustEdit && unchanged && !splitMode)
            }
            onClick={() => void handleApply()}
            title={
              mustEdit && unchanged && !splitMode
                ? 'Trim, crop or drop the size to send this clip'
                : undefined
            }
            className="ml-auto px-3 py-1.5 rounded text-[11px] font-semibold inline-flex items-center gap-1.5 bg-[color:var(--color-accent)] text-white disabled:opacity-50"
          >
            <Check size={13} />
            {splitMode
              ? `Save & upload ${lifts.length} clips`
              : unchanged
                ? 'Upload'
                : 'Save & upload'}
          </button>
        </div>
      </div>
    </AdaptiveDialog>
  );
}
