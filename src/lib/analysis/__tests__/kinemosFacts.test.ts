/**
 * KinEMOS analyses as Analysis facts (design §13 Q3).
 *
 * The contract has two halves and both are tested here: a KinEMOS rep must
 * contribute NOTHING to the training metrics — it is the same set the log
 * already counted, seen on video — and everything to its own measures, which
 * aggregate the way each metric's own sense of "up" says.
 */
import { describe, expect, it, vi } from 'vitest';
import type { KinemosLiftRecord } from '../../../kinemos/lib/analysisAdapter';
import { kinemosAnalysisMetrics } from '../../../kinemos/lib/analysisMetrics';
import { buildFacts, type BuildFactsInput, type RawExercise } from '../factFetch';
import { createRegistry } from '../metricRegistry';
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

function rep(over: Partial<KinemosLiftRecord> & { analysisId: string }): KinemosLiftRecord {
  return {
    clipKey: `direct:${over.analysisId}`,
    sourceKind: 'direct',
    sourceId: over.analysisId,
    repIndex: 1,
    label: null,
    athleteId: 'A1',
    athleteName: 'Athlete One',
    exerciseName: 'Snatch',
    date: '2026-06-02',
    loadKg: 90,
    massKg: 90,
    massSource: 'logged',
    grade: 'A',
    gradeErrorMs: 0.03,
    phaseSetId: 'default',
    isReference: false,
    isModel: false,
    modelLabel: null,
    schema: 1,
    analysedAt: '2026-06-02T10:00:00Z',
    values: { peakVelocity: 1.7, transitionLoss: 0.12, loopWidth: 6 },
    ...over,
  };
}

function input(kinemos: KinemosLiftRecord[]): BuildFactsInput {
  return {
    athleteIds: ['A1'],
    hostOwnerByAthlete: { A1: 'O1' },
    athleteNameById: { A1: 'Athlete One' },
    groupIdsByAthlete: { A1: [] },
    exercisesById: { EX_SN: SNATCH },
    prBest: {},
    weekPlans: [],
    plannedExercises: [],
    setLines: [],
    comboMembers: [],
    sessions: [],
    logExercises: [],
    logSets: [],
    macroContext: () => ({
      relativeWeek: null,
      weekType: null,
      macroId: null,
      macroName: null,
      phaseId: null,
      phaseName: null,
    }),
    kinemos,
  };
}

function query(measures: AnalysisQuery['measures']): AnalysisQuery {
  return {
    version: 1,
    scope: { mode: 'dateRange', from: '2026-06-01', to: '2026-06-07' },
    subjects: { athletes: ['A1'], groups: [], normalization: 'none' },
    filters: [],
    rows: ['week'],
    cols: [],
    measures,
    viz: { type: 'table' },
  };
}

const registry = createRegistry(kinemosAnalysisMetrics());

