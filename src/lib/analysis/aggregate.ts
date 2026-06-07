// EMOS Analysis — pure aggregator.
//
// `(facts, query, registry, options) => AnalysisResult`. No Supabase, no React,
// no clock — fully deterministic and unit-testable (invariant #6). Planned and
// performed facts are kept in separate subsets per bucket so a measure's
// planned / performed / both / delta / adherence facet is derived by comparison,
// never by conflating the two streams (invariant #1).

import type {
  AggregateOptions,
  AnalysisQuery,
  AnalysisResult,
  Agg,
  BaseMetricDef,
  Dimension,
  FactRow,
  Filter,
  MetricDef,
  MetricRegistry,
  ResolvedMeasure,
  ResultRecord,
} from './types';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NO_VALUE = '—';

export interface ZoneDef {
  zone: string;
  min: number;
  max: number;
}

export const DEFAULT_INTENSITY_ZONES: ZoneDef[] = [
  { zone: '<70%', min: 0, max: 70 },
  { zone: '70–80%', min: 70, max: 80 },
  { zone: '80–90%', min: 80, max: 90 },
  { zone: '90%+', min: 90, max: Infinity },
];

/** Normalise a zone bound to a percentage (config may store fractions 0.7 or percents 70). */
function toPct(bound: number): number {
  return bound <= 1.5 && bound > 0 ? bound * 100 : bound;
}

function classifyZone(pct1rm: number | null, zones: ZoneDef[]): string {
  if (pct1rm == null) return '(no %1RM)';
  for (const z of zones) {
    if (pct1rm >= toPct(z.min) && pct1rm < toPct(z.max)) return z.zone;
  }
  return '(out of range)';
}

/** Display value(s) of a dimension for a fact. Multi-valued only for `group`. */
function dimValues(row: FactRow, dim: Dimension, opts: AggregateOptions): string[] {
  if (dim.startsWith('custom:')) {
    const id = dim.slice('custom:'.length);
    const v = row.custom?.[id];
    return [v == null ? NO_VALUE : String(v)];
  }
  switch (dim) {
    case 'athlete':
      return [opts.athleteLabels?.[row.athleteId] ?? row.athleteName ?? row.athleteId];
    case 'group':
      return row.groupIds.length
        ? row.groupIds.map((g) => opts.groupLabels?.[g] ?? g)
        : ['(ungrouped)'];
    case 'exercise':
      return [row.exerciseName || '(deleted exercise)'];
    case 'category':
      return [row.category || '(uncategorised)'];
    case 'movement':
      return [row.movement ?? '(other)'];
    case 'weekType':
      return [row.weekType ?? '(none)'];
    case 'intensityZone':
      return [classifyZone(row.pct1rm, opts.intensityZones ?? DEFAULT_INTENSITY_ZONES)];
    case 'day':
      return [`Day ${row.dayIndex}`];
    case 'dayOfWeek':
      return [row.dayOfWeek == null ? '(slot)' : (WEEKDAY_LABELS[row.dayOfWeek] ?? '(slot)')];
    case 'week':
      return [row.weekStart];
    case 'macro':
      return [row.macroName ?? '(no macro)'];
    case 'meso':
      return [row.phaseName ?? '(no phase)'];
    case 'relativeWeek':
      return [row.relativeWeek == null ? '(no macro)' : `W${row.relativeWeek}`];
    default:
      return [NO_VALUE];
  }
}

/** Numeric value of a dimension for `between`/numeric filters, or null. */
function dimNumber(row: FactRow, dim: Dimension): number | null {
  if (dim === 'relativeWeek') return row.relativeWeek;
  if (dim === 'day') return row.dayIndex;
  if (dim === 'dayOfWeek') return row.dayOfWeek;
  if (dim === 'intensityZone') return row.pct1rm;
  if (dim.startsWith('custom:')) {
    const v = row.custom?.[dim.slice('custom:'.length)];
    return v == null ? null : v;
  }
  return null;
}

