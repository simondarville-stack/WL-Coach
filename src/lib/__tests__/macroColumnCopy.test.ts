import { describe, it, expect } from 'vitest';
import { buildColumnCopyRows, countFilledWeeks, isFilled } from '../macroColumnCopy';
import type { MacroTarget, MacroWeek } from '../database.types';

const week = (id: string, n: number): MacroWeek => ({
  id,
  macrocycle_id: 'm1',
  week_number: n,
  week_start: '2026-01-05',
  week_type: 'h',
  week_type_text: null,
  notes: null,
  total_reps_target: null,
  tonnage_target: null,
  avg_intensity_target: null,
} as unknown as MacroWeek);

const target = (weekId: string, teId: string, f: Partial<MacroTarget> = {}): MacroTarget => ({
  id: `${weekId}-${teId}`,
  macro_week_id: weekId,
  tracked_exercise_id: teId,
  target_max: null,
  target_avg: null,
  target_reps: null,
  target_reps_at_max: null,
  target_sets_at_max: null,
  note: null,
  ...f,
} as unknown as MacroTarget);

const WEEKS = [week('w1', 1), week('w2', 2), week('w3', 3)];

describe('buildColumnCopyRows', () => {
  it('mirrors every field of the source onto the destination', () => {
    const targets = [
      target('w1', 'A', { target_max: 120, target_avg: 100, target_reps: 30, target_reps_at_max: 2, target_sets_at_max: 3, note: 'go 3RM' }),
    ];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      macro_week_id: 'w1',
      tracked_exercise_id: 'B',
      fields: {
        target_max: 120, target_text: null, target_avg: 100, target_reps: 30,
        target_reps_at_max: 2, target_sets_at_max: 3, note: 'go 3RM',
      },
    });
  });

  it('mirrors a free-text load, and clears it when the source has none', () => {
    const withText = buildColumnCopyRows('A', 'B', WEEKS, [
      target('w1', 'A', { target_text: 'Heavy singles' }),
    ]);
    expect(withText[0].fields.target_text).toBe('Heavy singles');
    // Mirroring means the destination's prose goes when the source has none —
    // otherwise a stale word survives a copy that replaced everything else.
    const withoutText = buildColumnCopyRows('A', 'B', WEEKS, [
      target('w1', 'A', { target_max: 120 }),
      target('w1', 'B', { target_text: 'stale' }),
    ]);
    expect(withoutText[0].fields.target_text).toBeNull();
  });

  it('mirrors rather than merges — an empty source week clears the destination', () => {
    const targets = [
      target('w1', 'A', { target_max: 120 }),
      target('w2', 'B', { target_max: 90, note: 'stale' }), // source has nothing here
    ];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets);
    const w2 = rows.find(r => r.macro_week_id === 'w2');
    expect(w2).toBeDefined();
    expect(w2!.fields.target_max).toBeNull();
    expect(w2!.fields.note).toBeNull();
  });

  it('skips weeks where source and destination are both empty', () => {
    const targets = [target('w1', 'A', { target_max: 120 })];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets);
    expect(rows.map(r => r.macro_week_id)).toEqual(['w1']);
  });

  it('emits a uniform field set so the write collapses to one request', () => {
    const targets = [
      target('w1', 'A', { target_max: 120 }),
      target('w2', 'A', { target_reps: 40 }),
    ];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets);
    const signatures = new Set(rows.map(r => Object.keys(r.fields).sort().join(',')));
    expect(signatures.size).toBe(1);
  });

  it('rescales loads by the reference ratio, leaving reps and notes absolute', () => {
    const targets = [
      target('w1', 'A', { target_max: 120, target_avg: 100, target_reps: 30, target_reps_at_max: 2, note: 'keep' }),
    ];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets, {
      rescale: { fromRef: 150, toRef: 200 },
    });
    // 120/150*200 = 160 ; 100/150*200 = 133,33 → 132,5 at the 2,5 kg step
    expect(rows[0].fields.target_max).toBe(160);
    expect(rows[0].fields.target_avg).toBe(132.5);
    expect(rows[0].fields.target_reps).toBe(30);
    expect(rows[0].fields.target_reps_at_max).toBe(2);
    expect(rows[0].fields.note).toBe('keep');
  });

  it('copies raw when a reference is missing or zero', () => {
    const targets = [target('w1', 'A', { target_max: 120 })];
    for (const rescale of [null, { fromRef: 0, toRef: 200 }, { fromRef: 150, toRef: 0 }]) {
      const rows = buildColumnCopyRows('A', 'B', WEEKS, targets, { rescale });
      expect(rows[0].fields.target_max).toBe(120);
    }
  });

  it('honours the custom rounding step', () => {
    const targets = [target('w1', 'A', { target_max: 120 })];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets, {
      rescale: { fromRef: 150, toRef: 175, roundingKg: 1 },
    });
    expect(rows[0].fields.target_max).toBe(140); // 120/150*175 = 140
  });

  it('can leave the note behind', () => {
    const targets = [target('w1', 'A', { target_max: 120, note: 'exercise-specific' })];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets, { includeNote: false });
    expect('note' in rows[0].fields).toBe(false);
  });

  it('refuses to copy a column onto itself', () => {
    const targets = [target('w1', 'A', { target_max: 120 })];
    expect(buildColumnCopyRows('A', 'A', WEEKS, targets)).toEqual([]);
  });

  it('coerces the numeric strings PostgREST returns', () => {
    const targets = [target('w1', 'A', { target_max: '120' as unknown as number })];
    const rows = buildColumnCopyRows('A', 'B', WEEKS, targets, { rescale: { fromRef: 120, toRef: 60 } });
    expect(rows[0].fields.target_max).toBe(60);
  });
});

describe('isFilled / countFilledWeeks', () => {
  it('an all-null row is not filled', () => {
    expect(isFilled(target('w1', 'A'))).toBe(false);
    expect(isFilled(undefined)).toBe(false);
  });

  it('a whitespace-only note is not filled', () => {
    expect(isFilled(target('w1', 'A', { note: '   ' }))).toBe(false);
    expect(isFilled(target('w1', 'A', { note: 'x' }))).toBe(true);
  });

  it('counts only the destination column', () => {
    const targets = [
      target('w1', 'A', { target_max: 100 }),
      target('w1', 'B', { target_max: 90 }),
      target('w2', 'B', {}),
      target('w3', 'B', { target_reps: 20 }),
    ];
    expect(countFilledWeeks('B', targets)).toBe(2);
  });
});
