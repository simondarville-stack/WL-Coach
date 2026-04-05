import type { WeekdayCell } from '../../lib/restCalculation';

interface RecoveryStripProps {
  cells: WeekdayCell[];
}

export function RecoveryStrip({ cells }: RecoveryStripProps) {
  if (cells.length === 0) return null;
  return (
    <div className="px-0 pb-2">
      <div className="grid grid-cols-7 gap-2" style={{ height: 6 }}>
        {cells.map(cell => {
          let bg = 'bg-gray-100';
          if (!cell.isRestDay) {
            if (cell.recoveryFromPrevTraining === null) bg = 'bg-teal-400';
            else if (cell.recoveryFromPrevTraining >= 48) bg = 'bg-teal-400';
            else if (cell.recoveryFromPrevTraining >= 24) bg = 'bg-amber-400';
            else bg = 'bg-red-400';
          }
          return (
            <div
              key={cell.weekday}
              className={`rounded-full ${bg}`}
              title={cell.isRestDay
                ? 'Rest'
                : cell.recoveryFromPrevTraining !== null
                  ? `${cell.recoveryFromPrevTraining}h since last session`
                  : 'First session'}
            />
          );
        })}
      </div>
    </div>
  );
}
