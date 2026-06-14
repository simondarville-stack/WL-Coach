import { describe, it, expect } from 'vitest';
import { buildWeekdayColumns } from '../LogWeekOverview';
import type { DayLog } from '../../../../lib/trainingLogModel';
import type { TrainingLogSession } from '../../../../lib/database.types';

/** Minimal DayLog carrying just a session with a date — the only fields
 *  buildWeekdayColumns reads. */
function dayWithSession(dayIndex: number, date: string): DayLog {
  return {
    date,
    dayIndex,
    session: { id: `s${dayIndex}`, date } as unknown as TrainingLogSession,
    exercises: [],
    messages: [],
  };
}

// 2026-06-08 is a Monday; 06-10 Wed; 06-13 Sat.
describe('buildWeekdayColumns', () => {
  it('locks sessions to the weekday they were performed, not the planned slot', () => {
    // Athlete trained "unit 0" on Wednesday and "unit 1" on Monday — out of order.
    const weekLog: Record<number, DayLog> = {
      0: dayWithSession(0, '2026-06-10'), // Wed
      1: dayWithSession(1, '2026-06-08'), // Mon
    };
    const cols = buildWeekdayColumns(weekLog, false);
    // Compact: only the two weekdays with a session, sorted Mon-first.
    expect(cols.map(c => c.label)).toEqual(['Mon', 'Wed']);
    expect(cols[0].sessions.map(s => s.id)).toEqual(['s1']); // Monday → unit 1
    expect(cols[1].sessions.map(s => s.id)).toEqual(['s0']); // Wednesday → unit 0
  });

  it('shows all seven weekdays when showAll is true', () => {
    const weekLog: Record<number, DayLog> = {
      0: dayWithSession(0, '2026-06-10'), // Wed
    };
    const cols = buildWeekdayColumns(weekLog, true);
    expect(cols.map(c => c.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    // Only Wednesday carries a session; the rest are empty.
    expect(cols[2].sessions).toHaveLength(1);
    expect(cols[0].sessions).toHaveLength(0);
  });

  it('groups multiple sessions on the same weekday into one column', () => {
    const weekLog: Record<number, DayLog> = {
      0: dayWithSession(0, '2026-06-13'), // Sat
      1: dayWithSession(1, '2026-06-13'), // Sat (two units same day)
    };
    const cols = buildWeekdayColumns(weekLog, false);
    expect(cols).toHaveLength(1);
    expect(cols[0].label).toBe('Sat');
    expect(cols[0].sessions.map(s => s.id).sort()).toEqual(['s0', 's1']);
  });

  it('returns no columns in compact mode when nothing is logged', () => {
    expect(buildWeekdayColumns({}, false)).toEqual([]);
  });
});
