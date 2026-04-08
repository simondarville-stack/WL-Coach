import React, { useState } from 'react';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, WeekTypeConfig } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import { formatDateShort } from '../../lib/dateUtils';
import { MacroWeekNotes } from './MacroWeekNotes';
import { getWeekTypeColor } from '../../lib/weekUtils';

function getCellColor(actual: number, target: number | null): string {
  if (target === null || target === 0) return '';
  if (actual === 0) return 'text-gray-400 italic';
  const pct = (actual / target) * 100;
  if (pct >= 95 && pct <= 105) return 'text-green-700';
  if (pct >= 85 && pct <= 115) return 'text-yellow-700';
  return 'text-red-600';
}

interface MacroPhaseBlockProps {
  phase: MacroPhase | null; // null = "Unassigned" section
  weeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  actuals: MacroActualsMap;
  localValues: Record<string, string>;
  weekTypes: WeekTypeConfig[];
  onLocalChange: (key: string, value: string) => void;
  onUpdateTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: string) => Promise<void>;
  onUpdateWeekType: (weekId: string, weekType: string) => Promise<void>;
  onUpdateWeekLabel: (weekId: string, label: string) => Promise<void>;
  onUpdateTotalReps: (weekId: string, value: string) => Promise<void>;
  onUpdateNotes: (weekId: string, notes: string) => Promise<void>;
  onCopyWeek: (weekId: string) => void;
  onPasteWeek: (weekId: string) => void;
  copiedWeekId: string | null;
  isPhaseHeader?: boolean;
}

function getLocalOrDb(localValues: Record<string, string>, key: string, dbValue: string | number | null | undefined): string {
  if (key in localValues) return localValues[key];
  return dbValue?.toString() ?? '';
}

