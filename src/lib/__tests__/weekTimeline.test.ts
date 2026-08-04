import { describe, it, expect } from 'vitest';
import {
  orderedUnits,
  ordinalFraction,
  parseClockMinutes,
  placeLoggedDate,
  placeUnit,
  scheduledFraction,
} from '../weekTimeline';

describe('parseClockMinutes', () => {
  it('parses HH:MM', () => {
    expect(parseClockMinutes('00:00')).toBe(0);
    expect(parseClockMinutes('09:30')).toBe(570);
    expect(parseClockMinutes('23:59')).toBe(1439);
    expect(parseClockMinutes(' 16:00 ')).toBe(960);
  });

  it('rejects anything else', () => {
    for (const bad of [null, undefined, '', 'noon', '24:00', '12:60', '9', '9.30']) {
      expect(parseClockMinutes(bad as string | null)).toBeNull();
    }
  });
});

describe('orderedUnits', () => {
  it('sorts active days when there is no explicit order', () => {
    expect(orderedUnits([3, 1, 2], null)).toEqual([1, 2, 3]);
  });

  it('honours the coach display order', () => {
    expect(orderedUnits([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('drops order entries for inactive days', () => {
    expect(orderedUnits([1, 2], [1, 2, 5])).toEqual([1, 2]);
  });

  it('appends active days the order forgot — a unit must never vanish', () => {
    expect(orderedUnits([1, 2, 8], [2, 1])).toEqual([2, 1, 8]);
  });

  it('handles empty input', () => {
    expect(orderedUnits(null, null)).toEqual([]);
    expect(orderedUnits([], [1, 2])).toEqual([]);
  });
});

describe('scheduledFraction', () => {
  it('puts Monday 00:00 at 0 and Sunday late at just under 1', () => {
    expect(scheduledFraction({ weekday: 0, time: '00:00' })).toBe(0);
    expect(scheduledFraction({ weekday: 6, time: '23:59' })).toBeCloseTo(1439 / 10080 + 6 / 7, 6);
    expect(scheduledFraction({ weekday: 6, time: '23:59' })).toBeLessThan(1);
  });

  it('places a weekday with no clock time at midday', () => {
    // Wednesday = index 2 → 2/7 of the week, plus half a day.
    expect(scheduledFraction({ weekday: 2, time: null })).toBeCloseTo((2 * 1440 + 720) / 10080, 6);
  });

  it('a real Mon/Wed/Fri week lands on the right thirds-ish', () => {
    const mon = scheduledFraction({ weekday: 0, time: '17:00' });
    const wed = scheduledFraction({ weekday: 2, time: '17:00' });
    const fri = scheduledFraction({ weekday: 4, time: '17:00' });
    expect(mon).toBeLessThan(wed);
    expect(wed).toBeLessThan(fri);
    expect(fri).toBeLessThan(1);
  });

  it('clamps a nonsense weekday into the week', () => {
    expect(scheduledFraction({ weekday: -3, time: '12:00' })).toBeGreaterThanOrEqual(0);
    expect(scheduledFraction({ weekday: 99, time: '12:00' })).toBeLessThan(1);
  });
});

describe('ordinalFraction', () => {
  it('spreads sessions evenly — the coach rule: 2 of 3 sits at 2/3', () => {
    const ordered = [1, 2, 3];
    expect(ordinalFraction(1, ordered)).toBeCloseTo(1 / 3, 10);
    expect(ordinalFraction(2, ordered)).toBeCloseTo(2 / 3, 10);
    expect(ordinalFraction(3, ordered)).toBeCloseTo(1, 10);
  });

  it('follows the display order, not the day number', () => {
    // Coach shows unit 3 first, so unit 3 is session 1 of 3.
    expect(ordinalFraction(3, [3, 1, 2])).toBeCloseTo(1 / 3, 10);
    expect(ordinalFraction(2, [3, 1, 2])).toBeCloseTo(1, 10);
  });

  it('a single session sits at the end of its week', () => {
    expect(ordinalFraction(1, [1])).toBe(1);
  });

  it('returns null for a unit that is not in the week', () => {
    expect(ordinalFraction(9, [1, 2, 3])).toBeNull();
    expect(ordinalFraction(1, [])).toBeNull();
  });
});

describe('placeUnit', () => {
  const activeDays = [1, 2, 3];

  it('prefers a fixed schedule over the ordinal spread', () => {
    const p = placeUnit({
      dayIndex: 2,
      activeDays,
      displayOrder: null,
      schedule: { '2': { weekday: 2, time: '16:00' } },
    });
    expect(p.basis).toBe('scheduled');
    expect(p.fraction).toBeCloseTo((2 * 1440 + 960) / 10080, 6);
    // and it is NOT the ordinal answer
    expect(p.fraction).not.toBeCloseTo(2 / 3, 3);
  });

  it('falls back to the ordinal spread when the unit has no slot', () => {
    const p = placeUnit({
      dayIndex: 2,
      activeDays,
      displayOrder: null,
      // schedule exists but says nothing about day 2
      schedule: { '1': { weekday: 0, time: null } },
    });
    expect(p.basis).toBe('ordinal');
    expect(p.fraction).toBeCloseTo(2 / 3, 10);
  });

  it('uses the ordinal spread when there is no schedule at all', () => {
    const p = placeUnit({ dayIndex: 3, activeDays, displayOrder: null, schedule: null });
    expect(p.basis).toBe('ordinal');
    expect(p.fraction).toBeCloseTo(1, 10);
  });

  it('places a leftover row on a switched-off day mid-week rather than dropping it', () => {
    const p = placeUnit({ dayIndex: 7, activeDays, displayOrder: null, schedule: null });
    expect(p.basis).toBe('fallback');
    expect(p.fraction).toBe(0.5);
  });

  it('never leaves the week', () => {
    for (const day of [1, 2, 3, 7]) {
      const p = placeUnit({ dayIndex: day, activeDays, displayOrder: null, schedule: null });
      expect(p.fraction).toBeGreaterThan(0);
      expect(p.fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('placeLoggedDate', () => {
  const monday = '2026-08-03'; // a Monday

  it('uses the real weekday of the session', () => {
    expect(placeLoggedDate(monday, '2026-08-03', '00:00')).toBe(0);
    expect(placeLoggedDate(monday, '2026-08-05', '12:00')).toBeCloseTo((2 * 1440 + 720) / 10080, 6);
    expect(placeLoggedDate(monday, '2026-08-09', '12:00')).toBeCloseTo((6 * 1440 + 720) / 10080, 6);
  });

  it('defaults to midday without a time', () => {
    expect(placeLoggedDate(monday, '2026-08-04')).toBeCloseTo((1440 + 720) / 10080, 6);
  });

  it('clamps a date outside the week instead of bleeding into a neighbour', () => {
    expect(placeLoggedDate(monday, '2026-07-30', '12:00')).toBeCloseTo(720 / 10080, 6);   // before → Monday
    expect(placeLoggedDate(monday, '2026-08-20', '12:00')).toBeCloseTo((6 * 1440 + 720) / 10080, 6); // after → Sunday
  });

  it('stays inside [0, 1)', () => {
    for (const d of ['2026-08-03', '2026-08-06', '2026-08-09', '2026-09-01']) {
      const f = placeLoggedDate(monday, d, '23:59');
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});
