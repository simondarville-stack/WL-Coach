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
 * Frames are sampled at a low rate, downscaled hard, and reduced to two
 * numbers each:
 *
 *   - **energy** — mean absolute luma difference from the previous sample,
 *     i.e. "how much changed". Walking about the platform is sustained,
 *     low-amplitude change; the pull, turnover and catch are a short burst of
 *     large-amplitude change, and a dropped barbell is larger still. So the
 *     lift is not merely *motion*, it is the **peak** of motion against the
 *     clip's own baseline — which is what separates it from the athlete
 *     strolling into frame.
 *   - **verticality** — how much of that change is explained by things moving
 *     *up or down* rather than side to side, from coarse block matching. This
 *     is what a barbell does and a coach walking past the camera does not, so
 *     weighting by it sharpens the lift against a busy platform.
 *
 * That is deliberately a heuristic and it will not always be right — hence a
 * *suggestion*, applied to handles the athlete can immediately drag, and
 * withheld entirely when the signal has no clear peak (a static clip, a camera
 * pan).
 *
 * A clip often holds several lifts — an athlete films a set of three singles
 * in one take — so `findLifts` returns every burst it can defend, and the
 * editor offers to split them into a clip each. `suggestTrimFromMotion` is the
 * single-window case built on the same pass.
 *
 * The analysis needs mediabunny's decoder and so is dynamically imported;
 * everything that carries judgement is pure and tested.
 */

/** One sampled frame: when it was, and how the picture changed since the last. */
export interface MotionSample {
  /** Seconds into the clip. */
  t: number;
  /** Mean absolute luma difference from the previous sample, 0–1. */
  energy: number;
  /**
   * Share of the change explained by vertical rather than horizontal
   * displacement, 0–1. 0.5 is "no opinion" — either both equally, or too
   * little motion to tell — and is what an absent value is treated as, so a
   * signal built without it behaves exactly as it did before weighting.
   */
  verticality?: number;
}

/**
 * How hard verticality pushes the energy around: a purely vertical sample
 * counts 1.5×, a purely horizontal one 0.5×, and 0.5 verticality is neutral.
 *
 * Deliberately a nudge rather than a gate. A snatch is emphatically vertical,
 * but a jerk drive carries the athlete under the bar and a save on a squat is
 * half sideways — scoring only vertical motion would lose those.
 * COACH-CONFIG candidate.
 */
const VERTICAL_BIAS = 1;

/** Energy after the vertical nudge — the signal every decision below reads. */
export function weightedEnergy(sample: MotionSample): number {
  const verticality = sample.verticality ?? 0.5;
  return sample.energy * (1 + VERTICAL_BIAS * (verticality - 0.5));
}

/** One detected lift within a clip. */
export interface LiftSegment {
  start: number;
  end: number;
  /** 0–1: how far this burst's peak stands above the clip's baseline. */
  confidence: number;
}

/** Most clips hold one lift and some hold a set of six. Past that the
 *  detection is almost certainly reading something other than lifting. */
const MAX_LIFTS = 6;

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

/** Block-matching grid, in analysis pixels. Small enough that a barbell and
 *  the lifter behind it occupy several blocks, large enough that one block
 *  carries more signal than noise. */
const BLOCK = 8;
/** Vertical/horizontal displacement searched per block, in analysis pixels.
 *  At ANALYSIS_WIDTH a fast barbell moves a few pixels between samples. */
const SEARCH = 3;
/** Mean per-pixel change below which a block is background, not motion.
 *  Scoring direction on sensor noise would be reading tea leaves. */
const BLOCK_NOISE_FLOOR = 6 / 255;

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
 * Find every lift in a clip.
 *
 * Returns them in time order, each already padded with run-up and run-out and
 * clamped to the clip and to `maxSeconds`. An empty array is a real outcome,
 * not a failure: a clip with uniform motion has no "the lift" in it, and a
 * wrong suggestion is worse than none.
 */
