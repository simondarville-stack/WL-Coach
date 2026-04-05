import type {
  WeekPlan,
  PlannedExercise,
  Exercise,
  DefaultUnit,
  ComboMemberEntry,
} from '../../lib/database.types';
import { DayCard } from './DayCard';
import { calculateRestInfo, buildWeekdayCells } from '../../lib/restCalculation';
import type { ScheduleEntry } from '../../lib/restCalculation';

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
        {/* Day cards — flex-wrap so training cards keep min width and spill to next row */}
        <div className="flex flex-wrap gap-2">
          {cells.map(cell => (
            cell.isRestDay ? (
              /* Thin vertical separator — stays narrow, wraps with the row */
              <div
                key={cell.weekday}
                className="flex flex-col items-center gap-1 self-stretch py-1"
                style={{ flex: '0 0 2rem' }}
              >
                <div className="flex-1 border-l border-dashed border-gray-200 w-0" />
                <span className="text-[8px] text-gray-300 select-none" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  {cell.weekdayName}
                </span>
              </div>
            ) : (
              <div key={cell.weekday} className="space-y-2" style={{ flex: '1 1 180px' }}>
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
