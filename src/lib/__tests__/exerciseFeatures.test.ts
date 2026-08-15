/**
 * Exercise features — soft-load signs (≥ ≈ ≤), rep/set ranges, and the
 * summary-override helpers. Covers the typed grammar, glyph round-trips,
 * midpoint summary math, and the honest-average rule (signed loads carry
 * no average).
 */
import { describe, it, expect } from 'vitest';
import {
  parsePrescription,
  formatPrescription,
  parseComboPrescription,
  formatComboPrescription,
  computePrescriptionSummary,
  splitLoadCmp,
  rangeMid,
} from '../prescriptionParser';
import { applyFeatureOverrides, formatSeconds, parseTimeInput, timeEditValue } from '../exerciseFeatures';

describe('splitLoadCmp', () => {
  it('parses the typed ASCII forms', () => {
    expect(splitLoadCmp('>=85')).toEqual({ cmp: '>=', rest: '85' });
    expect(splitLoadCmp('<=70%')).toEqual({ cmp: '<=', rest: '70%' });
    expect(splitLoadCmp('~80')).toEqual({ cmp: '~', rest: '80' });
  });
  it('rejects "==" — a leading "=" belongs to the formula grammar', () => {
    expect(splitLoadCmp('==80').cmp).toBeNull();
  });
  it('parses the display glyphs (formatted output must re-parse)', () => {
    expect(splitLoadCmp('≥85')).toEqual({ cmp: '>=', rest: '85' });
    expect(splitLoadCmp('≤70')).toEqual({ cmp: '<=', rest: '70' });
    expect(splitLoadCmp('≈80')).toEqual({ cmp: '~', rest: '80' });
  });
  it('leaves unsigned loads untouched', () => {
    expect(splitLoadCmp('85')).toEqual({ cmp: null, rest: '85' });
    expect(splitLoadCmp('80-90')).toEqual({ cmp: null, rest: '80-90' });
  });
});

describe('parsePrescription — signs and ranges', () => {
  it('parses a fully enriched segment', () => {
    const [line] = parsePrescription('>=85x3-5x4-6');
    expect(line).toMatchObject({
      loadCmp: '>=', load: 85, loadMax: null,
      reps: 3, repsMax: 5, sets: 4, setsMax: 6,
    });
  });
  it('parses plain prescriptions exactly as before', () => {
    const [line] = parsePrescription('80x5x3');
    expect(line).toMatchObject({ load: 80, reps: 5, sets: 3 });
    expect(line.loadCmp ?? null).toBeNull();
    expect(line.repsMax ?? null).toBeNull();
    expect(line.setsMax ?? null).toBeNull();
  });
  it('keeps load intervals working next to a sign', () => {
    const [line] = parsePrescription('≈80-90x5');
    expect(line).toMatchObject({ loadCmp: '~', load: 80, loadMax: 90, reps: 5, sets: 1 });
  });
  it('accepts en-dash ranges', () => {
    const [line] = parsePrescription('85×3–5');
    expect(line).toMatchObject({ reps: 3, repsMax: 5 });
  });
  it('rejects inverted ranges', () => {
    expect(parsePrescription('85x5-3')).toHaveLength(0);
  });
});

describe('format round-trips', () => {
  it('formats with glyphs and re-parses identically', () => {
    const raw = '>=85%x3-5x4-6, 90%x2';
    const parsed = parsePrescription(raw);
    const formatted = formatPrescription(parsed, 'percentage');
    expect(formatted).toBe('≥85%×3-5×4-6, 90%×2');
    expect(parsePrescription(formatted)).toEqual(parsed);
  });
  it('renders a sets range even when the lower bound is 1', () => {
    const formatted = formatPrescription(parsePrescription('80x5x1-3'), null);
    expect(formatted).toBe('80×5×1-3');
  });
  it('keeps the sets=1 display rule for fixed sets', () => {
    expect(formatPrescription(parsePrescription('80x5'), null)).toBe('80×5');
  });
});