describe('buildFacts — KinEMOS stream', () => {
  it('files a rep under its catalogue exercise, dated, with its values under custom', () => {
    const facts = buildFacts(input([rep({ analysisId: 'r1' })]));
    expect(facts).toHaveLength(1);
    const f = facts[0];
    expect(f.state).toBe('performed');
    expect(f.exerciseId).toBe('EX_SN');
    expect(f.familyRootId).toBe('EX_SN');
    expect(f.movement).toBe('snatch');
    expect(f.date).toBe('2026-06-02');
    expect(f.weekStart).toBe('2026-06-01');
    expect(f.dayOfWeek).toBe(1);
    expect(f.custom).toMatchObject({
      'kinemos:peakVelocity': 1.7,
      'kinemos:transitionLoss': 0.12,
      'kinemos:loopWidth': 6,
      'kinemos:reps': 1,
      'kinemos:velocityError': 0.03,
    });
  });

  it('counts nothing towards training totals', () => {
    const facts = buildFacts(input([rep({ analysisId: 'r1' })]));
    const f = facts[0];
    expect(f.countsTowardsTotals).toBe(false);
    expect(f.sets).toBe(0);
    expect(f.reps).toBe(0);
    expect(f.tonnage).toBe(0);
    expect(f.loadIsKg).toBe(false);

    // The KinEMOS count proves the fact is in the cell; the training
    // measures beside it stay empty.
    const result = analyzeFacts(
      facts,
      query([
        { metricId: 'kinemos:reps', agg: 'sum', state: 'performed' },
        { metricId: 'volume', agg: 'sum', state: 'performed' },
        { metricId: 'reps', agg: 'sum', state: 'performed' },
        { metricId: 'maxLoad', agg: 'max', state: 'performed' },
      ]),
      { registry },
    );
    expect(result.records).toHaveLength(1);
    const row = result.records[0];
    expect(row.values['kinemos:reps::performed']).toBe(1);
    expect(row.values['volume::performed']).toBeNull();
    expect(row.values['reps::performed']).toBeNull();
    expect(row.values['maxLoad::performed']).toBeNull();
  });

  it('keeps a rep whose exercise is not in the catalogue, under its own name', () => {
    const facts = buildFacts(input([rep({ analysisId: 'r1', exerciseName: 'Muscle snatch' })]));
    expect(facts[0].exerciseId).toBeNull();
    expect(facts[0].exerciseName).toBe('Muscle snatch');
    expect(facts[0].familyRootName).toBe('Muscle snatch');
  });

  it('drops a rep with no athlete, no date, or an athlete out of scope', () => {
    const facts = buildFacts(
      input([
        rep({ analysisId: 'no-athlete', athleteId: null }),
        rep({ analysisId: 'no-date', date: null }),
        rep({ analysisId: 'other', athleteId: 'A2' }),
      ]),
    );
    expect(facts).toHaveLength(0);
  });

  it('leaves a null value out of custom rather than writing a zero', () => {
    const facts = buildFacts(input([rep({ analysisId: 'r1', values: { peakVelocity: null } })]));
    expect('kinemos:peakVelocity' in facts[0].custom!).toBe(false);
    expect(facts[0].custom!['kinemos:reps']).toBe(1);
  });
});

describe('KinEMOS measures', () => {
  const facts = buildFacts(
    input([
      rep({ analysisId: 'r1', values: { peakVelocity: 1.7, transitionLoss: 0.12, loopWidth: 6 }, gradeErrorMs: 0.03 }),
      rep({ analysisId: 'r2', values: { peakVelocity: 1.9, transitionLoss: 0.08, loopWidth: 8 }, gradeErrorMs: 0.05 }),
    ]),
  );

  it('offers one measure per catalogue metric plus the count and the error', () => {
    const ids = kinemosAnalysisMetrics().map(m => m.id);
    expect(ids).toContain('kinemos:peakVelocity');
    expect(ids).toContain('kinemos:secondPull');
    expect(ids).toContain('kinemos:reps');
    expect(ids).toContain('kinemos:velocityError');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('aggregates the way each metric says up is', () => {
    const result = analyzeFacts(
      facts,
      query([
        // higher is better → best rep
        { metricId: 'kinemos:peakVelocity', agg: 'max', state: 'performed' },
        // lower is better → least
        { metricId: 'kinemos:transitionLoss', agg: 'min', state: 'performed' },
        // no direction → mean
        { metricId: 'kinemos:loopWidth', agg: 'avg', state: 'performed' },
        { metricId: 'kinemos:reps', agg: 'sum', state: 'performed' },
        { metricId: 'kinemos:velocityError', agg: 'avg', state: 'performed' },
      ]),
      { registry },
    );
    const row = result.records[0];
    expect(row.values['kinemos:peakVelocity::performed']).toBe(1.9);
    expect(row.values['kinemos:transitionLoss::performed']).toBe(0.08);
    expect(row.values['kinemos:loopWidth::performed']).toBe(7);
    expect(row.values['kinemos:reps::performed']).toBe(2);
    expect(row.values['kinemos:velocityError::performed']).toBeCloseTo(0.04, 6);
  });

  it('defaults to those aggregations without being told', () => {
    const byId = new Map(kinemosAnalysisMetrics().map(m => [m.id, m]));
    expect(byId.get('kinemos:peakVelocity')!.defaultAgg).toBe('max');
    expect(byId.get('kinemos:transitionLoss')!.defaultAgg).toBe('min');
    expect(byId.get('kinemos:loopWidth')!.defaultAgg).toBe('avg');
  });
});
