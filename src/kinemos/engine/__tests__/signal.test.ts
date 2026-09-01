/**
 * The signal core. Every velocity, acceleration and power figure KinEMOS will
 * ever print passes through here, and the ways this can be wrong are all quiet
 * — a filter with the wrong corner still produces a smooth, plausible curve
 * whose peak is a few per cent low. So these tests measure the filter's actual
 * behaviour (gain at frequency, phase lag, edge fidelity) rather than checking
 * that it ran.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER,
  butterworthLowPass,
  derivative,
  filterSettingsAreUsable,
  medianInterval,
  resampleUniform,
  winterCorrection,
  type FilterSettings,
} from '../signal';

const FS = 120; // a comfortable sample rate for measurement
const N = 1200; // 10 s — long enough that edges are irrelevant to the middle

function sine(freqHz: number, sampleRate = FS, n = N, amplitude = 1): number[] {
  return Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
}

/** Peak amplitude over the middle of a series, away from filter edge effects. */
function midAmplitude(values: readonly number[]): number {
  const from = Math.floor(values.length * 0.25);
  const to = Math.floor(values.length * 0.75);
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(values[i]));
  return max;
}

/**
 * Lag of `out` behind `ref`, in samples, by cross-correlation over the middle.
 * The number that says whether a filter is zero-phase or not.
 *
 * `maxLag` must stay inside half a period of the signal under test: on a
 * periodic signal the correlation repeats, so a wider window finds a lag one
 * whole period away and reports it with equal confidence. The signals here are
 * 2–3 Hz at 120 Hz, i.e. 40–60 samples per period, so 15 is safe.
 */
function lagSamples(ref: readonly number[], out: readonly number[], maxLag = 15): number {
  const from = Math.floor(ref.length * 0.3);
  const to = Math.floor(ref.length * 0.7);
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = from; i < to; i++) score += ref[i] * (out[i + lag] ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // A positive `lag` here means `out` had to be read LATER to match `ref`,
  // i.e. the filter delayed the signal.
  return best;
}

describe('winterCorrection', () => {
  it('is 0,802 for the default 2nd-order, two-pass filter', () => {
    // The textbook value. If this drifts, every cutoff in the app moved.
    expect(winterCorrection(2, 2)).toBeCloseTo(0.8022, 4);
  });

  it('is 1 for a single pass — nothing to correct', () => {
    expect(winterCorrection(2, 1)).toBeCloseTo(1, 10);
  });

  it('corrects less for a steeper filter', () => {
    expect(winterCorrection(4, 2)).toBeGreaterThan(winterCorrection(2, 2));
  });
});

