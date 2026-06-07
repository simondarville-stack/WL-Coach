import { describe, it, expect } from 'vitest';
import {
  buildFacts,
  analyzeFacts,
  resolveScopeWindow,
  validateAnalysisQuery,
  defaultRegistry,
  emptyQuery,
} from '../index';
import type { AnalysisQuery, AnalysisResult } from '../index';
import type { BuildFactsInput, MacroContext, RawExercise } from '../factFetch';

// ── fixture helpers ───────────────────────────────────────────────────────────

function ex(over: Partial<RawExercise> & { id: string; name: string }): RawExercise {
  return {
    category: 'Snatch',
    lift_slot: null,
    is_competition_lift: false,
    counts_towards_totals: true,
    default_unit: 'absolute_kg',
    pr_reference_exercise_id: null,
    ...over,
  };
}

const EX = {
  SN: ex({ id: 'EX_SN', name: 'Snatch', category: 'Snatch', lift_slot: 'snatch', is_competition_lift: true, default_unit: 'percentage' }),
  BSQ: ex({ id: 'EX_BSQ', name: 'Back Squat', category: 'Squat', lift_slot: 'back_squat', default_unit: 'absolute_kg' }),
  CJ: ex({ id: 'EX_CJ', name: 'Clean & Jerk', category: 'Clean & Jerk', lift_slot: 'clean_and_jerk', is_competition_lift: true, default_unit: 'percentage' }),
  ACC: ex({ id: 'EX_ACC', name: 'Bicep Curl', category: 'Accessory', counts_towards_totals: false, default_unit: 'absolute_kg' }),
};

const MACRO: MacroContext = {
  relativeWeek: 3,
  weekType: 'High',
  macroId: 'M1',
  macroName: 'Spring Prep',
  phaseId: 'P1',
  phaseName: 'Preparatory',
};

function baseInput(partial: Partial<BuildFactsInput> = {}): BuildFactsInput {
  return {
    athleteIds: ['A1'],
    hostOwnerByAthlete: { A1: 'O1' },
    athleteNameById: { A1: 'Athlete One' },
    groupIdsByAthlete: { A1: [] },
    exercisesById: { EX_SN: EX.SN, EX_BSQ: EX.BSQ, EX_CJ: EX.CJ, EX_ACC: EX.ACC },
    prBest: { A1: { EX_SN: 100, EX_BSQ: 200, EX_CJ: 120 } },
    weekPlans: [
      { id: 'WP1', week_start: '2026-06-01', athlete_id: 'A1', owner_id: 'O1', day_schedule: { 1: { weekday: 0, time: '16:00' }, 2: { weekday: 2, time: null } } },
    ],
    plannedExercises: [
      { id: 'PE1', weekplan_id: 'WP1', day_index: 1, exercise_id: 'EX_SN', unit: 'percentage', prescription_raw: '80%×3×3', summary_total_sets: 3, summary_total_reps: 9, summary_highest_load: 80, summary_avg_load: 80, is_combo: false },
      { id: 'PE2', weekplan_id: 'WP1', day_index: 1, exercise_id: 'EX_BSQ', unit: 'absolute_kg', prescription_raw: '150×5×2', summary_total_sets: 2, summary_total_reps: 10, summary_highest_load: 150, summary_avg_load: 150, is_combo: false },
      { id: 'PE3', weekplan_id: 'WP1', day_index: 2, exercise_id: 'EX_ACC', unit: 'absolute_kg', prescription_raw: '50×10×3', summary_total_sets: 3, summary_total_reps: 30, summary_highest_load: 50, summary_avg_load: 50, is_combo: false },
      { id: 'PE4', weekplan_id: 'WP1', day_index: 2, exercise_id: 'EX_CJ', unit: 'percentage', prescription_raw: '90%×2', summary_total_sets: 1, summary_total_reps: 2, summary_highest_load: 90, summary_avg_load: 90, is_combo: false },
    ],
    setLines: [
      { planned_exercise_id: 'PE1', sets: 3, reps: 3, load_value: 80, load_max: null },
      { planned_exercise_id: 'PE2', sets: 2, reps: 5, load_value: 150, load_max: null },
      { planned_exercise_id: 'PE3', sets: 3, reps: 10, load_value: 50, load_max: null },
      { planned_exercise_id: 'PE4', sets: 1, reps: 2, load_value: 90, load_max: null },
    ],
    comboMembers: [],
    // Sunday week_start (the legacy DST corruption) — must snap to 2026-06-01.
    sessions: [
      { id: 'S1', athlete_id: 'A1', owner_id: 'O1', date: '2026-06-03', week_start: '2026-05-31', day_index: 1, status: 'completed' },
    ],
    logExercises: [
      { id: 'LE1', session_id: 'S1', exercise_id: 'EX_SN', planned_exercise_id: 'PE1', performed_raw: '', status: 'completed' },
      { id: 'LE2', session_id: 'S1', exercise_id: 'EX_BSQ', planned_exercise_id: 'PE2', performed_raw: '', status: 'completed' },
      { id: 'LE4', session_id: 'S1', exercise_id: 'EX_CJ', planned_exercise_id: 'PE4', performed_raw: '', status: 'completed' },
    ],
    logSets: [
      { log_exercise_id: 'LE1', performed_load: 80, performed_reps: 3, status: 'completed' },
      { log_exercise_id: 'LE1', performed_load: 80, performed_reps: 3, status: 'completed' },
      { log_exercise_id: 'LE1', performed_load: 80, performed_reps: 3, status: 'completed' },
      { log_exercise_id: 'LE2', performed_load: 150, performed_reps: 5, status: 'completed' },
      { log_exercise_id: 'LE2', performed_load: 150, performed_reps: 5, status: 'completed' },
      { log_exercise_id: 'LE4', performed_load: 108, performed_reps: 2, status: 'completed' },
    ],
    macroContext: (_a, ws) => (ws === '2026-06-01' ? MACRO : { relativeWeek: null, weekType: null, macroId: null, macroName: null, phaseId: null, phaseName: null }),
    ...partial,
  };
}

