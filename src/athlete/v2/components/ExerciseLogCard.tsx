/**
 * ExerciseLogCard — one planned exercise, mobile-first, with set entry.
 *
 * Renders the prescription on top and a stack of set rows below.
 * "Log as prescribed" copies planned values into performed and marks all
 * sets completed.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Replace } from 'lucide-react';
import { DoneChip } from '../../../components/log/DoneChip';
import type { TrainingLogSet, TrainingLogExercise, Exercise, ExerciseStub, GppSection } from '../../../lib/database.types';
import type { PlannedExerciseFull } from '../../../lib/trainingLogService';
import { SetEntryRow, expandSetLines, type SetRowInput } from './SetEntryRow';
import { StackedNotation } from '../../../components/planner/StackedNotation';
import { getSentinelType } from '../../../components/planner/sentinelUtils';
import { SentinelDisplay } from '../../../components/planner/SentinelDisplay';
import { parseFreeTextPrescription } from '../../../lib/prescriptionParser';
import { GppLogCard } from './GppLogCard';

interface ExerciseLogCardProps {
  planned: PlannedExerciseFull;
  loggedExercise: TrainingLogExercise | null;
  loggedSets: TrainingLogSet[];
  onSaveSet: (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
  onLogAsPrescribed: (rows: SetRowInput[]) => Promise<void>;
  onUpdateNotes: (notes: string) => Promise<void>;
  onMarkComplete: () => Promise<void>;
  /** Delete one logged set; passed through to SetEntryRow. */
  onDeleteSet?: (setId: string) => Promise<void>;
  /** Drop a planned set that the athlete never touched. Persists the
   *  removal so the row stays hidden across reloads. */
  onRemovePlannedSet?: (setNumber: number) => Promise<void>;
  /** Persist a GPP block's row state when the athlete edits or ticks
   *  a row. Required only when the planned exercise is a GPP sentinel. */
  onSaveGppSection?: (section: GppSection) => Promise<void>;
  /** Open the substitution picker for this planned exercise. */
  onRequestSubstitute?: () => void;
  /** Optional: the actually-performed exercise after a substitution.
   *  When provided and ≠ planned, the card surfaces the swap.
   *  Accepts ExerciseStub when only id/name/color are available. */
  performedExercise?: Exercise | ExerciseStub | null;
  /** When true (a save is in flight at session level), disable the "Log as
   *  prescribed" button and all set-entry inputs to prevent double-writes. */
  globalSaving?: boolean;
}

