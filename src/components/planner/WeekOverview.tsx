import type {
  WeekPlan,
  PlannedExercise,
  Exercise,
  DefaultUnit,
  ComboMemberEntry,
} from '../../lib/database.types';
import { DayCard } from './DayCard';
import { RecoveryStrip } from './RecoveryStrip';
import { calculateRestInfo, buildWeekdayCells } from '../../lib/restCalculation';
import type { ScheduleEntry } from '../../lib/restCalculation';

const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface WeekOverviewProps {
  weekPlan: WeekPlan | null;
  visibleDays: { index: number; name: string }[];
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  comboMembers: Record<string, ComboMemberEntry[]>;
  allExercises: Exercise[];
  daySchedule: Record<number, { weekday: number; time: string | null }> | null;
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
  daySchedule,
  onNavigateToDay,
  onNavigateToExercise,
  addExerciseToDay,
  createComboExercise,
  onRefresh,
  onDeleteExercise,
  onExerciseDrop,
  onDayDrop,
}: WeekOverviewProps) {
  if (!weekPlan) {
    return <div className="flex items-center justify-center py-20 text-sm text-gray-400">No plan for this week</div>;
  }

  const activeSlots = visibleDays.map(d => d.index);
  const schedule = (daySchedule && Object.keys(daySchedule).length > 0)
    ? daySchedule as Record<number, ScheduleEntry>
    : null;
  const isCalendarMapped = !!schedule;

  const restInfoList = calculateRestInfo(activeSlots, schedule);
  const restInfoMap = new Map(restInfoList.map(r => [r.slotIndex, r]));

  // ── Calendar-mapped view ──────────────────────────────────────────────────
  if (isCalendarMapped) {
    const cells = buildWeekdayCells(activeSlots, schedule);

    // Slots not in schedule — show below as "Unscheduled"
    const unscheduledDays = visibleDays.filter(d => !schedule![d.index]);

    return (
      <div className="p-4">
        {/* Weekday headers — only visible when all 7 fit in one row */}
        <div className="hidden lg:grid grid-cols-7 gap-2 mb-1">
          {WEEKDAY_FULL.map(d => (
            <div key={d} className="text-center text-[10px] font-medium text-gray-400 uppercase tracking-wide">{d.slice(0, 3)}</div>
          ))}
        </div>

        {/* Recovery strip — only visible at full 7-col width */}
        <div className="hidden lg:block">
          <RecoveryStrip cells={cells} columnTemplate="repeat(7, 1fr)" />
        </div>

        {/* Day cards — responsive wrapping grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {cells.map(cell => (
            cell.isRestDay ? (
              <div
                key={cell.weekday}
                className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 min-h-[70px] flex flex-col items-center justify-center gap-0.5 px-1"
              >
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{cell.weekdayName}</span>
                <span className="text-[9px] text-gray-300">Rest</span>
              </div>
            ) : (
              <div key={cell.weekday} className="space-y-2">
                {/* Weekday label shown inline when headers row is hidden */}
                <div className="lg:hidden text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5">{cell.weekdayName}</div>
                {cell.trainingSessions.map(session => {
                  const dayEntry = visibleDays.find(d => d.index === session.slotIndex);
                  return (
                    <div key={session.slotIndex}>
                      {cell.trainingSessions.length > 1 && session.time && (
                        <div className="text-[9px] text-gray-400 font-medium mb-0.5 text-center">{session.time}</div>
                      )}
                      <DayCard
                        dayIndex={session.slotIndex}
                        dayName={dayEntry?.name ?? `Day ${session.slotIndex}`}
                        weekPlanId={weekPlan.id}
                        exercises={plannedExercises[session.slotIndex] || []}
                        comboMembers={comboMembers}
                        allExercises={allExercises}
                        restInfo={restInfoMap.get(session.slotIndex)}
                        onNavigateToDay={() => onNavigateToDay(session.slotIndex)}
                        onNavigateToExercise={id => onNavigateToExercise(session.slotIndex, id)}
                        addExerciseToDay={addExerciseToDay}
                        createComboExercise={createComboExercise}
                        onRefresh={onRefresh}
                        onDeleteExercise={onDeleteExercise}
                        onExerciseDrop={onExerciseDrop}
                        onDayDrop={onDayDrop}
                      />
                    </div>
                  );
                })}
              </div>
            )
          ))}
        </div>

        {/* Unscheduled slots */}
        {unscheduledDays.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2">Unscheduled</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {unscheduledDays.map(day => (
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
        )}
      </div>
    );
  }

  // ── Abstract mode (default) ───────────────────────────────────────────────
  return (
    <div className="p-4">
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
            restInfo={restInfoMap.get(day.index)}
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
