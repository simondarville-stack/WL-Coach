import { describe, it, expect } from 'vitest';
import {
  classifyAthleteRows,
  outcomeForMode,
  type ClassifiableAthleteRow,
  type ClassifiableGroupRow,
} from '../groupSyncModel';

const g = (exercise_id: string, day_index: number, label = exercise_id): ClassifiableGroupRow =>
  ({ exercise_id, day_index, label });

const a = (
  id: string,
  exercise_id: string,
  day_index: number,
  source: ClassifiableAthleteRow['source'],
  label = exercise_id,
): ClassifiableAthleteRow => ({ id, exercise_id, day_index, source, label });

const keys = (slots: { key: string }[]) => slots.map(s => s.key);

describe('classifyAthleteRows', () => {
  it('classifies the four group-slot states', () => {
    const group = [g('squat', 1), g('snatch', 1), g('cj', 2), g('pull', 3)];
    const athlete = [
      a('r1', 'snatch', 1, 'group'),      // unlogged group row → replace
      a('r2', 'cj', 2, 'individual'),     // coach-edited → pinned
      a('r3', 'pull', 3, 'group'),        // logged below → logged
    ];
    const c = classifyAthleteRows(group, athlete, new Set(['r3']));
    expect(keys(c.add)).toEqual(['squat:1']);
    expect(keys(c.replace)).toEqual(['snatch:1']);
    expect(keys(c.pinned)).toEqual(['cj:2']);
    expect(keys(c.logged)).toEqual(['pull:3']);
    expect(c.stale).toEqual([]);
    expect(c.extras).toBe(0);
  });

  it('a logged slot beats an individual override on the same slot', () => {
    // Both a logged row and an unlogged individual row on the slot: the log
    // makes the whole slot untouchable, so it must NOT show as overwritable.
    const group = [g('squat', 1)];
    const athlete = [
      a('r1', 'squat', 1, 'individual'),
      a('r2', 'squat', 1, 'group'),
    ];
    const c = classifyAthleteRows(group, athlete, new Set(['r2']));
    expect(keys(c.logged)).toEqual(['squat:1']);
    expect(c.pinned).toEqual([]);
  });

  it('finds stale group rows and counts athlete extras', () => {
    const group = [g('squat', 1)];
    const athlete = [
      a('r1', 'press', 2, 'group'),       // group no longer trains it → stale
      a('r2', 'row', 2, 'individual'),    // athlete's own addition → extra
      a('r3', 'abs', 4, null),            // pre-tracking row → extra (invisible to sync)
      a('r4', 'front-squat', 5, 'group'), // stale but logged → extra (kept)
    ];
    const c = classifyAthleteRows(group, athlete, new Set(['r4']));
    expect(keys(c.stale)).toEqual(['press:2']);
    expect(c.extras).toBe(3);
    expect(keys(c.add)).toEqual(['squat:1']);
  });

  it('same exercise on different days is two independent slots', () => {
    const group = [g('squat', 1), g('squat', 3)];
    const athlete = [a('r1', 'squat', 1, 'individual')];
    const c = classifyAthleteRows(group, athlete, new Set());
    expect(keys(c.pinned)).toEqual(['squat:1']);
    expect(keys(c.add)).toEqual(['squat:3']);
  });

  it('an athlete with no plan yet classifies everything as add', () => {
    const c = classifyAthleteRows([g('squat', 1), g('snatch', 2)], [], new Set());
    expect(c.add).toHaveLength(2);
    expect(c.replace).toEqual([]);
    expect(c.pinned).toEqual([]);
  });
});

describe('outcomeForMode', () => {
  const c = classifyAthleteRows(
    [g('new', 1), g('grp', 1), g('pin', 2), g('log', 3)],
    [
      a('r1', 'grp', 1, 'group'),
      a('r2', 'pin', 2, 'individual'),
      a('r3', 'log', 3, 'group'),
      a('r4', 'old', 4, 'group'), // stale
    ],
    new Set(['r3']),
  );

  it('update: replaces group rows, keeps pinned and logged, removes stale', () => {
    expect(outcomeForMode(c, 'update')).toEqual({
      added: 1, replaced: 1, overwritten: 0, keptPinned: 1, keptLogged: 1, removed: 1,
    });
  });

  it('overwrite: pinned rows are replaced too, logged still protected', () => {
    expect(outcomeForMode(c, 'overwrite')).toEqual({
      added: 1, replaced: 1, overwritten: 1, keptPinned: 0, keptLogged: 1, removed: 1,
    });
  });

  it('append: only adds; nothing is replaced or removed', () => {
    expect(outcomeForMode(c, 'append')).toEqual({
      added: 1, replaced: 0, overwritten: 0, keptPinned: 1, keptLogged: 2, removed: 0,
    });
  });
});
