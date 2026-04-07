import type { MacroWeek, MacroTarget, MacroTrackedExerciseWithExercise } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';

interface MacroSummaryBarProps {
  macroWeeks: MacroWeek[];
  targets: MacroTarget[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  actuals: MacroActualsMap;
}

export function MacroSummaryBar({ macroWeeks, targets, trackedExercises, actuals }: MacroSummaryBarProps) {
  const totalTargetReps = macroWeeks.reduce((sum, w) => sum + (w.total_reps_target || 0), 0);

  const totalActualReps = Object.values(actuals).reduce((weekSum, weekActuals) => {
    return weekSum + Object.values(weekActuals).reduce((exSum, a) => exSum + a.totalReps, 0);
  }, 0);

  const completedWeeks = macroWeeks.filter(w => {
    const weekActuals = actuals[w.id];
    if (!weekActuals) return false;
    return Object.values(weekActuals).some(a => a.totalReps > 0);
  }).length;

  const peakHiPerExercise: { name: string; color: string; peak: number }[] = trackedExercises.map(te => {
    const peak = Math.max(
      0,
      ...targets
        .filter(t => t.tracked_exercise_id === te.id && t.target_max !== null)
        .map(t => t.target_max as number),
    );
    return { name: te.exercise.exercise_code || te.exercise.name, color: te.exercise.color, peak };
  }).filter(x => x.peak > 0);

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 flex flex-wrap items-center gap-4 text-xs text-gray-600">
      <div className="flex items-center gap-1">
        <span className="font-medium text-gray-800">Planned volume:</span>
        <span>{totalTargetReps.toLocaleString()} reps</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-medium text-gray-800">Actual so far:</span>
        <span>{totalActualReps.toLocaleString()} reps</span>
        {totalTargetReps > 0 && (
          <span className="text-gray-400">({Math.round((totalActualReps / totalTargetReps) * 100)}%)</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="font-medium text-gray-800">Weeks:</span>
        <span>{completedWeeks}/{macroWeeks.length} done</span>
      </div>
      {peakHiPerExercise.length > 0 && (
        <div className="flex items-center gap-2 ml-auto">
          <span className="font-medium text-gray-800">Peak Hi:</span>
          {peakHiPerExercise.map(ex => (
            <span key={ex.name} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ex.color }} />
              <span>{ex.name}: {ex.peak}kg</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
