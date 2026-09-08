/**
 * history — the athlete's analysed lifts of this exercise as table rows.
 *
 * Read from the cache column of each earlier analysis (`fromStoredMetrics`),
 * so listing a season costs no pipeline run; the current lift's row comes
 * from the viewer's live numbers and is marked as such.
 */
import { fromStoredMetrics } from '../engine/metricCatalogue';
import type { ComparisonCandidate } from './comparisonService';

export interface HistoryRow {
  analysisId: string | null;
  date: string | null;
  loadKg: number | null;
  peakVelocityMs: number | null;
  sVmaxCm: number | null;
  grade: 'A' | 'B' | 'C' | null;
  current: boolean;
  isReference: boolean;
}

/** The rows, newest first, with the current lift among them. */
export function historyRows(
  candidates: readonly ComparisonCandidate[],
  current: HistoryRow,
  limit = 8,
): HistoryRow[] {
  const earlier = candidates
    .filter(c => c.sameExercise && !c.isModel)
    .map<HistoryRow>(c => {
      const stored = fromStoredMetrics(c.analysis.metrics);
      return {
        analysisId: c.analysis.id,
        date: c.clip.date,
        loadKg: c.clip.loadKg,
        peakVelocityMs: stored?.analyzer.vmaxMs ?? stored?.peakVelocityMs ?? null,
        sVmaxCm: stored?.analyzer.sVmaxCm ?? null,
        grade: c.analysis.grade,
        current: false,
        isReference: c.isReference,
      };
    });
  return [current, ...earlier]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (a.current ? -1 : 1))
    .slice(0, limit);
}
