/**
 * LogExerciseRow — one paired (planned, actual) row in coach Log mode.
 *
 * Both sides use the canonical StackedNotation visual: planned uses the
 * prescription string, actual reads back the set rows from the log.
 * Off-plan exercises (athlete added them) show only the actual side.
 *
 * Sentinel exercises (exercise_code === 'TEXT' / 'VIDEO' / 'IMAGE') are
 * informational, not logged. Their content lives in planned.notes and
 * we render it as the body of the row, no Plan/Did stack.
 */
import type {
  PlannedExercise,
  Exercise,
  TrainingLogMessage,
  ComboMemberEntry,
} from '../../../lib/database.types';
import type { LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { Trash2, Pencil, MessageSquare } from 'lucide-react';
import { Button } from '../../ui';
import { StackedNotation, LoggedStackedNotation } from '../StackedNotation';
import { getSentinelType } from '../sentinelUtils';
import { SentinelDisplay } from '../SentinelDisplay';
import { computeExerciseSummary, isQuantifiedUnit, isAbsoluteLoadUnit } from './logSummary';
import { PlanActual } from './PlanActual';

interface LogExerciseRowProps {
  planned: (PlannedExercise & { exercise: Exercise }) | null;
  logged: LoggedExerciseFull | null;
  /** Members of a coach-planned combo (`planned.is_combo`). Without them the
   *  row can only name the anchor exercise, which is what a combo used to
   *  render as here. Unsorted is fine — we sort by position. */
  plannedComboMembers?: ComboMemberEntry[];
  /** All session-level messages; the row picks out the ones whose
   *  exercise_id matches its logged.log.id and renders a small comment
   *  badge. Optional because not every caller needs the badge. */
  messages?: TrainingLogMessage[];
  /** Coach-side delete: drops the entire log_exercise + sets. The
   *  parent wraps this in a confirm modal so the handler itself is
   *  synchronous. */
  onDelete?: () => void;
  /** Coach-side inline edit: opens the set-edit modal. */
  onEdit?: () => void;
  /** Coach-side GPP edit: opens the GPP block editor scoped to the log
   *  (rows, reps, load, done checkboxes). Same icon pattern as onEdit
   *  but a different modal. */
  onEditGpp?: () => void;
}

export function LogExerciseRow({
  planned,
  logged,
  plannedComboMembers,
  messages,
  onDelete,
  onEdit,
  onEditGpp,
}: LogExerciseRowProps) {
  const exerciseMessages = logged
    ? (messages ?? []).filter(m => m.exercise_id === logged.log.id)
    : [];

  // Athlete-authored off-plan combination: members + name + colour live on
  // the logged row's metadata.combo (the log schema has no combo columns).
  const offPlanCombo = !planned ? logged?.log.metadata?.combo ?? null : null;
  // Coach-planned combination: same resolution the planner's DayCard uses —
  // the coach's own notation first, else the member names joined.
  const plannedMembers = planned?.is_combo
    ? (plannedComboMembers ?? []).slice().sort((a, b) => a.position - b.position)
    : [];
  const comboName = offPlanCombo
    ? offPlanCombo.name?.trim() ||
      offPlanCombo.members.map(m => m.name).filter(Boolean).join(' + ') ||
      '(combination)'
    : planned?.is_combo
    ? planned.combo_notation?.trim() ||
      plannedMembers.map(m => m.exercise.name).filter(Boolean).join(' + ') ||
      null
    : null;

  // Detect substitution: planned slot exists, athlete logged a
  // different exercise_id. We show the substituted name primarily and
  // a small "↔ for <planned>" chip so the coach immediately sees what
  // the slot was meant for.
  const isSubstituted =
    !!planned &&
    !!logged?.exercise &&
    logged.exercise.id !== planned.exercise.id;
  const exerciseName = comboName
    ? comboName
    : isSubstituted
    ? logged!.exercise!.name
    : planned?.exercise?.name ?? logged?.exercise?.name ?? '(unknown exercise)';
  // Legacy variation_note surfaces only until the folded note (planned.notes,
  // rendered below) takes over.
  const variationNote = planned && !planned.notes?.trim() ? planned.variation_note ?? null : null;
  const accentColor =
    offPlanCombo?.color ??
    (planned?.is_combo ? planned.combo_color ?? plannedMembers[0]?.exercise.color ?? null : null) ??
    (isSubstituted
      ? logged!.exercise!.color
      : planned?.exercise?.color ?? logged?.exercise?.color ?? null);

  // Member chips under the name — one shape for both combo sources so the
  // coach reads a planned and an athlete-added combination the same way.
  const comboDots: Array<{ key: string; name: string; color: string | null }> = offPlanCombo
    ? offPlanCombo.members.map((m, idx) => ({ key: m.exerciseId + idx, name: m.name, color: m.color ?? null }))
    : plannedMembers.map((m, idx) => ({ key: m.exerciseId + idx, name: m.exercise.name, color: m.exercise.color }));

  // Sentinel exercises (free-text blocks, video links, image references)
  // are informational. Their content lives in `notes`, not in
  // `prescription_raw`. For an off-plan (athlete-authored) sentinel there is
  // no planned row, so derive the type and content from the LOGGED row: the
  // note body lives in metadata.text and the GPP section in metadata.gpp.
  const sentinelType = planned
    ? getSentinelType(planned.exercise.exercise_code)
    : getSentinelType(logged?.exercise?.exercise_code ?? null);
  const sentinelExerciseCode = planned
    ? planned.exercise.exercise_code
    : logged?.exercise?.exercise_code ?? null;
  const sentinelNotes = planned ? planned.notes : logged?.log.metadata?.text ?? null;
  const sentinelMetadata = planned
    ? (planned.metadata as Record<string, unknown> | undefined)
    : (logged?.log.metadata as Record<string, unknown> | undefined);
  if (sentinelType === 'text') {
    return (
      <div className="flex border-l-4 border-l-gray-300">
        <div className="flex-1 px-3 py-2 min-w-0">
          {!planned && (
            <span className="text-[9px] bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded mb-1 inline-block">
              Added by athlete
            </span>
          )}
          <SentinelDisplay
            exerciseCode={sentinelExerciseCode}
            notes={sentinelNotes}
            metadata={sentinelMetadata}
            theme="light"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'image') {
    return (
      <div className="flex border-l-4 border-l-pink-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <SentinelDisplay
            exerciseCode={sentinelExerciseCode}
            notes={sentinelNotes}
            metadata={sentinelMetadata}
            theme="light"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'video') {
    return (
      <div className="flex border-l-4 border-l-indigo-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <SentinelDisplay
            exerciseCode={sentinelExerciseCode}
            notes={sentinelNotes}
            metadata={sentinelMetadata}
            theme="light"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'gpp') {
    const plannedGpp = planned?.metadata?.gpp ?? null;
    const athleteGpp = logged?.log.metadata?.gpp ?? null;
    // When the athlete has logged GPP data, show both planned and performed
    // side-by-side so the coach can see what was changed. (UF-05)
    const hasAthleteData = athleteGpp != null;
    // Title/description come from the coach's planned section when one exists,
    // otherwise (off-plan, athlete-authored) from the athlete's own section.
    const isOffPlan = !planned;
    const headerGpp = plannedGpp ?? athleteGpp;
    const displayRows = (athleteGpp ?? plannedGpp)?.rows ?? [];
    const plannedRows = plannedGpp?.rows ?? [];
    const doneCount = displayRows.filter(r => r.done).length;
    return (
      <div className="flex border-l-4 border-l-emerald-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
                {headerGpp?.title || 'GPP'}
              </span>
              {displayRows.length > 0 && (
                <span className="text-[10px] text-gray-500">
                  {doneCount}/{displayRows.length} done
                </span>
              )}
              {isOffPlan ? (
                <span className="text-[9px] bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded ml-1">Added by athlete</span>
              ) : hasAthleteData && (
                <span className="text-[9px] text-blue-600 font-medium ml-1">athlete version</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {onEditGpp && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={<Pencil size={11} />}
                  onClick={onEditGpp}
                  title="Edit GPP rows (toggle done, change reps/load)"
                  aria-label="Edit GPP block"
                />
              )}
              {onDelete && logged && (
                <Button
                  variant="danger"
                  size="sm"
                  iconOnly
                  icon={<Trash2 size={11} />}
                  onClick={onDelete}
                  title="Remove this logged GPP block"
                  aria-label="Delete logged GPP block"
                />
              )}
            </div>
          </div>
          {headerGpp?.description && (
            <p className="text-[11px] text-gray-600 italic mb-1 whitespace-pre-wrap leading-snug">
              {headerGpp.description}
            </p>
          )}
          {displayRows.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">No rows yet</p>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-gray-500">
                  <th className="text-left px-1 py-0.5">Exercise</th>
                  <th className="text-center px-1 py-0.5 w-12">Reps</th>
                  <th className="text-center px-1 py-0.5 w-10">Sets</th>
                  <th className={`text-left px-1 py-0.5 ${hasAthleteData ? 'w-28' : 'w-14'}`}>Load</th>
                  <th className="text-center px-1 py-0.5 w-8">✓</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => {
                  const plannedRow = plannedRows[i];
                  const loadChanged =
                    hasAthleteData &&
                    plannedRow != null &&
                    plannedRow.load !== row.load;
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-1 py-0.5 text-gray-800">{row.exercise}</td>
                      <td className="px-1 py-0.5 text-center text-gray-700 tabular-nums">{row.reps || '—'}</td>
                      <td className="px-1 py-0.5 text-center text-gray-700 tabular-nums">{row.sets}</td>
                      <td className="px-1 py-0.5 text-gray-700">
                        {loadChanged ? (
                          <span className="flex flex-col gap-0 leading-tight">
                            <span className="text-gray-400 line-through text-[9px]">{plannedRow.load || '—'}</span>
                            <span className="text-blue-700 font-medium">{row.load || '—'}</span>
                          </span>
                        ) : (
                          row.load || '—'
                        )}
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <span className={row.done ? 'text-emerald-600' : 'text-gray-300'}>
                          {row.done ? '✓' : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  const summary = computeExerciseSummary(planned, logged);

  // free_text / 'other' / rpe prescriptions carry no quantified set/rep plan,
  // so the Plan/Did compliance strip is pure noise ("Sets —/1  Reps —/0"); the
  // ✓/✗/prose Did row is the complete signal. Off-plan rows have no unit and
  // keep the strip (they're athlete-added kg sets). Only absolute_kg loads are
  // real kilograms, so the Avg/Max kg axes are gated on that.
  const plannedUnit = planned?.unit ?? null;
  const showComplianceStrip = planned ? isQuantifiedUnit(plannedUnit) : true;
  const showLoadAxes = planned ? isAbsoluteLoadUnit(plannedUnit) : true;

  return (
    <div className="flex">
      {accentColor && (
        <div
          className="w-0.5 flex-shrink-0"
          style={{ backgroundColor: accentColor }}
          aria-hidden
        />
      )}
      <div className="flex-1 px-3 py-2 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2 flex-wrap min-w-0">
            <h4 className="text-xs font-bold text-gray-900">{exerciseName}</h4>
            {isSubstituted && (
              <span
                className="text-[9px] bg-purple-100 text-purple-800 font-medium px-1.5 py-0.5 rounded"
                title={`Athlete substituted ${planned?.exercise?.name ?? 'the planned exercise'}`}
              >
                ⇄ for {planned?.exercise?.name}
              </span>
            )}
            {variationNote && (
              <span className="text-[10px] text-gray-500 italic">{variationNote}</span>
            )}
            {(planned?.is_combo || offPlanCombo) && (
              <span className="text-[9px] bg-blue-50 text-blue-700 font-medium px-1.5 py-0.5 rounded">
                Combo
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {exerciseMessages.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-600 font-medium" title={`${exerciseMessages.length} comment${exerciseMessages.length > 1 ? 's' : ''}`}>
                <MessageSquare size={9} />
                {exerciseMessages.length}
              </span>
            )}
            {logged && onEdit && (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<Pencil size={11} />}
                onClick={onEdit}
                title="Edit the athlete's log for this exercise"
                aria-label="Edit log"
              />
            )}
            {onDelete && (
              <Button
                variant="danger"
                size="sm"
                iconOnly
                icon={<Trash2 size={11} />}
                onClick={onDelete}
                title="Remove this logged exercise"
                aria-label="Delete logged exercise"
              />
            )}
          </div>
        </div>

        {/* Combo member dots. Off-plan combos read them from the log's
            metadata.combo (the log schema has no combo join); coach-planned
            combos get them from planned_exercise_combo_members. */}
        {comboDots.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {comboDots.map((m, idx) => (
              <span key={m.key} className="inline-flex items-center gap-1 text-[10px] text-gray-600">
                {idx > 0 && <span className="text-gray-400">+</span>}
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: m.color ?? '#9ca3af' }}
                  aria-hidden
                />
                <span>{m.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Coach note above the Plan/Did comparison — it qualifies the
            variation, so it reads before the numbers here too. */}
        {planned?.notes?.trim() && (
          <p className="text-[10px] text-gray-600 italic mt-1 whitespace-pre-wrap">
            <span className="text-gray-400 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">Note</span>
            {planned.notes}
          </p>
        )}

        {/* Planned row */}
        {planned ? (
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-gray-400 uppercase text-[9px] tracking-wide flex-shrink-0">
              Plan
            </span>
            <StackedNotation
              raw={planned.prescription_raw}
              unit={planned.unit}
              isCombo={planned.is_combo}
            />
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 italic mt-1">
            Added by athlete · not on plan
          </div>
        )}

        {/* Actual row */}
        {logged ? (
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-gray-400 uppercase text-[9px] tracking-wide flex-shrink-0">
              Did
            </span>
            <LoggedStackedNotation sets={logged.sets} />
            {logged.log.technique_rating != null && (
              <span className="text-[10px] text-gray-500">
                tech {logged.log.technique_rating}/5
              </span>
            )}
          </div>
        ) : planned ? (
          <div className="text-[11px] text-gray-400 italic mt-0.5">Not logged</div>
        ) : null}

        {/* Plan vs Did summary — replaces the previous DoneChip + delta-% chip.
            Suppressed entirely for non-quantified units; load axes hidden for
            non-kg units (see showComplianceStrip / showLoadAxes above). */}
        {(logged || planned) && showComplianceStrip && (
          <div className="mt-1.5 flex items-baseline gap-x-4 gap-y-1 flex-wrap">
            <PlanActual label="Sets" metric={summary.sets} />
            <PlanActual label="Reps" metric={summary.reps} />
            {showLoadAxes && (
              <>
                <PlanActual label="Avg" metric={summary.avgLoad} unit="kg" decimals={0} />
                <PlanActual label="Max" metric={summary.maxLoad} unit="kg" decimals={0} />
              </>
            )}
          </div>
        )}

        {logged?.log.performed_notes && (
          <p className="text-[10px] text-gray-500 italic mt-1 whitespace-pre-wrap">
            <span className="text-gray-400 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">Athlete</span>
            {logged.log.performed_notes}
          </p>
        )}
      </div>
    </div>
  );
}

