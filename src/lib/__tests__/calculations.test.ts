import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateAge,
  getRawColor,
  getRawBgColor,
  getRelativeTime,
  needsAttentionCheck,
  computeRawAverage,
} from '../calculations';

describe('calculateAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns null for null input', () => {
    expect(calculateAge(null)).toBeNull();
  });

  it('calculates age correctly', () => {
    expect(calculateAge('2000-03-31')).toBe(26);
  });

  it('does not count birthday that has not yet occurred this year', () => {
    expect(calculateAge('2000-04-01')).toBe(25);
  });
});

describe('getRawColor', () => {
  it('returns gray for null', () => {
    expect(getRawColor(null)).toBe('text-gray-400');
  });

  it('returns green for 10+', () => {
    expect(getRawColor(10)).toBe('text-green-600');
    expect(getRawColor(15)).toBe('text-green-600');
  });

  it('returns yellow for 7–9', () => {
    expect(getRawColor(7)).toBe('text-yellow-600');
    expect(getRawColor(9)).toBe('text-yellow-600');
  });

  it('returns red below 7', () => {
    expect(getRawColor(6)).toBe('text-red-600');
    expect(getRawColor(0)).toBe('text-red-600');
  });
});

describe('getRawBgColor', () => {
  it('returns gray bg for null', () => {
    expect(getRawBgColor(null)).toBe('bg-gray-100');
  });

  it('returns green bg for 10+', () => {
    expect(getRawBgColor(10)).toBe('bg-green-100');
  });

  it('returns yellow bg for 7–9', () => {
    expect(getRawBgColor(8)).toBe('bg-yellow-100');
  });

  it('returns red bg below 7', () => {
    expect(getRawBgColor(5)).toBe('bg-red-100');
  });
});

describe('getRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Use a date well after DST transition to avoid timezone edge cases
    vi.setSystemTime(new Date('2026-05-01T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns Never for null', () => {
    expect(getRelativeTime(null)).toBe('Never');
  });

  it('returns Today for same day', () => {
    expect(getRelativeTime(new Date('2026-05-01T08:00:00'))).toBe('Today');
  });

  it('returns Yesterday for 1 day ago', () => {
    expect(getRelativeTime(new Date('2026-04-30T12:00:00'))).toBe('Yesterday');
  });

  it('returns days ago for 2–6 days', () => {
    expect(getRelativeTime(new Date('2026-04-27T12:00:00'))).toBe('4 days ago');
  });

  it('returns 1 week ago for 7–13 days', () => {
    expect(getRelativeTime(new Date('2026-04-24T12:00:00'))).toBe('1 week ago');
  });

  it('returns weeks ago for 14–29 days', () => {
    expect(getRelativeTime(new Date('2026-04-10T12:00:00'))).toBe('3 weeks ago');
  });

  it('returns months ago for 30+ days', () => {
    expect(getRelativeTime(new Date('2026-03-31T12:00:00'))).toBe('1 months ago');
  });
});

describe('needsAttentionCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns true for null date', () => {
    expect(needsAttentionCheck(null)).toBe(true);
  });

  it('returns false within 7 days', () => {
    expect(needsAttentionCheck(new Date('2026-03-25'))).toBe(false);
  });

  it('returns true beyond 7 days', () => {
    expect(needsAttentionCheck(new Date('2026-03-20'))).toBe(true);
  });
});

describe('computeRawAverage', () => {
  it('returns null for empty array', () => {
    expect(computeRawAverage([])).toBeNull();
  });

  it('returns null when all values are null', () => {
    expect(computeRawAverage([null, null])).toBeNull();
  });

  it('averages non-null values, ignoring nulls', () => {
    expect(computeRawAverage([10, null, 20, null])).toBe(15);
  });

  it('returns the value itself for a single entry', () => {
    expect(computeRawAverage([8])).toBe(8);
  });
});
