import type { MacroWeek, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget, WeekTypeConfig } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import type { FillGuidePreview } from './fillGuidePlan';
import { MacroChartV2 } from './MacroChartV2';

interface MacroGraphViewProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  competitions: MacroCompetition[];
  actuals: MacroActualsMap;
  weekTypes: WeekTypeConfig[];
  onDragTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: number) => Promise<void>;
  focusedExerciseId?: string | null;
  visibleExercises: Set<string>;
  showReps: boolean;
  fillPreview?: FillGuidePreview | null;
  visibleGeneralSeries?: Set<string>;
  onDragWeekTarget?: (
    weekId: string,
    field: 'total_reps_target' | 'tonnage_target' | 'avg_intensity_target',
    value: number,
  ) => Promise<void>;
  onDragAnchor?: (which: 'from' | 'to', kg: number) => void;
}

export function MacroGraphView({
  macroWeeks,
  trackedExercises,
  targets,
  competitions,
  actuals,
  weekTypes,
  onDragTarget,
  focusedExerciseId,
  visibleExercises,
  showReps,
  fillPreview,
  visibleGeneralSeries,
  onDragWeekTarget,
  onDragAnchor,
}: MacroGraphViewProps) {
  const displayedExercises = trackedExercises.filter(te => visibleExercises.has(te.id));

  // Weeks are enough — the general series (Σreps / tonnage / avg intensity)
  // are chartable and draggable before any exercise is tracked.
  if (macroWeeks.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        No weeks to display.
      </div>
    );
  }

  return (
    <MacroChartV2
      macroWeeks={macroWeeks}
      trackedExercises={displayedExercises}
      targets={targets}
      competitions={competitions}
      actuals={actuals}
      weekTypes={weekTypes}
      onDragTarget={onDragTarget}
      focusedExerciseId={focusedExerciseId}
      showReps={showReps}
      fillPreview={fillPreview}
      visibleGeneralSeries={visibleGeneralSeries}
      onDragWeekTarget={onDragWeekTarget}
      onDragAnchor={onDragAnchor}
    />
  );
}
