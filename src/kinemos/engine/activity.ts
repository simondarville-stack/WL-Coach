/**
 * activity — where in a clip a lift is happening, from thumbnails alone.
 *
 * The tracker costs ~150 ms a frame (decode-to-canvas plus correlation) and
 * most of a clip is not a lift: set-up, the rest between reps, the walk-away.
 * The drop stop (`tracker.ts`, `stopAtDrop`) removes the tail after each
 * lift; this finds the lifts, so the tracker need not walk the rest at all.
 * P7 plan (`docs/KINEMOS_P7_PLAN.md`).
 *
 * The signal is motion energy on a luma thumbnail — how far each cell of a
 * grid moved its mean luma since the previous frame, averaged over the
 * grid — plus two things about the motion that tell a lift from everything
 * else that moves:
 *
 *   - the **vertical centroid** of the motion: during a lift it rises (the
 *     legs and the bar move first, then the trunk, then the arms and the bar
 *     overhead) and then falls into the catch or the drop;
 *   - its **coverage**, the fraction of cells that changed: one lifter and a
 *     bar change a fraction of the picture, a camera pan changes all of it.
 *
 * A lift is a burst of energy — measured against the clip's OWN quiet level,
 * since sensor noise differs tenfold between a competition camera and a phone
 * in a dim hall — lasting about as long as a lift, whose centroid rises, with
 * coverage low enough to be one person. Each window is extended back into the
 * still period before the burst, where the bar is at rest: that is where the
 * plate finder looks and where the tracker anchors.
 *
 * Tuned for RECALL. A slow heavy first pull is low energy, a lift near the top
 * of the frame has its centroid rise clipped, a phone close to the platform
 * has the lifter filling half the picture; each threshold starts permissive
 * and the caller falls back to tracking the whole clip when nothing is found,
 * so a scan can never lose a rep that today's path would have had. A false
 * window costs one plate search and a short track.
 *
 * Engine purity: thumbnails arrive as arrays, samples and windows leave as
 * numbers. No canvas, no frame server. The lib layer (`lib/activityScan.ts`)
 * does the decoding and reading.
 */

/** A luma thumbnail of one frame: values 0–255, row-major, row 0 at the top. */
export interface Thumb {
  width: number;
  height: number;
  data: Float32Array | Uint8Array | Uint8ClampedArray;
  /** Presentation timestamp, s. */
  t: number;
}

/** What one frame's difference from the previous one looks like. */
export interface ActivitySample {
  t: number;
  /** Mean over cells of |the cell's mean luma now − its mean before|,
   *  levels. The difference of cell MEANS, not the mean of pixel
   *  differences: averaging 64 pixels first is what takes sensor noise out
   *  (a per-pixel |d| is always positive and would put the noise floor under
   *  every sample). */
  energy: number;
  /** Energy-weighted mean row of the cells that changed, thumbnail pixels
   *  from the top; `NaN` when no cell cleared the floor, so a still frame
   *  does not report a centroid at the picture's middle. */
  centroidRow: number;
  /** Fraction of cells whose change cleared `cellFloor`. */
  coverage: number;
}

export interface ActivityOptions {
  /** Cell edge, thumbnail pixels. 8 px on a 160-px thumbnail is a 20 × 12
   *  grid; the mean over 64 pixels averages sensor noise to a few tenths of
   *  a level. */
  cellPx?: number;
  /** A cell has CHANGED when its mean luma moved by more than this, levels.
   *  Absolute, not relative: on a cell mean of 64 pixels sensor noise is a
   *  few tenths of a level (σ ≈ 0,2 for a σ = 1,7 pixel noise, 0,9 for a
   *  very noisy σ = 5 phone), a plate edge crossing a cell moves it by ten
   *  or more, a lifter's body edge by two to five. Only the centroid and the
   *  coverage read it; the energy is floor-free. */
  cellFloor?: number;
}

export const DEFAULT_ACTIVITY_OPTIONS: Required<ActivityOptions> = {
  cellPx: 8,
  cellFloor: 1.5,
};

export interface ActivityAccumulator {
  /** Feed the next thumbnail, in presentation order. Returns the sample for
   *  it — the first thumbnail's sample has zero energy and no centroid, so
   *  samples line up one-to-one with frames. */
  push(thumb: Thumb): ActivitySample;
  readonly samples: ActivitySample[];
}

