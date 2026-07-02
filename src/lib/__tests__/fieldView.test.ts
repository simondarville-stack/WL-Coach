import { describe, it, expect } from 'vitest';
import {
  resolveNextSession,
  summarizeSession,
  DEFAULT_FIELD_BOLD_PCT,
  type FieldSummaryOptions,
} from '../fieldView';
import type { WeekDayOverview, WeekOverview, PlannedExerciseFull } from '../trainingLogService';
import type { Exercise, PlannedExercise } from '../database.types';

// ─── helpers ────────────────────────────────────────────────────────────────

function day(partial: Partial<WeekDayOverview> & { dayIndex: number }): WeekDayOverview {
  return {
    label: `Day ${partial.dayIndex}`,
    weekday: null,
    plannedCount: 3,
    status: 'pending',
    sessionDate: null,
    skippedReason: null,
    hasLog: false,
    isBonus: false,
    ...partial,
  };
}

function overview(days: WeekDayOverview[]): WeekOverview {
  return {
    weekStart: '2026-06-29',
    weekPlanId: 'wp1',
    activeDays: days.map(d => d.dayIndex),
    dayLabels: {},
    days,
    planSource: 'individual',
    weekBrief: null,
  };
}

function exercise(partial: Partial<Exercise>): Exercise {
  return {
    id: 'ex1',
    name: 'Snatch',
    exercise_code: 'SN',
    pr_reference_exercise_id: null,
    ...partial,
  } as Exercise;
}

function planned(partial: {
  raw: string | null;
  unit: string | null;
  isCombo?: boolean;
  def?: Partial<Exercise>;
}): PlannedExerciseFull {
  const def = exercise(partial.def ?? {});
  return {
    exercise: {
      id: `pe-${def.id}`,
      exercise_id: def.id,
      prescription_raw: partial.raw,
      unit: partial.unit,
      is_combo: partial.isCombo ?? false,
    } as PlannedExercise,
    exerciseDef: def,
    setLines: [],
    comboMembers: [],
  };
}

const baseOpts: FieldSummaryOptions = {
  boldPct: DEFAULT_FIELD_BOLD_PCT,
  roundEnabled: false,
  roundIncrement: 2.5,
  oneRmFor: () => null,
};

// ─── resolveNextSession ─────────────────────────────────────────────────────

describe('resolveNextSession', () => {
  const MON = 0, TUE = 1, WED = 2, FRI = 4;

  it('returns no_plan for a null overview or a week without planned slots', () => {
    expect(resolveNextSession(null, WED).kind).toBe('no_plan');
    expect(resolveNextSession(overview([day({ dayIndex: 0, plannedCount: 0 })]), WED).kind)
      .toBe('no_plan');
  });

  it('returns week_complete when every planned slot is completed or skipped', () => {
    const o = overview([
      day({ dayIndex: 0, status: 'completed' }),
      day({ dayIndex: 1, status: 'skipped' }),
    ]);
    expect(resolveNextSession(o, WED).kind).toBe('week_complete');
  });

  it('prefers a slot assigned to today over everything else', () => {
    const o = overview([
      day({ dayIndex: 0 }),
      day({ dayIndex: 1, weekday: WED }),
      day({ dayIndex: 2, weekday: FRI }),
    ]);
    const r = resolveNextSession(o, WED);
    expect(r.kind).toBe('today');
    expect(r.day?.dayIndex).toBe(1);
  });

  it('resolves unassigned slots to the first open unit in order', () => {
    const o = overview([
      day({ dayIndex: 0, status: 'completed' }),
      day({ dayIndex: 1 }),
      day({ dayIndex: 2 }),
    ]);
    const r = resolveNextSession(o, WED);
    expect(r.kind).toBe('next_up');
    expect(r.day?.dayIndex).toBe(1);
  });

  it('prefers an unassigned open unit over a strictly-future assigned day', () => {
    const o = overview([
      day({ dayIndex: 0, weekday: FRI }),
      day({ dayIndex: 1 }),
    ]);
    const r = resolveNextSession(o, TUE);
    expect(r.kind).toBe('next_up');
    expect(r.day?.dayIndex).toBe(1);
  });

  it('falls back to the earliest upcoming assigned day', () => {
    const o = overview([
      day({ dayIndex: 0, weekday: FRI }),
      day({ dayIndex: 1, weekday: WED }),
    ]);
    const r = resolveNextSession(o, TUE);
    expect(r.kind).toBe('scheduled');
    expect(r.day?.weekday).toBe(WED);
  });

  it('marks a never-logged past assigned day as overdue', () => {
    const o = overview([day({ dayIndex: 0, weekday: MON })]);
    const r = resolveNextSession(o, WED);
    expect(r.kind).toBe('overdue');
    expect(r.day?.dayIndex).toBe(0);
  });

  it('ignores athlete-added bonus slots', () => {
    const o = overview([
      day({ dayIndex: 0, status: 'completed' }),
      day({ dayIndex: 5, isBonus: true }),
    ]);
    expect(resolveNextSession(o, WED).kind).toBe('week_complete');
  });

  it('treats in_progress slots as still open', () => {
    const o = overview([day({ dayIndex: 0, weekday: WED, status: 'in_progress' })]);
    expect(resolveNextSession(o, WED).kind).toBe('today');
  });
});