function weekQuery(measures: AnalysisQuery['measures']): AnalysisQuery {
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

function rowFor(result: AnalysisResult, week: string) {
  return result.records.find((r) => r.row[0] === week);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('buildFacts', () => {
  it('builds one fact per planned set-line and one per performed set', () => {
    const facts = buildFacts(baseInput());
    const planned = facts.filter((f) => f.state === 'planned');
    const performed = facts.filter((f) => f.state === 'performed');
    // 4 planned exercises, one set-line each → 4 planned facts.
    expect(planned).toHaveLength(4);
    // 3+1+1+1 = 6 performed sets.
    expect(performed).toHaveLength(6);
  });

  it('resolves % loads to kg against the movement reference max', () => {
    const facts = buildFacts(baseInput());
    const sn = facts.find((f) => f.state === 'planned' && f.exerciseId === 'EX_SN')!;
    expect(sn.loadIsKg).toBe(true); // 80% of 100kg resolved
    expect(sn.load).toBe(80);
    expect(sn.tonnage).toBe(720); // 80kg × 9 reps
    expect(sn.pct1rm).toBe(80);
  });

  it('computes tonnage as Σ(load × reps) for kg set-lines', () => {
    const facts = buildFacts(baseInput());
    const bsq = facts.find((f) => f.state === 'planned' && f.exerciseId === 'EX_BSQ')!;
    expect(bsq.tonnage).toBe(1500); // 150 × (2×5)
    expect(bsq.pct1rm).toBeCloseTo(75, 5); // 150 / 200
  });

  it('snaps a Sunday session week_start forward to the Monday so it buckets with the plan', () => {
    const facts = buildFacts(baseInput());
    const performed = facts.filter((f) => f.state === 'performed');
    expect(performed.every((f) => f.weekStart === '2026-06-01')).toBe(true);
    // and a real calendar date + derived weekday survive (Wed = 2)
    expect(performed[0].date).toBe('2026-06-03');
    expect(performed[0].dayOfWeek).toBe(2);
  });

  it('derives planned dayOfWeek from day_schedule (Mon = 0), not from day_index', () => {
    const facts = buildFacts(baseInput());
    const sn = facts.find((f) => f.state === 'planned' && f.exerciseId === 'EX_SN')!;
    expect(sn.dayOfWeek).toBe(0);
    expect(sn.dayIndex).toBe(1);
  });

  it('carries the planned_exercise FK as the pair key (planned & performed)', () => {
    const facts = buildFacts(baseInput());
    expect(facts.find((f) => f.state === 'planned' && f.exerciseId === 'EX_SN')!.pairKey).toBe('PE1');
    expect(facts.find((f) => f.state === 'performed' && f.exerciseId === 'EX_SN')!.pairKey).toBe('PE1');
  });
});

describe('aggregate — volume / state / counts_towards_totals', () => {
  it('sums planned & performed tonnage, excluding non-counting accessories', () => {
    const facts = buildFacts(baseInput());
    const result = analyzeFacts(facts, weekQuery([{ metricId: 'volume', agg: 'sum', state: 'both' }]));
    const row = rowFor(result, '2026-06-01')!;
    // 720 (snatch) + 1500 (squat) + 216 (C&J 90% of 120 = 108 × 2) = 2436; accessory excluded
    expect(row.values['volume::planned']).toBe(2436);
    expect(row.values['volume::performed']).toBe(2436);
  });

  it('computes delta and adherence by comparison (full compliance → 0 / 100%)', () => {
    const facts = buildFacts(baseInput());
    const result = analyzeFacts(facts, weekQuery([
      { metricId: 'volume', agg: 'sum', state: 'delta' },
      { metricId: 'volume', agg: 'sum', state: 'adherence' },
    ]));
    const row = rowFor(result, '2026-06-01')!;
    expect(row.values['volume::delta']).toBe(0);
    expect(row.values['volume::adherence']).toBeCloseTo(100, 5);
  });

  it('reflects partial adherence when a prescribed exercise is not performed', () => {
    const input = baseInput();
    // Drop the performed C&J → performed 2220 vs planned 2436.
    input.logExercises = input.logExercises.filter((le) => le.id !== 'LE4');
    input.logSets = input.logSets.filter((ls) => ls.log_exercise_id !== 'LE4');
    const facts = buildFacts(input);
    const result = analyzeFacts(facts, weekQuery([
      { metricId: 'volume', agg: 'sum', state: 'adherence' },
      { metricId: 'volume', agg: 'sum', state: 'delta' },
    ]));
    const row = rowFor(result, '2026-06-01')!;
    expect(row.values['volume::adherence']).toBeCloseTo((2220 / 2436) * 100, 4);
    expect(row.values['volume::delta']).toBe(-216);
  });

  it('reps / sets / nl exclude non-counting exercises', () => {
    const facts = buildFacts(baseInput());
    const result = analyzeFacts(facts, weekQuery([
      { metricId: 'reps', agg: 'sum', state: 'planned' },
      { metricId: 'sets', agg: 'sum', state: 'planned' },
      { metricId: 'nl', agg: 'sum', state: 'planned' },
    ]));
    const row = rowFor(result, '2026-06-01')!;
    expect(row.values['reps::planned']).toBe(21); // 9 + 10 + 2 (accessory 30 excluded)
    expect(row.values['sets::planned']).toBe(6); // 3 + 2 + 1
    expect(row.values['nl::planned']).toBe(21); // all counting rows are classic lifts/variants
  });

  it('avgPct1RM is rep-weighted, maxLoad is the kg ceiling', () => {
    const facts = buildFacts(baseInput());
    const result = analyzeFacts(facts, weekQuery([
      { metricId: 'avgPct1RM', agg: 'avg', state: 'planned' },
      { metricId: 'maxLoad', agg: 'max', state: 'planned' },
    ]));
    const row = rowFor(result, '2026-06-01')!;
    // (80×9 + 75×10 + 90×2) / 21 = 1650/21
    expect(row.values['avgPct1RM::planned']).toBeCloseTo(1650 / 21, 4);
    expect(row.values['maxLoad::planned']).toBe(150);
  });
});

describe('aggregate — pivots & dimensions', () => {
  it('groups by category', () => {
    const facts = buildFacts(baseInput());
    const q = weekQuery([{ metricId: 'volume', agg: 'sum', state: 'planned' }]);
    q.rows = ['category'];
    const result = analyzeFacts(facts, q);
    const byCat = Object.fromEntries(result.records.map((r) => [r.row[0], r.values['volume::planned']]));
    expect(byCat['Snatch']).toBe(720);
    expect(byCat['Squat']).toBe(1500);
    expect(byCat['Clean & Jerk']).toBe(216);
    expect(byCat['Accessory']).toBeUndefined(); // excluded entirely from a tonnage pivot
  });

  it('exposes macro/relative-week context as dimensions', () => {
    const facts = buildFacts(baseInput());
    const q = weekQuery([{ metricId: 'volume', agg: 'sum', state: 'planned' }]);
    q.rows = ['relativeWeek'];
    const result = analyzeFacts(facts, q);
    expect(result.records[0].row[0]).toBe('W3');
  });
});

describe('aggregate — unresolved percentages', () => {
  it('excludes % loads with no reference max from tonnage and flags them', () => {
    const input = baseInput();
    input.prBest = { A1: {} }; // no PRs → snatch/C&J % cannot resolve
    const facts = buildFacts(input);
    const result = analyzeFacts(facts, weekQuery([{ metricId: 'volume', agg: 'sum', state: 'planned' }]));
    const row = rowFor(result, '2026-06-01')!;
    expect(row.values['volume::planned']).toBe(1500); // only the kg back squat
    expect(result.meta.unresolvedPctFacts).toBeGreaterThan(0);
    expect(result.meta.notes.join(' ')).toMatch(/percentage/i);
  });
});

describe('aggregate — combos', () => {
  it('expands a combo into one contribution per member', () => {
    const input = baseInput({
      weekPlans: [{ id: 'WP1', week_start: '2026-06-01', athlete_id: 'A1', owner_id: 'O1', day_schedule: null }],
      plannedExercises: [
        { id: 'PEC', weekplan_id: 'WP1', day_index: 1, exercise_id: 'EX_SN', unit: 'absolute_kg', prescription_raw: '80×1+1×3', summary_total_sets: 3, summary_total_reps: 6, summary_highest_load: 80, summary_avg_load: 80, is_combo: true },
      ],
      setLines: [],
      comboMembers: [
        { planned_exercise_id: 'PEC', exercise_id: 'EX_SN', position: 0 },
        { planned_exercise_id: 'PEC', exercise_id: 'EX_CJ', position: 1 },
      ],
      sessions: [],
      logExercises: [],
      logSets: [],
    });
    const facts = buildFacts(input).filter((f) => f.state === 'planned');
    expect(facts).toHaveLength(2);
    const sn = facts.find((f) => f.exerciseId === 'EX_SN')!;
    const cj = facts.find((f) => f.exerciseId === 'EX_CJ')!;
    expect(sn.reps).toBe(3); // 1 rep × 3 rounds
    expect(cj.reps).toBe(3);
    expect(sn.tonnage).toBe(240); // 80kg × 3
  });
});

describe('scopeResolver', () => {
  it('resolves a rolling window from an anchor', () => {
    expect(resolveScopeWindow({ mode: 'rolling', windowDays: 28, anchor: '2026-06-30' })).toEqual({
      from: '2026-06-03',
      to: '2026-06-30',
      mode: 'rolling',
    });
  });
  it('resolves a date range and normalises reversed bounds', () => {
    expect(resolveScopeWindow({ mode: 'dateRange', from: '2026-06-10', to: '2026-06-01' })).toEqual({
      from: '2026-06-01',
      to: '2026-06-10',
      mode: 'dateRange',
    });
  });
  it('resolves a macro window from the supplied macrocycle', () => {
    expect(
      resolveScopeWindow({ mode: 'macro', macroId: 'M1' }, { macro: { start_date: '2026-01-05', end_date: '2026-03-29' } }),
    ).toEqual({ from: '2026-01-05', to: '2026-03-29', mode: 'macro' });
  });
});

describe('validateAnalysisQuery', () => {
  it('drops measures with unknown metric ids and repairs viz.yAxis', () => {
    const q = emptyQuery();
    q.measures = [{ metricId: 'volume', agg: 'sum', state: 'both' }, { metricId: 'nope', agg: 'sum', state: 'planned' }];
    q.viz = { type: 'line', yAxis: 'nope' };
    const { query, warnings, valid } = validateAnalysisQuery(q, defaultRegistry);
    expect(query.measures).toHaveLength(1);
    expect(query.measures[0].metricId).toBe('volume');
    expect(query.viz.yAxis).toBe('volume');
    expect(valid).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it('defaults rolling windowDays when invalid', () => {
    const q = emptyQuery();
    q.scope = { mode: 'rolling', windowDays: 0 };
    const { query } = validateAnalysisQuery(q, defaultRegistry);
    expect(query.scope).toMatchObject({ mode: 'rolling', windowDays: 28 });
  });
});

describe('metric registry — derived movement-scoped ratio', () => {
  it('computes snatch/C&J max ratio from movement-filtered maxes', () => {
    const facts = buildFacts(baseInput());
    const q = weekQuery([{ metricId: 'snatchCleanRatio', agg: 'ratio', state: 'planned' }]);
    q.rows = [];
    const result = analyzeFacts(facts, q);
    // snatch planned max 80kg, C&J planned max 108kg → 80/108*100
    expect(result.records[0].values['snatchCleanRatio::planned']).toBeCloseTo((80 / 108) * 100, 3);
  });
});
