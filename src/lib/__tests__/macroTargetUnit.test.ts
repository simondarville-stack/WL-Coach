import { describe, it, expect } from 'vitest';
import {
  contributesToTonnage,
  fmtNumber,
  formatTargetLoad,
  inferUnitFromInput,
  isNumericUnit,
  mean,
  numericValues,
  parseTargetNumber,
  peak,
  unitLabel,
  unitOf,
  unitSuffix,
  type MacroTargetUnit,
} from '../macroTargetUnit';
import type { MacroTarget } from '../database.types';

const t = (f: Partial<MacroTarget>): MacroTarget => f as MacroTarget;

describe('unitOf', () => {
  it('treats NULL as kilograms — every row predating the column', () => {
    expect(unitOf(null)).toBe('absolute_kg');
    expect(unitOf(undefined)).toBe('absolute_kg');
    expect(unitOf({ target_unit: null })).toBe('absolute_kg');
  });

  it('reads the declared unit', () => {
    expect(unitOf({ target_unit: 'percentage' })).toBe('percentage');
    expect(unitOf({ target_unit: 'free_text_reps' })).toBe('free_text_reps');
    expect(unitOf({ target_unit: 'absolute_kg' })).toBe('absolute_kg');
  });

  it('falls back to kilograms for anything unrecognised', () => {
    // A value the CHECK constraint should never allow, but the reader must not
    // invent behaviour if one ever appears.
    expect(unitOf({ target_unit: 'rpe' })).toBe('absolute_kg');
    expect(unitOf({ target_unit: '' })).toBe('absolute_kg');
  });
});

describe('unit predicates', () => {
  it('only free text is non-numeric', () => {
    expect(isNumericUnit('absolute_kg')).toBe(true);
    expect(isNumericUnit('percentage')).toBe(true);
    expect(isNumericUnit('free_text_reps')).toBe(false);
  });

  it('only kilograms may be summed across exercises', () => {
    // A percentage is relative to its own exercise; summing percentages across
    // exercises produces a number that means nothing.
    expect(contributesToTonnage('absolute_kg')).toBe(true);
    expect(contributesToTonnage('percentage')).toBe(false);
    expect(contributesToTonnage('free_text_reps')).toBe(false);
  });

  it('labels and suffixes', () => {
    expect(unitLabel('absolute_kg')).toBe('kg');
    expect(unitLabel('percentage')).toBe('%');
    expect(unitLabel('free_text_reps')).toBe('text');
    expect(unitSuffix('absolute_kg')).toBe('');
    expect(unitSuffix('percentage')).toBe('%');
    expect(unitSuffix('free_text_reps')).toBe('');
  });
});

describe('formatTargetLoad', () => {
  it('renders kilograms bare and percentages suffixed', () => {
    expect(formatTargetLoad(t({ target_max: 120 }), 'absolute_kg')).toBe('120');
    expect(formatTargetLoad(t({ target_max: 88 }), 'percentage')).toBe('88%');
  });

  it('uses comma decimals', () => {
    expect(formatTargetLoad(t({ target_max: 117.5 }), 'absolute_kg')).toBe('117,5');
    expect(formatTargetLoad(t({ target_max: 82.5 }), 'percentage')).toBe('82,5%');
  });

  it('coerces the numeric strings PostgREST returns', () => {
    expect(formatTargetLoad(t({ target_max: '120.00' as unknown as number }), 'absolute_kg')).toBe('120');
  });

  it('reads prose for a free-text column, ignoring any stray number', () => {
    expect(formatTargetLoad(t({ target_text: 'Heavy', target_max: 999 }), 'free_text_reps')).toBe('Heavy');
  });

  it('is null for an empty cell', () => {
    expect(formatTargetLoad(null, 'absolute_kg')).toBeNull();
    expect(formatTargetLoad(t({}), 'absolute_kg')).toBeNull();
    expect(formatTargetLoad(t({ target_text: '   ' }), 'free_text_reps')).toBeNull();
    expect(formatTargetLoad(t({ target_max: null }), 'percentage')).toBeNull();
  });
});

