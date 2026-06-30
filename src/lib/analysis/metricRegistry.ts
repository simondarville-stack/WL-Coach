// EMOS Analysis — Metric Registry.
//
// The single source of truth for everything aggregatable (invariant #2). Base
// metrics extract a (value, weight) contribution from a fact row; derived
// metrics compose already-aggregated base values (optionally movement-scoped).
// This is intended to subsume src/lib/metrics.ts so the planner summary and the
// analysis engine count the same way — no parallel vocabularies.
//
// OWL-correctness decisions baked in (REVIEW_PLAN_analysis_module.md, Domain):
//  • Tonnage = Σ(load × reps) per contribution, in kg only. Percentage loads
//    are NOT mixed into tonnage/maxLoad/avgLoad — they are excluded and counted
//    as `unresolvedPctFacts` so the coach sees the gap instead of a wrong sum.
//  • avgLoad is rep-weighted: Σ(load × reps) / Σreps (ARI convention), one
//    definition only — the set-weighted variant is intentionally not offered.
//  • avgPct1RM is movement-specific: the engine resolves % against the
//    movement's own reference max; this metric just rep-weights the result.
//  • NL (number of lifts) counts reps of competition lifts and their close
//    variants (identified by lift_slot). T-10: a coach may later want a
//    dedicated "counts as NL" flag distinct from `counts_towards_totals`.
//  • The "totals" metrics (reps/sets/volume/avgLoad/maxLoad) honour
//    `counts_towards_totals`, matching the existing planner summary.

import type {
  BaseMetricDef,
  DerivedMetricDef,
  FactRow,
  MetricDef,
  MetricRegistry,
} from './types';

/** True when this contribution should count toward the coach's training totals. */
function counts(row: FactRow): boolean {
  return row.countsTowardsTotals;
}

/** True when the load is a usable kilogram value (not a % / RPE / free text). */
function kg(row: FactRow): boolean {
  return row.loadIsKg && row.load > 0;
}

/** Competition lifts and their close variants (snatch/C&J/pull families). */
function isNlLift(row: FactRow): boolean {
  return row.isCompetitionLift || row.movement != null;
}

export const BASE_METRICS: BaseMetricDef[] = [
  {
    id: 'reps',
    label: 'Reps',
    shortLabel: 'R',
    unit: 'reps',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'sum',
    combine: 'sum',
    isBuiltin: true,
    description: 'Total repetitions (counting exercises only).',
    extract: (r) => (counts(r) && r.reps > 0 ? { value: r.reps, weight: 0 } : null),
  },
  {
    id: 'sets',
    label: 'Sets',
    shortLabel: 'S',
    unit: 'sets',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'sum',
    combine: 'sum',
    isBuiltin: true,
    description: 'Total sets (counting exercises only).',
    extract: (r) => (counts(r) && r.sets > 0 ? { value: r.sets, weight: 0 } : null),
  },
  {
    id: 'nl',
    label: 'Number of lifts',
    shortLabel: 'NL',
    unit: 'reps',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'sum',
    combine: 'sum',
    isBuiltin: true,
    description: 'Reps performed on the classic lifts and their variations.',
    extract: (r) => (counts(r) && isNlLift(r) && r.reps > 0 ? { value: r.reps, weight: 0 } : null),
  },
  {
    id: 'volume',
    label: 'Tonnage',
    shortLabel: 'T',
    unit: 'kg',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'sum',
    combine: 'sum',
    isBuiltin: true,
    description: 'Total volume Σ(load × reps), kg loads only.',
    // Percentage / free-text loads contribute nothing here and are tracked as
    // unresolvedPctFacts by the aggregator (never mixed into a kg sum).
    extract: (r) => (counts(r) && kg(r) && r.tonnage > 0 ? { value: r.tonnage, weight: 0 } : null),
  },
  {
    id: 'maxLoad',
    label: 'Max load',
    shortLabel: 'Max',
    unit: 'kg',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'max',
    combine: 'max',
    isBuiltin: true,
    description: 'Highest kilogram load used.',
    extract: (r) => (counts(r) && kg(r) && r.maxLoad > 0 ? { value: r.maxLoad, weight: 0 } : null),
  },
  {
    id: 'avgLoad',
    label: 'Avg load',
    shortLabel: 'Avg',
    unit: 'kg',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'avg',
    combine: 'weightedAvg',
    isBuiltin: true,
    description: 'Rep-weighted average load Σ(load × reps) / Σreps, kg only.',
    extract: (r) =>
      counts(r) && kg(r) && r.reps > 0 ? { value: r.tonnage, weight: r.reps } : null,
  },
  {
    id: 'avgPct1RM',
    label: 'Avg %1RM',
    shortLabel: '%1RM',
    unit: '%',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'avg',
    combine: 'weightedAvg',
    isBuiltin: true,
    description: 'Rep-weighted average intensity vs the movement’s reference max.',
    extract: (r) =>
      counts(r) && r.pct1rm != null && r.reps > 0
        ? { value: r.pct1rm * r.reps, weight: r.reps }
        : null,
  },
  {
    id: 'bodyweight',
    label: 'Bodyweight',
    shortLabel: 'BW',
    // Distinct unit (not the shared 'kg', which rounds to whole numbers for
    // loads) so bodyweight formats to 0.1 kg — weekly drift is often sub-kg —
    // and, as a bonus, gets its own chart axis instead of sharing the kg axis.
    unit: 'bwkg',
    kind: 'base',
    // Performed only — bodyweight is a logged measurement, not a prescription.
    // computeMeasureValues yields null for the planned facet, so selecting it
    // with state 'both'/'planned' is harmless (no crash, just no value).
    appliesToState: ['performed'],
    defaultAgg: 'avg',
    combine: 'weightedAvg',
    isBuiltin: true,
    description: 'Average logged bodyweight (kg) over the period — performed sessions only.',
    // weight 0 ⇒ reduceBase('avg') falls back to a plain mean of the per-fact
    // (i.e. per-session, repeated across its sets) bodyweight. Exact for a single
    // day; a set-weighted mean of the daily weigh-ins for a multi-day week.
    extract: (r) => (r.bodyweight != null && r.bodyweight > 0 ? { value: r.bodyweight, weight: 0 } : null),
  },
  {
    id: 'stress',
    label: 'Stress (AU)',
    shortLabel: 'AU',
    unit: 'AU',
    kind: 'base',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'sum',
    combine: 'sum',
    isBuiltin: true,
    description:
      'Sport-specific training stress. Model deferred (backlog #2) — registered as a slot only.',
    // Deferred: no agreed stress model yet (REVIEW_PLAN D-07). Contributes
    // nothing until the model is defined, so it is selectable but always 0/—.
    extract: () => null,
  },
];

