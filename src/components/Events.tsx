import { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, X, Trophy } from 'lucide-react';
import type { Athlete } from '../lib/database.types';
import { formatDateToDDMMYYYY, formatISOToDateInput } from '../lib/dateUtils';
import { EventAttemptsModal } from './EventAttemptsModal';
import { EventOverviewModal } from './EventOverviewModal';
import { useEvents, type EventWithAthletes } from '../hooks/useEvents';
import { useAthletes } from '../hooks/useAthletes';

export function Events() {
  const { events, loading, fetchEvents, createEvent, updateEvent, deleteEvent } = useEvents();
  const { athletes, fetchActiveAthletes } = useAthletes();

  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventWithAthletes | null>(null);
  const [showAttemptsModal, setShowAttemptsModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventWithAthletes | null>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [overviewEvent, setOverviewEvent] = useState<EventWithAthletes | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    event_date: '',
    description: '',
    athlete_ids: [] as string[],
  });

  useEffect(() => {
    fetchEvents();
    fetchActiveAthletes();
  }, []);

  function openCreateModal() {
    setEditingEvent(null);
    setFormData({ name: '', event_date: '', description: '', athlete_ids: [] });
    setShowModal(true);
  }

  function openEditModal(event: EventWithAthletes) {
    setEditingEvent(event);
    setFormData({
      name: event.name,
      event_date: formatISOToDateInput(event.event_date),
      description: event.description || '',
      athlete_ids: event.athletes.map(a => a.id),
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingEvent) {
        await updateEvent(editingEvent.id, {
          name: formData.name,
          event_date: formData.event_date,
          description: formData.description,
        }, formData.athlete_ids);
      } else {
        await createEvent({
          name: formData.name,
          event_date: formData.event_date,
          description: formData.description,
        }, formData.athlete_ids);
      }
      setShowModal(false);
      fetchEvents();
    } catch (error) {
    }
  }

  async function handleDeleteEvent(id: string) {
    if (!confirm('Are you sure you want to delete this event?')) return;
    try {
      await deleteEvent(id);
      fetchEvents();
    } catch (error) {
    }
  }

  function getDaysUntil(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(date);
    eventDate.setHours(0, 0, 0, 0);
    return Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function getWeeksUntil(date: string): number {
    return Math.ceil(getDaysUntil(date) / 7);
  }

  if (loading) {
    return <div className="p-6"><div className="text-gray-600">Loading events...</div></div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-gray-900">Events</h1>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Event
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Event</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Time Until</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Athletes</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const daysUntil = getDaysUntil(event.event_date);
                const weeksUntil = getWeeksUntil(event.event_date);
                const isPast = daysUntil < 0;
                const isToday = daysUntil === 0;

                return (
                  <tr key={event.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <button
                        onClick={() => { setOverviewEvent(event); setShowOverviewModal(true); }}
                        className="font-medium text-gray-900 hover:text-blue-600 text-left"
                      >
                        {event.name}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {formatDateToDDMMYYYY(event.event_date)}
                    </td>
                    <td className="py-3 px-4">
                      {isPast ? (
                        <span className="text-xs text-gray-400">Past</span>
                      ) : isToday ? (
                        <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded">Today</span>
                      ) : (
                        <div className="text-xs text-gray-600">
                          <div>{daysUntil} days</div>
                          <div className="text-gray-500">{weeksUntil} weeks</div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {event.athletes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {event.athletes.map((athlete) => (
                            <button
                              key={athlete.id}
                              onClick={() => { setSelectedEvent(event); setSelectedAthlete(athlete); setShowAttemptsModal(true); }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 hover:bg-blue-200"
                            >
                              <Trophy className="w-3 h-3" />
                              {athlete.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{event.description || '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditModal(event)} className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded">
                          Edit
                        </button>
                        <button onClick={() => handleDeleteEvent(event.id)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500 italic">
                    No events yet. Create one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900">
                {editingEvent ? 'Edit Event' : 'Create Event'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Event Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., National Championships"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Event Date</label>
                  <input
                    type="date"
                    required
                    value={formData.event_date}
                    onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Optional event details"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Participating Athletes</label>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
                    {athletes.map((athlete) => (
                      <label key={athlete.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.athlete_ids.includes(athlete.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({ ...formData, athlete_ids: [...formData.athlete_ids, athlete.id] });
                            } else {
                              setFormData({ ...formData, athlete_ids: formData.athlete_ids.filter(id => id !== athlete.id) });
                            }
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{athlete.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700">
                  {editingEvent ? 'Update Event' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAttemptsModal && selectedEvent && selectedAthlete && (
        <EventAttemptsModal
          eventId={selectedEvent.id}
          eventName={selectedEvent.name}
          athlete={selectedAthlete}
          onClose={() => { setShowAttemptsModal(false); setSelectedEvent(null); setSelectedAthlete(null); }}
          onSave={() => { fetchEvents(); }}
        />
      )}

      {showOverviewModal && overviewEvent && (
        <EventOverviewModal
          event={overviewEvent}
          onClose={() => { setShowOverviewModal(false); setOverviewEvent(null); }}
        />
      )}
    </div>
  );
}
