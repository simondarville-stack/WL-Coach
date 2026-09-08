/**
 * The viewer's playhead: one decode in flight, and playback that asks for the
 * next frame only when the previous one has landed.
 *
 * The decoder is a stand-in with a settable decode time, so the two failure
 * modes this hook exists to avoid can be provoked directly: a scrub that
 * queues a request for every frame the coach passed (08/09/2026: behind the
 * frame server's forward run each one was a seek), and a play loop that asks
 * for a frame per animation tick regardless of what has been shown (13 of
 * 240 frames shown at 1× on the testset's 60 fps clip, the rest decoded for
 * nothing).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FPS = 60;
const FRAMES = 120;

const decoder = {
  /** Every index asked of the server, in order. */
  asked: [] as number[],
  /** How long a decode takes, ms. */
  ms: 0,
};

vi.mock('../../engine/frameServer', () => {
  class FrameServerUnavailableError extends Error {}
  const timestamps = Array.from({ length: FRAMES }, (_, i) => i / FPS);
  const served = new Set<number>();
  return {
    FrameServerUnavailableError,
    openFrameServer: async () => ({
      timestamps,
      keyframeTimestamps: [0],
      frameCount: FRAMES,
      durationS: FRAMES / FPS,
      displayWidth: 320,
      displayHeight: 180,
      rotation: 0,
      averageFps: FPS,
      isVfr: false,
      codec: 'avc',
      frameAt: (index: number) => {
        // Served frames come back at once, as the real server's cache hands
        // them back; only a decode is recorded.
        const frame = { index, timestamp: timestamps[index], canvas: {} as HTMLCanvasElement };
        if (served.has(index)) return Promise.resolve(frame);
        decoder.asked.push(index);
        return new Promise(resolve => {
          setTimeout(() => {
            served.add(index);
            resolve(frame);
          }, decoder.ms);
        });
      },
      prefetch: () => undefined,
      nearestIndex: (t: number) => Math.max(0, Math.min(FRAMES - 1, Math.round(t * FPS))),
      close: () => undefined,
    }),
  };
});

const { useFrameServer } = await import('../useFrameServer');

/** Let the clock run `ms` and every promise that resolves on the way settle. */
const run = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  decoder.asked = [];
  decoder.ms = 0;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openClip() {
  const hook = renderHook(() => useFrameServer('clip.mp4'));
  await run(0);
  expect(hook.result.current.status).toBe('ready');
  await run(0);
  expect(hook.result.current.frame?.index).toBe(0);
  return hook;
}

describe('useFrameServer', () => {
  it('asks only for the frame the coach ends on when the index outruns the decoder', async () => {
    const hook = await openClip();
    decoder.ms = 50;
    decoder.asked = [];

    act(() => hook.result.current.seek(10));
    await run(5);
    act(() => hook.result.current.seek(20));
    await run(5);
    act(() => hook.result.current.seek(30));
    await run(5);

    // Frame 10 is in flight; 20 was passed while it decoded and is never
    // asked for; 30 is asked for the moment 10 lands.
    expect(decoder.asked).toEqual([10]);
    await run(50);
    expect(decoder.asked).toEqual([10, 30]);
    await run(50);
    expect(hook.result.current.frame?.index).toBe(30);
    expect(hook.result.current.index).toBe(30);
    hook.unmount();
  });

  it('plays by requesting the next frame when the previous has landed, never one behind the clock', async () => {
    const hook = await openClip();
    // A decode slower than a frame at 1× on a 60 fps clip: the loop must skip
    // frames by the clock rather than queue a request for each.
    decoder.ms = 40;
    decoder.asked = [];

    act(() => hook.result.current.setSpeed(1));
    act(() => hook.result.current.togglePlay());
    expect(hook.result.current.playing).toBe(true);

    const seen: Array<{ index: number; frame: number | undefined }> = [];
    for (let k = 0; k < 25; k++) {
      await run(20);
      seen.push({ index: hook.result.current.index, frame: hook.result.current.frame?.index });
    }

    // 500 ms at 40 ms a decode: about a dozen frames shown, not thirty
    // requests, every one further on than the last.
    expect(decoder.asked.length).toBeGreaterThan(8);
    expect(decoder.asked.length).toBeLessThan(16);
    for (let k = 1; k < decoder.asked.length; k++) {
      expect(decoder.asked[k]).toBeGreaterThan(decoder.asked[k - 1]);
    }
    // The transport never names a frame the stage has not shown.
    for (const s of seen) expect(s.frame).toBe(s.index);
    // The clock, not the decoder, sets the pace: after 500 ms at 1× the
    // playhead is near frame 30, not near frame 12.
    const last = seen[seen.length - 1];
    expect(last.index).toBeGreaterThan(24);
    expect(last.index).toBeLessThan(36);
    hook.unmount();
  });

  it('stops on the last frame', async () => {
    const hook = await openClip();
    decoder.ms = 1;
    act(() => hook.result.current.setSpeed(1));
    act(() => hook.result.current.togglePlay());
    await run(FRAMES * (1000 / FPS) + 100);
    expect(hook.result.current.playing).toBe(false);
    expect(hook.result.current.index).toBe(FRAMES - 1);
    await run(10);
    expect(hook.result.current.frame?.index).toBe(FRAMES - 1);
    hook.unmount();
  });

  it('a step pauses playback and lands on the neighbouring frame', async () => {
    const hook = await openClip();
    decoder.ms = 1;
    act(() => hook.result.current.togglePlay());
    await run(200);
    const at = hook.result.current.index;
    act(() => hook.result.current.step(1));
    expect(hook.result.current.playing).toBe(false);
    await run(10);
    expect(hook.result.current.index).toBe(at + 1);
    expect(hook.result.current.frame?.index).toBe(at + 1);
    hook.unmount();
  });
});
