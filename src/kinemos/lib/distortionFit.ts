/**
 * distortionFit — measuring a clip's lens from the gym in the background.
 *
 * Design §6.1's profile tier asks for "a per-athlete stored checkerboard
 * photo/frame". That route is closed here on two counts, and the second is
 * the interesting one:
 *
 *   1. The OpenCV build KinEMOS ships has no `findChessboardCorners` and no
 *      `calibrateCamera` — they are absent from the WASM, whatever the
 *      TypeScript stubs declare (probed 03/09/2026).
 *   2. **No coach is going to print a checkerboard.** A tier that needs one
 *      is a tier nobody climbs, and the design's own framing — "everything
 *      works without it, grade reflects it" — admits as much.
 *
 * So the profile is measured from what is already in every clip: the gym is
 * full of things that are straight. A rack upright, a door frame, the line
 * where the wall meets the floor, the platform's edge. Whatever lens makes
 * the most of those straightest is the lens (the plumb-line method, and the
 * oldest trick in camera calibration). It needs no equipment, no cooperation
 * and no second recording — only the clip the coach already has.
 *
 * Several frames, one fit. A lifter walks through the shot and hides an
 * upright; a frame at the top of the pull has different edges from one at
 * the floor. Pooling the chains from a handful of frames spread across the
 * clip is both more robust and cheaper than fitting each and arguing about
 * the median.
 *
 * What this cannot do: separate the lens from a genuinely crooked gym. A rack
 * that leans is straight in the picture and the fit will believe it. The
 * guard is the refusal in `fitDistortion` — too few chains, or too little
 * improvement, and the answer is "no model", which leaves the analysis on
 * the convention tier exactly as before.
 */
import type { PxPoint } from '../engine/calibration';
import { selectPlumbLines, traceChains, type ChainOptions } from '../engine/edgeChains';
import { MIN_SENSITIVITY, fitDistortion, probeSensitivity, type DistortionFit } from '../engine/distortion';
import type { FrameServer } from '../engine/frameServer';
import { cannyEdges, type EdgeOptions } from '../cv/edges';
import { trackerSourceFrom } from './trackerSource';

export interface DistortionFitOptions {
  /** How many frames to pool edges from, spread across the clip. */
  frames?: number;
  edges?: EdgeOptions;
  chains?: ChainOptions;
  onProgress?: (done: number, total: number) => void;
}

export interface ClipDistortionFit extends DistortionFit {
  /** How many frames the chains came from. */
  framesUsed: number;
}

export interface ClipDistortionResult {
  fit: ClipDistortionFit | null;
  /** Candidate plumb lines found across all the frames looked at. */
  chainsFound: number;
  framesUsed: number;
  /**
   * Why there is or is not a lens. The two failures are different problems
   * and want different words in front of a coach: a hall with nothing
   * straight in shot is not the same as a lens with nothing to correct, and
   * only the first is worth trying again on another clip.
   */
  reason: 'fitted' | 'no-edges' | 'insensitive' | 'no-improvement';
  /** How much a typical lens WOULD move these edges, as a share of their own
   *  noise. Below `MIN_SENSITIVITY` nothing measured here means anything. */
  sensitivity: number;
}

/**
 * The lens this clip was shot through, with the evidence either way.
 */
export async function fitClipDistortion(
  server: FrameServer,
  options: DistortionFitOptions = {},
): Promise<ClipDistortionResult> {
  const wanted = Math.max(1, options.frames ?? 5);
  const source = trackerSourceFrom(server);
  try {
    const total = Math.min(wanted, server.frameCount);
    const chains: PxPoint[][] = [];
    let framesUsed = 0;
    for (let i = 0; i < total; i++) {
      // Spread across the clip rather than clustered at the start: the first
      // second of a lift is often the lifter standing in front of the rack.
      const index = Math.min(server.frameCount - 1, Math.round(((i + 0.5) / total) * server.frameCount));
      const gray = await source.getGray(index);
      const { mask, width, height } = await cannyEdges(gray, options.edges);
      const found = selectPlumbLines(traceChains(mask, width, height), width, height, options.chains);
      chains.push(...found);
      framesUsed++;
      options.onProgress?.(framesUsed, total);
    }
    // Pooling several frames means the same upright is counted several
    // times, so ask for more chains than a single frame would need.
    const minChains = Math.max(3, framesUsed);
    const sensitivity = probeSensitivity(chains, server.displayWidth, server.displayHeight);
    const base = { chainsFound: chains.length, framesUsed, sensitivity };
    if (chains.length < minChains) return { fit: null, reason: 'no-edges', ...base };
    if (sensitivity < MIN_SENSITIVITY) return { fit: null, reason: 'insensitive', ...base };
    const fit = fitDistortion(chains, server.displayWidth, server.displayHeight, { minChains });
    return fit
      ? { fit: { ...fit, framesUsed }, reason: 'fitted', ...base }
      : { fit: null, reason: 'no-improvement', ...base };
  } finally {
    source.dispose();
  }
}

/**
 * What a refusal means, in the coach's terms — and the three are genuinely
 * different answers, which is why they are three sentences and not one.
 */
export function describeRefusal(result: ClipDistortionResult): string {
  const edges = `${result.chainsFound} straight edge${result.chainsFound === 1 ? '' : 's'}`;
  switch (result.reason) {
    case 'no-edges':
      return `Nothing straight enough to measure against — ${edges} across ${result.framesUsed} frames. A clip with a rack upright, a door frame or the wall-floor line in shot will do better.`;
    case 'insensitive':
      return (
        `${edges} found, but they are too short to tell: bending them by a typical phone lens would move them ` +
        `${(result.sensitivity * 100).toFixed(0)} % of their own pixel noise. This says nothing about the lens either way — ` +
        `it needs a longer straight edge, further from the middle of the frame, and ideally the clip at full resolution.`
      );
    default:
      return `${edges} found, long enough to have shown a lens, and no correction makes them meaningfully straighter. Nothing here worth removing; the clip stays on the convention tier.`;
  }
}

/** How a fit reads in the calibration panel. */
export function describeFit(fit: ClipDistortionFit): string {
  const kind = fit.model.k1 < 0 ? 'barrel' : 'pincushion';
  const pct = (fit.improvement * 100).toFixed(0);
  return (
    `${kind} k₁ ${fit.model.k1.toFixed(3)} from ${fit.chains} straight edges on ${fit.framesUsed} frames — ` +
    `they are ${pct} % straighter corrected (${fit.residualBeforePx.toFixed(2)} → ${fit.residualAfterPx.toFixed(2)} px).`
  );
}
