import { Fragment } from 'react';
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

/** The AM/PM boundary, in minutes from midnight.
 *  COACH-CONFIG candidate — a coach training at 05:00 may draw it elsewhere. */
const AM_END_MINUTES = 12 * 60;

/** Which band a session belongs to. An untimed session is the day's only one
 *  (DayConfigModal requires a time as soon as two units share a weekday), so it
 *  has no AM/PM meaning and sits in the first band rather than being guessed
 *  into the afternoon. */
function isMorning(time: string | null): boolean {
  if (!time) return true;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0) < AM_END_MINUTES;
}

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
    position: number | null,
    unit: DefaultUnit,
    extras?: { metadata?: import('../../lib/database.types').PlannedExerciseMetadata },
  ) => Promise<import('../../lib/database.types').PlannedExercise & { id: string }>;
  createComboExercise: (
    weekPlanId: string,
    dayIndex: number,
    position: number | null,
    data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string },
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  onReorderInDay: (dayIndex: number, orderedIds: string[]) => void;
  onDeleteExercise: (plannedExId: string) => Promise<void>;
  /** Clear every exercise in a training unit (delete-held + click on header). */
  onClearDay: (dayIndex: number) => Promise<void>;
  onExerciseDrop: (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  onDayDrop: (sourceDay: number, destDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  /** Reorder the unit cards. Applied only where position is the coach's to
   *  choose — see the call sites below. */
  onReorderDay?: (fromDayIndex: number, toDayIndex: number) => void;
  onDockExerciseDrop?: (exerciseId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDrop?: (templateId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDayDrop?: (templateDayId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onClipboardItemDrop?: (clipboardItemId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onSaveAsTemplate?: (dayIndex: number) => void;
  visibleCardMetrics?: MetricKey[];
  competitionTotal?: number | null;
  savePrescription: (id: string, data: { prescription: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<unknown>;
  /** Persist a GPP block payload on a planned_exercise row. */
  saveGppSection?: (plannedExId: string, section: import('../../lib/database.types').GppSection) => Promise<void>;
  /** Persist the exercise-features bag (⏱ total time, Σ/Ø overrides). */
  saveExerciseFeatures?: (plannedExId: string, features: import('../../lib/database.types').ExerciseFeatures) => Promise<void>;
  /** Coach's # prescription presets. */
  presets?: import('../../lib/database.types').CoachPreset[];
  onManagePresets?: () => void;
  /** Snapshot a row into a new preset and open the manager on it. */
  onSaveAsPreset?: (ex: import('../../lib/database.types').PlannedExercise & { exercise: import('../../lib/database.types').Exercise }) => void;
  /** Persist which row parts the athlete app hides (eye menu). */
  saveAthleteVisibility?: (plannedExId: string, hidden: import('../../lib/database.types').AthleteHiddenKey[]) => Promise<void>;
  loadIncrement: number;
  defaultPrescriptionLoad: number;
  isLinkedToGroupPlan?: boolean;
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
  onReorderInDay,
  onDeleteExercise,
  onClearDay,
  onExerciseDrop,
  onDayDrop,
  onReorderDay,
  onDockExerciseDrop,
  onDockTemplateDrop,
  onDockTemplateDayDrop,
  onClipboardItemDrop,
  onSaveAsTemplate,
  visibleCardMetrics,
  competitionTotal,
  savePrescription,
  saveGppSection,
  saveExerciseFeatures,
  presets,
  onManagePresets,
  onSaveAsPreset,
  saveAthleteVisibility,
  loadIncrement,
  defaultPrescriptionLoad,
  isLinkedToGroupPlan = false,
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

  // One definition of the card. The calendar bands, the unscheduled shelf and
  // abstract mode all render the same DayCard with the same wiring; three
  // copies of a 30-prop list is three places to forget a prop.
  const renderCard = (slotIndex: number, dayName: string, reorderable = false) => (
    <DayCard
      key={slotIndex}
      dayIndex={slotIndex}
      dayName={dayName}
      weekPlanId={weekPlan.id}
      exercises={plannedExercises[slotIndex] || []}
      comboMembers={comboMembers}
      allExercises={allExercises}
      restInfo={restInfoMap.get(slotIndex)}
      visibleMetrics={visibleCardMetrics}
      competitionTotal={competitionTotal}
      onNavigateToDay={() => onNavigateToDay(slotIndex)}
      onNavigateToExercise={id => onNavigateToExercise(slotIndex, id)}
      addExerciseToDay={addExerciseToDay}
      createComboExercise={createComboExercise}
      onRefresh={onRefresh}
      onReorderInDay={onReorderInDay}
      onDeleteExercise={onDeleteExercise}
      onClearDay={onClearDay}
      onExerciseDrop={onExerciseDrop}
      onDayDrop={onDayDrop}
      onReorderDay={reorderable ? onReorderDay : undefined}
      onDockExerciseDrop={onDockExerciseDrop}
      onDockTemplateDrop={onDockTemplateDrop}
      onDockTemplateDayDrop={onDockTemplateDayDrop}
      onClipboardItemDrop={onClipboardItemDrop}
      onSaveAsTemplate={onSaveAsTemplate}
      savePrescription={savePrescription}
      saveGppSection={saveGppSection}
      saveExerciseFeatures={saveExerciseFeatures}
      presets={presets}
      onManagePresets={onManagePresets}
      onSaveAsPreset={onSaveAsPreset}
      saveAthleteVisibility={saveAthleteVisibility}
      loadIncrement={loadIncrement}
      defaultPrescriptionLoad={defaultPrescriptionLoad}
      isLinkedToGroupPlan={isLinkedToGroupPlan}
    />
  );

  // ── Calendar-mapped view ──────────────────────────────────────────────────
  if (isCalendarMapped) {
    const cells = buildWeekdayCells(activeSlots, schedule);
    const unscheduledDays = visibleDays.filter(d => !schedule![d.index]);

    // Split every day's sessions into a morning and an afternoon band. The
    // bands are grid ROWS spanning the whole week, so the AM/PM divider sits at
    // one height for all days instead of wherever each column's first card
    // happened to end. That alignment is only definable in a single row, so the
    // week no longer wraps — it scrolls sideways when it does not fit, which
    // also keeps the week's shape readable.
    const banded = cells.map(cell => ({
      cell,
      am: cell.trainingSessions.filter(s => isMorning(s.time)),
      pm: cell.trainingSessions.filter(s => !isMorning(s.time)),
    }));
    const showDivider = banded.some(b => b.am.length > 0) && banded.some(b => b.pm.length > 0);
    const pmRow = showDivider ? 4 : 2;

    const session = (slotIndex: number, time: string | null, showTime: boolean) => (
      <div key={slotIndex}>
        {showTime && time && (
          <div style={{
            fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 500,
            marginBottom: 2, textAlign: 'center',
          }}>
            {time}
          </div>
        )}
        {renderCard(slotIndex, visibleDays.find(d => d.index === slotIndex)?.name ?? `Day ${slotIndex}`)}
      </div>
    );

    return (
      <div style={{ padding: 16 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: banded.map(b => (b.cell.isRestDay ? '1.75rem' : 'minmax(260px, 1fr)')).join(' '),
          gridTemplateRows: showDivider ? 'auto auto auto auto' : 'auto auto',
          columnGap: 8,
          rowGap: 6,
          overflowX: 'auto',
          alignItems: 'start',
        }}>
          {banded.map(({ cell, am, pm }, col) => (
            <Fragment key={cell.weekday}>
              {/* Weekday label — in a fixed grid the column has to name itself,
                  or an aligned band cannot be read back to a day. */}
              <div style={{
                gridColumn: col + 1, gridRow: 1,
                fontSize: 9, fontWeight: 500, textAlign: 'center',
                color: 'var(--color-text-tertiary)', userSelect: 'none',
                overflow: 'hidden',
              }}>
                {cell.weekdayName}
              </div>

              {cell.isRestDay ? (
                <div style={{
                  gridColumn: col + 1, gridRow: `2 / -1`,
                  display: 'flex', justifyContent: 'center',
                  alignSelf: 'stretch', padding: '4px 0',
                }}>
                  <div style={{ borderLeft: '1px dashed var(--color-border-tertiary)', width: 0 }} />
                </div>
              ) : (
                <>
                  {am.length > 0 && (
                    <div style={{ gridColumn: col + 1, gridRow: 2, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {am.map(s => session(s.slotIndex, s.time, cell.trainingSessions.length > 1))}
                    </div>
                  )}
                  {pm.length > 0 && (
                    <div style={{ gridColumn: col + 1, gridRow: pmRow, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {pm.map(s => session(s.slotIndex, s.time, cell.trainingSessions.length > 1))}
                    </div>
                  )}
                </>
              )}
            </Fragment>
          ))}

          {showDivider && (
            <div style={{
              gridColumn: '1 / -1', gridRow: 3,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '2px 0',
            }}>
              <span style={{
                fontSize: 9, fontWeight: 500, letterSpacing: '0.05em',
                color: 'var(--color-text-tertiary)', userSelect: 'none',
              }}>
                PM
              </span>
              <span style={{ flex: 1, height: '0.5px', background: 'var(--color-border-tertiary)' }} />
            </div>
          )}
        </div>

        {unscheduledDays.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{
              fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.05em', marginBottom: 8,
            }}>
              Unscheduled
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
              {/* Unscheduled units have no weekday to place them, so their
                  order is the coach's — same as abstract mode. */}
              {unscheduledDays.map(day => renderCard(day.index, day.name, true))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Abstract mode ──────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
        {visibleDays.map(day => renderCard(day.index, day.name, true))}
      </div>
    </div>
  );
}
