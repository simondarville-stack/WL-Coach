// The builder's local state and its assembly into a serializable AnalysisQuery.
// Keeping assembly here (not in the component) means presets, the rail, and any
// future saved-view loader all produce queries the same way.

import { ANALYSIS_QUERY_VERSION } from '../../../lib/analysis';
import { isoAddDays, isoAddWeeks, weekStartsBetween } from '../../../lib/dateUtils';
import type {
  Agg,
  AnalysisQuery,
  Dimension,
  Filter,
  MeasureState,
  MetricRegistry,
  Normalization,
  Scope,
  SortSpec,
  TopNSpec,
  VizType,
} from '../../../lib/analysis';

/** A selected measure: a metric id plus an optional aggregation override. */
export interface MeasureSel {
  id: string;
  agg?: Agg;
}

/** Coerce legacy persisted metrics (string[]) to the {id, agg?} shape. */
export function normalizeMetrics(metrics: unknown): MeasureSel[] {
  if (!Array.isArray(metrics)) return [{ id: 'volume' }];
  return metrics.map((m) => (typeof m === 'string' ? { id: m } : (m as MeasureSel)));
}

export type ScopeMode = 'rolling' | 'custom' | 'ytd';

export interface BuilderState {
  scopeMode: ScopeMode;
  windowDays: number;
  from: string;
  to: string;
  athleteIds: string[];
  groupIds: string[];
  normalization: Normalization;
  filters: Filter[];
  rows: Dimension[];
  cols: Dimension[];
  metrics: MeasureSel[]; // metric id + optional per-measure aggregation override
  compare: MeasureState;
  vizType: VizType;
  /** Row sort (by a measure value-key or natural row order). */
  sort?: SortSpec;
  /** Keep only the top/bottom N of a dimension by a measure. */
  topN?: TopNSpec;
  /** Overlay the immediately-preceding period as a ghost series. */
  comparePrevious: boolean;
}

export function defaultBuilderState(today: string, seed: { athleteIds?: string[]; groupIds?: string[] } = {}): BuilderState {
  return {
    scopeMode: 'rolling',
    windowDays: 56,
    from: `${today.slice(0, 4)}-01-01`,
    to: today,
    athleteIds: seed.athleteIds ?? [],
    groupIds: seed.groupIds ?? [],
    normalization: 'none',
    filters: [],
    rows: ['week'],
    cols: [],
    metrics: [{ id: 'volume' }],
    compare: 'both',
    vizType: 'table',
    comparePrevious: false,
  };
}

/** The immediately-preceding period of the same length (for the ghost overlay). */
export function previousScope(scope: Scope, today: string): Scope {
  if (scope.mode === 'rolling') {
    const anchor = scope.anchor ?? today;
    return { mode: 'rolling', windowDays: scope.windowDays, anchor: isoAddDays(anchor, -scope.windowDays) };
  }
  if (scope.mode === 'dateRange') {
    // Align the comparison window to whole Mondays so it densifies to the SAME
    // number of weeks as the base — otherwise raw day-count maths can leave the
    // prior period one Monday short and the overlay/Δ% shift by a week.
    const baseMondays = weekStartsBetween(scope.from, scope.to);
    if (baseMondays.length === 0) {
      const a = new Date(scope.from + 'T00:00:00Z').getTime();
      const b = new Date(scope.to + 'T00:00:00Z').getTime();
      const span = Math.max(1, Math.round((b - a) / 86400000) + 1);
      return { mode: 'dateRange', from: isoAddDays(scope.from, -span), to: isoAddDays(scope.from, -1) };
    }
    const compLastMon = isoAddDays(baseMondays[0], -7); // Monday before the base's first
    const compFirstMon = isoAddWeeks(compLastMon, -(baseMondays.length - 1));
    return { mode: 'dateRange', from: compFirstMon, to: isoAddDays(compLastMon, 6) };
  }
  return scope; // macro: a "previous macro" isn't simply derivable — no overlay
}

/** True when more than one athlete is in scope (so athlete-wise comparison applies). */
export function isMultiSubject(state: BuilderState): boolean {
  return state.athleteIds.length > 1 || state.groupIds.length > 0;
}

function scopeFrom(state: BuilderState, today: string): Scope {
  if (state.scopeMode === 'rolling') return { mode: 'rolling', windowDays: state.windowDays, anchor: today };
  if (state.scopeMode === 'ytd') return { mode: 'dateRange', from: `${today.slice(0, 4)}-01-01`, to: today };
  return { mode: 'dateRange', from: state.from, to: state.to };
}

export function buildQuery(state: BuilderState, registry: MetricRegistry, today: string): AnalysisQuery {
  const measures = state.metrics.map((m) => ({
    metricId: m.id,
    agg: m.agg ?? registry.get(m.id)?.defaultAgg ?? 'sum',
    state: state.compare,
  }));
  const seriesIsState = state.compare === 'both';
  const scope = scopeFrom(state, today);

  // Multiple subjects must be shown SIDE BY SIDE, never summed — adding two
  // athletes' tonnage into one number is meaningless in a training context.
  // If the coach hasn't already split by athlete (or aggregated by group),
  // auto-add `athlete` as a column so each athlete is its own series/column.
  const multiSubject = state.athleteIds.length > 1 || state.groupIds.length > 0;
  const athleteAlready = state.rows.includes('athlete') || state.cols.includes('athlete');
  const groupAlready = state.rows.includes('group') || state.cols.includes('group');
  const cols: Dimension[] = multiSubject && !athleteAlready && !groupAlready ? [...state.cols, 'athlete'] : state.cols;
  const hasAthleteDim = state.rows.includes('athlete') || cols.includes('athlete');

  return {
    version: ANALYSIS_QUERY_VERSION,
    scope,
    subjects: {
      athletes: state.athleteIds,
      groups: state.groupIds,
      normalization: state.normalization,
    },
    // Drop incomplete filters (an empty `in` would otherwise exclude everything).
    // `?? []` guards a saved view persisted before filters existed.
    filters: (state.filters ?? []).filter((f) => !(f.op === 'in' && f.values.length === 0)),
    rows: state.rows,
    cols,
    measures,
    sort: state.sort,
    topN: state.topN,
    viz: {
      type: state.vizType,
      xAxis: state.rows[0],
      // When comparing athletes, prefer athlete as the series; else the
      // planned/performed split (both) or the first column dimension.
      series: hasAthleteDim ? 'athlete' : seriesIsState ? 'state' : state.cols[0],
      yAxis: state.metrics[0]?.id,
      overlay: state.comparePrevious
        ? { mode: 'periodOverPeriod', comparePeriod: previousScope(scope, today) }
        : { mode: 'none' },
    },
  };
}

/** Coach-facing labels for compare facets (used in viz/legends). */
export const COMPARE_LABEL: Record<MeasureState, string> = {
  planned: 'Planned',
  performed: 'Performed',
  both: 'Planned vs Performed',
  delta: 'Delta (performed − planned)',
  adherence: 'Adherence %',
};

export const VIZ_LABEL: Record<VizType, string> = {
  table: 'Table',
  line: 'Line',
  bar: 'Bar',
  stackedBar: 'Stacked',
  groupedBar: 'Grouped',
  scatter: 'Scatter',
  heatmap: 'Heatmap',
  radar: 'Radar',
};
