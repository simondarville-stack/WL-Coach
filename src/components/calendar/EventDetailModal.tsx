import { X, MapPin, ExternalLink, Clock, Trophy, Calendar } from 'lucide-react';
import type { EventWithAthletes } from '../../hooks/useEvents';
import type { Athlete } from '../../lib/database.types';
import { exportEventToICal } from '../../lib/icalExport';

const EVENT_TYPE_LABELS: Record<string, string> = {
  competition: 'Competition',
  training_camp: 'Training Camp',
  seminar: 'Seminar',
  testing_day: 'Testing Day',
  team_meeting: 'Team Meeting',
  other: 'Other',
};

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m}${ampm}`;
}

interface Props {
  event: EventWithAthletes;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAthleteClick: (athlete: Athlete) => void;
}

export function EventDetailModal({ event, onClose, onEdit, onDelete, onAthleteClick }: Props) {
  const color = event.color ?? '#3b82f6';

  const dateRange = event.end_date && event.end_date !== event.event_date
    ? `${formatDate(event.event_date)} – ${formatDate(event.end_date)}`
    : formatDate(event.event_date);

  const timeInfo = !event.is_all_day && (event.start_time || event.end_time)
    ? [event.start_time && formatTime(event.start_time), event.end_time && formatTime(event.end_time)]
        .filter(Boolean).join(' – ')
    : null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
      <div className="rounded-xl w-full max-w-lg animate-dialog-in" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        {/* Header stripe */}
        <div className="rounded-t-xl p-6" style={{ borderTop: `4px solid ${color}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span
                className="inline-block text-xs font-medium px-2 py-0.5 rounded mb-2"
                style={{ backgroundColor: color + '20', color }}
              >
                {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
              </span>
              <h2 className="text-xl font-medium text-gray-900 leading-tight">{event.name}</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition-colors flex-shrink-0">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Date / Time */}
          <div className="flex items-start gap-3 text-sm text-gray-700">
            <Calendar size={16} className="mt-0.5 text-gray-400 flex-shrink-0" />
            <div>
              <div>{dateRange}</div>
              {timeInfo && <div className="text-gray-500 mt-0.5 flex items-center gap-1"><Clock size={13} />{timeInfo}</div>}
              {event.is_all_day && <div className="text-gray-500 mt-0.5">All day</div>}
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <MapPin size={16} className="text-gray-400 flex-shrink-0" />
              <span>{event.location}</span>
            </div>
          )}

          {/* External URL */}
          {event.external_url && (
            <div className="flex items-center gap-3 text-sm">
              <ExternalLink size={16} className="text-gray-400 flex-shrink-0" />
              <a
                href={event.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate"
              >
                {event.external_url}
              </a>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="text-sm text-gray-700 leading-relaxed">{event.description}</p>
          )}

          {/* Notes */}
          {event.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-700 mb-1">Notes</p>
              <p className="text-sm text-amber-900 leading-relaxed">{event.notes}</p>
            </div>
          )}

          {/* Athletes */}
          {event.athletes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Athletes</p>
              <div className="flex flex-wrap gap-2">
                {event.athletes.map(a => (
                  <button
                    key={a.id}
                    onClick={() => onAthleteClick(a)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <Trophy size={11} />
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => exportEventToICal(event)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Calendar size={14} />
              Export .ics
            </button>
            <div className="flex-1" />
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
