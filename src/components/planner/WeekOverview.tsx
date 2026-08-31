import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { expandForCounting } from '../../lib/comboExpansion';
import { addDaysToISO, formatDateShort } from '../../lib/dateUtils';
import { DayCardCondensed } from './DayCardCondensed';
import { MARK_DAY } from './dragPayload';

/** The AM/PM boundary, in minutes from midnight.
 *  COACH-CONFIG candidate — a coach training at 05:00 may draw it elsewhere. */
const AM_END_MINUTES = 12 * 60;

/** Narrowest a day column may become before the week re-wraps. Seven of
 *  these is the width at which the week stops fitting a laptop; below it the
 *  exercise names stop being readable, which is the point of the card. */
// COACH-CONFIG candidate.
const COLUMN_FLOOR = 190;

/** Horizontal gap between day columns — used both in the grid style and in the
 *  fits-N-columns arithmetic, so keep them one constant. */
const COLUMN_GAP = 8;

/** How many columns the scheduled week renders at a given container width.
 *  Deliberate breaks instead of auto-fit's arbitrary ones: a full week when it
 *  fits, otherwise Mon–Thu over Fri–Sun (the split a coach actually reads),
 *  then pairs, then a single column. */
function columnsForWidth(width: number): number {
  const fits = (n: number) => width >= n * COLUMN_FLOOR + (n - 1) * COLUMN_GAP;
  return fits(7) ? 7 : fits(4) ? 4 : fits(2) ? 2 : 1;
}

