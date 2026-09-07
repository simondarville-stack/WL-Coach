/**
 * clipGeometryCheck — does the edited clip look like the edit?
 *
 * The clip editor hands a phone's own decoder, canvas and encoder a crop, a
 * trim and a size, and trusts what comes back. One upload came back with the
 * right *declared* size and the whole frame squeezed into it — a lifter a
 * third too wide, a plate drawn as an ellipse — from a pipeline that measures
 * geometrically perfect on desktop (`verify/clip-edit-probe.html`). The
 * failure is in a device's WebCodecs or GPU-canvas path and not reproducible
 * here, so rather than guess at the driver, the editor now checks the result
 * against the source before a byte of it goes up.
 *
 * Two checks, both cheap (one frame each):
 *
 *   1. **Declared size.** The browser's `videoWidth × videoHeight` of the
 *      output must have the aspect `outputDimensions` promised. Catches an
 *      encoder or muxer that wrote a wrong display size or pixel aspect.
 *   2. **Crop honoured.** For a cropped edit, one output frame is compared
 *      against the crop region of the matching source frame *and* against the
 *      whole source frame squeezed to the output size. If the output resembles
 *      the squeezed whole frame more than the crop, the crop was ignored and
 *      the picture is stretched — the exact failure seen.
 *
 * A check that cannot run (metadata never arrives, a codec the element cannot
 * decode) passes as `checked: false`: an athlete is never blocked by a probe
 * failure, only by a measured one. Comparisons are relative, so the only way
 * to a refusal is evidence, not a threshold tuned to one clip.
 *
 * All source-rectangle reads go canvas → canvas. Drawing a *sub-rectangle* of
 * a video source is precisely the operation under suspicion, so the check
 * never leans on it: the source frame is drawn whole first, then cut.
 */
import { outputDimensions, type ClipEdit } from './videoClipEdit';

/** Relative tolerance on the output's aspect ratio. Encoders may pad a row or
 *  two; a 43 % error is what this exists to catch. */
export const ASPECT_TOLERANCE = 0.03;

/** Thumbnail edge for the frame comparison. Coarse on purpose: codec noise and
 *  a few frames of drift wash out, a 30 % squeeze does not. */
const THUMB = 32;

/**
 * The crop verdict is relative, scaled by the frame itself. `refDiff` is how
 * far apart the two hypotheses — the crop, and the whole frame squeezed to the
 * crop's box — are for this very frame (mean absolute luma, 0–255). The
 * output must sit closer to the squeezed frame than to the crop by at least
 * this fraction of that separation before the crop counts as ignored. Codec
 * noise and a frame of drift push both distances up together and cancel out
 * of the difference; a bland scene shrinks `refDiff` and the bar with it.
 */
export const CROP_IGNORED_FRACTION = 0.5;
/** Below this separation the two hypotheses look the same at thumbnail scale
 *  — a uniform wall — and there is neither evidence nor anything to see. */
export const CROP_MIN_EVIDENCE = 2;

/** Time to wait for a frame before the check gives up and passes as unchecked. */
const DEFAULT_TIMEOUT_MS = 8_000;

export type ClipGeometryVerdict =
  | { ok: true; checked: boolean }
  | {
      ok: false;
      reason: 'size' | 'crop-ignored';
      /** Human-readable, for the editor's message and the error log. */
      detail: string;
      measured: Record<string, number>;
    };

/** Whether an actual width × height has the aspect of the expected one. */
export function aspectMatches(
  actual: { width: number; height: number },
  expected: { width: number; height: number },
  tolerance = ASPECT_TOLERANCE,
): boolean {
  if (actual.width <= 0 || actual.height <= 0 || expected.width <= 0 || expected.height <= 0) {
    return false;
  }
  const a = actual.width / actual.height;
  const e = expected.width / expected.height;
  return Math.abs(a / e - 1) <= tolerance;
}

export interface FrameDistances {
  /** Output frame vs the crop region of the source frame. */
  cropDiff: number;
  /** Output frame vs the whole source frame squeezed to the output size. */
  fullDiff: number;
  /** The crop region vs the squeezed whole frame — how different the two
   *  hypotheses are for this frame, i.e. how much evidence there can be. */
  refDiff: number;
}

/**
 * Decide from the distances whether the crop was applied. Only ever accuses
 * on a *relative* result: the output must look more like the squeezed whole
 * frame than like the crop it was asked for, by a margin that is a fraction
 * of how different those two look in the first place.
 */
export function judgeCrop(d: FrameDistances): 'ok' | 'crop-ignored' {
  if (d.refDiff < CROP_MIN_EVIDENCE) return 'ok';
  return d.cropDiff - d.fullDiff > CROP_IGNORED_FRACTION * d.refDiff ? 'crop-ignored' : 'ok';
}

/** Mean absolute difference of two equal-length luma arrays. */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

