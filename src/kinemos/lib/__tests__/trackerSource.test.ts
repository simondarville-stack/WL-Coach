/**
 * The adapter's luma path (P6 plan §4): taken only behind the flag, only on
 * a forward walk, and only when the server can serve it — every other read
 * goes to the canvas exactly as before. jsdom has no 2D canvas, so the
 * canvas path is recognisable here by the error it throws; that is enough
 * to tell which path a read took.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameServer } from '../../engine/frameServer';
import type { FrameRegion, GrayImage } from '../../engine/tracker';
import { LUMA_REGION_KEY } from '../featureFlags';
import { trackerSourceFrom } from '../trackerSource';

function lumaImage(region: FrameRegion): GrayImage {
  return {
    width: region.width,
    height: region.height,
    data: new Float32Array(region.width * region.height).fill(7),
    originX: region.x,
    originY: region.y,
  };
}

function mockServer(luma: FrameServer['luma'] | undefined): FrameServer & {
  frameAt: ReturnType<typeof vi.fn>;
} {
  const timestamps = [0, 1 / 30, 2 / 30, 3 / 30];
  const frameAt = vi.fn((index: number) =>
    Promise.resolve({ index, timestamp: timestamps[index], canvas: {} as HTMLCanvasElement }),
  );
  return {
    timestamps,
    keyframeTimestamps: [0],
    frameCount: timestamps.length,
    durationS: 4 / 30,
    displayWidth: 100,
    displayHeight: 80,
    rotation: 0,
    averageFps: 30,
    isVfr: false,
    codec: 'avc1',
    frameAt,
    prefetch: () => undefined,
    nearestIndex: () => 0,
    luma,
    close: () => undefined,
  };
}

const REGION: FrameRegion = { x: 10, y: 20, width: 30, height: 30 };

describe('trackerSourceFrom with luma-region reads', () => {
  beforeEach(() => localStorage.setItem(LUMA_REGION_KEY, '1'));
  afterEach(() => localStorage.removeItem(LUMA_REGION_KEY));

  it('reads the region from the luma plane and never touches the canvas', async () => {
    const luma = vi.fn((_: number, region: FrameRegion) => Promise.resolve(lumaImage(region)));
    const server = mockServer(luma);
    const source = trackerSourceFrom(server);
    const gray = await source.getGray(1, REGION);
    expect(luma).toHaveBeenCalledTimes(1);
    expect(luma.mock.calls[0][0]).toBe(1);
    expect(luma.mock.calls[0][1]).toEqual(REGION);
    expect(server.frameAt).not.toHaveBeenCalled();
    expect(gray.originX).toBe(REGION.x);
    expect(gray.width).toBe(REGION.width);
    source.dispose();
  });

  it('serves a repeat of the same frame from its cache', async () => {
    const luma = vi.fn((_: number, region: FrameRegion) => Promise.resolve(lumaImage(region)));
    const source = trackerSourceFrom(mockServer(luma));
    await source.getGray(1, REGION);
    await source.getGray(1, { x: 12, y: 22, width: 10, height: 10 });
    expect(luma).toHaveBeenCalledTimes(1);
    source.dispose();
  });

  it('clamps the region to the frame before asking', async () => {
    const luma = vi.fn((_: number, region: FrameRegion) => Promise.resolve(lumaImage(region)));
    const source = trackerSourceFrom(mockServer(luma));
    await source.getGray(2, { x: -5, y: 60, width: 30, height: 40 });
    expect(luma.mock.calls[0][1]).toEqual({ x: 0, y: 60, width: 25, height: 20 });
    source.dispose();
  });

  it('keeps the canvas path for a backward step', async () => {
    const luma = vi.fn((_: number, region: FrameRegion) => Promise.resolve(lumaImage(region)));
    const server = mockServer(luma);
    const source = trackerSourceFrom(server);
    await source.getGray(2, REGION);
    await expect(source.getGray(1, REGION)).rejects.toThrow(/canvas/);
    expect(luma).toHaveBeenCalledTimes(1);
    expect(server.frameAt).toHaveBeenCalled();
    source.dispose();
  });

  it('falls back to the canvas when the server declines', async () => {
    const luma = vi.fn(() => Promise.resolve(null));
    const server = mockServer(luma);
    const source = trackerSourceFrom(server);
    await expect(source.getGray(0, REGION)).rejects.toThrow(/canvas/);
    expect(luma).toHaveBeenCalledTimes(1);
    expect(server.frameAt).toHaveBeenCalledWith(0);
    source.dispose();
  });

  it('is the canvas path on a server that has no luma read', async () => {
    const server = mockServer(undefined);
    const source = trackerSourceFrom(server);
    await expect(source.getGray(0, REGION)).rejects.toThrow(/canvas/);
    expect(server.frameAt).toHaveBeenCalledWith(0);
    source.dispose();
  });
});

describe('trackerSourceFrom with the flag off', () => {
  it('never calls the luma read', async () => {
    localStorage.removeItem(LUMA_REGION_KEY);
    const luma = vi.fn((_: number, region: FrameRegion) => Promise.resolve(lumaImage(region)));
    const server = mockServer(luma);
    const source = trackerSourceFrom(server);
    await expect(source.getGray(0, REGION)).rejects.toThrow(/canvas/);
    expect(luma).not.toHaveBeenCalled();
    expect(server.frameAt).toHaveBeenCalledWith(0);
    source.dispose();
  });
});
