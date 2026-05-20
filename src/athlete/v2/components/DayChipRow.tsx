import { CheckCircle2, CircleDashed } from 'lucide-react';
import type { WeekDayOverview } from '../../../lib/trainingLogService';
import { Weekday } from './WeekNavigator';

interface DayChipRowProps {
  days: WeekDayOverview[];
  selectedDayIndex: number | null;
  onSelect: (dayIndex: number) => void;
  /** When true, day chips are non-interactive (a save is in flight). */
  disabled?: boolean;
}

export function DayChipRow({ days, selectedDayIndex, onSelect, disabled = false }: DayChipRowProps) {
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
        const done = d.status === 'completed';
        const Icon = done ? CheckCircle2 : CircleDashed;
        const iconClass = done ? 'text-emerald-400' : 'text-gray-500';
        // Weekday source preference:
        //   1. Coach-set day_schedule weekday (Plan-side scheduling).
        //   2. Calendar weekday of an existing logged session date
        //      (useful for bonus days the coach never scheduled).
        //   3. Hide the line entirely — no placeholder dash.
        let weekdayLabel: string | null = null;
        if (d.weekday != null) {
          weekdayLabel = Weekday[d.weekday];
        } else if (d.sessionDate) {
          const day = new Date(d.sessionDate + 'T00:00:00').getDay();
          weekdayLabel = Weekday[day === 0 ? 7 : day];
        }

        return (
          <button
            key={d.dayIndex}
            onClick={() => !disabled && onSelect(d.dayIndex)}
            disabled={disabled}
            className={`
              flex-1 min-w-[88px] snap-start rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60
              ${selected
                ? 'bg-blue-950/60 border-blue-600 ring-1 ring-blue-500/50'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'}
            `}
          >
            <div className="flex items-center justify-between gap-2 min-h-[14px]">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">
                {weekdayLabel ?? (d.isBonus ? 'Extra' : '')}
              </div>
              <Icon size={12} className={iconClass} />
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
