import { describe, it, expect } from 'vitest';
import {
  computeExerciseFill,
  computeGeneralFill,
  mirroredAvg,
  roundToStep,
  stampAllowed,
  type FillWeek,
} from '../macroFillGuide';
import type { RhythmPreset, WeekTypeConfig } from '../database.types';
import { DEFAULT_RHYTHM_PRESETS } from '../constants';

const WEEK_TYPES: WeekTypeConfig[] = [
  { name: 'High', abbreviation: 'h', color: '#E24B4A' },
  { name: 'Medium', abbreviation: 'm', color: '#EF9F27' },
  { name: 'Low', abbreviation: 'g', color: '#1D9E75' },
];

/** 12 weeks in the mockup's default rhythm: m h h g repeating. */
function twelveWeeks(existing: number[] = []): FillWeek[] {
  const types = ['m', 'h', 'h', 'g', 'm', 'h', 'h', 'g', 'm', 'h', 'h', 'g'];
  return types.map((weekType, i) => ({
    weekNumber: i + 1,
    weekType,
    hasExisting: existing.includes(i + 1),
  }));
}

const FLAT: RhythmPreset = { id: 'flat', name: 'Flat', mode: 'pattern', pattern: [{ load: 100, reps: 100 }], stampTypes: null };

const WEEKTYPE_WAVE: RhythmPreset = {
  id: 'wt', name: 'Week-type wave', mode: 'weektype',
  mult: { h: { load: 100, reps: 100 }, m: { load: 95, reps: 100 }, g: { load: 88, reps: 105 } },
};

const STEP_31: RhythmPreset = {
  id: 's31', name: '3:1', mode: 'pattern',
  pattern: [{ load: 94, reps: 105 }, { load: 98, reps: 100 }, { load: 102, reps: 92 }, { load: 86, reps: 70 }],
  stampTypes: ['m', 'h', 'h', 'g'],
};

describe('roundToStep', () => {
  it('rounds loads to 2,5 kg', () => {
    expect(roundToStep(121.3, 2.5)).toBe(122.5);
    expect(roundToStep(121.2, 2.5)).toBe(120);  // below the 121,25 midpoint → down
    expect(roundToStep(100, 2.5)).toBe(100);
  });

  it('returns the value unchanged for non-positive steps', () => {
    expect(roundToStep(101.3, 0)).toBe(101.3);
  });
});

describe('computeExerciseFill — trend and rhythm', () => {
  it('interpolates linearly between anchors with a flat rhythm', () => {
    const { cells } = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 11, toValue: 150 },
      unit: 'kg',
    });
    expect(cells.get(1)!.max).toBe(100);
    expect(cells.get(6)!.max).toBe(125);   // halfway
    expect(cells.get(11)!.max).toBe(150);
    expect(cells.has(12)).toBe(false);     // outside the anchor range
    expect(cells.size).toBe(11);
  });

  it('modulates the trend by week type (unknown types are neutral 100/100)', () => {
    const weeks: FillWeek[] = [
      { weekNumber: 1, weekType: 'h' },
      { weekNumber: 2, weekType: 'g' },
      { weekNumber: 3, weekType: 'custom-xyz' },  // not in mult — sandbox case
    ];
    const { cells } = computeExerciseFill(weeks, WEEKTYPE_WAVE, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 3, toValue: 100 },  // flat trend at 100
      unit: 'kg',
    });
    expect(cells.get(1)!.max).toBe(100);   // h = 100 %
    expect(cells.get(2)!.max).toBe(87.5);  // g = 88 % → 88 rounds to 87,5
    expect(cells.get(3)!.max).toBe(100);   // unknown type → neutral
  });

  it('repeats a pattern from the first in-range week', () => {
    const { cells } = computeExerciseFill(twelveWeeks(), STEP_31, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 9, toValue: 100 },  // flat 100 so multipliers read directly
      unit: 'kg',
      loadRoundingKg: 1,
    });
    expect(cells.get(1)!.max).toBe(94);
    expect(cells.get(4)!.max).toBe(86);
    expect(cells.get(5)!.max).toBe(94);    // pattern wraps
    expect(cells.get(9)!.max).toBe(94);
  });

  it('supports reversed anchors (fromWeek > toWeek)', () => {
    const { cells } = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 11, fromValue: 150, toWeek: 1, toValue: 100 },
      unit: 'kg',
    });
    expect(cells.get(1)!.max).toBe(100);
    expect(cells.get(11)!.max).toBe(150);
  });

  it('returns empty for degenerate anchors (same week)', () => {
    const res = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 5, fromValue: 100, toWeek: 5, toValue: 150 },
      unit: 'kg',
    });
    expect(res.cells.size).toBe(0);
    expect(res.stamps.size).toBe(0);
  });
});

