/**
 * trackerSource — the adapter between the frame server and the tracker.
 *
 * The tracker's `FrameSource` interface exists so the engine knows nothing
 * about WebCodecs, canvases or the frame server; this is the one place the two
 * meet. It also owns the small performance details that would otherwise be
 * scattered: one reusable readback canvas, `willReadFrequently` set on it, and a
 * greyscale cache so a re-track after a correction does not decode the clip a
 * second time.
 */
import type { FrameServer } from '../engine/frameServer';
import { grayFromRgba, type FrameSource, type GrayImage } from '../engine/tracker';

/**
 * Wrap a frame server as a tracker source.
 *
 * Greyscale frames are cached for the life of the wrapper. A 200-frame 1080p
 * clip is ~166 MB of Float32 that way, which is why `dispose()` exists and why
 * the viewer creates one of these per tracking run rather than holding one open.
 */
export function trackerSourceFrom(server: FrameServer): FrameSource & { dispose(): void } {
  const cache = new Map<number, GrayImage>();
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  return {
    frameCount: server.frameCount,
    timestamps: server.timestamps,

    async getGray(index: number): Promise<GrayImage> {
      const cached = cache.get(index);
      if (cached) return cached;

      const frame = await server.frameAt(index);
      const width = server.displayWidth;
      const height = server.displayHeight;

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        // Without this every readback round-trips through the GPU and the
        // browser says so in the console, once per frame.
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) throw new Error('Tracking needs a 2D canvas, which this browser did not provide.');

      ctx.drawImage(frame.canvas as CanvasImageSource, 0, 0, width, height);
      const gray = grayFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
      cache.set(index, gray);
      return gray;
    },

    dispose() {
      cache.clear();
      canvas = null;
      ctx = null;
    },
  };
}
