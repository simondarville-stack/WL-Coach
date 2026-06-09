import { describe, it, expect } from 'vitest';
import { athleteDebriefFromWeeks, composeBriefing, analysePillars, type WeekStatLike, type WeeklyMiss, type WeeklyPR, type WeeklyPillars, type AthleteInputs } from '../briefing';

function week(
  weekStart: string,
  state: 'past' | 'current',
  tonnage: number,
  raw: number | null,
  bds: { exerciseName: string; performedSets: number; performedReps: number; performedMaxLoad: number }[],
): WeekStatLike {
  return { weekStart, weekState: state, performedTonnage: tonnage, rawTotal: raw, exerciseBreakdowns: bds };
}

const weeks: WeekStatLike[] = [
  week('2026-05-25', 'past', 9000, 8, [{ exerciseName: 'Squat', performedSets: 3, performedReps: 9, performedMaxLoad: 150 }]),
  week('2026-06-01', 'past', 11000, 9, [
    { exerciseName: 'Back Squat', performedSets: 5, performedReps: 15, performedMaxLoad: 180 },
    { exerciseName: 'Snatch', performedSets: 4, performedReps: 8, performedMaxLoad: 110 },
  ]),
  week('2026-06-08', 'current', 2000, 9, []),
];

const inputs = (name: string, w: WeekStatLike[], extra: Partial<AthleteInputs> = {}): AthleteInputs => ({
  name, weeks: w, misses: [], skippedExercises: [], prs: [], pillars: [], ...extra,
});

const pillarWeek = (weekStart: string, sleep: number, physical: number, mood: number, nutrition: number): WeeklyPillars => ({ weekStart, sleep, physical, mood, nutrition });

describe('athleteDebriefFromWeeks', () => {
  it('reads the last completed week: exercises heaviest-first, tonnage, RAW + trend', () => {
    const d = athleteDebriefFromWeeks(inputs('A', weeks));
    expect(d.weekStart).toBe('2026-06-01'); // last completed, not the in-progress 06-08
    expect(d.tonnage).toBe(11000);
    expect(d.prevTonnage).toBe(9000);
    expect(d.exercises.map((e) => e.name)).toEqual(['Back Squat', 'Snatch']);
    expect(d.exercises[0]).toMatchObject({ name: 'Back Squat', sets: 5, reps: 15, maxLoad: 180 });
    expect(d.rawTotal).toBe(9);
    expect(d.rawDelta).toBe(1);
    expect(d.rawTrend).toEqual([8, 9]);
    expect(d.flagged).toBe(false);
  });

  it('flags low readiness', () => {
    const d = athleteDebriefFromWeeks(inputs('Low', [week('2026-06-01', 'past', 8000, 5, [])]));
    expect(d.rawDirection).toBe('low');
    expect(d.concern).toBe('readiness is low');
    expect(d.flagged).toBe(true);
  });

  it('flags sliding readiness on a drop vs the prior week', () => {
    const w = [week('2026-05-25', 'past', 9000, 11, []), week('2026-06-01', 'past', 9000, 8, [])];
    const d = athleteDebriefFromWeeks(inputs('Slide', w));
    expect(d.rawDelta).toBe(-3);
    expect(d.rawDirection).toBe('sliding');
    expect(d.concern).toBe('readiness is sliding');
  });

  it('surfaces misses and PRs; concern falls through to misses when RAW is fine', () => {
    const misses: WeeklyMiss[] = [{ exerciseName: 'Snatch', failedSets: 2, skippedSets: 0, heaviestFailedLoad: 110 }];
    const prs: WeeklyPR[] = [{ exerciseName: 'Back Squat', repCount: 1, valueKg: 185, isCompetitionLift: false }];
    const d = athleteDebriefFromWeeks(inputs('M', weeks, { misses, skippedExercises: ['Front Squat'], prs }));
    expect(d.misses).toHaveLength(1);
    expect(d.prs).toHaveLength(1);
    expect(d.skippedExercises).toEqual(['Front Squat']);
    expect(d.concern).toBe('missed attempts in training');
    expect(d.flagged).toBe(true);
  });
});

describe('analysePillars', () => {
  it('flags a pillar that is consistently low (e.g. sleep)', () => {
    const pillars: WeeklyPillars[] = [
      pillarWeek('2026-05-18', 1.5, 3, 3, 3),
      pillarWeek('2026-05-25', 1.0, 3, 3, 2.5),
      pillarWeek('2026-06-01', 1.5, 2.5, 3, 3),
    ];
    const { latest, notes } = analysePillars(pillars, '2026-06-01');
    expect(latest).toMatchObject({ sleep: 1.5, physical: 2.5, mood: 3, nutrition: 3 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pillar: 'sleep', kind: 'consistently-low' });
    expect(notes[0].avg).toBeCloseTo((1.5 + 1.0 + 1.5) / 3, 5);
  });

  it('does not flag a healthy pillar set', () => {
    const pillars: WeeklyPillars[] = [pillarWeek('2026-05-25', 3, 3, 2.5, 3), pillarWeek('2026-06-01', 2.5, 3, 3, 3)];
    expect(analysePillars(pillars, '2026-06-01').notes).toHaveLength(0);
  });

  it('ignores the in-progress week (filters to upToWeekStart)', () => {
    const pillars: WeeklyPillars[] = [
      pillarWeek('2026-05-25', 3, 3, 3, 3),
      pillarWeek('2026-06-01', 3, 3, 3, 3),
      pillarWeek('2026-06-08', 1, 1, 1, 1), // current week — must be excluded
    ];
    expect(analysePillars(pillars, '2026-06-01').notes).toHaveLength(0);
  });

  it('a consistently-low pillar becomes the athlete concern even when total RAW looks fine', () => {
    const lowSleep: WeeklyPillars[] = [
      pillarWeek('2026-05-25', 1, 3, 3, 3),
      pillarWeek('2026-06-01', 1.5, 3, 3, 3),
    ];
    const d = athleteDebriefFromWeeks(inputs('Emilia', weeks, { pillars: lowSleep }));
    expect(d.flagged).toBe(true);
    expect(d.concern).toBe('sleep has been consistently low');
    expect(d.pillarNotes[0]).toMatchObject({ pillar: 'sleep', kind: 'consistently-low' });
  });
});

describe('composeBriefing', () => {
  it('rolls up the squad — count, total tonnage, mean RAW, flagged', () => {
    const a = athleteDebriefFromWeeks(inputs('A', weeks));
    const b = athleteDebriefFromWeeks(inputs('B', [week('2026-06-01', 'past', 5000, 5, [])]));
    const sq = composeBriefing({ date: '2026-06-09', athletes: [a, b] });
    expect(sq.squad.athleteCount).toBe(2);
    expect(sq.squad.tonnage).toBe(11000 + 5000);
    expect(sq.squad.flagged).toBe(1); // B has low RAW
    expect(sq.squad.avgRaw).toBeCloseTo((9 + 5) / 2, 5);
  });
});
