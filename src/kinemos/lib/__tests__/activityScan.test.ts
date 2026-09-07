/**
 * The scan's walk (P7 plan §4), against a stand-in frame server and an
 * injected thumbnail reader — jsdom has no video and no canvas. The engine
 * underneath is tested on its own; here the questions are the walk's: every
 * frame once, in order, the server closed, progress and the stop honoured,
 * and a lift in the thumbnails coming out as a window.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Thumb } from '../../engine/activity';
import type { FrameServer, ServedFrame } from '../../engine/frameServer';
import { scanActivity, scanServer, windowLabel } from '../activityScan';

const W = 90;
const H = 160;
const FPS = 30;

/** A bright square on a plain ground, rising for a second in the middle
 *  of a three-second clip. */
function thumbFor(index: number): Thumb {
  const t = index / FPS;
  const top = t < 1 ? 130 : t < 2 ? 130 - 90 * (t - 1) : 40;
  const data = new Float32Array(W * H).fill(40);
  for (let y = Math.round(top); y < Math.round(top) + 20; y++) {
    for (let x = 35; x < 55; x++) data[y * W + x] = 200;
  }
  return { width: W, height: H, data, t };
}

function stubServer(frames: number, visited: number[]): FrameServer & { closed: boolean } {
  const timestamps = Array.from({ length: frames }, (_, i) => i / FPS);
  const server = {
    timestamps,
    keyframeTimestamps: [0],
    frameCount: frames,
    durationS: frames / FPS,
    displayWidth: W,
    displayHeight: H,
    rotation: 0,
    averageFps: FPS,
    isVfr: false,
    codec: 'avc1',
    closed: false,
    frameAt: (index: number): Promise<ServedFrame> => {
      visited.push(index);
      return Promise.resolve({ index, timestamp: timestamps[index], canvas: {} as HTMLCanvasElement });
    },
    prefetch: () => undefined,
    nearestIndex: (t: number) => Math.round(t * FPS),
    close: () => {
      server.closed = true;
    },
  };
  return server;
}

const readThumb = (frame: ServedFrame): Thumb => thumbFor(frame.index);

describe('scanServer', () => {
  it('walks every frame once, in presentation order, and finds the lift', async () => {
    const visited: number[] = [];
    const server = stubServer(3 * FPS, visited);
    const progress: Array<[number, number]> = [];
    const result = await scanServer(server, { readThumb, onProgress: (d, t) => progress.push([d, t]) });
    expect(visited).toEqual(Array.from({ length: 3 * FPS }, (_, i) => i));
    expect(result.frames).toBe(3 * FPS);
    expect(result.samples).toHaveLength(3 * FPS);
    expect(result.thumbWidth).toBe(W);
    expect(result.thumbHeight).toBe(H);
    expect(result.msPerFrame).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.stopped).toBe(false);
    expect(progress[progress.length - 1]).toEqual([3 * FPS, 3 * FPS]);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].restT).toBeLessThanOrEqual(1.05);
    expect(result.windows[0].toT).toBeGreaterThanOrEqual(1.9);
    // The walk does not close a server it did not open.
    expect(server.closed).toBe(false);
  });

  it('stops when asked and says so', async () => {
    const visited: number[] = [];
    const server = stubServer(3 * FPS, visited);
    let seen = 0;
    const result = await scanServer(server, {
      readThumb,
      onProgress: d => {
        seen = d;
      },
      shouldStop: () => seen >= 20,
    });
    expect(result.stopped).toBe(true);
    expect(result.frames).toBe(20);
    expect(visited).toHaveLength(20);
  });
});

describe('scanActivity', () => {
  it('opens a thumbnail server on the source and closes it after the walk', async () => {
    const visited: number[] = [];
    const server = stubServer(2 * FPS, visited);
    const open = vi.fn(() => Promise.resolve(server));
    const result = await scanActivity('blob:clip', { open, readThumb });
    expect(open).toHaveBeenCalledWith('blob:clip', { maxEdge: 160, cacheSize: 4 });
    expect(result.frames).toBe(2 * FPS);
    expect(server.closed).toBe(true);
  });

  it('closes the server even when the walk throws', async () => {
    const server = stubServer(10, []);
    const open = () => Promise.resolve(server);
    await expect(
      scanActivity('blob:clip', {
        open,
        readThumb: () => {
          throw new Error('no canvas');
        },
      }),
    ).rejects.toThrow('no canvas');
    expect(server.closed).toBe(true);
  });
});

describe('windowLabel', () => {
  it('says the span in seconds with comma decimals', () => {
    expect(
      windowLabel({
        restT: 1.0,
        fromT: 0.7,
        liftT: 1.2,
        toT: 2.44,
        confidence: 0.9,
        evidence: { peakEnergy: 1, quietEnergy: 0.1, centroidRiseRows: 30, centroidFallRows: 0, coverage: 0.1, burstS: 1 },
      }),
    ).toBe('1,2–2,4 s');
  });
});
