/**
 * clipConservativeRender — the fallback way to draw an edited frame.
 *
 * mediabunny renders a crop, rotation and resize in one `drawImage` call: a
 * *sub-rectangle* of the decoded `VideoFrame`, through a rotated, scaled
 * canvas transform, into the output box. Correct everywhere it has been
 * measured, and the fast path. But a device that gets one of those three
 * things wrong — a GPU canvas that ignores the source rectangle on a hardware
 * frame, say — produces a picture with the right size and the wrong pixels,
 * and nothing in the pipeline notices.
 *
 * This renderer is what the editor falls back to when `clipGeometryCheck`
 * measures such a result. It does the same job in three of the most ordinary
 * canvas operations there are, each of which browsers get right on every
 * surface:
 *
 *   1. draw the decoded frame **whole** onto a canvas — no source rectangle,
 *      no transform, no scale;
 *   2. rotate that canvas onto a second one, again whole;
 *   3. cut the crop out of the rotated canvas into the output box —
 *      canvas → canvas, the one source-rectangle draw that never fails.
 *
 * Three full-size draws per frame instead of one, so slower; a retry path,
 * not the default. Registered with mediabunny once, and it answers only while
 * a conversion has asked for it, so it never touches the normal pipeline.
 */
import type { VideoSample, VideoSampleTransformationDescription } from 'mediabunny';

let registered = false;
let active = 0;

/** Reused between frames so a 1080p retry does not allocate per frame. */
const stage: {
  flat: OffscreenCanvas | null;
  rotated: OffscreenCanvas | null;
  out: OffscreenCanvas | null;
} = { flat: null, rotated: null, out: null };

function canvasOf(slot: keyof typeof stage, width: number, height: number): OffscreenCanvas {
  let c = stage[slot];
  if (!c || c.width !== width || c.height !== height) {
    c = new OffscreenCanvas(width, height);
    stage[slot] = c;
  }
  return c;
}

function ctxOf(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  return ctx;
}

/**
 * The transformer itself. Exported for the browser harness, which runs it on
 * synthetic frames next to mediabunny's own and compares the two.
 */
export function conservativeTransform(
  sample: VideoSample,
  d: VideoSampleTransformationDescription,
  VideoSampleCtor: new (
    data: OffscreenCanvas,
    init: { timestamp: number; duration: number; rotation: 0 },
  ) => VideoSample,
): VideoSample | null {
  // The editor only ever asks for exact pixels; anything else stays with
  // mediabunny, whose 'contain'/'cover' maths this does not duplicate.
  if (d.fit !== 'fill') return null;
  if (typeof OffscreenCanvas === 'undefined') return null;

  // 1. The frame as decoded, square pixels, no rotation applied.
  const uw = sample.squarePixelWidth;
  const uh = sample.squarePixelHeight;
  const flat = canvasOf('flat', uw, uh);
  const flatCtx = ctxOf(flat);
  flatCtx.drawImage(sample.toCanvasImageSource(), 0, 0, uw, uh);

  // 2. Rotated whole. `d.rotation` is the total rotation to bake in.
  const [rw, rh] = d.rotation % 180 === 0 ? [uw, uh] : [uh, uw];
  const rotated = canvasOf('rotated', rw, rh);
  const rotCtx = ctxOf(rotated);
  rotCtx.save();
  rotCtx.setTransform(1, 0, 0, 1, 0, 0);
  rotCtx.translate(rw / 2, rh / 2);
  rotCtx.rotate((d.rotation * Math.PI) / 180);
  rotCtx.drawImage(flat, -uw / 2, -uh / 2);
  rotCtx.restore();

  // 3. The crop, cut from the rotated canvas into the output box.
  const c = d.crop;
  const left = Math.max(0, Math.min(rw - 1, c.left));
  const top = Math.max(0, Math.min(rh - 1, c.top));
  const width = Math.max(1, Math.min(rw - left, c.width));
  const height = Math.max(1, Math.min(rh - top, c.height));
  const out = canvasOf('out', d.width, d.height);
  const outCtx = ctxOf(out);
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(rotated, left, top, width, height, 0, 0, d.width, d.height);

  return new VideoSampleCtor(out, { timestamp: sample.timestamp, duration: sample.duration, rotation: 0 });
}

/**
 * Turn the renderer on for the duration of one conversion. Returns the
 * function that turns it off again; call it in a `finally`.
 */
export async function withConservativeRender(): Promise<() => void> {
  const { registerVideoSampleTransformer, VideoSample: Ctor } = await import('mediabunny');
  if (!registered) {
    registered = true;
    registerVideoSampleTransformer((sample, description) =>
      active > 0 ? conservativeTransform(sample, description, Ctor) : null,
    );
  }
  active += 1;
  return () => {
    active = Math.max(0, active - 1);
  };
}
