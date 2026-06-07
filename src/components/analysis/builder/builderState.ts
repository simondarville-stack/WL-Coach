// The builder's local state and its assembly into a serializable AnalysisQuery.
// Keeping assembly here (not in the component) means presets, the rail, and any
// future saved-view loader all produce queries the same way.

import { ANALYSIS_QUERY_VERSION } from '../../../lib/analysis';
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
  rows: Dimension[];
  cols: Dimension[];
  metrics: string[]; // metric ids; agg comes from the registry default
  compare: MeasureState;
  vizType: VizType;
}

export interface Subjects {
  athletes: string[];
  groups: string[];
  normalization: Normalization;
}

export function defaultBuilderState(today: string): BuilderState {
  return {
    scopeMode: 'rolling',
    windowDays: 56,
    from: `${today.slice(0, 4)}-01-01`,
    to: today,
    rows: ['week'],
    cols: [],
    metrics: ['volume'],
    compare: 'both',
    vizType: 'table',
  };
}

function scopeFrom(state: BuilderState, today: string): Scope {
  if (state.scopeMode === 'rolling') return { mode: 'rolling', windowDays: state.windowDays, anchor: today };
  if (state.scopeMode === 'ytd') return { mode: 'dateRange', from: `${today.slice(0, 4)}-01-01`, to: today };
  return { mode: 'dateRange', from: state.from, to: state.to };
}

export function buildQuery(
  state: BuilderState,
  subjects: Subjects,
  registry: MetricRegistry,
  today: string,
): AnalysisQuery {
  const measures = state.metrics.map((id) => ({
    metricId: id,
    agg: registry.get(id)?.defaultAgg ?? 'sum',
    state: state.compare,
  }));
  const seriesIsState = state.compare === 'both';
  return {
    version: ANALYSIS_QUERY_VERSION,
    scope: scopeFrom(state, today),
    subjects,
    filters: [],
    rows: state.rows,
    cols: state.cols,
    measures,
    viz: {
      type: state.vizType,
      xAxis: state.rows[0],
      series: seriesIsState ? 'state' : state.cols[0],
      yAxis: state.metrics[0],
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
