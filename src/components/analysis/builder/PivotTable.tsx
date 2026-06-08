// Renders an AnalysisResult as a pivot table: frozen row-label column, sticky
// (optionally grouped) column headers, one leaf column per measure facet,
// subtotal + grand-total rows (recomputed engine-side), clickable measure
// headers for sort, in-cell value bars, and cell drill-down.

import { memo, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { EmptyState } from '../../ui';
import type { AnalysisResult, ResolvedMeasure, SortSpec } from '../../../lib/analysis';
import { dimLabel } from './dimensions';
import { formatValue, formatDelta } from './format';

interface PivotTableProps {
  result: AnalysisResult;
  onDrill?: (rowKey: string[], colKey: string[]) => void;
  sort?: SortSpec;
  onSortChange?: (s: SortSpec) => void;
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

/** A right-anchored value bar behind the number (planned/performed facets only). */
function valueBar(value: number | null | undefined, colMax: number, m: ResolvedMeasure): string | undefined {
  if (value == null || colMax <= 0 || m.state === 'delta' || m.state === 'adherence') return undefined;
  const pct = Math.min(100, Math.max(0, (Math.abs(value) / colMax) * 100));
  return `linear-gradient(to left, var(--color-accent-muted) ${pct}%, transparent ${pct}%)`;
}

const thBase: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 400,
  fontSize: 'var(--text-label)',
  color: 'var(--color-text-secondary)',
  padding: '10px 12px 8px',
  borderBottom: '0.5px solid var(--color-border-secondary)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  background: 'var(--color-bg-primary)',
};

type DisplayRow = { kind: 'detail'; rk: string[] } | { kind: 'subtotal'; first: string } | { kind: 'grand' };

function PivotTableImpl({ result, onDrill, sort, onSortChange }: PivotTableProps) {
  const measures = result.measures;
  const colDims = result.colDimensions.filter((a) => a !== 'state');
  const rowDims = result.rowDimensions.filter((a) => a !== 'state');
  const hasCols = colDims.length > 0;
  const colKeys = hasCols ? result.colKeys : [[]];

  const { lookup, subLookup, grandLookup, colMax } = useMemo(() => {
    const lookup = new Map<string, Record<string, number | null>>();
    for (const rec of result.records) lookup.set(JSON.stringify([rec.row, rec.col]), rec.values);
    const subLookup = new Map<string, Record<string, number | null>>();
    for (const rec of result.subtotals) subLookup.set(JSON.stringify([rec.row, rec.col]), rec.values);
    const grandLookup = new Map<string, Record<string, number | null>>();
    for (const rec of result.grandTotal) grandLookup.set(JSON.stringify(rec.col), rec.values);
    // Per-(colKey,measure) max absolute value for value bars.
    const colMax = new Map<string, number>();
    for (const rec of result.records) {
      for (const m of result.measures) {
        const v = rec.values[m.key];
        if (v == null) continue;
        const k = JSON.stringify([rec.col, m.key]);
        colMax.set(k, Math.max(colMax.get(k) ?? 0, Math.abs(v)));
      }
    }
    return { lookup, subLookup, grandLookup, colMax };
  }, [result]);

  if (measures.length === 0) return <EmptyState message="Add at least one measure to see results." />;
  if (result.rowKeys.length === 0) return <EmptyState message="No data in this scope for the selected subjects." />;

  const leaves: { colKey: string[]; measure: ResolvedMeasure }[] = [];
  for (const ck of colKeys) for (const m of measures) leaves.push({ colKey: ck, measure: m });

  const showTotals = result.meta.normalization === 'none';
  const showSubtotals = showTotals && rowDims.length >= 2;
  const showGrand = showTotals && rowDims.length >= 1 && result.grandTotal.length > 0 && result.rowKeys.length > 1;

  // Build the ordered list of display rows (details, group subtotals, grand total).
  const displayRows: DisplayRow[] = [];
  if (showSubtotals) {
    let i = 0;
    while (i < result.rowKeys.length) {
      const first = result.rowKeys[i][0];
      while (i < result.rowKeys.length && result.rowKeys[i][0] === first) {
        displayRows.push({ kind: 'detail', rk: result.rowKeys[i] });
        i += 1;
      }
      displayRows.push({ kind: 'subtotal', first });
    }
  } else {
    for (const rk of result.rowKeys) displayRows.push({ kind: 'detail', rk });
  }
  if (showGrand) displayRows.push({ kind: 'grand' });

  const groupHeaderTop = 0;
  const leafHeaderTop = hasCols ? 31 : 0;
  const firstColSticky: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-bg-primary)' };

  const clickSort = (key: string) => {
    if (!onSortChange) return;
    const dir = sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc';
    onSortChange({ key, dir });
  };

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          {hasCols && (
            <tr>
              {rowDims.map((d, i) => (
                <th key={`spacer-${d}`} style={{ ...thBase, borderBottom: 'none', position: 'sticky', top: groupHeaderTop, ...(i === 0 ? { left: 0, zIndex: 4 } : { zIndex: 3 }) }} />
              ))}
              {colKeys.map((ck) => (
                <th key={`grp-${JSON.stringify(ck)}`} colSpan={measures.length} style={{ ...thBase, position: 'sticky', top: groupHeaderTop, zIndex: 2, textAlign: 'center', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {ck.join(' · ') || '—'}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {rowDims.length === 0 ? (
              <th style={{ ...thBase, textAlign: 'left', position: 'sticky', top: leafHeaderTop, left: 0, zIndex: 4 }}>Total</th>
            ) : (
              rowDims.map((d, i) => (
                <th key={`rh-${d}`} style={{ ...thBase, textAlign: 'left', position: 'sticky', top: leafHeaderTop, ...(i === 0 ? { left: 0, zIndex: 4 } : { zIndex: 3 }) }}>
                  {dimLabel(d)}
                </th>
              ))
            )}
            {leaves.map(({ measure }, i) => {
              const sorted = sort?.key === measure.key;
              return (
                <th
                  key={`lh-${i}`}
                  onClick={onSortChange ? () => clickSort(measure.key) : undefined}
                  style={{ ...thBase, position: 'sticky', top: leafHeaderTop, zIndex: 2, cursor: onSortChange ? 'pointer' : 'default', color: sorted ? 'var(--color-accent)' : thBase.color }}
                  title={onSortChange ? `Sort by ${measure.label}` : undefined}
                >
                  {measure.label}
                  {FACET_TAG[measure.state] && <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}> {FACET_TAG[measure.state]}</span>}
                  {sorted && (sort!.dir === 'desc' ? <ChevronDown size={11} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /> : <ChevronUp size={11} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} />)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((dr, ri) => {
            if (dr.kind === 'detail') {
              return (
                <tr key={`d-${JSON.stringify(dr.rk)}`}>
                  {rowDims.length === 0 ? (
                    <td style={{ ...tdLabel, ...firstColSticky }}>Total</td>
                  ) : (
                    dr.rk.map((v, i) => (
                      <td key={i} style={{ ...tdLabel, ...(i === 0 ? firstColSticky : {}) }}>{v}</td>
                    ))
                  )}
                  {leaves.map(({ colKey, measure }, i) => {
                    const value = lookup.get(JSON.stringify([dr.rk, colKey]))?.[measure.key] ?? null;
                    const max = colMax.get(JSON.stringify([colKey, measure.key])) ?? 0;
                    return (
                      <td
                        key={i}
                        onClick={onDrill ? () => onDrill(dr.rk, colKey) : undefined}
                        style={{ ...tdValue, color: measure.state === 'delta' ? deltaColor(value) : 'var(--color-text-primary)', cursor: onDrill ? 'pointer' : 'default', background: valueBar(value, max, measure) }}
                        title={onDrill ? 'Drill into this cell' : undefined}
                      >
                        {cellText(value, measure)}
                      </td>
                    );
                  })}
                </tr>
              );
            }
            if (dr.kind === 'subtotal') {
              return (
                <tr key={`s-${dr.first}-${ri}`} style={{ background: 'var(--color-bg-secondary)' }}>
                  <td colSpan={Math.max(1, rowDims.length)} style={{ ...tdLabel, ...firstColSticky, background: 'var(--color-bg-secondary)', fontWeight: 600, borderTop: '0.5px solid var(--color-border-secondary)' }}>
                    {dr.first} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>subtotal</span>
                  </td>
                  {leaves.map(({ colKey, measure }, i) => {
                    const value = subLookup.get(JSON.stringify([[dr.first], colKey]))?.[measure.key] ?? null;
                    return (
                      <td key={i} style={{ ...tdValue, fontWeight: 600, background: 'var(--color-bg-secondary)', borderTop: '0.5px solid var(--color-border-secondary)', color: measure.state === 'delta' ? deltaColor(value) : 'var(--color-text-primary)' }}>
                        {cellText(value, measure)}
                      </td>
                    );
                  })}
                </tr>
              );
            }
            // grand total
            return (
              <tr key="grand">
                <td colSpan={Math.max(1, rowDims.length)} style={{ ...tdLabel, ...firstColSticky, fontWeight: 600, borderTop: '1px solid var(--color-border-primary)' }}>Total</td>
                {leaves.map(({ colKey, measure }, i) => {
                  const value = grandLookup.get(JSON.stringify(colKey))?.[measure.key] ?? null;
                  return (
                    <td key={i} style={{ ...tdValue, fontWeight: 600, borderTop: '1px solid var(--color-border-primary)', color: measure.state === 'delta' ? deltaColor(value) : 'var(--color-text-primary)' }}>
                      {cellText(value, measure)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const PivotTable = memo(PivotTableImpl);

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