export function findLifts(
  samples: MotionSample[],
  {
    duration,
    maxSeconds = null,
    padBefore = TRIM_PAD_BEFORE,
    padAfter = TRIM_PAD_AFTER,
    minSeconds = TRIM_MIN_SECONDS,
  }: SuggestTrimOptions,
): LiftSegment[] {
  // Too few samples to tell a peak from noise.
  if (samples.length < 6 || duration <= 0) return [];

  const energies = samples.map(weightedEnergy);
  const baseline = median(energies);
  const peak = Math.max(...energies);
  if (peak <= 0) return [];

  // Confidence is how much of a peak stands *above* the clip's own resting
  // level, so a shaky handheld clip (high baseline) needs a bigger burst to
  // qualify than a tripod one.
  if ((peak - baseline) / peak < MIN_CONFIDENCE) return [];

  const threshold = baseline + (peak - baseline) * 0.35;

  // Collect every run above the threshold, tolerating one quiet sample inside
  // a run — the float between the second pull and the catch dips, and breaking
  // there would cut the turnover off the end of a lift.
  const GAP_TOLERANCE = 1;
  const runs: { from: number; to: number }[] = [];
  let current: { from: number; to: number } | null = null;
  let gap = 0;
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] >= threshold) {
      if (current) current.to = i;
      else current = { from: i, to: i };
      gap = 0;
    } else if (current && ++gap > GAP_TOLERANCE) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);

  const segments: LiftSegment[] = [];
  for (const run of runs) {
    let runPeak = 0;
    let peakIndex = run.from;
    for (let i = run.from; i <= run.to; i++) {
      if (energies[i] > runPeak) {
        runPeak = energies[i];
        peakIndex = i;
      }
    }
    // Judge each run on its own merit, so a wobble beside a big lift is not
    // promoted to a lift just by sharing the clip with one.
    const confidence = (runPeak - baseline) / runPeak;
    if (confidence < MIN_CONFIDENCE) continue;

    let segStart = Math.max(0, samples[run.from].t - padBefore);
    let segEnd = Math.min(duration, samples[run.to].t + padAfter);

    // Grow a too-short window around its centre, then clamp back into the clip.
    if (segEnd - segStart < minSeconds) {
      const centre = (segStart + segEnd) / 2;
      segStart = Math.max(0, centre - minSeconds / 2);
      segEnd = Math.min(duration, segStart + minSeconds);
      segStart = Math.max(0, segEnd - minSeconds);
    }

    // Shrink a too-long window around the peak rather than its centre: if
    // something has to go, it should be the run-up, not the lift.
    if (maxSeconds != null && segEnd - segStart > maxSeconds) {
      const peakT = samples[peakIndex].t;
      segStart = Math.max(0, Math.min(peakT - padBefore, duration - maxSeconds));
      segEnd = Math.min(duration, segStart + maxSeconds);
    }

    segments.push({ start: segStart, end: segEnd, confidence });
  }

  // Padding can make neighbouring bursts overlap. Two lifts two seconds apart
  // are one clip in practice, so merge rather than emit clips that repeat each
  // other's footage.
  const merged: LiftSegment[] = [];
  for (const segment of segments.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && segment.start <= previous.end) {
      previous.end = Math.max(previous.end, segment.end);
      previous.confidence = Math.max(previous.confidence, segment.confidence);
    } else {
      merged.push({ ...segment });
    }
  }

  // A window spanning essentially the whole clip is not a finding, it is noise
  // wearing a finding's clothes.
  const kept = merged.filter(s => s.end - s.start < duration * 0.95);
  if (kept.length <= MAX_LIFTS) return kept;

  // Too many: keep the most confident, then put them back in time order.
  return [...kept]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_LIFTS)
    .sort((a, b) => a.start - b.start);
}

/**
 * The single best trim window for a clip, or null when there is no clear event
 * to trim to. The strongest of `findLifts` — what the editor pre-sets the
 * handles to when it is not offering a split.
 */
export function suggestTrimFromMotion(
  samples: MotionSample[],
  options: SuggestTrimOptions,
): TrimSuggestion | null {
  const lifts = findLifts(samples, options);
  if (lifts.length === 0) return null;
  return lifts.reduce((best, s) => (s.confidence > best.confidence ? s : best));
}

/**
 * Reduce a pair of downscaled luma frames to how much changed and how much of
 * that change was vertical.
 *
 * Verticality comes from coarse block matching: for each block that actually
 * moved, find the pure-vertical and pure-horizontal shift that best explains
 * it, and see which explains it better. A barbell going up shifts its block
 * vertically; a coach crossing the frame shifts theirs horizontally; a block
 * of static platform matches best at zero and is skipped. Blocks are weighted
 * by how much they improved, so the lift outvotes the background even when the
 * background occupies more of the frame.
 *
 * Only pure axes are searched, not a full 2-D window: the question is which
 * axis dominates, and 12 candidates per block answers it at a fraction of the
 * cost of a proper motion-vector search.
 */
export function compareFrames(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  width: number,
  height: number,
): { energy: number; verticality: number } {
  let total = 0;
  for (let p = 0; p < current.length; p++) total += Math.abs(current[p] - previous[p]);
  const energy = total / current.length / 255;

  /** Mean per-pixel difference for a block, sampling `previous` at an offset.
   *  Out-of-frame reads are skipped rather than clamped, so an edge block is
   *  judged on the part of it that exists. */
  const blockCost = (bx: number, by: number, dx: number, dy: number): number => {
    let sum = 0;
    let count = 0;
    const maxY = Math.min(by + BLOCK, height);
    const maxX = Math.min(bx + BLOCK, width);
    for (let y = by; y < maxY; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= height) continue;
      for (let x = bx; x < maxX; x++) {
        const sx = x + dx;
        if (sx < 0 || sx >= width) continue;
        sum += Math.abs(current[y * width + x] - previous[sy * width + sx]);
        count++;
      }
    }
    return count === 0 ? 0 : sum / count / 255;
  };

  let verticalGain = 0;
  let horizontalGain = 0;

  for (let by = 0; by < height; by += BLOCK) {
    for (let bx = 0; bx < width; bx += BLOCK) {
      const still = blockCost(bx, by, 0, 0);
      if (still < BLOCK_NOISE_FLOOR) continue;

      let bestVertical = still;
      let bestHorizontal = still;
      for (let d = 1; d <= SEARCH; d++) {
        bestVertical = Math.min(
          bestVertical,
          blockCost(bx, by, 0, d),
          blockCost(bx, by, 0, -d),
        );
        bestHorizontal = Math.min(
          bestHorizontal,
          blockCost(bx, by, d, 0),
          blockCost(bx, by, -d, 0),
        );
      }
      verticalGain += Math.max(0, still - bestVertical);
      horizontalGain += Math.max(0, still - bestHorizontal);
    }
  }

  const explained = verticalGain + horizontalGain;
  // No block moved in a way either axis explains: no opinion, which weights
  // the sample neutrally rather than for or against it.
  const verticality = explained > 0 ? verticalGain / explained : 0.5;
  return { energy, verticality };
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
    const w = scratch.width;
    const h = scratch.height;

    // Luma only — colour adds nothing to "did this pixel change" and a third
    // of the arithmetic here runs per pixel per frame.
    const luma = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }

    if (previous) {
      samples.push({ t: timestamp, ...compareFrames(luma, previous, w, h) });
    }
    previous = luma;
  }

  return samples;
}
