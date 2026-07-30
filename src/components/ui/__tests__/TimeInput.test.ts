import { describe, it, expect } from 'vitest';
import { parseTimeInput } from '../TimeInput';

describe('parseTimeInput (24-hour, locale-independent)', () => {
  it('accepts a full HH:mm', () => {
    expect(parseTimeInput('16:30')).toBe('16:30');
    expect(parseTimeInput('00:00')).toBe('00:00');
    expect(parseTimeInput('23:59')).toBe('23:59');
  });

  it('expands bare-hour shorthand', () => {
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('16')).toBe('16:00');
  });

  it('expands hhmm shorthand', () => {
    expect(parseTimeInput('930')).toBe('09:30');
    expect(parseTimeInput('1630')).toBe('16:30');
    expect(parseTimeInput('0700')).toBe('07:00');
  });

  it('pads unpadded parts around a colon', () => {
    expect(parseTimeInput('9:5')).toBe('09:05');
    expect(parseTimeInput('7:00')).toBe('07:00');
    expect(parseTimeInput('16:')).toBe('16:00');
  });

  it('trims surrounding whitespace', () => {
    expect(parseTimeInput('  16:30 ')).toBe('16:30');
  });

  it('rejects out-of-range times', () => {
    expect(parseTimeInput('24:00')).toBe('');
    expect(parseTimeInput('16:60')).toBe('');
    expect(parseTimeInput('99')).toBe('');
  });

  it('rejects junk and never guesses AM/PM', () => {
    expect(parseTimeInput('')).toBe('');
    expect(parseTimeInput('abc')).toBe('');
    expect(parseTimeInput('4:00 PM')).toBe('');
    expect(parseTimeInput('12:34:56')).toBe('');
    expect(parseTimeInput('1:2:3')).toBe('');
  });
});
