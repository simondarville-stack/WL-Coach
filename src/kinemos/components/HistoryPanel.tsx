/**
 * HistoryPanel — the athlete's analysed lifts of this exercise, this one
 * among them, and the two doors out: compare with one, or see the trend.
 *
 * A table, not a chart: six rows of date, load, Vmax, S_vmax and grade are
 * read faster than a sparkline, and the row a coach wants to argue with is a
 * click from the comparison view. The current lift is the selected row so
 * the eye lands on it first.
 */
import { Columns2, TrendingUp } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from '../../components/ui';
import { formatDateShort } from '../../lib/dateUtils';
import type { HistoryRow } from '../lib/history';
import { num } from '../lib/viewerFormat';
import { HeadlineChip } from './RailPanel';

interface HistoryPanelProps {
  rows: HistoryRow[];
  exerciseName: string | null;
  /** Whether this lift can be compared at all — calibrated and marked. */
  comparable: boolean;
  onCompare: (analysisId: string | null) => void;
  canTrend: boolean;
  onTrends: () => void;
}

export function HistoryPanel({ rows, exerciseName, comparable, onCompare, canTrend, onTrends }: HistoryPanelProps) {
  const earlier = rows.filter(r => !r.current && r.analysisId);
  const reference = earlier.find(r => r.isReference) ?? null;
  const latest = earlier[0] ?? null;
  const target = reference ?? latest;

  return (
    <div>
      {earlier.length === 0 ? (
        <p style={hint}>
          {exerciseName
            ? `No other analysed ${exerciseName} for this athlete yet. The next one lands here, with this lift to compare against.`
            : 'No other analysed lifts for this athlete yet.'}
        </p>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Date</th>
              <th style={{ ...th, ...numeric }}>Load</th>
              <th style={{ ...th, ...numeric }}>Vmax</th>
              <th style={{ ...th, ...numeric }}>S_vmax</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.analysisId ?? 'current'}
                onClick={r.current || !comparable || !r.analysisId ? undefined : () => onCompare(r.analysisId)}
                title={
                  r.current
                    ? 'This lift'
                    : comparable
                      ? 'Compare this lift with it'
                      : 'Comparison needs a calibrated, marked lift'
                }
                style={{
                  background: r.current ? 'var(--color-accent-muted)' : undefined,
                  cursor: r.current || !comparable ? 'default' : 'pointer',
                }}
                className={r.current ? undefined : 'kinemos-history-row'}
              >
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>
                  {r.date ? formatDateShort(r.date) : '—'}
                  {r.isReference && (
                    <span title="The athlete’s reference lift for this exercise" style={{ marginLeft: 4, color: 'var(--color-accent)' }}>
                      ★
                    </span>
                  )}
                </td>
                <td style={{ ...td, ...numeric }}>{r.loadKg === null ? '—' : num(r.loadKg, r.loadKg % 1 === 0 ? 0 : 1)}</td>
                <td style={{ ...td, ...numeric }}>{r.peakVelocityMs === null ? '—' : num(r.peakVelocityMs, 2)}</td>
                <td style={{ ...td, ...numeric }}>{r.sVmaxCm === null ? '—' : num(r.sVmaxCm, 1)}</td>
                <td style={td}>
                  {r.grade ? (
                    <HeadlineChip tone={r.grade === 'A' ? 'success' : r.grade === 'B' ? 'warning' : 'danger'}>{r.grade}</HeadlineChip>
                  ) : (
                    <HeadlineChip>ungraded</HeadlineChip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 12px' }}>
        <Button
          size="sm"
          variant="secondary"
          icon={<Columns2 size={12} />}
          disabled={!comparable}
          onClick={() => onCompare(target?.analysisId ?? null)}
          title={
            !comparable
              ? 'Comparison needs a calibrated, marked lift'
              : target
                ? `Open the comparison on ${target.isReference ? 'the reference lift' : 'the latest lift'}${target.date ? ` (${formatDateShort(target.date)})` : ''}`
                : 'Compare this lift with another of the same athlete, or with a model lift'
          }
        >
          {target?.date ? `Compare with ${formatDateShort(target.date)}` : 'Compare…'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<TrendingUp size={12} />}
          disabled={!canTrend}
          onClick={onTrends}
          title={canTrend ? 'This athlete’s analysed lifts over time and against load' : 'Trends need an athlete on the clip'}
        >
          Trend over time
        </Button>
      </div>
    </div>
  );
}

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--text-label)',
};

const th: CSSProperties = {
  fontSize: 'var(--text-micro)',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-tertiary)',
  textAlign: 'left',
  padding: '5px 12px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '5px 12px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  whiteSpace: 'nowrap',
};

const numeric: CSSProperties = {
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

const hint: CSSProperties = {
  margin: 0,
  padding: 'var(--space-md)',
  fontSize: 'var(--text-caption)',
  lineHeight: 1.4,
  color: 'var(--color-text-tertiary)',
};
