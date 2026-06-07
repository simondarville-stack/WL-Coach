// Cell drill-down. The parent builds a drill query (the base query re-scoped to
// the clicked cell, grouped by exercise) and this panel renders its result —
// a SECOND runAnalysisQuery call, never in-component re-aggregation (UX-03).

import { SidePanel, Spinner } from '../../ui';
import type { AnalysisQuery } from '../../../lib/analysis';
import { useRunQuery } from './useRunQuery';
import { PivotTable } from './PivotTable';

interface DrillPanelProps {
  query: AnalysisQuery | null;
  title: string;
  onClose: () => void;
}

export function DrillPanel({ query, title, onClose }: DrillPanelProps) {
  const { result, loading, error } = useRunQuery(query ?? blank, query != null);
  return (
    <SidePanel isOpen={query != null} onClose={onClose} title={title} width="editor">
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-xl)' }}>
          <Spinner />
        </div>
      )}
      {error && <p style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-label)' }}>{error}</p>}
      {!loading && !error && result && <PivotTable result={result} />}
    </SidePanel>
  );
}

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