/**
 * The activity of a clip, one thumbnail at a time. Keeps only the previous
 * thumbnail: a ten-minute 60 fps session is 36 000 thumbnails, half a
 * gigabyte held whole.
 */
export function activityAccumulator(options: ActivityOptions = {}): ActivityAccumulator {
  const opt = { ...DEFAULT_ACTIVITY_OPTIONS, ...options };
  const cell = Math.max(1, Math.round(opt.cellPx));
  const samples: ActivitySample[] = [];
  let previous: Thumb | null = null;

  return {
    samples,
    push(thumb: Thumb): ActivitySample {
      let sample: ActivitySample;
      if (!previous || previous.width !== thumb.width || previous.height !== thumb.height) {
        sample = { t: thumb.t, energy: 0, centroidRow: NaN, coverage: 0 };
      } else {
        sample = differenceSample(previous, thumb, cell, opt.cellFloor);
      }
      previous = thumb;
      samples.push(sample);
      return sample;
    },
  };
}

/** The same over an array — for tests and short clips. */
export function activityOf(thumbs: readonly Thumb[], options: ActivityOptions = {}): ActivitySample[] {
  const acc = activityAccumulator(options);
  for (const thumb of thumbs) acc.push(thumb);
  return acc.samples;
}

function differenceSample(a: Thumb, b: Thumb, cell: number, floor: number): ActivitySample {
  const { width, height } = b;
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  let energySum = 0;
  let changed = 0;
  let weightSum = 0;
  let rowSum = 0;
  for (let r = 0; r < rows; r++) {
    const y0 = r * cell;
    for (let c = 0; c < cols; c++) {
      const x0 = c * cell;
      let sum = 0;
      for (let y = y0; y < y0 + cell; y++) {
        const base = y * width;
        for (let x = x0; x < x0 + cell; x++) {
          sum += b.data[base + x] - a.data[base + x];
        }
      }
      const mean = Math.abs(sum) / (cell * cell);
      energySum += mean;
      if (mean > floor) {
        changed++;
        // Weighted by how far above the floor, so a cell that barely
        // cleared it does not pull the centroid as hard as the plate does.
        const w = mean - floor;
        weightSum += w;
        rowSum += w * (y0 + cell / 2);
      }
    }
  }
  const cells = rows * cols;
  return {
    t: b.t,
    energy: energySum / cells,
    centroidRow: weightSum > 0 ? rowSum / weightSum : NaN,
    coverage: changed / cells,
  };
}

// ── Windows ─────────────────────────────────────────────────────────────────

export interface LiftWindowEvidence {
  /** The burst's highest (smoothed) energy, levels. */
  peakEnergy: number;
  /** The clip's quiet level the burst was measured against, levels. */
  quietEnergy: number;
  /** How far the motion centroid rose over the burst, thumbnail rows. */
  centroidRiseRows: number;
  /** How far it fell again after its highest point, rows. */
  centroidFallRows: number;
  /** Median coverage over the burst's active samples. */
  coverage: number;
  /** The burst's length, s. */
  burstS: number;
}

export interface LiftWindow {
  /** The stillest frame of the lead-in — where the plate finder looks and
   *  the tracker anchors. */
  restT: number;
  /** Start of the window: the lead-in before the burst. */
  fromT: number;
  /** Where the motion begins — the burst's first sample, within a few
   *  frames of lift-off. The time a coach means by "the lift at 6,9 s". */
  liftT: number;
  /** End of the window: the burst's end, or the forward cap. */
  toT: number;
  /** 0–1, from the evidence; the UI can say why. */
  confidence: number;
  evidence: LiftWindowEvidence;
}

/**
 * Every threshold is a knob and every default has its reason beside it.
 * They were set on synthetic thumbnails (`__tests__/activity.test.ts`); the
 * real clips (P7 plan §6) are what settles them. COACH-CONFIG candidate —
 * a coach who films from the back of a hall may want the rise floor lower.
 */
