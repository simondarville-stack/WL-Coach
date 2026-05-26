/**
 * PlanActual — single planned/actual cell for the coach-Log summary
 * strip. Renders "Label   planned / actual unit" with the actual
 * cell tinted by the deviation tone (neutral / amber / red). Designed
 * to be inlined in horizontal rows that summarise an exercise or a
 * full day's training.
 */
import type { MetricPair, SummaryTone } from './logSummary';
import { toneFor } from './logSummary';

const TONE_CLASS: Record<SummaryTone, string> = {
  neutral: 'text-gray-900',
  amber: 'text-amber-700',
  red: 'text-red-700',
  pending: 'text-gray-300',
};

interface Props {
  label: string;
  metric: MetricPair;
  /** Suffix shown after the actual cell ("kg", "%RPE", …). Optional. */
  unit?: string;
  /** Decimal places for both planned and actual. 0 (default) for sets /
   *  reps, 1 for kg averages. */
  decimals?: number;
  /** Tone override; defaults to toneFor(metric). */
  tone?: SummaryTone;
}

function format(n: number | null, decimals: number): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

export function PlanActual({ label, metric, unit, decimals = 0, tone }: Props) {
  const resolved = tone ?? toneFor(metric);
  const actualClass = TONE_CLASS[resolved];
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
        {label}
      </span>
      <span className="text-[11px] text-gray-500">{format(metric.planned, decimals)}</span>
      <span className="text-[10px] text-gray-300">/</span>
      <span className={`text-[11px] font-medium ${actualClass}`}>
        {format(metric.actual, decimals)}
      </span>
      {unit && <span className="text-[9px] text-gray-400">{unit}</span>}
    </span>
  );
}
