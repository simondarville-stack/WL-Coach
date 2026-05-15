import { CheckCircle2, Circle, CircleDashed, MinusCircle } from 'lucide-react';
import type { WeekDayOverview } from '../../../lib/trainingLogService';
import { Weekday } from './WeekNavigator';

const STATUS_ICON: Record<WeekDayOverview['status'], typeof CheckCircle2> = {
  pending: CircleDashed,
  in_progress: Circle,
  completed: CheckCircle2,
  skipped: MinusCircle,
};

const STATUS_COLOR: Record<WeekDayOverview['status'], string> = {
  pending: 'text-gray-500',
  in_progress: 'text-amber-400',
  completed: 'text-emerald-400',
  skipped: 'text-red-400',
};

interface DayChipRowProps {
  days: WeekDayOverview[];
  selectedDayIndex: number | null;
  onSelect: (dayIndex: number) => void;
}

export function DayChipRow({ days, selectedDayIndex, onSelect }: DayChipRowProps) {
  if (days.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic text-center py-4">
        No training planned for this week.
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
      {days.map(d => {
        const selected = d.dayIndex === selectedDayIndex;
        const Icon = STATUS_ICON[d.status];
        const weekdayLabel = d.weekday != null ? Weekday[d.weekday] : null;

        return (
          <button
            key={d.dayIndex}
            onClick={() => onSelect(d.dayIndex)}
            className={`
              flex-1 min-w-[88px] snap-start rounded-lg border px-3 py-2 text-left transition-colors
              ${selected
                ? 'bg-blue-950/60 border-blue-600 ring-1 ring-blue-500/50'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'}
            `}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">
                {weekdayLabel ?? '—'}
              </div>
              <Icon size={12} className={STATUS_COLOR[d.status]} />
            </div>
            <div className={`text-sm font-bold truncate ${selected ? 'text-white' : 'text-gray-200'}`}>
              {d.label}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {d.plannedCount > 0 ? `${d.plannedCount} ex.` : 'no plan'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
