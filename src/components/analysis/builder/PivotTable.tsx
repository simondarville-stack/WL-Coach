// Renders an AnalysisResult as a pivot table: row-dimension headers on the
// left, (optional) column-dimension groups across the top, one leaf column per
// measure facet. Cells are clickable to drill into the underlying work.

import type { AnalysisResult, ResolvedMeasure } from '../../../lib/analysis';
import { dimLabel } from './dimensions';
import { formatValue, formatDelta } from './format';

interface PivotTableProps {
  result: AnalysisResult;
  onDrill?: (rowKey: string[], colKey: string[]) => void;
}

const FACET_TAG: Record<ResolvedMeasure['state'], string> = {
  planned: 'plan',
  performed: 'perf',
  both: '',
  delta: 'Δ',
  adherence: 'adh',
};

function cellText(value: number | null | undefined, m: ResolvedMeasure): string {
  if (m.state === 'adherence') return value == null ? '—' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 0 })}%`;
  if (m.state === 'delta') return formatDelta(value, m.unit);
  return formatValue(value, m.unit);
}

function deltaColor(value: number | null | undefined): string {
  if (value == null || value === 0) return 'var(--color-text-primary)';
  return value > 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)';
}

const th: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 400,
  fontSize: 'var(--text-label)',
  color: 'var(--color-text-secondary)',
  padding: '10px 12px 8px',
  borderBottom: '0.5px solid var(--color-border-secondary)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

export function PivotTable({ result, onDrill }: PivotTableProps) {
  const measures = result.measures;
  const colDims = result.colDimensions.filter((a) => a !== 'state');
  const rowDims = result.rowDimensions.filter((a) => a !== 'state');
  const hasCols = colDims.length > 0;
  const colKeys = hasCols ? result.colKeys : [[]];

  // (rowKey, colKey) → measureKey → value
  const lookup = new Map<string, Record<string, number | null>>();
  for (const rec of result.records) lookup.set(JSON.stringify([rec.row, rec.col]), rec.values);

  const leaves: { colKey: string[]; measure: ResolvedMeasure }[] = [];
  for (const ck of colKeys) for (const m of measures) leaves.push({ colKey: ck, measure: m });

  if (measures.length === 0) {
    return <Empty label="Add at least one measure to see results." />;
  }
  if (result.rowKeys.length === 0) {
    return <Empty label="No data in this scope for the selected subjects." />;
  }

  return (
    <div style={{ overflow: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-label)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          {hasCols && (
            <tr>
              {rowDims.map((d) => (
                <th key={`spacer-${d}`} style={{ ...th, borderBottom: 'none' }} />
              ))}
              {colKeys.map((ck) => (
                <th
                  key={`grp-${JSON.stringify(ck)}`}
                  colSpan={measures.length}
                  style={{ ...th, textAlign: 'center', color: 'var(--color-text-primary)', fontWeight: 500 }}
                >
                  {ck.join(' · ') || '—'}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {rowDims.length === 0 ? (
              <th style={{ ...th, textAlign: 'left' }}>Total</th>
            ) : (
              rowDims.map((d) => (
                <th key={`rh-${d}`} style={{ ...th, textAlign: 'left' }}>
                  {dimLabel(d)}
                </th>
              ))
            )}
            {leaves.map(({ measure }, i) => (
              <th key={`lh-${i}`} style={th}>
                {measure.label}
                {FACET_TAG[measure.state] && (
                  <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}> {FACET_TAG[measure.state]}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rowKeys.map((rk) => (
            <tr key={JSON.stringify(rk)}>
              {rowDims.length === 0 ? (
                <td style={tdLabel}>Total</td>
              ) : (
                rk.map((v, i) => (
                  <td key={i} style={tdLabel}>
                    {v}
                  </td>
                ))
              )}
              {leaves.map(({ colKey, measure }, i) => {
                const values = lookup.get(JSON.stringify([rk, colKey]));
                const value = values ? values[measure.key] : null;
                return (
                  <td
                    key={i}
                    onClick={onDrill ? () => onDrill(rk, colKey) : undefined}
                    style={{
                      ...tdValue,
                      color: measure.state === 'delta' ? deltaColor(value) : 'var(--color-text-primary)',
                      cursor: onDrill ? 'pointer' : 'default',
                    }}
                    title={onDrill ? 'Drill into this cell' : undefined}
                  >
                    {cellText(value, measure)}
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

const tdLabel: React.CSSProperties = {
  padding: '9px 12px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-label)',
  color: 'var(--color-text-primary)',
  whiteSpace: 'nowrap',
};

const tdValue: React.CSSProperties = {
  padding: '9px 12px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  textAlign: 'right',
};

function Empty({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: 'var(--space-2xl)',
        textAlign: 'center',
        color: 'var(--color-text-tertiary)',
        fontSize: 'var(--text-body)',
      }}
    >
      {label}
    </div>
  );
}