// ─── summarizeSession ───────────────────────────────────────────────────────

describe('summarizeSession', () => {
  it('summarizes an absolute-kg prescription with segment totals and top segment', () => {
    const [row] = summarizeSession(
      [planned({ raw: '140x3, 150x2x3', unit: 'absolute_kg', def: { name: 'Back squat', exercise_code: 'BSQ' } })],
      baseOpts,
    );
    expect(row.code).toBe('BSQ');
    expect(row.totalReps).toBe(9);
    expect(row.totalSets).toBe(4);
    expect(row.topRaw).toBe('150x2x3');
    expect(row.avgValue).toBe(146.5);
    expect(row.topKg).toBeNull();
    expect(row.isHeavy).toBe(false);
  });

  it('bolds absolute-kg work at or above the threshold of the reference max', () => {
    const [row] = summarizeSession(
      [planned({ raw: '140x3, 150x2x3', unit: 'absolute_kg' })],
      { ...baseOpts, oneRmFor: () => 160 },
    );
    expect(row.isHeavy).toBe(true);
  });

  it('resolves percentage loads to kilograms through the reference max', () => {
    const [row] = summarizeSession(
      [planned({ raw: '75x2x2, 85x1x3', unit: 'percentage' })],
      { ...baseOpts, oneRmFor: () => 115 },
    );
    expect(row.topRaw).toBe('85x1x3');
    expect(row.topKg).toBe(98);
    expect(row.avgKg).not.toBeNull();
    expect(row.isHeavy).toBe(false);
  });

  it('applies the percent_to_kg rounding increment when enabled', () => {
    const [row] = summarizeSession(
      [planned({ raw: '85x1x3', unit: 'percentage' })],
      { ...baseOpts, roundEnabled: true, roundIncrement: 2.5, oneRmFor: () => 115 },
    );
    expect(row.topKg).toBe(97.5);
  });

  it('bolds percentage work at the threshold and leaves kg null without a max', () => {
    const [row] = summarizeSession(
      [planned({ raw: '90x1x2', unit: 'percentage' })],
      baseOpts,
    );
    expect(row.isHeavy).toBe(true);
    expect(row.topKg).toBeNull();
  });

  it('keeps combo tuples intact and skips kg resolution for combos', () => {
    const [row] = summarizeSession(
      [planned({ raw: '80x2+1x3', unit: 'absolute_kg', isCombo: true, def: { name: 'Sn pull + snatch' } })],
      { ...baseOpts, oneRmFor: () => 100 },
    );
    expect(row.totalReps).toBe(9);
    expect(row.totalSets).toBe(3);
    expect(row.topRaw).toBe('80x2+1x3');
    expect(row.topKg).toBeNull();
    expect(row.isHeavy).toBe(false);
  });

  it('skips sentinel note blocks', () => {
    const rows = summarizeSession(
      [
        planned({ raw: null, unit: 'free_text', def: { exercise_code: 'TEXT', name: 'Note' } }),
        planned({ raw: '60x5x3', unit: 'absolute_kg' }),
      ],
      baseOpts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].topRaw).toBe('60x5x3');
  });

  it('keeps unparseable free-text rows visible with empty totals', () => {
    const [row] = summarizeSession(
      [planned({ raw: 'heavy singles, stay sharp', unit: 'free_text', def: { name: 'Jerk from rack' } })],
      baseOpts,
    );
    expect(row.name).toBe('Jerk from rack');
    expect(row.topRaw).toBeNull();
  });
});
