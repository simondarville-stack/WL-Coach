/**
 * useFollowerFrame — a second clip that follows someone else's clock.
 *
 * `useFrameServer` owns a playhead: it has a play loop, a play/pause state and
 * an index it advances itself. Two of those on one screen is two clocks, and
 * two clocks drift — which is the entire failure mode of synced side-by-side
 * playback, and one that looks like a decoding problem rather than a design
 * one.
 *
 * So the follower has no clock at all. It is given a time in ITS OWN clip's
 * seconds and decodes the frame nearest to it; whoever is driving decides what
 * that time is. There is exactly one play loop on the screen, and it is not
 * here.
 *
 * Addressing by time rather than by index is not a convenience: the two clips
 * are usually different frame rates, often one of them variable, and the
 * offset between them is a fraction of a frame that no index arithmetic can
 * carry (design §5, and `frameServer.ts` on VFR).
 */
import { useEffect, useRef, useState } from 'react';
import {
  FrameServerUnavailableError,
  openFrameServer,
  type FrameServer,
  type ServedFrame,
} from '../engine/frameServer';

export interface UseFollowerFrame {
  status: 'idle' | 'opening' | 'ready' | 'error';
  error: string | null;
  /** Set when the clip opened but this frame would not decode. Per-frame, and
   *  cleared by the next frame that does. */
  decodeError: string | null;
  server: FrameServer | null;
  frame: ServedFrame | null;
  /** Timestamp actually shown, which is the nearest frame to the one asked
   *  for — not the same number, and the difference is worth being able to
   *  show. Null before the first frame lands. */
  shownT: number | null;
}

export function useFollowerFrame(src: string | null, atSeconds: number | null): UseFollowerFrame {
  const [status, setStatus] = useState<UseFollowerFrame['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<FrameServer | null>(null);
  const [frame, setFrame] = useState<ServedFrame | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [shownT, setShownT] = useState<number | null>(null);

  const serverRef = useRef<FrameServer | null>(null);
  // The index of the newest request. A slow decode that lands after the clock
  // has moved on must not repaint the stage behind it.
  const wantedRef = useRef(-1);

  useEffect(() => {
    if (!src) {
      setStatus('idle');
      setServer(null);
      setFrame(null);
      setShownT(null);
      return;
    }
    let cancelled = false;
    setStatus('opening');
    setError(null);
    setDecodeError(null);
    setFrame(null);
    setShownT(null);
    wantedRef.current = -1;

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
            : 'That clip could not be opened for frame-by-frame work.',
        );
      });

    return () => {
      cancelled = true;
      serverRef.current?.close();
      serverRef.current = null;
      setServer(null);
    };
  }, [src]);

  useEffect(() => {
    const active = serverRef.current;
    if (!active || status !== 'ready' || atSeconds === null) return;

    const index = active.nearestIndex(atSeconds);
    // Re-decoding the frame already on screen is the common case while
    // scrubbing two clips of different frame rates: several of the leader's
    // frames map to one of the follower's.
    if (index === wantedRef.current) return;
    wantedRef.current = index;

    let stale = false;
    active
      .frameAt(index)
      .then(next => {
        if (stale || wantedRef.current !== index) return;
        setFrame(next);
        setShownT(active.timestamps[index] ?? null);
        setDecodeError(null);
      })
      .catch((err: unknown) => {
        if (stale || wantedRef.current !== index) return;
        // Same rule as the leader: a stale frame beside a live one is worse
        // than no frame, because the whole point of this screen is that the
        // two are at the same moment.
        setFrame(null);
        setShownT(null);
        setDecodeError(
          `Frame ${index + 1} would not decode (${err instanceof Error ? err.message : 'unknown error'}).`,
        );
      });
    active.prefetch(index, 3);
    return () => {
      stale = true;
    };
  }, [atSeconds, status]);

  return { status, error, decodeError, server, frame, shownT };
}
