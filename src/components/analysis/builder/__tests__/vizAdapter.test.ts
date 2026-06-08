import { describe, it, expect } from 'vitest';
import { toChartModel, mergeCompare } from '../vizAdapter';
import { weekStartsBetween } from '../../../../lib/dateUtils';
import type { AnalysisResult, AnalysisQuery } from '../../../../lib/analysis';

const QUERY: AnalysisQuery = {
  version: 1,
  scope: { mode: 'dateRange', from: '2026-05-04', to: '2026-06-07' },
  subjects: { athletes: ['A1'], groups: [], normalization: 'none' },
  filters: [],
  rows: ['week'],
  cols: [],
  measures: [{ metricId: 'volume', agg: 'sum', state: 'performed' }],
  viz: { type: 'line' },
};

function weekResult(window: { from: string; to: string }, present: Record<string, number>): AnalysisResult {
  const rowKeys = Object.keys(present).map((w) => [w]);
  return {
    query: QUERY,
    rowDimensions: ['week'],
    colDimensions: [],
    measures: [{ key: 'volume::performed', metricId: 'volume', label: 'Tonnage', unit: 'kg', agg: 'sum', state: 'performed' }],
    rowKeys,
    colKeys: [],
    records: rowKeys.map((rk) => ({ row: rk, col: [], values: { 'volume::performed': present[rk[0]] } })),
    subtotals: [],
    grandTotal: [],
    meta: {
      factCount: rowKeys.length,
      plannedFactCount: 0,
      performedFactCount: rowKeys.length,
      unresolvedPctFacts: 0,
      athleteIds: ['A1'],
      normalization: 'none',
      availableValues: {},
      window,
      notes: [],
    },
  };
}

describe('toChartModel — weekly densification', () => {
  it('fills empty weeks across the full scope window', () => {
    const window = { from: '2026-05-04', to: '2026-06-07' };
    const model = toChartModel(weekResult(window, { '2026-05-18': 1000, '2026-06-01': 1500 }));
    expect(model.data.length).toBe(weekStartsBetween(window.from, window.to).length); // dense, not 2
    const seriesKey = model.series[0].key;
    const present = model.data.filter((d) => d[seriesKey] != null);
    expect(present.length).toBe(2);
  });
});

describe('mergeCompare — period-over-period aligns by position', () => {
  it('aligns same-length densified periods week-for-week', () => {
    const base = toChartModel(weekResult({ from: '2026-05-04', to: '2026-06-07' }, { '2026-06-01': 1500 }));
    const prev = toChartModel(weekResult({ from: '2026-03-30', to: '2026-05-03' }, { '2026-04-27': 1200 }));
    expect(base.data.length).toBe(prev.data.length); // equal length → positional alignment is valid
    const merged = mergeCompare(base, prev);
    // ghost series exist and carry the prev value at the matching ordinal week
    expect(merged.series.some((s) => s.key.endsWith('__prev'))).toBe(true);
    const ghostKey = merged.series.find((s) => s.key.endsWith('__prev'))!.key;
    const ghostValues = merged.data.map((d) => d[ghostKey]).filter((v) => v != null);
    expect(ghostValues).toContain(1200);
  });
});
