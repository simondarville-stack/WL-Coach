import { Calendar, MapPin, Users } from 'lucide-react';
import type { UpcomingEventV2 } from '../../hooks/useCoachDashboardV2';
import { formatDateToDDMMYYYY } from '../../lib/dateUtils';

interface Props {
  events: UpcomingEventV2[];
}

export function EventsPanel({ events }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Upcoming events</h3>
      </div>
      {events.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">No upcoming events</div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-[300px] overflow-y-auto">
          {events.map((ev, i) => (
            <EventRow key={i} item={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ item }: { item: UpcomingEventV2 }) {
  const { event, athleteNames, daysUntil } = item;
  const borderColor = event.color || '#3b82f6';
  const isClose = daysUntil <= 14;

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-800 truncate">{event.name}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            isClose ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <Calendar size={9} />
            {formatDateToDDMMYYYY(event.event_date)}
          </span>
          {event.location && (
            <span className="flex items-center gap-1 text-[10px] text-gray-400 truncate">
              <MapPin size={9} />
              {event.location}
            </span>
          )}
          {athleteNames.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-gray-400 truncate">
              <Users size={9} />
              {athleteNames.join(', ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
