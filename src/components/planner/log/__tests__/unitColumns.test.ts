import { describe, it, expect } from 'vitest';
import { buildUnitColumns } from '../LogWeekOverview';
import type { DayLog } from '../../../../lib/trainingLogModel';
import type { TrainingLogSession } from '../../../../lib/database.types';

/** Minimal DayLog carrying just a session with a date — the only fields
 *  buildUnitColumns reads. */
function dayWithSession(dayIndex: number, date: string): DayLog {
  return {
    date,
    dayIndex,
    session: { id: `s${dayIndex}`, date } as unknown as TrainingLogSession,
    exercises: [],
    messages: [],
  };
}

// 2026-06-08 is a Monday; 06-10 Wed; 06-13 Sat; 06-27 Sat.
describe('buildUnitColumns', () => {
  it('gives one column per training unit even when units share a calendar date', () => {
    // The regression: five units logged on the same Saturday must NOT collapse
    // into one column (which dropped all but the first unit's RAW/bodyweight).
    const weekLog: Record<number, DayLog> = {
      1: dayWithSession(1, '2026-06-27'),
      2: dayWithSession(2, '2026-06-27'),
      3: dayWithSession(3, '2026-06-27'),
    };
    const names = { 1: 'Day 1', 2: 'Day 2', 3: 'Day 3' };
    const cols = buildUnitColumns(weekLog, names, [1, 2, 3], false);
    expect(cols.map(c => c.dayIndex)).toEqual([1, 2, 3]);
    expect(cols.map(c => c.label)).toEqual(['Day 1', 'Day 2', 'Day 3']);
    expect(cols.map(c => c.sessions.map(s => s.id))).toEqual([['s1'], ['s2'], ['s3']]);
    // Each column still surfaces the date the unit was performed on.
    expect(cols.every(c => c.dateLabel === 'Sat 27/06')).toBe(true);
  });

  it('compact mode shows only units with a logged session, sorted by slot', () => {
    const weekLog: Record<number, DayLog> = {
      3: dayWithSession(3, '2026-06-10'), // Wed
      1: dayWithSession(1, '2026-06-08'), // Mon
    };
    const cols = buildUnitColumns(weekLog, { 1: 'Day 1', 3: 'Day 3' }, [1, 2, 3], false);
    // Day 2 has no session and is omitted in compact mode.
    expect(cols.map(c => c.dayIndex)).toEqual([1, 3]);
  });

  it('showAll includes planned units without a session as empty columns', () => {
    const weekLog: Record<number, DayLog> = {
      1: dayWithSession(1, '2026-06-08'),
    };
    const cols = buildUnitColumns(weekLog, { 1: 'Day 1', 2: 'Day 2' }, [1, 2], true);
    expect(cols.map(c => c.dayIndex)).toEqual([1, 2]);
    expect(cols[1].sessions).toHaveLength(0);
    expect(cols[1].dateLabel).toBeNull();
  });

  it('labels a logged bonus unit not in the plan with a Day N fallback', () => {
    const weekLog: Record<number, DayLog> = {
      5: dayWithSession(5, '2026-06-13'),
    };
    const cols = buildUnitColumns(weekLog, {}, [1, 2], false);
    expect(cols[0].label).toBe('Day 5');
  });

  it('returns no columns in compact mode when nothing is logged', () => {
    expect(buildUnitColumns({}, {}, [1, 2], false)).toEqual([]);
  });
});
