import { ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { getMondayOfWeekISO } from '../../../lib/weekUtils';

// Q-13 investigation result: day_schedule stores 0=Mon, 1=Tue, ..., 6=Sun
// (confirmed by migration 20260405_day_schedule.sql and PlannerControlPanel.tsx
// WEEKDAY_SHORT array). The previous 1-based keys were incorrect and caused
// weekday labels to never display in the athlete app.
const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun',
};

function parseISO(date: string): Date {
  return new Date(date + 'T00:00:00');
}

// Local-date ISO: avoids the UTC drift that toISOString() produces in
// UTC+ timezones. Matches the canonical helper in src/lib/weekUtils.ts.
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(date: string, n: number): string {
  const d = parseISO(date);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function getMondayOf(date: Date): string {
  return getMondayOfWeekISO(date);
}

function formatWeekRange(weekStart: string): string {
  const start = parseISO(weekStart);
  const end = parseISO(weekStart);
  end.setDate(end.getDate() + 6);
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

interface WeekNavigatorProps {
  weekStart: string;
  onChange: (next: string) => void;
}

export function WeekNavigator({ weekStart, onChange }: WeekNavigatorProps) {
  const thisWeekStart = getMondayOf(new Date());
  const isThisWeek = weekStart === thisWeekStart;

  return (
    <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5">
      <button
        onClick={() => onChange(addDays(weekStart, -7))}
        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
        aria-label="Previous week"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="flex-1 text-center">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          {isThisWeek ? 'This week' : 'Week of'}
        </div>
        <div className="text-xs font-semibold text-white">{formatWeekRange(weekStart)}</div>
      </div>
      <button
        onClick={() => onChange(addDays(weekStart, 7))}
        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
        aria-label="Next week"
      >
        <ChevronRight size={16} />
      </button>
      {!isThisWeek && (
        <button
          onClick={() => onChange(thisWeekStart)}
          className="ml-1 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
          aria-label="This week"
          title="Jump to this week"
        >
          <Home size={14} />
        </button>
      )}
    </div>
  );
}

export const Weekday = WEEKDAY_SHORT;
export { getMondayOf, toISO, parseISO, addDays };
