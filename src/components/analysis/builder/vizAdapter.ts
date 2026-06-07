// Adapts an AnalysisResult into a tidy chart model (Recharts-friendly) without
// re-aggregating. One datum per x-axis (row) value; one series per
// column-tuple × measure facet. Colours are facet-aware for a single-metric
// planned/performed view (prescription muted, performed accent) and fall back
// to the entity palette for multi-series. Data-driven colours are honoured;
// neutral chrome only.

import type { AnalysisResult, ResolvedMeasure } from '../../../lib/analysis';
import { dimLabel } from './dimensions';

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  state: ResolvedMeasure['state'];
  metricId: string;
  unit: string;
}

export type ChartDatum = { x: string } & Record<string, number | null | string>;

export interface ChartModel {
  data: ChartDatum[];
  series: ChartSeries[];
  xLabel: string;
}

// Entity palette 400-stops (from tokens.css) for multi-series charts.
const PALETTE = ['#185FA5', '#1D9E75', '#D85A30', '#BA7517', '#7F77DD', '#639922', '#D4537E', '#888780', '#E24B4A'];

function facetColor(state: ResolvedMeasure['state']): string | null {
  switch (state) {
    case 'planned':
      return '#888780'; // gray-400 — prescription, muted
    case 'performed':
      return '#185FA5'; // accent — what was done
    case 'delta':
      return '#BA7517'; // amber-400
    case 'adherence':
      return '#1D9E75'; // teal-400
    default:
      return null;
  }
}

export function toChartModel(result: AnalysisResult): ChartModel {
  const rowDims = result.rowDimensions.filter((a) => a !== 'state');
  const colDims = result.colDimensions.filter((a) => a !== 'state');
  const xLabel = rowDims[0] ? dimLabel(rowDims[0]) : 'Total';
  const colKeys = colDims.length > 0 ? result.colKeys : [[]];

  // Build the series list (colTuple × measure).
  const singleMetric = new Set(result.measures.map((m) => m.metricId)).size === 1 && colKeys.length === 1;
  const series: ChartSeries[] = [];
  let idx = 0;
  for (const ck of colKeys) {
    for (const m of result.measures) {
      const colPrefix = ck.length ? `${ck.join(' · ')} · ` : '';
      const facet = m.state === 'planned' ? ' (plan)' : m.state === 'performed' ? ' (perf)' : m.state === 'delta' ? ' Δ' : m.state === 'adherence' ? ' adh' : '';
      const color = (singleMetric && facetColor(m.state)) || PALETTE[idx % PALETTE.length];
      series.push({
        key: `${JSON.stringify(ck)}|${m.key}`,
        label: `${colPrefix}${m.label}${facet}`,
        color,
        state: m.state,
        metricId: m.metricId,
        unit: m.unit,
      });
      idx += 1;
    }
  }

  // One datum per row key.
  const lookup = new Map<string, Record<string, number | null>>();
  for (const rec of result.records) lookup.set(JSON.stringify([rec.row, rec.col]), rec.values);

  const data: ChartDatum[] = result.rowKeys.map((rk) => {
    const datum: ChartDatum = { x: rk.join(' · ') || 'Total' };
    for (const ck of colKeys) {
      const values = lookup.get(JSON.stringify([rk, ck]));
      for (const m of result.measures) {
        datum[`${JSON.stringify(ck)}|${m.key}`] = values ? values[m.key] : null;
      }
    }
    return datum;
  });

  return { data, series, xLabel };
}

const GHOST_COLOR = '#B4B2A9'; // gray-200 — muted previous-period overlay

/**
 * Merge a previous-period chart model as ghost series, aligned by POSITION
 * (period-over-period: week 1 of this period vs week 1 of the prior period),
 * not by x-value (the dates differ). Ghost series are muted and dashed.
 */
export function mergeCompare(base: ChartModel, compare: ChartModel): ChartModel {
  const data = base.data.map((d, i) => {
    const merged: ChartDatum = { ...d };
    for (const s of base.series) {
      const prev = compare.data[i]?.[s.key];
      merged[`${s.key}__prev`] = typeof prev === 'number' ? prev : null;
    }
    return merged;
  });
  const ghost: ChartSeries[] = base.series.map((s) => ({
    ...s,
    key: `${s.key}__prev`,
    label: `${s.label} (prev)`,
    color: GHOST_COLOR,
  }));
  return { data, series: [...base.series, ...ghost], xLabel: base.xLabel };
}

export function isGhostSeries(key: string): boolean {
  return key.endsWith('__prev');
}
