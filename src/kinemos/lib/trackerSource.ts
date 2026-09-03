/**
 * trackerSource — the adapter between the frame server and the tracker.
 *
 * The tracker's `FrameSource` interface exists so the engine knows nothing about
 * WebCodecs, canvases or the frame server; this is the one place the two meet.
 * It also owns the details that would otherwise be scattered: one reusable
 * readback canvas with `willReadFrequently` set, and a **bounded** greyscale
 * cache.
 *
 * Bounded is the operative word. A 1080p frame is 1920 × 1080 × 4 bytes of
 * Float32 — 8,3 MB — so caching a 200-frame clip would be 1,66 GB and would
 * take the tab with it. The tracker walks sequentially and `trackFromAnchor`
 * makes at most two passes, so a handful of frames is all a cache can usefully
 * hold: it absorbs the re-reads around a correction and nothing else.
 */
import type { FrameServer } from '../engine/frameServer';
import type { RgbaImage } from '../engine/plateColour';
import { grayFromRgba, type FrameSource, type GrayImage } from '../engine/tracker';

export interface TrackerSource extends FrameSource {
  /** The frame in colour, for the colour assists. Not cached: a caller that
   *  wants colour reads it once per frame and moves on. */
  getRgba(index: number): Promise<RgbaImage>;
  dispose(): void;
}

/**
 * Greyscale frames kept in memory. Twelve is ~100 MB at 1080p and ~25 MB at
 * 720p — enough to cover a re-track's overlap without the allocation showing up
 * as a stutter.
 */
const GRAY_CACHE_FRAMES = 12;

export function trackerSourceFrom(server: FrameServer): TrackerSource {
  // Insertion-ordered, so the oldest key is the first one out.
  const cache = new Map<number, GrayImage>();
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  const readRgba = async (index: number): Promise<RgbaImage> => {
    const frame = await server.frameAt(index);
    const width = server.displayWidth;
    const height = server.displayHeight;

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      // Without this every readback round-trips through the GPU, and the
      // browser says so in the console once per frame.
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) throw new Error('Tracking needs a 2D canvas, which this browser did not provide.');

    ctx.drawImage(frame.canvas as CanvasImageSource, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  };

  return {
    frameCount: server.frameCount,
    timestamps: server.timestamps,

    getRgba: readRgba,

    async getGray(index: number): Promise<GrayImage> {
      const cached = cache.get(index);
      if (cached) {
        // Touch, so a frame being read repeatedly is not the one evicted.
        cache.delete(index);
        cache.set(index, cached);
        return cached;
      }

      const rgba = await readRgba(index);
      const gray = grayFromRgba(rgba.data, rgba.width, rgba.height);

      cache.set(index, gray);
      while (cache.size > GRAY_CACHE_FRAMES) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return gray;
    },

    dispose() {
      cache.clear();
      canvas = null;
      ctx = null;
    },
  };
}
