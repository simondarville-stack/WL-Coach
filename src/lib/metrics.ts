export type MetricKey = 'reps' | 'sets' | 'max' | 'avg' | 'tonnage' | 'k';

export interface MetricDefinition {
  key: MetricKey;
  label: string;          // "Reps", "Sets", "Max", "Avg", "Tonnage", "K"
  shortLabel: string;     // "R", "S", "Max", "Avg", "T", "K"
  unit: string;           // "", "", "kg", "kg", "kg", "%"
  description: string;
  defaultVisible: boolean;
}

export const METRICS: MetricDefinition[] = [
  {
    key: 'reps',
    label: 'Reps',
    shortLabel: 'R',
    unit: '',
    description: 'Total repetitions',
    defaultVisible: true,
  },
  {
    key: 'sets',
    label: 'Sets',
    shortLabel: 'S',
    unit: '',
    description: 'Total sets',
    defaultVisible: true,
  },
  {
    key: 'max',
    label: 'Max',
    shortLabel: 'Max',
    unit: 'kg',
    description: 'Highest load used',
    defaultVisible: true,
  },
  {
    key: 'avg',
    label: 'Avg',
    shortLabel: 'Avg',
    unit: 'kg',
    description: 'Average load (weighted by reps)',
    defaultVisible: false,
  },
  {
    key: 'tonnage',
    label: 'Tonnage',
    shortLabel: 'T',
    unit: 'kg',
    description: 'Total volume (load × reps summed)',
    defaultVisible: true,
  },
  {
    key: 'k',
    label: 'K',
    shortLabel: 'K',
    unit: '%',
    description: 'Average intensity / competition total (optimal: 38-42%)',
    defaultVisible: false,
  },
];

export const METRIC_ORDER: MetricKey[] = ['reps', 'sets', 'max', 'avg', 'tonnage', 'k'];

export const DEFAULT_VISIBLE_METRICS: MetricKey[] = ['reps', 'sets', 'max', 'tonnage'];

export interface ComputedMetrics {
  reps: number;
  sets: number;
  max: number;         // highest load
  avg: number;         // weighted average intensity (AAI)
  tonnage: number;     // total volume in kg
  k: number | null;    // avg / competition_total, null if no total set
}

/**
 * Compute all metrics from planned exercises.
 */
export function computeMetrics(
  exercises: Array<{
    summary_total_sets: number | null;
    summary_total_reps: number | null;
    summary_highest_load: number | null;
    summary_avg_load: number | null;
    counts_towards_totals?: boolean;
  }>,
  competitionTotal: number | null,
): ComputedMetrics {
  let reps = 0, sets = 0, max = 0, tonnage = 0;
  let weightedLoadSum = 0;

  for (const ex of exercises) {
    if (ex.counts_towards_totals === false) continue;
    const s = ex.summary_total_sets ?? 0;
    const r = ex.summary_total_reps ?? 0;
    const hi = ex.summary_highest_load ?? 0;
    const avg = ex.summary_avg_load ?? 0;

    sets += s;
    reps += r;
    if (hi > max) max = hi;
    tonnage += avg * r;  // tonnage = sum of (avg_load × reps) per exercise
    weightedLoadSum += avg * r;
  }

  const avg = reps > 0 ? Math.round(weightedLoadSum / reps) : 0;
  const k = (competitionTotal && competitionTotal > 0 && avg > 0)
    ? Math.round((avg / competitionTotal) * 100) / 100
    : null;

  return {
    reps,
    sets,
    max: Math.round(max),
    avg,
    tonnage: Math.round(tonnage),
    k,
  };
}

/**
 * Format a metric value for display.
 */
export function formatMetricValue(key: MetricKey, value: number | null): string {
  if (value === null || value === undefined) return '—';
  switch (key) {
    case 'reps':
    case 'sets':
      return String(value);
    case 'max':
    case 'avg':
      return `${value}`;
    case 'tonnage':
      return value >= 1000 ? `${(value / 1000).toFixed(1)}t` : `${value}`;
    case 'k':
      return `${(value * 100).toFixed(0)}%`;
    default:
      return String(value);
  }
}
