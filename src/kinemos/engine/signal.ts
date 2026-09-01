/**
 * signal — resampling and filtering, the step that stands between a bar track
 * and a velocity worth printing.
 *
 * Position is differentiated twice on the way to power, and differentiation is
 * a noise amplifier: a ±1 px tremor on a 60 fps clip at 2 mm/px becomes
 * ±0,12 m/s of velocity noise and ±14 m/s² of acceleration noise. Untreated,
 * that swamps the difference between a snatch that makes it and one that does
 * not. Hence this module, and hence the order everything downstream follows
 * (design §6.3):
 *
 *     raw px track
 *       → calibrate to cm
 *       → RESAMPLE onto a uniform time grid   (Butterworth assumes uniform Δt)
 *       → zero-phase Butterworth low-pass     (filter POSITION, not velocity)
 *       → differentiate
 *
 * Two details separate this from a naive low-pass, and both are load-bearing:
 *
 *   1. **Zero phase.** A one-way IIR filter delays the signal by a few frames.
 *      On a lift where phase boundaries are read off velocity turning points,
 *      a delay shifts every boundary — the numbers stay plausible and the
 *      timing is wrong. Filtering forward and then backward cancels the delay
 *      exactly (Winter, *Biomechanics and Motor Control of Human Movement*).
 *   2. **Two passes double the order and move the cutoff.** Running a 2nd-order
 *      filter twice is a 4th-order response whose −3 dB point sits BELOW the
 *      nominal cutoff. Winter's correction divides the design cutoff by
 *      (2^(1/npasses) − 1)^(1/(2·order)) so that the cutoff the coach sets is
 *      the cutoff they get. Skipping it silently over-smooths — the classic
 *      way a filtered peak velocity comes out low.
 *
 * Engine purity: numbers in, numbers out. No DOM, no React, no EMOS imports.
 */

/** A time-stamped scalar series. `t` is seconds, real presentation timestamps
 *  where they come from a clip — never index/fps (design §6.3). */
export interface Series {
  t: number[];
  v: number[];
}

/** A series known to be on a uniform grid, with the step that made it. */
export interface UniformSeries extends Series {
  dt: number;
}

/**
 * Filter settings a coach can change. Defaults are the biomechanics standard
 * for lifting: a 2nd-order Butterworth at 6 Hz, applied forward and backward.
 *
 * COACH-CONFIG: 6 Hz suits Olympic lifts at 50–120 fps. A slower squat
 * tolerates 4 Hz and gets a cleaner acceleration; a jerk turnover at 240 fps
 * can carry 8–10 Hz. The cutoff must stay well under the Nyquist frequency of
 * the resampled grid, which `filterSettingsAreUsable` checks rather than
 * leaving to produce garbage.
 */
export interface FilterSettings {
  kind: 'butterworth' | 'none';
  cutoffHz: number;
  order: 2 | 4;
  /** Forward-and-backward (zero phase). Turning it off is only ever for
   *  showing what the lag looks like. */
  zeroPhase: boolean;
}

export const DEFAULT_FILTER: FilterSettings = {
  kind: 'butterworth',
  cutoffHz: 6,
  order: 2,
  zeroPhase: true,
};

/**
 * Winter's cutoff correction. Running an `order`-pole filter `passes` times
 * sharpens the roll-off and pulls the −3 dB point down; dividing the design
 * cutoff by this factor puts it back where it was asked for.
 *
 *     C = (2^(1/passes) − 1)^(1/(2·order))
 *
 * For the default (2nd order, 2 passes) C ≈ 0,802 — an 8 Hz design cutoff for
 * a requested 6 Hz. Exported because it is the kind of constant that deserves
 * to be checked rather than trusted.
 */
export function winterCorrection(order: number, passes: number): number {
  return Math.pow(Math.pow(2, 1 / passes) - 1, 1 / (2 * order));
}

/** Biquad coefficients, normalised so a0 = 1. */
interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Butterworth Q values, section by section, for a low-pass of the given order.
 *
 * A 4th-order Butterworth is NOT two 2nd-order Butterworths in series — that
 * cascade is Linkwitz-Riley, with a −6 dB corner rather than −3 dB and a
 * different roll-off shape, and Winter's cutoff correction would not describe
 * it. A real Butterworth places its poles evenly on a semicircle, which for
 * order 2m means m sections with
 *
 *     Q_k = 1 / (2·cos( π(2k + 1) / (2·order) )),   k = 0 … m−1
 *
 * giving Q = 0,7071 at order 2 and Q = 0,5412 · 1,3066 at order 4. Getting
 * this wrong is the quiet kind of wrong: the curve still looks smooth, and the
 * peak velocity it reports is a few per cent low.
 */
function butterworthQs(order: 2 | 4): number[] {
  const sections = order / 2;
  const qs: number[] = [];
  for (let k = 0; k < sections; k++) {
    qs.push(1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order))));
  }
  return qs;
}