describe('butterworthLowPass — frequency response', () => {
  it('passes DC untouched', () => {
    const dc = new Array(200).fill(7.5);
    const out = butterworthLowPass(dc, FS);
    for (const v of out) expect(v).toBeCloseTo(7.5, 9);
  });

  it('passes a well-below-cutoff signal at full amplitude', () => {
    const out = butterworthLowPass(sine(1), FS, { ...DEFAULT_FILTER, cutoffHz: 6 });
    expect(midAmplitude(out)).toBeGreaterThan(0.99);
    expect(midAmplitude(out)).toBeLessThan(1.01);
  });

  it('is −3 dB at the cutoff the coach asked for', () => {
    // This is the Winter correction under test. Without it the response at
    // 6 Hz would be ~0,5 (−6 dB) and every filtered peak would read low.
    const out = butterworthLowPass(sine(6), FS, { ...DEFAULT_FILTER, cutoffHz: 6 });
    expect(midAmplitude(out)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('is −3 dB at the cutoff for the 4th-order filter too', () => {
    // The cascade must be a real Butterworth, not two 2nd-orders in series:
    // that mistake lands here at ≈0,5 rather than 0,707.
    const out = butterworthLowPass(sine(6), FS, { ...DEFAULT_FILTER, cutoffHz: 6, order: 4 });
    expect(midAmplitude(out)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('rolls off harder at 4th order than at 2nd', () => {
    const second = midAmplitude(butterworthLowPass(sine(12), FS, { ...DEFAULT_FILTER, cutoffHz: 6 }));
    const fourth = midAmplitude(
      butterworthLowPass(sine(12), FS, { ...DEFAULT_FILTER, cutoffHz: 6, order: 4 }),
    );
    expect(fourth).toBeLessThan(second);
  });

  it('kills a signal far above the cutoff', () => {
    const out = butterworthLowPass(sine(40), FS, { ...DEFAULT_FILTER, cutoffHz: 6 });
    expect(midAmplitude(out)).toBeLessThan(0.01);
  });
});

describe('butterworthLowPass — phase', () => {
  it('introduces no lag when run forward and backward', () => {
    const clean = sine(3);
    const out = butterworthLowPass(clean, FS, { ...DEFAULT_FILTER, cutoffHz: 6 });
    expect(lagSamples(clean, out)).toBe(0);
  });

  it('a one-way filter DOES lag — which is why zero phase is the default', () => {
    const clean = sine(3);
    const out = butterworthLowPass(clean, FS, {
      ...DEFAULT_FILTER,
      cutoffHz: 6,
      zeroPhase: false,
    });
    // Several frames of delay: enough to shift a phase boundary read off a
    // velocity turning point.
    expect(lagSamples(clean, out)).toBeGreaterThan(2);
  });
});

describe('butterworthLowPass — edges and guards', () => {
  it('leaves a straight line straight, right to the ends', () => {
    // The detrend-and-pad test, and the reason both exist. A bar track is a
    // rising signal, so the ends — lift-off and catch — are exactly where a
    // filter's start-up transient would land. Detrending makes the residual
    // here identically zero, so the ramp comes back exact rather than merely
    // close.
    const ramp = Array.from({ length: 120 }, (_, i) => 2 + 0.05 * i);
    const out = butterworthLowPass(ramp, FS);
    for (let i = 0; i < ramp.length; i++) expect(out[i]).toBeCloseTo(ramp[i], 9);
  });

  it('does not let the trend hide a transient at the ends', () => {
    // Detrending must not become a way of smuggling the signal past the
    // filter: a rising track with high-frequency noise on it still has to come
    // out smoothed.
    const ramp = Array.from({ length: 240 }, (_, i) => 2 + 0.05 * i);
    const wobbly = ramp.map((v, i) => v + 0.3 * Math.sin((2 * Math.PI * 45 * i) / FS));
    const out = butterworthLowPass(wobbly, FS, { ...DEFAULT_FILTER, cutoffHz: 6 });
    for (let i = 30; i < 210; i++) expect(Math.abs(out[i] - ramp[i])).toBeLessThan(0.02);
  });

  it('recovers a clean signal buried in noise', () => {
    const clean = sine(2);
    // Deterministic pseudo-noise so the test cannot flake.
    let seed = 42;
    const noisy = clean.map(v => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return v + (seed / 2147483648 - 0.5) * 0.4;
    });
    // A 4 Hz cutoff keeps the 2 Hz signal intact while passing only ~7 % of the
    // noise bandwidth, so roughly a 3–4× improvement is what the maths predicts
    // — the assertion is set where theory says it should land, not where the
    // implementation happens to.
    const out = butterworthLowPass(noisy, FS, { ...DEFAULT_FILTER, cutoffHz: 4 });
    const rms = (a: readonly number[]) =>
      Math.sqrt(a.reduce((acc, v, i) => acc + (v - clean[i]) ** 2, 0) / a.length);
    expect(rms(out)).toBeLessThan(rms(noisy) / 3);
  });

  it('returns a too-short series untouched rather than ringing on it', () => {
    const tiny = [1, 2, 3];
    expect(butterworthLowPass(tiny, FS)).toEqual(tiny);
  });

  it('returns the input untouched when the cutoff is unusable', () => {
    const values = sine(2, 30, 300);
    // 12 Hz at 30 fps is past what this sample rate can filter meaningfully.
    const settings: FilterSettings = { ...DEFAULT_FILTER, cutoffHz: 12 };
    expect(filterSettingsAreUsable(settings, 30)).toBe(false);
    expect(butterworthLowPass(values, 30, settings)).toEqual(values);
  });

  it('does nothing when the coach turns filtering off', () => {
    const values = sine(20);
    expect(butterworthLowPass(values, FS, { ...DEFAULT_FILTER, kind: 'none' })).toEqual(values);
  });

  it('never returns NaN', () => {
    const out = butterworthLowPass(sine(5), FS);
    expect(out.every(Number.isFinite)).toBe(true);
  });
});

describe('filterSettingsAreUsable', () => {
  it('accepts the default at ordinary frame rates', () => {
    expect(filterSettingsAreUsable(DEFAULT_FILTER, 60)).toBe(true);
    expect(filterSettingsAreUsable(DEFAULT_FILTER, 30)).toBe(true);
  });

  it('rejects a cutoff too close to Nyquist', () => {
    expect(filterSettingsAreUsable(DEFAULT_FILTER, 14)).toBe(false);
  });

  it('always accepts no filtering', () => {
    expect(filterSettingsAreUsable({ ...DEFAULT_FILTER, kind: 'none' }, 1)).toBe(true);
  });
});

describe('medianInterval', () => {
  it('finds the frame interval of a constant-rate clip', () => {
    expect(medianInterval([0, 0.02, 0.04, 0.06])).toBeCloseTo(0.02, 9);
  });

  it('is not dragged by a single dropped frame', () => {
    expect(medianInterval([0, 0.02, 0.04, 0.1, 0.12, 0.14])).toBeCloseTo(0.02, 9);
  });

  it('is zero when there is nothing to measure', () => {
    expect(medianInterval([1])).toBe(0);
  });
});

describe('resampleUniform', () => {
  it('is a no-op on a clip that is already uniform', () => {
    const series = { t: [0, 0.02, 0.04, 0.06], v: [0, 1, 2, 3] };
    const out = resampleUniform(series);
    expect(out.dt).toBeCloseTo(0.02, 9);
    expect(out.t.length).toBe(4);
    out.v.forEach((v, i) => expect(v).toBeCloseTo(series.v[i], 9));
  });

  it('interpolates linearly across a variable-rate clip', () => {
    // Samples at 0, 0.02, 0.10 with values 0, 2, 10 — a straight line in time,
    // so every resampled point must land on it.
    const out = resampleUniform({ t: [0, 0.02, 0.1], v: [0, 2, 10] }, 0.01);
    out.t.forEach((t, i) => expect(out.v[i]).toBeCloseTo(t * 100, 6));
  });

  it('keeps the first and last samples exactly', () => {
    const out = resampleUniform({ t: [0, 0.033, 0.07], v: [5, 9, 4] }, 0.01);
    expect(out.v[0]).toBeCloseTo(5, 6);
    expect(out.t[0]).toBeCloseTo(0, 9);
    expect(out.t[out.t.length - 1]).toBeCloseTo(0.07, 6);
  });

  it('survives a degenerate series instead of producing NaN', () => {
    expect(resampleUniform({ t: [], v: [] }).v).toEqual([]);
    expect(resampleUniform({ t: [1], v: [3] }).v).toEqual([3]);
    const flat = resampleUniform({ t: [1, 1], v: [3, 4] });
    expect(flat.v.every(Number.isFinite)).toBe(true);
  });
});

describe('derivative', () => {
  it('differentiates a ramp to a constant', () => {
    const dt = 0.01;
    const ramp = Array.from({ length: 50 }, (_, i) => 3 * i * dt);
    for (const d of derivative(ramp, dt)) expect(d).toBeCloseTo(3, 9);
  });

  it('is exact on a parabola in the interior', () => {
    // Central differences are second-order accurate, so d/dt of t² is exact.
    const dt = 0.01;
    const t = (i: number) => i * dt;
    const parabola = Array.from({ length: 50 }, (_, i) => t(i) ** 2);
    const d = derivative(parabola, dt);
    for (let i = 1; i < 49; i++) expect(d[i]).toBeCloseTo(2 * t(i), 9);
  });

  it('does not shift the signal', () => {
    // A cosine differentiates to a sine at the same sample positions; a
    // one-sided difference would put it half a sample out.
    const dt = 1 / FS;
    const cos = Array.from({ length: 400 }, (_, i) => Math.cos(2 * Math.PI * 2 * i * dt));
    const d = derivative(cos, dt);
    const expected = cos.map((_, i) => -2 * Math.PI * 2 * Math.sin(2 * Math.PI * 2 * i * dt));
    expect(lagSamples(expected, d)).toBe(0);
  });

  it('is accurate on a sinusoid to the second order, and no better', () => {
    // Central differences carry a truncation error of (Δt²/6)·f‴ — about 0,2 %
    // here. Asserting exactness would be asserting something untrue; asserting
    // the real bound is what catches a regression to a one-sided difference,
    // whose error is an order of magnitude larger.
    const dt = 1 / FS;
    const cos = Array.from({ length: 400 }, (_, i) => Math.cos(2 * Math.PI * 2 * i * dt));
    const d = derivative(cos, dt);
    const expected = cos.map((_, i) => -2 * Math.PI * 2 * Math.sin(2 * Math.PI * 2 * i * dt));
    const amplitude = 2 * Math.PI * 2;
    let worst = 0;
    for (let i = 5; i < 395; i++) worst = Math.max(worst, Math.abs(d[i] - expected[i]));
    expect(worst / amplitude).toBeLessThan(0.005);
  });

  it('handles degenerate input without NaN', () => {
    expect(derivative([], 0.1)).toEqual([]);
    expect(derivative([5], 0.1)).toEqual([0]);
    expect(derivative([1, 2, 3], 0)).toEqual([0, 0, 0]);
  });
});
