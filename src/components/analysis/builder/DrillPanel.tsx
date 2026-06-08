// Cell drill-down. The parent builds a drill query (the base query re-scoped to
// the clicked cell, grouped by exercise). This panel renders TWO views of it,
// both via the service boundary (never in-component aggregation, UX-03):
//   1. a by-exercise pivot (runAnalysisQuery), and
//   2. the raw underlying contributions (runAnalysisFacts) — the actual planned
//      set-lines and performed sets behind the number.

import { useEffect, useState } from 'react';
import { SidePanel, Spinner } from '../../ui';
import type { AnalysisQuery, FactRow } from '../../../lib/analysis';
import { runAnalysisFacts } from '../../../lib/analysis';
import { formatDateShort } from '../../../lib/dateUtils';
import { useRunQuery } from './useRunQuery';
import { PivotTable } from './PivotTable';
import { formatValue } from './format';

interface DrillPanelProps {
  query: AnalysisQuery | null;
  title: string;
  onClose: () => void;
}

const FACT_CAP = 300;

export function DrillPanel({ query, title, onClose }: DrillPanelProps) {
  const { result, loading, error } = useRunQuery(query ?? blank, query != null);
  const [facts, setFacts] = useState<FactRow[] | null>(null);
  const [factsLoading, setFactsLoading] = useState(false);

  useEffect(() => {
    if (!query) {
      setFacts(null);
      return;
    }
    let active = true;
    setFactsLoading(true);
    runAnalysisFacts(query)
      .then((f) => {
        if (active) {
          setFacts(f);
          setFactsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setFacts([]);
          setFactsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <SidePanel isOpen={query != null} onClose={onClose} title={title} width="editor">
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-xl)' }}>
          <Spinner />
        </div>
      )}
      {error && <p style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-label)' }}>{error}</p>}
      {!loading && !error && result && <PivotTable result={result} />}

      {!loading && (facts != null || factsLoading) && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <div style={sectionLabel}>Contributions{facts ? ` · ${facts.length}` : ''}</div>
          {factsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-md)' }}>
              <Spinner size={16} />
            </div>
          ) : (
            <RawFactsTable facts={facts ?? []} />
          )}
        </div>
      )}
    </SidePanel>
  );
}

function RawFactsTable({ facts }: { facts: FactRow[] }) {
  if (facts.length === 0) {
    return <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>No underlying contributions.</p>;
  }
  const sorted = [...facts].sort(
    (a, b) =>
      a.state.localeCompare(b.state) ||
      (a.date ?? '').localeCompare(b.date ?? '') ||
      a.exerciseName.localeCompare(b.exerciseName),
  );
  const shown = sorted.slice(0, FACT_CAP);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            {['', 'When', 'Exercise', 'Load', 'Reps', 'Sets', '%1RM'].map((h, i) => (
              <th key={i} style={{ ...rawTh, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((f, i) => (
            <tr key={i}>
              <td style={rawTd}>
                <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 'var(--radius-sm)', background: f.state === 'performed' ? 'var(--color-accent-muted)' : 'var(--color-bg-secondary)', color: f.state === 'performed' ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}>
                  {f.state === 'performed' ? 'perf' : 'plan'}
                </span>
              </td>
              <td style={rawTd}>{f.date ? formatDateShort(f.date) : '—'}</td>
              <td style={{ ...rawTd, fontFamily: 'var(--font-sans)' }}>{f.exerciseName}</td>
              <td style={{ ...rawTd, textAlign: 'right' }}>{f.loadIsKg ? formatValue(f.load, 'kg') : f.loadIsPct ? `${f.load}%` : '—'}</td>
              <td style={{ ...rawTd, textAlign: 'right' }}>{f.reps}</td>
              <td style={{ ...rawTd, textAlign: 'right' }}>{f.sets}</td>
              <td style={{ ...rawTd, textAlign: 'right' }}>{f.pct1rm != null ? `${Math.round(f.pct1rm)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {facts.length > FACT_CAP && (
        <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginTop: 4 }}>Showing first {FACT_CAP} of {facts.length}.</p>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-text-tertiary)',
  fontWeight: 500,
  marginBottom: 6,
};

const rawTh: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 400,
  color: 'var(--color-text-tertiary)',
  padding: '4px 8px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  whiteSpace: 'nowrap',
};

const rawTd: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  color: 'var(--color-text-primary)',
  whiteSpace: 'nowrap',
};

// useRunQuery requires a query object even when disabled; this is never run.
const blank: AnalysisQuery = {
  version: 1,
  scope: { mode: 'rolling', windowDays: 1 },
  subjects: { athletes: [], groups: [], normalization: 'none' },
  filters: [],
  rows: [],
  cols: [],
  measures: [],
  viz: { type: 'table' },
};
