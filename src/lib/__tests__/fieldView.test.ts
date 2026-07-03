import { describe, it, expect } from 'vitest';
import {
  buildGroupWeekOverview,
  countSessionProgress,
  findMissedDays,
  isSessionLive,
  resolveNextSession,
  sessionRawTotal,
  summarizeSession,
  DEFAULT_FIELD_BOLD_PCT,
  type FieldSummaryOptions,
} from '../fieldView';
import type { TrainingLogSession } from '../database.types';
import type { WeekDayOverview, WeekOverview, PlannedExerciseFull } from '../trainingLogService';
import type { DayLog, LoggedExerciseFull } from '../trainingLogModel';
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
  members?: string[];
  comboNotation?: string | null;
}): PlannedExerciseFull {
  const def = exercise(partial.def ?? {});
  return {
    exercise: {
      id: `pe-${def.id}`,
      exercise_id: def.id,
      prescription_raw: partial.raw,
      unit: partial.unit,
      is_combo: partial.isCombo ?? false,
      combo_notation: partial.comboNotation ?? null,
    } as PlannedExercise,
    exerciseDef: def,
    setLines: [],
    comboMembers: (partial.members ?? []).map((name, i) => ({
      exerciseId: `m${i}`,
      exercise: exercise({ id: `m${i}`, name, exercise_code: null }),
      position: i,
    })),
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

  it('names a combo row from its members joined with +, with an empty code cell', () => {
    const [row] = summarizeSession(
      [planned({
        raw: '80x2+1x3', unit: 'absolute_kg', isCombo: true,
        def: { name: 'Snatch pull', exercise_code: 'SNP' },
        members: ['Snatch pull', 'Snatch', 'Overhead squat'],
      })],
      baseOpts,
    );
    expect(row.name).toBe('Snatch pull + Snatch + Overhead squat');
    expect(row.code).toBeNull();
  });

  it('prefers explicit combo_notation over the joined member names', () => {
    const [row] = summarizeSession(
      [planned({
        raw: '80x2+1x3', unit: 'absolute_kg', isCombo: true,
        members: ['Snatch pull', 'Snatch'],
        comboNotation: 'Pull + Snatch complex',
      })],
      baseOpts,
    );
    expect(row.name).toBe('Pull + Snatch complex');
  });

  it('skips every display sentinel (TEXT / IMAGE / VIDEO / GPP) — secondary content lives a level deeper', () => {
    const rows = summarizeSession(
      [
        planned({ raw: null, unit: 'free_text', def: { id: 't', exercise_code: 'TEXT', name: 'Note' } }),
        planned({ raw: null, unit: 'free_text', def: { id: 'i', exercise_code: 'IMAGE', name: 'Image' } }),
        planned({ raw: null, unit: 'free_text', def: { id: 'v', exercise_code: 'VIDEO', name: 'Video' } }),
        planned({ raw: null, unit: 'free_text', def: { id: 'g', exercise_code: 'GPP', name: 'GPP block' } }),
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

  it('keeps a main exercise without a prescription visible with dashes', () => {
    const rows = summarizeSession(
      [
        planned({ raw: null, unit: 'absolute_kg', def: { id: 'a', name: 'Sled push' } }),
        planned({ raw: '', unit: 'percentage', def: { id: 'b', name: 'Snatch' } }),
      ],
      baseOpts,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.topRaw).toBeNull();
      expect(row.totalReps).toBe(0);
      expect(row.totalSets).toBe(0);
      expect(row.avgValue).toBeNull();
    }
  });

  it('summarizes RPE prescriptions: numeric top segment, text-based totals, no kg or bolding', () => {
    const [row] = summarizeSession(
      [planned({ raw: '8x2x3', unit: 'rpe', def: { name: 'Power clean' } })],
      { ...baseOpts, oneRmFor: () => 120 },
    );
    expect(row.totalReps).toBe(6);
    expect(row.totalSets).toBe(3);
    expect(row.topRaw).toBe('8x2x3');
    expect(row.topKg).toBeNull();
    // Fully numeric RPE input parses numerically, so the avg column
    // carries the average RPE (never resolved to kg, never bolded).
    expect(row.avgValue).toBe(8);
    expect(row.isHeavy).toBe(false);
  });

  it('shows the whole prescription for structured free-text loads (no numeric top exists)', () => {
    const [row] = summarizeSession(
      [planned({ raw: 'Heavy x 5 x 3', unit: 'free_text_reps', def: { name: 'Farmer carry' } })],
      baseOpts,
    );
    expect(row.totalReps).toBe(15);
    expect(row.totalSets).toBe(3);
    expect(row.topRaw).toBe('Heavy x 5 x 3');
    expect(row.topKg).toBeNull();
    expect(row.isHeavy).toBe(false);
  });

  it('leaves prose in free_text_reps mode without a top segment', () => {
    const [row] = summarizeSession(
      [planned({ raw: 'work up to opener', unit: 'free_text_reps', def: { name: 'Snatch' } })],
      baseOpts,
    );
    expect(row.topRaw).toBeNull();
    expect(row.totalReps).toBe(0);
  });

  it('handles interval loads: range kept in the top segment, midpoint in the average, upper bound bolds', () => {
    const [row] = summarizeSession(
      [planned({ raw: '80-90x5x2', unit: 'absolute_kg' })],
      { ...baseOpts, oneRmFor: () => 100 },
    );
    expect(row.topRaw).toBe('80-90x5x2');
    expect(row.totalReps).toBe(10);
    expect(row.totalSets).toBe(2);
    expect(row.avgValue).toBe(85);
    expect(row.isHeavy).toBe(true); // 90/100 ≥ 90 % threshold
  });

  it('omits the sets part of the top segment when sets = 1 (display rule)', () => {
    const [row] = summarizeSession(
      [planned({ raw: '80x5', unit: 'absolute_kg' })],
      baseOpts,
    );
    expect(row.topRaw).toBe('80x5');
    expect(row.totalSets).toBe(1);
  });

  it('picks the numeric top for combos that mix free-text and numeric lines', () => {
    const [row] = summarizeSession(
      [planned({
        raw: 'Heavyx2+1, 80x2+1x2', unit: 'absolute_kg', isCombo: true,
        members: ['Snatch pull', 'Snatch'],
      })],
      baseOpts,
    );
    expect(row.topRaw).toBe('80x2+1x2');
    expect(row.totalSets).toBe(3);
    expect(row.totalReps).toBe(9);
  });

  it('resolves percentage loads through pr_reference_exercise_id, not the row exercise id', () => {
    const oneRmFor = (ex: Exercise) => (ex.pr_reference_exercise_id === 'sn-ref' ? 100 : null);
    const [row] = summarizeSession(
      [planned({ raw: '80x2x2', unit: 'percentage', def: { pr_reference_exercise_id: 'sn-ref' } })],
      { ...baseOpts, oneRmFor },
    );
    expect(row.topKg).toBe(80);
  });
});

// ─── findMissedDays ─────────────────────────────────────────────────────────

describe('findMissedDays', () => {
  const MON = 0, TUE = 1, WED = 2, FRI = 4;

  it('is empty for a null overview or an untouched future week', () => {
    expect(findMissedDays(null, WED)).toEqual([]);
    const o = overview([
      day({ dayIndex: 0, weekday: WED }),
      day({ dayIndex: 1, weekday: FRI }),
    ]);
    expect(findMissedDays(o, WED)).toEqual([]);
  });

  it('flags an assigned weekday strictly before today with no log', () => {
    const o = overview([
      day({ dayIndex: 0, weekday: MON }),
      day({ dayIndex: 1, weekday: FRI }),
    ]);
    const missed = findMissedDays(o, WED);
    expect(missed.map(d => d.dayIndex)).toEqual([0]);
  });

  it('does not flag a past assigned day the athlete logged', () => {
    const o = overview([
      day({ dayIndex: 0, weekday: MON, hasLog: true, status: 'in_progress' }),
      day({ dayIndex: 1, weekday: TUE, hasLog: true, status: 'completed' }),
    ]);
    expect(findMissedDays(o, WED)).toEqual([]);
  });

  it('flags explicitly skipped slots regardless of weekday assignment', () => {
    const o = overview([
      day({ dayIndex: 0, status: 'skipped', hasLog: true }),
      day({ dayIndex: 1, weekday: FRI, status: 'skipped', hasLog: true }),
    ]);
    expect(findMissedDays(o, MON).map(d => d.dayIndex)).toEqual([0, 1]);
  });

  it('never flags today, unassigned open slots, bonus or empty slots', () => {
    const o = overview([
      day({ dayIndex: 0, weekday: WED }),
      day({ dayIndex: 1 }),
      day({ dayIndex: 2, weekday: MON, isBonus: true }),
      day({ dayIndex: 3, weekday: MON, plannedCount: 0 }),
    ]);
    expect(findMissedDays(o, WED)).toEqual([]);
  });
});

// ─── live progress fixtures ─────────────────────────────────────────────────

function loggedEx(over: {
  plannedExerciseId?: string | null;
  status?: string;
  sets?: { status: string }[];
}): LoggedExerciseFull {
  return {
    log: {
      id: `le-${over.plannedExerciseId ?? 'offplan'}`,
      planned_exercise_id: over.plannedExerciseId ?? null,
      status: over.status ?? 'pending',
    } as never,
    sets: (over.sets ?? []) as never,
    exercise: null,
  };
}

function dayLog(over: {
  sessionStatus?: string | null;
  exercises?: LoggedExerciseFull[];
}): DayLog {
  return {
    date: '2026-07-01',
    dayIndex: 0,
    session: over.sessionStatus === null ? null : ({ status: over.sessionStatus ?? 'pending' } as never),
    exercises: over.exercises ?? [],
    messages: [],
  };
}

// ─── isSessionLive ──────────────────────────────────────────────────────────

describe('isSessionLive', () => {
  it('is false for a missing log or a pending session without work', () => {
    expect(isSessionLive(null)).toBe(false);
    expect(isSessionLive(dayLog({ sessionStatus: 'pending' }))).toBe(false);
  });

  it('is true for an in_progress session even before any exercise is done', () => {
    expect(isSessionLive(dayLog({ sessionStatus: 'in_progress' }))).toBe(true);
  });

  it('is true for a pending session that already carries done work', () => {
    const log = dayLog({
      sessionStatus: 'pending',
      exercises: [loggedEx({ plannedExerciseId: 'pe-ex1', status: 'completed' })],
    });
    expect(isSessionLive(log)).toBe(true);
  });
});

// ─── countSessionProgress ───────────────────────────────────────────────────

describe('countSessionProgress', () => {
  const twoLifts = [
    planned({ raw: '80x2x3', unit: 'percentage', def: { id: 'a' } }),
    planned({ raw: '100x5x5', unit: 'absolute_kg', def: { id: 'b', name: 'Back squat' } }),
  ];

  it('counts explicitly completed exercises against the loggable total', () => {
    const log = dayLog({
      sessionStatus: 'in_progress',
      exercises: [loggedEx({ plannedExerciseId: 'pe-a', status: 'completed' })],
    });
    expect(countSessionProgress(twoLifts, log)).toEqual({ done: 1, total: 2 });
  });

  it('counts an exercise whose sets all reached a terminal status', () => {
    const log = dayLog({
      sessionStatus: 'in_progress',
      exercises: [
        loggedEx({
          plannedExerciseId: 'pe-a',
          sets: [{ status: 'completed' }, { status: 'skipped' }],
        }),
      ],
    });
    expect(countSessionProgress(twoLifts, log)).toEqual({ done: 1, total: 2 });
  });

  it('does not count partially logged or pending exercises', () => {
    const log = dayLog({
      sessionStatus: 'in_progress',
      exercises: [
        loggedEx({ plannedExerciseId: 'pe-a', sets: [{ status: 'completed' }, { status: 'pending' }] }),
      ],
    });
    expect(countSessionProgress(twoLifts, log)).toEqual({ done: 0, total: 2 });
  });

  it('excludes display sentinels from the total but keeps GPP blocks', () => {
    const withBlocks = [
      ...twoLifts,
      planned({ raw: null, unit: 'free_text', def: { id: 'note', exercise_code: 'TEXT', name: 'Note' } }),
      planned({ raw: null, unit: 'free_text', def: { id: 'gpp', exercise_code: 'GPP', name: 'GPP' } }),
    ];
    const log = dayLog({
      sessionStatus: 'in_progress',
      exercises: [loggedEx({ plannedExerciseId: 'pe-gpp', status: 'completed' })],
    });
    expect(countSessionProgress(withBlocks, log)).toEqual({ done: 1, total: 3 });
  });

  it('ignores off-plan additions and tolerates a missing log', () => {
    const log = dayLog({
      sessionStatus: 'in_progress',
      exercises: [loggedEx({ plannedExerciseId: null, status: 'completed' })],
    });
    expect(countSessionProgress(twoLifts, log)).toEqual({ done: 0, total: 2 });
    expect(countSessionProgress(twoLifts, null)).toEqual({ done: 0, total: 2 });
  });
});

// ─── sessionRawTotal ────────────────────────────────────────────────────────

describe('sessionRawTotal', () => {
  function session(over: Partial<TrainingLogSession>): TrainingLogSession {
    return {
      raw_sleep: null,
      raw_physical: null,
      raw_mood: null,
      raw_nutrition: null,
      raw_total: null,
      ...over,
    } as TrainingLogSession;
  }

  it('sums the four pillars when the athlete rated all of them', () => {
    const s = session({ raw_sleep: 3, raw_physical: 2, raw_mood: 3, raw_nutrition: 1 });
    expect(sessionRawTotal(s)).toBe(9);
  });

  it('prefers the fresh pillar sum over a stale stored total', () => {
    const s = session({
      raw_sleep: 3, raw_physical: 3, raw_mood: 3, raw_nutrition: 3, raw_total: 8,
    });
    expect(sessionRawTotal(s)).toBe(12);
  });

  it('falls back to the stored raw_total when pillars are incomplete', () => {
    const s = session({ raw_sleep: 3, raw_total: 10 });
    expect(sessionRawTotal(s)).toBe(10);
  });

  it('is null when RAW was never logged, or without a session', () => {
    expect(sessionRawTotal(session({}))).toBeNull();
    expect(sessionRawTotal(session({ raw_sleep: 2 }))).toBeNull();
    expect(sessionRawTotal(null)).toBeNull();
  });
});

// ─── buildGroupWeekOverview ─────────────────────────────────────────────────

describe('buildGroupWeekOverview', () => {
  const plan = {
    id: 'gwp1',
    active_days: [2, 0, 1],
    day_labels: { 0: 'Heavy day' },
    day_schedule: { 1: { weekday: 4, time: '16:00' } },
  };

  it('maps active days in sorted order with labels, weekdays, and counts', () => {
    const o = buildGroupWeekOverview('2026-06-29', plan, new Map([[0, 4], [1, 2]]));
    expect(o.weekPlanId).toBe('gwp1');
    expect(o.days.map(d => d.dayIndex)).toEqual([0, 1, 2]);
    expect(o.days[0].label).toBe('Heavy day');
    expect(o.days[1].label).toBe('Day 1');
    expect(o.days[1].weekday).toBe(4);
    expect(o.days[0].weekday).toBeNull();
    expect(o.days.map(d => d.plannedCount)).toEqual([4, 2, 0]);
    expect(o.days.every(d => d.status === 'pending' && !d.hasLog && !d.isBonus)).toBe(true);
    expect(o.planSource).toBe('group');
  });

  it('feeds resolveNextSession: schedule-only resolution, empty slots skipped', () => {
    const o = buildGroupWeekOverview('2026-06-29', plan, new Map([[0, 4], [1, 2]]));
    // Thursday (weekday 3): day 1 is assigned to Friday (4); day 0 is unassigned.
    const r = resolveNextSession(o, 3);
    expect(r.kind).toBe('next_up');
    expect(r.day?.dayIndex).toBe(0);
    // Friday: the assigned slot is today.
    expect(resolveNextSession(o, 4).kind).toBe('today');
  });

  it('handles null plan fields and empty counts', () => {
    const o = buildGroupWeekOverview('2026-06-29', {
      id: 'gwp2', active_days: null, day_labels: null, day_schedule: null,
    }, new Map());
    expect(o.days).toEqual([]);
    expect(resolveNextSession(o, 0).kind).toBe('no_plan');
  });
});
