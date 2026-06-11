import { describe, it, expect } from 'vitest';
import {
  formatDateToDDMMYYYY,
  formatDateShort,
  parseDDMMYYYYToISO,
  formatISOToDateInput,
  getMondayOfWeek,
  formatDateRange,
  formatWeekday,
  formatWeekdayDateShort,
  formatWeekdayDateLong,
  formatTime24,
  formatDateTimeShort,
} from '../dateUtils';

describe('formatDateToDDMMYYYY', () => {
  it('returns empty string for null', () => {
    expect(formatDateToDDMMYYYY(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatDateToDDMMYYYY(undefined)).toBe('');
  });

  it('formats a date string', () => {
    expect(formatDateToDDMMYYYY('2026-03-31')).toBe('31/03/2026');
  });
});

describe('formatDateShort', () => {
  it('formats to DD/MM', () => {
    expect(formatDateShort('2026-03-31')).toBe('31/03');
  });

  it('pads single-digit day and month', () => {
    expect(formatDateShort('2026-01-05')).toBe('05/01');
  });
});

describe('parseDDMMYYYYToISO', () => {
  it('converts DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(parseDDMMYYYYToISO('31/03/2026')).toBe('2026-03-31');
  });

  it('returns empty string for invalid format', () => {
    expect(parseDDMMYYYYToISO('invalid')).toBe('');
  });
});

describe('formatISOToDateInput', () => {
  it('returns empty string for null', () => {
    expect(formatISOToDateInput(null)).toBe('');
  });

  it('returns YYYY-MM-DD for ISO string', () => {
    expect(formatISOToDateInput('2026-03-31T00:00:00Z')).toBe('2026-03-31');
  });
});

describe('getMondayOfWeek', () => {
  it('returns the same day if already Monday', () => {
    const monday = new Date('2026-03-30'); // Monday
    const result = getMondayOfWeek(monday);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(30);
  });

  it('returns the previous Monday for a Wednesday', () => {
    const wednesday = new Date('2026-04-01'); // Wednesday
    const result = getMondayOfWeek(wednesday);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(30); // March 30
  });

  it('handles Sunday (goes back 6 days to Monday)', () => {
    const sunday = new Date('2026-04-05'); // Sunday
    const result = getMondayOfWeek(sunday);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(30); // March 30
  });
});

describe('formatDateRange', () => {
  it('formats a range within the same month', () => {
    // April 1–7 stays within April
    expect(formatDateRange('2026-04-01', 7)).toBe('01-07/04/2026');
  });

  it('formats a range spanning two months in the same year', () => {
    // March 30 + 7 days = April 5 — crosses month boundary
    expect(formatDateRange('2026-03-30', 7)).toMatch(/03 - \d+\/04\/2026/);
  });

  it('formats a single day range', () => {
    const result = formatDateRange('2026-04-01', 1);
    expect(result).toBe('01-01/04/2026');
  });
});

describe('formatWeekday (European, deterministic English)', () => {
  it('returns short English weekday names', () => {
    // 2026-06-08 is a Monday.
    expect(formatWeekday('2026-06-08')).toBe('Mon');
    expect(formatWeekday('2026-06-14')).toBe('Sun');
  });
  it('returns long names when asked', () => {
    expect(formatWeekday('2026-06-08', 'long')).toBe('Monday');
  });
  it('tolerates a full ISO timestamp', () => {
    expect(formatWeekday('2026-06-08T09:30:00Z')).toBe('Mon');
  });
  it('returns empty string for an unparseable date', () => {
    expect(formatWeekday('not-a-date')).toBe('');
  });
});

describe('formatWeekdayDateShort / Long (day-first)', () => {
  it('combines weekday with DD/MM', () => {
    expect(formatWeekdayDateShort('2026-06-10')).toBe('Wed 10/06');
    expect(formatWeekdayDateLong('2026-06-10')).toBe('Wednesday 10/06');
  });
});

describe('formatTime24 (24-hour, no AM/PM)', () => {
  it('formats local hours and minutes zero-padded', () => {
    const d = new Date(2026, 5, 10, 16, 5);
    expect(formatTime24(d)).toBe('16:05');
  });
  it('can include seconds', () => {
    const d = new Date(2026, 5, 10, 16, 5, 9);
    expect(formatTime24(d, true)).toBe('16:05:09');
  });
  it('never emits AM/PM', () => {
    const d = new Date(2026, 5, 10, 0, 0);
    expect(formatTime24(d)).toBe('00:00');
    expect(formatTime24(d)).not.toMatch(/[AP]M/i);
  });
});

describe('formatDateTimeShort (DD/MM HH:mm)', () => {
  it('formats a Date as day-first date + 24h time', () => {
    const d = new Date(2026, 5, 10, 14, 30);
    expect(formatDateTimeShort(d)).toBe('10/06 14:30');
  });
});
