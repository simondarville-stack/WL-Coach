import { useState, useEffect } from 'react';
import type { Athlete, WeekPlan, PlannedExerciseWithExercise, ComboMemberEntry } from '../lib/database.types';
import { formatDateToDDMMYYYY, formatDateRange, getMondayOfWeek } from '../lib/dateUtils';
import { PrescriptionDisplay } from './PrescriptionDisplay';
import { Calendar, Video } from 'lucide-react';
import { useAthletes } from '../hooks/useAthletes';
import { useWeekPlans } from '../hooks/useWeekPlans';
import { useCombos } from '../hooks/useCombos';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type SentinelType = 'text' | 'video' | 'image' | null;
function getSentinelType(code: string | null | undefined): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  return null;
}
function getYouTubeVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? m[1] : null;
}

export function AthleteProgramme() {
  const { athletes, fetchActiveAthletes } = useAthletes();
  const { fetchWeekPlanForAthlete, fetchPlannedExercisesFlat } = useWeekPlans();
  const { fetchProgrammeData } = useCombos();

  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [weekStart, setWeekStart] = useState<string>('');
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExerciseWithExercise[]>([]);
  const [comboMembers, setComboMembers] = useState<Record<string, ComboMemberEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveAthletes();
    const today = getMondayOfWeek(new Date());
    setWeekStart(today.toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    if (selectedAthlete && weekStart) {
      loadProgramme();
    } else {
      setWeekPlan(null);
      setPlannedExercises([]);
    }
  }, [selectedAthlete, weekStart]);

  const loadProgramme = async () => {
    if (!selectedAthlete || !weekStart) return;

    try {
      setLoading(true);
      setError(null);

      const weekPlanData = await fetchWeekPlanForAthlete(selectedAthlete.id, weekStart);
      setWeekPlan(weekPlanData);

      if (weekPlanData) {
        const [exercisesData, { comboMembers: members }] = await Promise.all([
          fetchPlannedExercisesFlat(weekPlanData.id),
          fetchProgrammeData(weekPlanData.id),
        ]);
        setPlannedExercises(exercisesData as PlannedExerciseWithExercise[]);
        setComboMembers(members);
      } else {
        setPlannedExercises([]);
        setComboMembers({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load programme');
    } finally {
      setLoading(false);
    }
  };

  const handleWeekStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = new Date(e.target.value);
    const monday = getMondayOfWeek(date);
    setWeekStart(monday.toISOString().split('T')[0]);
  };

  const getExercisesForDay = (dayIndex: number): PlannedExerciseWithExercise[] => {
    return plannedExercises
      .filter(pe => pe.day_index === dayIndex)
      .sort((a, b) => a.position - b.position);
  };

  const getDayLabel = (dayIndex: number): string => {
    if (weekPlan?.day_labels && weekPlan.day_labels[dayIndex]) {
      return weekPlan.day_labels[dayIndex];
    }
    return DAY_NAMES[dayIndex];
  };

  const isDayActive = (dayIndex: number): boolean => {
    if (!weekPlan?.active_days || weekPlan.active_days.length === 0) {
      return true;
    }
    return weekPlan.active_days.includes(dayIndex);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <Calendar size={28} />
          My Programme
        </h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Athlete
              </label>
              <select
                value={selectedAthlete?.id || ''}
                onChange={(e) => {
                  const athlete = athletes.find(a => a.id === e.target.value);
                  setSelectedAthlete(athlete || null);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Choose athlete...</option>
                {athletes.map(athlete => (
                  <option key={athlete.id} value={athlete.id}>
                    {athlete.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Week Start (Monday)
              </label>
              <input
                type="date"
                value={weekStart}
                onChange={handleWeekStartChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {weekStart && (
                <div className="mt-1 text-sm text-gray-600">
                  Week: {formatDateRange(weekStart, 7)}
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="text-gray-500">Loading programme...</div>
          </div>
        ) : !selectedAthlete || !weekStart ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-500">Please select an athlete and week to view the programme.</p>
          </div>
        ) : !weekPlan ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-lg text-gray-600 font-medium">No programme planned for this week</p>
            <p className="text-sm text-gray-500 mt-2">
              {selectedAthlete.name} does not have a training plan for week starting {formatDateToDDMMYYYY(weekStart)}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md">
            {weekPlan.name && (
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">{weekPlan.name}</h2>
                {weekPlan.week_description && (
                  <p className="text-sm text-gray-600 mt-1">{weekPlan.week_description}</p>
                )}
              </div>
            )}

            <div className="divide-y divide-gray-200">
              {[0, 1, 2, 3, 4, 5, 6].map(dayIndex => {
                const dayExercises = getExercisesForDay(dayIndex);
                const isActive = isDayActive(dayIndex);
                const hasContent = dayExercises.length > 0;

                if (!isActive && !hasContent) {
                  return null;
                }

                return (
                  <div key={dayIndex} className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      {getDayLabel(dayIndex)}
                    </h3>

                    {!hasContent ? (
                      <p className="text-sm text-gray-500 italic">Rest day</p>
                    ) : (
                      <div className="space-y-4">
                        {dayExercises.map((pe) => {
                          const sentinel = getSentinelType(pe.exercise.exercise_code);
                          const isCombo = pe.is_combo ?? false;
                          const members = isCombo
                            ? (comboMembers[pe.id] ?? []).sort((a, b) => a.position - b.position)
                            : [];

                          // Sentinel rendering
                          if (sentinel === 'text') {
                            if (!pe.notes?.trim()) return null;
                            return (
                              <div key={pe.id} className="bg-amber-50 border border-amber-200 rounded px-3 py-2">
                                <p className="text-sm text-gray-700 italic whitespace-pre-wrap">{pe.notes}</p>
                              </div>
                            );
                          }
                          if (sentinel === 'image') {
                            if (!pe.notes?.trim()) return null;
                            return (
                              <div key={pe.id}>
                                <img src={pe.notes} alt="" className="rounded border border-gray-200 max-w-full" style={{ maxHeight: '300px', objectFit: 'contain' }} onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                              </div>
                            );
                          }
                          if (sentinel === 'video') {
                            const url = pe.notes?.trim();
                            if (!url) return null;
                            const videoId = getYouTubeVideoId(url);
                            return (
                              <div key={pe.id} className="bg-indigo-50 border border-indigo-200 rounded px-3 py-2 flex items-center gap-3">
                                <Video size={16} className="text-indigo-400 flex-shrink-0" />
                                <div className="min-w-0">
                                  {videoId && (
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      <img src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="Video thumbnail" className="rounded w-32 h-20 object-cover mb-1" />
                                    </a>
                                  )}
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 underline break-all">{url}</a>
                                </div>
                              </div>
                            );
                          }

                          const displayName = isCombo
                            ? (pe.combo_notation || members.map(m => m.exercise.name).join(' + '))
                            : pe.exercise.name;
                          const borderColor = isCombo
                            ? (pe.combo_color || '#3b82f6')
                            : (pe.exercise.color || '#94a3b8');

                          return (
                            <div key={pe.id} className="pl-4 border-l-4" style={{ borderColor }}>
                              <div className="font-medium text-gray-900">
                                {displayName}
                                {pe.variation_note && (
                                  <span className="text-xs text-gray-400 italic ml-2">{pe.variation_note}</span>
                                )}
                              </div>
                              {isCombo && members.length > 0 && (
                                <div className="text-xs text-gray-500 mb-1">
                                  {members.map((m, idx) => (
                                    <span key={m.exerciseId}>
                                      {idx > 0 && ' + '}
                                      {m.exercise.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="text-gray-700 mt-1">
                                {pe.prescription_raw ? (
                                  <PrescriptionDisplay
                                    prescription={pe.prescription_raw}
                                    unit={pe.unit}
                                    useStackedNotation={!isCombo && pe.exercise.use_stacked_notation}
                                  />
                                ) : pe.summary_total_sets && pe.summary_total_reps ? (
                                  `${pe.summary_total_sets} sets × ${pe.summary_total_reps} reps`
                                ) : (
                                  <span className="text-gray-400 italic text-sm">No prescription</span>
                                )}
                              </div>
                              {pe.notes && (
                                <div className="text-sm text-gray-600 mt-1 italic">{pe.notes}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
