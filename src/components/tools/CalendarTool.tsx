import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { useAthleteStore } from '../../store/athleteStore';
import type { Event, MacroWeek } from '../../lib/database.types';

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** ISO 8601 week number (European: Mon=1, week containing first Thursday = W01) */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Build a 6×7 calendar grid (Monday-first). Each row = one ISO week. */
function buildGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Mon = 0
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_NAMES = ['Mo','Tu','We','Th','Fr','Sa','Su'];

const EVENT_TYPE_COLORS: Record<string, string> = {
  competition:   '#dc2626',
  training_camp: '#2563eb',
  seminar:       '#7c3aed',
  testing_day:   '#d97706',
  team_meeting:  '#059669',
  other:         '#6b7280',
};

// Week-type to short label
const WEEK_TYPE_ABBR: Record<string, string> = {
  High: 'H', Medium: 'M', Low: 'L', Deload: 'D',
  Competition: 'C', Taper: 'T', Vacation: 'V',
};

interface MacroCycleInfo {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  weeks: MacroWeek[];
}

interface CalendarToolProps {
  onClose: () => void;
  positionClass?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarTool({ onClose, positionClass = 'bottom-4 right-4' }: CalendarToolProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState<Event[]>([]);
  const [macroCycle, setMacroCycle] = useState<MacroCycleInfo | null>(null);

  const { selectedAthlete } = useAthleteStore();

  const rows = buildGrid(year, month);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchMonthData = useCallback(async () => {
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Events
    const { data: evData } = await supabase
      .from('events')
      .select('*')
      .eq('owner_id', getOwnerId())
      .gte('event_date', start)
      .lte('event_date', end)
      .order('event_date', { ascending: true });
    setEvents(evData || []);

    // Macro cycle for selected athlete (overlapping this month)
    if (selectedAthlete) {
      const { data: cycles } = await supabase
        .from('macrocycles')
        .select('id, name, start_date, end_date')
        .eq('athlete_id', selectedAthlete.id)
        .lte('start_date', end)
        .gte('end_date', start)
        .order('start_date', { ascending: false })
        .limit(1);

      if (cycles && cycles.length > 0) {
        const cycle = cycles[0];
        const { data: wks } = await supabase
          .from('macro_weeks')
          .select('*')
          .eq('macrocycle_id', cycle.id)
          .order('week_number', { ascending: true });
        setMacroCycle({ ...cycle, weeks: wks || [] });
      } else {
        setMacroCycle(null);
      }
    } else {
      setMacroCycle(null);
    }
  }, [year, month, selectedAthlete]);

  useEffect(() => { fetchMonthData(); }, [fetchMonthData]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  // ── Derived maps ───────────────────────────────────────────────────────────

  const eventsByDate = events.reduce((acc, ev) => {
    const key = ev.event_date.slice(0, 10);
    (acc[key] ??= []).push(ev);
    return acc;
  }, {} as Record<string, Event[]>);

  // macro weeks keyed by their Monday date string
  const macroWeekByMonday = (macroCycle?.weeks ?? []).reduce((acc, w) => {
    acc[w.week_start] = w;
    return acc;
  }, {} as Record<string, MacroWeek>);

  const todayKey = toDateKey(today);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={`fixed z-50 w-[320px] bg-white rounded-xl border border-gray-200 shadow-xl flex flex-col overflow-hidden ${positionClass}`}
      role="dialog"
      aria-label="Calendar"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
        <span className="text-sm font-medium text-gray-900">Calendar</span>
        {selectedAthlete && (
          <span className="text-[9px] text-blue-500 font-medium truncate max-w-[120px]">
            {selectedAthlete.name}
          </span>
        )}
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={goToday}
          className="text-[12px] font-semibold text-gray-800 hover:text-blue-600 transition-colors"
          title="Go to today"
        >
          {MONTH_NAMES[month]} {year}
        </button>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Grid */}
      <div className="px-2 pb-2">
        {/* Column headers: Wk + Mo–Su */}
        <div className="grid grid-cols-[26px_repeat(7,1fr)] mb-0.5">
          <div className="text-[8px] font-medium text-gray-300 text-center">Wk</div>
          {DAY_NAMES.map(d => (
            <div key={d} className="text-[8px] font-medium text-gray-400 text-center">{d}</div>
          ))}
        </div>

        {rows.map((row, ri) => {
          // Find Monday of this row for ISO week + macro lookup
          const monday = row.find(d => d !== null) ?? null;
          const mondayKey = monday ? toDateKey(monday) : null;
          // Find the Monday specifically (col 0 in Mon-first grid)
          const actualMonday = row[0];
          const isoWeek = actualMonday ? getISOWeek(actualMonday) : (monday ? getISOWeek(monday) : null);
          const macroWeek = mondayKey ? macroWeekByMonday[mondayKey] : null;

          const weekTypeAbbr = macroWeek
            ? (WEEK_TYPE_ABBR[macroWeek.week_type || ''] ?? macroWeek.week_type?.slice(0, 1)?.toUpperCase() ?? '')
            : null;

          return (
            <div
              key={ri}
              className={`grid grid-cols-[26px_repeat(7,1fr)] rounded mb-px ${macroWeek ? 'bg-blue-50/60' : ''}`}
            >
              {/* ISO week number */}
              <div className="flex flex-col items-center justify-center py-0.5">
                <span className={`text-[8px] font-medium leading-tight ${macroWeek ? 'text-blue-400' : 'text-gray-300'}`}>
                  {isoWeek ?? ''}
                </span>
                {weekTypeAbbr && (
                  <span className="text-[6px] leading-none text-blue-300">{weekTypeAbbr}</span>
                )}
              </div>

              {/* Day cells */}
              {row.map((day, di) => {
                if (!day) return <div key={di} />;
                const key = toDateKey(day);
                const dayEvents = eventsByDate[key] || [];
                const isToday = key === todayKey;
                const isWeekend = di >= 5;

                return (
                  <div key={di} className="flex flex-col items-center py-0.5 gap-px">
                    <div
                      className={`w-[18px] h-[18px] flex items-center justify-center rounded-full text-[9px] font-medium leading-none
                        ${isToday
                          ? 'bg-blue-600 text-white'
                          : isWeekend
                            ? 'text-gray-400'
                            : 'text-gray-700'}
                      `}
                    >
                      {day.getDate()}
                    </div>

                    {/* Event dots */}
                    {dayEvents.length > 0 && (
                      <div className="flex gap-px justify-center">
                        {dayEvents.slice(0, 3).map((ev, ei) => (
                          <div
                            key={ei}
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: ev.color || EVENT_TYPE_COLORS[ev.event_type] || '#6b7280' }}
                            title={ev.name}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Macro cycle banner */}
      {macroCycle && (
        <div className="px-3 py-1.5 border-t border-blue-100 bg-blue-50/40 text-[9px] text-blue-600 font-medium flex items-center gap-1.5 truncate">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
          {macroCycle.name}
          <span className="text-blue-300 font-normal ml-auto flex-shrink-0">
            {macroCycle.weeks.length}w
          </span>
        </div>
      )}
      {selectedAthlete && !macroCycle && (
        <div className="px-3 py-1.5 border-t border-gray-100 text-[9px] text-gray-400 italic">
          No macro cycle this month
        </div>
      )}

      {/* Events list */}
      {events.length > 0 ? (
        <div className="border-t border-gray-100 max-h-[110px] overflow-y-auto">
          {events.map(ev => (
            <div key={ev.id} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50">
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: ev.color || EVENT_TYPE_COLORS[ev.event_type] || '#6b7280' }}
              />
              <span className="text-[10px] font-medium text-gray-700 flex-1 truncate">{ev.name}</span>
              <span className="text-[9px] text-gray-400 flex-shrink-0">
                {new Date(ev.event_date + 'T00:00:00').getDate()}{' '}
                {MONTH_NAMES[new Date(ev.event_date + 'T00:00:00').getMonth()].slice(0, 3)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-gray-100 text-[9px] text-gray-400 text-center italic">
          No events this month
        </div>
      )}
    </div>
  );
}
