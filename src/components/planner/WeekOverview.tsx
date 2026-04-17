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
import type { MetricKey } from '../../lib/metrics';

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
  visibleCardMetrics?: MetricKey[];
  competitionTotal?: number | null;
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
  visibleCardMetrics,
  competitionTotal,
}: WeekOverviewProps) {
  if (!weekPlan) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '80px 0', fontSize: 'var(--text-body)', color: 'var(--color-text-tertiary)',
      }}>
        No plan for this week
      </div>
    );
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
    const unscheduledDays = visibleDays.filter(d => !schedule![d.index]);

    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {cells.map(cell => (
            cell.isRestDay ? (
              <div
                key={cell.weekday}
                style={{ flex: '0 0 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, alignSelf: 'stretch', padding: '4px 0' }}
              >
                <div style={{ flex: 1, borderLeft: '1px dashed var(--color-border-tertiary)', width: 0 }} />
                <span style={{
                  fontSize: 8, color: 'var(--color-text-tertiary)', userSelect: 'none',
                  writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                }}>
                  {cell.weekdayName}
                </span>
              </div>
            ) : (
              <div key={cell.weekday} style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cell.trainingSessions.map(session => {
                  const dayEntry = visibleDays.find(d => d.index === session.slotIndex);
                  return (
                    <div key={session.slotIndex}>
                      {cell.trainingSessions.length > 1 && session.time && (
                        <div style={{
                          fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 500,
                          marginBottom: 2, textAlign: 'center',
                        }}>
                          {session.time}
                        </div>
                      )}
                      <DayCard
                        dayIndex={session.slotIndex}
                        dayName={dayEntry?.name ?? `Day ${session.slotIndex}`}
                        weekPlanId={weekPlan.id}
                        exercises={plannedExercises[session.slotIndex] || []}
                        comboMembers={comboMembers}
                        allExercises={allExercises}
                        restInfo={restInfoMap.get(session.slotIndex)}
                        visibleMetrics={visibleCardMetrics}
                        competitionTotal={competitionTotal}
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

        {unscheduledDays.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{
              fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.05em', marginBottom: 8,
            }}>
              Unscheduled
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {unscheduledDays.map(day => (
                <DayCard
                  key={day.index}
                  dayIndex={day.index}
                  dayName={day.name}
                  weekPlanId={weekPlan.id}
                  exercises={plannedExercises[day.index] || []}
                  comboMembers={comboMembers}
                  allExercises={allExercises}
                  visibleMetrics={visibleCardMetrics}
                  competitionTotal={competitionTotal}
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

  // ── Abstract mode ──────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
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
            visibleMetrics={visibleCardMetrics}
            competitionTotal={competitionTotal}
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
