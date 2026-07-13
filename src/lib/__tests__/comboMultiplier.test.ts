import { describe, it, expect } from 'vitest';
import {
  parseComboPrescription,
  formatComboPrescription,
  computePrescriptionSummary,
} from '../prescriptionParser';
import { expandForCounting } from '../comboExpansion';

// Item #2 — combo round-grouping multiplier "m(a+b)" under Option A:
// m scales REPS/volume, NOT the set count. m absent = perfect no-op.

describe('parseComboPrescription — round multiplier', () => {
  it('strips m(...) into multiplier, leaving the bare tuple', () => {
    const [line] = parseComboPrescription('80×2(1+1)×3');
    expect(line.multiplier).toBe(2);
    expect(line.repsText).toBe('1+1');      // BARE tuple, no parens
    expect(line.totalReps).toBe(2);         // one round
    expect(line.sets).toBe(3);
    expect(line.load).toBe(80);
  });

  it('leaves ungrouped combos untouched (backward compat)', () => {
    const [line] = parseComboPrescription('80×2+1×3');
    expect(line.multiplier).toBeUndefined();
    expect(line.repsText).toBe('2+1');
    expect(line.totalReps).toBe(3);
    expect(line.sets).toBe(3);
  });

  it('round-trips m(a+b) through format (incl. m=1 which must persist)', () => {
    for (const raw of ['80×2(1+1)×3', '80×1(1+1)', '70-80×3(1+1+1)×2']) {
      const parsed = parseComboPrescription(raw);
      const formatted = formatComboPrescription(parsed, 'absolute_kg');
      // Re-parse and compare structurally (normalises × spacing etc.)
      expect(parseComboPrescription(formatted)).toEqual(parsed);
    }
  });

  it('m=1 grouped stays grouped (does not collapse to ungrouped)', () => {
    const [line] = parseComboPrescription('80×1(1+1)');
    expect(line.multiplier).toBe(1);
    expect(formatComboPrescription([line], 'absolute_kg')).toContain('1(1+1)');
  });
});

describe('computePrescriptionSummary — Option A (reps ×m, sets unchanged)', () => {
  it('multiplies reps by m but not the set count', () => {
    const s = computePrescriptionSummary('80×2(1+1)×3', 'absolute_kg', true);
    expect(s.total_sets).toBe(3);           // NOT 6
    expect(s.total_reps).toBe(12);          // 3 sets × 2 rounds × (1+1)
    expect(s.highest_load).toBe(80);
    expect(s.avg_load).toBe(80);
  });

  it('is identical to the equivalent-volume ungrouped combo for reps', () => {
    const grouped = computePrescriptionSummary('80×2(1+1)×3', 'absolute_kg', true);
    const flat = computePrescriptionSummary('80×1+1×3', 'absolute_kg', true);
    // flat: 3 sets × (1+1) = 6 reps; grouped doubles the volume via m=2 → 12.
    expect(flat.total_reps).toBe(6);
    expect(grouped.total_reps).toBe(2 * flat.total_reps);
    expect(grouped.total_sets).toBe(flat.total_sets); // set count unchanged
  });
});

describe('expandForCounting — per-member reps scale by m, rounds do not', () => {
  const mkEx = (id: string) => ({ id, counts_towards_totals: true });
  const row = {
    exercise_id: 'A',
    exercise: mkEx('A'),
    unit: 'absolute_kg' as const,
    is_combo: true,
    prescription_raw: '80×2(1+1)×3',
    summary_total_sets: null,
    summary_total_reps: null,
    summary_highest_load: null,
    summary_avg_load: null,
  };
  const members = [
    { exerciseId: 'A', exercise: mkEx('A'), position: 1 },
    { exerciseId: 'B', exercise: mkEx('B'), position: 2 },
  ];

  it('gives each member part×sets×m reps and attributes sets once', () => {
    const out = expandForCounting(row, members);
    const a = out.find(c => c.exercise_id === 'A')!;
    const b = out.find(c => c.exercise_id === 'B')!;
    expect(a.summary_total_reps).toBe(6);   // 1 × 3 sets × 2 rounds
    expect(b.summary_total_reps).toBe(6);
    // "A set is a set": rounds = Σ sets = 3, attributed to one member only.
    expect(a.summary_total_sets + b.summary_total_sets).toBe(3);
  });
});
