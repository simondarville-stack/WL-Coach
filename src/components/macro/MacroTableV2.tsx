import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronsLeft, StickyNote, X } from 'lucide-react';
import { getEventTypeIcon } from '../../lib/eventTypeIcons';
import { CAL_EVENT_COLORS } from '../../lib/eventTypes';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, WeekType, WeekTypeConfig } from '../../lib/database.types';
import type { TimelineMarker } from '../../lib/macroTimelineData';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import type { FillGuidePreview } from './fillGuidePlan';
import { MacroGridCell } from './MacroGridCell';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { getExerciseCategoryShade } from '../../lib/colorUtils';
import { getWeekTypeColor } from '../../lib/weekUtils';
import { getISOWeek as isoWeekOfDate, formatDateShort, addDaysToISO } from '../../lib/dateUtils';

export type MacroTableColumnKey = 'week' | 'dates' | 'events' | 'weektype' | 'k' | 'tonnage' | 'avg' | 'kvalue' | 'notes';

export const DEFAULT_MACRO_TABLE_COLUMNS: MacroTableColumnKey[] = ['week', 'dates', 'events', 'weektype', 'k', 'tonnage', 'avg', 'kvalue', 'notes'];

export const MACRO_TABLE_COLUMN_LABELS: Record<MacroTableColumnKey, string> = {
  week: 'Training Week',
  dates: 'Dates',
  events: 'Events',
  weektype: 'Week type',
  k: 'Σreps',
  tonnage: 'Tonnage',
  avg: 'Avg intensity',
  kvalue: 'K-value',
  notes: 'Notes',
};

// The week-identity columns added in the combined-macro release (Training Week /
// Dates / Events). They ARE toggleable per macro from the "Table view" menu like
// every other column, but they're shown by default: this list is used to (a) keep
// them out of the GLOBAL default-column chooser in Settings (they always seed new
// macros) and (b) union them into saved layouts / global defaults that predate
// them so an older cycle doesn't render without its dates.
export const STRUCTURAL_MACRO_COLUMNS: MacroTableColumnKey[] = ['week', 'dates', 'events'];

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

/** One-decimal display with a comma (European numeric formatting). */
function fmt1(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

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
  onUpdateTotalReps: (weekId: string, value: string) => Promise<void>;
  onUpdateTonnageTarget: (weekId: string, value: string) => Promise<void>;
  onUpdateAvgTarget: (weekId: string, value: string) => Promise<void>;
  onUpdateNotes: (weekId: string, notes: string) => Promise<void>;
  onMoveExerciseLeft: (trackedExId: string) => Promise<void>;
  onMoveExerciseRight: (trackedExId: string) => Promise<void>;
  onRemoveExercise: (trackedExId: string) => Promise<void>;
  onPasteTargets: (targetWeekId: string, copiedTargets: Record<string, Partial<MacroTarget>>) => Promise<void>;
  onExerciseDoubleClick: (trackedExId: string) => void;
  /** Click the exercise name in the header band → the athlete's PRs and
   *  load history for that exercise. */
  onOpenExerciseDetail?: (trackedExId: string) => void;
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
  /** Collapse the Notes column to a small note icon (shown only where a week
   *  has a note). Toggled from the "Table view" menu. */
  notesCollapsed?: boolean;
  onUpdateTargetNote?: (weekId: string, trackedExId: string, note: string) => Promise<void>;
  /** Competition/camp markers overlapping each week (weekId → markers), shown
   *  as Trophy / Tent icons in the week cell. */
  weekMarkers?: Map<string, TimelineMarker[]>;
}

function getWeekTypeAbbr(wt: string, weekTypes: WeekTypeConfig[]): string {
  if (!wt) return '-';
  const config = weekTypes.find(t => t.abbreviation === wt || t.name.toLowerCase() === wt.toLowerCase());
  return config?.abbreviation ?? wt.slice(0, 2).toLowerCase();
}

// Sticky column widths in px — Notes is sticky; K/Σreps is in the General section.
// 'week' (Training Week) is user-resizable; the value here is only its default
// starting width. The others are fixed.
const STICKY_COL_ORDER: MacroTableColumnKey[] = ['week', 'dates', 'events', 'weektype', 'notes'];
const STICKY_COL_WIDTHS: Record<string, number> = { week: 68, dates: 76, events: 44, weektype: 44, notes: 100 };

