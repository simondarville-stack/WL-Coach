// EMOS Analysis engine — public barrel.
//
// UI code imports from here. Aggregation lives behind `runAnalysisQuery`;
// `factFetch` is the only Supabase-touching module (invariant #6).

export * from './types';
export { runAnalysisQuery, analyzeFacts, type RunOptions } from './runAnalysisQuery';
export { aggregate, DEFAULT_INTENSITY_ZONES, type ZoneDef } from './aggregate';
export { fetchFacts, buildFacts } from './factFetch';
export { resolveScopeWindow, resolvedWeekStart, type ResolvedScope, type ScopeContext } from './scopeResolver';
export { validateAnalysisQuery, emptyQuery, type ValidationResult } from './validate';
export {
  BASE_METRICS,
  DERIVED_METRICS,
  createRegistry,
  defaultRegistry,
  DEFAULT_VISIBLE_METRIC_IDS,
} from './metricRegistry';
