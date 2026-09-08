/**
 * A delta says its direction in a word, and says "same" below the metric's
 * threshold — which for velocities is the wider of the catalogue's step and
 * the grade's margin, so the table agrees with the verdict.
 */
import { describe, expect, it } from 'vitest';
import type { ComputedLift } from '../../engine/metricCatalogue';
import type { LiftMetrics } from '../../engine/phases';
import { catalogueDelta, describeDelta, velocityThreshold } from '../metricDeltas';

function lift(peak: number, power: number | null = 3140, loss = 0.11): ComputedLift {
  const metrics = {
    phases: [],
    peakVelocityMs: peak,
    transitionVelocityLossMs: loss,
    turnoverVelocityMs: 0.6,
    peakPowerW: power,
    analyzer: { vmaxMs: peak, sVmaxCm: 96.1 },
  } as unknown as LiftMetrics;
  return { metrics, summary: null };
}

describe('describeDelta', () => {
  const higher = { decimals: 2, betterWhen: 'higher' as const, threshold: 0.03 };

  it('says better and worse when up is better', () => {
    expect(describeDelta(1.82, 1.78, higher)).toEqual({ delta: expect.closeTo(0.04, 6), text: '+0,04 ↑ better', tone: 'better' });
    expect(describeDelta(1.7, 1.78, higher)?.text).toBe('−0,08 ↓ worse');
  });

  it('flips the words when lower is better', () => {
    const lower = { ...higher, betterWhen: 'lower' as const };
    expect(describeDelta(0.14, 0.11, lower)?.text).toBe('+0,03 ↓ worse');
    expect(describeDelta(0.08, 0.11, lower)?.text).toBe('−0,03 ↑ better');
  });

  it('uses neutral words, the row’s own where given, when there is no better direction', () => {
    const neutral = { decimals: 1, betterWhen: null, threshold: 1 };
    expect(describeDelta(108.4, 107.3, neutral)).toMatchObject({ text: '+1,1 ↑ higher', tone: 'neutral' });
    expect(describeDelta(96.1, 98.9, { ...neutral, words: ['later in the pull', 'earlier in the pull'] })?.text).toBe(
      '−2,8 ↓ earlier in the pull',
    );
  });

  it('reports a difference under the threshold as same, keeping its sign', () => {
    expect(describeDelta(1.79, 1.78, higher)).toMatchObject({ text: '+0,01 same', tone: 'same' });
    expect(describeDelta(1.78, 1.78, higher)?.text).toBe('±0,00 same');
    // Rounds to zero at the shown decimals: ± rather than a misleading +.
    expect(describeDelta(1.781, 1.78, higher)?.text).toBe('±0,00 same');
  });

  it('has nothing to say when either side is missing', () => {
    expect(describeDelta(null, 1.78, higher)).toBeNull();
    expect(describeDelta(1.78, null, higher)).toBeNull();
    expect(describeDelta(Number.NaN, 1.78, higher)).toBeNull();
  });
});

describe('catalogueDelta', () => {
  it('reads both lifts through the catalogue and gates velocities on the grade margin', () => {
    // +0,04 clears the catalogue's 0,03 but not a ±0,05 grade.
    expect(catalogueDelta('peakVelocity', lift(1.82), lift(1.78), null)?.text).toBe('+0,04 ↑ better');
    expect(catalogueDelta('peakVelocity', lift(1.82), lift(1.78), 0.05)?.text).toBe('+0,04 same');
    expect(velocityThreshold(0.03, 0.05)).toBe(0.05);
    expect(velocityThreshold(0.03, null)).toBe(0.03);
  });

  it('leaves non-velocity metrics to their own threshold', () => {
    expect(catalogueDelta('peakPower', lift(1.82, 3140), lift(1.78, 3050), 0.05)?.text).toBe('+90 ↑ better');
    expect(catalogueDelta('transitionLoss', lift(1.82, 3140, 0.14), lift(1.78, 3140, 0.11), null)?.text).toBe('+0,03 ↓ worse');
  });

  it('is null for a missing value or an unknown id', () => {
    expect(catalogueDelta('peakPower', lift(1.82, null), lift(1.78), null)).toBeNull();
    expect(catalogueDelta('noSuchMetric', lift(1.82), lift(1.78), null)).toBeNull();
  });
});
