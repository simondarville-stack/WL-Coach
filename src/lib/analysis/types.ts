// EMOS Analysis engine — core types.
//
// The single source of truth for the module: a pivot table, a chart, and a
// saved view are all renderings of one serializable `AnalysisQuery`. The React
// client never aggregates raw rows — it consumes an `AnalysisResult` produced by
// `runAnalysisQuery(config)`. See REVIEW_PLAN_analysis_module.md (Phase 0).

export type ISODate = string; // 'YYYY-MM-DD'

/**
 * A query/grouping dimension.
 *
 * Note: `category` is the coach's own free-text exercise category — EMOS has no
 * fixed "K1–K10" taxonomy (REVIEW_PLAN tension T-01). `movement` maps to
 * `exercises.lift_slot`. `custom:<id>` addresses an athlete day-card metric
 * (`athlete_metric_definitions.id`).
 */
export type Dimension =
  | 'athlete'
  | 'group'
  | 'exercise'
  | 'category'
  | 'movement'
  | 'weekType'
  | 'intensityZone'
  | 'day'
  | 'date'
  | 'week'
  | 'macro'
  | 'meso'
  | 'dayOfWeek'
  | 'relativeWeek'
  | `custom:${string}`;

/** Planned/performed duality is a first-class query axis (invariant #1). */
export type MeasureState = 'planned' | 'performed' | 'both' | 'delta' | 'adherence';

export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct' | 'ratio';

/**
 * A pivot axis is a dimension OR the literal `'state'` (the planned/performed
 * split). Allowed on both `rows` and `cols` for symmetry (T-05). A `'state'`
 * pivot axis expands each measure across its `planned`/`performed` facets.
 */
export type PivotAxis = Dimension | 'state';

export type Normalization = 'none' | 'perAthleteMean' | 'sinclair' | 'perBodyweight';

export type Scope =
  | { mode: 'dateRange'; from: ISODate; to: ISODate }
  | { mode: 'macro'; macroId: string }
  | { mode: 'rolling'; windowDays: number; anchor?: ISODate };

/**
 * Discriminated filter union (T-06) — arity-safe, no `unknown[]`. `op` is the
 * discriminant so each variant carries exactly the operands it needs.
 */
export type Filter =
  | { dimension: Dimension; op: 'in'; values: string[] }
  | { dimension: Dimension; op: 'eq'; value: string | number }
  | { dimension: Dimension; op: 'between'; min: number; max: number };

export interface Measure {
  /** Resolved against the Metric Registry. */
  metricId: string;
  agg: Agg;
  state: MeasureState;
}

export type VizType =
  | 'table'
  | 'line'
  | 'bar'
  | 'stackedBar'
  | 'groupedBar'
  | 'scatter'
  | 'heatmap'
  | 'radar';

export type Overlay =
  | { mode: 'none' }
  | { mode: 'periodOverPeriod'; comparePeriod: Scope };

export interface Viz {
  type: VizType;
  xAxis?: Dimension;
  series?: PivotAxis;
  /** metricId for the value axis. */
  yAxis?: string;
  overlay?: Overlay;
}

/**
 * The serializable query. `version` makes the persisted shape (a saved view)
 * migratable from day one (Phase 4 ships persistence; the field ships now).
 */
export interface AnalysisQuery {
  version: number;
  scope: Scope;
  subjects: {
    athletes: string[];
    groups: string[];
    normalization: Normalization;
  };
  filters: Filter[];
  rows: PivotAxis[];
  cols: PivotAxis[];
  measures: Measure[];
  viz: Viz;
}

export const ANALYSIS_QUERY_VERSION = 1;

// ── Fact set ────────────────────────────────────────────────────────────────
// `factFetch` builds a long-format `FactRow[]` from the planned tables and the
// performed (`training_log_*`) tables, NEVER conflating them (invariant #1).
// Each row is one counted contribution: a planned set-line (or expanded combo
// member) for `state:'planned'`, or a performed set (or legacy raw summary) for
// `state:'performed'`. Quantities are pre-resolved to the primitives the metric
// registry needs; loads are flagged kg/percent so tonnage never sums across
// incompatible units (T-02).

export interface FactRow {
  state: 'planned' | 'performed';

  // ── subject / ownership ──
  ownerId: string; // host owner (athletes.owner_id), for scoping & per-owner grouping
  athleteId: string;
  athleteName: string;
  groupIds: string[]; // groups this athlete belongs to (for the `group` dimension)

  // ── exercise dimensions ──
  exerciseId: string | null;
  exerciseName: string;
  category: string;
  movement: string | null; // exercises.lift_slot
  isCompetitionLift: boolean;
  countsTowardsTotals: boolean;
  unit: string | null; // prescription unit: percentage | absolute_kg | rpe | free_text* | other

  // ── time dimensions ──
  weekStart: string; // snapped Monday
  date: string | null; // performed sessions have a calendar date; planned abstract slots do not
  dayIndex: number; // opaque 1-based slot — never derive a calendar date from this
  dayOfWeek: number | null; // 0=Mon..6=Sun, ONLY when day_schedule resolves it
  weekType: string | null;
  macroId: string | null;
  macroName: string | null;
  phaseId: string | null; // meso
  phaseName: string | null;
  relativeWeek: number | null; // macro_weeks.week_number (macro-aligned index)

