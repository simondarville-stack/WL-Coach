import { describe, it, expect } from 'vitest';
import { composeBriefing, athleteRawFromWeeks, type AthleteRaw, type WeekStatLike } from '../briefing';

const clean: AthleteRaw = { name: 'Clean', tonnage: 12000, prevTonnage: 11000, topLifts: [{ exercise: 'Back Squat', load: 180 }], rawTotal: 10, prevRawTotal: 9, rpe: 7 };
const lowRaw: AthleteRaw = { name: 'Tired', tonnage: 9000, prevTonnage: 9500, topLifts: [], rawTotal: 5, prevRawTotal: 8, rpe: 8 };
const volDrop: AthleteRaw = { name: 'Quiet', tonnage: 3000, prevTonnage: 10000, topLifts: [{ exercise: 'Snatch', load: 90 }], rawTotal: 9, prevRawTotal: 9, rpe: 6 };

describe('composeBriefing — readiness + numbers', () => {
  it('does not flag a healthy athlete; computes the tonnage trend', () => {
    const a = composeBriefing({ date: '2026-06-09', athletes: [clean] }).athletes[0];
    expect(a.flagged).toBe(false);
    expect(a.tonnageDeltaPct).toBeCloseTo(((12000 - 11000) / 11000) * 100, 0);
  });

  it('flags low and sliding RAW readiness', () => {
    const a = composeBriefing({ date: '2026-06-09', athletes: [lowRaw] }).athletes[0];
    expect(a.flagged).toBe(true);
    expect(a.concern).toBe('readiness is low');
    expect(a.watch.join(' ')).toMatch(/RAW 5 of 12 — low readiness/);
    expect(a.watch.join(' ')).toMatch(/RAW down 3 on last week/);
  });

  it('flags a sharp training-volume drop', () => {
    const a = composeBriefing({ date: '2026-06-09', athletes: [volDrop] }).athletes[0];
    expect(a.flagged).toBe(true);
    expect(a.watch.join(' ')).toMatch(/training volume down 70%/);
  });

  it('rolls up the squad — total tonnage, mean RAW, flagged count', () => {
    const b = composeBriefing({ date: '2026-06-09', athletes: [clean, lowRaw, volDrop] });
    expect(b.squad.athleteCount).toBe(3);
    expect(b.squad.tonnage).toBe(12000 + 9000 + 3000);
    expect(b.squad.flagged).toBe(2);
    expect(b.squad.avgRaw).toBeCloseTo((10 + 5 + 9) / 3, 5);
  });
});

describe('athleteRawFromWeeks', () => {
  it('reads the last COMPLETED week (not the in-progress one) + heaviest lifts', () => {
    const weeks: WeekStatLike[] = [
      { weekStart: '2026-05-25', weekState: 'past', performedTonnage: 9000, rawTotal: 8, sessionRpe: 7, exerciseBreakdowns: [{ exerciseName: 'Squat', performedMaxLoad: 150 }] },
      { weekStart: '2026-06-01', weekState: 'past', performedTonnage: 12000, rawTotal: 9, sessionRpe: 7, exerciseBreakdowns: [{ exerciseName: 'Back Squat', performedMaxLoad: 180 }, { exerciseName: 'Snatch', performedMaxLoad: 110 }, { exerciseName: 'Pull', performedMaxLoad: 60 }] },
      { weekStart: '2026-06-08', weekState: 'current', performedTonnage: 3000, rawTotal: 9, sessionRpe: 7, exerciseBreakdowns: [] },
    ];
    const raw = athleteRawFromWeeks('A', weeks);
    expect(raw.tonnage).toBe(12000); // last completed (06-01), not the in-progress 06-08
    expect(raw.prevTonnage).toBe(9000); // the week before (05-25)
    expect(raw.rawTotal).toBe(9);
    expect(raw.topLifts.map((l) => l.exercise)).toEqual(['Back Squat', 'Snatch']); // top 2 by load
  });
});
