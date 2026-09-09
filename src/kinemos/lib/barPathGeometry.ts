/**
 * barPathGeometry — where a centimetre and a metre per second land in the
 * bar-path plot's viewBox.
 *
 * The plot is portrait, `0 0 200 540`, with bar height on y. The bar path's
 * horizontal axis is the SAME scale as the vertical one — a centimetre
 * sideways is as long as a centimetre up — so the loop on screen is the loop
 * the bar made. A coach reading a 3 cm loop-back against a 100 cm pull wants
 * it bigger than that, so the horizontal scale can be exaggerated ×2 or ×4;
 * the tick labels stay in real centimetres and the plot says the factor.
 *
 * Velocity has no shared scale with height and takes the plot's width.
 */
import type { KinematicSeries } from '../engine/kinematics';

export const VB_W = 200;
export const VB_H = 540;
/** The plot's vertical extent: the shared height axis runs from BASE (the
 *  lowest sample) up to TOP. */
export const TOP = 34;
export const BASE = 500;
/** The curves' horizontal extent; the right of it is the label gutter for
 *  the height reference lines. */
export const X_MIN = 24;
export const X_MAX = 136;
export const LABEL_X = 150;
/** Where the tick rows print. In Combined mode the two rows stack. */
export const TICK_ROW_1 = 518;
export const TICK_ROW_2 = 532;

export type Exaggeration = 1 | 2 | 4;
export const EXAGGERATIONS: readonly Exaggeration[] = [1, 2, 4];

export interface BarPathGeometry {
  yOf: (cm: number) => number;
  xOfPath: (cm: number) => number;
  xOfVelocity: (ms: number) => number;
  /** Force on the bar as a share of its weight (%), and barbell power (W),
   *  against the same height axis — the Analyzer's third and fourth curves
   *  (P9 plan §5.6). Power is null without a mass. */
  xOfForce: (pct: number) => number;
  xOfPower: ((w: number) => number) | null;
  /** ViewBox units per centimetre on the height axis. */
  unitsPerCm: number;
  /** Tick values, in the series' own units. */
  pathTicks: number[];
  velocityTicks: number[];
  forceTicks: number[];
  powerTicks: number[];
  pathZeroX: number;
  velocityZeroX: number;
  /** Where 100 % sits — the bar's own weight, the line a force curve
   *  crosses when the lifter stops pushing. */
  forceUnitX: number;
  powerZeroX: number | null;
}

export function barPathGeometry(series: KinematicSeries, exaggeration: Exaggeration = 1): BarPathGeometry {
  const height = rangeOf(series.yCm);
  const pad = height.span * 0.03;
  const lo = height.min - pad;
  const hi = height.max + pad;
  const unitsPerCm = (BASE - TOP) / (hi - lo || 1);
  const yOf = (cm: number) => BASE - (cm - lo) * unitsPerCm;

  // 1:1 with the height axis, times the exaggeration, centred on x = 0 (the
  // start) so a loop-back and a drift read against the same origin.
  const centre = (X_MIN + X_MAX) / 2;
  const kx = unitsPerCm * exaggeration;
  const xOfPath = (cm: number) => centre + cm * kx;
  // One tick either side of the origin, at the smallest "nice" step whose
  // labels do not overprint (~24 viewBox units apart). At 1:1 that is a
  // coarser step than at ×4; a tick that lands outside the plot is simply
  // not drawn, leaving the origin and the unit.
  const pathStep = [1, 2, 5, 10, 20, 50].find(step => step * kx >= 24) ?? 50;
  const pathTicks = [-pathStep, 0, pathStep];

  // Velocity: the range the lift covered, zero always inside it so "the bar
  // is coming back down" is a crossing rather than an off-plot fact.
  const v = rangeOf(series.vyMs);
  const vLo = Math.min(0, v.min) - v.span * 0.04;
  const vHi = Math.max(0, v.max) + v.span * 0.04;
  const kv = (X_MAX - X_MIN) / (vHi - vLo || 1);
  const xOfVelocity = (ms: number) => X_MIN + (ms - vLo) * kv;
  // A label is ~20 viewBox units wide; the step is the smallest of 0,5 / 1 /
  // 2 m/s that keeps neighbours apart.
  const velocityStep = [0.5, 1, 2].find(step => step * kv >= 26) ?? 2;
  const velocityTicks: number[] = [];
  for (let tick = Math.ceil(vLo / velocityStep) * velocityStep; tick <= vHi + 1e-9; tick += velocityStep) {
    velocityTicks.push(Number(tick.toFixed(2)));
  }

  // Force: the range the lift covered, 100 % always inside it, in steps of
  // 50 or 100 %.
  const force = rangeOf((series.ayMs2 ?? []).map(a => (1 + a / 9.80665) * 100));
  const fLo = Math.min(100, force.min) - force.span * 0.04;
  const fHi = Math.max(100, force.max) + force.span * 0.04;
  const kf = (X_MAX - X_MIN) / (fHi - fLo || 1);
  const xOfForce = (pct: number) => X_MIN + (pct - fLo) * kf;
  const forceStep = [50, 100, 200].find(step => step * kf >= 26) ?? 200;
  const forceTicks: number[] = [];
  for (let tick = Math.ceil(fLo / forceStep) * forceStep; tick <= fHi + 1e-9; tick += forceStep) forceTicks.push(tick);

  // Power: zero inside the range, in steps of 500 / 1000 / 2000 W.
  let xOfPower: ((w: number) => number) | null = null;
  const powerTicks: number[] = [];
  if (series.powerW) {
    const p = rangeOf(series.powerW);
    const pLo = Math.min(0, p.min) - p.span * 0.04;
    const pHi = Math.max(0, p.max) + p.span * 0.04;
    const kp = (X_MAX - X_MIN) / (pHi - pLo || 1);
    xOfPower = (w: number) => X_MIN + (w - pLo) * kp;
    const powerStep = [500, 1000, 2000, 5000].find(step => step * kp >= 26) ?? 5000;
    for (let tick = Math.ceil(pLo / powerStep) * powerStep; tick <= pHi + 1e-9; tick += powerStep) powerTicks.push(tick);
  }

  return {
    yOf,
    xOfPath,
    xOfVelocity,
    xOfForce,
    xOfPower,
    unitsPerCm,
    pathTicks,
    velocityTicks,
    forceTicks,
    powerTicks,
    pathZeroX: xOfPath(0),
    velocityZeroX: xOfVelocity(0),
    forceUnitX: xOfForce(100),
    powerZeroX: xOfPower ? xOfPower(0) : null,
  };
}

export function rangeOf(values: readonly number[]): { min: number; max: number; span: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1, span: 1 };
  return { min, max, span: max - min || 1 };
}
