/**
 * edges — a Canny edge mask, and nothing else.
 *
 * The one impure step of the plumb-line fit. Everything that decides which
 * edges are plumb lines, and what lens makes them straightest, is pure and
 * lives in `engine/edgeChains.ts` and `engine/distortion.ts`; this hands
 * those a boolean bitmap and gets out of the way.
 *
 * Thresholds are deliberately high. The fit wants the few strong, long,
 * man-made edges of a gym — an upright, a door frame, the line where the
 * wall meets the floor — and every weak edge it also finds is a texture that
 * curves, votes for a lens that does not exist, and costs time.
 */
import { loadOpenCv, matFromGray, type GrayLike } from './opencv';

export interface EdgeMask {
  mask: Uint8Array;
  width: number;
  height: number;
}

export interface EdgeOptions {
  /** Canny's hysteresis pair. */
  lowThreshold?: number;
  highThreshold?: number;
  /** Gaussian blur before Canny; smooths the sensor noise a phone leaves in
   *  a dim gym without rounding off the corners that matter. */
  blurSigma?: number;
}

export async function cannyEdges(gray: GrayLike, options: EdgeOptions = {}): Promise<EdgeMask> {
  const cv = await loadOpenCv();
  const src = matFromGray(cv, gray);
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  try {
    const sigma = options.blurSigma ?? 1.2;
    cv.GaussianBlur(src, blurred, new cv.Size(5, 5), sigma, sigma, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, options.lowThreshold ?? 80, options.highThreshold ?? 200, 3, false);
    const mask = new Uint8Array(gray.width * gray.height);
    const data = edges.data as Uint8Array;
    for (let i = 0; i < mask.length; i++) mask[i] = data[i] ? 1 : 0;
    return { mask, width: gray.width, height: gray.height };
  } finally {
    src.delete();
    blurred.delete();
    edges.delete();
  }
}
