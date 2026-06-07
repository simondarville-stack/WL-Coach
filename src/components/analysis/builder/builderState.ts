// The builder's local state and its assembly into a serializable AnalysisQuery.
// Keeping assembly here (not in the component) means presets, the rail, and any
// future saved-view loader all produce queries the same way.

import { ANALYSIS_QUERY_VERSION } from '../../../lib/analysis';
import { isoAddDays } from '../../../lib/dateUtils';
import type {
  AnalysisQuery,
  Dimension,
  MeasureState,
  MetricRegistry,
  Normalization,
  Scope,
  VizType,
} from '../../../lib/analysis';

export type ScopeMode = 'rolling' | 'custom' | 'ytd';

export interface BuilderState {
  scopeMode: ScopeMode;
  windowDays: number;
  from: string;
  to: string;
  athleteIds: string[];
  groupIds: string[];
  normalization: Normalization;
  rows: Dimension[];
  cols: Dimension[];
  metrics: string[]; // metric ids; agg comes from the registry default
  compare: MeasureState;
  vizType: VizType;
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
    rows: ['week'],
    cols: [],
    metrics: ['volume'],
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
    const a = new Date(scope.from + 'T00:00:00Z').getTime();
    const b = new Date(scope.to + 'T00:00:00Z').getTime();
    const span = Math.max(1, Math.round((b - a) / 86400000) + 1);
    return { mode: 'dateRange', from: isoAddDays(scope.from, -span), to: isoAddDays(scope.from, -1) };
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
  const measures = state.metrics.map((id) => ({
    metricId: id,
    agg: registry.get(id)?.defaultAgg ?? 'sum',
    state: state.compare,
  }));
  const seriesIsState = state.compare === 'both';
  const hasAthleteDim = state.rows.includes('athlete') || state.cols.includes('athlete');
  const scope = scopeFrom(state, today);
  return {
    version: ANALYSIS_QUERY_VERSION,
    scope,
    subjects: {
      athletes: state.athleteIds,
      groups: state.groupIds,
      normalization: state.normalization,
    },
    filters: [],
    rows: state.rows,
    cols: state.cols,
    measures,
    viz: {
      type: state.vizType,
      xAxis: state.rows[0],
      // When comparing athletes, prefer athlete as the series; else the
      // planned/performed split (both) or the first column dimension.
      series: hasAthleteDim ? 'athlete' : seriesIsState ? 'state' : state.cols[0],
      yAxis: state.metrics[0],
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
