import { describe, it, expect } from 'vitest';
import {
  mergeGroupStructureIntoAthlete,
  pickForDays,
  seedStructureFromGroup,
  type WeekStructure,
} from '../groupPlanSync';

const structure = (s: Partial<WeekStructure>): WeekStructure => ({
  active_days: [],
  day_labels: null,
  day_display_order: null,
  day_schedule: null,
  ...s,
});

describe('pickForDays', () => {
  it('keeps only the keys for the given days', () => {
    expect(pickForDays({ '1': 'a', '2': 'b', '6': 'junk' }, [1, 2])).toEqual({ '1': 'a', '2': 'b' });
  });

  it('tolerates a null map', () => {
    expect(pickForDays(null, [1, 2])).toEqual({});
  });
});

describe('mergeGroupStructureIntoAthlete', () => {
  it('propagates a rename even when the day set is unchanged', () => {
    // The case that was broken: the old sync only wrote labels for NEW days,
    // so renaming a unit in the group reached nobody.
    const group = structure({ active_days: [1, 2, 3], day_labels: { '1': 'Hovedtræning A', '2': 'Hovedtræning B', '3': 'Bitræning' } });
    const athlete = structure({ active_days: [1, 2, 3], day_labels: { '1': 'Old name' } });
    const merged = mergeGroupStructureIntoAthlete(group, athlete);
    expect(merged.day_labels).toEqual({ '1': 'Hovedtræning A', '2': 'Hovedtræning B', '3': 'Bitræning' });
    expect(merged.active_days).toEqual([1, 2, 3]);
  });

  it('never copies a label for a day the group does not train', () => {
    // Group plans routinely carry placeholder keys ("Unit 6") outside their
    // own active_days — pushing those would clobber an athlete's bonus name.
    const group = structure({ active_days: [1, 2], day_labels: { '1': 'A', '6': 'Unit 6' } });
    const athlete = structure({ active_days: [1, 2, 6], day_labels: { '6': 'Konkurrence' } });
    const merged = mergeGroupStructureIntoAthlete(group, athlete);
    expect(merged.day_labels).toEqual({ '1': 'A', '6': 'Konkurrence' });
  });

  it('leaves an athlete label alone when the group has none for that day', () => {
    const group = structure({ active_days: [1, 2], day_labels: { '1': 'A' } });
    const athlete = structure({ active_days: [1, 2], day_labels: { '2': 'Athlete name' } });
    expect(mergeGroupStructureIntoAthlete(group, athlete).day_labels).toEqual({ '1': 'A', '2': 'Athlete name' });
  });

  it('adds new group days and keeps athlete-only days', () => {
    const group = structure({ active_days: [1, 2, 8] });
    const athlete = structure({ active_days: [1, 2, 6] });
    expect(mergeGroupStructureIntoAthlete(group, athlete).active_days).toEqual([1, 2, 6, 8]);
  });

  it('never removes a day the group has dropped', () => {
    // Removal would orphan the athlete's planned rows and their logs.
    const group = structure({ active_days: [1] });
    const athlete = structure({ active_days: [1, 2, 3] });
    expect(mergeGroupStructureIntoAthlete(group, athlete).active_days).toEqual([1, 2, 3]);
  });

  it('appends new days to an existing display order', () => {
    const group = structure({ active_days: [1, 2, 8] });
    const athlete = structure({ active_days: [1, 2], day_display_order: [2, 1] });
    expect(mergeGroupStructureIntoAthlete(group, athlete).day_display_order).toEqual([2, 1, 8]);
  });

  it('leaves a null display order null', () => {
    const group = structure({ active_days: [1, 2, 8] });
    const athlete = structure({ active_days: [1, 2] });
    expect(mergeGroupStructureIntoAthlete(group, athlete).day_display_order).toBeNull();
  });

  it('does not adopt the group ordering wholesale', () => {
    const group = structure({ active_days: [1, 2], day_display_order: [2, 1] });
    const athlete = structure({ active_days: [1, 2], day_display_order: [1, 2] });
    expect(mergeGroupStructureIntoAthlete(group, athlete).day_display_order).toEqual([1, 2]);
  });

  it('syncs the schedule under the same rule as the labels', () => {
    const group = structure({
      active_days: [1, 2],
      day_schedule: { '1': { weekday: 4, time: '16:00' }, '6': { weekday: 6, time: '10:00' } },
    });
    const athlete = structure({
      active_days: [1, 2, 6],
      day_schedule: { '1': { weekday: 3, time: '17:00' }, '6': { weekday: 6, time: '09:00' } },
    });
    const merged = mergeGroupStructureIntoAthlete(group, athlete);
    expect(merged.day_schedule).toEqual({
      '1': { weekday: 4, time: '16:00' },
      '6': { weekday: 6, time: '09:00' },
    });
  });

  it('is idempotent', () => {
    const group = structure({ active_days: [1, 2, 8], day_labels: { '1': 'A', '8': 'Extra' } });
    const athlete = structure({ active_days: [1, 2], day_labels: { '2': 'Mine' }, day_display_order: [1, 2] });
    const once = mergeGroupStructureIntoAthlete(group, athlete);
    const twice = mergeGroupStructureIntoAthlete(group, structure(once));
    expect(twice).toEqual(once);
  });

  it('athleteWins flips label precedence but still fills gaps (append-mode sync)', () => {
    const group = structure({ active_days: [1, 2], day_labels: { '1': 'Group A', '2': 'Group B' } });
    const athlete = structure({ active_days: [1], day_labels: { '1': 'My name' } });
    const merged = mergeGroupStructureIntoAthlete(group, athlete, { athleteWins: true });
    expect(merged.day_labels).toEqual({ '1': 'My name', '2': 'Group B' });
    expect(merged.active_days).toEqual([1, 2]);
  });
});

describe('seedStructureFromGroup', () => {
  it('gives a new athlete plan the group rhythm, not the 5-day default', () => {
    const group = structure({ active_days: [1, 2, 3], day_labels: { '1': 'A', '7': 'junk' } });
    expect(seedStructureFromGroup(group)).toEqual({
      active_days: [1, 2, 3],
      day_labels: { '1': 'A' },
      day_display_order: null,
      day_schedule: {},
    });
  });

  it('returns null for a group with no active days so the DB default applies', () => {
    expect(seedStructureFromGroup(structure({ active_days: [] }))).toBeNull();
  });

  it('drops display-order entries for days the group does not train', () => {
    const group = structure({ active_days: [1, 2], day_display_order: [2, 1, 9] });
    expect(seedStructureFromGroup(group)!.day_display_order).toEqual([2, 1]);
  });
});