/**
 * One low-pass biquad by the bilinear transform, with the cutoff pre-warped so
 * the digital corner lands where the analogue one was asked for. Without the
 * `tan()` pre-warp the realised cutoff drifts low as it approaches Nyquist.
 */
function lowPassBiquad(cutoffHz: number, sampleRateHz: number, q: number): Biquad {
  const k = Math.tan((Math.PI * cutoffHz) / sampleRateHz);
  const k2 = k * k;
  const norm = 1 / (1 + k / q + k2);
  return {
    b0: k2 * norm,
    b1: 2 * k2 * norm,
    b2: k2 * norm,
    a1: 2 * (k2 - 1) * norm,
    a2: (1 - k / q + k2) * norm,
  };
}

/** One forward pass of a biquad, started from the steady state the first
 *  sample implies — so a series that does not begin at zero is not treated as
 *  a step. */
function biquadForward(x: readonly number[], q: Biquad): number[] {
  const y = new Array<number>(x.length);
  let x1 = x[0];
  let x2 = x[0];
  let y1 = x[0];
  let y2 = x[0];
  for (let i = 0; i < x.length; i++) {
    const out = q.b0 * x[i] + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/**
 * Odd reflection about each endpoint.
 *
 * The alternative — zero padding, or repeating the endpoint — puts a slope
 * discontinuity right where the lift starts and ends, and the filter rings on
 * it. Odd reflection continues the trend through the boundary
 * (`2·x[0] − x[k]`), which is what `scipy.signal.filtfilt` does and why its
 * edges behave.
 */
function padOdd(x: readonly number[], pad: number): number[] {
  if (pad <= 0) return [...x];
  const n = x.length;
  const out: number[] = [];
  for (let i = pad; i >= 1; i--) out.push(2 * x[0] - x[Math.min(i, n - 1)]);
  out.push(...x);
  for (let i = 1; i <= pad; i++) out.push(2 * x[n - 1] - x[Math.max(n - 1 - i, 0)]);
  return out;
}

/**
 * Least-squares straight line through a series, as {slope per sample,
 * intercept}. Used to detrend before filtering — see `butterworthLowPass`.
 */
function linearFit(values: readonly number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  // Sums over i = 0…n−1 have closed forms, so this is one pass.
  const sumI = ((n - 1) * n) / 2;
  const sumI2 = ((n - 1) * n * (2 * n - 1)) / 6;
  let sumV = 0;
  let sumIV = 0;
  for (let i = 0; i < n; i++) {
    sumV += values[i];
    sumIV += i * values[i];
  }
  const denom = n * sumI2 - sumI * sumI;
  if (denom === 0) return { slope: 0, intercept: sumV / n };
  const slope = (n * sumIV - sumI * sumV) / denom;
  return { slope, intercept: (sumV - slope * sumI) / n };
}

/**
 * Zero-phase Butterworth low-pass over a uniformly sampled series.
 *
 * Returns the input untouched — rather than NaNs or a wildly wrong curve —
 * when the series is too short to filter or the cutoff is unusable at this
 * sample rate. A caller that cares should ask `filterSettingsAreUsable` first
 * and tell the coach; silently returning garbage is what this guards against.
 */
export function butterworthLowPass(
  values: readonly number[],
  sampleRateHz: number,
  settings: FilterSettings = DEFAULT_FILTER,
): number[] {
  if (settings.kind === 'none') return [...values];
  if (values.length < 6 || !(sampleRateHz > 0)) return [...values];
  if (!filterSettingsAreUsable(settings, sampleRateHz)) return [...values];

  const passes = settings.zeroPhase ? 2 : 1;
  const designCutoff = settings.cutoffHz / winterCorrection(settings.order, passes);
  // The correction raises the design cutoff; never let it reach Nyquist.
  const safeCutoff = Math.min(designCutoff, sampleRateHz * 0.49);
  const sections = butterworthQs(settings.order).map(q =>
    lowPassBiquad(safeCutoff, sampleRateHz, q),
  );

  // Detrend first, filter the residual, put the trend back.
  //
  // A bar track is a rising signal: it does not start and end at the same
  // height, and every IIR filter has a start-up transient proportional to how
  // far its state has to travel. Filtering the residual around a least-squares
  // line means the filter sees a signal that begins and ends near zero, so the
  // transient is small where it matters — at lift-off and at the catch, the two
  // moments a coach actually reads. The trend itself is pure DC-and-slope, which
  // a low-pass passes unchanged with no lag, so nothing is lost by routing it
  // around the filter. Least squares rather than an endpoint line, so one noisy
  // first frame cannot tilt the whole series.
  const { slope, intercept } = linearFit(values);
  const residual = values.map((v, i) => v - (intercept + slope * i));

  // Pad by the FILTER'S memory, not by its coefficient count.
  //
  // The usual rule (scipy's `3 · max(len(a), len(b))`, nine samples for a
  // biquad) is a coefficient count, and it is far too short here: a Butterworth
  // at 6 Hz rings for roughly two cycles, a third of a second, which at 240 fps
  // is eighty samples. Padding nine of them leaves a transient that walks well
  // into the record — measurably 7 % of gravity a fifth of a second in. Two
  // cycles of the cutoff is the honest length.
  const pad = Math.min(
    residual.length - 1,
    Math.max(3 * (2 * settings.order + 1), Math.round((2 * sampleRateHz) / settings.cutoffHz)),
  );
  let work = padOdd(residual, pad);

  for (const section of sections) work = biquadForward(work, section);
  if (settings.zeroPhase) {
    work.reverse();
    for (const section of sections) work = biquadForward(work, section);
    work.reverse();
  }

  return work
    .slice(pad, pad + values.length)
    .map((v, i) => v + intercept + slope * i);
}

/**
 * How much of each end of a filtered series is contaminated by the filter's own
 * start-up, in seconds.
 *
 * Padding pushes most of it outside the record, but not all: a zero-phase
 * Butterworth rings for about two cycles of its cutoff, so the first and last
 * ~2/fc seconds carry a transient no padding fully removes. Worth surfacing
 * rather than hiding — on a 1,5 s clip filtered at 6 Hz that is the outer 20 %
 * at each end, which is where lift-off and the catch live.
 */
export function filterEdgeSeconds(settings: FilterSettings): number {
  if (settings.kind === 'none' || !(settings.cutoffHz > 0)) return 0;
  return 2 / settings.cutoffHz;
}

/**
 * Is this cutoff meaningful at this sample rate?
 *
 * A cutoff at or above Nyquist filters nothing; one close to it produces a
 * filter whose coefficients are numerically poor. The rule of thumb — cutoff
 * below a fifth of the sample rate — is also the honest one for lifting: at
 * 30 fps a 6 Hz cutoff is already only a factor of five, which is why a 30 fps
 * clip grades worse than a 60 fps one.
 */
export function filterSettingsAreUsable(settings: FilterSettings, sampleRateHz: number): boolean {
  if (settings.kind === 'none') return true;
  return settings.cutoffHz > 0 && settings.cutoffHz < sampleRateHz / 2.5;
}

/**
 * Resample a (possibly variable-rate) series onto a uniform grid.
 *
 * Linear interpolation, deliberately. Splines would be smoother and would
 * invent curvature between samples — and curvature is precisely what the
 * second derivative reads. Linear interpolation adds no information; the
 * Butterworth that follows does the smoothing, where it is visible and
 * configurable.
 *
 * The default grid step is the series' own median interval, so a constant-rate
 * clip is resampled onto exactly its own timestamps and the whole step is a
 * no-op.
 */
export function resampleUniform(series: Series, dtOverride?: number): UniformSeries {
  const n = series.t.length;
  if (n === 0) return { t: [], v: [], dt: dtOverride ?? 0 };
  if (n === 1) return { t: [...series.t], v: [...series.v], dt: dtOverride ?? 0 };

  const dt = dtOverride ?? medianInterval(series.t);
  if (!(dt > 0)) return { t: [...series.t], v: [...series.v], dt: 0 };

  const start = series.t[0];
  const end = series.t[n - 1];
  const steps = Math.max(1, Math.round((end - start) / dt));

  const t: number[] = [];
  const v: number[] = [];
  let cursor = 0;
  for (let i = 0; i <= steps; i++) {
    const time = start + i * dt;
    // The grid is monotonic, so the source cursor only ever moves forward.
    while (cursor < n - 2 && series.t[cursor + 1] < time) cursor++;
    const t0 = series.t[cursor];
    const t1 = series.t[cursor + 1];
    const span = t1 - t0;
    const frac = span > 0 ? (time - t0) / span : 0;
    t.push(time);
    v.push(series.v[cursor] + (series.v[cursor + 1] - series.v[cursor]) * clamp01(frac));
  }
  return { t, v, dt };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Median gap between consecutive timestamps. The median rather than the mean
 *  because one dropped frame should not stretch the whole grid. */
export function medianInterval(t: readonly number[]): number {
  if (t.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

/**
 * Central-difference derivative on a uniform grid.
 *
 * Central differences are second-order accurate and, crucially, symmetric —
 * they introduce no shift. Forward differences at the ends are first-order and
 * noisier, which is honest: the ends of a filtered series are the least
 * trustworthy part of it, and nothing here pretends otherwise.
 */
export function derivative(values: readonly number[], dt: number): number[] {
  const n = values.length;
  if (n === 0 || !(dt > 0)) return new Array<number>(n).fill(0);
  if (n === 1) return [0];

  const d = new Array<number>(n);
  d[0] = (values[1] - values[0]) / dt;
  d[n - 1] = (values[n - 1] - values[n - 2]) / dt;
  for (let i = 1; i < n - 1; i++) d[i] = (values[i + 1] - values[i - 1]) / (2 * dt);
  return d;
}
