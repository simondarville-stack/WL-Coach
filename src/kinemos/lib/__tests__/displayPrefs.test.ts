import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_PREFS,
  heatScaleMs,
  parseDisplayPrefs,
  velocityColour,
} from '../displayPrefs';

describe('parseDisplayPrefs', () => {
  it('returns the defaults for nothing, garbage, or the wrong shape', () => {
    expect(parseDisplayPrefs(null)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs('x')).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs({ stage: 4, plot: [] })).toEqual(DEFAULT_DISPLAY_PREFS);
  });

  it('keeps every valid field and drops each invalid one on its own', () => {
    const parsed = parseDisplayPrefs({
      stage: { path: 'points', lineWidthPx: 3, opacity: 7, colour: 'velocity', grid: 'diagonal', gridCm: 20, cursor: false, trail: 'past' },
      plot: { labels: { v1: false, knee: 'yes' }, line: 'heatmap', points: true, lineWidth: -1 },
    });
    expect(parsed.stage.path).toBe('points');
    expect(parsed.stage.lineWidthPx).toBe(3);
    expect(parsed.stage.opacity).toBe(DEFAULT_DISPLAY_PREFS.stage.opacity);
    expect(parsed.stage.colour).toBe('velocity');
    expect(parsed.stage.grid).toBe('off');
    expect(parsed.stage.gridCm).toBe(20);
    expect(parsed.stage.cursor).toBe(false);
    expect(parsed.stage.trail).toBe('past');
    expect(parsed.plot.labels.v1).toBe(false);
    expect(parsed.plot.labels.knee).toBe(true);
    expect(parsed.plot.labels.v2).toBe(true);
    expect(parsed.plot.line).toBe('heatmap');
    expect(parsed.plot.points).toBe(true);
    expect(parsed.plot.lineWidth).toBe(DEFAULT_DISPLAY_PREFS.plot.lineWidth);
  });

  it('round-trips its own output', () => {
    expect(parseDisplayPrefs(JSON.parse(JSON.stringify(DEFAULT_DISPLAY_PREFS)))).toEqual(DEFAULT_DISPLAY_PREFS);
  });
});

describe('velocityColour', () => {
  it('is grey at rest, red at the scale, blue below zero, and clamps beyond', () => {
    expect(velocityColour(0, 2)).toBe('rgb(156,163,175)');
    expect(velocityColour(2, 2)).toBe('rgb(220,38,38)');
    expect(velocityColour(5, 2)).toBe('rgb(220,38,38)');
    expect(velocityColour(-2, 2)).toBe('rgb(37,99,235)');
    expect(velocityColour(-9, 2)).toBe('rgb(37,99,235)');
  });

  it('passes through amber half way up, and survives a bad scale or value', () => {
    expect(velocityColour(1, 2)).toBe('rgb(245,158,11)');
    expect(velocityColour(1, 0)).toBe('rgb(220,38,38)');
    expect(velocityColour(Number.NaN, 2)).toBe('rgb(156,163,175)');
  });
});

describe('heatScaleMs', () => {
  it('is the largest rise of the series, or 1 m/s when it never rises', () => {
    expect(heatScaleMs([-0.5, 0.2, 1.7, 0.9])).toBe(1.7);
    expect(heatScaleMs([-0.5, 0, -1])).toBe(1);
    expect(heatScaleMs([])).toBe(1);
  });
});