describe('numericValues / mean / peak', () => {
  const rows = [
    t({ target_max: 100, target_avg: 80 }),
    t({ target_max: 110, target_avg: null }),
    t({ target_max: null, target_avg: 90 }),
  ];

  it('collects a numeric column, skipping empty cells', () => {
    expect(numericValues(rows, 'absolute_kg', 'target_max')).toEqual([100, 110]);
    expect(numericValues(rows, 'absolute_kg', 'target_avg')).toEqual([80, 90]);
  });

  it('works the same for a percentage column — the unit is constant within it', () => {
    expect(numericValues(rows, 'percentage', 'target_max')).toEqual([100, 110]);
  });

  it('yields nothing for a free-text column, so its aggregates stay blank', () => {
    expect(numericValues(rows, 'free_text_reps', 'target_max')).toEqual([]);
    expect(mean(numericValues(rows, 'free_text_reps', 'target_max'))).toBeNull();
    expect(peak(numericValues(rows, 'free_text_reps', 'target_max'))).toBeNull();
  });

  it('averages and peaks', () => {
    expect(mean([100, 110])).toBe(105);
    expect(peak([100, 110])).toBe(110);
    expect(mean([])).toBeNull();
    expect(peak([])).toBeNull();
  });
});

describe('inferUnitFromInput', () => {
  it('a percent sign means percentages', () => {
    expect(inferUnitFromInput('88%')).toBe('percentage');
    expect(inferUnitFromInput('82,5 %')).toBe('percentage');
  });

  it('a plain number means kilograms', () => {
    expect(inferUnitFromInput('120')).toBe('absolute_kg');
    expect(inferUnitFromInput('117,5')).toBe('absolute_kg');
  });

  it('letters mean free text — including Danish ones', () => {
    expect(inferUnitFromInput('Heavy')).toBe('free_text_reps');
    expect(inferUnitFromInput('Max out')).toBe('free_text_reps');
    expect(inferUnitFromInput('Tungt løft')).toBe('free_text_reps');
  });

  it('ignores the set separators, so 80x3 is still kilograms', () => {
    expect(inferUnitFromInput('80x3')).toBe('absolute_kg');
    expect(inferUnitFromInput('80×3')).toBe('absolute_kg');
  });

  it('implies nothing for an empty cell, so the column keeps its unit', () => {
    expect(inferUnitFromInput('')).toBeNull();
    expect(inferUnitFromInput('   ')).toBeNull();
  });
});

describe('parseTargetNumber', () => {
  it('accepts comma decimals and strips the percent sign', () => {
    expect(parseTargetNumber('120')).toBe(120);
    expect(parseTargetNumber('117,5')).toBe(117.5);
    expect(parseTargetNumber('88%')).toBe(88);
    expect(parseTargetNumber(' 82,5 % ')).toBe(82.5);
  });

  it('is null when there is no number', () => {
    expect(parseTargetNumber('')).toBeNull();
    expect(parseTargetNumber('Heavy')).toBeNull();
    expect(parseTargetNumber('%')).toBeNull();
  });
});

describe('round trip: what a coach types is what the column becomes', () => {
  const cases: Array<[string, MacroTargetUnit, string | null]> = [
    ['120',   'absolute_kg',    '120'],
    ['117,5', 'absolute_kg',    '117,5'],
    ['88%',   'percentage',     '88%'],
    ['Heavy', 'free_text_reps', 'Heavy'],
  ];

  it.each(cases)('typing %s gives a %s column reading %s', (input, expectedUnit, expectedRender) => {
    const unit = inferUnitFromInput(input)!;
    expect(unit).toBe(expectedUnit);
    const cell = unit === 'free_text_reps'
      ? t({ target_text: input.trim() })
      : t({ target_max: parseTargetNumber(input) });
    expect(formatTargetLoad(cell, unit)).toBe(expectedRender);
  });
});

describe('fmtNumber', () => {
  it('keeps integers bare and rounds decimals to one place', () => {
    expect(fmtNumber(120)).toBe('120');
    expect(fmtNumber(117.5)).toBe('117,5');
    expect(fmtNumber(117.46)).toBe('117,5');
  });
});