export function MacroPhaseBlock({
  phase,
  weeks,
  trackedExercises,
  targets,
  actuals,
  localValues,
  weekTypes,
  onLocalChange,
  onUpdateTarget,
  onUpdateWeekType,
  onUpdateWeekLabel,
  onUpdateTotalReps,
  onUpdateNotes,
  onCopyWeek,
  onPasteWeek,
  copiedWeekId,
}: MacroPhaseBlockProps) {
  const [openDropdownWeekId, setOpenDropdownWeekId] = useState<string | null>(null);

  const getTarget = (weekId: string, trackedExId: string) =>
    targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === trackedExId);

  function cycleWeekType(weekId: string, current: string, direction: 1 | -1) {
    if (weekTypes.length === 0) return;
    const idx = weekTypes.findIndex(t => t.abbreviation === current);
    const next = weekTypes[((idx + direction) % weekTypes.length + weekTypes.length) % weekTypes.length];
    void onUpdateWeekType(weekId, next.abbreviation);
    void onUpdateWeekLabel(weekId, next.name);
  }

  // Phase summary
  const phaseTargetReps = weeks.reduce((s, w) => s + (w.total_reps_target || 0), 0);
  const phaseActualReps = weeks.reduce((s, w) => {
    const weekActuals = actuals[w.id] || {};
    return s + Object.values(weekActuals).reduce((es, a) => es + a.totalReps, 0);
  }, 0);
  const phaseCompletedWeeks = weeks.filter(w => {
    const wa = actuals[w.id] || {};
    return Object.values(wa).some(a => a.totalReps > 0);
  }).length;

  const stickyBg = phase ? '' : 'bg-gray-50';
  const phaseHeaderStyle = phase ? { backgroundColor: phase.color } : {};

  return (
    <>
      {/* Phase header row */}
      <tr>
        <td
          colSpan={4 + trackedExercises.length * 5 + 1}
          className="border-b border-gray-300 px-3 py-1.5"
          style={phaseHeaderStyle}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-800">
              {phase ? phase.name : 'Unassigned weeks'}
              {phase && ` — Wk ${phase.start_week_number}–${phase.end_week_number}`}
            </span>
            <span className="text-[10px] text-gray-500">
              {phaseTargetReps > 0 && `Target: ${phaseTargetReps.toLocaleString()} reps`}
              {phaseActualReps > 0 && ` · Actual: ${phaseActualReps.toLocaleString()} reps`}
              {` · ${phaseCompletedWeeks}/${weeks.length} wks done`}
            </span>
          </div>
        </td>
      </tr>

      {/* Week rows */}
      {weeks.map(week => {
        const weekColor = getWeekTypeColor(week.week_type, weekTypes);
        const rowStyle = { backgroundColor: weekColor + '1a' };
        const infoStyle = { backgroundColor: weekColor + '33' };
        const weekActuals = actuals[week.id] || {};
        const isCopied = copiedWeekId === week.id;

        return (
          <tr key={week.id} className="border-b border-gray-200 hover:brightness-95 transition-all" style={rowStyle}>
            {/* Wk */}
            <td className="sticky left-0 z-[3] px-2 py-0.5 text-center text-xs font-medium text-gray-900 border-r border-gray-300" style={{ width: 36, minWidth: 36, ...infoStyle }}>
              {week.week_number}
            </td>

            {/* Date */}
            <td className="sticky left-[36px] z-[3] px-2 py-0.5 text-center text-xs text-gray-700 border-r border-gray-300" style={{ width: 50, minWidth: 50, ...infoStyle }}>
              {formatDateShort(week.week_start)}
            </td>

            {/* Type */}
            <td className="sticky left-[86px] z-[3] px-1 py-0.5 border-r border-gray-300" style={{ width: 100, minWidth: 100, ...infoStyle }}>
              <div className="flex flex-col gap-0.5 relative">
                {/* Cycling badge */}
                <button
                  onClick={e => {
                    if (e.ctrlKey || e.metaKey) {
                      setOpenDropdownWeekId(prev => prev === week.id ? null : week.id);
                    } else {
                      cycleWeekType(week.id, week.week_type, 1);
                    }
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    cycleWeekType(week.id, week.week_type, -1);
                  }}
                  title="Click to cycle · Right-click to go back · Ctrl+click for list"
                  className="w-full px-1.5 py-0.5 text-[10px] font-medium rounded text-left select-none"
                  style={{
                    backgroundColor: weekColor + '33',
                    color: weekColor,
                    border: `1px solid ${weekColor}55`,
                  }}
                >
                  {weekTypes.find(t => t.abbreviation === week.week_type)?.name ?? (week.week_type || '—')}
                </button>

                {/* Dropdown for Ctrl+click */}
                {openDropdownWeekId === week.id && (
                  <div
                    className="absolute top-full left-0 z-30 mt-0.5 bg-white border border-gray-200 rounded shadow-lg min-w-[90px]"
                    onMouseLeave={() => setOpenDropdownWeekId(null)}
                  >
                    {weekTypes.map(t => (
                      <button
                        key={t.abbreviation}
                        onClick={() => {
                          void onUpdateWeekType(week.id, t.abbreviation);
                          void onUpdateWeekLabel(week.id, t.name);
                          setOpenDropdownWeekId(null);
                        }}
                        className="w-full text-left px-2 py-1 text-[10px] hover:bg-gray-50 flex items-center gap-1.5"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  value={getLocalOrDb(localValues, `${week.id}_label`, week.week_type_text)}
                  onChange={e => onLocalChange(`${week.id}_label`, e.target.value)}
                  onBlur={e => onUpdateWeekLabel(week.id, e.target.value)}
                  placeholder="Label..."
                  className="w-full px-1 py-0.5 text-[10px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                />
              </div>
            </td>

            {/* Σ Reps */}
            <td className="sticky left-[186px] z-[3] px-1 py-0.5 border-r border-gray-400" style={{ width: 52, minWidth: 52, ...infoStyle }}>
              <input
                type="text"
                value={getLocalOrDb(localValues, `${week.id}_total_reps`, week.total_reps_target)}
                onChange={e => onLocalChange(`${week.id}_total_reps`, e.target.value)}
                onBlur={e => onUpdateTotalReps(week.id, e.target.value)}
                placeholder="—"
                className="w-full px-1 py-0.5 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-medium"
              />
            </td>

            {/* Notes — inline visible */}
            <td className="sticky left-[238px] z-[3] px-1 py-0.5 border-r border-gray-300" style={{ width: 150, minWidth: 150, maxWidth: 150, ...infoStyle }}>
              <MacroWeekNotes weekId={week.id} notes={week.notes} onSave={onUpdateNotes} />
            </td>

            {/* Per-exercise targets + actuals */}
            {trackedExercises.map((te, teIdx) => {
              const target = getTarget(week.id, te.id);
              const exActuals = weekActuals[te.exercise_id];
              const fields: (keyof MacroTarget)[] = ['target_reps', 'target_max', 'target_sets_at_max', 'target_reps_at_max', 'target_avg'];
              const actualValues: (number | null)[] = exActuals
                ? [exActuals.totalReps, exActuals.maxWeight, exActuals.setsAtMax, exActuals.repsAtMax, exActuals.avgWeight]
                : [null, null, null, null, null];

              return (
                <React.Fragment key={te.id}>
                  {fields.map((field, fi) => {
                    const inputKey = `${week.id}_${te.id}_${field}`;
                    const targetVal = target?.[field] as number | null | undefined;
                    const actualVal = actualValues[fi];
                    const actualColor = actualVal !== null ? getCellColor(actualVal, targetVal ?? null) : '';
                    const isLastField = fi === fields.length - 1;
                    const isLastEx = teIdx === trackedExercises.length - 1;

                    return (
                      <td
                        key={field}
                        className={`px-0.5 py-0.5 ${isLastField ? (isLastEx ? 'border-r border-gray-300' : 'border-r border-gray-300') : 'border-r border-gray-200'}`}
                        style={{ minWidth: '44px' }}
                      >
                        <div className="flex flex-col gap-px">
                          {/* Target input */}
                          <input
                            type="text"
                            value={getLocalOrDb(localValues, inputKey, targetVal)}
                            onChange={e => onLocalChange(inputKey, e.target.value)}
                            onBlur={e => onUpdateTarget(week.id, te.id, field, e.target.value)}
                            placeholder="—"
                            className="w-full px-0.5 py-px text-[10px] text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-gray-500"
                          />
                          {/* Actual value */}
                          <div className={`text-[10px] text-center px-0.5 ${actualVal !== null ? actualColor : 'text-gray-300'}`}>
                            {actualVal !== null && actualVal > 0 ? actualVal : '—'}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* Copy/paste */}
            <td className="px-1 py-0.5 border-r border-gray-200 min-w-[40px]">
              <div className="flex flex-col gap-px">
                <button
                  onClick={() => onCopyWeek(week.id)}
                  title="Copy week targets"
                  className={`text-[9px] px-1 py-px rounded transition-colors ${
                    isCopied ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'
                  }`}
                >
                  {isCopied ? 'Copied' : 'Copy'}
                </button>
                {copiedWeekId && copiedWeekId !== week.id && (
                  <button
                    onClick={() => onPasteWeek(week.id)}
                    title="Paste copied targets here"
                    className="text-[9px] px-1 py-px rounded text-green-600 hover:bg-green-50 transition-colors"
                  >
                    Paste
                  </button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
