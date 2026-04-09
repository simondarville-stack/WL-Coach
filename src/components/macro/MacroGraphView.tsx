import { useState } from 'react';
import type { MacroWeek, MacroPhase, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import type { GeneralMetricKey } from './ExerciseToggleBar';
import { MacroDraggableChart } from './MacroDraggableChart';

interface MacroGraphViewProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  competitions: MacroCompetition[];
  actuals: MacroActualsMap;
  onDragTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: number) => Promise<void>;
  focusedExerciseId?: string | null;
  visibleExercises: Set<string>;
  visibleGeneralMetrics?: Set<GeneralMetricKey>;
  showReps: boolean;
}

export function MacroGraphView({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  competitions,
  actuals,
  onDragTarget,
  focusedExerciseId,
  visibleExercises,
  visibleGeneralMetrics,
  showReps,
}: MacroGraphViewProps) {
  const [linkedExerciseIds, setLinkedExerciseIds] = useState<Set<string>>(new Set());

  const handleToggleLink = (trackedExId: string) => {
    setLinkedExerciseIds(prev => {
      const next = new Set(prev);
      if (next.has(trackedExId)) next.delete(trackedExId);
      else next.add(trackedExId);
      return next;
    });
  };

  const displayedExercises = trackedExercises.filter(te => visibleExercises.has(te.id));

  if (macroWeeks.length === 0 || trackedExercises.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        No data to display. Add tracked exercises and targets to see the chart.
      </div>
    );
  }

  if (displayedExercises.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        All exercises hidden. Use the toggles above to show exercises.
      </div>
    );
  }

  return (
    <MacroDraggableChart
      macroWeeks={macroWeeks}
      trackedExercises={displayedExercises}
      targets={targets}
      phases={phases}
      competitions={competitions}
      actuals={actuals}
      onDragTarget={onDragTarget}
      linkedExerciseIds={linkedExerciseIds}
      onToggleLink={handleToggleLink}
      focusedExerciseId={focusedExerciseId}
      visibleGeneralMetrics={visibleGeneralMetrics ?? new Set()}
      showReps={showReps}
    />
  );
}
