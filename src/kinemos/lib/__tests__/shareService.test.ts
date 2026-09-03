import { describe, expect, it } from 'vitest';
import { defaultShareMessage } from '../shareService';

describe('defaultShareMessage', () => {
  it('says what was shared when the coach wrote nothing', () => {
    expect(
      defaultShareMessage({
        athleteName: 'Caroline',
        exerciseName: 'Snatch',
        date: '2026-09-03',
        loadKg: 62.5,
        repIndex: 1,
        label: null,
        vmaxMs: 2.312,
        peakHeightCm: 133.5,
        grade: 'A',
        clipUrl: null,
      }),
    ).toBe('Shared a lift analysis: Snatch 62,5 kg — Vmax 2,31 m/s, height 134 cm');
  });

  it('leaves out what is not known', () => {
    expect(
      defaultShareMessage({
        athleteName: null,
        exerciseName: null,
        date: null,
        loadKg: null,
        repIndex: 1,
        label: null,
        vmaxMs: null,
        peakHeightCm: null,
        grade: null,
        clipUrl: null,
      }),
    ).toBe('Shared a lift analysis: Lift');
  });
});
