import { describe, it, expect } from 'vitest';
import { weekState, isWeekComplete } from '../weekUtils';

// 2026-06-08 is a Monday; pass it explicitly so the test is clock-independent.
const today = '2026-06-08';

describe('weekState / isWeekComplete', () => {
  it('classifies a week relative to the current Monday', () => {
    expect(weekState('2026-06-01', today)).toBe('past');
    expect(weekState('2026-06-08', today)).toBe('current');
    expect(weekState('2026-06-15', today)).toBe('future');
  });

  it('is complete only once the next Monday has arrived', () => {
    expect(isWeekComplete('2026-06-01', today)).toBe(true);
    expect(isWeekComplete('2026-06-08', today)).toBe(false); // in progress — no graded %
    expect(isWeekComplete('2026-06-15', today)).toBe(false);
  });
});
