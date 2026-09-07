/**
 * lumaRegion — the Y plane of a region, straight from the decoded frame.
 *
 * The tracker reads greyscale over a ~300 px square per frame. Today that
 * square is drawn from the decoded frame onto a canvas, read back as RGBA and
 * converted to luma — the frame server's decode-to-canvas is ~50–100 ms per
 * frame on 1080p phone footage while the correlation is 6–15 ms, so the
 * canvas is now the whole cost of a track (P2 plan §4, P6 plan §4).
 *
 * A decoded `VideoFrame` already holds luma as its first plane in every
 * format a hardware decoder produces (NV12, I420 and kin), and `copyTo` with
 * a `rect` copies only that rectangle. This module does the two things that
 * make such a copy usable by the tracker:
 *
 *   1. **Rotation.** Phones record portrait video unrotated and mark the
 *      container; the frame server applies the rotation on the way to the
 *      canvas, so every coordinate the viewer stores is in DISPLAY space. The
 *      region the tracker asks for is a display rect; it is mapped back to
 *      the coded frame for the copy (the same mapping mediabunny's canvas
 *      draw uses), and the copied bytes are turned back into display
 *      orientation, so the tracker sees exactly the picture it sees today.
 *   2. **Alignment.** Chroma-subsampled formats require the rect on an even
 *      grid; the coded rect is widened outward to it, and the image served
 *      is correspondingly larger than asked — which `FrameSource.getGray`
 *      permits ("any image that covers the region, with its origin set").
 *
 * Values: the decoder's luma is video-range Y′ (16–235) where the canvas
 * path yields full-range luma of the expanded RGB. That is an affine change,
 * and the tracker's normalised cross-correlation is invariant to it by
 * construction; nothing else reads these images.
 *
 * Engine purity: no DOM types beyond the structural `LumaFrameLike`, no
 * imports outside the engine. A test hands in a plain object.
 */
import type { FrameRegion, GrayImage } from './tracker';

/** Container rotation, degrees clockwise — the values a container can carry. */
export type Rotation = 0 | 90 | 180 | 270;

/** One plane of a copied frame: where it starts in the buffer and its row
 *  pitch, in bytes. The shape `VideoFrame.copyTo` resolves with. */
export interface PlaneLayoutLike {
  offset: number;
  stride: number;
}

/**
 * What the read needs from a decoded frame — the part of `VideoFrame` (and of
 * mediabunny's `VideoSample`, which mirrors it) that is touched. Structural,
 * so a unit test can supply a plain object in place of a decoder.
 */
export interface LumaFrameLike {
  readonly format: string | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  allocationSize(options: { rect: FrameRegion }): number;
  copyTo(
    destination: Uint8Array,
    options: { rect: FrameRegion },
  ): Promise<ReadonlyArray<PlaneLayoutLike>>;
}

/** Formats whose plane 0 is luma, one byte per sample. */
const LUMA_PLANE_FORMATS: ReadonlySet<string> = new Set(['I420', 'I420A', 'I422', 'I444', 'NV12']);
/** Formats with no luma plane: luma is weighted from the bytes, in this order
 *  of (r, g, b) offsets within a four-byte pixel. */
const RGB_FORMATS: Readonly<Record<string, readonly [number, number, number]>> = {
  RGBA: [0, 1, 2],
  RGBX: [0, 1, 2],
  BGRA: [2, 1, 0],
  BGRX: [2, 1, 0],
};

/** Whether a frame in `format` can be read here at all. Null (an internal
 *  format WebCodecs does not name) and anything else falls back to the
 *  canvas path. */
export function lumaReadable(format: string | null): boolean {
  return format !== null && (LUMA_PLANE_FORMATS.has(format) || format in RGB_FORMATS);
}

/** Display dimensions of a coded frame under `rotation`. */
export function displaySizeOf(
  rotation: Rotation,
  codedWidth: number,
  codedHeight: number,
): { width: number; height: number } {
  return rotation % 180 === 0
    ? { width: codedWidth, height: codedHeight }
    : { width: codedHeight, height: codedWidth };
}

/**
 * A display-space rect mapped onto the coded (unrotated) frame — the mapping
 * mediabunny's `VideoSample.draw` applies to its source rect, spelled out so
 * a test can hold it against the whole-image rotation.
 */
export function displayToCoded(
  rect: FrameRegion,
  rotation: Rotation,
  codedWidth: number,
  codedHeight: number,
): FrameRegion {
  const { x, y, width, height } = rect;
  switch (rotation) {
    case 90:
      return { x: y, y: codedHeight - x - width, width: height, height: width };
    case 180:
      return { x: codedWidth - x - width, y: codedHeight - y - height, width, height };
    case 270:
      return { x: codedWidth - y - height, y: x, width: height, height: width };
    default:
      return { x, y, width, height };
  }
}