describe('computeExerciseFill — % of reference', () => {
  it('anchors as % of the reference resolve to kg', () => {
    const { cells } = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 80, toWeek: 11, toValue: 100 },
      unit: 'pct',
      referenceKg: 150,
    });
    expect(cells.get(1)!.max).toBe(120);   // 80 % of 150
    expect(cells.get(11)!.max).toBe(150);  // 100 % of 150
  });

  it('returns empty when pct mode lacks a usable reference', () => {
    const res = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 80, toWeek: 11, toValue: 100 },
      unit: 'pct',
      referenceKg: null,
    });
    expect(res.cells.size).toBe(0);
  });
});

describe('computeExerciseFill — avg mirror and reps', () => {
  it('mirrors avg at the given % below max, load-rounded', () => {
    const { cells } = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 11, toValue: 150 },
      unit: 'kg',
      mirrorPct: 20,
    });
    expect(cells.get(1)!.avg).toBe(80);       // 100 × 0.8
    expect(cells.get(11)!.avg).toBe(120);     // 150 × 0.8
    expect(cells.get(6)!.avg).toBe(100);      // 125 × 0.8
  });

  it('omits avg when mirrorPct is null and reps when repsAnchors is null', () => {
    const { cells } = computeExerciseFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 11, toValue: 150 },
      unit: 'kg',
      mirrorPct: null,
      repsAnchors: null,
    });
    expect(cells.get(1)!.avg).toBeUndefined();
    expect(cells.get(1)!.reps).toBeUndefined();
  });

  it('fills reps on their own trend, modulated by the rhythm reps %', () => {
    const undulate = DEFAULT_RHYTHM_PRESETS.find(r => r.id === 'undulating')!;
    const { cells } = computeExerciseFill(twelveWeeks(), undulate, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 11, toValue: 100 },
      unit: 'kg',
      repsAnchors: { fromValue: 30, toValue: 10 },
    });
    // step 1: reps 95 % of 30 = 28.5 → 29 (integer rounding)
    expect(cells.get(1)!.reps).toBe(29);
    // step 2: trend 28, reps 118 % → 33 — volume rises where intensity dips
    expect(cells.get(2)!.reps).toBe(33);
    expect(cells.get(2)!.max).toBeLessThan(cells.get(1)!.max);
  });
});

describe('computeExerciseFill — existing values and overwrite', () => {
  it('skips weeks with existing values by default, fills them with overwrite', () => {
    const weeks = twelveWeeks([4, 8]);
    const base = {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 11, toValue: 150 },
      unit: 'kg' as const,
    };
    const kept = computeExerciseFill(weeks, FLAT, WEEK_TYPES, base);
    expect(kept.cells.has(4)).toBe(false);
    expect(kept.cells.has(8)).toBe(false);
    expect(kept.cells.size).toBe(9);

    const overwritten = computeExerciseFill(weeks, FLAT, WEEK_TYPES, { ...base, overwrite: true });
    expect(overwritten.cells.has(4)).toBe(true);
    expect(overwritten.cells.size).toBe(11);
  });
});

