import { describe, it, expect } from 'vitest';
import {
  formatDateToDDMMYYYY,
  formatDateShort,
  parseDDMMYYYYToISO,
  formatISOToDateInput,
  getMondayOfWeek,
  formatDateRange,
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
