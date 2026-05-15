// Upcoming events panel — bucketed by horizon. Athletes chips below each
// event jump back into the board.

import type { UpcomingEvent, AthleteStatus } from '../../hooks/useCoachDashboard';
import type { Event } from '../../lib/database.types';
import { Avatar } from './atoms';

const BUCKETS = [
  { id: '2w', label: 'Next 2 weeks',     min: 0,  max: 14 },
  { id: '4w', label: 'In 2–4 weeks',     min: 14, max: 28 },
  { id: '8w', label: 'Later · 4–8 weeks', min: 28, max: 60 },
];

interface Props {
  events: UpcomingEvent[];
  statuses: AthleteStatus[];
  onOpenEvent: (event: Event) => void;
  onJumpToAthlete: (status: AthleteStatus) => void;
}

export function UpcomingEventsPanel({ events, statuses, onOpenEvent, onJumpToAthlete }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 flex flex-col min-h-[360px]">
      <div className="px-4 py-3 border-b border-gray-100 flex items-baseline gap-3">
        <h3 className="text-sm font-medium text-gray-900">Upcoming</h3>
        <span className="text-xs text-gray-400 tabular-nums">
          {events.length} on the calendar · next 8 weeks
        </span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[460px]">
        {events.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-400">
            Nothing scheduled in the next 8 weeks.
          </div>
        )}
        {BUCKETS.map(bk => {
          const items = events.filter(e => e.daysUntil >= bk.min && e.daysUntil < bk.max);
          if (!items.length) return null;
          return (
            <div key={bk.id}>
              <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 flex items-baseline gap-2">
                <span className="text-[11px] uppercase tracking-wider font-medium text-gray-500">
                  {bk.label}
                </span>
                <span className="text-xs text-gray-400 tabular-nums">{items.length}</span>
              </div>
              {items.map(ev => (
                <UpcomingRow
                  key={ev.eventData.id}
                  ev={ev}
                  statuses={statuses}
                  onOpenEvent={onOpenEvent}
                  onJumpToAthlete={onJumpToAthlete}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingRow({
  ev, statuses, onOpenEvent, onJumpToAthlete,
}: {
  ev: UpcomingEvent;
  statuses: AthleteStatus[];
  onOpenEvent: (event: Event) => void;
  onJumpToAthlete: (status: AthleteStatus) => void;
}) {
  const isComp = ev.eventData.event_type === 'competition';
  const railColor = isComp ? 'border-l-orange-300' : 'border-l-sky-300';
  const tagCls = isComp
    ? 'bg-orange-50 text-orange-700 ring-orange-200'
    : 'bg-sky-50 text-sky-700 ring-sky-200';

  const names = (ev.athleteName || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const resolved = names.map(name => ({
    name,
    status: statuses.find(s => s.athlete.name === name) ?? null,
  }));

  const dateLabel = new Date(ev.eventData.event_date)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  return (
    <div className={`px-4 py-3 border-b border-gray-100 border-l-2 ${railColor} flex flex-col gap-2`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <button
          onClick={() => onOpenEvent(ev.eventData)}
          className="bg-transparent border-none p-0 cursor-pointer text-sm font-medium text-gray-900 hover:text-blue-600 text-left"
        >
          {ev.note}
        </button>
        <span className={`px-2 py-0.5 rounded-full ring-1 text-[10px] uppercase tracking-wider font-medium ${tagCls}`}>
          {isComp ? 'comp' : 'camp'}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-gray-500 tabular-nums">{dateLabel}</span>
        <span className={`text-xs font-medium tabular-nums ${isComp ? 'text-orange-700' : 'text-sky-700'}`}>
          {ev.daysUntil}d / {ev.weeksUntil}w
        </span>
      </div>

      {ev.eventData.location && (
        <span className="text-xs text-gray-500">{ev.eventData.location}</span>
      )}

      {resolved.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {resolved.map(({ name, status }) => {
            const isClickable = !!status;
            const display = name.split(' ').slice(0, 2).map((p, i) => i === 1 ? p[0] : p).join(' ');
            return (
              <button
                key={name}
                onClick={() => { if (status) onJumpToAthlete(status); }}
                disabled={!isClickable}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
                  isClickable
                    ? 'border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 cursor-pointer'
                    : 'border-gray-100 bg-gray-50 cursor-default'
                }`}
              >
                <Avatar name={name} size={18} />
                <span className="text-xs text-gray-700">{display}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
