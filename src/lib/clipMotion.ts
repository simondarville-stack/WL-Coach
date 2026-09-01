/**
 * clipMotion — find the lift in a clip, so the trim can be suggested rather
 * than hunted for.
 *
 * The problem this solves is storage and a coach's attention, in that order:
 * an athlete films three minutes of approaching the bar, lifting, and walking
 * away, and every byte of the approach costs upload time and bucket space for
 * footage nobody reviews.
 *
 * ## How the lift is spotted
 *
 * Frames are sampled at a low rate, downscaled hard, and reduced to one number
 * each: the mean absolute luma difference from the previous sample — "how much
 * changed". Walking about the platform is sustained, low-amplitude change; the
 * pull, turnover and catch are a short burst of large-amplitude change, and a
 * dropped barbell is larger still. So the lift is not merely *motion*, it is
 * the **peak** of motion against the clip's own baseline, which is what
 * separates it from the athlete strolling into frame.
 *
 * That is deliberately a heuristic and it will not always be right — hence a
 * *suggestion*, applied to handles the athlete can immediately drag, and
 * withheld entirely when the signal has no clear peak (a static clip, a camera
 * pan, two lifters on one platform).
 *
 * The analysis pass needs mediabunny's decoder and so is dynamically imported;
 * `suggestTrimFromMotion` is pure and carries the judgement.
 */

/** One sampled frame: when it was, and how much changed since the last one. */
export interface MotionSample {
  /** Seconds into the clip. */
  t: number;
  /** Mean absolute luma difference from the previous sample, 0–1. */
  energy: number;
}

export interface TrimSuggestion {
  start: number;
  end: number;
  /** 0–1: how far the peak stands above the clip's baseline. Below
   *  MIN_CONFIDENCE no suggestion is offered at all. */
  confidence: number;
}

/** Frames are downscaled to this width before differencing. Motion of a whole
 *  barbell survives it, sensor noise and compression mush do not. */
const ANALYSIS_WIDTH = 64;

/** Sampling ceiling, and the cap on total frames decoded. A phone decoding
 *  4K has to get through this while the athlete waits, so the rate drops on
 *  long clips: 3 minutes samples at ~1.7 fps, which still puts several samples
 *  inside a lift. */
const MAX_SAMPLE_RATE = 8;
const MAX_SAMPLES = 300;

/** How far above baseline a peak must stand to count as an event at all. */
const MIN_CONFIDENCE = 0.35;

/** Seconds of run-up and run-out kept around the detected burst — the setup
 *  breath before the pull, and the catch plus recovery after it.
 *  COACH-CONFIG candidates. */
export const TRIM_PAD_BEFORE = 1.5;
export const TRIM_PAD_AFTER = 2;
/** Never suggest a window shorter than this; a 2 s clip is not reviewable. */
export const TRIM_MIN_SECONDS = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface SuggestTrimOptions {
  /** Full length of the clip, in seconds. */
  duration: number;
  /** Upper bound on the suggested window, or null where the surface has none. */
  maxSeconds?: number | null;
  padBefore?: number;
  padAfter?: number;
  minSeconds?: number;
}

/**
 * Turn a motion signal into a trim window, or null when there is no clear
 * event to trim to.
 *
 * Returning null is a real outcome, not a failure: a clip with uniform motion
 * has no "the lift" to find, and a wrong suggestion applied to the handles is
 * worse than none.
 */
