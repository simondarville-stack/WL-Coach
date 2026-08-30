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
 *   - desktop: Space toggles, ←/→ step one frame (~1/30 s)
 *
 * Vertical gestures pass through (touch-action: pan-y), so the review reel
 * still snap-scrolls with the player under the finger. Chrome is minimal:
 * a thin progress bar, a small paused glyph, a mute toggle, and a time
 * readout while scrubbing.
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Volume2, VolumeX } from 'lucide-react';

/** Scrub gearing: pixels of drag per second of footage. COACH-CONFIG candidate. */
const SCRUB_PX_PER_SECOND = 200;
/** ←/→ step while paused. Phone clips are 30 or 60 fps; 1/30 s lands on a
 *  distinct frame for both. */
const FRAME_STEP_S = 1 / 30;
/** Finger travel below this is a tap, not a scrub. */
const TAP_SLOP_PX = 8;

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
  const seekState = useRef<{ inFlight: boolean; pending: number | null }>({
    inFlight: false,
    pending: null,
  });

  const seekTo = (t: number) => {
    const el = videoRef.current;
    if (!el) return;
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    const clamped = Math.min(Math.max(0, t), Math.max(0, dur - 0.001));
    // The readout follows the finger, even while the paint lags a frame.
    setTime(clamped);
    if (seekState.current.inFlight) {
      seekState.current.pending = clamped;
      return;
    }
    seekState.current.inFlight = true;
    el.currentTime = clamped;
  };

  const onSeeked = () => {
    const el = videoRef.current;
    const s = seekState.current;
    if (!el) return;
    if (s.pending != null) {
      const next = s.pending;
      s.pending = null;
      el.currentTime = next; // stay in flight — chain straight to the newest target
    } else {
      s.inFlight = false;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    if (!el) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    drag.current = { x: e.clientX, t0: el.currentTime, scrubbed: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = videoRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.scrubbed) {
      if (Math.abs(dx) < TAP_SLOP_PX) return;
      d.scrubbed = true;
      setScrubbing(true);
      el.pause();
    }
    seekTo(d.t0 + dx / SCRUB_PX_PER_SECOND);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setScrubbing(false);
    // A tap (no scrub movement) toggles playback; a scrub parks the frame.
    if (d && !d.scrubbed) togglePlay();
  };

  // The browser claiming the gesture (vertical reel scroll via pan-y) fires
  // pointercancel — that is neither a tap nor a scrub, so no toggle.
  const onPointerCancel = () => {
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
    }
  };

  const wrapperStyle: React.CSSProperties =
    layout === 'fill'
      ? { width: '100%', height: '100%' }
      : { maxWidth: '100%', maxHeight: '100%', lineHeight: 0 };
  const videoStyle: React.CSSProperties =
    layout === 'fill'
      ? { width: '100%', height: '100%', objectFit: 'contain' }
      : { display: 'block', maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain' };

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div
      role="button"
      aria-label="Video — tap to play or pause, drag sideways to scrub"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      className="relative select-none outline-none bg-black"
      style={{ ...wrapperStyle, touchAction: 'pan-y' }}
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
        onPlay={() => setPaused(false)}
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

      {/* Slow motion: cycles 1× → ½× → ¼×. Lit while slowed so the state is
          visible at a glance. */}
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
        className={`absolute bottom-2.5 right-10 h-6 min-w-6 px-1 rounded-full text-[10px] font-semibold tabular-nums flex items-center justify-center ${
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
        className="absolute bottom-2.5 right-2.5 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"
      >
        {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
    </div>
  );
}