function matchesFilter(row: FactRow, f: Filter, opts: AggregateOptions): boolean {
  switch (f.op) {
    case 'in': {
      const vals = dimValues(row, f.dimension, opts);
      return vals.some((v) => f.values.includes(v));
    }
    case 'eq': {
      const target = String(f.value);
      return dimValues(row, f.dimension, opts).some((v) => v === target);
    }
    case 'between': {
      const n = dimNumber(row, f.dimension);
      return n != null && n >= f.min && n <= f.max;
    }
  }
}

// ── base-metric reduction ─────────────────────────────────────────────────────

function reduceBase(metric: BaseMetricDef, facts: FactRow[], agg: Agg): number | null {
  let sum = 0;
  let weightSum = 0;
  let count = 0;
  let mx = -Infinity;
  let mn = Infinity;
  const ids = new Set<string>();
  for (const row of facts) {
    const c = metric.extract(row);
    if (!c) continue;
    count += 1;
    sum += c.value;
    weightSum += c.weight;
    if (c.value > mx) mx = c.value;
    if (c.value < mn) mn = c.value;
    if (c.id != null) ids.add(c.id);
  }
  if (count === 0) return null;
  switch (agg) {
    case 'sum':
    case 'ratio':
      return sum;
    case 'avg':
      // Weighted metrics (avgLoad / avgPct1RM) pre-multiply value by weight in
      // `extract` and carry the weight; divide by Σweight. Unweighted metrics
      // (weight 0) fall back to a plain mean.
      return weightSum > 0 ? sum / weightSum : sum / count;
    case 'max':
      return mx === -Infinity ? null : mx;
    case 'min':
      return mn === Infinity ? null : mn;
    case 'count':
      return count;
    case 'distinct':
      return ids.size || count;
  }
}

function metricOverFacts(
  metric: MetricDef,
  registry: MetricRegistry,
  facts: FactRow[],
  agg: Agg,
): number | null {
  if (metric.kind === 'base') return reduceBase(metric, facts, agg);
  // derived
  const values: Record<string, number | null> = {};
  for (const input of metric.inputs) {
    const base = registry.get(input.metricId);
    if (!base || base.kind !== 'base') {
      values[input.alias] = null;
      continue;
    }
    const subset = input.where ? facts.filter(input.where) : facts;
    values[input.alias] = reduceBase(base, subset, base.defaultAgg);
  }
  return metric.formula(values);
}

// ── result assembly ───────────────────────────────────────────────────────────

/** The value-keys a measure expands into (one per planned/performed facet). */
function measureValueKeys(metricId: string, state: string): string[] {
  if (state === 'both') return [`${metricId}::planned`, `${metricId}::performed`];
  return [`${metricId}::${state}`];
}

function resolveMeasures(query: AnalysisQuery, registry: MetricRegistry): ResolvedMeasure[] {
  const out: ResolvedMeasure[] = [];
  for (const m of query.measures) {
    const def = registry.get(m.metricId);
    const label = def?.label ?? m.metricId;
    const unit = def?.unit ?? '';
    for (const key of measureValueKeys(m.metricId, m.state)) {
      const facet = key.split('::')[1];
      out.push({
        key,
        metricId: m.metricId,
        label,
        unit,
        agg: m.agg,
        state: facet as ResolvedMeasure['state'],
      });
    }
  }
  return out;
}

function computeMeasureValues(
  query: AnalysisQuery,
  registry: MetricRegistry,
  plannedFacts: FactRow[],
  performedFacts: FactRow[],
): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const m of query.measures) {
    const def = registry.get(m.metricId);
    if (!def) {
      for (const k of measureValueKeys(m.metricId, m.state)) values[k] = null;
      continue;
    }
    const p = def.appliesToState.includes('planned')
      ? metricOverFacts(def, registry, plannedFacts, m.agg)
      : null;
    const f = def.appliesToState.includes('performed')
      ? metricOverFacts(def, registry, performedFacts, m.agg)
      : null;
    switch (m.state) {
      case 'planned':
        values[`${m.metricId}::planned`] = p;
        break;
      case 'performed':
        values[`${m.metricId}::performed`] = f;
        break;
      case 'both':
        values[`${m.metricId}::planned`] = p;
        values[`${m.metricId}::performed`] = f;
        break;
      case 'delta':
        values[`${m.metricId}::delta`] = p == null && f == null ? null : (f ?? 0) - (p ?? 0);
        break;
      case 'adherence':
        values[`${m.metricId}::adherence`] = p && p !== 0 ? ((f ?? 0) / p) * 100 : null;
        break;
    }
  }
  return values;
}

