import { useState, useEffect } from 'react';
import { Plus, ChevronLeft, ChevronRight, LayoutList, CalendarDays, Download } from 'lucide-react';
import type { Athlete } from '../../lib/database.types';
import type { EventWithAthletes } from '../../hooks/useEvents';
import { useEvents } from '../../hooks/useEvents';
import { useAthletes } from '../../hooks/useAthletes';
import { EventFormModal } from './EventFormModal';
import { EventDetailModal } from './EventDetailModal';
import { EventAttemptsModal } from '../EventAttemptsModal';
import { EventOverviewModal } from '../EventOverviewModal';
import { exportAllEventsToICal } from '../../lib/icalExport';

const EVENT_TYPE_LABELS: Record<string, string> = {
  competition: 'Competition',
  training_camp: 'Training Camp',
  seminar: 'Seminar',
  testing_day: 'Testing Day',
  team_meeting: 'Team Meeting',
  other: 'Other',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type ViewMode = 'month' | 'list';

function isoToLocal(iso: string): Date {
  return new Date(iso + 'T00:00:00');
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = isoToLocal(dateStr);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function CompetitionCalendar() {
  const { events, loading, fetchEvents, createEvent, updateEvent, deleteEvent } = useEvents();
  const { athletes, fetchActiveAthletes } = useAthletes();

  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventWithAthletes | null>(null);
  const [detailEvent, setDetailEvent] = useState<EventWithAthletes | null>(null);
  const [attemptsEvent, setAttemptsEvent] = useState<EventWithAthletes | null>(null);
  const [attemptsAthlete, setAttemptsAthlete] = useState<Athlete | null>(null);
  const [overviewEvent, setOverviewEvent] = useState<EventWithAthletes | null>(null);

  useEffect(() => {
    fetchEvents();
    fetchActiveAthletes();
  }, []);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function openCreate() {
    setEditingEvent(null);
    setShowForm(true);
  }

  function openEdit(event: EventWithAthletes) {
    setDetailEvent(null);
    setEditingEvent(event);
    setShowForm(true);
  }

  async function handleSave(data: {
    name: string; event_type: string; event_date: string; end_date: string;
    is_all_day: boolean; start_time: string; end_time: string; location: string;
    description: string; notes: string; external_url: string; color: string;
    athlete_ids: string[];
  }) {
    const payload = {
      name: data.name,
      event_date: data.event_date,
      description: data.description || null,
      event_type: data.event_type,
      location: data.location || null,
      end_date: data.end_date || null,
      color: data.color || null,
      notes: data.notes || null,
      is_all_day: data.is_all_day,
      start_time: data.is_all_day ? null : (data.start_time || null),
      end_time: data.is_all_day ? null : (data.end_time || null),
      external_url: data.external_url || null,
    };

    if (editingEvent) {
      await updateEvent(editingEvent.id, payload, data.athlete_ids);
    } else {
      await createEvent(payload, data.athlete_ids);
    }
    setShowForm(false);
    setEditingEvent(null);
    fetchEvents();
  }

  async function handleDelete(event: EventWithAthletes) {
    if (!confirm(`Delete "${event.name}"?`)) return;
    await deleteEvent(event.id);
    setDetailEvent(null);
    fetchEvents();
  }

  function handleAthleteClick(event: EventWithAthletes, athlete: Athlete) {
    setDetailEvent(null);
    setAttemptsEvent(event);
    setAttemptsAthlete(athlete);
  }

  // ── Month view helpers ──────────────────────────────────────────────────────
  const eventsInMonth = events.filter(e => {
    const d = isoToLocal(e.event_date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });

  function buildCalendarGrid(): (number | null)[] {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Mon-start offset
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells: (number | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function eventsOnDay(day: number): EventWithAthletes[] {
    return eventsInMonth.filter(e => isoToLocal(e.event_date).getDate() === day);
  }

  const grid = buildCalendarGrid();
  const todayDay = today.getFullYear() === year && today.getMonth() + 1 === month ? today.getDate() : null;

  // ── List view helpers ───────────────────────────────────────────────────────
  const sortedEvents = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date));
  const groupedByMonth = sortedEvents.reduce<Record<string, EventWithAthletes[]>>((acc, e) => {
    const d = isoToLocal(e.event_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    (acc[key] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-gray-900">Calendar</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportAllEventsToICal(events)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            title="Export all events as .ics"
          >
            <Download size={15} />
            Export
          </button>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-2 text-sm transition-colors ${viewMode === 'month' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              title="Month view"
            >
              <CalendarDays size={15} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 text-sm border-l border-gray-300 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              title="List view"
            >
              <LayoutList size={15} />
            </button>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Event
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
          <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          Loading...
        </div>
      ) : viewMode === 'month' ? (
        /* ── MONTH VIEW ── */
        <div className="bg-white rounded-lg border border-gray-200">
          {/* Month nav */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded transition-colors">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium text-gray-900">{formatMonthYear(year, month)}</span>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {WEEKDAYS.map(d => (
              <div key={d} className="py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7">
            {grid.map((day, i) => {
              const isToday = day !== null && day === todayDay;
              const dayEvents = day !== null ? eventsOnDay(day) : [];
              return (
                <div
                  key={i}
                  className={`min-h-[80px] p-1.5 border-b border-r border-gray-100 ${i % 7 === 6 ? 'border-r-0' : ''}`}
                >
                  {day !== null && (
                    <>
                      <div className={`w-6 h-6 flex items-center justify-center text-xs font-medium rounded-full mb-1 ${
                        isToday ? 'bg-blue-600 text-white' : 'text-gray-700'
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map(e => (
                          <button
                            key={e.id}
                            onClick={() => setDetailEvent(e)}
                            className="w-full text-left text-xs px-1.5 py-0.5 rounded truncate transition-opacity hover:opacity-80"
                            style={{
                              backgroundColor: (e.color ?? '#3b82f6') + '20',
                              color: e.color ?? '#3b82f6',
                            }}
                            title={e.name}
                          >
                            {e.name}
                          </button>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-xs text-gray-500 px-1">+{dayEvents.length - 3} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── LIST VIEW ── */
        <div className="space-y-6">
          {Object.keys(groupedByMonth).length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              No events yet. Add your first event to get started.
            </div>
          ) : (
            Object.entries(groupedByMonth).map(([key, monthEvents]) => {
              const [y, m] = key.split('-').map(Number);
              return (
                <div key={key}>
                  <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                    {formatMonthYear(y, m)}
                  </h2>
                  <div className="space-y-2">
                    {monthEvents.map(event => {
                      const daysUntil = getDaysUntil(event.event_date);
                      const isPast = daysUntil < 0;
                      const isToday = daysUntil === 0;
                      const color = event.color ?? '#3b82f6';

                      return (
                        <button
                          key={event.id}
                          onClick={() => setDetailEvent(event)}
                          className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors flex items-start gap-4"
                        >
                          {/* Color stripe */}
                          <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: color }} />

                          {/* Date block */}
                          <div className="w-14 flex-shrink-0 text-center">
                            <div className="text-lg font-medium text-gray-900">
                              {isoToLocal(event.event_date).getDate()}
                            </div>
                            <div className="text-xs text-gray-500">
                              {isoToLocal(event.event_date).toLocaleDateString('en-GB', { month: 'short' })}
                            </div>
                          </div>

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className="text-xs font-medium px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: color + '20', color }}
                              >
                                {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                              </span>
                            </div>
                            <div className="font-medium text-gray-900 text-sm truncate">{event.name}</div>
                            {event.location && (
                              <div className="text-xs text-gray-500 mt-0.5 truncate">{event.location}</div>
                            )}
                            {event.athletes.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                {event.athletes.map(a => a.name).join(', ')}
                              </div>
                            )}
                          </div>

                          {/* Countdown */}
                          <div className="flex-shrink-0 text-right">
                            {isPast ? (
                              <span className="text-xs text-gray-400">Past</span>
                            ) : isToday ? (
                              <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">Today</span>
                            ) : (
                              <div className="text-xs text-gray-500">
                                <div className="font-medium text-gray-700">{daysUntil}d</div>
                                <div>{Math.ceil(daysUntil / 7)}w</div>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <EventFormModal
          editing={editingEvent}
          athletes={athletes}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingEvent(null); }}
        />
      )}

      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onEdit={() => openEdit(detailEvent)}
          onDelete={() => handleDelete(detailEvent)}
          onAthleteClick={(athlete) => handleAthleteClick(detailEvent, athlete)}
        />
      )}

      {attemptsEvent && attemptsAthlete && (
        <EventAttemptsModal
          eventId={attemptsEvent.id}
          eventName={attemptsEvent.name}
          athlete={attemptsAthlete}
          onClose={() => { setAttemptsEvent(null); setAttemptsAthlete(null); }}
          onSave={fetchEvents}
        />
      )}

      {overviewEvent && (
        <EventOverviewModal
          event={overviewEvent}
          onClose={() => setOverviewEvent(null)}
        />
      )}
    </div>
  );
}
