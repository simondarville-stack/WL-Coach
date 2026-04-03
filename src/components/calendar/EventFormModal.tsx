import { useState } from 'react';
import { X } from 'lucide-react';
import type { EventType } from '../../lib/database.types';
import type { EventWithAthletes } from '../../hooks/useEvents';
import type { Athlete } from '../../lib/database.types';

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'competition', label: 'Competition' },
  { value: 'training_camp', label: 'Training Camp' },
  { value: 'seminar', label: 'Seminar' },
  { value: 'testing_day', label: 'Testing Day' },
  { value: 'team_meeting', label: 'Team Meeting' },
  { value: 'other', label: 'Other' },
];

const COLOR_OPTIONS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#64748b', '#1e293b',
];

interface EventFormData {
  name: string;
  event_type: EventType;
  event_date: string;
  end_date: string;
  is_all_day: boolean;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
  notes: string;
  external_url: string;
  color: string;
  athlete_ids: string[];
}

interface Props {
  editing: EventWithAthletes | null;
  athletes: Athlete[];
  onSave: (data: Omit<EventFormData, 'athlete_ids'> & { athlete_ids: string[] }) => Promise<void>;
  onClose: () => void;
}

export function EventFormModal({ editing, athletes, onSave, onClose }: Props) {
  const [formData, setFormData] = useState<EventFormData>(() => ({
    name: editing?.name ?? '',
    event_type: (editing?.event_type as EventType) ?? 'competition',
    event_date: editing?.event_date?.slice(0, 10) ?? '',
    end_date: editing?.end_date?.slice(0, 10) ?? '',
    is_all_day: editing?.is_all_day ?? true,
    start_time: editing?.start_time ?? '',
    end_time: editing?.end_time ?? '',
    location: editing?.location ?? '',
    description: editing?.description ?? '',
    notes: editing?.notes ?? '',
    external_url: editing?.external_url ?? '',
    color: editing?.color ?? '#3b82f6',
    athlete_ids: editing?.athletes.map(a => a.id) ?? [],
  }));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EventFormData>(key: K, val: EventFormData[K]) =>
    setFormData(prev => ({ ...prev, [key]: val }));

  const toggleAthlete = (id: string) =>
    set('athlete_ids', formData.athlete_ids.includes(id)
      ? formData.athlete_ids.filter(x => x !== id)
      : [...formData.athlete_ids, id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-dialog-in">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">
            {editing ? 'Edit Event' : 'New Event'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name + Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={e => set('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., National Championships"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
              <select
                value={formData.event_type}
                onChange={e => set('event_type', e.target.value as EventType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {EVENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={e => set('location', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="City, Venue..."
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                required
                value={formData.event_date}
                onChange={e => set('event_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="date"
                value={formData.end_date}
                onChange={e => set('end_date', e.target.value)}
                min={formData.event_date}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* All day toggle + times */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={formData.is_all_day}
                onChange={e => set('is_all_day', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">All day event</span>
            </label>
            {!formData.is_all_day && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={e => set('start_time', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={e => set('end_time', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  className={`w-7 h-7 rounded-full transition-transform ${formData.color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={formData.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description..."
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={formData.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Internal notes, weigh-in times, logistics..."
            />
          </div>

          {/* External URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">External URL <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="url"
              value={formData.external_url}
              onChange={e => set('external_url', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://..."
            />
          </div>

          {/* Athletes */}
          {athletes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Participating Athletes</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {athletes.map(athlete => (
                  <label key={athlete.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.athlete_ids.includes(athlete.id)}
                      onChange={() => toggleAthlete(athlete.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{athlete.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : (editing ? 'Update Event' : 'Create Event')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