export interface LiftWindowOptions {
  /** The clip's quiet level is this percentile of its energy series. A
   *  percentile rather than the minimum, so one duplicated frame (energy
   *  zero) cannot set the floor. */
  quietPercentile?: number;
  /** Energy is smoothed over this long (a centred moving average) before
   *  thresholding. A lift's energy is sustained over tens of frames; the
   *  per-frame flicker in a quiet stretch is not. */
  smoothS?: number;
  /** A sample is ACTIVE at `max(quiet · enterFactor, quiet + enterMinAbove)`.
   *  Two, not three: the quiet level is a mean over ~240 cells and barely
   *  spreads, so the factor is not there to clear noise — it is there to
   *  clear small real motion, and the rise, coverage and length rules do
   *  the rest. The synthetic low-contrast slow lift (plates 50 levels
   *  against the ground, 1,5 rows a frame) reaches 1,3 × this; at three it
   *  is missed. The additive floor keeps a clean, near-zero quiet level
   *  from making every sample active. */
  enterFactor?: number;
  enterMinAbove?: number;
  /** Once entered, a burst runs while energy stays above
   *  `max(quiet · holdFactor, quiet + holdMinAbove)` — hysteresis, so the
   *  slow first pull and the turnover pause stay inside the burst the
   *  second pull started. */
  holdFactor?: number;
  holdMinAbove?: number;
  /** Two bursts closer than this are one: the bar is still for a moment at
   *  the catch while the lifter is not. */
  mergeGapS?: number;
  /** Below this a burst is a fidget. A real lift is 0,6 s and up; 0,4 s
   *  leaves room for a clip that starts mid-pull. */
  minBurstS?: number;
  /** Above this a burst is kept but capped and marked down: a lifter
   *  walking about, a pan the coverage rule did not catch. Never dropped,
   *  for recall. */
  maxBurstS?: number;
  /** The motion centroid must rise by this fraction of the thumbnail's
   *  height over the burst. Small on purpose: a lift near the top edge is
   *  clipped. A snatch on a portrait thumbnail moves it by 20–50 rows of
   *  160. */
  minRiseFraction?: number;
  /** Median coverage over the burst's active samples above this is a pan —
   *  or a lifter filling the frame, which the close-camera clip measures. */
  coverageMax?: number;
  /** How far before the burst the window starts: covers the rep cut's
   *  0,15 s rest and the phase detector's 0,4 s lead. Clamped to the quiet
   *  stretch that is actually there. */
  restLeadS?: number;
  /** The window ends at the burst's end or this long after it began. A
   *  snatch is under 3 s from lift-off to the stand; the drop stop ends the
   *  track earlier anyway. */
  forwardCapS?: number;
}

export const DEFAULT_LIFT_WINDOW_OPTIONS: Required<LiftWindowOptions> = {
  quietPercentile: 0.2,
  smoothS: 0.1,
  enterFactor: 2,
  enterMinAbove: 0.15,
  holdFactor: 1.5,
  holdMinAbove: 0.08,
  mergeGapS: 0.25,
  // Measured on the testset (07/09/2026): the shortest real lift burst was
  // 1,53 s (the close-camera pull); the false ones — a settle at the clip
  // start, a bounce, a step — ran 0,40–0,93 s. 0,8 s cuts four of those
  // across the five clips and no lift; a snatch's pull alone is about a
  // second.
  minBurstS: 0.8,
  maxBurstS: 6,
  minRiseFraction: 0.04,
  coverageMax: 0.6,
  restLeadS: 0.5,
  forwardCapS: 4,
};

