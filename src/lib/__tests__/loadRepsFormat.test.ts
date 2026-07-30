import { describe, it, expect } from 'vitest';
import {
  formatKg,
  formatLoadReps,
  groupLoadReps,
  joinLoadRepsDetails,
} from '../loadRepsFormat';

describe('groupLoadReps', () => {
  it('collapses consecutive equal (load, reps) sets', () => {
    expect(groupLoadReps([
      { load: 80, reps: 3 },
      { load: 80, reps: 3 },
      { load: 85, reps: 2 },
    ])).toEqual([
      { load: 80, reps: 3, sets: 2 },
      { load: 85, reps: 2, sets: 1 },
    ]);
  });

  it('does NOT merge across a different pair in between — order is the record', () => {
    expect(groupLoadReps([
      { load: 80, reps: 3 },
      { load: 85, reps: 2 },
      { load: 80, reps: 3 },
    ])).toEqual([
      { load: 80, reps: 3, sets: 1 },
      { load: 85, reps: 2, sets: 1 },
      { load: 80, reps: 3, sets: 1 },
    ]);
  });

  it('drops sets with no load or no reps', () => {
    expect(groupLoadReps([
      { load: 0, reps: 5 },
      { load: 90, reps: 0 },
      { load: 90, reps: 1 },
    ])).toEqual([{ load: 90, reps: 1, sets: 1 }]);
  });

  it('returns [] for no entries', () => {
    expect(groupLoadReps([])).toEqual([]);
  });
});

describe('formatLoadReps', () => {
  it('omits the sets factor when sets = 1 (prescription display rule)', () => {
    expect(formatLoadReps([{ load: 100, reps: 1, sets: 1 }])).toBe('100×1');
  });

  it('renders load × reps × sets and joins segments with a comma', () => {
    expect(formatLoadReps([
      { load: 80, reps: 3, sets: 1 },
      { load: 85, reps: 2, sets: 3 },
    ])).toBe('80×3, 85×2×3');
  });

  it('uses comma decimals for fractional loads', () => {
    expect(formatLoadReps([{ load: 82.5, reps: 2, sets: 2 }])).toBe('82,5×2×2');
  });

  it('returns null when there is nothing to show', () => {
    expect(formatLoadReps([])).toBeNull();
  });
});

describe('formatKg', () => {
  it('drops a trailing zero decimal', () => {
    expect(formatKg(100)).toBe('100');
    expect(formatKg(100.0)).toBe('100');
  });

  it('rounds to one decimal and uses a comma', () => {
    expect(formatKg(82.54)).toBe('82,5');
  });
});

describe('joinLoadRepsDetails', () => {
  it('joins two days of the same week with a separator', () => {
    expect(joinLoadRepsDetails('80×3', '85×2')).toBe('80×3 · 85×2');
  });

  it('passes through when one side is empty', () => {
    expect(joinLoadRepsDetails(null, '85×2')).toBe('85×2');
    expect(joinLoadRepsDetails('80×3', null)).toBe('80×3');
    expect(joinLoadRepsDetails(null, null)).toBeNull();
  });
});
