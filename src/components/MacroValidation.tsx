import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PlannedExercise, Exercise, Athlete, WeekPlan } from '../lib/database.types';

interface MacroTarget {
  id: string;
  macro_week_id: string;
  tracked_exercise_id: string;
  exercise_id: string;
  target_reps: number | null;
  target_ave: number | null;
  target_hi: number | null;
  target_rhi: number | null;
  target_shi: number | null;
}

interface ComboSetLineData {
  planned_combo_id: string;
  position: number;
  sets: number;
  reps_tuple_text: string;
  load_value: number;
}

interface ComboItemData {
  planned_combo_id: string;
  exercise_id: string;
  position: number;
  planned_exercise_id: string;
}

interface ComboData {
  id: string;
  unit: string;
  day_index: number;
}

interface MacroValidationProps {
  athlete: Athlete;
  weekPlan: WeekPlan;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
}

interface AggregatedActuals {
  totalReps: number;
  avgWeight: number;
  hiWeight: number;
  repsHi: number;
  setsHi: number;
}

export function MacroValidation({ athlete, weekPlan, plannedExercises }: MacroValidationProps) {
  const [macroTargets, setMacroTargets] = useState<Record<string, MacroTarget>>({});
  const [trackedExercises, setTrackedExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [comboData, setComboData] = useState<ComboData[]>([]);
  const [comboSetLines, setComboSetLines] = useState<ComboSetLineData[]>([]);
  const [comboItems, setComboItems] = useState<ComboItemData[]>([]);

  useEffect(() => {
    loadMacroTargets();
    loadComboData();
  }, [athlete.id, weekPlan.week_start, weekPlan.id]);

  const loadComboData = async () => {
    if (!weekPlan?.id) return;

    try {
      const { data: combos } = await supabase
        .from('planned_combos')
        .select('id, unit, day_index')
        .eq('weekplan_id', weekPlan.id);

      const combosArray = (combos || []) as ComboData[];
      setComboData(combosArray);

      if (combosArray.length === 0) {
        setComboSetLines([]);
        setComboItems([]);
        return;
      }

      const comboIds = combosArray.map(c => c.id);

      const { data: setLines } = await supabase
        .from('planned_combo_set_lines')
        .select('planned_combo_id, position, sets, reps_tuple_text, load_value')
        .in('planned_combo_id', comboIds);

      setComboSetLines((setLines || []) as ComboSetLineData[]);

      const { data: items } = await supabase
        .from('planned_combo_items')
        .select('planned_combo_id, exercise_id, position, planned_exercise_id')
        .in('planned_combo_id', comboIds);

      setComboItems((items || []) as ComboItemData[]);
    } catch (err) {
      console.error('Failed to load combo data:', err);
    }
  };

  const loadMacroTargets = async () => {
    setLoading(true);
    try {
      console.log('MacroValidation: Loading targets for athlete:', athlete.id);
      console.log('MacroValidation: Week start:', weekPlan.week_start);

      const { data: macroWeeks, error: macroError } = await supabase
        .from('macro_weeks')
        .select(`
          id,
          macrocycle_id,
          week_start,
          macrocycles!inner(athlete_id, start_date, end_date)
        `)
        .eq('macrocycles.athlete_id', athlete.id)
        .lte('week_start', weekPlan.week_start)
        .gte('week_start', new Date(new Date(weekPlan.week_start).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .lte('macrocycles.start_date', weekPlan.week_start)
        .gte('macrocycles.end_date', weekPlan.week_start)
        .order('week_start', { ascending: false })
        .limit(1);

      if (macroError) throw macroError;

      console.log('MacroValidation: Macro weeks found:', macroWeeks);

      if (!macroWeeks || macroWeeks.length === 0) {
        console.log('MacroValidation: No macro weeks found');
        setMacroTargets({});
        setTrackedExercises([]);
        return;
      }

      const macroWeek = macroWeeks[0];
      const macrocycleId = macroWeek.macrocycle_id;

      console.log('MacroValidation: Macrocycle ID:', macrocycleId);
      console.log('MacroValidation: Macro week ID:', macroWeek.id);

      const { data: trackedExercisesData, error: trackedError } = await supabase
        .from('macro_tracked_exercises')
        .select('id, exercise_id, exercises(*)')
        .eq('macrocycle_id', macrocycleId)
        .order('position');

      if (trackedError) throw trackedError;

      console.log('MacroValidation: Tracked exercises data:', trackedExercisesData);

      const exercises = (trackedExercisesData || [])
        .map(item => item.exercises)
        .filter(Boolean) as Exercise[];

      setTrackedExercises(exercises);

      const { data: targetsData, error: targetsError } = await supabase
        .from('macro_targets')
        .select('*')
        .eq('macro_week_id', macroWeek.id);

      if (targetsError) throw targetsError;

      console.log('MacroValidation: Targets data:', targetsData);

      const trackedExerciseMap: Record<string, string> = {};
      (trackedExercisesData || []).forEach(te => {
        trackedExerciseMap[te.exercise_id] = te.id;
      });

      const targetsMap: Record<string, MacroTarget> = {};
      (targetsData || []).forEach(target => {
        const trackedEx = (trackedExercisesData || []).find(te => te.id === target.tracked_exercise_id);
        if (trackedEx) {
          targetsMap[trackedEx.exercise_id] = {
            ...target,
            exercise_id: trackedEx.exercise_id
          };
        }
      });

      setMacroTargets(targetsMap);
    } catch (err) {
      console.error('Failed to load macro targets:', err);
    } finally {
      setLoading(false);
    }
  };

  const computeActuals = (exerciseId: string): AggregatedActuals => {
    let totalReps = 0;
    let totalWeightedReps = 0;
    let hiWeight = 0;

    interface SetInfo {
      weight: number;
      reps: number;
      sets: number;
    }
    const allSets: SetInfo[] = [];

    Object.values(plannedExercises).forEach(dayExercises => {
      dayExercises.forEach(ex => {
        if (ex.exercise_id === exerciseId) {
          totalReps += ex.summary_total_reps || 0;

          if (ex.unit === 'absolute_kg' && ex.summary_avg_load) {
            totalWeightedReps += (ex.summary_avg_load * (ex.summary_total_reps || 0));
          }

          if (ex.prescription_raw && ex.unit === 'absolute_kg') {
            const segments = ex.prescription_raw.split(',').map(s => s.trim());
            segments.forEach(segment => {
              const match = segment.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)(?:\s*[x×]\s*(\d+))?/i);
              if (match) {
                const weight = parseFloat(match[1]);
                const reps = parseInt(match[2], 10);
                const sets = match[3] ? parseInt(match[3], 10) : 1;

                allSets.push({ weight, reps, sets });

                if (weight > hiWeight) {
                  hiWeight = weight;
                }
              }
            });
          }
        }
      });
    });

    const itemsForExercise = comboItems.filter(item => item.exercise_id === exerciseId);

    itemsForExercise.forEach(item => {
      const combo = comboData.find(c => c.id === item.planned_combo_id);
      if (!combo || combo.unit !== 'absolute_kg') return;

      const setLinesForCombo = comboSetLines.filter(line => line.planned_combo_id === item.planned_combo_id);

      setLinesForCombo.forEach(line => {
        const repsTuple = line.reps_tuple_text.split('+').map(r => parseInt(r.trim(), 10));
        const repsForThisExercise = repsTuple[item.position - 1] || 0;
        const weight = line.load_value || 0;
        const sets = line.sets || 1;

        const totalRepsForLine = repsForThisExercise * sets;
        totalReps += totalRepsForLine;

        if (weight > 0) {
          totalWeightedReps += (weight * totalRepsForLine);

          allSets.push({ weight, reps: repsForThisExercise, sets });

          if (weight > hiWeight) {
            hiWeight = weight;
          }
        }
      });
    });

    let repsHi = 0;
    let setsHi = 0;

    if (hiWeight > 0) {
      allSets.forEach(setInfo => {
        if (setInfo.weight === hiWeight) {
          if (setInfo.reps > repsHi) {
            repsHi = setInfo.reps;
          }
          setsHi += setInfo.sets;
        }
      });
    }

    const avgWeight = totalReps > 0 ? totalWeightedReps / totalReps : 0;

    return {
      totalReps,
      avgWeight: Math.round(avgWeight * 10) / 10,
      hiWeight,
      repsHi,
      setsHi,
    };
  };

  const getCellColor = (actual: number, target: number | null): string => {
    if (target === null || target === 0) return '';
    if (actual === 0) return 'bg-red-100';

    const percentage = (actual / target) * 100;
    if (percentage >= 95 && percentage <= 105) return 'bg-green-100';
    if (percentage >= 85 && percentage <= 115) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  if (trackedExercises.length === 0 && !loading) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between hover:bg-gray-50 -m-3 p-3 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Macro Validation
          </h3>
          {!isExpanded && trackedExercises.length > 0 && (
            <span className="text-xs text-gray-500">
              ({trackedExercises.length})
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp size={16} className="text-gray-400" />
        ) : (
          <ChevronDown size={16} className="text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-3">
          {loading ? (
            <div className="text-xs text-gray-500">Loading...</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1 px-2 font-medium text-gray-700">Exercise</th>
                      <th className="text-center py-1 px-2 font-medium text-gray-700">Reps</th>
                      <th className="text-center py-1 px-2 font-medium text-gray-700">Ave</th>
                      <th className="text-center py-1 px-2 font-medium text-gray-700">Hi</th>
                      <th className="text-center py-1 px-2 font-medium text-gray-700">Rhi</th>
                      <th className="text-center py-1 px-2 font-medium text-gray-700">Shi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackedExercises.map(exercise => {
                      const target = macroTargets[exercise.id];
                      const actual = computeActuals(exercise.id);

                      return (
                        <tr key={exercise.id} className="border-b border-gray-100 last:border-0">
                          <td className="py-1 px-2 font-medium text-gray-900">
                            {exercise.name}
                          </td>
                          <td className={`py-1 px-2 text-center ${getCellColor(actual.totalReps, target?.target_reps || null)}`}>
                            {actual.totalReps} / {target?.target_reps ?? '−'}
                          </td>
                          <td className={`py-1 px-2 text-center ${getCellColor(actual.avgWeight, target?.target_ave || null)}`}>
                            {actual.avgWeight} / {target?.target_ave ?? '−'}
                          </td>
                          <td className={`py-1 px-2 text-center ${getCellColor(actual.hiWeight, target?.target_hi || null)}`}>
                            {actual.hiWeight} / {target?.target_hi ?? '−'}
                          </td>
                          <td className={`py-1 px-2 text-center ${getCellColor(actual.repsHi, target?.target_rhi || null)}`}>
                            {actual.repsHi} / {target?.target_rhi ?? '−'}
                          </td>
                          <td className={`py-1 px-2 text-center ${getCellColor(actual.setsHi, target?.target_shi || null)}`}>
                            {actual.setsHi} / {target?.target_shi ?? '−'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-2 pt-2 border-t border-gray-200">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-100 border border-green-200 rounded"></span>
                  <span>On Target</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-yellow-100 border border-yellow-200 rounded"></span>
                  <span>Close</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-red-100 border border-red-200 rounded"></span>
                  <span>Off</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
