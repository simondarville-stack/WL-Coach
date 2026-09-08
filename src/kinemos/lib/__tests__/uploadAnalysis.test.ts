/**
 * The pure half of analysing on the phone (P8 plan): the mass rule, the
 * sentence, the preference.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ArrivalOutcome } from '../arrivals';
import {
  analyseOnUploadEnabled,
  describeUploadOutcome,
  massForUpload,
  setAnalyseOnUpload,
} from '../uploadAnalysis';

const outcome = (result: ArrivalOutcome['result']): ArrivalOutcome => ({
  target: { source: 'log', sourceId: 'v1', label: 'Your lift' },
  result,
  message: '',
});
const reps = (n: number) => Array.from({ length: n }, () => ({}) as never);
const base = { analysisIds: [], ellipse: null, joins: 0, windows: [], scan: null, fellBack: false };

describe('massForUpload', () => {
  it('takes the heaviest completed set', () => {
    expect(
      massForUpload([
        { performed_load: 60, status: 'completed' },
        { performed_load: 70, status: 'completed' },
        { performed_load: 65, status: 'completed' },
      ]),
    ).toBe(70);
  });

  it('ignores sets that were not completed, and sets with no load', () => {
    expect(
      massForUpload([
        { performed_load: 90, status: 'failed' },
        { performed_load: 85, status: 'pending' },
        { performed_load: null, status: 'completed' },
        { performed_load: 62, status: 'completed' },
      ]),
    ).toBe(62);
  });

  it('is null with nothing logged yet — the rep is then stored without a mass', () => {
    expect(massForUpload([])).toBeNull();
    expect(massForUpload([{ performed_load: 80, status: 'pending' }])).toBeNull();
  });
});

describe('describeUploadOutcome', () => {
  it('counts the reps', () => {
    expect(describeUploadOutcome(outcome({ ...base, reps: reps(2) }))).toBe('2 reps analysed');
    expect(describeUploadOutcome(outcome({ ...base, reps: reps(1) }))).toBe('1 rep analysed');
  });

  it('is silent on failure, on no reps, and on a stopped run', () => {
    expect(describeUploadOutcome(outcome(null))).toBeNull();
    expect(describeUploadOutcome(outcome({ ...base, reps: [], problem: 'no-plate' }))).toBeNull();
    expect(describeUploadOutcome(outcome({ ...base, reps: [], problem: 'no-reps' }))).toBeNull();
    expect(describeUploadOutcome(outcome({ ...base, reps: [], problem: 'stopped' }))).toBeNull();
  });
});

describe('analyseOnUploadEnabled', () => {
  afterEach(() => localStorage.removeItem('kinemos.analyseOnUpload'));

  it('is on by default and off only when said so', () => {
    expect(analyseOnUploadEnabled()).toBe(true);
    setAnalyseOnUpload(false);
    expect(analyseOnUploadEnabled()).toBe(false);
    setAnalyseOnUpload(true);
    expect(analyseOnUploadEnabled()).toBe(true);
  });

  it("is its own key, not the coach's analyse-on-import", () => {
    localStorage.setItem('kinemos.analyseOnImport', 'off');
    expect(analyseOnUploadEnabled()).toBe(true);
    localStorage.removeItem('kinemos.analyseOnImport');
  });
});
