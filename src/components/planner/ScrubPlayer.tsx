/**
 * ScrubPlayer — the technique-review video player.
 *
 * Interaction model borrowed from the playback apps lifters already use
 * (and the iPhone Photos scrubber):
 *   - tap anywhere toggles play/pause — no big play button over the lifter
 *   - hold and drag horizontally to scrub, finger-on-film style. The drag is
 *     deliberately low-geared (SCRUB_PX_PER_SECOND: a full phone width ≈ 2 s
 *     of footage, one 30 fps frame ≈ 7 px of travel), because what a coach
 *     examines in detail is about one second of real life — the pull,
 *     turnover and catch spread across the whole screen width
 *   - after a scrub the clip stays paused on the parked frame; tap resumes
 *   - slow motion: a speed chip cycles 1× → ½× → ¼×
 *   - pinch with two fingers to zoom (up to 5×) and pan, phone-style; one
 *     finger keeps meaning tap/scrub, so a coach zooms into the bar path
 *     and then walks it frame by frame. The zoom chip resets to 1×.
 *   - fullscreen with every gesture intact: native element fullscreen where
 *     the platform allows it, a fixed full-viewport overlay on iPhone
 *     (Safari there only offers its own video player, which would lose the
 *     scrub/zoom gestures)
 *   - desktop: Space toggles, ←/→ step one frame (~1/30 s)
 *
 * Vertical gestures pass through (touch-action: pan-y), so the review reel
 * still snap-scrolls with the player under the finger. Chrome is minimal:
 * a thin progress bar, a small paused glyph, a mute toggle, and a time
 * readout while scrubbing.
 */
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Play, Volume2, VolumeX } from 'lucide-react';

/** Scrub gearing: pixels of drag per second of footage. COACH-CONFIG candidate. */
const SCRUB_PX_PER_SECOND = 200;
/** ←/→ step while paused. Phone clips are 30 or 60 fps; 1/30 s lands on a
 *  distinct frame for both. */
const FRAME_STEP_S = 1 / 30;

/** Scrub frame grid. The finger controls whole frame numbers on this grid,
 *  not raw time: a seek to an arbitrary time lets the browser round to
 *  either neighbouring frame, and consecutive seeks rounding in different
 *  directions read as jitter. On the grid every step lands deterministically
 *  (targets sit mid-frame so no boundary rounding), and finger tremor that
 *  stays within one frame issues no seek at all. 60 fps clips scrub at half
 *  native granularity, which still reads smooth. */
const SCRUB_FPS = 30;
/** Finger travel below this is a tap, not a scrub. */
const TAP_SLOP_PX = 8;

/** Pinch-zoom ceiling. Past 5× a phone clip is decoded pixels, not detail. */
const MAX_ZOOM = 5;

/** Slow-motion cycle: tap the speed chip to step through. ½× and ¼× are the
 *  useful review speeds — slower than ¼× and stepping frames beats playing. */
const PLAYBACK_RATES = [1, 0.5, 0.25] as const;

function rateLabel(rate: number): string {
  return rate === 1 ? '1×' : rate === 0.5 ? '½×' : '¼×';
}

interface ScrubPlayerProps {
  src: string;
  /** Reel mode (review feed): autoplay muted while true, pause when false.
   *  Omit for the lightbox — the clip starts paused on its first frame so
   *  the coach scrubs from the setup, not mid-lift. */
  active?: boolean;
  loop?: boolean;
  /** fill: cover the parent box (review card). natural: intrinsic size
   *  capped to the viewport (lightbox). */
  layout?: 'fill' | 'natural';
  preload?: 'auto' | 'metadata';
}

/** German-locale seconds readout, e.g. "1,84 s". */
function fmtSeconds(t: number): string {
  return `${t.toFixed(2).replace('.', ',')} s`;
}

