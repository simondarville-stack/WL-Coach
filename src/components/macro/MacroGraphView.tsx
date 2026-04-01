import { useState } from 'react';
import type { MacroWeek, MacroPhase, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import { MacroDraggableChart } from './MacroDraggableChart';

interface MacroGraphViewProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  competitions: MacroCompetition[];
  actuals: MacroActualsMap;
  onDragTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: number) => Promise<void>;
}

export function MacroGraphView({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  competitions,
  actuals,
  onDragTarget,
}: MacroGraphViewProps) {
  // Linked exercises move together when dragged
  const [linkedExerciseIds, setLinkedExerciseIds] = useState<Set<string>>(new Set());

  const handleToggleLink = (trackedExId: string) => {
    setLinkedExerciseIds(prev => {
      const next = new Set(prev);
      if (next.has(trackedExId)) next.delete(trackedExId);
      else next.add(trackedExId);
      return next;
    });
  };

  const sharedProps = {
    macroWeeks,
    trackedExercises,
    targets,
    phases,
    competitions,
    actuals,
    onDragTarget,
    linkedExerciseIds,
    onToggleLink: handleToggleLink,
  };

  if (macroWeeks.length === 0 || trackedExercises.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        No data to display. Add tracked exercises and targets to see charts.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-gray-400">
        Drag dots to adjust targets. Click exercise badges to link them (linked exercises move together).
        Solid lines = targets, dashed = actuals.
      </p>
      <MacroDraggableChart metric="reps" label="Total Reps" {...sharedProps} />
      <MacroDraggableChart metric="hi" label="Hi Load (kg)" {...sharedProps} />
      <MacroDraggableChart metric="ave" label="Average Load (kg)" {...sharedProps} />
    </div>
  );
}
