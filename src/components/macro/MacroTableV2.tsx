import React, { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, WeekType } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import { MacroGridCell } from './MacroGridCell';
import { useShiftHeld } from '../../hooks/useShiftHeld';

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
}

const WEEK_TYPE_COLORS: Record<string, string> = {
  High: '#E24B4A', Medium: '#EF9F27', Low: '#1D9E75', Deload: '#5DCAA5',
  Competition: '#378ADD', Taper: '#7F77DD', Vacation: '#888780',
  Testing: '#D85A30', Transition: '#D4537E',
};

function getWeekTypeAbbr(wt: string): string {
  if (!wt) return '-';
  const map: Record<string, string> = {
    High: 'h', Medium: 'm', Low: 'g', Deload: 'dl',
    Competition: 'c', Taper: 'tp', Vacation: 'v', Testing: 'te', Transition: 'tr',
  };
  return map[wt] ?? wt.slice(0, 2).toLowerCase();
}

function getWeekTypeColor(wt: string): string {
  return WEEK_TYPE_COLORS[wt] ?? '#888780';
}

const WEEK_TYPES: WeekType[] = ['High', 'Medium', 'Low', 'Deload', 'Taper', 'Competition', 'Vacation', 'Testing', 'Transition'];

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
  actuals,
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
  onPasteTargets,
  onExerciseDoubleClick,
  onSwapWeeks,
  competitionTotal,
  visibleExercises,
  visibleColumns,
}: MacroTableV2Props) {
  const deleteMode = useShiftHeld();
  const [editingCell, setEditingCell] = useState<string | null>(null);
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
    const idx = WEEK_TYPES.findIndex(t => t === current);
    const next = WEEK_TYPES[(idx + 1) % WEEK_TYPES.length];
    onUpdateWeekType(weekId, next);
    onUpdateWeekLabel(weekId, next);
  }, [onUpdateWeekType, onUpdateWeekLabel]);

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
    return `sticky z-[10] bg-slate-100 text-[8px] text-gray-400 font-normal px-1${isLast ? ' border-r border-gray-300' : ''} ${extra}`;
  }
  function stickyTd(col: MacroTableColumnKey, extra = '') {
    const isLast = col === lastStickyVisible;
    return `sticky z-[5] bg-white${isLast ? ' border-r border-gray-300' : ''} ${extra}`;
  }

  // Summary stats computed from week-level explicit targets (only populated weeks counted)
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
    <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
      <table className="text-xs" style={{ minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-20">
          {/* Top header row: "Week" section + General section + exercise sections */}
          <tr className="bg-gray-100 border-b border-gray-300">
            {/* Sticky section header: Week + Type + Notes */}
            <th
              colSpan={stickyColCount || 1}
              className="sticky left-0 z-[10] bg-slate-100 px-2 py-1 text-left text-[10px] font-medium text-gray-600"
              style={{ minWidth: stickyOffset || 40 }}
            >
              Week
            </th>
            {/* General section header: Σreps + Tonnage + Avg */}
            {generalColCount > 0 && (
              <th
                colSpan={generalColCount}
                className="bg-blue-50 border-l border-gray-300 px-2 py-1 text-left text-[10px] font-medium text-blue-500"
              >
                General
              </th>
            )}
            {/* Exercise section headers */}
            {displayed.map((te, idx) => (
              <th
                key={te.id}
                colSpan={3}
                className="px-1 py-1 border-l-2 border-gray-300 text-center cursor-pointer select-none"
                style={{ minWidth: 140 }}
                onDoubleClick={() => onExerciseDoubleClick(te.id)}
                title="Double-click to focus chart"
              >
                <div className="flex items-center justify-between gap-0.5">
                  <button
                    onClick={() => onMoveExerciseLeft(te.id)}
                    disabled={idx === 0}
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-20 flex-shrink-0 p-0.5"
                  >
                    <ChevronLeft size={10} />
                  </button>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: te.exercise.color }} />
                    <span className="text-[10px] font-medium text-gray-800 truncate">
                      {te.exercise.exercise_code || te.exercise.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-0 flex-shrink-0">
                    <button
                      onClick={() => onMoveExerciseRight(te.id)}
                      disabled={idx === displayed.length - 1}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-20 p-0.5"
                    >
                      <ChevronRight size={10} />
                    </button>
                    <button
                      onClick={() => onRemoveExercise(te.id)}
                      className="text-gray-300 hover:text-red-500 p-0.5"
                      title="Remove exercise"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              </th>
            ))}
            {/* Drag handle column header */}
            {onSwapWeeks && <th className="bg-gray-100 w-5 px-0" />}
          </tr>

          {/* Sub-headers */}
          <tr className="bg-gray-50 border-b border-gray-200">
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
              <th className="bg-blue-50/60 border-l border-gray-300 text-[8px] text-blue-400 font-normal text-center px-1" style={{ minWidth: 44 }}>Σreps</th>
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
            {displayed.map((te, idx) => (
              <React.Fragment key={te.id}>
                <td className={`${idx === 0 ? 'border-l-2' : 'border-l'} border-gray-300 text-[8px] text-gray-400 font-normal text-center px-1`}>Reps</td>
                <td className="text-[8px] text-gray-400 font-normal text-center px-1">Max set</td>
                <td className="text-[8px] text-gray-400 font-normal text-center px-1">Avg</td>
              </React.Fragment>
            ))}
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
                  <tr key={`phase-${phase.id}`} className="border-t-2 border-gray-300">
                    <td
                      colSpan={leftColCount + displayed.length * 3 + (onSwapWeeks ? 1 : 0)}
                      className="sticky left-0 text-left px-2 py-1 text-[9px] font-medium tracking-wide"
                      style={{
                        backgroundColor: phase.color + '25',
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
              const weekAvgInt = weekK > 0 && weekTonnage > 0 ? Math.round(weekTonnage / weekK) : null;

              const wtColor = getWeekTypeColor(week.week_type);
              const wtAbbr = getWeekTypeAbbr(week.week_type);

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
                        <span className="text-[12px] font-bold text-gray-900 leading-none">{week.week_number}</span>
                        <span className="text-[9px] font-medium text-gray-500 leading-none mt-0.5">W{getISOWeek(week.week_start)}</span>
                        <span className="text-[7px] text-gray-400 leading-none mt-0.5">
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
                        <span
                          className="text-[8px] font-medium rounded px-1 py-px cursor-pointer select-none inline-block"
                          style={{ backgroundColor: wtColor + '20', color: wtColor }}
                          onClick={() => cycleWeekType(week.id, week.week_type)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            const idx = WEEK_TYPES.findIndex(t => t === week.week_type);
                            const prev = WEEK_TYPES[(idx - 1 + WEEK_TYPES.length) % WEEK_TYPES.length];
                            onUpdateWeekType(week.id, prev);
                            onUpdateWeekLabel(week.id, prev);
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
                              className="w-[50px] text-center text-[8px] border-none outline-none bg-blue-50 rounded px-0.5 py-px"
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
                            className="text-[8px] text-gray-400 cursor-pointer truncate max-w-[52px] hover:text-gray-600"
                            onClick={() => setEditingWeekTypeTextId(week.id)}
                            title={week.week_type_text ?? ''}
                          >
                            {week.week_type_text || <span className="text-gray-300">—</span>}
                          </span>
                        )}
                      </div>
                    </td>
                  )}

                  {/* Notes — now STICKY, part of Week section */}
                  {showCol('notes') && (
                    <td
                      className={`${stickyTd('notes')} px-1 py-0 transition-colors ${deleteMode && week.notes ? 'bg-red-50' : ''}`}
                      style={{ width: 100, left: stickyLeft['notes'] }}
                    >
                      {editingNotesId === week.id ? (
                        <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                          <input
                            type="text"
                            defaultValue={week.notes ?? ''}
                            autoFocus
                            className="w-full text-[10px] border-none outline-none bg-blue-50 rounded px-1 py-0.5"
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
                            deleteMode && week.notes ? 'text-red-500 hover:text-red-700' : 'text-gray-500 hover:text-gray-800'
                          }`}
                          style={{ maxWidth: 96 }}
                          onClick={() => {
                            if (deleteMode && week.notes) onUpdateNotes(week.id, '');
                            else setEditingNotesId(week.id);
                          }}
                          title={deleteMode ? 'Click to clear' : (week.notes ?? '')}
                        >
                          {week.notes || <span className="text-gray-300 italic text-[9px]">—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {/* Σreps — now in General section */}
                  {showCol('k') && (
                    <td
                      className={`bg-blue-50/10 border-l border-gray-300 text-center font-mono font-medium text-[10px] px-1 py-0 cursor-pointer hover:bg-blue-50/30 ${deleteMode && week.total_reps_target != null ? 'bg-red-50' : ''}`}
                      style={{ minWidth: 44 }}
                      onClick={() => {
                        if (deleteMode && week.total_reps_target != null) onUpdateTotalReps(week.id, '');
                        else setEditingKWeekId(week.id);
                      }}
                      title="Click to set Σreps target"
                    >
                      {editingKWeekId === week.id ? (
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            defaultValue={week.total_reps_target ?? ''}
                            autoFocus
                            className="w-[38px] text-center font-mono text-[10px] border-none outline-none bg-blue-50 rounded"
                            onBlur={(e) => { onUpdateTotalReps(week.id, e.target.value); setEditingKWeekId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingKWeekId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span className={deleteMode && week.total_reps_target != null ? 'text-red-500' : 'text-gray-900'}>
                          {week.total_reps_target != null ? week.total_reps_target : <span className="text-gray-300 italic text-[8px]">—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {showCol('tonnage') && (
                    <td
                      className={`bg-blue-50/10 text-center font-mono text-[10px] text-gray-700 px-1 py-0 cursor-pointer hover:bg-blue-50/30 ${deleteMode && week.tonnage_target != null ? 'bg-red-50' : ''}`}
                      style={{ minWidth: 52 }}
                      onClick={() => {
                        if (deleteMode && week.tonnage_target != null) onUpdateTonnageTarget(week.id, '');
                        else setEditingTonnageId(week.id);
                      }}
                      title="Click to set tonnage target"
                    >
                      {editingTonnageId === week.id ? (
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            defaultValue={week.tonnage_target ?? ''}
                            autoFocus
                            className="w-[44px] text-center font-mono text-[10px] border-none outline-none bg-blue-50 rounded"
                            onBlur={(e) => { onUpdateTonnageTarget(week.id, e.target.value); setEditingTonnageId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingTonnageId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span className={deleteMode && week.tonnage_target != null ? 'text-red-500' : ''}>
                          {week.tonnage_target != null
                            ? (week.tonnage_target / 1000).toFixed(1)
                            : <span className="text-gray-300 italic text-[8px]">—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {showCol('avg') && (
                    <td
                      className={`bg-blue-50/10 text-center font-mono text-[10px] text-gray-500 px-1 py-0 cursor-pointer hover:bg-blue-50/30 ${deleteMode && week.avg_intensity_target != null ? 'bg-red-50' : ''}`}
                      style={{ minWidth: 40 }}
                      onClick={() => {
                        if (deleteMode && week.avg_intensity_target != null) onUpdateAvgTarget(week.id, '');
                        else setEditingAvgTargetId(week.id);
                      }}
                      title="Click to set avg intensity target"
                    >
                      {editingAvgTargetId === week.id ? (
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            defaultValue={week.avg_intensity_target ?? ''}
                            autoFocus
                            className="w-[32px] text-center font-mono text-[10px] border-none outline-none bg-blue-50 rounded"
                            onBlur={(e) => { onUpdateAvgTarget(week.id, e.target.value); setEditingAvgTargetId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingAvgTargetId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <span className={deleteMode && week.avg_intensity_target != null ? 'text-red-500' : ''}>
                          {week.avg_intensity_target != null
                            ? week.avg_intensity_target
                            : <span className="text-gray-300 italic text-[8px]">—</span>}
                        </span>
                      )}
                    </td>
                  )}

                  {/* K-value — computed: tonnage / competition_total */}
                  {showCol('kvalue') && (
                    <td className="bg-blue-50/10 text-center font-mono text-[10px] text-indigo-600 px-1 py-0" style={{ minWidth: 40 }}>
                      {(() => {
                        const ton = week.tonnage_target ?? weekTonnage;
                        if (!ton || !competitionTotal) return <span className="text-gray-300 italic text-[8px]">—</span>;
                        return (ton / competitionTotal).toFixed(1);
                      })()}
                    </td>
                  )}

                  {/* Per-exercise columns */}
                  {displayed.map((te, teIdx) => {
                    const target = getTarget(week.id, te.id);
                    const prev = getPrevTarget(week.week_number, te.id);

                    const repsVal = target?.target_reps ?? null;
                    const avgVal = target?.target_avg ?? null;
                    const maxVal = target?.target_max ?? null;
                    const repsAtMax = target?.target_reps_at_max ?? null;
                    const setsAtMax = target?.target_sets_at_max ?? null;

                    const prevReps = prev?.target_reps ?? null;
                    const prevAvg = prev?.target_avg ?? null;

                    const cellKey = `${week.id}_${te.id}`;
                    const repsEditing = editingCell === `${cellKey}_target_reps`;
                    const avgEditing = editingCell === `${cellKey}_target_avg`;

                    const repsIsDeleteTarget = deleteMode && repsVal !== null;
                    const avgIsDeleteTarget = deleteMode && avgVal !== null;

                    return (
                      <React.Fragment key={te.id}>
                        {/* Reps */}
                        <td
                          className={`${teIdx === 0 ? 'border-l-2' : 'border-l'} border-gray-200 text-center font-mono text-[10px] cursor-pointer select-none px-1 py-0 transition-colors ${
                            repsIsDeleteTarget
                              ? 'bg-red-50 hover:bg-red-100'
                              : 'hover:bg-blue-50'
                          }`}
                          onClick={(e) => handleInlineClick(e, week.id, te.id, 'target_reps', repsVal, prevReps)}
                          onContextMenu={(e) => handleInlineClick(e, week.id, te.id, 'target_reps', repsVal, prevReps)}
                          title={repsIsDeleteTarget ? 'Click to clear' : undefined}
                        >
                          {repsEditing ? (
                            <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                              <input
                                type="number"
                                defaultValue={repsVal ?? ''}
                                autoFocus
                                className="w-[32px] text-center font-mono text-[10px] border-none outline-none bg-blue-50 rounded"
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
                            <span className={repsVal !== null ? (repsIsDeleteTarget ? 'text-red-500' : 'text-gray-900') : 'text-gray-300 italic text-[9px]'}>
                              {repsVal !== null ? repsVal : (prevReps !== null ? prevReps : '-')}
                            </span>
                          )}
                        </td>

                        {/* Max set — grid cell */}
                        <td className="text-center px-0 py-0">
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

                        {/* Avg */}
                        <td
                          className={`text-center font-mono text-[9px] cursor-pointer select-none px-1 py-0 transition-colors ${
                            avgIsDeleteTarget
                              ? 'bg-red-50 hover:bg-red-100'
                              : 'hover:bg-blue-50'
                          }`}
                          onClick={(e) => handleInlineClick(e, week.id, te.id, 'target_avg', avgVal, prevAvg)}
                          onContextMenu={(e) => handleInlineClick(e, week.id, te.id, 'target_avg', avgVal, prevAvg)}
                          title={avgIsDeleteTarget ? 'Click to clear' : undefined}
                        >
                          {avgEditing ? (
                            <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}>
                              <input
                                type="number"
                                defaultValue={avgVal ?? ''}
                                autoFocus
                                className="w-[32px] text-center font-mono text-[9px] border-none outline-none bg-blue-50 rounded"
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
                            <span className={avgVal !== null ? (avgIsDeleteTarget ? 'text-red-500' : 'text-gray-500') : 'text-gray-300 italic text-[8px]'}>
                              {avgVal !== null ? avgVal : (prevAvg !== null ? prevAvg : '-')}
                            </span>
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })}

                  {/* Drag handle — rightmost column */}
                  {onSwapWeeks && (
                    <td
                      className="w-5 px-0 text-center text-gray-300 select-none cursor-grab active:cursor-grabbing"
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
            const avgBg = 'bg-gray-100';
            const summaryText = 'font-normal italic text-gray-400 text-[9px]';
            rows.push(
              <tr key="avg-row" className={`border-t-2 border-gray-400 ${avgBg}`}>
                {showCol('week') && (
                  <td className={`${stickyTd('week')} text-center ${summaryText} px-1 py-1 ${avgBg}`} style={{ left: stickyLeft['week'] }}>
                    Ø
                  </td>
                )}
                {showCol('weektype') && (
                  <td className={`${stickyTd('weektype')} ${avgBg} py-1`} style={{ left: stickyLeft['weektype'] }} />
                )}
                {showCol('notes') && (
                  <td className={`${stickyTd('notes')} ${avgBg} px-2 py-1 ${summaryText}`} style={{ left: stickyLeft['notes'] }}>
                    average
                  </td>
                )}
                {showCol('k') && (
                  <td className={`${avgBg} border-l border-gray-300 text-center font-mono ${summaryText} px-1 py-1`}>
                    {avgK != null ? avgK : ''}
                  </td>
                )}
                {showCol('tonnage') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-1`}>
                    {avgTonnage != null ? (avgTonnage / 1000).toFixed(1) : ''}
                  </td>
                )}
                {showCol('avg') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-1`}>
                    {avgIntTarget != null ? avgIntTarget : ''}
                  </td>
                )}
                {showCol('kvalue') && (
                  <td className={`${avgBg} text-center font-mono ${summaryText} px-1 py-1`}>
                    {avgTonnage != null && competitionTotal ? (avgTonnage / competitionTotal).toFixed(1) : ''}
                  </td>
                )}
                {displayed.map((te, teIdx) => {
                  const exTargets = targets.filter(t => t.tracked_exercise_id === te.id);
                  const wReps = exTargets.filter(t => (t.target_reps ?? 0) > 0);
                  const wMax = exTargets.filter(t => (t.target_max ?? 0) > 0);
                  const wAvg = exTargets.filter(t => (t.target_avg ?? 0) > 0);
                  const avgReps = wReps.length > 0 ? Math.round(wReps.reduce((s, t) => s + (t.target_reps ?? 0), 0) / wReps.length) : null;
                  const avgMax = wMax.length > 0 ? Math.round(wMax.reduce((s, t) => s + (t.target_max ?? 0), 0) / wMax.length) : null;
                  const avgRepsAtMax = wMax.length > 0 ? Math.round(wMax.reduce((s, t) => s + (t.target_reps_at_max ?? 0), 0) / wMax.length) : null;
                  const avgSetsAtMax = wMax.length > 0 ? Math.round(wMax.reduce((s, t) => s + (t.target_sets_at_max ?? 0), 0) / wMax.length) : null;
                  const totalRepsForAvg = wAvg.reduce((s, t) => s + (t.target_reps ?? 0), 0);
                  const avgAvg = totalRepsForAvg > 0
                    ? Math.round(wAvg.reduce((s, t) => s + (t.target_avg ?? 0) * (t.target_reps ?? 0), 0) / totalRepsForAvg)
                    : (wAvg.length > 0 ? Math.round(wAvg.reduce((s, t) => s + (t.target_avg ?? 0), 0) / wAvg.length) : null);
                  return (
                    <React.Fragment key={te.id}>
                      <td className={`${teIdx === 0 ? 'border-l-2' : 'border-l'} border-gray-200 text-center font-mono ${summaryText} px-1 py-1`}>
                        {avgReps != null ? avgReps : ''}
                      </td>
                      <td className="text-center px-0 py-1">
                        <MacroGridCell load={avgMax} reps={avgRepsAtMax} sets={avgSetsAtMax} onUpdate={() => {}} disabled />
                      </td>
                      <td className={`text-center font-mono ${summaryText} px-1 py-1`}>
                        {avgAvg != null ? avgAvg : ''}
                      </td>
                    </React.Fragment>
                  );
                })}
                {onSwapWeeks && <td className={`${avgBg} w-5`} />}
              </tr>
            );

            // ── Max / peak row ─────────────────────────────────────────────────────
            const maxBg = 'bg-gray-50';
            rows.push(
              <tr key="max-row" className={`border-t border-gray-200 ${maxBg}`}>
                {showCol('week') && (
                  <td className={`${stickyTd('week')} text-center ${summaryText} px-1 py-1 ${maxBg}`} style={{ left: stickyLeft['week'] }}>
                    ↑
                  </td>
                )}
                {showCol('weektype') && (
                  <td className={`${stickyTd('weektype')} ${maxBg} py-1`} style={{ left: stickyLeft['weektype'] }} />
                )}
                {showCol('notes') && (
                  <td className={`${stickyTd('notes')} ${maxBg} px-2 py-1 ${summaryText}`} style={{ left: stickyLeft['notes'] }}>
                    peak
                  </td>
                )}
                {showCol('k') && (
                  <td className={`${maxBg} border-l border-gray-300 text-center font-mono ${summaryText} px-1 py-1`}>
                    {maxK != null ? maxK : ''}
                  </td>
                )}
                {showCol('tonnage') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-1`}>
                    {maxTonnage != null ? (maxTonnage / 1000).toFixed(1) : ''}
                  </td>
                )}
                {showCol('avg') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-1`}>
                    {maxIntTarget != null ? maxIntTarget : ''}
                  </td>
                )}
                {showCol('kvalue') && (
                  <td className={`${maxBg} text-center font-mono ${summaryText} px-1 py-1`}>
                    {maxTonnage != null && competitionTotal ? (maxTonnage / competitionTotal).toFixed(1) : ''}
                  </td>
                )}
                {displayed.map((te, teIdx) => {
                  const exTargets = targets.filter(t => t.tracked_exercise_id === te.id);
                  const maxReps = exTargets.length > 0 ? Math.max(...exTargets.map(t => t.target_reps ?? 0)) : null;
                  const peakTarget = exTargets.reduce<MacroTarget | undefined>((best, t) =>
                    (t.target_max ?? 0) > (best?.target_max ?? 0) ? t : best, undefined);
                  const maxAvg = exTargets.length > 0 ? Math.max(...exTargets.map(t => t.target_avg ?? 0)) : null;
                  return (
                    <React.Fragment key={te.id}>
                      <td className={`${teIdx === 0 ? 'border-l-2' : 'border-l'} border-gray-200 text-center font-mono ${summaryText} px-1 py-1`}>
                        {maxReps ? maxReps : ''}
                      </td>
                      <td className="text-center px-0 py-1">
                        <MacroGridCell
                          load={peakTarget?.target_max ?? null}
                          reps={peakTarget?.target_reps_at_max ?? null}
                          sets={peakTarget?.target_sets_at_max ?? null}
                          onUpdate={() => {}} disabled
                        />
                      </td>
                      <td className={`text-center font-mono ${summaryText} px-1 py-1`}>
                        {maxAvg ? maxAvg : ''}
                      </td>
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
