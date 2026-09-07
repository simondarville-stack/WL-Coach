/**
 * The set tracker's range (P7 plan §3): everything it does stays inside the
 * frames it is given. The frame source is a synthetic plate on a plain
 * ground served through a stand-in for the adapter (jsdom has no canvas),
 * and the cv finder is stubbed to find nothing, so a join can only come
 * from the tracker itself.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FrameServer } from '../../engine/frameServer';
import type { FrameRegion, GrayImage } from '../../engine/tracker';

const W = 200;
const H = 240;
const R = 18;
const FPS = 30;
const FRAMES = 60;

/** The plate's centre row on frame i: at rest, then rising, then held. */
function plateY(i: number): number {
  if (i < 10) return 190;
  if (i < 40) return 190 - ((i - 10) * 120) / 30;
  return 70;
}

function renderFrame(i: number): GrayImage {
  const data = new Float32Array(W * H);
  const cy = plateY(i);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 100, y - cy);
      const cover = Math.max(0, Math.min(1, R + 0.5 - d));
      const rim = d > R - 4 && d <= R ? 60 : 0;
      data[y * W + x] = 60 * (1 - cover) + (170 + rim) * cover;
    }
  }
  return { width: W, height: H, data };
}

const frames = Array.from({ length: FRAMES }, (_, i) => renderFrame(i));
const timestamps = Array.from({ length: FRAMES }, (_, i) => i / FPS);

vi.mock('../trackerSource', () => ({
  trackerSourceFrom: () => ({
    frameCount: FRAMES,
    timestamps,
    getGray: (i: number, _region?: FrameRegion) => Promise.resolve(frames[i]),
    getRgba: () => Promise.reject(new Error('no colour in this test')),
    dispose: () => undefined,
  }),
}));

vi.mock('../../cv/plate', () => ({
  findPlate: () => Promise.resolve(null),
  refinePlateEllipse: () => Promise.resolve(null),
}));

const server: FrameServer = {
  timestamps,
  keyframeTimestamps: [0],
  frameCount: FRAMES,
  durationS: FRAMES / FPS,
  displayWidth: W,
  displayHeight: H,
  rotation: 0,
  averageFps: FPS,
  isVfr: false,
  codec: 'avc1',
  frameAt: () => Promise.reject(new Error('the adapter is stubbed')),
  prefetch: () => undefined,
  nearestIndex: t => Math.max(0, Math.min(FRAMES - 1, Math.round(t * FPS))),
  close: () => undefined,
};

const ellipse = { cx: 100, cy: plateY(0), semiMajorPx: R, semiMinorPx: R, tiltDeg: 0 };

describe('trackSet with a range', () => {
  const SLOW = { timeout: 60_000 };

  it('tracks the whole clip by default', SLOW, async () => {
    const { trackSet } = await import('../setTracker');
    const result = await trackSet(server, { index: 5, x: 100, y: plateY(5) }, { ellipse, plateDiameterCm: 45, colour: false });
    expect(result.tracked[0].index).toBe(0);
    expect(result.tracked[result.tracked.length - 1].index).toBe(FRAMES - 1);
    expect(result.lostAtEnd).toBe(false);
  });

  it('stays inside the range, and a range end is neither a loss nor a join', SLOW, async () => {
    const { trackSet } = await import('../setTracker');
    const lines: string[] = [];
    const result = await trackSet(
      server,
      { index: 8, x: 100, y: plateY(8) },
      { ellipse, plateDiameterCm: 45, colour: false, range: { from: 5, to: 45 }, onLog: l => lines.push(l) },
    );
    const indices = result.tracked.map(p => p.index);
    expect(indices[0]).toBe(5);
    expect(indices[indices.length - 1]).toBe(45);
    expect(indices).toEqual(Array.from({ length: 41 }, (_, i) => 5 + i));
    expect(result.joins).toEqual([]);
    expect(result.lostAtEnd).toBe(false);
    expect(lines.some(l => /dropped/.test(l))).toBe(false);
  });

  it('clamps a range that overruns the clip', SLOW, async () => {
    const { trackSet } = await import('../setTracker');
    const result = await trackSet(
      server,
      { index: 50, x: 100, y: plateY(50) },
      { ellipse, plateDiameterCm: 45, colour: false, range: { from: 48, to: 500 } },
    );
    const indices = result.tracked.map(p => p.index);
    expect(indices[0]).toBe(48);
    expect(indices[indices.length - 1]).toBe(FRAMES - 1);
  });
});
