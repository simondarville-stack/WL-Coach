/**
 * kinematics — from a marked bar track to velocity, acceleration and power.
 *
 * The pipeline, in the order design §6.3 fixes and for the reasons it gives:
 *
 *     track (px, real timestamps)
 *       → calibrate to cm on the plate's own axes   (anisotropic; see calibration.ts)
 *       → resample onto a uniform grid              (the filter assumes uniform Δt)
 *       → zero-phase Butterworth on POSITION        (filtering velocity instead
 *                                                    smooths away the peak)
 *       → central differences → velocity → acceleration
 *       → power from the logged mass
 *
 * **Calibration is required.** A velocity in pixels per second is not a
 * velocity, and there is no honest way to render one: 1,74 with no unit behind
 * it is worse than no number at all. `computeKinematics` returns null without a
 * calibration and the viewer says why. Path geometry in pixels stays available
 * (that is `pathMetrics` in calibration.ts) because a shape needs no scale.
 *
 * **Power is barbell power**, the convention in the weightlifting literature:
 * vertical force on the bar times vertical bar velocity, F = m(a + g). It is
 * not system power — the lifter's own centre of mass is not in this model and
 * cannot be, from one tracked bar end. Anyone comparing these watts against a
 * force-plate number is comparing two different quantities.
 *
 * Engine purity: numbers in, numbers out.
 */
import { displacementToCm, type Calibration, type TrackPoint } from './calibration';
import {
  DEFAULT_FILTER,
  butterworthLowPass,
  derivative,
  filterSettingsAreUsable,
  resampleUniform,
  type FilterSettings,
} from './signal';

/** Standard gravity. The bar is accelerated against it, so it is part of the
 *  force the lifter produces even when the bar is moving at constant speed. */
export const G = 9.80665;

/** Minimum marks before the pipeline can say anything. Below this the filter
 *  is skipped and differentiation is mostly edge effects. */
export const MIN_POINTS_FOR_KINEMATICS = 8;

export interface KinematicsOptions {
  filter?: FilterSettings;
  /** Bar mass in kg. Without it, power is null rather than guessed. */
  massKg?: number | null;
  /** Force a resampling step. Defaults to the track's own median interval, so
   *  a constant-rate clip is resampled onto its own timestamps. */
  dt?: number;
}

/**
 * The computed series, all on one uniform time grid so a chart can share an
 * x-axis with the timeline and a phase edge lines up everywhere.
 */
export interface KinematicSeries {
  /** Seconds, uniform grid, starting at the first mark's real timestamp. */
  t: number[];
  dt: number;
  sampleRateHz: number;

  /** Horizontal displacement from the first mark, cm. Positive is to the right
   *  of frame — which way that is in the gym is the viewer's to say. */
  xCm: number[];
  /** Vertical displacement from the first mark, cm, positive up. */
  yCm: number[];

  vxMs: number[];
  vyMs: number[];
  /** Resultant speed, |v|. */
  speedMs: number[];
  ayMs2: number[];

  /** Instantaneous barbell power, W. Null throughout when no mass is known. */
  powerW: number[] | null;
  massKg: number | null;

  filter: FilterSettings;
  /** False when the filter was skipped — the series is then RAW, and the UI
   *  must say so rather than implying it was smoothed. */
  filtered: boolean;
}

/** Per-rep headline figures. Phase-specific numbers live in `phases.ts`, which
 *  consumes this. */
export interface RepSummary {
  durationS: number;
  /** The number a coach quotes: peak upward bar velocity. */
  peakVerticalVelocityMs: number;
  peakVerticalVelocityT: number;
  peakSpeedMs: number;
  /** Highest the bar got above the first mark. */
  peakHeightCm: number;
  apexT: number;
  /** Total horizontal spread of the path. */
  loopWidthCm: number;
  peakPowerW: number | null;
  peakPowerT: number | null;
  /** Mean power while the bar is being driven upward (v > 0 and force > 0) —
   *  the propulsive portion, not the whole clip, which would be diluted by the
   *  catch. Null without a mass. */
  meanPropulsivePowerW: number | null;
}

/**
 * Run the pipeline. Null when there is no calibration or too little track —
 * the two cases where any number would be invented rather than measured.
 */
