import React, { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, Copy, ClipboardPaste } from 'lucide-react';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, WeekType } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import { MacroGridCell } from './MacroGridCell';

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
  onUpdateNotes: (weekId: string, notes: string) => Promise<void>;
  onMoveExerciseLeft: (trackedExId: string) => Promise<void>;
  onMoveExerciseRight: (trackedExId: string) => Promise<void>;
  onRemoveExercise: (trackedExId: string) => Promise<void>;
  onPasteTargets: (targetWeekId: string, copiedTargets: Record<string, Partial<MacroTarget>>) => Promise<void>;
  onExerciseDoubleClick: (trackedExId: string) => void;
  visibleExercises?: Set<string>;
}

// Week type display config — will later come from settings
const WEEK_TYPE_COLORS: Record<string, string> = {
  High: '#E24B4A',
  Medium: '#EF9F27',
  Low: '#1D9E75',
  Deload: '#5DCAA5',
  Competition: '#378ADD',
  Taper: '#7F77DD',
  Vacation: '#888780',
  Testing: '#D85A30',
  Transition: '#D4537E',
};

function getWeekTypeAbbr(wt: string): string {
  if (!wt) return '-';
  const map: Record<string, string> = {
    High: 'h', Medium: 'm', Low: 'g', Deload: 'dl',
    Competition: 'c', Taper: 'tp', Vacation: 'v',
    Testing: 'te', Transition: 'tr',
  };
  return map[wt] ?? wt.slice(0, 2).toLowerCase();
}

function getWeekTypeColor(wt: string): string {
  return WEEK_TYPE_COLORS[wt] ?? '#888780';
}

