import type { WeekdayCell } from '../../lib/restCalculation';

interface RecoveryStripProps {
  cells: WeekdayCell[];
  columnTemplate?: string;
}

function recoveryColor(cell: WeekdayCell): string {
  if (cell.isRestDay) return 'var(--color-bg-tertiary)';
  if (cell.recoveryFromPrevTraining === null) return 'var(--color-success-text)';
  if (cell.recoveryFromPrevTraining >= 48) return 'var(--color-success-text)';
  if (cell.recoveryFromPrevTraining >= 24) return 'var(--color-warning-text)';
  return 'var(--color-danger-text)';
}

export function RecoveryStrip({ cells, columnTemplate }: RecoveryStripProps) {
  if (cells.length === 0) return null;
  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: columnTemplate ?? 'repeat(7, 1fr)',
        gap: 8,
        height: 6,
      }}>
        {cells.map(cell => (
          <div
            key={cell.weekday}
            style={{ borderRadius: 99, backgroundColor: recoveryColor(cell) }}
            title={cell.isRestDay
              ? 'Rest'
              : cell.recoveryFromPrevTraining !== null
                ? `${cell.recoveryFromPrevTraining}h since last session`
                : 'First session'}
          />
        ))}
      </div>
    </div>
  );
}
