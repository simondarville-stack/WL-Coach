import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Athlete, WeekPlan, PlannedExerciseWithExercise, PlannedComboWithDetails, DefaultUnit } from '../lib/database.types';
import { formatDateToDDMMYYYY, formatDateRange, getMondayOfWeek } from '../lib/dateUtils';
import { PrescriptionDisplay } from './PrescriptionDisplay';
import { Calendar } from 'lucide-react';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatUnit(unit: DefaultUnit): string {
  if (unit === 'absolute_kg') return 'kg';
  if (unit === 'percentage') return '%';
  if (unit === 'rpe') return 'RPE';
  return '';
}

function getComboDisplayName(combo: PlannedComboWithDetails): string {
  if (combo.combo_name) return combo.combo_name;
  if (combo.template?.name) return combo.template.name;
  return combo.items.map(i => i.exercise.name).join(' + ');
}

export function AthleteProgramme() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [weekStart, setWeekStart] = useState<string>('');
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExerciseWithExercise[]>([]);
  const [combos, setCombos] = useState<PlannedComboWithDetails[]>([]);
  const [comboExerciseIds, setComboExerciseIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAthletes();
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

  const loadAthletes = async () => {
    try {
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAthletes(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes');
    }
  };

  const loadProgramme = async () => {
    if (!selectedAthlete || !weekStart) return;

    try {
      setLoading(true);
      setError(null);

      const { data: weekPlanData, error: weekError } = await supabase
        .from('week_plans')
        .select('*')
        .eq('athlete_id', selectedAthlete.id)
        .eq('week_start', weekStart)
        .maybeSingle();

      if (weekError) throw weekError;

      setWeekPlan(weekPlanData);

      if (weekPlanData) {
        const { data: exercisesData, error: exercisesError } = await supabase
          .from('planned_exercises')
          .select(`*, exercise:exercises(*)`)
          .eq('weekplan_id', weekPlanData.id)
          .order('day_index')
          .order('position');

        if (exercisesError) throw exercisesError;
        setPlannedExercises(exercisesData || []);

        const { data: combosData, error: combosError } = await supabase
          .from('planned_combos')
          .select('*')
          .eq('weekplan_id', weekPlanData.id)
          .order('day_index')
          .order('position');

        if (combosError) throw combosError;

        const combosWithDetails: PlannedComboWithDetails[] = [];
        const linkedIds = new Set<string>();

        for (const combo of combosData || []) {
          let template = null;
          if (combo.template_id) {
            const { data: tpl } = await supabase
              .from('exercise_combo_templates')
              .select('*')
              .eq('id', combo.template_id)
              .maybeSingle();
            template = tpl;
          }

          const { data: items, error: itemsError } = await supabase
            .from('planned_combo_items')
            .select('*, exercise:exercise_id(*)')
            .eq('planned_combo_id', combo.id)
            .order('position');

          if (itemsError) {
            console.error('Error loading combo items:', itemsError);
            continue;
          }

          const { data: setLines } = await supabase
            .from('planned_combo_set_lines')
            .select('*')
            .eq('planned_combo_id', combo.id)
            .order('position');

          if (items && items.length > 0) {
            combosWithDetails.push({
              ...combo,
              template,
              items: items.map(item => ({ ...item, exercise: item.exercise })),
              set_lines: setLines || []
            });

            items.forEach(item => linkedIds.add(item.planned_exercise_id));
          }
        }

        setCombos(combosWithDetails);
        setComboExerciseIds(linkedIds);
      } else {
        setPlannedExercises([]);
        setCombos([]);
        setComboExerciseIds(new Set());
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
    return plannedExercises.filter(pe => pe.day_index === dayIndex && !comboExerciseIds.has(pe.id));
  };

  const getCombosForDay = (dayIndex: number): PlannedComboWithDetails[] => {
    return combos.filter(c => c.day_index === dayIndex);
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
                const dayCombos = getCombosForDay(dayIndex);
                const isActive = isDayActive(dayIndex);
                const hasContent = dayExercises.length > 0 || dayCombos.length > 0;

                if (!isActive && !hasContent) {
                  return null;
                }

                const allItems = [
                  ...dayExercises.map(ex => ({ type: 'exercise' as const, data: ex, position: ex.position })),
                  ...dayCombos.map(c => ({ type: 'combo' as const, data: c, position: c.position })),
                ].sort((a, b) => a.position - b.position);

                return (
                  <div key={dayIndex} className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      {getDayLabel(dayIndex)}
                    </h3>

                    {!hasContent ? (
                      <p className="text-sm text-gray-500 italic">Rest day</p>
                    ) : (
                      <div className="space-y-4">
                        {allItems.map((item) => {
                          if (item.type === 'exercise') {
                            const pe = item.data;
                            return (
                              <div key={pe.id} className="pl-4 border-l-4" style={{ borderColor: pe.exercise.color }}>
                                <div className="font-medium text-gray-900">
                                  {pe.exercise.name}
                                </div>
                                <div className="text-gray-700 mt-2">
                                  {pe.prescription_raw ? (
                                    <PrescriptionDisplay
                                      prescription={pe.prescription_raw}
                                      unit={pe.unit}
                                      useStackedNotation={pe.exercise.use_stacked_notation}
                                    />
                                  ) : pe.summary_total_sets && pe.summary_total_reps ? (
                                    `${pe.summary_total_sets} sets x ${pe.summary_total_reps} reps`
                                  ) : (
                                    'No prescription'
                                  )}
                                </div>
                                {pe.notes && (
                                  <div className="text-sm text-gray-600 mt-1 italic">
                                    {pe.notes}
                                  </div>
                                )}
                              </div>
                            );
                          } else {
                            const combo = item.data;
                            const unitSym = formatUnit(combo.unit);
                            const hasSetLines = combo.set_lines.length > 0 && combo.set_lines.some((l: any) => l.load_value > 0);

                            return (
                              <div key={combo.id} className="pl-4 border-l-4 border-blue-500">
                                <div className="font-medium text-gray-900">
                                  {getComboDisplayName(combo)}
                                </div>
                                <div className="text-xs text-gray-500 mb-2">
                                  {combo.items.map((ci: any, idx: number) => (
                                    <span key={ci.id}>
                                      {idx > 0 && ' + '}
                                      {ci.exercise.name}
                                    </span>
                                  ))}
                                </div>
                                {hasSetLines ? (
                                  <div className="text-gray-700 mt-2">
                                    {combo.set_lines.map((line: any, idx: number) => (
                                      <span key={line.id}>
                                        <span className="inline-flex flex-col items-center border rounded px-3 py-2 bg-gray-50">
                                          <span className="text-lg font-semibold">
                                            {line.load_value}
                                            <span className="text-sm ml-1">{unitSym}</span>
                                          </span>
                                          <span className="w-full border-t border-gray-400 my-1"></span>
                                          <span className="text-sm">({line.reps_tuple_text})</span>
                                        </span>
                                        {line.sets > 1 && (
                                          <span className="text-lg font-medium ml-1">x{line.sets}</span>
                                        )}
                                        {idx < combo.set_lines.length - 1 && (
                                          <span className="mx-2 text-gray-400">,</span>
                                        )}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-sm text-gray-400 italic">No prescription</div>
                                )}
                                {combo.notes && (
                                  <div className="text-sm text-gray-600 mt-2 italic">
                                    {combo.notes}
                                  </div>
                                )}
                              </div>
                            );
                          }
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
