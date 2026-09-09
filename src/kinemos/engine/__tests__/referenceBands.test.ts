import { describe, expect, it } from 'vitest';
import { formatBand, referenceBand, withinBand } from '../referenceBands';

describe('referenceBand', () => {
  it('reads the snatch’s peak velocity by weight class', () => {
    expect(referenceBand('peakVelocity', 'snatch', 'lower', 'men')).toMatchObject({ lo: 1.5, hi: 1.7 });
    expect(referenceBand('peakVelocity', 'snatch', 'upper', 'women')).toMatchObject({ lo: 1.8, hi: 1.95 });
  });

  it('reads a force by sex, as a mean', () => {
    expect(referenceBand('f1', 'clean', 'middle', 'women')).toMatchObject({ lo: 127, hi: 127, kind: 'mean' });
  });

  it('reads the jerk’s dip depth by class and its drop as a range', () => {
    expect(referenceBand('sDip', 'jerk', 'upper', 'men')).toMatchObject({ lo: 20, hi: 22 });
    expect(referenceBand('sFall', 'jerk', 'lower', 'men')).toMatchObject({ lo: 2, hi: 6 });
  });

  it('has nothing to say about a pull’s phases, the universal set or the unspecified lift', () => {
    expect(referenceBand('meanRiseVelocity', 'snatch', 'middle', 'men')).toBeNull();
    expect(referenceBand('peakVelocity', 'none', 'middle', 'men')).toBeNull();
    expect(referenceBand('vDip', 'snatch', 'middle', 'men')).toBeNull();
  });
});

describe('withinBand and formatBand', () => {
  it('judges a range, a maximum and a minimum', () => {
    expect(withinBand(1.6, referenceBand('peakVelocity', 'snatch', 'lower', 'men'))).toBe(true);
    expect(withinBand(1.75, referenceBand('peakVelocity', 'snatch', 'lower', 'men'))).toBe(false);
    expect(withinBand(150, referenceBand('fbr', 'snatch', 'lower', 'men'))).toBe(false);
    expect(withinBand(-0.5, referenceBand('vmin', 'snatch', 'lower', 'men'))).toBe(true);
    expect(withinBand(null, referenceBand('vmin', 'snatch', 'lower', 'men'))).toBeNull();
  });

  it('prints comma decimals and the right sign', () => {
    expect(formatBand(referenceBand('peakVelocity', 'snatch', 'middle', 'men')!, 2)).toBe('1,70–1,85');
    expect(formatBand(referenceBand('f1', 'snatch', 'middle', 'men')!, 0)).toBe('Ø 137');
    expect(formatBand(referenceBand('fbr', 'snatch', 'middle', 'men')!, 0)).toBe('≤ 145');
    expect(formatBand(referenceBand('vmin', 'snatch', 'middle', 'men')!, 2)).toBe('≥ −0,85');
    expect(formatBand(referenceBand('vDip', 'jerk', 'middle', 'men')!, 2)).toBe('−1,10 to −1,00');
  });
});
