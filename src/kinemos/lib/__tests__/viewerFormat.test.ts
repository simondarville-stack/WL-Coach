/**
 * The viewer's number formatting. Small rules, but two of them are product
 * requirements rather than taste: comma decimals (CLAUDE.md "Stack") and never
 * printing a measured value without the unit that says whether it is
 * centimetres or pixels.
 */
import { describe, expect, it } from 'vitest';
import { clipTime, distance, drift, mmPerPx, num } from '../viewerFormat';

describe('num', () => {
  it('uses comma decimals', () => {
    expect(num(1.74)).toBe('1,74');
    expect(num(0.5, 1)).toBe('0,5');
  });

  it('renders a missing value as a dash, never as zero', () => {
    expect(num(null)).toBe('—');
    expect(num(undefined)).toBe('—');
    expect(num(Number.NaN)).toBe('—');
    expect(num(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('distance', () => {
  it('says which unit it is speaking', () => {
    expect(distance(43.21, true)).toBe('43,2 cm');
    expect(distance(43.21, false)).toBe('43 px');
  });

  it('drops the decimal on pixels — a tenth of a pixel is not a measurement', () => {
    expect(distance(100.4, false)).toBe('100 px');
  });
});

describe('clipTime', () => {
  it('formats as mm:ss,cc', () => {
    expect(clipTime(2.1)).toBe('00:02,10');
    expect(clipTime(75.5)).toBe('01:15,50');
  });

  it('does not print a negative or broken time', () => {
    expect(clipTime(-1)).toBe('00:00,00');
    expect(clipTime(Number.NaN)).toBe('00:00,00');
  });
});

describe('mmPerPx', () => {
  it('quotes the scale in millimetres, where the signal is', () => {
    // 0,21 cm/px is 2,10 mm/px — the form the viewer's readout uses.
    expect(mmPerPx(0.21)).toBe('2,10');
  });
});

describe('drift', () => {
  it('says the direction in words, not only in a sign', () => {
    expect(drift(4.2, true)).toBe('4,2 cm right of the start');
    expect(drift(-4.2, true)).toBe('4,2 cm left of the start');
  });

  it('calls a negligible drift what it is', () => {
    expect(drift(0.01, true)).toContain('no drift');
    expect(drift(-0.2, false)).toContain('no drift');
  });
});
