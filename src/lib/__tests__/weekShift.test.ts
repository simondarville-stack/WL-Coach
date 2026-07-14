import { describe, it, expect } from 'vitest';
import { orderWeeksForShift } from '../weekUtils';
import { addDaysToISO } from '../dateUtils';

// Regression for the "duplicate key value violates unique_macrocycle_week"
// error when shifting a macro's start date: shifting every week_start by the
// same delta must never transiently collide with an un-shifted week's slot.

/**
 * Simulate applying the shift ONE ROW AT A TIME in the given order, mirroring
 * the DB where (macrocycle_id, week_start) is unique. Returns false if any
 * single update lands on a slot still occupied by another row.
 */
function shiftCollides(starts: string[], shiftDays: number, weeks: { week_start: string }[]): boolean {
  const occupied = new Set(starts);
  for (const w of weeks) {
    const target = addDaysToISO(w.week_start, shiftDays);
    occupied.delete(w.week_start);        // this row vacates its old slot
    if (occupied.has(target)) return true; // target still held by another row → violation
    occupied.add(target);
  }
  return false;
}

const consecutiveMondays = (n: number, from = '2026-01-05'): string[] =>
  Array.from({ length: n }, (_, i) => addDaysToISO(from, i * 7));

describe('orderWeeksForShift — no unique_macrocycle_week collision', () => {
  const cases: Array<[string, number]> = [
    ['forward one week', 7],
    ['forward two weeks', 14],
    ['forward four weeks', 28],
    ['backward one week', -7],
    ['backward three weeks', -21],
  ];

  for (const [label, shiftDays] of cases) {
    it(`ordered shift never collides — ${label}`, () => {
      const starts = consecutiveMondays(12);
      const weeks = starts.map(week_start => ({ week_start }));
      const ordered = orderWeeksForShift(weeks, shiftDays);
      expect(shiftCollides(starts, shiftDays, ordered)).toBe(false);
    });
  }

  it('the NAIVE (unordered) order DOES collide on a forward shift — proving the fix matters', () => {
    const starts = consecutiveMondays(12);
    const weeks = starts.map(week_start => ({ week_start })); // ascending input order
    // Forward shift applied ascending: week 1 → week 2's occupied slot → collide.
    expect(shiftCollides(starts, 7, weeks)).toBe(true);
  });

  it('single-week cycle shifts without issue', () => {
    const starts = consecutiveMondays(1);
    const weeks = starts.map(week_start => ({ week_start }));
    expect(shiftCollides(starts, 7, orderWeeksForShift(weeks, 7))).toBe(false);
  });
});