export function computeKinematics(
  points: readonly TrackPoint[],
  calibration: Calibration | null,
  options: KinematicsOptions = {},
): KinematicSeries | null {
  if (!calibration || calibration.confidence === 'degenerate') return null;
  if (points.length < MIN_POINTS_FOR_KINEMATICS) return null;

  const sorted = [...points].sort((a, b) => a.t - b.t);
  const origin = sorted[0];

  // Into the plate's frame: cm, y up, relative to the first mark.
  const t = sorted.map(p => p.t - origin.t);
  const cm = sorted.map(p => displacementToCm(calibration, p.x - origin.x, p.y - origin.y));

  const gridX = resampleUniform({ t, v: cm.map(p => p.x) }, options.dt);
  const gridY = resampleUniform({ t, v: cm.map(p => p.y) }, options.dt);
  const dt = gridY.dt;
  if (!(dt > 0)) return null;
  const sampleRateHz = 1 / dt;

  const filter = options.filter ?? DEFAULT_FILTER;
  const filtered = filter.kind !== 'none' && filterSettingsAreUsable(filter, sampleRateHz);

  const xCm = butterworthLowPass(gridX.v, sampleRateHz, filter);
  const yCm = butterworthLowPass(gridY.v, sampleRateHz, filter);

  // cm → m at the derivative, once, rather than scaling the position series:
  // the position series is what the coach sees on the chart, and centimetres
  // are the readable unit for a 120 cm pull.
  const vxMs = derivative(xCm, dt).map(v => v / 100);
  const vyMs = derivative(yCm, dt).map(v => v / 100);
  const speedMs = vxMs.map((vx, i) => Math.hypot(vx, vyMs[i]));
  const ayMs2 = derivative(vyMs, dt);

  const massKg = options.massKg ?? null;
  const powerW =
    massKg && massKg > 0 ? ayMs2.map((a, i) => massKg * (a + G) * vyMs[i]) : null;

  return {
    t: gridY.t,
    dt,
    sampleRateHz,
    xCm,
    yCm,
    vxMs,
    vyMs,
    speedMs,
    ayMs2,
    powerW,
    massKg,
    filter,
    filtered,
  };
}

/** Headline figures from a computed series. */
export function summariseRep(series: KinematicSeries): RepSummary {
  const n = series.t.length;
  const empty: RepSummary = {
    durationS: 0,
    peakVerticalVelocityMs: 0,
    peakVerticalVelocityT: 0,
    peakSpeedMs: 0,
    peakHeightCm: 0,
    apexT: 0,
    loopWidthCm: 0,
    peakPowerW: null,
    peakPowerT: null,
    meanPropulsivePowerW: null,
  };
  if (n === 0) return empty;

  let peakV = -Infinity;
  let peakVT = series.t[0];
  let peakSpeed = 0;
  let peakY = -Infinity;
  let apexT = series.t[0];
  let minX = series.xCm[0];
  let maxX = series.xCm[0];
  let peakP: number | null = series.powerW ? -Infinity : null;
  let peakPT: number | null = null;
  let propulsiveSum = 0;
  let propulsiveCount = 0;

  for (let i = 0; i < n; i++) {
    if (series.vyMs[i] > peakV) {
      peakV = series.vyMs[i];
      peakVT = series.t[i];
    }
    peakSpeed = Math.max(peakSpeed, series.speedMs[i]);
    if (series.yCm[i] > peakY) {
      peakY = series.yCm[i];
      apexT = series.t[i];
    }
    minX = Math.min(minX, series.xCm[i]);
    maxX = Math.max(maxX, series.xCm[i]);

    if (series.powerW) {
      const p = series.powerW[i];
      if (peakP === null || p > peakP) {
        peakP = p;
        peakPT = series.t[i];
      }
      // Propulsive: the bar is going up AND the lifter is still pushing it.
      // Including the descent would average a large negative number into the
      // result and make a good lift look weak.
      if (series.vyMs[i] > 0 && p > 0) {
        propulsiveSum += p;
        propulsiveCount++;
      }
    }
  }

  return {
    durationS: series.t[n - 1] - series.t[0],
    peakVerticalVelocityMs: peakV,
    peakVerticalVelocityT: peakVT,
    peakSpeedMs: peakSpeed,
    peakHeightCm: peakY,
    apexT,
    loopWidthCm: maxX - minX,
    peakPowerW: peakP,
    peakPowerT: peakPT,
    meanPropulsivePowerW: propulsiveCount > 0 ? propulsiveSum / propulsiveCount : null,
  };
}

/**
 * Mean of a series over a closed time window, by linear index lookup.
 * Used by the phase layer for per-phase averages.
 */
export function meanOver(
  t: readonly number[],
  values: readonly number[],
  fromT: number,
  toT: number,
): number | null {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] >= fromT && t[i] <= toT) {
      sum += values[i];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Extremum of a series over a closed time window, with when it happened. */
export function peakOver(
  t: readonly number[],
  values: readonly number[],
  fromT: number,
  toT: number,
): { value: number; t: number } | null {
  let best: { value: number; t: number } | null = null;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < fromT || t[i] > toT) continue;
    if (!best || values[i] > best.value) best = { value: values[i], t: t[i] };
  }
  return best;
}
