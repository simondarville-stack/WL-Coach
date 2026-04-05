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

    // Rest-day columns are narrow spacers; training-day columns share remaining space equally
    const columnTemplate = cells.map(c => c.isRestDay ? '2.5rem' : '1fr').join(' ');

    return (
      <div className="p-4">
        {/* Weekday headers */}
        <div className="grid gap-2 mb-1" style={{ gridTemplateColumns: columnTemplate }}>
          {WEEKDAY_FULL.map((d, i) => (
            <div key={d} className="text-center text-[10px] font-medium text-gray-400 uppercase tracking-wide overflow-hidden">
              {cells[i]?.isRestDay ? '' : d.slice(0, 3)}
            </div>
          ))}
        </div>

        {/* Recovery strip */}
        <RecoveryStrip cells={cells} columnTemplate={columnTemplate} />

        {/* Day cards / rest cells */}
        <div className="grid gap-2" style={{ gridTemplateColumns: columnTemplate }}>
          {cells.map(cell => (
            cell.isRestDay ? (
              <div
                key={cell.weekday}
                className="flex flex-col items-center pt-1 gap-1"
              >
                <div className="flex-1 w-px border-l border-dashed border-gray-200 min-h-[60px]" />
                <span className="text-[8px] text-gray-300" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{cell.weekdayName}</span>
              </div>
            ) : (
              <div key={cell.weekday} className="space-y-2">
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
