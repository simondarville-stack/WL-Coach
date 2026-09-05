/**
 * Coach comments as Analysis facts, joined through the tags on the message
 * row. One fact per (comment, exercise it names); a comment naming no
 * exercise files under "(session)". A comment fact carries no work — the
 * training measures beside it stay what the sets made them.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildFacts,
  type BuildFactsInput,
  type RawCoachComment,
  type RawExercise,
} from '../factFetch';
import { COACH_COMMENTS_METRIC_ID, createRegistry } from '../metricRegistry';
import { analyzeFacts } from '../runAnalysisQuery';
import type { AnalysisQuery } from '../types';

vi.mock('../../supabase', () => ({ supabase: {} }));

const SNATCH: RawExercise = {
  id: 'EX_SN',
  name: 'Snatch',
  category: 'Snatch',
  color: null,
  lift_slot: 'snatch',
  is_competition_lift: true,
  counts_towards_totals: true,
  default_unit: 'percentage',
  pr_reference_exercise_id: null,
  parent_exercise_id: null,
};
const SQUAT: RawExercise = { ...SNATCH, id: 'EX_SQ', name: 'Back Squat', category: 'Squat', lift_slot: null, is_competition_lift: false };

function input(coachComments: RawCoachComment[]): BuildFactsInput {
  return {
    athleteIds: ['A1'],
    hostOwnerByAthlete: { A1: 'O1' },
    athleteNameById: { A1: 'Athlete One' },
    groupIdsByAthlete: { A1: [] },
    exercisesById: { EX_SN: SNATCH, EX_SQ: SQUAT },
    prBest: {},
    weekPlans: [],
    plannedExercises: [],
    setLines: [],
    comboMembers: [],
    sessions: [
      {
        id: 'S1',
        athlete_id: 'A1',
        owner_id: 'O1',
        date: '2026-06-02',
        week_start: '2026-06-01',
        day_index: 2,
        status: 'completed',
        bodyweight_kg: null,
      },
    ],
    logExercises: [
      { id: 'LE1', session_id: 'S1', exercise_id: 'EX_SN', planned_exercise_id: null, performed_raw: '', status: 'completed' },
      // Skipped: the performed stream drops it, but a comment about it is still feedback.
      { id: 'LE2', session_id: 'S1', exercise_id: 'EX_SQ', planned_exercise_id: null, performed_raw: '', status: 'skipped' },
    ],
    logSets: [{ log_exercise_id: 'LE1', performed_load: 80, performed_reps: 3, status: 'completed' }],
    macroContext: () => ({
      relativeWeek: null,
      weekType: null,
      macroId: null,
      macroName: null,
      phaseId: null,
      phaseName: null,
    }),
    coachComments,
  };
}

const comments: RawCoachComment[] = [
  // Tagged to the snatch.
  { id: 'm1', session_id: 'S1', exercise_id: null, tags: [{ kind: 'exercise', logExerciseId: 'LE1', label: 'Snatch' }] },
  // A set tag, the whole exercise again, and a metric: one fact for the snatch.
  {
    id: 'm2',
    session_id: 'S1',
    exercise_id: null,
    tags: [
      { kind: 'exercise', logExerciseId: 'LE1', label: 'Snatch', setNumber: 3 },
      { kind: 'exercise', logExerciseId: 'LE1', label: 'Snatch' },
      { kind: 'metric', key: 'bw', label: 'BW', value: null },
    ],
  },
  // Legacy per-exercise scope, no tags column yet.
  { id: 'm3', session_id: 'S1', exercise_id: 'LE2', tags: null },
  // About the session's bodyweight, not an exercise.
  { id: 'm4', session_id: 'S1', exercise_id: null, tags: [{ kind: 'metric', key: 'bw', label: 'BW', value: '82,5 kg' }] },
  // Plain session comment.
  { id: 'm5', session_id: 'S1', exercise_id: null, tags: [] },
  // A session outside the window / unknown: dropped.
  { id: 'm6', session_id: 'S9', exercise_id: null, tags: [] },
  // A general (no-session) message never reaches here, but is harmless.
  { id: 'm7', session_id: null, exercise_id: null, tags: [] },
];

function query(rows: AnalysisQuery['rows'], measures: AnalysisQuery['measures']): AnalysisQuery {
  return {
    version: 1,
    scope: { mode: 'dateRange', from: '2026-06-01', to: '2026-06-07' },
    subjects: { athletes: ['A1'], groups: [], normalization: 'none' },
    filters: [],
    rows,
    cols: [],
    measures,
    viz: { type: 'table' },
  };
}

const registry = createRegistry();

describe('buildFacts — coach comments stream', () => {
  const facts = buildFacts(input(comments));
  const commentFacts = facts.filter(f => f.coachComments === 1);

  it('makes one fact per comment and exercise it names, session-level ones under (session)', () => {
    expect(commentFacts.map(f => f.exerciseName).sort()).toEqual(
      ['(session)', '(session)', 'Back Squat', 'Snatch', 'Snatch'].sort(),
    );
    const snatch = commentFacts.filter(f => f.exerciseName === 'Snatch');
    expect(snatch.every(f => f.exerciseId === 'EX_SN' && f.movement === 'snatch')).toBe(true);
    expect(snatch.every(f => f.date === '2026-06-02' && f.weekStart === '2026-06-01' && f.dayIndex === 2)).toBe(true);
    const session = commentFacts.filter(f => f.exerciseName === '(session)');
    expect(session.every(f => f.exerciseId === null && f.familyRootName === '(session)')).toBe(true);
  });

  it('counts nothing towards training totals', () => {
    for (const f of commentFacts) {
      expect(f.countsTowardsTotals).toBe(false);
      expect(f.sets).toBe(0);
      expect(f.reps).toBe(0);
      expect(f.tonnage).toBe(0);
      expect(f.loadIsKg).toBe(false);
    }
    // The performed set is still there, untouched.
    const work = facts.filter(f => f.coachComments == null);
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ exerciseName: 'Snatch', reps: 3, tonnage: 240 });
  });

  it('is absent when no comments are supplied', () => {
    const facts = buildFacts({ ...input([]), coachComments: undefined });
    expect(facts.filter(f => f.coachComments != null)).toHaveLength(0);
  });
});

describe('coachComments measure', () => {
  it('sums per exercise beside the training measures without touching them', () => {
    const result = analyzeFacts(
      buildFacts(input(comments)),
      query(
        ['exercise'],
        [
          { metricId: COACH_COMMENTS_METRIC_ID, agg: 'sum', state: 'performed' },
          { metricId: 'volume', agg: 'sum', state: 'performed' },
          { metricId: 'reps', agg: 'sum', state: 'performed' },
        ],
      ),
      { registry },
    );
    const byRow = new Map(result.records.map(r => [r.row[0], r.values]));
    expect(byRow.get('Snatch')).toMatchObject({
      'coachComments::performed': 2,
      'volume::performed': 240,
      'reps::performed': 3,
    });
    expect(byRow.get('Back Squat')).toMatchObject({
      'coachComments::performed': 1,
      'volume::performed': null,
      'reps::performed': null,
    });
    expect(byRow.get('(session)')).toMatchObject({
      'coachComments::performed': 2,
      'volume::performed': null,
    });
  });

  it('has no planned facet', () => {
    const def = registry.get(COACH_COMMENTS_METRIC_ID);
    expect(def?.appliesToState).toEqual(['performed']);
    expect(def?.defaultAgg).toBe('sum');
  });
});