export function suggestTrimFromMotion(
  samples: MotionSample[],
  {
    duration,
    maxSeconds = null,
    padBefore = TRIM_PAD_BEFORE,
    padAfter = TRIM_PAD_AFTER,
    minSeconds = TRIM_MIN_SECONDS,
  }: SuggestTrimOptions,
): TrimSuggestion | null {
  // Too few samples to tell a peak from noise.
  if (samples.length < 6 || duration <= 0) return null;

  const energies = samples.map(s => s.energy);
  const baseline = median(energies);
  const peak = Math.max(...energies);
  if (peak <= 0) return null;

  // Confidence is how much of the peak is *above* the clip's own resting
  // level, so a shaky handheld clip (high baseline) needs a bigger burst to
  // qualify than a tripod one.
  const confidence = (peak - baseline) / peak;
  if (confidence < MIN_CONFIDENCE) return null;

  const peakIndex = energies.indexOf(peak);
  const threshold = baseline + (peak - baseline) * 0.35;

  // Walk out from the peak while the signal stays hot, tolerating one quiet
  // sample — the float between the second pull and the catch dips, and
  // stopping there would clip the turnover off the end.
  const GAP_TOLERANCE = 1;
  let lo = peakIndex;
  for (let i = peakIndex - 1, gap = 0; i >= 0; i--) {
    if (energies[i] >= threshold) {
      lo = i;
      gap = 0;
    } else if (++gap > GAP_TOLERANCE) break;
  }
  let hi = peakIndex;
  for (let i = peakIndex + 1, gap = 0; i < samples.length; i++) {
    if (energies[i] >= threshold) {
      hi = i;
      gap = 0;
    } else if (++gap > GAP_TOLERANCE) break;
  }

  let start = Math.max(0, samples[lo].t - padBefore);
  let end = Math.min(duration, samples[hi].t + padAfter);

  // Grow a too-short window around its centre, then clamp back into the clip.
  if (end - start < minSeconds) {
    const centre = (start + end) / 2;
    start = Math.max(0, centre - minSeconds / 2);
    end = Math.min(duration, start + minSeconds);
    start = Math.max(0, end - minSeconds);
  }

  // Shrink a too-long window around the peak rather than its centre: if
  // something has to go, it should be the run-up, not the lift.
  if (maxSeconds != null && end - start > maxSeconds) {
    const peakT = samples[peakIndex].t;
    start = Math.max(0, Math.min(peakT - padBefore, duration - maxSeconds));
    end = Math.min(duration, start + maxSeconds);
  }

  // A window that spans essentially the whole clip is not a suggestion, it is
  // noise wearing a suggestion's clothes.
  if (end - start >= duration * 0.95) return null;

  return { start, end, confidence };
}

export interface AnalyseClipMotionOptions {
  signal?: AbortSignal;
  /** 0–1, for a progress hint while the athlete waits. */
  onProgress?: (progress: number) => void;
}

/**
 * Decode a clip at a low frame rate and reduce it to a motion signal.
 *
 * Uses mediabunny's CanvasSink at a tiny output width, over a monotonic list
 * of timestamps, so each packet is decoded at most once — seeking a <video>
 * element frame by frame would be an order of magnitude slower and is what
 * makes this viable on a phone at all.
 */
export async function analyseClipMotion(
  file: File,
  { signal, onProgress }: AnalyseClipMotionOptions = {},
): Promise<MotionSample[]> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import('mediabunny');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return [];

  const duration = await track.computeDuration();
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const rate = Math.min(MAX_SAMPLE_RATE, MAX_SAMPLES / duration);
  const step = 1 / rate;
  const timestamps: number[] = [];
  for (let t = 0; t < duration; t += step) timestamps.push(t);
  if (timestamps.length < 6) return [];

  const sink = new CanvasSink(track, { width: ANALYSIS_WIDTH, poolSize: 2 });

  // One owned canvas to read pixels from: the sink's canvas may be an
  // OffscreenCanvas or an HTMLCanvasElement, and drawing into ours makes the
  // read path identical either way.
  const scratch = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D | null = null;

  const samples: MotionSample[] = [];
  let previous: Uint8ClampedArray | null = null;
  let index = 0;

  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    if (signal?.aborted) return samples;
    index += 1;
    onProgress?.(index / timestamps.length);
    if (!wrapped) continue;

    const { canvas, timestamp } = wrapped;
    if (!ctx) {
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) return [];
    }
    ctx.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);

    // Luma only — colour adds nothing to "did this pixel change" and a third
    // of the arithmetic here runs per pixel per frame.
    const luma = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }

    if (previous) {
      let total = 0;
      for (let p = 0; p < luma.length; p++) total += Math.abs(luma[p] - previous[p]);
      samples.push({ t: timestamp, energy: total / luma.length / 255 });
    }
    previous = luma;
  }

  return samples;
}
