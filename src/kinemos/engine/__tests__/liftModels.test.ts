/**
 * The lift-model registry is data, and the catalogue reads it: which metrics
 * a deadlift, a jerk or an unnamed lift can have follows from the model, not
 * from a component knowing the lift.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_PHASE_SET_ID,
  LIFT_MODELS,
  UNSPECIFIED_MODEL,
  isKnownLiftModel,
  liftModelById,
  liftModelOfStored,
  liftModelsByFamily,
  partForKind,
  shapesComparable,
} from '../liftModels';
import { catalogueFor, metricById } from '../metricCatalogue';

describe('the registry', () => {
  it('has unique ids and a phase set wherever the shape has phases', () => {
    const ids = LIFT_MODELS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of LIFT_MODELS) {
      if (m.shape === 'free' || m.shape === 'compound') expect(m.phaseSet).toBeNull();
      else expect(m.phaseSet!.length).toBeGreaterThan(0);
    }
  });

  it('reads an unknown id as the unspecified lift rather than throwing', () => {
    expect(liftModelById('coach-defined-thing')).toBe(UNSPECIFIED_MODEL);
    expect(liftModelById(null)).toBe(UNSPECIFIED_MODEL);
    expect(isKnownLiftModel('jerk')).toBe(true);
    expect(isKnownLiftModel('nope')).toBe(false);
  });

  it('reads a pre-P9 row — no model, the legacy set — as a snatch from the floor', () => {
    expect(liftModelOfStored(null, LEGACY_PHASE_SET_ID).id).toBe('snatch');
    expect(liftModelOfStored(null, null).id).toBe('snatch');
    expect(liftModelOfStored('clean-pull', 'pull').id).toBe('clean-pull');
    // A row that names a set this build does not know, and no model: nothing
    // to assume.
    expect(liftModelOfStored(null, 'some-coach-set').id).toBe('unspecified');
  });

  it('stores a compound’s reps under its parts by what the bar did first', () => {
    const cj = liftModelById('clean-and-jerk');
    expect(partForKind(cj, 'pull').id).toBe('clean');
    expect(partForKind(cj, 'dip-drive').id).toBe('jerk');
    // A plain model has no parts and is its own part.
    expect(partForKind(liftModelById('snatch'), 'dip-drive').id).toBe('snatch');
  });

  it('groups by family in registry order, the full lift first', () => {
    const groups = liftModelsByFamily();
    expect(groups.map(g => g.family)).toEqual(['snatch', 'clean', 'jerk', 'none']);
    expect(groups[0].models[0].id).toBe('snatch');
    expect(groups[2].models[0].id).toBe('jerk');
  });

  it('compares only within a motion shape', () => {
    expect(shapesComparable(liftModelById('snatch'), liftModelById('clean'))).toBe(true);
    expect(shapesComparable(liftModelById('snatch'), liftModelById('jerk'))).toBe(false);
  });
});

describe('the catalogue as a model sees it', () => {
  const ids = (id: string) => catalogueFor(liftModelById(id)).map(m => m.id);

  it('a snatch from the floor has the whole pull set and nothing of the jerk', () => {
    const snatch = ids('snatch');
    expect(snatch).toContain('firstPull');
    expect(snatch).toContain('turnover');
    expect(snatch).toContain('fbr');
    expect(snatch).not.toContain('vDip');
  });

  it('a deadlift has no turnover, no catch and no second pull', () => {
    const dl = ids('snatch-deadlift');
    expect(dl).toContain('peakVelocity');
    expect(dl).toContain('meanRiseVelocity');
    expect(dl).not.toContain('turnover');
    expect(dl).not.toContain('secondPull');
    expect(dl).not.toContain('sSit');
    expect(dl).not.toContain('fbr');
  });

  it('a lift from above the knee has no first pull and no knee passage', () => {
    const hang = ids('snatch-hang-above-knee');
    expect(hang).not.toContain('firstPull');
    expect(hang).not.toContain('v2');
    expect(hang).not.toContain('f1');
    expect(hang).toContain('secondPull');
    expect(hang).toContain('sFall');
  });

  it('a jerk has the dip and drive measures, the catch measures, and no pull', () => {
    const jerk = ids('jerk');
    expect(jerk).toContain('vDip');
    expect(jerk).toContain('driveMinusDip');
    expect(jerk).toContain('sFall');
    expect(jerk).toContain('tTurn');
    expect(jerk).not.toContain('firstPull');
    expect(jerk).not.toContain('f3');
  });

  it('the unspecified lift keeps only the universal set', () => {
    const free = ids('unspecified');
    expect(free).toEqual(
      expect.arrayContaining(['peakVelocity', 'meanRiseVelocity', 'timeToPeakVelocity', 'timeToPeakPower', 'concentric', 'pathLength', 'peakHeight', 'loopWidth', 'peakPower', 'duration']),
    );
    expect(free).not.toContain('turnover');
    expect(free).not.toContain('vmin');
    expect(free).not.toContain('vDip');
    for (const id of free) expect(metricById(id)!.requires).toBeUndefined();
  });
});
