import React, { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, StickyNote, X } from 'lucide-react';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, WeekType, WeekTypeConfig } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import type { FillGuidePreview } from './fillGuidePlan';
import { MacroGridCell } from './MacroGridCell';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { getExerciseCategoryShade } from '../../lib/colorUtils';
import { getWeekTypeColor } from '../../lib/weekUtils';

export type MacroTableColumnKey = 'week' | 'weektype' | 'k' | 'tonnage' | 'avg' | 'kvalue' | 'notes';

export const DEFAULT_MACRO_TABLE_COLUMNS: MacroTableColumnKey[] = ['week', 'weektype', 'k', 'tonnage', 'avg', 'kvalue', 'notes'];

export const MACRO_TABLE_COLUMN_LABELS: Record<MacroTableColumnKey, string> = {
  week: 'Week',
  weektype: 'Week style',
  k: 'Σreps',
  tonnage: 'Tonnage',
  avg: 'Avg intensity',
  kvalue: 'K-value',
  notes: 'Notes',
};

// ─── Exercise-metric registry ────────────────────────────────────────────────
// The sub-columns of every exercise column, as an ordered + toggleable list.
// Priority default is Max set > Avg > Reps (the coach-confirmed information
// hierarchy). A future metric is a new key + renderer case, not a rewrite.
export type ExerciseMetricKey = 'max_set' | 'avg' | 'reps';
export const EXERCISE_METRIC_LABELS: Record<ExerciseMetricKey, string> = {
  max_set: 'Max set',
  avg: 'Avg',
  reps: 'Reps',
};
export interface ExerciseMetricConfig { key: ExerciseMetricKey; on: boolean }
export const DEFAULT_EXERCISE_METRICS: ExerciseMetricConfig[] = [
  { key: 'max_set', on: true },
  { key: 'avg', on: true },
  { key: 'reps', on: true },
];

export interface ExerciseColumnState { collapsed?: boolean; expanded?: boolean }

// Collapsed-column heatmap: week max as a fraction of the exercise reference,
// green (well below) → red (at/above). Semantic colour — encodes intensity.
function heatColor(ratio: number): string {
  const r = Math.max(0.55, Math.min(1.05, ratio));
  const t = (r - 0.55) / 0.5;
  return `hsla(${140 - 140 * t}, 70%, 45%, 0.22)`;
}

interface MacroTableV2Props {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  actuals: MacroActualsMap;
  onUpdateTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: string) => Promise<void>;
  onUpdateWeekType: (weekId: string, weekType: WeekType) => Promise<void>;
  onUpdateWeekLabel: (weekId: string, label: string) => Promise<void>;
  onUpdateTotalReps: (weekId: string, value: string) => Promise<void>;
  onUpdateTonnageTarget: (weekId: string, value: string) => Promise<void>;
  onUpdateAvgTarget: (weekId: string, value: string) => Promise<void>;
  onUpdateNotes: (weekId: string, notes: string) => Promise<void>;
  onMoveExerciseLeft: (trackedExId: string) => Promise<void>;
  onMoveExerciseRight: (trackedExId: string) => Promise<void>;
  onRemoveExercise: (trackedExId: string) => Promise<void>;
  onPasteTargets: (targetWeekId: string, copiedTargets: Record<string, Partial<MacroTarget>>) => Promise<void>;
  onExerciseDoubleClick: (trackedExId: string) => void;
  onSwapWeeks?: (weekId1: string, weekId2: string) => Promise<void>;
  competitionTotal?: number | null;
  visibleExercises?: Set<string>;
  visibleColumns?: Set<string>;
  weekTypes?: WeekTypeConfig[];
  highlightedPhaseId?: string | null;
  /** Live fill-guide preview — pending cells render as non-interactive ghosts. */
  fillPreview?: FillGuidePreview | null;
  /** Ordered exercise-metric registry (defaults to Max set > Avg > Reps, all on). */
  metrics?: ExerciseMetricConfig[];
  /** Per tracked-exercise column state (collapsed strip / expanded with Note). */
  exerciseColumnStates?: Record<string, ExerciseColumnState>;
  onToggleCollapse?: (trackedExId: string) => void;
  onToggleExpand?: (trackedExId: string) => void;
  /** Tint the Σreps cell by agreement with the summed exercise reps (±10 %). */
  consistencyTint?: boolean;
  /** Shade collapsed columns by max as % of the exercise reference. */
  collapsedHeatmap?: boolean;
  onUpdateTargetNote?: (weekId: string, trackedExId: string, note: string) => Promise<void>;
}

function getWeekTypeAbbr(wt: string, weekTypes: WeekTypeConfig[]): string {
  if (!wt) return '-';
  const config = weekTypes.find(t => t.abbreviation === wt || t.name.toLowerCase() === wt.toLowerCase());
  return config?.abbreviation ?? wt.slice(0, 2).toLowerCase();
}

// Sticky column widths in px — Notes is sticky; K/Σreps is in the General section
const STICKY_COL_ORDER: MacroTableColumnKey[] = ['week', 'weektype', 'notes'];
const STICKY_COL_WIDTHS: Record<string, number> = { week: 68, weektype: 56, notes: 100 };