interface Burst {
  /** Sample positions, inclusive. */
  from: number;
  to: number;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[pos];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** A centred moving average of the energy over `smoothS`, by the median
 *  frame interval. One sample wide (no smoothing) when the interval is
 *  longer than the window. */
function smoothEnergy(samples: readonly ActivitySample[], smoothS: number): number[] {
  const n = samples.length;
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(samples[i].t - samples[i - 1].t);
  gaps.sort((a, b) => a - b);
  const dt = gaps.length ? gaps[gaps.length >> 1] : 0;
  const half = dt > 0 ? Math.floor(smoothS / dt / 2) : 0;
  if (half <= 0) return samples.map(s => s.energy);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      sum += samples[j].energy;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** Bursts of activity: runs above the hold level that contain at least one
 *  sample above the enter level, with short gaps between them closed. */
function bursts(
  samples: readonly ActivitySample[],
  energy: readonly number[],
  enter: number,
  hold: number,
  mergeGapS: number,
): Burst[] {
  const out: Burst[] = [];
  let start = -1;
  let entered = false;
  for (let i = 0; i <= samples.length; i++) {
    const active = i < samples.length && energy[i] > hold;
    if (active) {
      if (start < 0) start = i;
      if (energy[i] > enter) entered = true;
    } else if (start >= 0) {
      if (entered) out.push({ from: start, to: i - 1 });
      start = -1;
      entered = false;
    }
  }
  // Close the gaps: a burst that starts within `mergeGapS` of the previous
  // one's end joins it.
  const merged: Burst[] = [];
  for (const b of out) {
    const last = merged[merged.length - 1];
    if (last && samples[b.from].t - samples[last.to].t <= mergeGapS) last.to = b.to;
    else merged.push({ ...b });
  }
  return merged;
}

/**
 * A 3-sample median of the centroid over the burst's ACTIVE samples, in
 * order. Only the active ones: in the hold-level tails of a burst the
 * motion is something else — a lifter straightening while the bar hangs,
 * a body lowering before the bar is let go — and the centroid then JUMPS
 * from that thing to the bar once the bar moves. Measured on a synthetic
 * miss, the jump from a lowering body to the plates starting to fall read
 * as a 15-row rise. Above the enter level one thing dominates the motion
 * and its centroid means what it says.
 */
function activeCentroid(
  samples: readonly ActivitySample[],
  energy: readonly number[],
  from: number,
  to: number,
  enter: number,
): number[] {
  const raw: number[] = [];
  for (let i = from; i <= to; i++) {
    if (energy[i] > enter && Number.isFinite(samples[i].centroidRow)) raw.push(samples[i].centroidRow);
  }
  return raw.map((_, i) => median(raw.slice(Math.max(0, i - 1), Math.min(raw.length, i + 2))));
}

/**
 * The largest rise of the centroid from any earlier sample to a later one
 * (rows fall as the motion rises), and the largest fall after the sample
 * that rise peaked at.
 */
function riseAndFall(rows: readonly number[]): { rise: number; fall: number } {
  let lowestSoFar = -Infinity; // the largest row seen so far: the lowest point
  let rise = 0;
  let peakAt = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Number.isFinite(r)) continue;
    if (r > lowestSoFar) lowestSoFar = r;
    const candidate = lowestSoFar - r;
    if (candidate > rise) {
      rise = candidate;
      peakAt = i;
    }
  }
  let fall = 0;
  if (peakAt >= 0) {
    const top = rows[peakAt];
    for (let i = peakAt + 1; i < rows.length; i++) {
      const r = rows[i];
      if (Number.isFinite(r) && r - top > fall) fall = r - top;
    }
  }
  return { rise, fall };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The lifts in a clip's activity, in time order.
 *
 * `thumbHeight` is the thumbnail's height in pixels, which the centroid rise
 * is measured as a fraction of.
 */
export function liftWindows(
  samples: readonly ActivitySample[],
  thumbHeight: number,
  options: LiftWindowOptions = {},
): LiftWindow[] {
  const opt = { ...DEFAULT_LIFT_WINDOW_OPTIONS, ...options };
  if (samples.length < 3) return [];
  const smoothed = smoothEnergy(samples, opt.smoothS);
  // Sample 0 has no predecessor and energy 0 by construction; it would
  // only ever lower the percentile, so it is left out of the quiet level.
  const quiet = percentile(smoothed.slice(1), opt.quietPercentile);
  const enter = Math.max(quiet * opt.enterFactor, quiet + opt.enterMinAbove);
  const hold = Math.max(quiet * opt.holdFactor, quiet + opt.holdMinAbove);
  const minRiseRows = opt.minRiseFraction * thumbHeight;

  const windows: LiftWindow[] = [];
  let previousEnd = -1;
  for (const burst of bursts(samples, smoothed, enter, hold, opt.mergeGapS)) {
    const burstStartT = samples[burst.from].t;
    const burstEndT = samples[burst.to].t;
    const burstS = burstEndT - burstStartT;
    if (burstS < opt.minBurstS) continue;

    const rows = activeCentroid(samples, smoothed, burst.from, burst.to, enter);
    const { rise, fall } = riseAndFall(rows);
    if (rise < minRiseRows) continue;

    const coverages: number[] = [];
    for (let i = burst.from; i <= burst.to; i++) {
      if (smoothed[i] > enter) coverages.push(samples[i].coverage);
    }
    const coverage = coverages.length ? median(coverages) : 0;
    if (coverage > opt.coverageMax) continue;

    let peak = 0;
    for (let i = burst.from; i <= burst.to; i++) peak = Math.max(peak, smoothed[i]);

    // The lead-in: back from the burst through the quiet stretch, at most
    // `restLeadS`, never into the previous window. The rest frame is the
    // stillest sample of it.
    let from = burst.from;
    while (
      from > 0 &&
      from - 1 > previousEnd &&
      smoothed[from - 1] <= hold &&
      burstStartT - samples[from - 1].t <= opt.restLeadS
    ) {
      from--;
    }
    let rest = from;
    for (let i = from; i <= burst.from; i++) {
      if (smoothed[i] < smoothed[rest]) rest = i;
    }
    // Forward: the burst's end, or the cap.
    let to = burst.to;
    while (to > burst.from && samples[to].t - burstStartT > opt.forwardCapS) to--;

    const energyFactor = clamp01((peak / Math.max(1e-6, quiet) - 1) / 5); // 1 at ≥ 6×
    const riseFactor = clamp01((rise - minRiseRows) / Math.max(1e-6, 0.15 * thumbHeight - minRiseRows));
    const lengthFactor =
      burstS < 0.6
        ? 0.3 + (0.7 * (burstS - opt.minBurstS)) / Math.max(1e-6, 0.6 - opt.minBurstS)
        : burstS <= 3
          ? 1
          : Math.max(0.3, 1 - (0.7 * (burstS - 3)) / Math.max(1e-6, opt.maxBurstS - 3));
    const coverageFactor = coverage <= 0.3 ? 1 : clamp01((opt.coverageMax - coverage) / (opt.coverageMax - 0.3));
    const fallBonus = fall >= minRiseRows ? 0.15 : 0;
    // Every factor is in [0, 1] and the rise factor may be 0 at the floor:
    // a window at the floor is still a window, just a doubtful one, so the
    // product sits on a small base rather than at zero.
    const confidence = clamp01(
      0.15 + 0.85 * energyFactor * Math.max(0.2, riseFactor) * lengthFactor * coverageFactor + fallBonus,
    );

    windows.push({
      restT: samples[rest].t,
      fromT: samples[from].t,
      liftT: burstStartT,
      toT: samples[to].t,
      confidence,
      evidence: {
        peakEnergy: peak,
        quietEnergy: quiet,
        centroidRiseRows: rise,
        centroidFallRows: fall,
        coverage,
        burstS,
      },
    });
    previousEnd = to;
  }
  return windows;
}

/** A window on the frame index axis. */
export interface WindowRange {
  restIndex: number;
  from: number;
  to: number;
}

/** Nearest index into an ascending timestamp table (the frame server's rule). */
function nearestIndex(timestamps: readonly number[], t: number): number {
  if (timestamps.length === 0) return 0;
  if (t <= timestamps[0]) return 0;
  if (t >= timestamps[timestamps.length - 1]) return timestamps.length - 1;
  let lo = 0;
  let hi = timestamps.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] <= t) lo = mid;
    else hi = mid;
  }
  return t - timestamps[lo] <= timestamps[hi] - t ? lo : hi;
}

