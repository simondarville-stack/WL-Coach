import { useState, useEffect } from 'react';
import { X, Trophy, Video } from 'lucide-react';
import type { Event, Athlete, EventAttempts, EventVideo } from '../lib/database.types';
import { formatDateToDDMMYYYY } from '../lib/dateUtils';
import { useEvents } from '../hooks/useEvents';

interface EventOverviewModalProps {
  event: Event;
  onClose: () => void;
}

interface AthleteWithAttempts extends Athlete {
  attempts: EventAttempts | null;
  videos: EventVideo[];
}

export function EventOverviewModal({ event, onClose }: EventOverviewModalProps) {
  const { fetchEventOverview } = useEvents();
  const [athletes, setAthletes] = useState<AthleteWithAttempts[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEventData();
  }, [event.id]);

  async function loadEventData() {
    try {
      setLoading(true);
      const data = await fetchEventOverview(event.id);
      setAthletes(data as AthleteWithAttempts[]);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  }

  function formatAttempt(value: number | null): string {
    if (value === null) return '-';
    if (value < 0) return `${Math.abs(value)}`;
    return `${value}`;
  }

  function getAttemptClass(value: number | null): string {
    if (value === null) return 'text-gray-400';
    if (value < 0) return 'text-red-600 line-through';
    return 'text-green-600 font-medium';
  }

  function getBestSnatch(attempts: EventAttempts | null): number | null {
    if (!attempts) return null;
    const values = [attempts.actual_snatch_1, attempts.actual_snatch_2, attempts.actual_snatch_3]
      .filter((v): v is number => v !== null && v > 0);
    return values.length > 0 ? Math.max(...values) : null;
  }

  function getBestCJ(attempts: EventAttempts | null): number | null {
    if (!attempts) return null;
    const values = [attempts.actual_cj_1, attempts.actual_cj_2, attempts.actual_cj_3]
      .filter((v): v is number => v !== null && v > 0);
    return values.length > 0 ? Math.max(...values) : null;
  }

  function getTotal(attempts: EventAttempts | null): number | null {
    const snatch = getBestSnatch(attempts);
    const cj = getBestCJ(attempts);
    if (snatch === null || cj === null) return null;
    return snatch + cj;
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="text-gray-600">Loading event data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-medium text-gray-900">{event.name}</h2>
            <p className="text-sm text-gray-600">{formatDateToDDMMYYYY(event.event_date)}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          {athletes.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No athletes registered for this event</div>
          ) : (
            <div className="space-y-6">
              {athletes.map((athlete) => {
                const bestSnatch = getBestSnatch(athlete.attempts);
                const bestCJ = getBestCJ(athlete.attempts);
                const total = getTotal(athlete.attempts);

                return (
                  <div key={athlete.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Trophy className="w-5 h-5 text-gray-400" />
                          <h3 className="font-medium text-gray-900">{athlete.name}</h3>
                        </div>
                        {total !== null && (
                          <div className="text-lg font-medium text-blue-600">Total: {total} kg</div>
                        )}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-sm font-medium text-gray-900 mb-3">Snatch</h4>
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Planned</div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">1st:</span>
                                    <span className="font-medium">
                                      {formatAttempt(athlete.attempts?.planned_snatch_1 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">2nd:</span>
                                    <span className="font-medium">
                                      {formatAttempt(athlete.attempts?.planned_snatch_2 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">3rd:</span>
                                    <span className="font-medium">
                                      {formatAttempt(athlete.attempts?.planned_snatch_3 || null)} kg
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Actual</div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">1st:</span>
                                    <span className={getAttemptClass(athlete.attempts?.actual_snatch_1 || null)}>
                                      {formatAttempt(athlete.attempts?.actual_snatch_1 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">2nd:</span>
                                    <span className={getAttemptClass(athlete.attempts?.actual_snatch_2 || null)}>
                                      {formatAttempt(athlete.attempts?.actual_snatch_2 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">3rd:</span>
                                    <span className={getAttemptClass(athlete.attempts?.actual_snatch_3 || null)}>
                                      {formatAttempt(athlete.attempts?.actual_snatch_3 || null)} kg
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            {bestSnatch !== null && (
                              <div className="mt-2 pt-2 border-t border-gray-200">
                                <span className="text-xs text-gray-600">Best: </span>
                                <span className="text-sm font-medium text-green-600">{bestSnatch} kg</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-sm font-medium text-gray-900 mb-3">Clean & Jerk</h4>
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Planned</div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">1st:</span>
                                    <span className="font-medium">
                                      {formatAttempt(athlete.attempts?.planned_cj_1 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">2nd:</span>
                                    <span className="font-medium">
                                      {formatAttempt(athlete.attempts?.planned_cj_2 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">3rd:</span>
                                    <span className="font-medium">
                                      {formatAttempt(athlete.attempts?.planned_cj_3 || null)} kg
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Actual</div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">1st:</span>
                                    <span className={getAttemptClass(athlete.attempts?.actual_cj_1 || null)}>
                                      {formatAttempt(athlete.attempts?.actual_cj_1 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">2nd:</span>
                                    <span className={getAttemptClass(athlete.attempts?.actual_cj_2 || null)}>
                                      {formatAttempt(athlete.attempts?.actual_cj_2 || null)} kg
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600 w-8">3rd:</span>
                                    <span className={getAttemptClass(athlete.attempts?.actual_cj_3 || null)}>
                                      {formatAttempt(athlete.attempts?.actual_cj_3 || null)} kg
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            {bestCJ !== null && (
                              <div className="mt-2 pt-2 border-t border-gray-200">
                                <span className="text-xs text-gray-600">Best: </span>
                                <span className="text-sm font-medium text-green-600">{bestCJ} kg</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {athlete.attempts?.competition_notes && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <h5 className="text-xs font-medium text-gray-700 mb-1">Competition Notes</h5>
                          <p className="text-sm text-gray-600">{athlete.attempts.competition_notes}</p>
                        </div>
                      )}

                      {athlete.videos.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <h5 className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
                            <Video className="w-3 h-3" />
                            Videos ({athlete.videos.length})
                          </h5>
                          <div className="grid grid-cols-2 gap-2">
                            {athlete.videos.map((video) => (
                              <a
                                key={video.id}
                                href={video.video_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 text-sm"
                              >
                                <Video className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 truncate">
                                    {video.lift_type === 'snatch' ? 'Snatch' : 'C&J'} #{video.attempt_number}
                                  </div>
                                  {video.description && (
                                    <div className="text-xs text-gray-500 truncate">{video.description}</div>
                                  )}
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
