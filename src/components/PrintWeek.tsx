import { useEffect, useState } from 'react';
import { X, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { WeekPlan, PlannedExercise, Exercise, Athlete, PlannedComboWithDetails, DefaultUnit } from '../lib/database.types';
import { DAYS_OF_WEEK } from '../lib/constants';
import { getUnitSymbol } from '../lib/constants';
import { formatDateRange, formatDateToDDMMYYYY } from '../lib/dateUtils';
import { PrescriptionDisplay } from './PrescriptionDisplay';

interface PrintWeekProps {
  athlete: Athlete;
  weekStart: string;
  onClose: () => void;
  showCategorySummaries?: boolean;
  dayLabels?: Record<number, string> | null;
  weekDescription?: string | null;
}

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

export function PrintWeek({ athlete, weekStart, onClose, showCategorySummaries = true, dayLabels = null, weekDescription = null }: PrintWeekProps) {
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Record<number, (PlannedExercise & { exercise: Exercise })[]>>({});
  const [combos, setCombos] = useState<PlannedComboWithDetails[]>([]);
  const [comboExerciseIds, setComboExerciseIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWeekData();
  }, [athlete.id, weekStart]);

  const loadWeekData = async () => {
    try {
      setLoading(true);

      const { data: plan, error: planError } = await supabase
        .from('week_plans')
        .select('*')
        .eq('week_start', weekStart)
        .eq('athlete_id', athlete.id)
        .maybeSingle();

      if (planError) throw planError;
      if (!plan) {
        setLoading(false);
        return;
      }

      setWeekPlan(plan);

      const { data: exercises, error: exercisesError } = await supabase
        .from('planned_exercises')
        .select(`*, exercise:exercise_id(*)`)
        .eq('weekplan_id', plan.id)
        .order('day_index')
        .order('position');

      if (exercisesError) throw exercisesError;

      const grouped: Record<number, (PlannedExercise & { exercise: Exercise })[]> = {};
      DAYS_OF_WEEK.forEach((day) => {
        grouped[day.index] = [];
      });

      const { data: combosData, error: combosError } = await supabase
        .from('planned_combos')
        .select('*')
        .eq('weekplan_id', plan.id)
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

      (exercises || []).forEach((item) => {
        if (!grouped[item.day_index]) {
          grouped[item.day_index] = [];
        }
        grouped[item.day_index].push(item);
      });

      setPlannedExercises(grouped);
      setCombos(combosWithDetails);
      setComboExerciseIds(linkedIds);
    } catch (err) {
      console.error('Failed to load week data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDateRangeLocal = () => {
    return formatDateRange(weekStart, 7);
  };

  const handlePrint = () => {
    window.print();
  };

  const getDayLabel = (dayIndex: number): string => {
    const labels = dayLabels || weekPlan?.day_labels;
    if (labels && labels[dayIndex]) {
      return labels[dayIndex];
    }
    return DAYS_OF_WEEK.find(d => d.index === dayIndex)?.name || `Day ${dayIndex}`;
  };

  const activeDays = weekPlan?.active_days || [1, 2, 3, 4, 5, 6, 7];
  const visibleDays = activeDays.map(dayIndex => ({
    index: dayIndex,
    name: getDayLabel(dayIndex)
  }));

  const calculateCategorySummaries = () => {
    const categoryTotals: Record<string, { sets: number; reps: number; totalLoad: number; avgLoad: number; loadCount: number }> = {};

    Object.values(plannedExercises).forEach((dayExercises) => {
      dayExercises.forEach((ex) => {
        if (!comboExerciseIds.has(ex.id) && ex.exercise.counts_towards_totals && ex.exercise.category) {
          if (!categoryTotals[ex.exercise.category]) {
            categoryTotals[ex.exercise.category] = { sets: 0, reps: 0, totalLoad: 0, avgLoad: 0, loadCount: 0 };
          }
          categoryTotals[ex.exercise.category].sets += ex.summary_total_sets || 0;
          categoryTotals[ex.exercise.category].reps += ex.summary_total_reps || 0;

          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
            const tonnage = ex.summary_avg_load * (ex.summary_total_reps || 0);
            categoryTotals[ex.exercise.category].totalLoad += tonnage;
            categoryTotals[ex.exercise.category].avgLoad += ex.summary_avg_load;
            categoryTotals[ex.exercise.category].loadCount += 1;
          }
        }
      });
    });

    Object.keys(categoryTotals).forEach(category => {
      if (categoryTotals[category].loadCount > 0) {
        categoryTotals[category].avgLoad = categoryTotals[category].avgLoad / categoryTotals[category].loadCount;
      }
    });

    return categoryTotals;
  };

  const categorySummaries = calculateCategorySummaries();

  const calculateWeeklyTotal = () => {
    let totalSets = 0;
    let totalReps = 0;
    let totalLoad = 0;

    Object.values(plannedExercises).forEach((dayExercises) => {
      dayExercises.forEach((ex) => {
        if (!comboExerciseIds.has(ex.id) && ex.exercise.counts_towards_totals) {
          totalSets += ex.summary_total_sets || 0;
          totalReps += ex.summary_total_reps || 0;
          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
            totalLoad += ex.summary_avg_load * (ex.summary_total_reps || 0);
          }
        }
      });
    });

    combos.forEach(combo => {
      combo.set_lines.forEach(line => {
        const totalRepsInTuple = line.reps_tuple_text.split('+').reduce((r, p) => r + (parseInt(p.trim(), 10) || 0), 0);
        totalSets += line.sets;
        totalReps += line.sets * totalRepsInTuple;
        if (combo.unit === 'absolute_kg') {
          totalLoad += line.load_value * line.sets * totalRepsInTuple;
        }
      });
    });

    return { totalSets, totalReps, totalLoad };
  };

  const weeklyTotal = calculateWeeklyTotal();

  const calculateAge = (birthdate: string | null): number | null => {
    if (!birthdate) return null;
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <p className="text-gray-600">Loading week plan...</p>
        </div>
      </div>
    );
  }

  if (!weekPlan) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md">
          <h2 className="text-xl font-bold text-gray-900 mb-4">No Week Plan</h2>
          <p className="text-gray-600 mb-6">No training plan found for this week.</p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const age = calculateAge(athlete.birthdate);

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-auto">
      <div className="print:hidden bg-gray-100 border-b border-gray-300 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <h2 className="text-xl font-bold text-gray-900">Print Preview</h2>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Printer size={18} />
            Print
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <style>
        {`
          @media print {
            @page {
              margin: 1.5cm;
            }
          }
        `}
      </style>
      <div className="print-content max-w-[210mm] mx-auto bg-white p-8 print:p-6">
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-300">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{athlete.name}</h1>
            <p className="text-sm text-gray-600">
              {age !== null && `${age} years old`}
              {athlete.bodyweight && ` • ${athlete.bodyweight}kg`}
              {athlete.weight_class && ` • ${athlete.weight_class}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-gray-900">{formatDateRangeLocal()}</p>
            <p className="text-xs text-gray-500 mt-1">
              Generated {formatDateToDDMMYYYY(new Date().toISOString())}
            </p>
          </div>
        </div>

        {weeklyTotal.totalSets > 0 && (
          <div className="mb-6 pb-4 border-b-2 border-gray-300">
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-3">Total Weekly Summary</h2>
            <div className="flex items-center gap-6 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <div>
                <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total Sets</p>
                <p className="text-2xl font-bold text-blue-900">{weeklyTotal.totalSets}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total Reps</p>
                <p className="text-2xl font-bold text-blue-900">{weeklyTotal.totalReps}</p>
              </div>
              {weeklyTotal.totalLoad > 0 && (
                <div>
                  <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Total Load</p>
                  <p className="text-2xl font-bold text-blue-900">{Math.round(weeklyTotal.totalLoad)} kg</p>
                </div>
              )}
            </div>
          </div>
        )}

        {showCategorySummaries && Object.keys(categorySummaries).length > 0 && (
          <div className="mb-6 pb-4 border-b border-gray-300">
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-3">Week Summary by Category</h2>
            <div className="grid grid-cols-6 gap-2">
              {Object.entries(categorySummaries)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([category, totals]) => (
                  <div key={category} className="bg-gray-50 rounded p-2 border border-gray-200">
                    <div className="text-xs font-semibold text-gray-700 mb-1">
                      {category}
                    </div>
                    <div className="text-xs text-gray-900 space-y-0.5">
                      <div><span className="font-bold">{totals.sets}</span> sets</div>
                      <div><span className="font-bold">{totals.reps}</span> reps</div>
                      {totals.totalLoad > 0 && (
                        <>
                          <div><span className="font-bold">{Math.round(totals.totalLoad)}</span> kg</div>
                          <div className="text-gray-600">avg {Math.round(totals.avgLoad)}kg</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {weekDescription && weekDescription.trim() && (
          <div className="mb-6 pb-4 border-b border-gray-300">
            <h2 className="text-sm font-bold text-gray-700 uppercase mb-2">Week Notes</h2>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{weekDescription}</p>
            </div>
          </div>
        )}

        {visibleDays.map((day) => {
          const allDayExercises = plannedExercises[day.index] || [];
          const dayExercises = allDayExercises.filter(ex => !comboExerciseIds.has(ex.id));
          const dayCombos = combos.filter(c => c.day_index === day.index);
          if (dayExercises.length === 0 && dayCombos.length === 0) return null;

          const allItems = [
            ...dayExercises.map(ex => ({ type: 'exercise' as const, data: ex, position: ex.position })),
            ...dayCombos.map(c => ({ type: 'combo' as const, data: c, position: c.position })),
          ].sort((a, b) => a.position - b.position);

          const daySets = dayExercises
            .filter((ex) => ex.exercise.counts_towards_totals)
            .reduce((sum, ex) => sum + (ex.summary_total_sets || 0), 0) +
            dayCombos.reduce((sum, combo) => sum + combo.set_lines.reduce((s, line) => s + line.sets, 0), 0);
          const dayReps = dayExercises
            .filter((ex) => ex.exercise.counts_towards_totals)
            .reduce((sum, ex) => sum + (ex.summary_total_reps || 0), 0) +
            dayCombos.reduce((sum, combo) => sum + combo.set_lines.reduce((s, line) => {
              const totalRepsInTuple = line.reps_tuple_text.split('+').reduce((r, p) => r + (parseInt(p.trim(), 10) || 0), 0);
              return s + line.sets * totalRepsInTuple;
            }, 0), 0);

          return (
            <div key={day.index} className="mb-6 break-inside-avoid">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-300">
                <h2 className="text-lg font-bold text-gray-900 uppercase">{day.name}</h2>
                {(daySets > 0 || dayReps > 0) && (
                  <div className="text-xs text-gray-600">
                    {daySets > 0 && `${daySets} sets`}
                    {daySets > 0 && dayReps > 0 && ' • '}
                    {dayReps > 0 && `${dayReps} reps`}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {allItems.map((item) => {
                  if (item.type === 'exercise') {
                    const plannedEx = item.data;
                    const unitSymbol = getUnitSymbol(plannedEx.unit);
                    const hasSummary = plannedEx.summary_total_sets !== null && plannedEx.summary_total_sets > 0;

                    return (
                      <div key={plannedEx.id} className="break-inside-avoid">
                        <div className="flex items-start gap-2">
                          <div
                            className="w-1 h-full min-h-[40px] rounded"
                            style={{ backgroundColor: plannedEx.exercise.color }}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-bold text-gray-900">
                                {plannedEx.exercise.name}
                              </h3>
                              {unitSymbol && (
                                <span className="text-[10px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                                  {unitSymbol}
                                </span>
                              )}
                            </div>

                            {plannedEx.prescription_raw && (
                              <div className="mb-1">
                                <PrescriptionDisplay
                                  prescription={plannedEx.prescription_raw}
                                  unit={plannedEx.unit}
                                  useStackedNotation={plannedEx.exercise.use_stacked_notation || false}
                                />
                              </div>
                            )}

                            {hasSummary && (
                              <p className="text-xs text-gray-500">
                                S {plannedEx.summary_total_sets} | R {plannedEx.summary_total_reps}
                                {plannedEx.summary_highest_load !== null && (
                                  <> | Hi {plannedEx.summary_highest_load.toFixed(0)} | Avg {plannedEx.summary_avg_load?.toFixed(0)}</>
                                )}
                              </p>
                            )}

                            {plannedEx.notes && (
                              <p className="text-xs text-gray-600 italic mt-1">
                                {plannedEx.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    const combo = item.data;
                    const unitSym = formatUnit(combo.unit);
                    const hasSetLines = combo.set_lines.length > 0 && combo.set_lines.some((l: any) => l.load_value > 0);

                    return (
                      <div key={combo.id} className="break-inside-avoid">
                        <div className="flex items-start gap-2">
                          <div className="w-1 h-full min-h-[40px] rounded bg-blue-500" />
                          <div className="flex-1">
                            <h3 className="text-sm font-bold text-gray-900 mb-1">
                              {getComboDisplayName(combo)}
                            </h3>
                            <p className="text-xs text-gray-500 mb-2">
                              {combo.items.map((ci: any, idx: number) => (
                                <span key={ci.id}>
                                  {idx > 0 && ' + '}
                                  {ci.exercise.name}
                                </span>
                              ))}
                            </p>
                            {hasSetLines ? (
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {combo.set_lines.map((line: any, idx: number) => (
                                  <span key={line.id} className="flex items-center gap-1">
                                    <span className="inline-flex flex-col items-center border rounded px-3 py-2 bg-gray-50">
                                      <span className="text-base font-bold">
                                        {line.load_value}
                                        <span className="text-xs ml-1">{unitSym}</span>
                                      </span>
                                      <span className="w-full border-t border-gray-400 my-1"></span>
                                      <span className="text-xs">({line.reps_tuple_text})</span>
                                    </span>
                                    {line.sets > 1 && (
                                      <span className="text-base font-semibold">x{line.sets}</span>
                                    )}
                                    {idx < combo.set_lines.length - 1 && (
                                      <span className="text-gray-400 mx-1">,</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {combo.notes && (
                              <p className="text-xs text-gray-600 italic mt-1">
                                {combo.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }
                })}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }

          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          .print\\:hidden {
            display: none !important;
          }

          .print\\:p-0 {
            padding: 0 !important;
          }

          .print-content {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .break-inside-avoid {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
