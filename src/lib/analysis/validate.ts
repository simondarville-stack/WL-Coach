// EMOS Analysis — query validation & repair.
//
// `validateAnalysisQuery` returns a *repaired* query plus warnings, never a
// bare boolean (engineering critique E #3): unknown metric ids and malformed
// axes are dropped so a stale saved view degrades gracefully instead of
// throwing. The repaired query is always safe to pass to `runAnalysisQuery`.

import { ANALYSIS_QUERY_VERSION } from './types';
import type {
  AnalysisQuery,
  Dimension,
  Measure,
  MetricRegistry,
  PivotAxis,
  Scope,
} from './types';

const VALID_DIMENSIONS = new Set<string>([
  'athlete',
  'group',
  'exercise',
  'category',
  'movement',
  'weekType',
  'intensityZone',
  'day',
  'week',
  'macro',
  'meso',
  'dayOfWeek',
  'relativeWeek',
]);

function isDimension(a: string): a is Dimension {
  return VALID_DIMENSIONS.has(a) || a.startsWith('custom:');
}

function isPivotAxis(a: string): a is PivotAxis {
  return a === 'state' || isDimension(a);
}

const VALID_AGG = new Set(['sum', 'avg', 'min', 'max', 'count', 'distinct', 'ratio']);
const VALID_STATE = new Set(['planned', 'performed', 'both', 'delta', 'adherence']);

export interface ValidationResult {
  query: AnalysisQuery;
  warnings: string[];
  valid: boolean;
}

function repairScope(scope: Scope, warnings: string[]): Scope {
  if (scope.mode === 'rolling') {
    const w = Math.floor(scope.windowDays);
    if (!Number.isFinite(w) || w < 1) {
      warnings.push('rolling windowDays must be ≥ 1; defaulted to 28.');
      return { mode: 'rolling', windowDays: 28, anchor: scope.anchor };
    }
    return { mode: 'rolling', windowDays: w, anchor: scope.anchor };
  }
  return scope;
}

function dedupeAxes(axes: PivotAxis[], warnings: string[], where: string): PivotAxis[] {
  const seen = new Set<string>();
  const out: PivotAxis[] = [];
  for (const a of axes) {
    if (!isPivotAxis(a)) {
      warnings.push(`Dropped unknown ${where} axis "${a}".`);
      continue;
    }
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

export function validateAnalysisQuery(
  input: AnalysisQuery,
  registry: MetricRegistry,
): ValidationResult {
  const warnings: string[] = [];

  const scope = repairScope(input.scope, warnings);

  const measures: Measure[] = [];
  for (const m of input.measures ?? []) {
    if (!registry.has(m.metricId)) {
      warnings.push(`Dropped measure with unknown metric "${m.metricId}".`);
      continue;
    }
    const agg = VALID_AGG.has(m.agg) ? m.agg : registry.get(m.metricId)!.defaultAgg;
    if (!VALID_AGG.has(m.agg)) warnings.push(`Measure "${m.metricId}" had invalid agg; using default.`);
    const state = VALID_STATE.has(m.state) ? m.state : 'performed';
    if (!VALID_STATE.has(m.state)) warnings.push(`Measure "${m.metricId}" had invalid state; using "performed".`);
    measures.push({ metricId: m.metricId, agg, state });
  }
  if (measures.length === 0) {
    warnings.push('Query has no valid measures.');
  }

  const rows = dedupeAxes(input.rows ?? [], warnings, 'row');
  const cols = dedupeAxes(input.cols ?? [], warnings, 'col');

  const filters = (input.filters ?? []).filter((f) => {
    const ok = isDimension(f.dimension);
    if (!ok) warnings.push(`Dropped filter on unknown dimension "${f.dimension}".`);
    return ok;
  });

  // viz.yAxis must reference a selected measure's metric; else fall back.
  const viz = { ...input.viz };
  const measureMetricIds = new Set(measures.map((m) => m.metricId));
  if (viz.yAxis && !measureMetricIds.has(viz.yAxis)) {
    warnings.push(`viz.yAxis "${viz.yAxis}" is not a selected measure; defaulting.`);
    viz.yAxis = measures[0]?.metricId;
  } else if (!viz.yAxis && measures.length) {
    viz.yAxis = measures[0].metricId;
  }
  if (viz.xAxis && !isDimension(viz.xAxis)) {
    warnings.push(`Dropped invalid viz.xAxis "${viz.xAxis}".`);
    delete viz.xAxis;
  }
  if (viz.series && !isPivotAxis(viz.series)) {
    warnings.push(`Dropped invalid viz.series "${viz.series}".`);
    delete viz.series;
  }

  return {
    query: {
      version: input.version ?? ANALYSIS_QUERY_VERSION,
      scope,
      subjects: {
        athletes: [...new Set(input.subjects?.athletes ?? [])],
        groups: [...new Set(input.subjects?.groups ?? [])],
        normalization: input.subjects?.normalization ?? 'none',
      },
      filters,
      rows,
      cols,
      measures,
      viz,
    },
    warnings,
    valid: warnings.length === 0,
  };
}

/** A minimal, valid starter query (tonnage by week, planned-vs-performed). */
export function emptyQuery(): AnalysisQuery {
  return {
    version: ANALYSIS_QUERY_VERSION,
    scope: { mode: 'rolling', windowDays: 28 },
    subjects: { athletes: [], groups: [], normalization: 'none' },
    filters: [],
    rows: ['week'],
    cols: [],
    measures: [{ metricId: 'volume', agg: 'sum', state: 'both' }],
    viz: { type: 'table', xAxis: 'week', series: 'state', yAxis: 'volume' },
  };
}