/** Cartesian product of each axis's value list for a fact. */
function axisCombos(row: FactRow, dims: Dimension[], opts: AggregateOptions): string[][] {
  if (dims.length === 0) return [[]];
  let combos: string[][] = [[]];
  for (const dim of dims) {
    const vals = dimValues(row, dim, opts);
    const next: string[][] = [];
    for (const combo of combos) for (const v of vals) next.push([...combo, v]);
    combos = next;
  }
  return combos;
}

/** Natural comparator: numbers embedded in keys sort numerically (W2 < W10). */
function naturalCompare(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? '';
    const y = b[i] ?? '';
    const nx = parseFloat(x.replace(/^[^\d.-]*/, ''));
    const ny = parseFloat(y.replace(/^[^\d.-]*/, ''));
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx !== ny) return nx - ny;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

interface Bucket {
  row: string[];
  col: string[];
  planned: FactRow[];
  performed: FactRow[];
}

export function aggregate(
  facts: FactRow[],
  query: AnalysisQuery,
  registry: MetricRegistry,
  options: AggregateOptions = {},
): AnalysisResult {
  // `state` is a measure facet, not a grouping dimension (T-05) — strip it from
  // the grouping axes; the chart adapter pivots on it via the measure keys.
  const rowDims = query.rows.filter((a): a is Dimension => a !== 'state');
  const colDims = query.cols.filter((a): a is Dimension => a !== 'state');

  const filtered = query.filters.length
    ? facts.filter((row) => query.filters.every((f) => matchesFilter(row, f, options)))
    : facts;

  const buckets = new Map<string, Bucket>();
  let unresolvedPct = 0;
  let plannedCount = 0;
  let performedCount = 0;

  for (const row of filtered) {
    if (row.state === 'planned') plannedCount += 1;
    else performedCount += 1;
    if (row.loadIsPct && row.countsTowardsTotals) unresolvedPct += 1;

    const rowCombos = axisCombos(row, rowDims, options);
    const colCombos = axisCombos(row, colDims, options);
    for (const rc of rowCombos) {
      for (const cc of colCombos) {
        const key = JSON.stringify([rc, cc]);
        let b = buckets.get(key);
        if (!b) {
          b = { row: rc, col: cc, planned: [], performed: [] };
          buckets.set(key, b);
        }
        (row.state === 'planned' ? b.planned : b.performed).push(row);
      }
    }
  }

  const records: ResultRecord[] = [];
  const rowKeySet = new Map<string, string[]>();
  const colKeySet = new Map<string, string[]>();
  for (const b of buckets.values()) {
    const values = computeMeasureValues(query, registry, b.planned, b.performed);
    // Prune fully-empty buckets — e.g. an exercise that counts towards no total
    // and so contributes to no selected measure (avoids noise rows like an
    // "Accessory" category in a tonnage pivot).
    if (Object.values(values).every((v) => v == null)) continue;
    records.push({ row: b.row, col: b.col, values });
    rowKeySet.set(JSON.stringify(b.row), b.row);
    colKeySet.set(JSON.stringify(b.col), b.col);
  }

  const rowKeys = [...rowKeySet.values()].sort(naturalCompare);
  const colKeys = [...colKeySet.values()].sort(naturalCompare);

  const athleteIds = [...new Set(filtered.map((r) => r.athleteId))];
  const notes: string[] = [];
  if (unresolvedPct > 0) {
    notes.push(
      `${unresolvedPct} contribution(s) used percentage loads and were excluded from tonnage/load metrics (no kg resolved).`,
    );
  }

  return {
    query,
    rowDimensions: query.rows,
    colDimensions: query.cols,
    measures: resolveMeasures(query, registry),
    rowKeys,
    colKeys,
    records,
    meta: {
      factCount: filtered.length,
      plannedFactCount: plannedCount,
      performedFactCount: performedCount,
      unresolvedPctFacts: unresolvedPct,
      athleteIds,
      normalization: query.subjects.normalization,
      notes,
    },
  };
}