/** "2nd" / "3rd" / "4th" — for the add-session drop field's label. */
function ordinal(n: number): string {
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

/** The field that appears under a weekday's sessions while a unit card is in
 *  the air. Dropping a unit here assigns it to this weekday as its OWN
 *  session — the way a coach builds 2-a-day training — unlike dropping onto a
 *  card, which merges the unit's contents into that card. */
function ScheduleDropZone({
  weekday,
  weekdayName,
  sessionCount,
  onScheduleDrop,
}: {
  weekday: number;
  weekdayName: string;
  sessionCount: number;
  onScheduleDrop: (slotIndex: number, weekday: number) => Promise<void> | void;
}) {
  const [over, setOver] = useState(false);
  const isRest = sessionCount === 0;
  return (
    <div
      onDragOver={e => {
        if (!e.dataTransfer.types.includes(MARK_DAY)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const data = e.dataTransfer.getData('text/plain');
        if (!data.startsWith('DAY:')) return;
        const slot = parseInt(data.slice(4), 10);
        if (!Number.isNaN(slot)) void onScheduleDrop(slot, weekday);
      }}
      style={{
        minHeight: isRest ? 72 : 40,
        borderRadius: 'var(--radius-md)',
        border: `1.5px dashed ${over ? 'var(--color-accent)' : 'var(--color-border-secondary)'}`,
        background: over ? 'var(--color-accent-muted)' : 'var(--color-bg-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'var(--text-caption)', fontWeight: 500,
        color: over ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
        transition: 'border-color 0.12s, background 0.12s',
        userSelect: 'none',
      }}
    >
      {isRest ? `Move to ${weekdayName}` : `+ ${ordinal(sessionCount + 1)} session`}
    </div>
  );
}

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
  /** Assign a training unit to a weekday (scheduled view). Fired by the
   *  per-column drop field — the unit keeps its contents and becomes a session
   *  of that day, so two units on one weekday = 2-a-day training. */
  onScheduleDrop?: (slotIndex: number, weekday: number) => Promise<void>;
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
  onScheduleDrop,
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
  const activeSlots = visibleDays.map(d => d.index);
  const schedule = (daySchedule && Object.keys(daySchedule).length > 0)
    ? daySchedule as Record<number, ScheduleEntry>
    : null;
  const isCalendarMapped = !!schedule;

  const restInfoList = calculateRestInfo(activeSlots, schedule);
  const restInfoMap = new Map(restInfoList.map(r => [r.slotIndex, r]));

  // Which units are open for editing. The scheduled week shows condensed cards
  // by default — seven columns of full prescription grids is the density that
  // made it unreadable — and swaps in the real DayCard for the ones opened, so
  // editing behaviour lives in exactly one component.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = useCallback((slot: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot); else next.add(slot);
      return next;
    });
  }, []);
  const allExpanded = activeSlots.length > 0 && activeSlots.every(s => expanded.has(s));
  const toggleExpandAll = useCallback(() => {
    setExpanded(prev => (activeSlots.every(s => prev.has(s)) ? new Set() : new Set(activeSlots)));
  }, [activeSlots]);

  // Same computation the full card runs, so a unit's condensed strip and its
  // expanded strip cannot report different numbers.
  const metricsBySlot = useMemo(() => {
    const out = new Map<number, ReturnType<typeof computeMetrics>>();
    for (const slot of activeSlots) {
      const rows = plannedExercises[slot] || [];
      out.set(slot, computeMetrics(
        rows
          .flatMap(ex => expandForCounting(ex, comboMembers[ex.id]))
          .map(c => ({ ...c, counts_towards_totals: c.exercise.counts_towards_totals })),
        competitionTotal ?? null,
      ));
    }
    return out;
  }, [activeSlots, plannedExercises, comboMembers, competitionTotal]);
  const metricsForSlot = (slot: number) =>
    metricsBySlot.get(slot) ?? computeMetrics([], competitionTotal ?? null);

  // How many day columns fit. Measured (not media-queried) because the grid's
  // width depends on the sidebar and dock, not just the viewport. Callback ref
  // so the observer attaches whenever the scheduled grid (re)mounts.
  const [gridCols, setGridCols] = useState(7);
  const gridRO = useRef<ResizeObserver | null>(null);
  const gridWrapRef = useCallback((el: HTMLDivElement | null) => {
    gridRO.current?.disconnect();
    gridRO.current = null;
    if (!el) return;
    const update = () => setGridCols(columnsForWidth(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    gridRO.current = ro;
  }, []);
  useEffect(() => () => gridRO.current?.disconnect(), []);

  // True while a unit card is in the air — the weekday columns grow their
  // add-session drop fields for exactly that long. Cleared on any drop or
  // dragend anywhere, since dragleave is unreliable across nested targets.
  const [unitDragActive, setUnitDragActive] = useState(false);
  useEffect(() => {
    const clear = () => setUnitDragActive(false);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  // Guarded AFTER the hooks above: an early return before them would change the
  // hook count between renders the moment a week plan loads.
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

    // Morning before afternoon within each day. A single week-wide AM/PM rule
    // cannot survive columns that wrap onto a second row, so the clock time on
    // each card carries that information instead.
    const banded = cells.map(cell => ({
      cell,
      am: cell.trainingSessions.filter(s => isMorning(s.time)),
      pm: cell.trainingSessions.filter(s => !isMorning(s.time)),
    }));

    const session = (slotIndex: number, time: string | null) => {
      const name = visibleDays.find(d => d.index === slotIndex)?.name ?? `Day ${slotIndex}`;
      if (expanded.has(slotIndex)) {
        return (
          <div
            key={slotIndex}
            onDoubleClick={e => {
              // The prescription grid's ± cells are clicked in rapid bursts,
              // which the browser also reports as dblclick — only a
              // double-click on passive chrome may collapse the unit.
              const target = e.target as HTMLElement;
              if (target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
              toggleExpanded(slotIndex);
            }}
          >
            {renderCard(slotIndex, name)}
          </div>
        );
      }
      const rows = plannedExercises[slotIndex] || [];
      return (
        <DayCardCondensed
          key={slotIndex}
          dayName={name}
          time={time}
          exercises={rows}
          comboMembers={comboMembers}
          dayMetrics={metricsForSlot(slotIndex)}
          visibleMetrics={visibleCardMetrics ?? DEFAULT_VISIBLE_METRICS}
          onOpen={() => toggleExpanded(slotIndex)}
          dropTargets={{
            dayIndex: slotIndex,
            onClipboardItemDrop,
            onDockExerciseDrop,
            onDockTemplateDrop,
            onDockTemplateDayDrop,
            onDayDrop,
            onExerciseDrop,
          }}
        />
      );
    };

    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={toggleExpandAll}
            title={allExpanded ? 'Collapse every unit' : 'Expand every unit for writing'}
            style={{
              fontSize: 'var(--text-caption)', fontWeight: 500,
              padding: '3px 9px', borderRadius: 'var(--radius-sm)',
              border: '0.5px solid ' + (allExpanded ? 'var(--color-accent-border)' : 'var(--color-border-secondary)'),
              background: allExpanded ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
              color: allExpanded ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        <div
          ref={gridWrapRef}
          onDragOver={e => {
            // A unit card is in the air → grow the per-weekday drop fields.
            // No preventDefault: the fields and cards are the drop targets.
            if (e.dataTransfer.types.includes(MARK_DAY)) setUnitDragActive(true);
          }}
          style={{
            display: 'grid',
            // Explicit equal tracks (auto-fit left a phantom 0px track and
            // wrapped at arbitrary points like 5+2). columnsForWidth breaks
            // the week deliberately: 7 across, else Mon–Thu over Fri–Sun.
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
            columnGap: COLUMN_GAP,
            rowGap: 10,
            alignItems: 'start',
          }}>
          {banded.map(({ cell, am, pm }) => (
            <div key={cell.weekday} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Every column names its own day. A rest day is simply a day
                  with no cards under this title. */}
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 5,
                padding: '0 2px 5px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                userSelect: 'none', overflow: 'hidden',
              }}>
                <span style={{
                  fontSize: 'var(--text-caption)', fontWeight: 600, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: 'var(--color-text-secondary)',
                }}>
                  {cell.weekdayName}
                </span>
                <span style={{
                  fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {formatDateShort(addDaysToISO(weekPlan.week_start, cell.weekday))}
                </span>
                {cell.trainingSessions.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--color-text-tertiary)' }}>
                    {cell.trainingSessions.length}
                  </span>
                )}
              </div>

              {am.map(sn => session(sn.slotIndex, sn.time))}
              {pm.map(sn => session(sn.slotIndex, sn.time))}

              {/* Drop field: lands the dragged unit on THIS weekday as its own
                  session (2nd/3rd of the day), or moves it onto a rest day. */}
              {unitDragActive && onScheduleDrop && (
                <ScheduleDropZone
                  weekday={cell.weekday}
                  weekdayName={cell.weekdayName}
                  sessionCount={cell.trainingSessions.length}
                  onScheduleDrop={onScheduleDrop}
                />
              )}
            </div>
          ))}

        </div>

        {unscheduledDays.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6,
            }}>
              Unscheduled
            </p>
            {/* The same column track as the week, so an unscheduled unit is not
                a third card size on the same screen. */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
              columnGap: COLUMN_GAP, rowGap: 8, alignItems: 'start',
            }}>
              {unscheduledDays.map(day => session(day.index, null))}
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
