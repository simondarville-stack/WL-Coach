// Coach-defined derived metrics, persisted to localStorage for v1 (the gated
// `analysis_metrics` table, DC-02, is a later sign-off-required swap behind the
// same registry interface). A spec composes two existing metrics with an
// operator — the "guided composer" (no free-text formula parsing, no cycles).

import type { DerivedMetricDef, MetricDef } from '../../../lib/analysis';

const KEY = 'emos.analysis.coachMetrics.v1';

export type DerivedOp = 'ratioPct' | 'sum' | 'diff';

export interface CoachMetricSpec {
  id: string;
  label: string;
  unit: string;
  a: string; // base metric id (numerator / left)
  b: string; // base metric id (denominator / right)
  op: DerivedOp;
}

export const OP_LABEL: Record<DerivedOp, string> = {
  ratioPct: 'A ÷ B (%)',
  sum: 'A + B',
  diff: 'A − B',
};

export function loadCoachMetricSpecs(): CoachMetricSpec[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCoachMetricSpecs(specs: CoachMetricSpec[]): void {
  localStorage.setItem(KEY, JSON.stringify(specs));
}

export function specToMetric(spec: CoachMetricSpec): DerivedMetricDef {
  const op = spec.op;
  return {
    id: spec.id,
    label: spec.label,
    shortLabel: spec.label.slice(0, 4),
    unit: spec.unit || (op === 'ratioPct' ? '%' : ''),
    kind: 'derived',
    appliesToState: ['planned', 'performed'],
    defaultAgg: op === 'ratioPct' ? 'ratio' : 'sum',
    isBuiltin: false,
    inputs: [
      { alias: 'a', metricId: spec.a },
      { alias: 'b', metricId: spec.b },
    ],
    formula: ({ a, b }) => {
      if (a == null || b == null) return null;
      if (op === 'ratioPct') return b ? (a / b) * 100 : null;
      if (op === 'sum') return a + b;
      return a - b;
    },
  };
}

export function loadCoachMetrics(): MetricDef[] {
  return loadCoachMetricSpecs().map(specToMetric);
}