/** The inverse of `displayToCoded`. */
export function codedToDisplay(
  rect: FrameRegion,
  rotation: Rotation,
  codedWidth: number,
  codedHeight: number,
): FrameRegion {
  const { x, y, width, height } = rect;
  switch (rotation) {
    case 90:
      return { x: codedHeight - y - height, y: x, width: height, height: width };
    case 180:
      return { x: codedWidth - x - width, y: codedHeight - y - height, width, height };
    case 270:
      return { x: y, y: codedWidth - x - width, width: height, height: width };
    default:
      return { x, y, width, height };
  }
}

/**
 * Clamp a rect to the frame and widen it outward onto a grid of `align`
 * pixels — chroma-subsampled formats refuse a copy rect on odd coordinates.
 * Null when nothing of the rect is on the frame.
 */
export function alignOutward(
  rect: FrameRegion,
  frameWidth: number,
  frameHeight: number,
  align: number,
): FrameRegion | null {
  const a = Math.max(1, Math.round(align));
  let x0 = Math.max(0, Math.floor(rect.x));
  let y0 = Math.max(0, Math.floor(rect.y));
  let x1 = Math.min(frameWidth, Math.ceil(rect.x + rect.width));
  let y1 = Math.min(frameHeight, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  x0 -= x0 % a;
  y0 -= y0 % a;
  x1 = Math.min(frameWidth, Math.ceil(x1 / a) * a);
  y1 = Math.min(frameHeight, Math.ceil(y1 / a) * a);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Turn copied plane bytes into a display-oriented `GrayImage`.
 *
 * `coded` is the rect the bytes were copied from and `display` is the same
 * rect in display space (`codedToDisplay`); each display pixel (i, j) is read
 * from the coded sample it came from under the clockwise rotation.
 */
export function lumaToGray(
  bytes: Uint8Array,
  plane: PlaneLayoutLike,
  coded: FrameRegion,
  display: FrameRegion,
  rotation: Rotation,
  pixel: { bytesPerSample: number; rgb?: readonly [number, number, number] },
): GrayImage {
  const cw = coded.width;
  const ch = coded.height;
  const dw = display.width;
  const dh = display.height;
  const { offset, stride } = plane;
  const bps = pixel.bytesPerSample;
  const rgb = pixel.rgb;
  const data = new Float32Array(dw * dh);
  for (let j = 0; j < dh; j++) {
    for (let i = 0; i < dw; i++) {
      let u: number;
      let v: number;
      switch (rotation) {
        case 90:
          u = j;
          v = ch - 1 - i;
          break;
        case 180:
          u = cw - 1 - i;
          v = ch - 1 - j;
          break;
        case 270:
          u = cw - 1 - j;
          v = i;
          break;
        default:
          u = i;
          v = j;
      }
      const at = offset + v * stride + u * bps;
      data[j * dw + i] = rgb
        ? 0.299 * bytes[at + rgb[0]] + 0.587 * bytes[at + rgb[1]] + 0.114 * bytes[at + rgb[2]]
        : bytes[at];
    }
  }
  return { width: dw, height: dh, data, originX: display.x, originY: display.y };
}

/**
 * Read the luma of a display-space `region` from a decoded frame.
 *
 * Resolves null when the frame's format cannot be read here or the region
 * lies wholly off the frame — the caller falls back to the canvas path. The
 * image returned covers at least the region (clamped to the frame), with
 * `originX`/`originY` saying where it sits.
 */
export async function readLumaRegion(
  frame: LumaFrameLike,
  region: FrameRegion,
  rotation: Rotation,
): Promise<GrayImage | null> {
  const format = frame.format;
  if (!lumaReadable(format)) return null;
  const rgb = format !== null ? RGB_FORMATS[format] : undefined;
  const planar = rgb === undefined;

  const { codedWidth, codedHeight } = frame;
  const size = displaySizeOf(rotation, codedWidth, codedHeight);
  const onFrame = alignOutward(region, size.width, size.height, 1);
  if (!onFrame) return null;
  const coded = alignOutward(
    displayToCoded(onFrame, rotation, codedWidth, codedHeight),
    codedWidth,
    codedHeight,
    planar ? 2 : 1,
  );
  if (!coded) return null;

  const buffer = new Uint8Array(frame.allocationSize({ rect: coded }));
  const layout = await frame.copyTo(buffer, { rect: coded });
  const plane = layout[0];
  if (!plane) return null;

  const display = codedToDisplay(coded, rotation, codedWidth, codedHeight);
  return lumaToGray(buffer, plane, coded, display, rotation, {
    bytesPerSample: planar ? 1 : 4,
    rgb,
  });
}