describe('stamping', () => {
  it('stamps pattern week types when requested and all types exist', () => {
    const { stamps } = computeExerciseFill(twelveWeeks(), STEP_31, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 8, toValue: 100 },
      unit: 'kg',
      stamp: true,
    });
    expect(stamps.get(1)).toBe('m');
    expect(stamps.get(2)).toBe('h');
    expect(stamps.get(4)).toBe('g');
    expect(stamps.get(5)).toBe('m');   // wraps with the pattern
  });

  it('stamps even on weeks whose values are kept (rhythm applies to the week, not the cell)', () => {
    const { stamps, cells } = computeExerciseFill(twelveWeeks([2]), STEP_31, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 4, toValue: 100 },
      unit: 'kg',
      stamp: true,
    });
    expect(cells.has(2)).toBe(false);
    expect(stamps.get(2)).toBe('h');
  });

  it('never stamps when a referenced week type is missing from the coach config', () => {
    const missingLow = WEEK_TYPES.filter(t => t.abbreviation !== 'g');
    expect(stampAllowed(STEP_31, missingLow)).toBe(false);
    const { stamps } = computeExerciseFill(twelveWeeks(), STEP_31, missingLow, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 8, toValue: 100 },
      unit: 'kg',
      stamp: true,
    });
    expect(stamps.size).toBe(0);
  });

  it('weektype presets and stamp-free patterns cannot stamp', () => {
    expect(stampAllowed(WEEKTYPE_WAVE, WEEK_TYPES)).toBe(false);
    expect(stampAllowed(FLAT, WEEK_TYPES)).toBe(false);
  });

  it('null entries in stampTypes leave those weeks alone', () => {
    const partial: RhythmPreset = {
      id: 'p', name: 'p', mode: 'pattern',
      pattern: [{ load: 100, reps: 100 }, { load: 90, reps: 100 }],
      stampTypes: ['h', null],
    };
    const { stamps } = computeExerciseFill(twelveWeeks(), partial, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 100, toWeek: 4, toValue: 100 },
      unit: 'kg',
      stamp: true,
    });
    expect(stamps.get(1)).toBe('h');
    expect(stamps.has(2)).toBe(false);
    expect(stamps.get(3)).toBe('h');
  });
});

describe('computeGeneralFill', () => {
  it('fills a week-level metric on the reps multiplier, rounded to 5', () => {
    const { values } = computeGeneralFill(twelveWeeks(), WEEKTYPE_WAVE, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 400, toWeek: 11, toValue: 200 },
    });
    expect(values.get(1)).toBe(400);   // m: reps 100 %
    expect(values.get(4)).toBe(355);   // trend 340, g: 105 % → 357 → rounds to 355
    expect(values.get(11)).toBe(200);  // h: reps 100 %
  });

  it('never returns negative values', () => {
    const { values } = computeGeneralFill(twelveWeeks(), FLAT, WEEK_TYPES, {
      anchors: { fromWeek: 1, fromValue: 10, toWeek: 11, toValue: -50 },
    });
    expect(Math.min(...values.values())).toBe(0);
  });
});

describe('mirroredAvg', () => {
  it('computes the mirrored avg with load rounding', () => {
    expect(mirroredAvg(142.5, 20)).toBe(115);       // 114 → rounds to 115
    expect(mirroredAvg(100, 20)).toBe(80);
    expect(mirroredAvg(0, 20)).toBe(0);
  });
});

describe('DEFAULT_RHYTHM_PRESETS integrity', () => {
  it('every default preset is well-formed for the engine', () => {
    for (const preset of DEFAULT_RHYTHM_PRESETS) {
      const res = computeExerciseFill(twelveWeeks(), preset, WEEK_TYPES, {
        anchors: { fromWeek: 1, fromValue: 100, toWeek: 11, toValue: 140 },
        unit: 'kg',
        repsAnchors: { fromValue: 28, toValue: 12 },
        mirrorPct: 20,
        stamp: true,
      });
      expect(res.cells.size).toBe(11);
      for (const cell of res.cells.values()) {
        expect(cell.max).toBeGreaterThan(0);
        expect(cell.avg).toBeLessThan(cell.max);
        expect(Number.isInteger(cell.reps)).toBe(true);
      }
    }
  });

  it('the default step preset can stamp against the default week types', () => {
    const step = DEFAULT_RHYTHM_PRESETS.find(r => r.id === 'step-3-1')!;
    expect(stampAllowed(step, WEEK_TYPES)).toBe(true);
  });
});
