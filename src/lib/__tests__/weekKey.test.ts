import { describe, it, expect } from 'vitest';
import {
  isoMonday,
  snapToMonday,
  isoAddDays,
  isoAddWeeks,
  weekStartsBetween,
  weeksBetween,
} from '../dateUtils';

describe('isoMonday (UTC-consistent week start)', () => {
  it('returns the Monday of a mid-week date', () => {
    expect(isoMonday('2026-06-03')).toBe('2026-06-01'); // Wed → Mon
  });
  it('returns a Monday unchanged', () => {
    expect(isoMonday('2026-06-01')).toBe('2026-06-01');
  });
  it('maps Sunday back to the Monday that started its week', () => {
    expect(isoMonday('2026-05-31')).toBe('2026-05-25'); // Sun belongs to prior Mon
  });
});

describe('snapToMonday (DST-corruption tolerant)', () => {
  it('leaves a real Monday alone', () => {
    expect(snapToMonday('2026-06-01')).toBe('2026-06-01');
  });
  it('snaps a Sunday FORWARD to Monday (the legacy off-by-one corruption)', () => {
    // The toISOString() bug stored Monday 2026-06-01 as Sunday 2026-05-31 for
    // positive-UTC coaches; nearest-Monday recovers the intended week.
    expect(snapToMonday('2026-05-31')).toBe('2026-06-01');
  });
  it('snaps a Tuesday back to Monday', () => {
    expect(snapToMonday('2026-06-02')).toBe('2026-06-01');
  });
});

describe('iso date arithmetic', () => {
  it('adds days/weeks UTC-consistently', () => {
    expect(isoAddDays('2026-06-01', 7)).toBe('2026-06-08');
    expect(isoAddWeeks('2026-06-01', 2)).toBe('2026-06-15');
    expect(isoAddWeeks('2026-06-15', -2)).toBe('2026-06-01');
  });
  it('lists inclusive week-starts', () => {
    expect(weekStartsBetween('2026-06-01', '2026-06-15')).toEqual([
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
    ]);
  });
  it('counts whole weeks between dates', () => {
    expect(weeksBetween('2026-06-01', '2026-06-15')).toBe(2);
    expect(weeksBetween('2026-06-03', '2026-06-15')).toBe(2); // Monday-aligned
  });
});
