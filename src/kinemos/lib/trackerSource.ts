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
 *
 * **Regions.** The tracker says which rectangle it will read on each frame,
 * and only that rectangle is drawn and read back. Measured on the KinEMOS
 * testset (04/09/2026, 1080 × 1920 phone clips) a full-frame readback plus
 * greyscale conversion cost ~170 ms per frame — more than decoding the frame
 * — while the tracker touched a ~300 px square of it. Serving the square is
 * the difference between a track that takes a minute and one that takes as
 * long as the decode.
 */
import type { FrameServer } from '../engine/frameServer';
import {
  grayFromRgba,
  type FrameRegion,
  type FrameSource,
  type GrayImage,
} from '../engine/tracker';

/**
 * Greyscale frames kept in memory. Twelve is ~100 MB at 1080p if every entry
 * is a full frame — the worst case; region reads are a hundredth of that.
 */
const GRAY_CACHE_FRAMES = 12;

/** Intersect a requested region with the frame. Null when nothing is left. */
function clampRegion(region: FrameRegion, width: number, height: number): FrameRegion | null {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function covers(image: GrayImage, region: FrameRegion): boolean {
  const ox = image.originX ?? 0;
  const oy = image.originY ?? 0;
  return (
    ox <= region.x &&
    oy <= region.y &&
    ox + image.width >= region.x + region.width &&
    oy + image.height >= region.y + region.height
  );
}

/**
 * Frames decoded ahead, in presentation order, when the tracker is walking
 * backward. A backward pass asks for frame 59, then 58, then 57 — and every
 * one of those is a seek to the previous key frame followed by a decode of
 * everything up to the target, because video only decodes forward. Measured
 * (KinEMOS testset, 04/09/2026) that made the backward half of a track six
 * times slower per frame than the forward half. Decoding a run of frames
 * ending at the requested one, in order, costs one seek for the run; the rest
 * are then served from the frame server's own cache, which holds 24.
 */
const BACKWARD_RUN = 16;

export function trackerSourceFrom(server: FrameServer): FrameSource & { dispose(): void } {
  // Insertion-ordered, so the oldest key is the first one out.
  const cache = new Map<number, GrayImage>();
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let lastIndex = -1;

  return {
    frameCount: server.frameCount,
    timestamps: server.timestamps,

    async getGray(index: number, region?: FrameRegion): Promise<GrayImage> {
      const width = server.displayWidth;
      const height = server.displayHeight;
      const wanted = region ? clampRegion(region, width, height) : null;
      // A request entirely off the frame still gets an image — an empty one
      // would make every read out of bounds, which the tracker scores as
      // "no match" rather than as an error. One pixel is enough for that.
      const rect: FrameRegion = wanted ?? (region ? { x: 0, y: 0, width: 1, height: 1 } : { x: 0, y: 0, width, height });

      const cached = cache.get(index);
      if (cached && covers(cached, rect)) {
        // Touch, so a frame being read repeatedly is not the one evicted.
        cache.delete(index);
        cache.set(index, cached);
        return cached;
      }

      // Walking backward: decode the run that ends here, forward, one at a
      // time — the frame server takes the newest request first, so firing
      // them together would decode them in exactly the wrong order.
      if (index === lastIndex - 1) {
        for (let i = Math.max(0, index - BACKWARD_RUN + 1); i < index; i++) {
          await server.frameAt(i);
        }
      }
      lastIndex = index;

      const frame = await server.frameAt(index);

      if (!canvas) {
        canvas = document.createElement('canvas');
        // Without this every readback round-trips through the GPU, and the
        // browser says so in the console once per frame.
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) throw new Error('Tracking needs a 2D canvas, which this browser did not provide.');
      // Grow only: resizing a canvas clears it and reallocates, and the
      // tracker's regions are all about the same size.
      if (canvas.width < rect.width || canvas.height < rect.height) {
        canvas.width = Math.max(canvas.width, rect.width);
        canvas.height = Math.max(canvas.height, rect.height);
      }

      ctx.drawImage(
        frame.canvas as CanvasImageSource,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      );
      const gray = grayFromRgba(
        ctx.getImageData(0, 0, rect.width, rect.height).data,
        rect.width,
        rect.height,
      );
      gray.originX = rect.x;
      gray.originY = rect.y;

      cache.delete(index);
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
