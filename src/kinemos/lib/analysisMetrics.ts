/**
 * analysisMetrics — KinEMOS numbers as Analysis-module measures.
 *
 * The other half of the adapter (design §13 Q3). `analysisAdapter.ts` turns
 * stored analyses into flat records; this file says how those records read as
 * measures in the Analysis builder, so a coach can put "second pull (KinEMOS)"
 * in a pivot next to tonnage and max load.
 *
 * Nothing here is seeded into the registry — the decision was explicit about
 * that. `AnalysisModule` adds these at runtime, beside the coach's own metrics,
 * and `factFetch` carries the values on each KinEMOS fact row under
 * `row.custom[kinemosCustomKey(id)]`. Analysis code never imports the engine;
 * it imports this.
 *
 * Aggregation follows the metric's own sense of "up": a per-week cell for peak
 * velocity is the best rep that week (max), for transition loss the least
 * (min), and for a metric with no better direction the mean. The coach can
 * override any of these per measure in the rail, as with every other metric.
 */
import type { BaseMetricDef } from '../../lib/analysis/types';
import { METRIC_CATALOGUE, type MetricDefinition } from '../engine/metricCatalogue';

export const KINEMOS_METRIC_PREFIX = 'kinemos:';

/** The `FactRow.custom` key that carries a catalogue metric's value. */
export function kinemosCustomKey(metricId: string): string {
  return `${KINEMOS_METRIC_PREFIX}${metricId}`;
}

/** The estimated error behind the grade, carried alongside the metrics. */
export const KINEMOS_ERROR_KEY = kinemosCustomKey('velocityError');

function measureFor(metric: MetricDefinition): BaseMetricDef {
  const key = kinemosCustomKey(metric.id);
  const [defaultAgg, combine] =
    metric.betterWhen === 'higher'
      ? (['max', 'max'] as const)
      : metric.betterWhen === 'lower'
        ? (['min', 'min'] as const)
        : (['avg', 'weightedAvg'] as const);
  return {
    id: key,
    label: `${metric.label} (KinEMOS)`,
    shortLabel: metric.label,
    unit: metric.unit,
    kind: 'base',
    // A measured lift is a performed one by definition.
    appliesToState: ['performed'],
    defaultAgg,
    combine,
    isBuiltin: true,
    description: `${metric.why} Read from KinEMOS analyses; ${
      defaultAgg === 'max' ? 'best rep' : defaultAgg === 'min' ? 'least' : 'mean'
    } per cell by default.`,
    // weight 0 ⇒ a plain mean under `avg`, exactly as the bodyweight metric.
    extract: r => {
      const v = r.custom?.[key];
      return v != null && Number.isFinite(v) ? { value: v, weight: 0 } : null;
    },
  };
}

/** Every KinEMOS measure the builder should offer. */
export function kinemosAnalysisMetrics(): BaseMetricDef[] {
  return [
    ...METRIC_CATALOGUE.map(measureFor),
    {
      id: kinemosCustomKey('reps'),
      label: 'Analysed reps (KinEMOS)',
      shortLabel: 'Analysed',
      unit: 'reps',
      kind: 'base',
      appliesToState: ['performed'],
      defaultAgg: 'sum',
      combine: 'sum',
      isBuiltin: true,
      description: 'How many reps have a KinEMOS analysis in the cell — the sample size behind the other KinEMOS measures.',
      extract: r => (r.custom && kinemosCustomKey('reps') in r.custom ? { value: 1, weight: 0 } : null),
    },
    {
      id: KINEMOS_ERROR_KEY,
      label: 'Velocity error (KinEMOS)',
      shortLabel: '± m/s',
      unit: 'm/s',
      kind: 'base',
      appliesToState: ['performed'],
      defaultAgg: 'avg',
      combine: 'weightedAvg',
      isBuiltin: true,
      description: 'The estimated one-sigma error on peak velocity behind each analysis’s A/B/C grade — the number that says how far to trust the others. Mean per cell.',
      extract: r => {
        const v = r.custom?.[KINEMOS_ERROR_KEY];
        return v != null && Number.isFinite(v) ? { value: v, weight: 0 } : null;
      },
    },
  ];
}
