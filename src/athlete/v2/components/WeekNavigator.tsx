import { ChevronLeft, ChevronRight, Home } from 'lucide-react';

const WEEKDAY_SHORT: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

function parseISO(date: string): Date {
  return new Date(date + 'T00:00:00');
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(date: string, n: number): string {
  const d = parseISO(date);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function getMondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return toISO(d);
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
