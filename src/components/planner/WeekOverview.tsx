import { useState, useEffect } from 'react';
import type {
  WeekPlan,
  PlannedExercise,
  Exercise,
  DefaultUnit,
  AthletePR,
  GeneralSettings,
  ComboMemberEntry,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { DayCard } from './DayCard';
import { WeekSummary } from './WeekSummary';

interface WeekOverviewProps {
  weekPlan: WeekPlan | null;
  visibleDays: { index: number; name: string }[];
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  comboMembers: Record<string, ComboMemberEntry[]>;
  allExercises: Exercise[];
  athletePRs: AthletePR[];
  macroWeekTarget: number | null;
  macroContext: MacroContext | null;
  weekDescription: string;
  settings: GeneralSettings | null;
  onSaveWeekDescription: (value: string) => Promise<void>;
  onNavigateToDay: (dayIndex: number) => void;
  onNavigateToExercise: (dayIndex: number, exerciseId: string) => void;
  addExerciseToDay: (
    weekPlanId: string,
    dayIndex: number,
    exerciseId: string,
    position: number,
    unit: DefaultUnit,
  ) => Promise<unknown>;
  createComboExercise: (
    weekPlanId: string,
    dayIndex: number,
    position: number,
    data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string },
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  onDeleteExercise: (plannedExId: string) => Promise<void>;
  onExerciseDrop: (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean) => Promise<void>;
  onDayDrop: (sourceDay: number, destDay: number, isCopy: boolean) => Promise<void>;
}

export function WeekOverview({
  weekPlan,
  visibleDays,
  plannedExercises,
  comboMembers,
  allExercises,
  athletePRs,
  macroWeekTarget,
  macroContext,
  weekDescription,
  settings,
  onSaveWeekDescription,
  onNavigateToDay,
  onNavigateToExercise,
  addExerciseToDay,
  createComboExercise,
  onRefresh,
  onDeleteExercise,
  onExerciseDrop,
  onDayDrop,
}: WeekOverviewProps) {
  const [localDescription, setLocalDescription] = useState(weekDescription);
  useEffect(() => { setLocalDescription(weekDescription); }, [weekDescription]);

  if (!weekPlan) {
    return <div className="flex items-center justify-center py-20 text-sm text-gray-400">No plan for this week</div>;
  }

  return (
    <div className="p-4 space-y-4">

      {/* Week summary */}
      <WeekSummary
        plannedExercises={plannedExercises}
        athletePRs={athletePRs}
        macroContext={macroContext}
        macroWeekTarget={macroWeekTarget}
        settings={settings}
      />

      {/* Week description */}
      <textarea
        value={localDescription}
        onChange={e => setLocalDescription(e.target.value)}
        onBlur={e => { void onSaveWeekDescription(e.target.value); }}
        placeholder="Week notes / description…"
        rows={2}
        className="w-full text-sm text-gray-700 placeholder-gray-400 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
      />

      {/* Day cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {visibleDays.map(day => (
          <DayCard
            key={day.index}
            dayIndex={day.index}
            dayName={day.name}
            weekPlanId={weekPlan.id}
            exercises={plannedExercises[day.index] || []}
            comboMembers={comboMembers}
            allExercises={allExercises}
            onNavigateToDay={() => onNavigateToDay(day.index)}
            onNavigateToExercise={id => onNavigateToExercise(day.index, id)}
            addExerciseToDay={addExerciseToDay}
            createComboExercise={createComboExercise}
            onRefresh={onRefresh}
            onDeleteExercise={onDeleteExercise}
            onExerciseDrop={onExerciseDrop}
            onDayDrop={onDayDrop}
          />
        ))}
      </div>
    </div>
  );
}
