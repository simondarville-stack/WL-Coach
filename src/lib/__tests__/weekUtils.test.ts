import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMondayOfWeekISO,
  findCurrentMacroWeek,
  generateMacroWeeks,
  getMacroWeekColor,
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
});

describe('getMacroWeekColor', () => {
  it('returns green for deload', () => {
    expect(getMacroWeekColor('Deload')).toBe('bg-green-50');
  });

  it('returns green for low', () => {
    expect(getMacroWeekColor('Low Volume')).toBe('bg-green-50');
  });

  it('returns orange for high', () => {
    expect(getMacroWeekColor('High Intensity')).toBe('bg-orange-50');
  });

  it('returns white for anything else', () => {
    expect(getMacroWeekColor('Medium')).toBe('bg-white');
    expect(getMacroWeekColor('Taper')).toBe('bg-white');
  });

  it('is case-insensitive', () => {
    expect(getMacroWeekColor('DELOAD')).toBe('bg-green-50');
    expect(getMacroWeekColor('HIGH')).toBe('bg-orange-50');
  });
});