/**
 * Windows onto frame indices, by nearest timestamp. The thumbnail server and
 * the full-resolution one read the same container and carry the same
 * timestamps, but mapping by time rather than by position keeps this honest
 * if they ever differ by a dropped frame.
 */
export function windowRanges(
  windows: readonly LiftWindow[],
  timestamps: readonly number[],
  options: { tailS?: number } = {},
): WindowRange[] {
  // A window ends where the motion does. For a jerk that is the bar fixed
  // overhead — still, so the burst ends at the apex — and a track cut there
  // has no drop into the fix and no settle to read (P9, first bench run on
  // the 2009 jerk: catch and recovery fell back on every clip). So the
  // range carries on past the burst for a moment, stopping before the next
  // lift's rest and at the clip's end; a track through a drop stops at the
  // drop as before, and stillness costs the tracker nothing.
  const tailS = options.tailS ?? DEFAULT_WINDOW_TAIL_S;
  const last = timestamps.length - 1;
  return windows.map((w, k) => {
    const from = nearestIndex(timestamps, w.fromT);
    const next = windows[k + 1];
    const nextRest = next ? nearestIndex(timestamps, next.restT) : last + 1;
    const to = Math.min(nextRest - 1, last, Math.max(from, nearestIndex(timestamps, w.toT + tailS)));
    const restIndex = Math.min(to, Math.max(from, nearestIndex(timestamps, w.restT)));
    return { restIndex, from, to };
  });
}

/** How far past the burst a lift's frame range runs, s. COACH-CONFIG candidate
 *  in spirit; a settle is found within half a second of the bar stopping. */
export const DEFAULT_WINDOW_TAIL_S = 0.75;
