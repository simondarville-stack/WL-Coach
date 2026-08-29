import { CheckCircle2, CircleDashed, Ban } from 'lucide-react';
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
      <div className="text-xs text-[color:var(--color-text-secondary)] italic text-center py-4">
        No training planned for this week.
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
      {days.map(d => {
        const selected = d.dayIndex === selectedDayIndex;
        const done = d.status === 'completed';
        const skipped = d.status === 'skipped';
        const Icon = done ? CheckCircle2 : skipped ? Ban : CircleDashed;
        const iconClass = done ? 'text-emerald-400' : skipped ? 'text-red-400' : 'text-[color:var(--color-text-secondary)]';
        // Weekday source preference:
        //   1. Coach-set day_schedule weekday (Plan-side scheduling).
        //   2. Calendar weekday of an existing logged session date
        //      (useful for bonus days the coach never scheduled).
        //   3. Hide the line entirely — no placeholder dash.
        let weekdayLabel: string | null = null;
        if (d.weekday != null) {
          weekdayLabel = Weekday[d.weekday];
        } else if (d.sessionDate) {
          // Convert JS getDay() (0=Sun,1=Mon..6=Sat) to DB convention (0=Mon..6=Sun).
          const jsDay = new Date(d.sessionDate + 'T00:00:00').getDay();
          weekdayLabel = Weekday[(jsDay + 6) % 7];
        }

        return (
          <button
            key={d.dayIndex}
            onClick={() => !disabled && onSelect(d.dayIndex)}
            disabled={disabled}
            title={skipped ? (d.skippedReason ? `Not done: ${d.skippedReason}` : 'Not done') : undefined}
            className={`
              flex-1 min-w-[88px] snap-start rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60
              ${selected
                ? 'bg-blue-950/60 border-[color:var(--color-accent)] ring-1 ring-blue-500/50'
                : 'bg-[var(--color-bg-primary)] border-[color:var(--color-border-tertiary)] hover:border-[color:var(--color-border-secondary)]'}
            `}
          >
            <div className="flex items-center justify-between gap-2 min-h-[14px]">
              <div className="text-[length:var(--text-caption)] uppercase tracking-wide font-semibold text-[color:var(--color-text-secondary)]">
                {weekdayLabel ?? (d.isBonus ? 'Extra' : '')}
              </div>
              <Icon size={12} className={iconClass} />
            </div>
            <div className={`text-sm font-bold truncate ${selected ? 'text-white' : 'text-[color:var(--color-text-primary)]'}`}>
              {d.label}
            </div>
            <div className="text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)] mt-0.5">
              {d.plannedCount > 0 ? `${d.plannedCount} ex.` : 'no plan'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