// ISO calendar week number from a date string
function getISOWeek(dateStr: string): number {
  const d = new Date(dateStr);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function formatDateMD(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function MacroTableV2({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  onUpdateTarget,
  onUpdateWeekType,
  onUpdateWeekLabel,
  onUpdateTotalReps,
  onUpdateTonnageTarget,
  onUpdateAvgTarget,
  onUpdateNotes,
  onMoveExerciseLeft,
  onMoveExerciseRight,
  onRemoveExercise,
  onExerciseDoubleClick,
  onSwapWeeks,
  competitionTotal,
  visibleExercises,
  visibleColumns,
  weekTypes = [],
  highlightedPhaseId,
  fillPreview,
  metrics,
  exerciseColumnStates,
  onToggleCollapse,
  onToggleExpand,
  consistencyTint = true,
  collapsedHeatmap = true,
  onUpdateTargetNote,
}: MacroTableV2Props) {
  const deleteMode = useDeleteHeld();
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingKWeekId, setEditingKWeekId] = useState<string | null>(null);
  const [editingTonnageId, setEditingTonnageId] = useState<string | null>(null);
  const [editingAvgTargetId, setEditingAvgTargetId] = useState<string | null>(null);
  const [editingWeekTypeTextId, setEditingWeekTypeTextId] = useState<string | null>(null);
  const [dragWeekId, setDragWeekId] = useState<string | null>(null);
  const [dropWeekId, setDropWeekId] = useState<string | null>(null);

  const displayed = visibleExercises
    ? trackedExercises.filter(te => visibleExercises.has(te.id))
    : trackedExercises;

  // Exercise-metric registry + per-column states (≥1 metric always visible)
  const activeMetricsRaw = (metrics ?? DEFAULT_EXERCISE_METRICS).filter(m => m.on).map(m => m.key);
  const activeMetrics: ExerciseMetricKey[] = activeMetricsRaw.length > 0 ? activeMetricsRaw : ['max_set'];
  const colState = (teId: string): ExerciseColumnState => exerciseColumnStates?.[teId] ?? {};
  const exSpan = (teId: string): number =>
    colState(teId).collapsed ? 1 : activeMetrics.length + (colState(teId).expanded ? 1 : 0);
  const totalExSpan = displayed.reduce((s, te) => s + exSpan(te.id), 0);

  // Column visibility helper — defaults to all visible
  const showCol = (col: MacroTableColumnKey): boolean =>
    !visibleColumns || visibleColumns.size === 0 || visibleColumns.has(col);

  // Compute sticky left offsets dynamically
  const stickyLeft: Record<string, number> = {};
  let stickyOffset = 0;
  for (const c of STICKY_COL_ORDER) {
    if (showCol(c)) {
      stickyLeft[c] = stickyOffset;
      stickyOffset += STICKY_COL_WIDTHS[c];
    }
  }
  const lastStickyVisible = [...STICKY_COL_ORDER].reverse().find(c => showCol(c));

  const stickyColCount = STICKY_COL_ORDER.filter(c => showCol(c)).length;
  const generalCols: MacroTableColumnKey[] = ['k', 'tonnage', 'avg', 'kvalue'];
  const generalColCount = generalCols.filter(c => showCol(c)).length;
  const leftColCount = stickyColCount + generalColCount;

  const getTarget = useCallback((weekId: string, teId: string): MacroTarget | undefined =>
    targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === teId),
  [targets]);

  const getPrevTarget = useCallback((weekNumber: number, teId: string): MacroTarget | undefined => {
    const prevWeek = macroWeeks.find(w => w.week_number === weekNumber - 1);
    if (!prevWeek) return undefined;
    return targets.find(t => t.macro_week_id === prevWeek.id && t.tracked_exercise_id === teId);
  }, [macroWeeks, targets]);

  const handleGridUpdate = useCallback(async (
    weekId: string, teId: string, values: { load?: number; reps?: number; sets?: number },
  ) => {
    if (values.load !== undefined) await onUpdateTarget(weekId, teId, 'target_max', String(values.load));
    if (values.reps !== undefined) await onUpdateTarget(weekId, teId, 'target_reps_at_max', String(values.reps));
    if (values.sets !== undefined) await onUpdateTarget(weekId, teId, 'target_sets_at_max', String(values.sets));
  }, [onUpdateTarget]);

  const handleGridDelete = useCallback(async (weekId: string, teId: string) => {
    await onUpdateTarget(weekId, teId, 'target_max', '');
    await onUpdateTarget(weekId, teId, 'target_reps_at_max', '');
    await onUpdateTarget(weekId, teId, 'target_sets_at_max', '');
  }, [onUpdateTarget]);

  // Fix phantom +1: when currentValue is null, initialize from prev without applying delta.
  // Fix bubble: in delete mode, clicking clears the value.
  const handleInlineClick = useCallback((
    e: React.MouseEvent, weekId: string, teId: string, field: 'target_reps' | 'target_avg',
    currentValue: number | null, prevValue: number | null,
  ) => {
    e.preventDefault();

    if (deleteMode && currentValue !== null) {
      onUpdateTarget(weekId, teId, field, '');
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      setEditingCell(`${weekId}_${teId}_${field}`);
      return;
    }
    if (currentValue === null) {
      onUpdateTarget(weekId, teId, field, String(prevValue ?? 0));
      return;
    }
    const delta = e.button === 2 ? -1 : 1;
    onUpdateTarget(weekId, teId, field, String(Math.max(0, currentValue + delta)));
  }, [onUpdateTarget, deleteMode]);

  const cycleWeekType = useCallback((weekId: string, current: string) => {
    if (weekTypes.length === 0) return;
    const idx = weekTypes.findIndex(t => t.abbreviation === current || t.name === current);
    const next = weekTypes[(idx + 1) % weekTypes.length];
    onUpdateWeekType(weekId, next.abbreviation as WeekType);
    onUpdateWeekLabel(weekId, next.abbreviation);
  }, [onUpdateWeekType, onUpdateWeekLabel, weekTypes]);

  // Phase grouping
  const sortedPhases = [...phases].sort((a, b) => a.position - b.position);
  const weekToPhase = new Map<string, MacroPhase>();
  for (const phase of sortedPhases) {
    for (const week of macroWeeks) {
      if (week.week_number >= phase.start_week_number && week.week_number <= phase.end_week_number) {
        if (!weekToPhase.has(week.id)) weekToPhase.set(week.id, phase);
      }
    }
  }

  // Sticky cell class helpers
  function stickyTh(col: MacroTableColumnKey, extra = '') {
    const isLast = col === lastStickyVisible;
    return `sticky z-[10] bg-slate-100 text-[8px] text-[color:var(--color-text-tertiary)] font-normal px-1${isLast ? ' border-r border-[color:var(--color-border-tertiary)]' : ''} ${extra}`;
  }
  function stickyTd(col: MacroTableColumnKey, extra = '') {
    const isLast = col === lastStickyVisible;
    return `sticky z-[5] bg-[var(--color-bg-primary)]${isLast ? ' border-r border-[color:var(--color-border-tertiary)]' : ''} ${extra}`;
  }

  // Summary stats computed from week-level explicit targets (only populated weeks counted)
  // General week-target cells follow the planner interaction: left-click +step,
  // right-click −step, Ctrl+click for manual entry. Empty cells seed from the
  // previous week (falling back to manual entry) instead of typing from scratch.
  const handleWeekFieldClick = (
    e: React.MouseEvent,
    week: MacroWeek,
    field: 'total_reps_target' | 'tonnage_target' | 'avg_intensity_target',
    step: number,
    onUpdate: (weekId: string, value: string) => Promise<void>,
    setEditing: (id: string | null) => void,
  ) => {
    e.preventDefault();
    const current = week[field];
    if (deleteMode && current != null) {
      void onUpdate(week.id, '');
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setEditing(week.id);
      return;
    }
    if (current == null) {
      const prevWeek = macroWeeks.find(w => w.week_number === week.week_number - 1);
      const seed = prevWeek?.[field];
      if (seed != null) void onUpdate(week.id, String(seed));
      else setEditing(week.id);
      return;
    }
    const delta = e.type === 'contextmenu' ? -step : step;
    void onUpdate(week.id, String(Math.max(0, current + delta)));
  };

  const weekFieldTitle = 'Click +, right-click −, Ctrl+click to type';

  const weeksWithK = macroWeeks.filter(w => w.total_reps_target != null);
  const avgK = weeksWithK.length > 0
    ? Math.round(weeksWithK.reduce((s, w) => s + (w.total_reps_target ?? 0), 0) / weeksWithK.length) : null;
  const maxK = weeksWithK.length > 0
    ? Math.max(...weeksWithK.map(w => w.total_reps_target ?? 0)) : null;

  const weeksWithTonnage = macroWeeks.filter(w => w.tonnage_target != null);
  const avgTonnage = weeksWithTonnage.length > 0
    ? weeksWithTonnage.reduce((s, w) => s + (w.tonnage_target ?? 0), 0) / weeksWithTonnage.length : null;
  const maxTonnage = weeksWithTonnage.length > 0
    ? Math.max(...weeksWithTonnage.map(w => w.tonnage_target ?? 0)) : null;

  const weeksWithAvg = macroWeeks.filter(w => w.avg_intensity_target != null);
  const avgIntTarget = weeksWithAvg.length > 0
    ? Math.round(weeksWithAvg.reduce((s, w) => s + (w.avg_intensity_target ?? 0), 0) / weeksWithAvg.length) : null;
  const maxIntTarget = weeksWithAvg.length > 0
    ? Math.max(...weeksWithAvg.map(w => w.avg_intensity_target ?? 0)) : null;

  return (
    <div className="overflow-auto flex-1 border border-[color:var(--color-border-tertiary)] rounded-lg">
      <table className="text-xs" style={{ minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-20">
          {/* Top header row: "Week" section + General section + exercise sections */}
          <tr className="bg-[var(--color-bg-secondary)] border-b border-[color:var(--color-border-tertiary)]">
            {/* Sticky section header: Week + Type + Notes */}
            <th
              colSpan={stickyColCount || 1}
              className="sticky left-0 z-[10] bg-slate-100 px-2 py-1 text-left text-[10px] font-medium text-[color:var(--color-text-secondary)]"
              style={{ minWidth: stickyOffset || 40 }}
            >
              Week
            </th>
            {/* General section header: Σreps + Tonnage + Avg */}
            {generalColCount > 0 && (
              <th
                colSpan={generalColCount}
                className="bg-[var(--color-accent-muted)] border-l border-[color:var(--color-border-tertiary)] px-2 py-1 text-left text-[10px] font-medium text-[color:var(--color-accent)]"
              >
                General
              </th>
            )}
            {/* Exercise section headers */}
            {displayed.map((te, idx) => {
              const st = colState(te.id);
              if (st.collapsed) {
                return (
                  <th
                    key={te.id}
                    rowSpan={2}
                    className="px-0 py-1 border-l-2 border-[color:var(--color-border-tertiary)] text-center cursor-pointer select-none align-bottom"
                    style={{ width: 30, minWidth: 30, maxWidth: 30 }}
                    onClick={() => onToggleCollapse?.(te.id)}
                    title={`${te.exercise.exercise_code || te.exercise.name} — click to expand`}
                  >
                    <span
                      className="inline-block text-[9px] font-medium text-[color:var(--color-text-tertiary)]"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 72, overflow: 'hidden' }}
                    >
                      {te.exercise.exercise_code || te.exercise.name}
                    </span>
                  </th>
                );
              }
              return (
                <th
                  key={te.id}
                  colSpan={exSpan(te.id)}
                  className="px-1 py-1 border-l-2 border-[color:var(--color-border-tertiary)] text-center cursor-pointer select-none"
                  style={{ minWidth: 44 * activeMetrics.length + (st.expanded ? 100 : 0) }}
                  onDoubleClick={() => onExerciseDoubleClick(te.id)}
                  title="Double-click to focus chart"
                >
                  <div className="flex items-center justify-between gap-0.5">
                    <button
                      onClick={() => onMoveExerciseLeft(te.id)}
                      disabled={idx === 0}
                      className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)] disabled:opacity-20 flex-shrink-0 p-0.5"
                    >
                      <ChevronLeft size={10} />
                    </button>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getExerciseCategoryShade(te.exercise.id, te.exercise.color, te.exercise.category, displayed) }} />
                      <span className="text-[10px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {te.exercise.exercise_code || te.exercise.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-0 flex-shrink-0">
                      {onToggleCollapse && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleCollapse(te.id); }}
                          className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)] p-0.5"
                          title="Collapse column"
                        >
                          <ChevronsLeft size={10} />
                        </button>
                      )}
                      {onToggleExpand && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleExpand(te.id); }}
                          className={`p-0.5 ${st.expanded ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)]'}`}
                          title={st.expanded ? 'Hide weekly notes' : 'Show weekly notes'}
                        >
                          <StickyNote size={10} />
                        </button>
                      )}
                      <button
                        onClick={() => onMoveExerciseRight(te.id)}
                        disabled={idx === displayed.length - 1}
                        className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)] disabled:opacity-20 p-0.5"
                      >
                        <ChevronRight size={10} />
                      </button>
                      <button
                        onClick={() => onRemoveExercise(te.id)}
                        className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-danger-text)] p-0.5"
                        title="Remove exercise"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                </th>
              );
            })}
            {/* Drag handle column header */}
            {onSwapWeeks && <th className="bg-[var(--color-bg-secondary)] w-5 px-0" />}
          </tr>

          {/* Sub-headers */}
          <tr className="bg-[var(--color-bg-secondary)] border-b border-[color:var(--color-border-tertiary)]">
            {showCol('week') && (
              <th className={stickyTh('week')} style={{ width: 68, left: stickyLeft['week'] }}>Wk</th>
            )}
            {showCol('weektype') && (
              <th className={stickyTh('weektype')} style={{ width: 56, left: stickyLeft['weektype'] }}>Type</th>
            )}
            {showCol('notes') && (
              <th className={stickyTh('notes')} style={{ width: 100, left: stickyLeft['notes'] }}>Notes</th>
            )}
            {showCol('k') && (
              <th className="bg-blue-50/60 border-l border-[color:var(--color-border-tertiary)] text-[8px] text-blue-400 font-normal text-center px-1" style={{ minWidth: 44 }}>Σreps</th>
            )}
            {showCol('tonnage') && (
              <th className="bg-blue-50/60 text-[8px] text-blue-400 font-normal text-center px-1" style={{ minWidth: 52 }}>Ton</th>
            )}
            {showCol('avg') && (
              <th className="bg-blue-50/60 text-[8px] text-blue-400 font-normal text-center px-1" style={{ minWidth: 40 }}>Avg</th>
            )}
            {showCol('kvalue') && (
              <th className="bg-blue-50/60 text-[8px] text-blue-400 font-normal text-center px-1" style={{ minWidth: 40 }}>K</th>
            )}
            {displayed.map((te, idx) => {
              const st = colState(te.id);
              if (st.collapsed) return null; // covered by the rowSpan=2 header above
              return (
                <React.Fragment key={te.id}>
                  {activeMetrics.map((mk, mi) => (
                    <td
                      key={mk}
                      className={`${mi === 0 ? `${idx === 0 ? 'border-l-2' : 'border-l'} border-[color:var(--color-border-tertiary)] ` : ''}text-[8px] text-[color:var(--color-text-tertiary)] font-normal text-center px-1`}
                    >
                      {EXERCISE_METRIC_LABELS[mk]}
                    </td>
                  ))}
                  {st.expanded && (
                    <td className="text-[8px] text-[color:var(--color-text-tertiary)] font-normal text-center px-1">Note</td>
                  )}
                </React.Fragment>
              );
            })}
            {onSwapWeeks && <td className="w-5 px-0" />}
          </tr>
        </thead>

        <tbody>
          {(() => {
            let lastPhaseId: string | null = null;
            const rows: React.ReactNode[] = [];

            macroWeeks.forEach((week) => {
              const phase = weekToPhase.get(week.id);

              if (phase && phase.id !== lastPhaseId) {
                lastPhaseId = phase.id ?? null;
                rows.push(
                  <tr key={`phase-${phase.id}`} data-phase-id={phase.id} className="border-t-2 border-[color:var(--color-border-tertiary)]">
                    <td
                      colSpan={leftColCount + totalExSpan + (onSwapWeeks ? 1 : 0)}
                      className="sticky left-0 text-left px-2 py-1 text-[9px] font-medium tracking-wide"
                      style={{
                        backgroundColor: phase.color + (phase.id === highlightedPhaseId ? '55' : '25'),
                        transition: 'background-color 400ms ease-out',
                        borderLeft: `3px solid ${phase.color}`,
                        color: phase.color,
                      }}
                    >
                      {phase.name} (W{phase.start_week_number}–{phase.end_week_number})
                    </td>
                  </tr>
                );
              }

              // Computed week stats — only count exercises with both reps and avg set
              let weekK = 0;
              let weekTonnage = 0;
              displayed.forEach(te => {
                const t = getTarget(week.id, te.id);
                const reps = t?.target_reps ?? 0;
                const avg = t?.target_avg ?? 0;
                weekK += reps;
                if (reps > 0 && avg > 0) weekTonnage += reps * avg;
              });
              const wtColor = getWeekTypeColor(week.week_type, weekTypes);
              const wtAbbr = getWeekTypeAbbr(week.week_type, weekTypes);
              // Pending fill-guide stamp for this week (ghost until applied)
              const stampAbbr = fillPreview?.weekTypeStamps?.[week.id];
              const stampColor = stampAbbr ? getWeekTypeColor(stampAbbr, weekTypes) : null;
              const previewTotalReps = fillPreview?.totalReps?.[week.id];
              // Σreps consistency tint: general target vs summed exercise reps (±10 %)
              const srepsTint = consistencyTint && week.total_reps_target != null && weekK > 0
                ? (Math.abs(week.total_reps_target - weekK) / weekK <= 0.10
                    ? 'rgba(29, 158, 117, 0.14)'
                    : 'rgba(239, 159, 39, 0.20)')
                : undefined;

              const phaseColor = phase?.color;

              rows.push(
                <tr
                  key={week.id}
                  className={`transition-colors ${dropWeekId === week.id && dragWeekId !== week.id ? 'outline outline-2 outline-blue-400 outline-offset-[-1px]' : ''}`}
                  style={phaseColor ? { backgroundColor: phaseColor + '0D' } : undefined}
                  draggable={!!onSwapWeeks}
                  onDragStart={() => setDragWeekId(week.id)}
                  onDragEnd={() => { setDragWeekId(null); setDropWeekId(null); }}
                  onDragOver={e => { e.preventDefault(); setDropWeekId(week.id); }}
                  onDragLeave={() => setDropWeekId(null)}
                  onDrop={() => {
                    if (dragWeekId && dragWeekId !== week.id) onSwapWeeks?.(dragWeekId, week.id);
                    setDragWeekId(null); setDropWeekId(null);
                  }}
                  onMouseEnter={e => { if (dragWeekId) return; (e.currentTarget as HTMLTableRowElement).style.backgroundColor = phaseColor ? phaseColor + '26' : '#f9fafb'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = phaseColor ? phaseColor + '0D' : ''; }}
                >
                  {showCol('week') && (
                    <td
                      className={`${stickyTd('week')} text-center px-1 py-0.5`}
                      style={{ width: 68, left: stickyLeft['week'] }}
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-[12px] font-medium leading-none" style={{ color: 'var(--color-text-primary)' }}>{week.week_number}</span>
                        <span className="text-[9px] font-medium leading-none mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>W{getISOWeek(week.week_start)}</span>
                        <span className="text-[7px] leading-none mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                          {formatDateMD(week.week_start)}–{addDays(week.week_start, 6)}
                        </span>
                      </div>
                    </td>
                  )}

                  {showCol('weektype') && (
                    <td
                      className={`${stickyTd('weektype')} text-center px-0.5 py-0.5`}
                      style={{ width: 56, left: stickyLeft['weektype'] }}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        {stampAbbr && stampColor && (
                          <span
                            className="text-[8px] font-medium rounded px-1 py-px select-none inline-block italic"
                            style={{ backgroundColor: stampColor + '20', color: stampColor, outline: '1.5px dashed var(--color-accent)', outlineOffset: 1 }}
                            title="Week type will be stamped by the fill guide on apply"
                          >
                            {getWeekTypeAbbr(stampAbbr, weekTypes)}
                          </span>
                        )}
                        <span
                          className="text-[8px] font-medium rounded px-1 py-px cursor-pointer select-none inline-block"
                          style={{ backgroundColor: wtColor + '20', color: wtColor, opacity: stampAbbr ? 0.45 : 1 }}
                          onClick={() => cycleWeekType(week.id, week.week_type)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (weekTypes.length === 0) return;
                            const idx = weekTypes.findIndex(t => t.abbreviation === week.week_type || t.name === week.week_type);
                            const prev = weekTypes[(idx - 1 + weekTypes.length) % weekTypes.length];
                            onUpdateWeekType(week.id, prev.abbreviation as WeekType);
                            onUpdateWeekLabel(week.id, prev.abbreviation);
                          }}
                          title="Click to cycle week type"
                        >
                          {wtAbbr}
                        </span>
                        {editingWeekTypeTextId === week.id ? (
                          <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                            <input
                              type="text"
                              defaultValue={week.week_type_text ?? ''}
                              autoFocus
                              className="w-[50px] text-center text-[8px] border-none outline-none bg-[var(--color-accent-muted)] rounded px-0.5 py-px"
                              onBlur={(e) => {
                                onUpdateWeekLabel(week.id, e.target.value);
                                setEditingWeekTypeTextId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') setEditingWeekTypeTextId(null);
                              }}
                            />
                          </div>
                        ) : (
                          <span
                            className="text-[8px] text-[color:var(--color-text-tertiary)] cursor-pointer truncate max-w-[52px] hover:text-[color:var(--color-text-secondary)]"
                            onClick={() => setEditingWeekTypeTextId(week.id)}
                            title={week.week_type_text ?? ''}
                          >
                            {week.week_type_text || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                          </span>
                        )}
                      </div>
                    </td>
                  )}

                  {/* Notes — now STICKY, part of Week section */}
                  {showCol('notes') && (
                    <td
                      className={`${stickyTd('notes')} px-1 py-0 transition-colors ${deleteMode && week.notes ? 'bg-[var(--color-danger-bg)]' : ''}`}
                      style={{ width: 100, left: stickyLeft['notes'] }}
                    >
                      {editingNotesId === week.id ? (
                        <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                          <input
                            type="text"
                            defaultValue={week.notes ?? ''}
                            autoFocus
                            className="w-full text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded px-1 py-0.5"
                            onBlur={(e) => { onUpdateNotes(week.id, e.target.value); setEditingNotesId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingNotesId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span
                          className={`block truncate text-[10px] cursor-pointer transition-colors ${
                            deleteMode && week.notes ? 'text-[color:var(--color-danger-text)] hover:text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]'
                          }`}
                          style={{ maxWidth: 96 }}
                          onClick={() => {
                            if (deleteMode && week.notes) onUpdateNotes(week.id, '');
                            else setEditingNotesId(week.id);
                          }}
                          title={deleteMode ? 'Click to clear' : (week.notes ?? '')}
                        >
                          {week.notes || <span className="italic text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {/* Σreps — now in General section */}
                  {showCol('k') && (
                    <td
                      className={`bg-blue-50/10 border-l border-[color:var(--color-border-tertiary)] text-center font-mono font-medium text-[10px] px-1 py-0 cursor-pointer hover:bg-blue-50/30 ${deleteMode && week.total_reps_target != null ? 'bg-[var(--color-danger-bg)]' : ''}`}
                      style={{ minWidth: 44, backgroundColor: srepsTint }}
                      onClick={(e) => handleWeekFieldClick(e, week, 'total_reps_target', 1, onUpdateTotalReps, setEditingKWeekId)}
                      onContextMenu={(e) => handleWeekFieldClick(e, week, 'total_reps_target', 1, onUpdateTotalReps, setEditingKWeekId)}
                      title={srepsTint
                        ? `Σ exercise reps ${weekK} vs general target ${week.total_reps_target} — ${weekFieldTitle}`
                        : `Σreps target — ${weekFieldTitle}`}
                    >
                      {previewTotalReps !== undefined ? (
                        <span
                          className="italic"
                          style={{ color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-muted)', borderRadius: 3, padding: '0 3px' }}
                          title="Fill-guide preview — not saved yet"
                        >
                          {previewTotalReps}
                        </span>
                      ) : editingKWeekId === week.id ? (
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            defaultValue={week.total_reps_target ?? ''}
                            autoFocus
                            className="no-spin w-[38px] text-center font-mono text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
                            onBlur={(e) => { onUpdateTotalReps(week.id, e.target.value); setEditingKWeekId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingKWeekId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span className={deleteMode && week.total_reps_target != null ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-primary)]'}>
                          {week.total_reps_target != null ? week.total_reps_target : <span className="italic text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {showCol('tonnage') && (
                    <td
                      className={`bg-blue-50/10 text-center font-mono text-[10px] text-[color:var(--color-text-secondary)] px-1 py-0 cursor-pointer hover:bg-blue-50/30 ${deleteMode && week.tonnage_target != null ? 'bg-[var(--color-danger-bg)]' : ''}`}
                      style={{ minWidth: 52 }}
                      onClick={(e) => handleWeekFieldClick(e, week, 'tonnage_target', 100, onUpdateTonnageTarget, setEditingTonnageId)}
                      onContextMenu={(e) => handleWeekFieldClick(e, week, 'tonnage_target', 100, onUpdateTonnageTarget, setEditingTonnageId)}
                      title={`Tonnage target (±100 kg) — ${weekFieldTitle}`}
                    >
                      {editingTonnageId === week.id ? (
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            defaultValue={week.tonnage_target ?? ''}
                            autoFocus
                            className="no-spin w-[44px] text-center font-mono text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
                            onBlur={(e) => { onUpdateTonnageTarget(week.id, e.target.value); setEditingTonnageId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingTonnageId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span className={deleteMode && week.tonnage_target != null ? 'text-[color:var(--color-danger-text)]' : ''}>
                          {week.tonnage_target != null
                            ? (week.tonnage_target / 1000).toFixed(1)
                            : <span className="italic text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {showCol('avg') && (
                    <td
                      className={`bg-blue-50/10 text-center font-mono text-[10px] text-[color:var(--color-text-secondary)] px-1 py-0 cursor-pointer hover:bg-blue-50/30 ${deleteMode && week.avg_intensity_target != null ? 'bg-[var(--color-danger-bg)]' : ''}`}
                      style={{ minWidth: 40 }}
                      onClick={(e) => handleWeekFieldClick(e, week, 'avg_intensity_target', 1, onUpdateAvgTarget, setEditingAvgTargetId)}
                      onContextMenu={(e) => handleWeekFieldClick(e, week, 'avg_intensity_target', 1, onUpdateAvgTarget, setEditingAvgTargetId)}
                      title={`Avg intensity target — ${weekFieldTitle}`}
                    >
                      {editingAvgTargetId === week.id ? (
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            defaultValue={week.avg_intensity_target ?? ''}
                            autoFocus
                            className="no-spin w-[32px] text-center font-mono text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
                            onBlur={(e) => { onUpdateAvgTarget(week.id, e.target.value); setEditingAvgTargetId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingAvgTargetId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span className={deleteMode && week.avg_intensity_target != null ? 'text-[color:var(--color-danger-text)]' : ''}>
                          {week.avg_intensity_target != null
                            ? week.avg_intensity_target
                            : <span className="italic text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {/* K-value — computed: tonnage / competition_total */}
                  {showCol('kvalue') && (
                    <td className="bg-blue-50/10 text-center font-mono text-[10px] text-indigo-600 px-1 py-0" style={{ minWidth: 40 }}>
                      {(() => {
                        const ton = week.tonnage_target ?? weekTonnage;
                        if (!ton || !competitionTotal) return <span className="italic text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
                        return (ton / competitionTotal).toFixed(1);
                      })()}
                    </td>
                  )}

                  {/* Per-exercise columns */}
                  {displayed.map((te, teIdx) => {
                    const target = getTarget(week.id, te.id);
                    const prev = getPrevTarget(week.week_number, te.id);
                    const st = colState(te.id);
                    const previewCell = fillPreview?.byTrackedEx?.[te.id]?.[week.id];

                    // Collapsed: one narrow strip — max only, heat-shaded by % of reference
                    if (st.collapsed) {
                      const maxShown = previewCell?.max ?? target?.target_max ?? null;
                      const ratio = maxShown != null && te.reference_kg ? maxShown / te.reference_kg : null;
                      return (
                        <td
                          key={te.id}
                          className={`${teIdx === 0 ? 'border-l-2' : 'border-l'} border-[color:var(--color-border-tertiary)] text-center font-mono text-[8px] px-0.5 py-0`}
                          style={{
                            width: 30, minWidth: 30, maxWidth: 30,
                            backgroundColor: collapsedHeatmap && ratio != null ? heatColor(ratio) : undefined,
                            color: previewCell ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                            fontStyle: previewCell ? 'italic' : undefined,
                          }}
                          title={`${te.exercise.exercise_code || te.exercise.name} W${week.week_number}${maxShown != null ? `: ${maxShown} kg${ratio != null ? ` (${Math.round(ratio * 100)} % of ref)` : ''}` : ''}`}
                        >
                          {maxShown ?? ''}
                        </td>
                      );
                    }

                    const repsVal = target?.target_reps ?? null;
                    const avgVal = target?.target_avg ?? null;
                    const maxVal = target?.target_max ?? null;
                    const repsAtMax = target?.target_reps_at_max ?? null;
                    const setsAtMax = target?.target_sets_at_max ?? null;
                    const noteVal = target?.note ?? null;

                    const prevReps = prev?.target_reps ?? null;
                    const prevAvg = prev?.target_avg ?? null;

                    const cellKey = `${week.id}_${te.id}`;
                    const repsEditing = editingCell === `${cellKey}_target_reps`;
                    const avgEditing = editingCell === `${cellKey}_target_avg`;

                    const repsIsDeleteTarget = deleteMode && repsVal !== null;
                    const avgIsDeleteTarget = deleteMode && avgVal !== null;

                    const ghostTitle = 'Fill-guide preview — not saved yet';
                    const ghostStyle = { color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-muted)' } as const;

                    // One renderer per registry metric — order comes from activeMetrics.
                    const renderMetric = (mk: ExerciseMetricKey, mi: number): React.ReactNode => {
                      const firstBorder = mi === 0
                        ? `${teIdx === 0 ? 'border-l-2' : 'border-l'} border-[color:var(--color-border-tertiary)] `
                        : '';
                      // Compact-state note mark rides the highest-priority visible metric
                      const mark = mi === 0 && !st.expanded && noteVal ? (
                        <span
                          className="absolute top-0 right-0.5 text-[9px] font-bold leading-none"
                          style={{ color: 'var(--color-accent)' }}
                          title={noteVal}
                        >
                          *
                        </span>
                      ) : null;

                      if (previewCell) {
                        if (mk === 'max_set') {
                          return (
                            <td key={mk} className={`${firstBorder}text-center px-0 py-0`} style={{ backgroundColor: 'var(--color-accent-muted)' }} title={ghostTitle}>
                              <div className="flex items-center justify-center" style={{ minWidth: 52, height: 38 }}>
                                <div className="flex flex-col items-center">
                                  <span className="font-mono text-[11px] font-medium italic" style={{ color: 'var(--color-accent)' }}>{previewCell.max}</span>
                                  <div className="w-[80%] border-t my-0.5" style={{ borderColor: 'var(--color-accent)', opacity: 0.4 }} />
                                  <span className="text-[9px] font-mono italic" style={{ color: 'var(--color-accent)' }}>{repsAtMax ?? 1}</span>
                                </div>
                                {setsAtMax != null && setsAtMax > 1 && (
                                  <span className="text-[9px] font-mono italic pl-0.5" style={{ color: 'var(--color-accent)' }}>{setsAtMax}</span>
                                )}
                              </div>
                            </td>
                          );
                        }
                        if (mk === 'avg') {
                          return (
                            <td key={mk} className={`${firstBorder}text-center font-mono text-[9px] italic px-1 py-0`} style={ghostStyle} title={ghostTitle}>
                              {previewCell.avg ?? avgVal ?? ''}
                            </td>
                          );
                        }
                        return (
                          <td key={mk} className={`${firstBorder}text-center font-mono text-[10px] italic px-1 py-0`} style={ghostStyle} title={ghostTitle}>
                            {previewCell.reps ?? repsVal ?? ''}
                          </td>
                        );
                      }

                      if (mk === 'max_set') {
                        return (
                          <td key={mk} className={`${firstBorder}relative text-center px-0 py-0`}>
                            {mark}
                            <MacroGridCell
                              load={maxVal}
                              reps={repsAtMax}
                              sets={setsAtMax}
                              prevLoad={prev?.target_max ?? null}
                              prevReps={prev?.target_reps_at_max ?? null}
                              prevSets={prev?.target_sets_at_max ?? null}
                              onUpdate={(vals) => handleGridUpdate(week.id, te.id, vals)}
                              deleteMode={deleteMode}
                              onDelete={() => handleGridDelete(week.id, te.id)}
                            />
                          </td>
                        );
                      }
                      if (mk === 'avg') {
                        return (
                          <td
                            key={mk}
                            className={`${firstBorder}relative text-center font-mono text-[9px] cursor-pointer select-none px-1 py-0 transition-colors ${
                              avgIsDeleteTarget
                                ? 'bg-[var(--color-danger-bg)] hover:bg-[var(--color-danger-bg)]'
                                : 'hover:bg-[var(--color-accent-muted)]'
                            }`}
                            onClick={(e) => handleInlineClick(e, week.id, te.id, 'target_avg', avgVal, prevAvg)}
                            onContextMenu={(e) => handleInlineClick(e, week.id, te.id, 'target_avg', avgVal, prevAvg)}
                            title={avgIsDeleteTarget ? 'Click to clear' : undefined}
                          >
                            {mark}
                            {avgEditing ? (
                              <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  defaultValue={avgVal ?? ''}
                                  autoFocus
                                  className="no-spin w-[32px] text-center font-mono text-[9px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
                                  onBlur={(e) => {
                                    onUpdateTarget(week.id, te.id, 'target_avg', e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                />
                              </div>
                            ) : (
                              <span className={avgVal !== null ? (avgIsDeleteTarget ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-secondary)]') : 'text-[color:var(--color-text-tertiary)] italic text-[8px]'}>
                                {avgVal !== null ? avgVal : (prevAvg !== null ? prevAvg : '-')}
                              </span>
                            )}
                          </td>
                        );
                      }
                      // reps
                      return (
                        <td
                          key={mk}
                          className={`${firstBorder}relative text-center font-mono text-[10px] cursor-pointer select-none px-1 py-0 transition-colors ${
                            repsIsDeleteTarget
                              ? 'bg-[var(--color-danger-bg)] hover:bg-[var(--color-danger-bg)]'
                              : 'hover:bg-[var(--color-accent-muted)]'
                          }`}
                          onClick={(e) => handleInlineClick(e, week.id, te.id, 'target_reps', repsVal, prevReps)}
                          onContextMenu={(e) => handleInlineClick(e, week.id, te.id, 'target_reps', repsVal, prevReps)}
                          title={repsIsDeleteTarget ? 'Click to clear' : undefined}
                        >
                          {mark}
                          {repsEditing ? (
                            <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                              <input
                                type="number"
                                defaultValue={repsVal ?? ''}
                                autoFocus
                                className="no-spin w-[32px] text-center font-mono text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
                                onBlur={(e) => {
                                  onUpdateTarget(week.id, te.id, 'target_reps', e.target.value);
                                  setEditingCell(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                              />
                            </div>
                          ) : (
                            <span className={repsVal !== null ? (repsIsDeleteTarget ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-primary)]') : 'text-[color:var(--color-text-tertiary)] italic text-[9px]'}>
                              {repsVal !== null ? repsVal : (prevReps !== null ? prevReps : '-')}
                            </span>
                          )}
                        </td>
                      );
                    };

                    // Weekly exercise note (expanded state) — a target row may hold only a note
                    const noteCell = st.expanded ? (
                      <td key="note" className="px-1 py-0 text-left align-middle" style={{ minWidth: 100, maxWidth: 150 }}>
                        {editingNoteId === cellKey ? (
                          <input
                            type="text"
                            defaultValue={noteVal ?? ''}
                            autoFocus
                            className="w-full text-[9px] border-none outline-none bg-[var(--color-accent-muted)] rounded px-1 py-0.5"
                            onBlur={(e) => { void onUpdateTargetNote?.(week.id, te.id, e.target.value); setEditingNoteId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingNoteId(null);
                            }}
                          />
                        ) : (
                          <span
                            className={`block truncate text-[9px] italic cursor-pointer ${
                              deleteMode && noteVal
                                ? 'text-[color:var(--color-danger-text)]'
                                : noteVal
                                ? 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]'
                                : 'text-[color:var(--color-text-tertiary)]'
                            }`}
                            style={{ maxWidth: 146 }}
                            onClick={() => {
                              if (deleteMode && noteVal) void onUpdateTargetNote?.(week.id, te.id, '');
                              else setEditingNoteId(cellKey);
                            }}
                            title={deleteMode && noteVal ? 'Click to clear' : (noteVal ?? 'Add a note for this week')}
                          >
                            {noteVal || '+'}
                          </span>
                        )}
                      </td>
                    ) : null;

                    return (
                      <React.Fragment key={te.id}>
                        {activeMetrics.map((mk, mi) => renderMetric(mk, mi))}
                        {noteCell}
                      </React.Fragment>
                    );
                  })}

                  {/* Drag handle — rightmost column */}
                  {onSwapWeeks && (
                    <td
                      className="w-5 px-0 text-center select-none cursor-grab active:cursor-grabbing"
                      style={{ color: 'var(--color-text-tertiary)' }}
                      title="Drag to reorder weeks"
                    >
                      <span className="text-[10px]">⠿</span>
                    </td>
                  )}
                </tr>
              );
            });

            // Summary / average row — grey bg, small italic non-bold text so it reads as metadata not entries
            // ── Average row ────────────────────────────────────────────────────────
            const avgBg = 'bg-[var(--color-bg-secondary)]';
            const summaryText = 'font-normal italic text-[color:var(--color-text-tertiary)] text-[7px]';
            rows.push(
              <tr key="avg-row" className={`border-t-2 border-gray-400 ${avgBg}`}>
                {showCol('week') && (
                  <td className={`${stickyTd('week')} text-center ${summaryText} px-1 py-0 ${avgBg}`} style={{ left: stickyLeft['week'] }}>
                    Ø
                  </td>
                )}
                {showCol('weektype') && (
                  <td className={`${stickyTd('weektype')} ${avgBg} py-0`} style={{ left: stickyLeft['weektype'] }} />
                )}
                {showCol('notes') && (
                  <td className={`${stickyTd('notes')} ${avgBg} px-2 py-0 ${summaryText}`} style={{ left: stickyLeft['notes'] }}>
                    average
                  </td>
                )}
                {showCol('k') && (
                  <td className={`${avgBg} border-l border-[color:var(--color-border-tertiary)] text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgK != null ? avgK : ''}
                  </td>
                )}
                {showCol('tonnage') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgTonnage != null ? (avgTonnage / 1000).toFixed(1) : ''}
                  </td>
                )}
                {showCol('avg') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgIntTarget != null ? avgIntTarget : ''}
                  </td>
                )}
                {showCol('kvalue') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgTonnage != null && competitionTotal ? (avgTonnage / competitionTotal).toFixed(1) : ''}
                  </td>
                )}
                {displayed.map((te, teIdx) => {
                  const st = colState(te.id);
                  const exTargets = targets.filter(t => t.tracked_exercise_id === te.id);
                  const wReps = exTargets.filter(t => (t.target_reps ?? 0) > 0);
                  const wMax = exTargets.filter(t => (t.target_max ?? 0) > 0);
                  const wAvg = exTargets.filter(t => (t.target_avg ?? 0) > 0);
                  const avgReps = wReps.length > 0 ? Math.round(wReps.reduce((s, t) => s + (t.target_reps ?? 0), 0) / wReps.length) : null;
                  const avgMax = wMax.length > 0 ? Math.round(wMax.reduce((s, t) => s + (t.target_max ?? 0), 0) / wMax.length) : null;
                  const totalRepsForAvg = wAvg.reduce((s, t) => s + (t.target_reps ?? 0), 0);
                  const avgAvg = totalRepsForAvg > 0
                    ? Math.round(wAvg.reduce((s, t) => s + (t.target_avg ?? 0) * (t.target_reps ?? 0), 0) / totalRepsForAvg)
                    : (wAvg.length > 0 ? Math.round(wAvg.reduce((s, t) => s + (t.target_avg ?? 0), 0) / wAvg.length) : null);
                  const borderCls = (mi: number) => mi === 0 ? `${teIdx === 0 ? 'border-l-2' : 'border-l'} border-[color:var(--color-border-tertiary)] ` : '';
                  if (st.collapsed) {
                    return (
                      <td key={te.id} className={`${borderCls(0)}text-center font-mono ${summaryText} px-0.5 py-0`} style={{ width: 30, minWidth: 30, maxWidth: 30 }}>
                        {avgMax != null ? avgMax : ''}
                      </td>
                    );
                  }
                  return (
                    <React.Fragment key={te.id}>
                      {activeMetrics.map((mk, mi) => {
                        if (mk === 'max_set') {
                          return (
                            <td key={mk} className={`${borderCls(mi)}text-center px-0 py-0`}>
                              <MacroGridCell load={avgMax} reps={null} sets={null} onUpdate={() => {}} disabled compact />
                            </td>
                          );
                        }
                        const val = mk === 'avg' ? avgAvg : avgReps;
                        return (
                          <td key={mk} className={`${borderCls(mi)}text-center font-mono ${summaryText} px-1 py-0`}>
                            {val != null ? val : ''}
                          </td>
                        );
                      })}
                      {st.expanded && <td />}
                    </React.Fragment>
                  );
                })}
                {onSwapWeeks && <td className={`${avgBg} w-5`} />}
              </tr>
            );

            // ── Max / peak row ─────────────────────────────────────────────────────
            const maxBg = 'bg-[var(--color-bg-secondary)]';
            rows.push(
              <tr key="max-row" className={`border-t border-[color:var(--color-border-tertiary)] ${maxBg}`}>
                {showCol('week') && (
                  <td className={`${stickyTd('week')} text-center ${summaryText} px-1 py-0 ${maxBg}`} style={{ left: stickyLeft['week'] }}>
                    ↑
                  </td>
                )}
                {showCol('weektype') && (
                  <td className={`${stickyTd('weektype')} ${maxBg} py-0`} style={{ left: stickyLeft['weektype'] }} />
                )}
                {showCol('notes') && (
                  <td className={`${stickyTd('notes')} ${maxBg} px-2 py-0 ${summaryText}`} style={{ left: stickyLeft['notes'] }}>
                    peak
                  </td>
                )}
                {showCol('k') && (
                  <td className={`${maxBg} border-l border-[color:var(--color-border-tertiary)] text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxK != null ? maxK : ''}
                  </td>
                )}
                {showCol('tonnage') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxTonnage != null ? (maxTonnage / 1000).toFixed(1) : ''}
                  </td>
                )}
                {showCol('avg') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxIntTarget != null ? maxIntTarget : ''}
                  </td>
                )}
                {showCol('kvalue') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxTonnage != null && competitionTotal ? (maxTonnage / competitionTotal).toFixed(1) : ''}
                  </td>
                )}
                {displayed.map((te, teIdx) => {
                  const st = colState(te.id);
                  const exTargets = targets.filter(t => t.tracked_exercise_id === te.id);
                  const maxReps = exTargets.length > 0 ? Math.max(...exTargets.map(t => t.target_reps ?? 0)) : null;
                  const peakTarget = exTargets.reduce<MacroTarget | undefined>((best, t) =>
                    (t.target_max ?? 0) > (best?.target_max ?? 0) ? t : best, undefined);
                  const maxAvg = exTargets.length > 0 ? Math.max(...exTargets.map(t => t.target_avg ?? 0)) : null;
                  const borderCls = (mi: number) => mi === 0 ? `${teIdx === 0 ? 'border-l-2' : 'border-l'} border-[color:var(--color-border-tertiary)] ` : '';
                  if (st.collapsed) {
                    return (
                      <td key={te.id} className={`${borderCls(0)}text-center font-mono ${summaryText} px-0.5 py-0`} style={{ width: 30, minWidth: 30, maxWidth: 30 }}>
                        {peakTarget?.target_max ?? ''}
                      </td>
                    );
                  }
                  return (
                    <React.Fragment key={te.id}>
                      {activeMetrics.map((mk, mi) => {
                        if (mk === 'max_set') {
                          return (
                            <td key={mk} className={`${borderCls(mi)}text-center px-0 py-0`}>
                              <MacroGridCell
                                load={peakTarget?.target_max ?? null}
                                reps={null}
                                sets={null}
                                onUpdate={() => {}} disabled compact
                              />
                            </td>
                          );
                        }
                        const val = mk === 'avg' ? (maxAvg || null) : (maxReps || null);
                        return (
                          <td key={mk} className={`${borderCls(mi)}text-center font-mono ${summaryText} px-1 py-0`}>
                            {val != null ? val : ''}
                          </td>
                        );
                      })}
                      {st.expanded && <td />}
                    </React.Fragment>
                  );
                })}
                {onSwapWeeks && <td className={`${maxBg} w-5`} />}
              </tr>
            );

            return rows;
          })()}
        </tbody>
      </table>
    </div>
  );
}