/** Luma per pixel of an RGBA buffer. */
export function toLuma(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/** True when the crop is (within a hair of) the whole frame — nothing to compare. */
function isRealCrop(edit: ClipEdit): boolean {
  const c = edit.crop;
  if (!c) return false;
  return c.x > 0.005 || c.y > 0.005 || c.w < 0.995 || c.h < 0.995;
}

// ─── DOM side ──────────────────────────────────────────────────────────────

interface OpenedVideo {
  video: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  close: () => void;
}

/** Open a file in a detached <video> and wait for its first frame. */
function openVideo(file: File, timeoutMs: number): Promise<OpenedVideo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;
    const close = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
    };
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      close();
      reject(new Error(why));
    };
    const timer = window.setTimeout(() => fail('metadata timeout'), timeoutMs);
    video.onerror = () => {
      window.clearTimeout(timer);
      fail('cannot decode');
    };
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        video,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        close,
      });
    };
    video.src = url;
  });
}

/** Seek and resolve once the frame is painted. */
function seekTo(video: HTMLVideoElement, t: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('seek timeout')), timeoutMs);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    try {
      video.currentTime = t;
    } catch (e) {
      window.clearTimeout(timer);
      reject(e instanceof Error ? e : new Error('seek failed'));
    }
  });
}

function canvas2d(width: number, height: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  return ctx;
}

/** Luma thumbnail of a canvas region, via canvas → canvas only. */
function thumbOf(
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Float32Array {
  const ctx = canvas2d(THUMB, THUMB);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, THUMB, THUMB);
  return toLuma(ctx.getImageData(0, 0, THUMB, THUMB).data);
}

/**
 * Verify an edited clip against its source. Resolves — never rejects — with a
 * verdict; anything that stops the check running counts as "unchecked, allow".
 */
export async function checkEditedClip(
  source: File,
  edited: File,
  edit: ClipEdit,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ClipGeometryVerdict> {
  if (typeof document === 'undefined') return { ok: true, checked: false };
  let src: OpenedVideo | null = null;
  let out: OpenedVideo | null = null;
  try {
    [src, out] = await Promise.all([openVideo(source, timeoutMs), openVideo(edited, timeoutMs)]);
    if (!src.width || !src.height || !out.width || !out.height) {
      return { ok: true, checked: false };
    }

    // 1. Declared size: the browser lays the player out on this, so a wrong
    //    aspect here IS the distortion, whatever the pixels hold.
    const expected = outputDimensions(edit, src.width, src.height);
    if (!aspectMatches(out, expected)) {
      return {
        ok: false,
        reason: 'size',
        detail: `came back ${out.width}×${out.height}, expected ${expected.width}×${expected.height}`,
        measured: {
          sourceWidth: src.width,
          sourceHeight: src.height,
          outWidth: out.width,
          outHeight: out.height,
          expectedWidth: expected.width,
          expectedHeight: expected.height,
        },
      };
    }

    // 2. Crop honoured: only a cropped edit can have its region ignored.
    if (!isRealCrop(edit) || !edit.crop) return { ok: true, checked: true };

    // A frame a little way in, on both clips: the output's clock starts at
    // the trim start. Clamp inside both so a short clip still yields a frame.
    const span = Math.max(0.05, Math.min(edit.end - edit.start, out.duration || Infinity));
    const delta = Math.min(0.35, span / 2);
    await Promise.all([
      seekTo(src.video, edit.start + delta, timeoutMs),
      seekTo(out.video, delta, timeoutMs),
    ]);

    // Whole source frame at reduced size, drawn without a source rectangle.
    const scale = Math.min(1, 480 / Math.max(src.width, src.height));
    const fw = Math.max(1, Math.round(src.width * scale));
    const fh = Math.max(1, Math.round(src.height * scale));
    const full = canvas2d(fw, fh);
    full.drawImage(src.video, 0, 0, fw, fh);

    // Whole output frame, likewise.
    const ow = Math.max(1, Math.round(out.width * Math.min(1, 480 / Math.max(out.width, out.height))));
    const oh = Math.max(1, Math.round(out.height * Math.min(1, 480 / Math.max(out.width, out.height))));
    const outCanvas = canvas2d(ow, oh);
    outCanvas.drawImage(out.video, 0, 0, ow, oh);

    const c = edit.crop;
    const outThumb = thumbOf(outCanvas.canvas, 0, 0, ow, oh);
    const cropThumb = thumbOf(full.canvas, c.x * fw, c.y * fh, c.w * fw, c.h * fh);
    const fullThumb = thumbOf(full.canvas, 0, 0, fw, fh);

    const distances: FrameDistances = {
      cropDiff: meanAbsDiff(outThumb, cropThumb),
      fullDiff: meanAbsDiff(outThumb, fullThumb),
      refDiff: meanAbsDiff(cropThumb, fullThumb),
    };
    if (judgeCrop(distances) === 'crop-ignored') {
      return {
        ok: false,
        reason: 'crop-ignored',
        detail:
          `the whole frame was squeezed into the crop's ${out.width}×${out.height} ` +
          `(distance to crop ${distances.cropDiff.toFixed(1)}, to squeezed frame ${distances.fullDiff.toFixed(1)}, ` +
          `between them ${distances.refDiff.toFixed(1)})`,
        measured: {
          sourceWidth: src.width,
          sourceHeight: src.height,
          outWidth: out.width,
          outHeight: out.height,
          cropDiff: distances.cropDiff,
          fullDiff: distances.fullDiff,
          refDiff: distances.refDiff,
        },
      };
    }
    return { ok: true, checked: true };
  } catch {
    return { ok: true, checked: false };
  } finally {
    src?.close();
    out?.close();
  }
}