export function ScrubPlayer({
  src,
  active,
  loop = false,
  layout = 'fill',
  preload = 'auto',
}: ScrubPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(true);
  // Reel mode must start muted or the browser blocks the autoplay.
  const [muted, setMuted] = useState(active !== undefined);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const drag = useRef<{ x: number; t0: number; scrubbed: boolean } | null>(null);

  // ── Pinch zoom & pan ─────────────────────────────────────────────────────
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  /** All fingers currently down, by pointer id. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** Gesture-start snapshot while two fingers are down. */
  const pinch = useRef<{
    d0: number;
    m0: { x: number; y: number };
    s0: number;
    t0: { x: number; y: number };
  } | null>(null);
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const zoomed = view.s > 1;

  const resetZoom = () => setView({ s: 1, tx: 0, ty: 0 });

  // ── Fullscreen ───────────────────────────────────────────────────────────
  // Native element fullscreen keeps the whole gesture surface. iPhone Safari
  // has no element fullscreen (only its own video player, which would lose
  // tap/scrub/zoom), so there we fall back to a fixed full-viewport overlay.
  const [nativeFs, setNativeFs] = useState(false);
  const [cssFs, setCssFs] = useState(false);
  const isFullscreen = nativeFs || cssFs;

  useEffect(() => {
    const onChange = () => setNativeFs(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (nativeFs) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (cssFs) {
      setCssFs(false);
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => setCssFs(true));
    } else {
      setCssFs(true);
    }
  };

  // Slow motion. Applied on change AND on metadata load — some browsers
  // reset playbackRate when the source (re)loads.
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
  }, [rate]);

  // Reel mode: follow the active card. Runs on transitions only, so a manual
  // pause while the card stays active is respected.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || active === undefined) return;
    if (active) {
      el.muted = true;
      setMuted(true);
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [active]);

  // Progress bar follow — rAF while playing beats 4 Hz timeupdate.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      if (el && !el.paused) setTime(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  // Seek chaining. Setting currentTime on every pointermove while the
  // previous seek is still decoding makes browsers coalesce them all — the
  // frame then only updates when the finger lets go. So: one seek in flight
  // at a time; each 'seeked' (frame painted) immediately issues the newest
  // pending target. Frames paint as fast as the decoder allows mid-drag.
  const seekState = useRef<{
    inFlight: boolean;
    pending: number | null;
    /** Time the in-flight seek was aimed at — lets 'seeked' tell our seek
     *  apart from an alien one (a loop wrap racing a pause/scrub). */
    target: number | null;
    /** When the in-flight seek was issued — watchdog for a browser that
     *  swallows a 'seeked' (same-position seeks on some engines). */
    issuedAt: number;
  }>({ inFlight: false, pending: null, target: null, issuedAt: 0 });
  /** Frame the last scrub seek targeted — dedupes finger jitter. Cleared
   *  whenever playback moves the clip without us. */
  const lastFrame = useRef<number | null>(null);

  const issueSeek = (el: HTMLVideoElement, t: number) => {
    const s = seekState.current;
    s.inFlight = true;
    s.target = t;
    s.issuedAt = performance.now();
    el.currentTime = t;
  };

  const seekTo = (t: number) => {
    const el = videoRef.current;
    if (!el) return;
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    // Quantize the target onto the frame grid (see SCRUB_FPS)…
    const maxFrame = Math.max(0, Math.floor((dur - 0.001) * SCRUB_FPS));
    const frame = Math.min(Math.max(0, Math.round(t * SCRUB_FPS)), maxFrame);
    if (frame === lastFrame.current) return; // same frame — no seek, no jitter
    lastFrame.current = frame;
    // …and land mid-frame so browsers can't round across the boundary.
    const clamped = Math.min((frame + 0.5) / SCRUB_FPS, Math.max(0, dur - 0.001));
    // The readout follows the finger, even while the paint lags a frame.
    setTime(clamped);
    const s = seekState.current;
    // Watchdog: a chain stuck on a swallowed 'seeked' would queue forever —
    // after 300 ms without completion, seize the element and seek directly.
    if (s.inFlight && performance.now() - s.issuedAt < 300) {
      s.pending = clamped;
      return;
    }
    s.pending = null;
    issueSeek(el, clamped);
  };

  const onSeeked = () => {
    const el = videoRef.current;
    const s = seekState.current;
    if (!el) return;
    if (s.pending != null) {
      const next = s.pending;
      s.pending = null;
      issueSeek(el, next); // chain straight to the newest target
      return;
    }
    if (s.inFlight && s.target != null && Math.abs(el.currentTime - s.target) > 0.02) {
      // An alien seek completed — a loop wrap that was already queued when
      // the coach paused to scrub lands the clip on frame 0 / the pre-pause
      // frame. Re-issue our target so the flash corrects immediately.
      issueSeek(el, s.target);
      return;
    }
    s.inFlight = false;
    s.target = null;
  };

  /** The two tracked finger positions as distance + midpoint. */
  const pinchGeometry = () => {
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    return {
      d: Math.hypot(b.x - a.x, b.y - a.y),
      m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    if (!el) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // Second finger lands: the gesture is a pinch now, not a scrub.
      drag.current = null;
      setScrubbing(false);
      const { d, m } = pinchGeometry();
      const v = viewRef.current;
      pinch.current = { d0: Math.max(1, d), m0: m, s0: v.s, t0: { x: v.tx, y: v.ty } };
      return;
    }
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, t0: el.currentTime, scrubbed: false };
      lastFrame.current = null; // new drag baseline — never dedupe against an old one
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    if (!el) return;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two fingers: zoom around the pinch midpoint, pan with its movement.
    const p = pinch.current;
    if (p && pointers.current.size >= 2) {
      const box = wrapperRef.current?.getBoundingClientRect();
      if (!box) return;
      const { d, m } = pinchGeometry();
      const s = Math.min(MAX_ZOOM, Math.max(1, p.s0 * (d / p.d0)));
      // Keep the content point that was under the fingers under them still:
      // t = m − c − (s/s0)·(m0 − c − t0), with c the wrapper centre.
      const c = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const k = s / p.s0;
      let tx = m.x - c.x - k * (p.m0.x - c.x - p.t0.x);
      let ty = m.y - c.y - k * (p.m0.y - c.y - p.t0.y);
      // Don't let the footage leave the frame.
      const maxTx = ((s - 1) * box.width) / 2;
      const maxTy = ((s - 1) * box.height) / 2;
      tx = Math.min(maxTx, Math.max(-maxTx, tx));
      ty = Math.min(maxTy, Math.max(-maxTy, ty));
      // Snap fully out near 1× so a casual pinch-out cleanly restores.
      setView(s < 1.02 ? { s: 1, tx: 0, ty: 0 } : { s, tx, ty });
      return;
    }

    // One finger: the scrub.
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.scrubbed) {
      if (Math.abs(dx) < TAP_SLOP_PX) return;
      d.scrubbed = true;
      setScrubbing(true);
      el.pause();
      // Rebase on the frame actually on screen NOW: between pointerdown and
      // the scrub engaging, a playing clip has advanced (or loop-wrapped) —
      // scrubbing from the stale pointerdown time reads as a jump.
      d.x = e.clientX;
      d.t0 = el.currentTime;
      return;
    }
    seekTo(d.t0 + dx / SCRUB_PX_PER_SECOND);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      // Pinch over (or down to one resting finger). That finger does nothing
      // until lifted — lifting a pinch must never toggle playback or scrub.
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    setScrubbing(false);
    // A tap (no scrub movement) toggles playback; a scrub parks the frame.
    if (d && !d.scrubbed) togglePlay();
  };

  // The browser claiming the gesture (vertical reel scroll via pan-y) fires
  // pointercancel — that is neither a tap nor a scrub nor a pinch end.
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
    setScrubbing(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    if (!el) return;
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      el.pause();
      seekTo(el.currentTime + (e.key === 'ArrowRight' ? FRAME_STEP_S : -FRAME_STEP_S));
    } else if (e.key === 'Escape' && cssFs) {
      // Native fullscreen handles its own Escape; the CSS overlay needs this.
      setCssFs(false);
    }
  };

  const wrapperStyle: React.CSSProperties = cssFs
    ? { position: 'fixed', inset: 0, zIndex: 9999 }
    : nativeFs || layout === 'fill'
      ? { width: '100%', height: '100%' }
      : { maxWidth: '100%', maxHeight: '100%', lineHeight: 0 };
  const videoStyle: React.CSSProperties =
    isFullscreen || layout === 'fill'
      ? { width: '100%', height: '100%', objectFit: 'contain' }
      : { display: 'block', maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain' };
  if (zoomed) {
    videoStyle.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    videoStyle.transformOrigin = 'center center';
    videoStyle.willChange = 'transform';
  }

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div
      ref={wrapperRef}
      role="button"
      aria-label="Video — tap to play or pause, drag sideways to scrub, pinch to zoom"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      className="relative select-none outline-none bg-black overflow-hidden"
      // pan-y keeps the review reel scrollable through the player; once
      // zoomed, every gesture belongs to the player (scrub + pan + pinch).
      style={{ ...wrapperStyle, touchAction: zoomed ? 'none' : 'pan-y' }}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        loop={loop}
        muted={muted}
        preload={preload}
        onLoadedMetadata={e => {
          setDuration(e.currentTarget.duration || 0);
          e.currentTarget.playbackRate = rate;
        }}
        onPlay={() => {
          setPaused(false);
          // Playback moves the clip — the frame cache and any queued scrub
          // target are stale. Without this, a leftover pending seek fires on
          // the next 'seeked' (e.g. a loop wrap) and yanks the playing clip
          // back to an old scrub position.
          lastFrame.current = null;
          seekState.current = { inFlight: false, pending: null, target: null, issuedAt: 0 };
        }}
        onPause={() => setPaused(true)}
        onSeeked={onSeeked}
        onTimeUpdate={e => {
          // Keeps the bar honest on seeks/loops even without the rAF tick —
          // but not mid-scrub, where the readout follows the finger and the
          // painted frame lags a seek behind.
          if (e.currentTarget.paused && !scrubbing) setTime(e.currentTarget.currentTime);
        }}
        className="pointer-events-none"
        style={videoStyle}
      />

      {/* Thin progress bar — grows while scrubbing so the thumb has a target. */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-white/20 transition-[height] ${
          scrubbing ? 'h-1.5' : 'h-[3px]'
        }`}
      >
        <div className="h-full bg-white/90" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Scrub readout: where the parked frame sits in the clip. */}
      {scrubbing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-black/70 text-white text-[11px] font-medium tabular-nums pointer-events-none">
          {fmtSeconds(time)} / {fmtSeconds(duration)}
        </div>
      )}

      {/* Small paused glyph in the corner — the lifter stays unobstructed. */}
      {paused && !scrubbing && (
        <div className="absolute bottom-2.5 left-2.5 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center pointer-events-none">
          <Play size={11} className="ml-0.5" />
        </div>
      )}

      {/* Zoom readout — tap to jump back to 1×. */}
      {zoomed && (
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={resetZoom}
          title="Reset zoom"
          aria-label={`Zoomed ${view.s.toFixed(1).replace('.', ',')}× — tap to reset`}
          className="absolute top-2.5 right-2.5 h-6 px-2 rounded-full bg-[var(--color-accent)] text-white text-[10px] font-semibold tabular-nums flex items-center justify-center"
        >
          {view.s.toFixed(1).replace('.', ',')}×
        </button>
      )}

      <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
        {/* Slow motion: cycles 1× → ½× → ¼×. Lit while slowed so the state
            is visible at a glance. */}
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() =>
            setRate(prev => {
              const idx = PLAYBACK_RATES.indexOf(prev as (typeof PLAYBACK_RATES)[number]);
              return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
            })
          }
          title="Playback speed"
          aria-label={`Playback speed ${rateLabel(rate)} — tap to change`}
          className={`h-6 min-w-6 px-1 rounded-full text-[10px] font-semibold tabular-nums flex items-center justify-center ${
            rate === 1 ? 'bg-black/55 text-white' : 'bg-[var(--color-accent)] text-white'
          }`}
        >
          {rateLabel(rate)}
        </button>

        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => {
            const el = videoRef.current;
            if (!el) return;
            el.muted = !el.muted;
            setMuted(el.muted);
          }}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"
        >
          {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </button>

        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>
    </div>
  );
}