describe('combo prescriptions — signs and set ranges', () => {
  it('parses sign + round-range on a combo', () => {
    const [line] = parseComboPrescription('<=70%x2+1x4-6');
    expect(line).toMatchObject({
      loadCmp: '<=', load: 70, repsText: '2+1', totalReps: 3, sets: 4, setsMax: 6,
    });
  });
  it('round-trips through formatComboPrescription', () => {
    const parsed = parseComboPrescription('≤70%×2+1×4-6');
    const formatted = formatComboPrescription(parsed, 'percentage');
    expect(formatted).toBe('≤70%×2+1×4-6');
    expect(parseComboPrescription(formatted)).toEqual(parsed);
  });
  it('keeps the multiplier grammar intact alongside a sign', () => {
    const [line] = parseComboPrescription('≥80x2(1+2)x3');
    expect(line).toMatchObject({ loadCmp: '>=', multiplier: 2, repsText: '1+2', sets: 3 });
  });
});

describe('computePrescriptionSummary — midpoints and honest averages', () => {
  it('counts ranges at their midpoint', () => {
    const s = computePrescriptionSummary('85x3-5x4-6', 'absolute_kg', false);
    // sets mid 5, reps mid 4 → 20 reps
    expect(s.total_sets).toBe(5);
    expect(s.total_reps).toBe(20);
    expect(s.highest_load).toBe(85);
  });
  it('excludes signed loads from the average entirely', () => {
    const s = computePrescriptionSummary('>=85x3-5x5', 'percentage', false);
    expect(s.total_reps).toBe(20);
    expect(s.highest_load).toBe(85);
    expect(s.avg_load).toBeNull();
  });
  it('averages only over unsigned lines when mixed', () => {
    const s = computePrescriptionSummary('70x5x2, >=90x1x3', 'absolute_kg', false);
    expect(s.total_reps).toBe(13);
    expect(s.avg_load).toBe(70);      // the signed 90s are excluded from both sides
    expect(s.highest_load).toBe(90);  // Hi still sees the anchor
  });
  it('applies midpoints to combo set ranges', () => {
    const s = computePrescriptionSummary('70x2+1x4-6', 'absolute_kg', true);
    expect(s.total_sets).toBe(5);
    expect(s.total_reps).toBe(15);
    expect(s.avg_load).toBe(70);
  });
  it('is unchanged for classic prescriptions', () => {
    const s = computePrescriptionSummary('80x5x3, 85x3', 'absolute_kg', false);
    expect(s).toEqual({ total_sets: 4, total_reps: 18, highest_load: 85, avg_load: (80 * 15 + 85 * 3) / 18 });
  });
});

describe('applyFeatureOverrides', () => {
  const base = { total_sets: 5, total_reps: 20, highest_load: 85, avg_load: null };
  it('overrides total reps, total sets and avg load', () => {
    expect(applyFeatureOverrides(base, { totalReps: 30, totalSets: 8, avgLoad: 64 })).toEqual({
      total_sets: 8, total_reps: 30, highest_load: 85, avg_load: 64,
    });
  });
  it('passes through when no features are set', () => {
    expect(applyFeatureOverrides(base, undefined)).toEqual(base);
    expect(applyFeatureOverrides(base, {})).toEqual(base);
  });
});

describe('time helpers', () => {
  it('formats seconds European-style, mixed values as m′ss″', () => {
    expect(formatSeconds(720)).toBe('12′');
    expect(formatSeconds(90)).toBe('1′30″');
    expect(formatSeconds(135)).toBe('2′15″');
    expect(formatSeconds(45)).toBe('45″');
  });
  it('parses minutes by default, seconds with a trailing s, and m:ss', () => {
    expect(parseTimeInput('12')).toBe(720);
    expect(parseTimeInput('1,5')).toBe(90);
    expect(parseTimeInput('90s')).toBe(90);
    expect(parseTimeInput('2:15')).toBe(135);
    expect(parseTimeInput('abc')).toBeNull();
  });
  it('timeEditValue round-trips through parseTimeInput', () => {
    for (const sec of [45, 60, 90, 135, 720]) {
      expect(parseTimeInput(timeEditValue(sec))).toBe(sec);
    }
  });
});

describe('rangeMid', () => {
  it('returns the value when fixed and the midpoint when ranged', () => {
    expect(rangeMid(5, null)).toBe(5);
    expect(rangeMid(3, 5)).toBe(4);
    expect(rangeMid(4, undefined)).toBe(4);
  });
});
