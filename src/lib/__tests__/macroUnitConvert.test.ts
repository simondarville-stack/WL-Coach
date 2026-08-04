import { describe, it, expect } from 'vitest';
import {
  buildConversionRows,
  convertValue,
  describeColumn,
  unitAfter,
  unitBefore,
} from '../macroUnitConvert';
import type { MacroTarget } from '../database.types';

const t = (f: Partial<MacroTarget>): MacroTarget => ({
  macro_week_id: 'w1',
  tracked_exercise_id: 'A',
  ...f,
} as MacroTarget);

describe('unitBefore / unitAfter', () => {
  it('names both ends of each direction', () => {
    expect(unitBefore('percent-to-kg')).toBe('percentage');
    expect(unitAfter('percent-to-kg')).toBe('absolute_kg');
    expect(unitBefore('kg-to-percent')).toBe('absolute_kg');
    expect(unitAfter('kg-to-percent')).toBe('percentage');
  });
});

describe('convertValue', () => {
  it('percent to kg, rounded to the coach\'s step', () => {
    expect(convertValue(85, 'percent-to-kg', 120, 2.5)).toBe(102.5);
    expect(convertValue(100, 'percent-to-kg', 120, 2.5)).toBe(120);
  });

  it('percent to kg unrounded when rounding is off', () => {
    expect(convertValue(85, 'percent-to-kg', 120, null)).toBe(102);
    expect(convertValue(83, 'percent-to-kg', 121, null)).toBeCloseTo(100.43, 2);
  });

  it('kg to percent, one decimal — a 2,5 step would flatten the shape', () => {
    expect(convertValue(102, 'kg-to-percent', 120, 2.5)).toBe(85);
    expect(convertValue(101, 'kg-to-percent', 120, 2.5)).toBe(84.2);
  });

  it('round trips within the rounding step', () => {
    const pct = convertValue(102.5, 'kg-to-percent', 120, null)!;
    expect(convertValue(pct, 'percent-to-kg', 120, 2.5)).toBe(102.5);
  });

  it('coerces the numeric strings PostgREST returns', () => {
    expect(convertValue('85' as unknown as number, 'percent-to-kg', 120, 2.5)).toBe(102.5);
  });

  it('is null without a value or a usable reference', () => {
    expect(convertValue(null, 'percent-to-kg', 120, 2.5)).toBeNull();
    expect(convertValue(85, 'percent-to-kg', 0, 2.5)).toBeNull();
    expect(convertValue(85, 'percent-to-kg', -10, 2.5)).toBeNull();
  });
});

describe('buildConversionRows', () => {
  const targets = [
    t({ macro_week_id: 'w1', target_max: 85, target_avg: 75, target_reps: 30, note: 'keep' }),
    t({ macro_week_id: 'w2', target_max: 90, target_avg: null }),
    t({ macro_week_id: 'w3', target_max: null, target_avg: null, target_reps: 20 }),
    t({ macro_week_id: 'w1', tracked_exercise_id: 'B', target_max: 50 }),
  ];

  it('converts both loads of every filled cell of ONE column', () => {
    const rows = buildConversionRows('A', targets, 'percent-to-kg', 120, 2.5);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      macro_week_id: 'w1',
      tracked_exercise_id: 'A',
      fields: { target_max: 102.5, target_avg: 90 },
    });
    expect(rows[1].fields).toEqual({ target_max: 107.5 });
  });

  it('never touches reps, sets or notes — they are level-independent', () => {
    const rows = buildConversionRows('A', targets, 'percent-to-kg', 120, 2.5);
    for (const r of rows) {
      expect(r.fields).not.toHaveProperty('target_reps');
      expect(r.fields).not.toHaveProperty('note');
      expect(r.fields).not.toHaveProperty('target_sets_at_max');
    }
  });

  it('skips empty cells rather than minting null rows across a sparse cycle', () => {
    const rows = buildConversionRows('A', targets, 'percent-to-kg', 120, 2.5);
    expect(rows.map(r => r.macro_week_id)).toEqual(['w1', 'w2']);
  });

  it('leaves other columns alone', () => {
    const rows = buildConversionRows('A', targets, 'percent-to-kg', 120, 2.5);
    expect(rows.every(r => r.tracked_exercise_id === 'A')).toBe(true);
  });

  it('emits nothing when the reference is unusable, so no load is destroyed', () => {
    // Every converted value would be null; writing them would wipe the column.
    expect(buildConversionRows('A', targets, 'percent-to-kg', 0, 2.5)).toEqual([]);
  });
});

describe('describeColumn', () => {
  const targets = [
    t({ macro_week_id: 'w1', target_max: 85 }),
    t({ macro_week_id: 'w2', target_max: 92.5 }),
    t({ macro_week_id: 'w3', target_max: null }),
  ];

  it('reads as a range with the column unit and a week count', () => {
    expect(describeColumn('A', targets, 'percentage')).toBe('85–92,5% · 2 wk');
    expect(describeColumn('A', targets, 'absolute_kg')).toBe('85–92,5 kg · 2 wk');
  });

  it('collapses a flat column to one value', () => {
    expect(describeColumn('A', [t({ target_max: 85 })], 'percentage')).toBe('85% · 1 wk');
  });

  it('says so when there is nothing to convert', () => {
    expect(describeColumn('Z', targets, 'percentage')).toBe('no loads');
  });
});