// Cycle through week types on click
const WEEK_TYPES: WeekType[] = ['High', 'Medium', 'Low', 'Deload', 'Taper', 'Competition', 'Vacation', 'Testing', 'Transition'];

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
  onUpdateNotes,
  onMoveExerciseLeft,
  onMoveExerciseRight,
  onRemoveExercise,
  onPasteTargets,
  onExerciseDoubleClick,
  visibleExercises,
}: MacroTableV2Props) {
  const [copiedWeekId, setCopiedWeekId] = useState<string | null>(null);
  const [copiedTargets, setCopiedTargets] = useState<Record<string, Partial<MacroTarget>>>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);

  const displayed = visibleExercises
    ? trackedExercises.filter(te => visibleExercises.has(te.id))
    : trackedExercises;

  // Get target for a week + exercise
  const getTarget = useCallback((weekId: string, teId: string): MacroTarget | undefined => {
    return targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === teId);
  }, [targets]);

  // Get previous week's target for auto-fill
  const getPrevTarget = useCallback((weekNumber: number, teId: string): MacroTarget | undefined => {
    const prevWeek = macroWeeks.find(w => w.week_number === weekNumber - 1);
    if (!prevWeek) return undefined;
    return targets.find(t => t.macro_week_id === prevWeek.id && t.tracked_exercise_id === teId);
  }, [macroWeeks, targets]);

  // Handle grid cell updates — batches into single upsertTarget calls
  const handleGridUpdate = useCallback(async (
    weekId: string, teId: string, values: { load?: number; reps?: number; sets?: number },
  ) => {
    const existing = getTarget(weekId, teId);
    if (values.load !== undefined) {
      await onUpdateTarget(weekId, teId, 'target_max', String(values.load));
    }
    if (values.reps !== undefined) {
      await onUpdateTarget(weekId, teId, 'target_reps_at_max', String(values.reps));
    }
    if (values.sets !== undefined) {
      await onUpdateTarget(weekId, teId, 'target_sets_at_max', String(values.sets));
    }
  }, [getTarget, onUpdateTarget]);

  // Inline number edit (for reps and avg columns)
  const handleInlineClick = useCallback((
    e: React.MouseEvent, weekId: string, teId: string, field: 'target_reps' | 'target_avg',
    currentValue: number | null, prevValue: number | null,
  ) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      setEditingCell(`${weekId}_${teId}_${field}`);
      return;
    }
    const delta = e.button === 2 ? -1 : 1;
    const base = currentValue ?? prevValue ?? 0;
    const newVal = Math.max(0, (currentValue !== null ? currentValue : base) + delta);
    onUpdateTarget(weekId, teId, field, String(newVal));
  }, [onUpdateTarget]);

  // Copy week
  const handleCopyWeek = useCallback((weekId: string) => {
    setCopiedWeekId(weekId);
    const snapshot: Record<string, Partial<MacroTarget>> = {};
    trackedExercises.forEach(te => {
      const target = getTarget(weekId, te.id);
      if (target) {
        snapshot[te.id] = {
          target_reps: target.target_reps,
          target_avg: target.target_avg,
          target_max: target.target_max,
          target_reps_at_max: target.target_reps_at_max,
          target_sets_at_max: target.target_sets_at_max,
        };
      }
    });
    setCopiedTargets(snapshot);
  }, [trackedExercises, getTarget]);

  // Cycle week type
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

  return (
    <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
      <table className="text-xs" style={{ minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-20">
          {/* Exercise headers */}
          <tr className="bg-gray-100 border-b border-gray-300">
            <th
              colSpan={3}
              className="sticky left-0 z-[10] bg-slate-100 border-r border-gray-300 px-2 py-1 text-left text-[10px] font-medium text-gray-600"
              style={{ width: 100, minWidth: 100 }}
            >
              Week
            </th>
            {displayed.map((te, idx) => (
              <th
                key={te.id}
                colSpan={3}
                className="px-1 py-1 border-l border-gray-300 text-center cursor-pointer select-none"
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
          </tr>
          {/* Sub-headers */}
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="sticky left-0 z-[10] bg-gray-50 text-[8px] text-gray-400 font-normal px-1" style={{ width: 26 }}>Wk</th>
            <th className="sticky left-[26px] z-[10] bg-gray-50 text-[8px] text-gray-400 font-normal px-1" style={{ width: 22 }}>B</th>
            <th className="sticky left-[48px] z-[10] bg-gray-50 border-r border-gray-300 text-[8px] text-gray-400 font-normal px-1" style={{ width: 32 }}>K</th>
            {displayed.map(te => (
              <React.Fragment key={te.id}>
                <td className="border-l border-gray-300 text-[8px] text-gray-400 font-normal text-center px-1">Reps</td>
                <td className="text-[8px] text-gray-400 font-normal text-center px-1">Max set</td>
                <td className="text-[8px] text-gray-400 font-normal text-center px-1">Avg</td>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {(() => {
            let lastPhaseId: string | null = null;
            const rows: React.ReactNode[] = [];

            macroWeeks.forEach((week) => {
              const phase = weekToPhase.get(week.id);

              // Phase separator row
              if (phase && phase.id !== lastPhaseId) {
                lastPhaseId = phase.id ?? null;
                rows.push(
                  <tr key={`phase-${phase.id}`} className="border-t-2 border-gray-300">
                    <td
                      colSpan={3 + displayed.length * 3}
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

              // K1-7 total
              let weekK = 0;
              displayed.forEach(te => {
                const t = getTarget(week.id, te.id);
                weekK += t?.target_reps ?? 0;
              });

              const wtColor = getWeekTypeColor(week.week_type);
              const wtAbbr = getWeekTypeAbbr(week.week_type);

              rows.push(
                <tr key={week.id} className="hover:bg-gray-50/50 transition-colors">
                  {/* Week number */}
                  <td className="sticky left-0 z-[5] bg-white text-center font-medium text-gray-900 text-[11px] px-1 py-0"
                      style={{ width: 26 }}>
                    {week.week_number}
                  </td>

                  {/* Week type badge */}
                  <td className="sticky left-[26px] z-[5] bg-white text-center px-0.5 py-0" style={{ width: 22 }}>
                    <span
                      className="text-[8px] font-medium rounded px-1 py-px cursor-pointer select-none inline-block"
                      style={{
                        backgroundColor: wtColor + '20',
                        color: wtColor,
                      }}
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
                  </td>

                  {/* K1-7 total */}
                  <td className="sticky left-[48px] z-[5] bg-white border-r border-gray-300 text-center font-mono font-medium text-[10px] text-gray-900 px-1 py-0"
                      style={{ width: 32 }}>
                    {weekK > 0 ? weekK : ''}
                  </td>

                  {/* Per-exercise columns */}
                  {displayed.map(te => {
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

                    return (
                      <React.Fragment key={te.id}>
                        {/* Reps */}
                        <td
                          className="border-l border-gray-200 text-center font-mono text-[10px] cursor-pointer select-none px-1 py-0 hover:bg-blue-50 transition-colors"
                          onClick={(e) => handleInlineClick(e, week.id, te.id, 'target_reps', repsVal, prevReps)}
                          onContextMenu={(e) => handleInlineClick(e, week.id, te.id, 'target_reps', repsVal, prevReps)}
                        >
                          {repsEditing ? (
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
                          ) : (
                            <span className={repsVal !== null ? 'text-gray-900' : 'text-gray-300 italic text-[9px]'}>
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
                          />
                        </td>

                        {/* Avg */}
                        <td
                          className="text-center font-mono text-[9px] cursor-pointer select-none px-1 py-0 hover:bg-blue-50 transition-colors"
                          onClick={(e) => handleInlineClick(e, week.id, te.id, 'target_avg', avgVal, prevAvg)}
                          onContextMenu={(e) => handleInlineClick(e, week.id, te.id, 'target_avg', avgVal, prevAvg)}
                        >
                          {avgEditing ? (
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
                          ) : (
                            <span className={avgVal !== null ? 'text-gray-500' : 'text-gray-300 italic text-[8px]'}>
                              {avgVal !== null ? avgVal : (prevAvg !== null ? prevAvg : '-')}
                            </span>
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            });

            // Average row
            rows.push(
              <tr key="avg-row" className="border-t-2 border-gray-300 bg-gray-50">
                <td colSpan={3} className="sticky left-0 bg-gray-50 border-r border-gray-300 text-center font-medium text-gray-600 text-[10px] px-1 py-1">
                  Ø
                </td>
                {displayed.map(te => {
                  const exTargets = targets.filter(t => t.tracked_exercise_id === te.id);
                  const weekCount = macroWeeks.length || 1;
                  const totalReps = exTargets.reduce((s, t) => s + (t.target_reps ?? 0), 0);
                  const avgReps = Math.round(totalReps / weekCount);
                  const peakTarget = exTargets.reduce((best, t) =>
                    (t.target_max ?? 0) > (best?.target_max ?? 0) ? t : best, exTargets[0]);
                  const totalAvgLoad = exTargets.reduce((s, t) => s + (t.target_avg ?? 0) * (t.target_reps ?? 0), 0);
                  const avgAvg = totalReps > 0 ? Math.round(totalAvgLoad / totalReps) : 0;

                  return (
                    <React.Fragment key={te.id}>
                      <td className="border-l border-gray-200 text-center font-mono text-[9px] text-gray-600 px-1 py-1">{avgReps}</td>
                      <td className="text-center px-0 py-1">
                        <MacroGridCell
                          load={peakTarget?.target_max ?? null}
                          reps={peakTarget?.target_reps_at_max ?? null}
                          sets={peakTarget?.target_sets_at_max ?? null}
                          onUpdate={() => {}}
                          disabled
                        />
                      </td>
                      <td className="text-center font-mono text-[9px] text-gray-500 px-1 py-1">{avgAvg || ''}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            );

            return rows;
          })()}
        </tbody>
      </table>
    </div>
  );
}