// Week helpers delegate to dateUtils — one ISO-week implementation, one
// padded DD/MM day-first format across the app (product requirement).
function getISOWeek(dateStr: string): number {
  return isoWeekOfDate(new Date(dateStr + 'T00:00:00'));
}

export function MacroTableV2({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  onUpdateTarget,
  onUpdateWeekType,
  onUpdateTotalReps,
  onUpdateTonnageTarget,
  onUpdateAvgTarget,
  onUpdateNotes,
  onMoveExerciseLeft,
  onMoveExerciseRight,
  onRemoveExercise,
  onExerciseDoubleClick,
  onOpenExerciseDetail,
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
  notesCollapsed = false,
  onUpdateTargetNote,
  weekMarkers,
}: MacroTableV2Props) {
  const deleteMode = useDeleteHeld();
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingKWeekId, setEditingKWeekId] = useState<string | null>(null);
  const [editingTonnageId, setEditingTonnageId] = useState<string | null>(null);
  const [editingAvgTargetId, setEditingAvgTargetId] = useState<string | null>(null);
  const [dragWeekId, setDragWeekId] = useState<string | null>(null);
  const [dropWeekId, setDropWeekId] = useState<string | null>(null);

  // Notes column width (session-local): a right-edge drag handle on the Notes
  // header widens/narrows the whole column. Notes wrap and each row auto-grows
  // to show all its text — horizontal resize, no per-row height, no scrollbar.
  const [notesColWidth, setNotesColWidth] = useState<number>(STICKY_COL_WIDTHS.notes);
  const notesColDrag = useRef<{ startX: number; startW: number } | null>(null);
  const MIN_NOTES_W = 60, MAX_NOTES_W = 460;
  const startNotesResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    notesColDrag.current = { startX: e.clientX, startW: notesColWidth };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onNotesResizeMove = (e: React.PointerEvent) => {
    const d = notesColDrag.current;
    if (!d) return;
    setNotesColWidth(Math.min(MAX_NOTES_W, Math.max(MIN_NOTES_W, d.startW + (e.clientX - d.startX))));
  };
  const endNotesResize = (e: React.PointerEvent) => {
    if (!notesColDrag.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    notesColDrag.current = null;
  };

  // Collapsed-notes editor: a floating popover anchored to the clicked icon.
  // Rendered in a portal so it escapes the table's overflow clipping (a plain
  // in-cell overlay gets cut off near the bottom edge); flips up when there
  // isn't room below.
  const [notesAnchor, setNotesAnchor] = useState<{ left: number; top: number; openUp: boolean } | null>(null);
  const openCollapsedNote = (e: React.MouseEvent, weekId: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const POPOVER_H = 130;
    const openUp = r.bottom + POPOVER_H > window.innerHeight;
    setNotesAnchor({ left: r.left, top: openUp ? r.top : r.bottom, openUp });
    setEditingNotesId(weekId);
  };
  const closeCollapsedNote = () => { setEditingNotesId(null); setNotesAnchor(null); };

  // Resizable Training Week column (session-local): a right-edge drag handle on
  // the header widens/narrows the first sticky column. Sticky left-offsets of the
  // following columns recompute from this width, so the layout stays aligned.
  const [weekColWidth, setWeekColWidth] = useState<number>(STICKY_COL_WIDTHS.week);
  const weekColDrag = useRef<{ startX: number; startW: number } | null>(null);
  const MIN_WEEK_W = 44, MAX_WEEK_W = 220;
  const startWeekResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    weekColDrag.current = { startX: e.clientX, startW: weekColWidth };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onWeekResizeMove = (e: React.PointerEvent) => {
    const d = weekColDrag.current;
    if (!d) return;
    setWeekColWidth(Math.min(MAX_WEEK_W, Math.max(MIN_WEEK_W, d.startW + (e.clientX - d.startX))));
  };
  const endWeekResize = (e: React.PointerEvent) => {
    if (!weekColDrag.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    weekColDrag.current = null;
  };

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

  // Column visibility helper — every column is toggleable; defaults to all
  // visible when no set is provided.
  const showCol = (col: MacroTableColumnKey): boolean =>
    !visibleColumns || visibleColumns.size === 0 || visibleColumns.has(col);

  // Effective sticky width — Training Week is resizable, Notes shrinks to an
  // icon strip when collapsed, the rest are fixed.
  const notesWidth = notesCollapsed ? 30 : notesColWidth;
  const colWidth = (col: MacroTableColumnKey): number =>
    col === 'week' ? weekColWidth : col === 'notes' ? notesWidth : (STICKY_COL_WIDTHS[col] ?? 0);

  // Compute sticky left offsets dynamically
  const stickyLeft: Record<string, number> = {};
  let stickyOffset = 0;
  for (const c of STICKY_COL_ORDER) {
    if (showCol(c)) {
      stickyLeft[c] = stickyOffset;
      stickyOffset += colWidth(c);
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
  }, [onUpdateWeekType, weekTypes]);

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
                    <button
                      type="button"
                      className="flex items-center gap-1 min-w-0 hover:underline"
                      onClick={(e) => { e.stopPropagation(); onOpenExerciseDetail?.(te.id); }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      title={onOpenExerciseDetail
                        ? `${te.exercise.name} — click for the athlete's PRs & load history`
                        : te.exercise.name}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getExerciseCategoryShade(te.exercise.id, te.exercise.color, te.exercise.category, displayed) }} />
                      <span className="text-[10px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {te.exercise.exercise_code || te.exercise.name}
                      </span>
                    </button>
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
              <th className={stickyTh('week')} style={{ width: weekColWidth, left: stickyLeft['week'] }}>
                Training Wk
                {/* Right-edge drag handle — resize the Training Week column.
                    The sticky <th> is a positioned box, so this absolute handle
                    anchors to it without an extra relative wrapper. */}
                <div
                  onPointerDown={startWeekResize}
                  onPointerMove={onWeekResizeMove}
                  onPointerUp={endWeekResize}
                  onPointerCancel={endWeekResize}
                  title="Drag to resize the Training Week column"
                  style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 11 }}
                />
              </th>
            )}
            {showCol('dates') && (
              <th className={stickyTh('dates')} style={{ width: STICKY_COL_WIDTHS.dates, left: stickyLeft['dates'] }}>Dates</th>
            )}
            {showCol('events') && (
              <th className={stickyTh('events')} style={{ width: STICKY_COL_WIDTHS.events, left: stickyLeft['events'] }}>Events</th>
            )}
            {showCol('weektype') && (
              <th className={stickyTh('weektype')} style={{ width: STICKY_COL_WIDTHS.weektype, left: stickyLeft['weektype'] }}>Type</th>
            )}
            {showCol('notes') && (
              <th className={stickyTh('notes')} style={{ width: notesWidth, left: stickyLeft['notes'] }} title="Notes">
                {notesCollapsed ? <StickyNote size={11} className="inline-block align-middle" /> : 'Notes'}
                {/* Right-edge handle — resize the Notes column horizontally. */}
                {!notesCollapsed && (
                  <div
                    onPointerDown={startNotesResize}
                    onPointerMove={onNotesResizeMove}
                    onPointerUp={endNotesResize}
                    onPointerCancel={endNotesResize}
                    title="Drag to resize the Notes column"
                    style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 11 }}
                  />
                )}
              </th>
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
                  onDragOver={e => { e.preventDefault(); setDropWeekId(week.id); }}
                  onDragLeave={() => setDropWeekId(null)}
                  onDrop={() => {
                    if (dragWeekId && dragWeekId !== week.id) onSwapWeeks?.(dragWeekId, week.id);
                    setDragWeekId(null); setDropWeekId(null);
                  }}
                  onMouseEnter={e => { if (dragWeekId) return; (e.currentTarget as HTMLTableRowElement).style.backgroundColor = phaseColor ? phaseColor + '26' : '#f9fafb'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = phaseColor ? phaseColor + '0D' : ''; }}
                >
                  {/* Training Week — the sequential week number only (resizable column). */}
                  {showCol('week') && (
                    <td
                      className={`${stickyTd('week')} text-center px-1 py-0.5`}
                      style={{ width: weekColWidth, left: stickyLeft['week'] }}
                    >
                      <span className="text-[13px] font-semibold leading-none" style={{ color: 'var(--color-text-primary)' }}>{week.week_number}</span>
                    </td>
                  )}

                  {/* Dates — ISO week number over the Mon–Sun date range. */}
                  {showCol('dates') && (
                    <td
                      className={`${stickyTd('dates')} text-center px-1 py-0.5`}
                      style={{ width: STICKY_COL_WIDTHS.dates, left: stickyLeft['dates'] }}
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-[10px] font-medium leading-none" style={{ color: 'var(--color-text-secondary)' }}>W{getISOWeek(week.week_start)}</span>
                        <span className="text-[8px] leading-none mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                          {formatDateShort(week.week_start)}–{formatDateShort(addDaysToISO(week.week_start, 6))}
                        </span>
                      </div>
                    </td>
                  )}

                  {/* Events — competition / training-camp icons for this week. */}
                  {showCol('events') && (
                    <td
                      className={`${stickyTd('events')} text-center px-0.5 py-0.5`}
                      style={{ width: STICKY_COL_WIDTHS.events, left: stickyLeft['events'] }}
                    >
                      {(() => {
                        const ms = weekMarkers?.get(week.id);
                        if (!ms || ms.length === 0) return null;
                        return (
                          <div className="flex items-center justify-center gap-0.5 flex-wrap">
                            {ms.slice(0, 3).map(m => {
                              const Icon = getEventTypeIcon(m.eventType);
                              // Competitions: primary red / secondary orange. Other
                              // types: their canonical colour. All data-driven.
                              const color = m.eventType === 'competition'
                                ? (m.primary ? '#E24B4A' : '#EA9A27')
                                : (m.color || CAL_EVENT_COLORS[m.eventType] || 'var(--color-text-tertiary)');
                              const range = m.endDate
                                ? `${formatDateShort(m.date)}–${formatDateShort(m.endDate)}`
                                : formatDateShort(m.date);
                              return (
                                <span key={m.id} title={`${m.title} · ${range}`} className="inline-flex">
                                  <Icon size={11} style={{ color }} />
                                </span>
                              );
                            })}
                            {ms.length > 3 && (
                              <span
                                className="text-[8px] font-medium leading-none"
                                style={{ color: 'var(--color-text-tertiary)' }}
                                title={ms.slice(3).map(m => {
                                  const r = m.endDate ? `${formatDateShort(m.date)}–${formatDateShort(m.endDate)}` : formatDateShort(m.date);
                                  return `${m.title} · ${r}`;
                                }).join('\n')}
                              >
                                +{ms.length - 3}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  )}

                  {/* Week type — a single coloured chip (click cycles, right-click
                      reverses). The old uncolored duplicate label was removed. */}
                  {showCol('weektype') && (
                    <td
                      className={`${stickyTd('weektype')} text-center px-0.5 py-0.5`}
                      style={{ width: STICKY_COL_WIDTHS.weektype, left: stickyLeft['weektype'] }}
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
                          className="text-[9px] font-medium rounded px-1.5 py-px cursor-pointer select-none inline-block"
                          style={{ backgroundColor: wtColor + '20', color: wtColor, opacity: stampAbbr ? 0.45 : 1 }}
                          onClick={() => cycleWeekType(week.id, week.week_type)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (weekTypes.length === 0) return;
                            const idx = weekTypes.findIndex(t => t.abbreviation === week.week_type || t.name === week.week_type);
                            const prev = weekTypes[(idx - 1 + weekTypes.length) % weekTypes.length];
                            onUpdateWeekType(week.id, prev.abbreviation as WeekType);
                          }}
                          title="Click to cycle week type · right-click to reverse"
                        >
                          {wtAbbr}
                        </span>
                      </div>
                    </td>
                  )}

                  {/* Notes — sticky. Collapse to an icon via the Table-view menu;
                      expanded, the column is width-resizable (drag the header's
                      right edge) and each note wraps to show all its text — the
                      row auto-grows, no inner scrollbar. */}
                  {showCol('notes') && (
                    <td
                      className={`${stickyTd('notes')} px-1 py-0.5 transition-colors align-top ${deleteMode && week.notes ? 'bg-[var(--color-danger-bg)]' : ''}`}
                      style={{ width: notesWidth, left: stickyLeft['notes'] }}
                    >
                      {notesCollapsed ? (
                        // Collapsed: a note icon where a note exists; an empty cell
                        // is still tappable to start a new note. Editing opens a
                        // floating popover (portal) so the narrow column isn't a
                        // constraint and it can't be clipped by the table scroll.
                        <div className="flex items-center justify-center" style={{ minHeight: 18 }}>
                          {week.notes ? (
                            <button
                              type="button"
                              title={deleteMode ? 'Click to clear' : week.notes}
                              onClick={(e) => { if (deleteMode) onUpdateNotes(week.id, ''); else openCollapsedNote(e, week.id); }}
                              className="p-0.5 hover:opacity-70"
                            >
                              <StickyNote size={12} style={{ color: deleteMode ? 'var(--color-danger-text)' : 'var(--color-accent)' }} />
                            </button>
                          ) : (
                            // Empty week: a full-cell tap target opens a new note.
                            <button
                              type="button"
                              title="Add a note"
                              onClick={(e) => openCollapsedNote(e, week.id)}
                              className="w-full flex items-center justify-center text-[color:var(--color-text-tertiary)] opacity-0 hover:opacity-100"
                              style={{ minHeight: 18 }}
                            >
                              <StickyNote size={11} />
                            </button>
                          )}
                        </div>
                      ) : editingNotesId === week.id ? (
                        <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                          <textarea
                            defaultValue={week.notes ?? ''}
                            autoFocus
                            rows={3}
                            className="w-full text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded px-1 py-0.5 resize-y leading-snug"
                            onBlur={(e) => { onUpdateNotes(week.id, e.target.value); setEditingNotesId(null); }}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditingNotesId(null); }}
                          />
                        </div>
                      ) : (
                        <div
                          className={`text-[10px] leading-snug cursor-pointer transition-colors whitespace-pre-wrap break-words ${
                            deleteMode && week.notes ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]'
                          }`}
                          onClick={() => {
                            if (deleteMode && week.notes) onUpdateNotes(week.id, '');
                            else setEditingNotesId(week.id);
                          }}
                          title={deleteMode ? 'Click to clear' : undefined}
                        >
                          {week.notes || <span className="italic text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </div>
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
                            ? fmt1(week.tonnage_target / 1000)
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
                        return fmt1(ton / competitionTotal);
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
                            <td key={mk} className={`${firstBorder}text-center font-mono text-[10px] italic px-1 py-0`} style={ghostStyle} title={ghostTitle}>
                              {previewCell.avg ?? avgVal ?? ''}
                            </td>
                          );
                        }
                        return (
                          <td key={mk} className={`${firstBorder}text-center font-mono text-[9px] italic px-1 py-0`} style={ghostStyle} title={ghostTitle}>
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
                            className={`${firstBorder}relative text-center font-mono text-[10px] cursor-pointer select-none px-1 py-0 transition-colors ${
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
                                  className="no-spin w-[32px] text-center font-mono text-[10px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
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
                              <span className={avgVal !== null ? (avgIsDeleteTarget ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-primary)]') : 'text-[color:var(--color-text-tertiary)] italic text-[9px]'}>
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
                          className={`${firstBorder}relative text-center font-mono text-[9px] cursor-pointer select-none px-1 py-0 transition-colors ${
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
                                className="no-spin w-[32px] text-center font-mono text-[9px] border-none outline-none bg-[var(--color-accent-muted)] rounded"
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
                            <span className={repsVal !== null ? (repsIsDeleteTarget ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-secondary)]') : 'text-[color:var(--color-text-tertiary)] italic text-[8px]'}>
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
                      title="Drag to swap this week with another"
                      // Drag source is the HANDLE only — a whole-row drag source
                      // swallowed the cells' click grammar and invited accidental
                      // week swaps. The row stays the drop target.
                      draggable
                      onDragStart={() => setDragWeekId(week.id)}
                      onDragEnd={() => { setDragWeekId(null); setDropWeekId(null); }}
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
            const summaryText = 'font-normal italic text-[color:var(--color-text-tertiary)] text-[8px]';
            rows.push(
              <tr key="avg-row" className={`border-t-2 border-gray-400 ${avgBg}`}>
                {showCol('week') && (
                  <td className={`${stickyTd('week')} text-center ${summaryText} px-1 py-0 ${avgBg}`} style={{ left: stickyLeft['week'] }}>
                    Ø
                  </td>
                )}
                {showCol('dates') && (
                  <td className={`${stickyTd('dates')} ${avgBg} py-0`} style={{ left: stickyLeft['dates'] }} />
                )}
                {showCol('events') && (
                  <td className={`${stickyTd('events')} ${avgBg} py-0`} style={{ left: stickyLeft['events'] }} />
                )}
                {showCol('weektype') && (
                  <td className={`${stickyTd('weektype')} ${avgBg} py-0`} style={{ left: stickyLeft['weektype'] }} />
                )}
                {showCol('notes') && (
                  <td className={`${stickyTd('notes')} ${avgBg} px-2 py-0 ${summaryText}`} style={{ left: stickyLeft['notes'] }}>
                    {notesCollapsed ? '' : 'average'}
                  </td>
                )}
                {showCol('k') && (
                  <td className={`${avgBg} border-l border-[color:var(--color-border-tertiary)] text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgK != null ? avgK : ''}
                  </td>
                )}
                {showCol('tonnage') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgTonnage != null ? fmt1(avgTonnage / 1000) : ''}
                  </td>
                )}
                {showCol('avg') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgIntTarget != null ? avgIntTarget : ''}
                  </td>
                )}
                {showCol('kvalue') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {avgTonnage != null && competitionTotal ? fmt1(avgTonnage / competitionTotal) : ''}
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
                {showCol('dates') && (
                  <td className={`${stickyTd('dates')} ${maxBg} py-0`} style={{ left: stickyLeft['dates'] }} />
                )}
                {showCol('events') && (
                  <td className={`${stickyTd('events')} ${maxBg} py-0`} style={{ left: stickyLeft['events'] }} />
                )}
                {showCol('weektype') && (
                  <td className={`${stickyTd('weektype')} ${maxBg} py-0`} style={{ left: stickyLeft['weektype'] }} />
                )}
                {showCol('notes') && (
                  <td className={`${stickyTd('notes')} ${maxBg} px-2 py-0 ${summaryText}`} style={{ left: stickyLeft['notes'] }}>
                    {notesCollapsed ? '' : 'peak'}
                  </td>
                )}
                {showCol('k') && (
                  <td className={`${maxBg} border-l border-[color:var(--color-border-tertiary)] text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxK != null ? maxK : ''}
                  </td>
                )}
                {showCol('tonnage') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxTonnage != null ? fmt1(maxTonnage / 1000) : ''}
                  </td>
                )}
                {showCol('avg') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxIntTarget != null ? maxIntTarget : ''}
                  </td>
                )}
                {showCol('kvalue') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-0`}>
                    {maxTonnage != null && competitionTotal ? fmt1(maxTonnage / competitionTotal) : ''}
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

      {/* Collapsed-notes editor — floating popover in a portal (renders on top,
          never clipped by the table's scroll container). */}
      {notesCollapsed && editingNotesId && notesAnchor && createPortal(
        (() => {
          const w = macroWeeks.find(mw => mw.id === editingNotesId);
          return (
            <div
              style={{
                position: 'fixed', left: notesAnchor.left, zIndex: 1000, width: 240,
                ...(notesAnchor.openUp
                  ? { bottom: Math.max(4, window.innerHeight - notesAnchor.top + 2) }
                  : { top: notesAnchor.top + 2 }),
              }}
              onClick={e => e.stopPropagation()}
              onContextMenu={e => e.stopPropagation()}
            >
              <textarea
                defaultValue={w?.notes ?? ''}
                autoFocus
                rows={4}
                placeholder="Week note…"
                className="w-full text-[11px] outline-none bg-[var(--color-bg-primary)] rounded px-1.5 py-1 resize leading-snug shadow-xl border border-[color:var(--color-border-primary)]"
                onBlur={(e) => { onUpdateNotes(editingNotesId, e.target.value); closeCollapsedNote(); }}
                onKeyDown={(e) => { if (e.key === 'Escape') closeCollapsedNote(); }}
              />
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
