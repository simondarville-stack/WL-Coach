/**
 * The catalogue is read by three surfaces and written by one. These tests pin
 * the contract between them: every metric is complete, the stored shape round
 * trips, and an older or damaged cache row reads as nulls rather than as
 * zeros or a crash.
 */
import { describe, expect, it } from 'vitest';
import type { RepSummary } from '../kinematics';
import {
  METRIC_CATALOGUE,
  STORED_METRICS_SCHEMA,
  fromStoredMetrics,
  metricById,
  toStoredMetrics,
} from '../metricCatalogue';
import type { LiftMetrics } from '../phases';

const metrics: LiftMetrics = {
  phases: [
    {
      phaseId: 'first_pull',
      label: 'First pull',
      durationS: 0.4,
      meanVelocityMs: 0.9,
      peakVelocityMs: 1.2,
      peakVelocityT: 0.3,
      heightGainedCm: 30,
      peakPowerW: 1400,
    },
    {
      phaseId: 'second_pull',
      label: 'Second pull',
      durationS: 0.2,
      meanVelocityMs: 1.6,
      peakVelocityMs: 1.85,
      peakVelocityT: 0.7,
      heightGainedCm: 25,
      peakPowerW: 2300,
    },
  ],
  peakVelocityMs: 1.85,
  transitionVelocityLossMs: 0.12,
  turnoverVelocityMs: 0.6,
  peakPowerW: 2300,
};

const summary: RepSummary = {
  durationS: 1.4,
  peakVerticalVelocityMs: 1.85,
  peakVerticalVelocityT: 0.7,
  peakSpeedMs: 1.9,
  peakHeightCm: 98.5,
  apexT: 0.95,
  loopWidthCm: 7.2,
  peakPowerW: 2300,
  peakPowerT: 0.68,
  meanPropulsivePowerW: 1500,
};

describe('METRIC_CATALOGUE', () => {
  it('gives every metric an id, a label, a unit and a reason to care', () => {
    for (const m of METRIC_CATALOGUE) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.unit).toBeTruthy();
      expect(m.why.length).toBeGreaterThan(10);
      expect(m.significant).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = METRIC_CATALOGUE.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads each metric off a computed lift', () => {
    const lift = { metrics, summary };
    expect(metricById('peakVelocity')!.read(lift)).toBe(1.85);
    expect(metricById('firstPull')!.read(lift)).toBe(1.2);
    expect(metricById('secondPull')!.read(lift)).toBe(1.85);
    expect(metricById('transitionLoss')!.read(lift)).toBe(0.12);
    expect(metricById('peakHeight')!.read(lift)).toBe(98.5);
    expect(metricById('loopWidth')!.read(lift)).toBe(7.2);
    expect(metricById('peakPower')!.read(lift)).toBe(2300);
    expect(metricById('duration')!.read(lift)).toBe(1.4);
  });

  it('reads null, not zero, for a summary metric when there is no summary', () => {
    const lift = { metrics, summary: null };
    expect(metricById('peakHeight')!.read(lift)).toBeNull();
    expect(metricById('duration')!.read(lift)).toBeNull();
    // The velocity metrics do not need the summary.
    expect(metricById('peakVelocity')!.read(lift)).toBe(1.85);
  });

  it('reads null for a phase the set does not have', () => {
    const lift = { metrics: { ...metrics, phases: [] }, summary };
    expect(metricById('secondPull')!.read(lift)).toBeNull();
  });
});

describe('stored metrics', () => {
  it('round-trips through the cache column under the current schema', () => {
    const stored = toStoredMetrics(metrics, summary);
    expect(stored.schema).toBe(STORED_METRICS_SCHEMA);
    const back = fromStoredMetrics(JSON.parse(JSON.stringify(stored)));
    expect(back).not.toBeNull();
    expect(back!.schema).toBe(STORED_METRICS_SCHEMA);
    expect(back!.peakVelocityMs).toBe(1.85);
    expect(back!.phases).toHaveLength(2);
    expect(back!.summary?.loopWidthCm).toBe(7.2);
  });

  it('reads a row written before the schema existed as schema 0 with no summary', () => {
    // What the viewer wrote in 0.80.0–0.83.2: a bare LiftMetrics.
    const back = fromStoredMetrics(JSON.parse(JSON.stringify(metrics)));
    expect(back).not.toBeNull();
    expect(back!.schema).toBe(0);
    expect(back!.summary).toBeNull();
    expect(back!.transitionVelocityLossMs).toBe(0.12);
  });

  it('coerces numeric strings and refuses anything that is not a number', () => {
    const back = fromStoredMetrics({
      phases: [],
      peakVelocityMs: '1,5'.replace(',', '.'),
      transitionVelocityLossMs: 'not a number',
      turnoverVelocityMs: null,
      peakPowerW: Infinity,
    });
    expect(back!.peakVelocityMs).toBe(1.5);
    expect(back!.transitionVelocityLossMs).toBeNull();
    expect(back!.turnoverVelocityMs).toBeNull();
    expect(back!.peakPowerW).toBeNull();
  });

  it('returns null for a column that holds no metrics at all', () => {
    expect(fromStoredMetrics(null)).toBeNull();
    expect(fromStoredMetrics(undefined)).toBeNull();
    expect(fromStoredMetrics('x')).toBeNull();
    expect(fromStoredMetrics({})).toBeNull();
    expect(fromStoredMetrics({ phases: 'no' })).toBeNull();
  });
});
