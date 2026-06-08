// EMOS Analysis — the public service boundary.
//
// `runAnalysisQuery(config)` is the ONE entry point the React client calls. It
// validates/repairs the query, fetches the owner-scoped fact set, and returns a
// fully-aggregated `AnalysisResult`. The client never sees `FactRow[]` and never
// aggregates (invariant #6). A future swap to SQL views/RPC stays invisible
// behind this signature.

import { aggregate } from './aggregate';
import { fetchFacts } from './factFetch';
import { defaultRegistry } from './metricRegistry';
import { validateAnalysisQuery } from './validate';
import type {
  AggregateOptions,
  AnalysisQuery,
  AnalysisResult,
  FactRow,
  MetricRegistry,
} from './types';

export interface RunOptions {
  /** Coach-extended registry; defaults to the built-in seed. */
  registry?: MetricRegistry;
  /** Fixed "now" for rolling-scope anchoring (tests/determinism). */
  now?: string;
}

export async function runAnalysisQuery(
  input: AnalysisQuery,
  options: RunOptions = {},
): Promise<AnalysisResult> {
  const registry = options.registry ?? defaultRegistry;
  const { query } = validateAnalysisQuery(input, registry);
  const fetched = await fetchFacts(query, options.now);
  return aggregate(fetched.facts, query, registry, {
    intensityZones: fetched.intensityZones,
    athleteLabels: fetched.athleteLabels,
    groupLabels: fetched.groupLabels,
    athleteBodyweight: fetched.athleteBodyweight,
    dimensionColors: fetched.dimensionColors,
    window: fetched.window,
  });
}

/**
 * Pure variant: aggregate an already-built fact set. Used by tests and by any
 * caller that already holds facts (avoids a second fetch). Validates/repairs
 * the query the same way `runAnalysisQuery` does.
 */
export function analyzeFacts(
  facts: FactRow[],
  input: AnalysisQuery,
  options: { registry?: MetricRegistry; aggregate?: AggregateOptions } = {},
): AnalysisResult {
  const registry = options.registry ?? defaultRegistry;
  const { query } = validateAnalysisQuery(input, registry);
  return aggregate(facts, query, registry, options.aggregate ?? {});
}
