/**
 * useFrameServer — the viewer's playhead.
 *
 * Owns one `FrameServer` for the life of a clip and turns it into React state:
 * which frame is showing, how to step, how to play. Playback walks the
 * container's real timestamps rather than an `HTMLVideoElement` — so what
 * plays and what steps are the same frames, and a variable-frame-rate clip
 * plays at its true timing instead of a nominal fps (docs/KINEMOS_P1_PLAN.md
 * decision 2).
 *
 * The playhead asks the server for ONE frame at a time. A scrub, a held key or
 * the play clock can move the wanted index faster than the decoder answers,
 * and every request for a frame the coach has already moved past is a decode
 * nobody sees — and, behind the server's forward run, a seek each
 * (`engine/frameServer.ts`, the decode run). So a request goes out only when
 * none is in flight; when one lands, the newest wanted index is requested if
 * it differs, and the indices between were never asked for. Playback is the
 * same rule with a clock: the next frame is requested when the previous one
 * has landed, at whatever index the clock has reached, and the index and the
 * pixels change together — the transport never names a frame the stage has
 * not shown.
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

function describeDecodeFailure(index: number, err: unknown): string {
  return `Frame ${index + 1} would not decode (${err instanceof Error ? err.message : 'unknown error'}).`;
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

  // The index the stage should show. A slow frame that resolves after the
  // coach has stepped past it must not repaint the stage.
  const wantedRef = useRef(0);
  // The server a stage decode is in flight on, or null. Keyed by server rather
  // than a boolean so a request outliving its clip cannot free the slot of
  // the one that replaced it.
  const inFlightRef = useRef<FrameServer | null>(null);
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
    inFlightRef.current = null;

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

  /** Decode the wanted frame, one request at a time; when it lands, go again
   *  if the wanted index has moved on. Every route to a new index — keyboard,
   *  scrub, a rep jump — paints through here. */
  const pump = useCallback(() => {
    const active = serverRef.current;
    if (!active || inFlightRef.current === active) return;
    const wanted = wantedRef.current;
    inFlightRef.current = active;
    active
      .frameAt(wanted)
      .then(
        next => {
          if (serverRef.current !== active || wantedRef.current !== wanted) return;
          setFrame(next);
          setDecodeError(null);
        },
        (err: unknown) => {
          if (serverRef.current !== active || wantedRef.current !== wanted) return;
          // Never leave the previous frame up. It would sit under a transport,
          // a readout and an overlay that all name a different moment, and a
          // mark placed on it would be stored against a timestamp it does not
          // belong to. A blank stage that says why is the honest failure.
          setFrame(null);
          setDecodeError(describeDecodeFailure(wanted, err));
        },
      )
      .finally(() => {
        if (inFlightRef.current === active) inFlightRef.current = null;
        if (serverRef.current === active && wantedRef.current !== wanted) pump();
      });
    active.prefetch(wanted, 4);
  }, []);

  useEffect(() => {
    if (!serverRef.current || status !== 'ready') return;
    wantedRef.current = index;
    pump();
  }, [index, status, pump]);

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
  // honest — a fixed +1 per tick would play them at the wrong speed — and
  // requesting that frame only once the previous one has landed keeps the
  // decoder on frames that will be seen: when a decode runs long the clock
  // simply lands further on, and the frames between are never asked for.
  useEffect(() => {
    const active = serverRef.current;
    if (!playing || !active || status !== 'ready') return;

    let cancelled = false;
    let raf = 0;
    const last = active.frameCount - 1;
    const startWall = performance.now();
    const startT = active.timestamps[index] ?? 0;
    const clock = () => startT + ((performance.now() - startWall) / 1000) * speed;
    const vsync = () =>
      new Promise<void>(resolve => {
        raf = requestAnimationFrame(() => resolve());
      });

    void (async () => {
      let shown = index;
      while (!cancelled) {
        const target = clock();
        if (target >= active.timestamps[last]) {
          setIndex(last);
          setPlaying(false);
          return;
        }
        const next = active.nearestIndex(target);
        if (next === shown) {
          await vsync();
          continue;
        }
        let decoded: ServedFrame | null = null;
        try {
          decoded = await active.frameAt(next);
        } catch {
          // Reported by the decode path below once the index lands on it —
          // the same message a step onto the frame would show.
        }
        if (cancelled) return;
        shown = next;
        wantedRef.current = next;
        if (decoded) {
          setFrame(decoded);
          setDecodeError(null);
        }
        setIndex(next);
        active.prefetch(next, 4);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
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
