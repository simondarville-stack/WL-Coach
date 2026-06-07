// CSS-grid heatmap (no charting dependency). Rows = row-dimension tuples,
// columns = column tuples (or the measures when no column dimension). Cell
// shade scales with the first measure's value across the grid.

import type { AnalysisResult } from '../../../lib/analysis';
import { dimLabel } from './dimensions';
import { formatValue } from './format';

export function HeatmapGrid({ result }: { result: AnalysisResult }) {
  const measure = result.measures[0];
  if (!measure || result.rowKeys.length === 0) {
    return <div style={empty}>Add a measure and a row dimension to see a heatmap.</div>;
  }
  const rowDims = result.rowDimensions.filter((a) => a !== 'state');
  const colDims = result.colDimensions.filter((a) => a !== 'state');
  const useCols = colDims.length > 0;
  const cols = useCols ? result.colKeys : result.measures.map((m) => [m.key]);

  const lookup = new Map<string, Record<string, number | null>>();
  for (const rec of result.records) lookup.set(JSON.stringify([rec.row, rec.col]), rec.values);

  const valueAt = (rk: string[], ci: number): number | null => {
    if (useCols) return lookup.get(JSON.stringify([rk, result.colKeys[ci]]))?.[measure.key] ?? null;
    return lookup.get(JSON.stringify([rk, []]))?.[result.measures[ci].key] ?? null;
  };
  const unitAt = (ci: number) => (useCols ? measure.unit : result.measures[ci].unit);

  let min = Infinity;
  let max = -Infinity;
  result.rowKeys.forEach((rk) =>
    cols.forEach((_, ci) => {
      const v = valueAt(rk, ci);
      if (v != null) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }),
  );
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));

  const colHeader = (ci: number): string =>
    useCols ? result.colKeys[ci].join(' · ') || '—' : result.measures[ci].label;

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)' }}>
        <thead>
          <tr>
            <th style={cornerTh}>{rowDims.map(dimLabel).join(' · ') || ''}</th>
            {cols.map((_, ci) => (
              <th key={ci} style={colTh}>
                {colHeader(ci)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rowKeys.map((rk) => (
            <tr key={JSON.stringify(rk)}>
              <td style={rowTh}>{rk.join(' · ') || 'Total'}</td>
              {cols.map((_, ci) => {
                const v = valueAt(rk, ci);
                const n = v == null ? 0 : norm(v);
                return (
                  <td
                    key={ci}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      minWidth: 64,
                      background: v == null ? 'transparent' : `rgba(24, 95, 165, ${0.06 + 0.74 * n})`,
                      color: v != null && n > 0.6 ? '#fff' : 'var(--color-text-primary)',
                      border: '0.5px solid var(--color-bg-primary)',
                    }}
                  >
                    {v == null ? '—' : formatValue(v, unitAt(ci))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cornerTh: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
  fontWeight: 400,
  color: 'var(--color-text-tertiary)',
  fontSize: 'var(--text-caption)',
};
const colTh: React.CSSProperties = { ...cornerTh, textAlign: 'right' };
const rowTh: React.CSSProperties = { ...cornerTh, textAlign: 'left', color: 'var(--color-text-primary)', whiteSpace: 'nowrap' };
const empty: React.CSSProperties = { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-tertiary)' };
