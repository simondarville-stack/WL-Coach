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
  focusedExerciseId?: string | null;
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
    focusedExerciseId,
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
      <div className="flex items-center gap-3 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        <span>Drag dots to adjust targets.</span>
        <span className="border-l border-gray-300 pl-3">Hold <kbd className="px-1 py-px bg-gray-100 border border-gray-300 rounded text-[10px]">Ctrl</kbd> while dragging Hi/Avg to move both together.</span>
        <span className="border-l border-gray-300 pl-3">Click exercise badge to link across exercises.</span>
        <span className="ml-auto">Solid = target · Dashed = actual</span>
      </div>

      {/* Chart 1: Total Reps */}
      <MacroDraggableChart
        metrics={['reps']}
        label="Total Reps"
        {...sharedProps}
      />

      {/* Chart 2: Hi + Avg load combined */}
      <MacroDraggableChart
        metrics={['max', 'avg']}
        label="Load (kg) — Max & Average"
        {...sharedProps}
      />
    </div>
  );
}