export function ExerciseLogCard({
  planned,
  loggedExercise,
  loggedSets,
  onSaveSet,
  onLogAsPrescribed,
  onUpdateNotes,
  onMarkComplete,
  onDeleteSet,
  onRemovePlannedSet,
  onSaveGppSection,
  onRequestSubstitute,
  performedExercise,
  globalSaving = false,
}: ExerciseLogCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [notes, setNotes] = useState(loggedExercise?.performed_notes ?? '');
  const [savingPrescribed, setSavingPrescribed] = useState(false);
  /** Extra ad-hoc set rows beyond the planned set lines. */
  const [extraRows, setExtraRows] = useState(0);

  // Sync notes on primitive dep so a parent re-render with a new
  // loggedExercise reference doesn't reset what the user is typing.
  useEffect(() => {
    setNotes(loggedExercise?.performed_notes ?? '');
  }, [loggedExercise?.performed_notes]);

  const removedSetNumbers = useMemo(
    () => loggedExercise?.metadata?.removed_set_numbers ?? [],
    [loggedExercise?.metadata?.removed_set_numbers],
  );

  const rows = useMemo<SetRowInput[]>(() => {
    // Structured set lines win. Free-text-reps prescriptions don't get
    // stored as planned_set_lines (load_value is numeric), so when the
    // unit is free_text_reps and setLines is empty we fall back to the
    // free-text parser and synthesise rows. The loadText carries the
    // coach's prose ("moderate work"), reps stay numeric, and load
    // saves as null until the athlete types a kg figure.
    //
    // Pure free_text (and "other") units carry no rep/load structure at
    // all — the coach's prose lives in prescription_raw and is already
    // rendered in the card header. We still synthesise a single ✓/✗ row
    // so the athlete can mark the whole exercise done or skip it.
    let base: SetRowInput[] = [];
    if (planned.setLines.length > 0) {
      base = expandSetLines(planned.setLines);
    } else if (planned.exercise.unit === 'free_text_reps' && planned.exercise.prescription_raw) {
      const lines = parseFreeTextPrescription(planned.exercise.prescription_raw);
      let setNumber = 1;
      for (const line of lines) {
        const count = Math.max(1, line.sets ?? 1);
        for (let i = 0; i < count; i += 1) {
          base.push({
            setNumber,
            plannedRepsText: String(line.reps ?? '—'),
            plannedLoadText: line.loadText || '—',
            plannedRepsValue: line.reps ?? null,
            plannedLoadValue: null,
          });
          setNumber += 1;
        }
      }
    } else if (planned.exercise.unit === 'free_text' || planned.exercise.unit === 'other') {
      base.push({
        setNumber: 1,
        plannedRepsText: '—',
        plannedLoadText: '—',
        plannedRepsValue: null,
        plannedLoadValue: null,
        freeTextMode: true,
        freeTextPlanned: planned.exercise.prescription_raw ?? '',
      });
    }
    // Drop planned rows the athlete actively removed. The trash on a
    // planned-but-untouched row writes to metadata.removed_set_numbers;
    // we honour that here without renumbering the surviving rows.
    return base.filter(r => !removedSetNumbers.includes(r.setNumber));
  }, [planned.setLines, planned.exercise.unit, planned.exercise.prescription_raw, removedSetNumbers]);
  const setBySetNumber = useMemo(() => {
    const m = new Map<number, TrainingLogSet>();
    loggedSets.forEach(s => m.set(s.set_number, s));
    return m;
  }, [loggedSets]);

  const completedCount = loggedSets.filter(s => s.status === 'completed').length;
  const allCompleted = rows.length > 0 && completedCount >= rows.length;
  const accent = planned.exerciseDef?.color ?? '#3B82F6';

  /** Free-text / "other" prescriptions don't quantify training. The
   *  planned row reuses the standard SetEntryRow chrome but with the
   *  kg + reps cells merged into one read-only cell carrying the coach's
   *  prose; ✓ / ✗ still drive status. Add-set spawns extra rows in the
   *  same merged-cell shape, but with an editable text input so the
   *  athlete can record what they actually did. */
  const isFreeTextUnit = planned.exercise.unit === 'free_text' || planned.exercise.unit === 'other';

  /** Resolve the display name. For combos we prefer the coach's
   *  combo_notation (e.g. "Snatch Complex"), then fall back to
   *  "Member1 + Member2 + ..." — same logic the coach side uses, so
   *  athletes don't see the first member's name as the exercise title. */
  const plannedName = planned.exercise.is_combo
    ? planned.exercise.combo_notation ??
      (planned.comboMembers.length > 0
        ? planned.comboMembers
            .map(m => m.exercise?.name)
            .filter((n): n is string => !!n)
            .join(' + ')
        : planned.exerciseDef?.name) ??
      '(unknown exercise)'
    : planned.exerciseDef?.name ?? '(unknown exercise)';

  // Sentinel exercises (free-text blocks) carry their content in
  // planned.exercise.notes, not in a structured prescription. Render
  // them as an informational note card — no set entry, no checkmarks.
  // GPP sentinel keeps its own interactive GppLogCard (not read-only).
  const sentinelType = getSentinelType(planned.exerciseDef?.exercise_code ?? null);
  if (sentinelType === 'text' || sentinelType === 'image' || sentinelType === 'video') {
    return (
      <div className="space-y-2">
        <SentinelDisplay
          exerciseCode={planned.exerciseDef?.exercise_code}
          notes={planned.exercise.notes}
          metadata={planned.exercise.metadata}
          theme="dark"
        />
        <div className="rounded-xl bg-gray-900 border border-gray-800 px-3 py-2">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => {
              if ((loggedExercise?.performed_notes ?? '') !== notes) {
                void onUpdateNotes(notes);
              }
            }}
            placeholder="Notes on this exercise…"
            rows={2}
            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'gpp') {
    return (
      <GppLogCard
        planned={planned.exercise.metadata?.gpp ?? null}
        loggedExercise={loggedExercise}
        onSave={async section => {
          if (onSaveGppSection) await onSaveGppSection(section);
        }}
        onUpdateNotes={onUpdateNotes}
      />
    );
  }

  const handleLogAsPrescribed = async () => {
    setSavingPrescribed(true);
    try {
      await onLogAsPrescribed(rows);
    } finally {
      setSavingPrescribed(false);
    }
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-3 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-white truncate">
              {performedExercise && performedExercise.id !== planned.exerciseDef?.id
                ? performedExercise.name
                : plannedName}
            </h3>
            {performedExercise && performedExercise.id !== planned.exerciseDef?.id && (
              <span
                className="text-[9px] bg-purple-900/50 text-purple-200 font-medium px-1.5 py-0.5 rounded"
                title={`Substituted for: ${plannedName}`}
              >
                ⇄ for {plannedName}
              </span>
            )}
            {allCompleted && <DoneChip variant="dark" iconOnly size={14} />}
            {globalSaving && (
              <span className="text-[9px] text-blue-400 italic">saving…</span>
            )}
            {planned.exercise.is_combo && (
              <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
                Combo
              </span>
            )}
            {onRequestSubstitute && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onRequestSubstitute();
                }}
                className="p-1 text-gray-500 hover:text-purple-300"
                title="Substitute this exercise"
                aria-label="Substitute exercise"
              >
                <Replace size={12} />
              </button>
            )}
          </div>
          {planned.exercise.is_combo && planned.comboMembers.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {planned.comboMembers.map((m, idx) => (
                <span key={m.exerciseId + idx} className="inline-flex items-center gap-1 text-[10px] text-gray-300">
                  {idx > 0 && <span className="text-gray-600">+</span>}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.exercise?.color ?? '#6b7280' }}
                    aria-hidden
                  />
                  <span>{m.exercise?.name ?? '(unknown)'}</span>
                </span>
              ))}
            </div>
          )}
          <div className="mt-1">
            <StackedNotation
              raw={planned.exercise.prescription_raw}
              unit={planned.exercise.unit}
              isCombo={planned.exercise.is_combo}
            />
          </div>
          {planned.exercise.variation_note && (
            <p className="text-[10px] text-gray-500 italic mt-0.5 truncate">
              {planned.exercise.variation_note}
            </p>
          )}
        </div>
        <div className="text-[10px] text-gray-500 flex-shrink-0 mt-0.5">
          {completedCount}/{rows.length || '—'}
          {expanded ? (
            <ChevronDown size={14} className="inline-block ml-1" />
          ) : (
            <ChevronRight size={14} className="inline-block ml-1" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {rows.length === 0 ? (
            <div className="text-xs text-gray-500 italic py-3 text-center">
              No set lines defined for this exercise
            </div>
          ) : (
            <>
              {!isFreeTextUnit && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleLogAsPrescribed}
                    disabled={savingPrescribed || allCompleted || globalSaving}
                    className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold py-2 rounded-md transition-colors"
                  >
                    {savingPrescribed || globalSaving ? 'Saving…' : allCompleted ? 'All sets complete' : 'Log as prescribed'}
                  </button>
                  {!allCompleted && loggedSets.length > 0 && (
                    <button
                      onClick={onMarkComplete}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-3 rounded-md transition-colors"
                      title="Mark this exercise complete"
                    >
                      Mark complete
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {rows.map(row => {
                  const setLogged = setBySetNumber.get(row.setNumber) ?? null;
                  // Trash is normally available on a planned row: if the
                  // set has been touched we delete the DB row; if it's
                  // untouched we persist a "removed" marker so the row
                  // stays gone after reload.
                  //
                  // Exception: the synthesised free-text planned row IS
                  // the whole exercise — removing it leaves the athlete
                  // with no row at all, no Add-set button, no way back.
                  // Suppress the trash here; the ✗ Not-done button is
                  // the right control for "I didn't do this".
                  const isPlannedFreeTextRow =
                    row.freeTextMode === true && row.freeTextPlanned !== undefined;
                  const onDelete = isPlannedFreeTextRow
                    ? undefined
                    : setLogged && onDeleteSet
                    ? () => onDeleteSet(setLogged.id)
                    : onRemovePlannedSet
                    ? () => onRemovePlannedSet(row.setNumber)
                    : undefined;
                  return (
                    <SetEntryRow
                      key={row.setNumber}
                      input={row}
                      logged={setLogged}
                      onSave={onSaveSet}
                      onDelete={onDelete}
                    />
                  );
                })}
                {/* Extra sets the athlete adds beyond the planned ones.
                    Persisted extras render with their saved values; a
                    single tail blank row appears for each click of
                    "Add set". On save, the blank gets absorbed by the
                    persisted view. */}
                {(() => {
                  const plannedMax = rows.length;
                  const loggedExtraSets = loggedSets
                    .filter(s => s.set_number > plannedMax)
                    .sort((a, b) => a.set_number - b.set_number);
                  const blanks = Math.max(0, extraRows - loggedExtraSets.length);
                  // Last completed values used as placeholder defaults
                  // for new blank rows, so a one-tap "same as last" works.
                  const lastCompleted = [...loggedSets]
                    .filter(s => s.status === 'completed')
                    .sort((a, b) => b.set_number - a.set_number)[0];
                  const defaultLoad = lastCompleted?.performed_load ?? null;
                  const defaultReps = lastCompleted?.performed_reps ?? null;
                  return (
                    <>
                      {loggedExtraSets.map(s => (
                        <SetEntryRow
                          key={`extra-${s.set_number}`}
                          input={{
                            setNumber: s.set_number,
                            plannedRepsText: '—',
                            plannedLoadText: '—',
                            plannedRepsValue: null,
                            plannedLoadValue: null,
                            freeTextMode: isFreeTextUnit,
                          }}
                          logged={s}
                          onSave={onSaveSet}
                          onDelete={onDeleteSet ? () => onDeleteSet(s.id) : undefined}
                        />
                      ))}
                      {Array.from({ length: blanks }).map((_, i) => {
                        const setNumber = plannedMax + loggedExtraSets.length + 1 + i;
                        return (
                          <SetEntryRow
                            key={`blank-${setNumber}`}
                            input={{
                              setNumber,
                              plannedRepsText: defaultReps != null ? String(defaultReps) : '—',
                              plannedLoadText: defaultLoad != null ? String(defaultLoad) : '—',
                              plannedRepsValue: defaultReps,
                              plannedLoadValue: defaultLoad,
                              freeTextMode: isFreeTextUnit,
                            }}
                            logged={null}
                            onSave={onSaveSet}
                            onDelete={() => setExtraRows(n => Math.max(0, n - 1))}
                          />
                        );
                      })}
                    </>
                  );
                })()}
              </div>
              <button
                onClick={() => setExtraRows(n => n + 1)}
                className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-400 hover:text-white py-1.5 border border-dashed border-gray-700 hover:border-gray-500 rounded"
              >
                <Plus size={12} />
                Add set
              </button>
            </>
          )}

          <div className="pt-1">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => {
                if ((loggedExercise?.performed_notes ?? '') !== notes) {
                  void onUpdateNotes(notes);
                }
              }}
              placeholder="Notes on this exercise…"
              rows={2}
              className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

        </div>
      )}
    </div>
  );
}
