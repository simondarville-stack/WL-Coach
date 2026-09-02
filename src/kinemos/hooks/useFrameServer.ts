/**
 * useFrameServer — the viewer's playhead.
 *
 * Owns one `FrameServer` for the life of a clip and turns it into React state:
 * which frame is showing, how to step, how to play. Playback is a
 * requestAnimationFrame loop that walks the container's real timestamps rather
 * than an `HTMLVideoElement` — so what plays and what steps are the same frames,
 * and a variable-frame-rate clip plays at its true timing instead of a nominal
 * fps (docs/KINEMOS_P1_PLAN.md decision 2).
 *
 * This is the one place in KinEMOS allowed to bridge the pure engine to React;
 * the engine itself stays free of both (design §4 rule 1).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FrameServerUnavailableError,
  openFrameServer,
  type FrameServer,
  type ServedFrame,
} from '../engine/frameServer';

export type FrameServerStatus = 'idle' | 'opening' | 'ready' | 'error';

/** Playback rates the transport offers. Weightlifting review lives at the slow
 *  end — 1× exists mostly to confirm the lift looks normal. */
export const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 1] as const;

export interface UseFrameServer {
  status: FrameServerStatus;
  error: string | null;
  /**
   * Set when the clip opened but a particular frame would not decode. Distinct
   * from `error`, which means the clip never opened at all: this one is
   * per-frame and recovers as soon as a frame decodes.
   */
  decodeError: string | null;
  server: FrameServer | null;
  frame: ServedFrame | null;
  /** Frame the playhead is ON, even while its pixels are still decoding. */
  index: number;
  playing: boolean;
  speed: number;

  seek(index: number): void;
  step(delta: number): void;
  togglePlay(): void;
  setSpeed(speed: number): void;
}

export function useFrameServer(src: string | null): UseFrameServer {
  const [status, setStatus] = useState<FrameServerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<FrameServer | null>(null);
  const [frame, setFrame] = useState<ServedFrame | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(0.25);

  // The index the newest decode request was made for. A slow frame that
  // resolves after the coach has stepped past it must not repaint the stage.
  const wantedRef = useRef(0);
  const serverRef = useRef<FrameServer | null>(null);

  useEffect(() => {
    if (!src) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('opening');
    setError(null);
    setDecodeError(null);
    setFrame(null);
    setIndex(0);
    wantedRef.current = 0;

    openFrameServer(src)
      .then(opened => {
        if (cancelled) {
          opened.close();
          return;
        }
        serverRef.current = opened;
        setServer(opened);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(
          err instanceof FrameServerUnavailableError
            ? err.message
            : 'This clip could not be opened for frame-by-frame work.',
        );
      });

    return () => {
      cancelled = true;
      serverRef.current?.close();
      serverRef.current = null;
      setServer(null);
    };
  }, [src]);

  // Decode whatever the playhead is on. Kept in an effect rather than inside
  // `seek` so every route to a new index — keyboard, scrub, playback, a rep
  // jump — paints through the same path.
  useEffect(() => {
    const active = serverRef.current;
    if (!active || status !== 'ready') return;
    wantedRef.current = index;
    let stale = false;
    active
      .frameAt(index)
      .then(next => {
        if (stale || wantedRef.current !== index) return;
        setFrame(next);
        setDecodeError(null);
      })
      .catch((err: unknown) => {
        if (stale || wantedRef.current !== index) return;
        // Never leave the previous frame up. It would sit under a transport, a
        // readout and an overlay that all name a different moment, and a mark
        // placed on it would be stored against a timestamp it does not belong
        // to. A blank stage that says why is the honest failure.
        setFrame(null);
        setDecodeError(
          `Frame ${index + 1} would not decode (${err instanceof Error ? err.message : 'unknown error'}).`,
        );
      });
    active.prefetch(index, 4);
    return () => {
      stale = true;
    };
  }, [index, status]);

  const seek = useCallback((next: number) => {
    const active = serverRef.current;
    if (!active) return;
    setIndex(Math.max(0, Math.min(active.frameCount - 1, Math.round(next))));
  }, []);

  const step = useCallback((delta: number) => {
    const active = serverRef.current;
    if (!active) return;
    setPlaying(false);
    setIndex(current => Math.max(0, Math.min(active.frameCount - 1, current + delta)));
  }, []);

  const togglePlay = useCallback(() => {
    const active = serverRef.current;
    if (!active) return;
    setPlaying(current => {
      if (current) return false;
      // Restarting from the tail is what a coach means by pressing play there.
      if (index >= active.frameCount - 1) setIndex(0);
      return true;
    });
  }, [index]);

  // Playback: advance along the container's own timestamps at `speed` of real
  // time. Landing on the nearest frame to a wall-clock target keeps VFR clips
  // honest — a fixed +1 per tick would play them at the wrong speed.
  useEffect(() => {
    const active = serverRef.current;
    if (!playing || !active || status !== 'ready') return;

    let raf = 0;
    const startWall = performance.now();
    const startT = active.timestamps[index] ?? 0;

    const tick = (now: number) => {
      const elapsed = ((now - startWall) / 1000) * speed;
      const target = startT + elapsed;
      const next = active.nearestIndex(target);
      if (target >= active.timestamps[active.frameCount - 1]) {
        setIndex(active.frameCount - 1);
        setPlaying(false);
        return;
      }
      setIndex(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `index` is read once to anchor the run; re-running on every frame would
    // restart the clock 60 times a second and never advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, status]);

  return {
    status,
    error,
    decodeError,
    server,
    frame,
    index,
    playing,
    speed,
    seek,
    step,
    togglePlay,
    setSpeed,
  };
}
