import { describe, it, expect } from 'vitest';
import { formatDecimalComma, formatTimestamp } from '../logFormatUtils';

describe('formatDecimalComma (European comma decimals)', () => {
  it('renders whole numbers without a fraction', () => {
    expect(formatDecimalComma(80)).toBe('80');
    expect(formatDecimalComma(0)).toBe('0');
  });
  it('uses a comma as the decimal separator', () => {
    expect(formatDecimalComma(82.5)).toBe('82,5');
    expect(formatDecimalComma(7.25, 2)).toBe('7,25');
  });
  it('never emits a period decimal', () => {
    expect(formatDecimalComma(1.5)).not.toContain('.');
  });
});

describe('formatTimestamp', () => {
  it('produces a day-first 24h stamp', () => {
    // Build a fixed local datetime to avoid TZ flakiness on the date portion.
    const d = new Date(2026, 4, 20, 14, 30); // 20 May 2026, 14:30 local
    expect(formatTimestamp(d.toISOString())).toBe('20/05 14:30');
  });
});