/** Demonstration derived metrics (movement-scoped) — coaches add their own. */
export const DERIVED_METRICS: DerivedMetricDef[] = [
  {
    id: 'snatchCleanRatio',
    label: 'Snatch / C&J',
    shortLabel: 'Sn/CJ',
    unit: '%',
    kind: 'derived',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'ratio',
    isBuiltin: true,
    description: 'Snatch max as a percentage of clean & jerk max.',
    inputs: [
      { alias: 'sn', metricId: 'maxLoad', where: (r) => r.movement === 'snatch' },
      { alias: 'cj', metricId: 'maxLoad', where: (r) => r.movement === 'clean_and_jerk' },
    ],
    formula: ({ sn, cj }) => (sn && cj ? (sn / cj) * 100 : null),
  },
  {
    id: 'pullPctOfTotal',
    label: 'Pull % of volume',
    shortLabel: 'Pull%',
    unit: '%',
    kind: 'derived',
    appliesToState: ['planned', 'performed'],
    defaultAgg: 'ratio',
    isBuiltin: true,
    description: 'Share of total tonnage coming from snatch/clean pulls.',
    inputs: [
      {
        alias: 'pull',
        metricId: 'volume',
        where: (r) => r.movement === 'snatch_pull' || r.movement === 'clean_pull',
      },
      { alias: 'all', metricId: 'volume' },
    ],
    formula: ({ pull, all }) => (all ? ((pull ?? 0) / all) * 100 : null),
  },
];

/**
 * Build a registry from the built-in seed plus any coach-defined metrics.
 * For Phases 0–2 the coach metrics are code/localStorage-seeded; the gated
 * `analysis_metrics` table (DC-02) is a later, sign-off-required swap that
 * keeps this same interface.
 */
export function createRegistry(coachMetrics: MetricDef[] = []): MetricRegistry {
  const map = new Map<string, MetricDef>();
  for (const m of [...BASE_METRICS, ...DERIVED_METRICS]) map.set(m.id, m);
  // Coach metrics override built-ins of the same id (coach-flexibility).
  for (const m of coachMetrics) map.set(m.id, m);
  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    list: () => [...map.values()],
  };
}

/** The default registry (built-ins only). */
export const defaultRegistry: MetricRegistry = createRegistry();

export const DEFAULT_VISIBLE_METRIC_IDS = ['reps', 'sets', 'maxLoad', 'volume'];