  // ── quantities (already expanded across sets for this contribution) ──
  sets: number; // total sets
  reps: number; // total reps (sets × reps-per-set)
  tonnage: number; // Σ(load × reps) in kg — 0 when load is not kg-resolved
  maxLoad: number; // highest kg load in this contribution (0 if not kg)
  load: number; // representative load value (kg or % per `unit`)
  loadIsKg: boolean; // true when the load is a real kilogram value
  loadIsPct: boolean; // true when the load is an unresolved percentage
  pct1rm: number | null; // resolved %1RM against the movement's reference max, when computable

  // ── pairing (delta / adherence) ──
  /** performed → the planned_exercise it executed (FK); planned → its own planned_exercise id. */
  pairKey: string | null;

  // ── athlete day-card custom metrics (custom:<defId> dimensions/measures) ──
  custom?: Record<string, number>;
}

// ── Result ───────────────────────────────────────────────────────────────────
// `runAnalysisQuery` returns a fully-aggregated, tidy result. The pivot UI and
// the chart adapter read this; they never see `FactRow[]`.

export interface ResolvedMeasure {
  /** Stable column key: `${metricId}::${state}`. */
  key: string;
  metricId: string;
  label: string;
  unit: string;
  agg: Agg;
  state: MeasureState;
}

export interface ResultRecord {
  /** rowAxis index → value label (in `result.rowDimensions` order). */
  row: string[];
  /** colAxis index → value label (in `result.colDimensions` order). */
  col: string[];
  /** measureKey → aggregated value (null = no data / not applicable). */
  values: Record<string, number | null>;
}

export interface AnalysisMeta {
  factCount: number;
  plannedFactCount: number;
  performedFactCount: number;
  /** Contributions whose load was an unresolved percentage and so were excluded
   *  from tonnage/maxLoad rather than mixed with kg (T-02). */
  unresolvedPctFacts: number;
  athleteIds: string[];
  /** Per-subject normalization basis (athlete id → divisor) when applicable. */
  normalization: Normalization;
  /** Distinct values per filterable dimension (over the unfiltered fact set),
   *  so the builder can offer real filter choices. Capped per dimension. */
  availableValues: Record<string, string[]>;
  /** Non-fatal notes for the UI (e.g. "12 % loads excluded from tonnage"). */
  notes: string[];
}

export interface AnalysisResult {
  query: AnalysisQuery;
  rowDimensions: PivotAxis[];
  colDimensions: PivotAxis[];
  measures: ResolvedMeasure[];
  /** Ordered distinct row-axis tuples. */
  rowKeys: string[][];
  /** Ordered distinct col-axis tuples. */
  colKeys: string[][];
  records: ResultRecord[];
  meta: AnalysisMeta;
}

// ── Metric registry ───────────────────────────────────────────────────────────
// Coach-configurable source of truth for everything aggregatable (invariant #2).
// Base metrics extract a (value, weight) contribution per fact row; derived
// metrics compose already-aggregated base values. This subsumes src/lib/metrics.ts
// (single source of truth) — the planner summary reads the same registry.

export type MetricCombine = 'sum' | 'weightedAvg' | 'max' | 'min' | 'count' | 'distinct';

export interface MetricContribution {
  value: number;
  /** Weight for `weightedAvg` (e.g. reps). Ignored by other combiners. */
  weight: number;
  /** For `distinct`: the identity to de-duplicate on. */
  id?: string;
}

export interface BaseMetricDef {
  id: string;
  label: string;
  shortLabel: string;
  unit: string; // 'kg' | 'reps' | 'sets' | '%' | 'AU' | 'ratio' | ''
  kind: 'base';
  appliesToState: Array<'planned' | 'performed'>;
  defaultAgg: Agg;
  combine: MetricCombine;
  /** Per-row contribution, or null when the row does not contribute. */
  extract: (row: FactRow) => MetricContribution | null;
  description?: string;
  /** Built-in metrics cannot be deleted by the coach. */
  isBuiltin: boolean;
}

/**
 * A derived-metric input: a base metric aggregated over an optional subset of
 * the group's rows. The `where` predicate lets a derived metric scope to a
 * movement/category (e.g. snatch max ÷ clean&jerk max) — the OWL-correct way to
 * express lift ratios as a single metric (T-01/T-02 domain notes).
 */
export interface DerivedInput {
  alias: string;
  metricId: string; // a base metric id
  where?: (row: FactRow) => boolean;
}

export interface DerivedMetricDef {
  id: string;
  label: string;
  shortLabel: string;
  unit: string;
  kind: 'derived';
  appliesToState: Array<'planned' | 'performed'>;
  defaultAgg: Agg;
  inputs: DerivedInput[];
  /** Computed from already-aggregated input values for a group; null when undefined. */
  formula: (values: Record<string, number | null>) => number | null;
  description?: string;
  isBuiltin: boolean;
}

export type MetricDef = BaseMetricDef | DerivedMetricDef;

export interface MetricRegistry {
  get(id: string): MetricDef | undefined;
  list(): MetricDef[];
  has(id: string): boolean;
}

/** Options that supply label maps and config the pure aggregator can't fetch. */
export interface AggregateOptions {
  /** Intensity-zone boundaries (general_settings.intensity_zones), percent or fraction. */
  intensityZones?: Array<{ zone: string; min: number; max: number }>;
  /** athleteId → display name (engine groups by id, UI shows names). */
  athleteLabels?: Record<string, string>;
  /** groupId → display name. */
  groupLabels?: Record<string, string>;
  /** athlete display-name → bodyweight (kg), for perBodyweight normalization. */
  athleteBodyweight?: Record<string, number>;
}
