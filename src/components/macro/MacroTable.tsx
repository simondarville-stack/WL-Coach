import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, WeekType } from '../../lib/database.types';
import type { MacroActualsMap } from '../../hooks/useMacroCycles';
import { MacroPhaseBlock } from './MacroPhaseBlock';

interface MacroTableProps {
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
}

export function MacroTable({
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
}: MacroTableProps) {
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [copiedWeekId, setCopiedWeekId] = useState<string | null>(null);
  // copiedTargets: trackedExId → { field → value }
  const [copiedTargets, setCopiedTargets] = useState<Record<string, Partial<MacroTarget>>>({});

  const handleLocalChange = useCallback((key: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleUpdateTarget = useCallback(async (weekId: string, trackedExId: string, field: keyof MacroTarget, value: string) => {
    await onUpdateTarget(weekId, trackedExId, field, value);
    // Clear local pending value after save
    setLocalValues(prev => {
      const next = { ...prev };
      delete next[`${weekId}_${trackedExId}_${field}`];
      return next;
    });
  }, [onUpdateTarget]);

  const handleUpdateWeekLabel = useCallback(async (weekId: string, label: string) => {
    await onUpdateWeekLabel(weekId, label);
    setLocalValues(prev => {
      const next = { ...prev };
      delete next[`${weekId}_label`];
      return next;
    });
  }, [onUpdateWeekLabel]);

  const handleUpdateTotalReps = useCallback(async (weekId: string, value: string) => {
    await onUpdateTotalReps(weekId, value);
    setLocalValues(prev => {
      const next = { ...prev };
      delete next[`${weekId}_total_reps`];
      return next;
    });
  }, [onUpdateTotalReps]);

  const handleCopyWeek = useCallback((weekId: string) => {
    setCopiedWeekId(weekId);
    // Snapshot current targets for this week
    const snapshot: Record<string, Partial<MacroTarget>> = {};
    trackedExercises.forEach(te => {
      const target = targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === te.id);
      if (target) {
        snapshot[te.id] = {
          target_reps: target.target_reps,
          target_ave: target.target_ave,
          target_hi: target.target_hi,
          target_rhi: target.target_rhi,
          target_shi: target.target_shi,
        };
      }
    });
    setCopiedTargets(snapshot);
  }, [trackedExercises, targets]);

  const handlePasteWeek = useCallback(async (weekId: string) => {
    await onPasteTargets(weekId, copiedTargets);
  }, [onPasteTargets, copiedTargets]);

  // Group weeks into phases
  const sortedPhases = [...phases].sort((a, b) => a.position - b.position);

  const weekToPhase = new Map<string, MacroPhase>();
  for (const phase of sortedPhases) {
    for (const week of macroWeeks) {
      if (week.week_number >= phase.start_week_number && week.week_number <= phase.end_week_number) {
        if (!weekToPhase.has(week.id)) {
          weekToPhase.set(week.id, phase);
        }
      }
    }
  }

  // Build phase groups: ordered phases + unassigned
  const phaseGroups: Array<{ phase: MacroPhase | null; weeks: MacroWeek[] }> = sortedPhases.map(phase => ({
    phase,
    weeks: macroWeeks.filter(w => weekToPhase.get(w.id)?.id === phase.id),
  })).filter(g => g.weeks.length > 0);

  const unassignedWeeks = macroWeeks.filter(w => !weekToPhase.has(w.id));
  if (unassignedWeeks.length > 0) {
    phaseGroups.push({ phase: null, weeks: unassignedWeeks });
  }

  const totalCols = 4 + trackedExercises.length * 5 + 1;

  const subHeaders = ['Reps', 'Ave', 'Hi', 'RHi', 'SHi'];

  return (
    <div className="overflow-auto flex-1">
      <table className="text-xs" style={{ minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-20">
          {/* Exercise group header row */}
          <tr className="bg-gray-100 border-b border-gray-300">
            {/* Sticky fixed columns */}
            <th
              colSpan={5}
              className="sticky left-0 z-[10] bg-slate-200 border-r border-gray-400 px-2 py-1 text-left text-[10px] font-semibold text-gray-700"
              style={{ minWidth: '388px' }}
            >
              Week
            </th>

            {/* Per-exercise group headers */}
            {trackedExercises.map((te, idx) => (
              <th
                key={te.id}
                colSpan={5}
                onDoubleClick={() => onExerciseDoubleClick(te.id)}
                className="px-1 py-1 border-r border-gray-300 text-center cursor-pointer select-none"
                style={{ minWidth: '220px' }}
                title="Double-click to open chart"
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    onClick={() => onMoveExerciseLeft(te.id)}
                    disabled={idx === 0}
                    title="Move left"
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-20 flex-shrink-0"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: te.exercise.color }}
                    />
                    <span className="text-[10px] font-semibold text-gray-800 truncate">
                      {te.exercise.exercise_code || te.exercise.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => onMoveExerciseRight(te.id)}
                      disabled={idx === trackedExercises.length - 1}
                      title="Move right"
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-20"
                    >
                      <ChevronRight size={12} />
                    </button>
                    <button
                      onClick={() => onRemoveExercise(te.id)}
                      title="Remove from tracking"
                      className="text-gray-300 hover:text-red-500"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              </th>
            ))}

            {/* Actions column header */}
            <th className="px-1 py-1 bg-gray-100 text-center text-[10px] text-gray-400" style={{ minWidth: '40px' }} />
          </tr>

          {/* Sub-column header row */}
          <tr className="bg-gray-50 border-b-2 border-gray-400">
            <th className={`sticky left-0 z-[10] bg-slate-100 px-2 py-0.5 text-center text-[10px] font-medium text-gray-600 border-r border-gray-300`} style={{ minWidth: '36px' }}>
              Wk
            </th>
            <th className={`sticky left-[36px] z-[10] bg-slate-100 px-2 py-0.5 text-center text-[10px] font-medium text-gray-600 border-r border-gray-300`} style={{ minWidth: '50px' }}>
              Date
            </th>
            <th className={`sticky left-[86px] z-[10] bg-slate-100 px-1 py-0.5 text-center text-[10px] font-medium text-gray-600 border-r border-gray-300`} style={{ minWidth: '100px' }}>
              Type
            </th>
            <th className={`sticky left-[186px] z-[10] bg-slate-100 px-1 py-0.5 text-center text-[10px] font-medium text-gray-600 border-r border-gray-400`} style={{ minWidth: '52px' }}>
              ΣReps
            </th>
            <th className={`sticky left-[238px] z-[10] bg-slate-100 px-1 py-0.5 text-left text-[10px] font-medium text-gray-600 border-r border-gray-300`} style={{ minWidth: '150px' }}>
              Notes
            </th>

            {trackedExercises.map((te, teIdx) =>
              subHeaders.map((label, fi) => (
                <th
                  key={`${te.id}_${label}`}
                  className={`px-0.5 py-0.5 text-center text-[10px] font-medium text-gray-500 ${
                    fi === subHeaders.length - 1
                      ? teIdx === trackedExercises.length - 1 ? 'border-r border-gray-300' : 'border-r border-gray-300'
                      : 'border-r border-gray-200'
                  }`}
                  style={{ minWidth: '44px' }}
                >
                  {label}
                </th>
              ))
            )}

            <th className="px-1 py-0.5 text-center text-[10px] font-medium text-gray-400 border-r border-gray-200" style={{ minWidth: '40px' }}>
              ⎘
            </th>
          </tr>
        </thead>

        <tbody>
          {phaseGroups.map(({ phase, weeks }) => (
            <MacroPhaseBlock
              key={phase?.id ?? '__unassigned__'}
              phase={phase}
              weeks={weeks}
              trackedExercises={trackedExercises}
              targets={targets}
              actuals={actuals}
              localValues={localValues}
              onLocalChange={handleLocalChange}
              onUpdateTarget={handleUpdateTarget}
              onUpdateWeekType={onUpdateWeekType}
              onUpdateWeekLabel={handleUpdateWeekLabel}
              onUpdateTotalReps={handleUpdateTotalReps}
              onUpdateNotes={onUpdateNotes}
              onCopyWeek={handleCopyWeek}
              onPasteWeek={handlePasteWeek}
              copiedWeekId={copiedWeekId}
            />
          ))}

          {phaseGroups.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="text-center py-8 text-sm text-gray-400">
                No weeks found. Create a macrocycle with weeks to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
