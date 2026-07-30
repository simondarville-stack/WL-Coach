import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMondayOfWeekISO,
  findCurrentMacroWeek,
  generateMacroWeeks,
} from '../weekUtils';

describe('getMondayOfWeekISO', () => {
  it('returns the Monday of the week as an ISO date string', () => {
    const wednesday = new Date('2026-04-01');
    expect(getMondayOfWeekISO(wednesday)).toBe('2026-03-30');
  });

  it('returns the same date if already Monday', () => {
    const monday = new Date('2026-03-30');
    expect(getMondayOfWeekISO(monday)).toBe('2026-03-30');
  });
});

describe('findCurrentMacroWeek', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns null for empty array', () => {
    expect(findCurrentMacroWeek([])).toBeNull();
  });

  it('finds the week containing today', () => {
    const weeks = [
      { id: '1', week_start: '2026-03-23' },
      { id: '2', week_start: '2026-03-30' },
      { id: '3', week_start: '2026-04-06' },
    ];
    expect(findCurrentMacroWeek(weeks)?.id).toBe('2');
  });

  it('returns null when no week contains today', () => {
    const weeks = [
      { id: '1', week_start: '2026-01-01' },
      { id: '2', week_start: '2026-01-08' },
    ];
    expect(findCurrentMacroWeek(weeks)).toBeNull();
  });
});

describe('generateMacroWeeks', () => {
  it('generates correct number of weeks', () => {
    const weeks = generateMacroWeeks('2026-03-30', '2026-04-26');
    expect(weeks.length).toBe(4);
  });

  it('starts on the given Monday', () => {
    const weeks = generateMacroWeeks('2026-03-30', '2026-04-05');
    expect(weeks[0].week_start).toBe('2026-03-30');
    expect(weeks[0].week_number).toBe(1);
  });

  it('increments week numbers sequentially', () => {
    // end date on the 3rd Monday itself — ensures 3 weeks are included
    const weeks = generateMacroWeeks('2026-03-30', '2026-04-13');
    expect(weeks.map(w => w.week_number)).toEqual([1, 2, 3]);
  });

  it('includes the whole week holding the start date', () => {
    // Wednesday start → the cycle still opens on that week's Monday
    const weeks = generateMacroWeeks('2026-04-01', '2026-04-19');
    expect(weeks[0].week_start).toBe('2026-03-30');
  });

  it('includes the whole week holding the end date, on any weekday', () => {
    // Mon 30/03 … the week of 20–26/04 is the last one, whichever day of it
    // the coach picks as the end date.
    for (const end of [
      '2026-04-20', '2026-04-22', '2026-04-24', '2026-04-26',
    ]) {
      const weeks = generateMacroWeeks('2026-03-30', end);
      expect(weeks.length).toBe(4);
      expect(weeks[weeks.length - 1].week_start).toBe('2026-04-20');
    }
  });

  it('keeps the last week across the autumn DST change', () => {
    // Summer-time start, winter-time end (EU clocks go back Sun 25/10/2026).
    // Local Date stepping drifted past UTC midnight here and dropped W5.
    const weeks = generateMacroWeeks('2026-09-28', '2026-11-01');
    expect(weeks.map(w => w.week_start)).toEqual([
      '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26',
    ]);
  });

  it('keeps the last week across the spring DST change', () => {
    // EU clocks go forward Sun 29/03/2026.
    const weeks = generateMacroWeeks('2026-03-09', '2026-04-05');
    expect(weeks.map(w => w.week_start)).toEqual([
      '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30',
    ]);
  });

  it('returns a single week when start and end share one week', () => {
    expect(generateMacroWeeks('2026-04-01', '2026-04-03')).toEqual([
      { week_start: '2026-03-30', week_number: 1 },
    ]);
  });
});
