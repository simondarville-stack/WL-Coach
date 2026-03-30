import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, AlertTriangle, Clipboard, ArrowRight } from 'lucide-react';
import type { Athlete, TrainingGroup } from '../lib/database.types';
import { formatDateRange } from '../lib/dateUtils';

interface CopyWeekModalProps {
  onClose: () => void;
  onPasteComplete: () => void;
  destinationWeekStart: string;
  sourceWeekStart: string;
  sourceAthlete: Athlete | null;
  sourceGroup: TrainingGroup | null;
  destinationAthlete: Athlete | null;
  destinationGroup: TrainingGroup | null;
  allAthletes: Athlete[];
  allGroups: TrainingGroup[];
}

type TargetType = 'athlete' | 'group';

export function CopyWeekModal({
  onClose,
  onPasteComplete,
  destinationWeekStart,
  sourceWeekStart,
  sourceAthlete,
  sourceGroup,
  destinationAthlete,
  destinationGroup,
  allAthletes,
  allGroups,
}: CopyWeekModalProps) {
  const getInitialTargetType = (): TargetType => {
    if (destinationGroup) return 'group';
    return 'athlete';
  };

  const [targetType, setTargetType] = useState<TargetType>(getInitialTargetType());
  const [selectedTargetAthleteId, setSelectedTargetAthleteId] = useState<string>(
    destinationAthlete?.id || ''
  );
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState<string>(
    destinationGroup?.id || ''
  );
  const [destinationHasData, setDestinationHasData] = useState(false);
  const [pasting, setPasting] = useState(false);

  const resolveTarget = (): { athlete: Athlete | null; group: TrainingGroup | null } => {
    if (targetType === 'athlete') {
      const athlete = allAthletes.find(a => a.id === selectedTargetAthleteId) || null;
      return { athlete, group: null };
    }
    if (targetType === 'group') {
      const group = allGroups.find(g => g.id === selectedTargetGroupId) || null;
      return { athlete: null, group };
    }
    return { athlete: null, group: null };
  };

  const target = resolveTarget();

  const isSameContext =
    sourceWeekStart === destinationWeekStart &&
    sourceAthlete?.id === target.athlete?.id &&
    sourceGroup?.id === target.group?.id;

  useEffect(() => {
    checkDestinationData();
  }, [destinationWeekStart, targetType, selectedTargetAthleteId, selectedTargetGroupId]);

  const buildOwnerFilter = (
    query: any,
    athlete: Athlete | null,
    group: TrainingGroup | null
  ) => {
    if (athlete) {
      return query.eq('athlete_id', athlete.id).is('group_id', null);
    }
    if (group) {
      return query.eq('group_id', group.id).is('athlete_id', null);
    }
    return query.is('athlete_id', null).is('group_id', null);
  };

  const checkDestinationData = async () => {
    try {
      let query = supabase
        .from('week_plans')
        .select('id', { count: 'exact', head: true })
        .eq('week_start', destinationWeekStart);

      query = buildOwnerFilter(query, target.athlete, target.group);

      const { count } = await query;
      setDestinationHasData((count ?? 0) > 0);
    } catch (err) {
      console.error('Failed to check destination data:', err);
    }
  };

  const handlePaste = async () => {
    if (isSameContext) {
      alert('Source and destination are identical');
      return;
    }

    setPasting(true);
    try {
      // 1. Fetch source week plan using SOURCE context
      let sourceQuery = supabase
        .from('week_plans')
        .select('*')
        .eq('week_start', sourceWeekStart);

      sourceQuery = buildOwnerFilter(sourceQuery, sourceAthlete, sourceGroup);

      const { data: sourceWeekPlan, error: sourceError } = await sourceQuery.maybeSingle();

      if (sourceError) {
        console.error('Source query error:', sourceError);
        throw sourceError;
      }
      if (!sourceWeekPlan) {
        alert('Source week has no data to paste');
        setPasting(false);
        return;
      }

      // 2. Delete existing destination data if present
      if (destinationHasData) {
        let deleteQuery = supabase
          .from('week_plans')
          .delete()
          .eq('week_start', destinationWeekStart);

        deleteQuery = buildOwnerFilter(deleteQuery, target.athlete, target.group);

        const { error: deleteError } = await deleteQuery;
        if (deleteError) {
          console.error('Delete error:', deleteError);
          throw deleteError;
        }
      }

      // 3. Create new week plan with DESTINATION owner context
      const { id: _oldId, created_at: _created, ...weekPlanData } = sourceWeekPlan;
      const newWeekPlan = {
        ...weekPlanData,
        week_start: destinationWeekStart,
        athlete_id: target.athlete?.id || null,
        group_id: target.group?.id || null,
        is_group_plan: !!target.group,
      };

      const { data: createdWeekPlan, error: createError } = await supabase
        .from('week_plans')
        .insert([newWeekPlan])
        .select()
        .single();

      if (createError) {
        console.error('Create week plan error:', createError);
        throw createError;
      }

      // 4. Copy planned exercises
      const { data: sourceExercises, error: exercisesError } = await supabase
        .from('planned_exercises')
        .select('*')
        .eq('weekplan_id', sourceWeekPlan.id);

      if (exercisesError) throw exercisesError;

      const exerciseIdMap = new Map<string, string>();

      if (sourceExercises && sourceExercises.length > 0) {
        for (const ex of sourceExercises) {
          const { id: oldExId, created_at: _created, weekplan_id: _oldWeekPlanId, ...exData } = ex;

          const { data: newExercise, error: insertExError } = await supabase
            .from('planned_exercises')
            .insert([{
              ...exData,
              weekplan_id: createdWeekPlan.id,
            }])
            .select()
            .single();

          if (insertExError) throw insertExError;
          if (newExercise) {
            exerciseIdMap.set(oldExId, newExercise.id);
          }
        }
      }

      // 5. Copy combos, combo items, and set lines
      const { data: sourceCombos, error: combosError } = await supabase
        .from('planned_combos')
        .select('*')
        .eq('weekplan_id', sourceWeekPlan.id);

      if (combosError) throw combosError;

      if (sourceCombos && sourceCombos.length > 0) {
        const comboIdMap = new Map<string, string>();

        for (const combo of sourceCombos) {
          const { id: oldComboId, created_at: _created, weekplan_id: _oldWeekPlanId, ...comboData } = combo;

          const { data: newCombo, error: comboInsertError } = await supabase
            .from('planned_combos')
            .insert([{
              ...comboData,
              weekplan_id: createdWeekPlan.id,
            }])
            .select()
            .single();

          if (comboInsertError) throw comboInsertError;
          comboIdMap.set(oldComboId, newCombo.id);
        }

        const { data: sourceComboItems, error: comboItemsError } = await supabase
          .from('planned_combo_items')
          .select('*')
          .in('planned_combo_id', Array.from(comboIdMap.keys()));

        if (comboItemsError) throw comboItemsError;

        if (sourceComboItems && sourceComboItems.length > 0) {
          const newComboItems = sourceComboItems.map(item => {
            const { id: _id, created_at: _created, planned_combo_id: oldComboId, planned_exercise_id: oldExId, ...itemData } = item;
            return {
              ...itemData,
              planned_combo_id: comboIdMap.get(oldComboId)!,
              planned_exercise_id: exerciseIdMap.get(oldExId)!,
            };
          });

          const { error: itemsInsertError } = await supabase
            .from('planned_combo_items')
            .insert(newComboItems);

          if (itemsInsertError) {
            console.error('Combo items insert error:', itemsInsertError);
            throw itemsInsertError;
          }
        }

        const { data: sourceSetLines, error: setLinesError } = await supabase
          .from('planned_combo_set_lines')
          .select('*')
          .in('planned_combo_id', Array.from(comboIdMap.keys()));

        if (setLinesError) throw setLinesError;

        if (sourceSetLines && sourceSetLines.length > 0) {
          const newSetLines = sourceSetLines.map(line => {
            const { id: _id, created_at: _created, planned_combo_id: oldComboId, ...lineData } = line;
            return {
              ...lineData,
              planned_combo_id: comboIdMap.get(oldComboId)!,
            };
          });

          const { error: linesInsertError } = await supabase
            .from('planned_combo_set_lines')
            .insert(newSetLines);

          if (linesInsertError) throw linesInsertError;
        }
      }

      onPasteComplete();
      onClose();
    } catch (err: any) {
      console.error('Failed to paste week:', err);
      const errorMessage = err?.message || 'Unknown error';
      alert(`Failed to paste week: ${errorMessage}`);
    } finally {
      setPasting(false);
    }
  };

  const sourceLabel = sourceAthlete
    ? sourceAthlete.name
    : sourceGroup
    ? `${sourceGroup.name} (Group)`
    : 'Unassigned';

  const targetLabel = target.athlete
    ? target.athlete.name
    : target.group
    ? `${target.group.name} (Group)`
    : 'Select target...';

  const isCrossContext =
    sourceAthlete?.id !== target.athlete?.id ||
    sourceGroup?.id !== target.group?.id;

  const hasValidTarget =
    (targetType === 'athlete' && !!selectedTargetAthleteId) ||
    (targetType === 'group' && !!selectedTargetGroupId);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Clipboard size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Paste Week</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Source info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-900">
              <span className="font-semibold">Source:</span> {sourceLabel} — {formatDateRange(sourceWeekStart)}
            </p>
          </div>

          {/* Destination target selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Paste to</label>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setTargetType('athlete');
                  if (!selectedTargetAthleteId && allAthletes.length > 0) {
                    setSelectedTargetAthleteId(allAthletes[0].id);
                  }
                }}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  targetType === 'athlete'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Athlete
              </button>
              {allGroups.length > 0 && (
                <button
                  onClick={() => {
                    setTargetType('group');
                    if (!selectedTargetGroupId && allGroups.length > 0) {
                      setSelectedTargetGroupId(allGroups[0].id);
                    }
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    targetType === 'group'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Group
                </button>
              )}
            </div>

            {targetType === 'athlete' && (
              <select
                value={selectedTargetAthleteId}
                onChange={(e) => setSelectedTargetAthleteId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select athlete...</option>
                {allAthletes.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}

            {targetType === 'group' && (
              <select
                value={selectedTargetGroupId}
                onChange={(e) => setSelectedTargetGroupId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select group...</option>
                {allGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Destination summary */}
          {hasValidTarget && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-2">
              <ArrowRight size={16} className="text-gray-400 flex-shrink-0" />
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Destination:</span> {targetLabel} — {formatDateRange(destinationWeekStart)}
              </p>
            </div>
          )}

          {isCrossContext && hasValidTarget && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Cross-context paste: exercises and structure will be copied from <strong>{sourceLabel}</strong> to <strong>{targetLabel}</strong>.
            </div>
          )}

          {destinationHasData && hasValidTarget && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium">Warning: Destination week has existing data</p>
                <p className="text-xs mt-1">All existing exercises and combos will be deleted and replaced with the copied week's data.</p>
              </div>
            </div>
          )}

          {isSameContext && hasValidTarget && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Source and destination are identical. Select a different athlete, group, or week.
            </div>
          )}

          <div className="text-sm text-gray-600">
            This will copy all exercises, combos, and week settings from the source to the destination.
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={pasting}
          >
            Cancel
          </button>
          <button
            onClick={handlePaste}
            disabled={pasting || isSameContext || !hasValidTarget}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {pasting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Pasting...
              </>
            ) : (
              <>
                <Clipboard size={16} />
                Paste Week
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
