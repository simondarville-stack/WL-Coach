/**
 * SessionPreview — read-only "day overview" mirroring the coach Log view.
 *
 * Shows, for each planned exercise, what was planned (stacked notation)
 * and what was actually logged (stacked notation from training_log_sets).
 * Off-plan additions appear under "Added by you", same shape as the
 * coach's "Added by athlete" section. Sentinel free-text blocks render
 * their notes verbatim.
 *
 * Reads the shared StackedNotation / LoggedStackedNotation components
 * so the visual is identical to the coach side (different theme tokens).
 * "Start logging" enters edit mode.
 */
import { PlayCircle, MessageSquare } from 'lucide-react';
import { DoneChip } from '../../../components/log/DoneChip';
import type { PlannedExercise, Exercise, ExerciseStub, TrainingLogSet } from '../../../lib/database.types';
import type { PlannedExerciseFull } from '../../../lib/trainingLogService';
import type { DayLog, LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { computeDelta, sumPerformedReps } from '../../../lib/trainingLogModel';
import { computePrescriptionSummary } from '../../../lib/prescriptionParser';
import { StackedNotation, LoggedStackedNotation } from '../../../components/planner/StackedNotation';
import { getSentinelType } from '../../../components/planner/sentinelUtils';
import { SentinelDisplay } from '../../../components/planner/SentinelDisplay';
import { formatWeekdayDateLong } from '../../../lib/dateUtils';

interface SessionPreviewProps {
  slotLabel: string;
  weekdayLabel: string | null;
  date: string;
  planned: PlannedExerciseFull[];
  log: DayLog | null;
  onStart: () => void;
  isBonus?: boolean;
  /** When true, hides the coach-message reply CTA and the bottom
   *  Start/Continue/View-in-log button. Used by the group viewer where
   *  there is no athlete profile to log against. */
  readOnly?: boolean;
}

// Binary states: only "Done" surfaces. Everything else renders no pill.

export function SessionPreview({
  slotLabel,
  weekdayLabel,
  date,
  planned,
  log,
  onStart,
  isBonus,
  readOnly = false,
}: SessionPreviewProps) {
  const prettyDate = formatWeekdayDateLong(date);
  const session = log?.session ?? null;
  const status = session?.status ?? 'pending';

  // Split logged exercises by planned link
  const loggedByPlannedId = new Map<string, LoggedExerciseFull>();
  const offPlan: LoggedExerciseFull[] = [];
  (log?.exercises ?? []).forEach(le => {
    if (le.log.planned_exercise_id) loggedByPlannedId.set(le.log.planned_exercise_id, le);
    else offPlan.push(le);
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-base font-bold text-white">{slotLabel}</h2>
              {weekdayLabel && (
                <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  {weekdayLabel}
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">{prettyDate}</p>
            {isBonus && (
              <p className="text-[10px] text-amber-300 italic mt-1">Extra training day</p>
            )}
          </div>
          {status === 'completed' && <DoneChip variant="dark" />}
        </div>

        {session && (
          <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-wrap mt-2 pt-2 border-t border-gray-800/60">
            {session.bodyweight_kg != null && (
              <span><span className="text-gray-500">BW</span> {session.bodyweight_kg.toFixed(1)} kg</span>
            )}
            {session.raw_total != null && (
              <span title="RAW readiness (Eleiko): sum of 4 pillars rated 1–3, range 4–12">
                <span className="text-gray-500">RAW</span> {session.raw_total}/12
              </span>
            )}
            {session.duration_minutes != null && (
              <span><span className="text-gray-500">⏱</span> {session.duration_minutes}m</span>
            )}
          </div>
        )}

        {session?.session_notes?.trim() && (
          <p className="text-[11px] text-gray-300 italic mt-2 pt-2 border-t border-gray-800/60 whitespace-pre-wrap">
            {session.session_notes}
          </p>
        )}
      </div>

      {planned.length === 0 && offPlan.length === 0 ? (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
          <p className="text-sm text-gray-300 font-semibold">
            {isBonus ? 'Nothing logged yet' : 'No exercises in this slot'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {isBonus
              ? 'Tap "Start logging" to add what you did.'
              : 'Pick another day or check with your coach.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
          <ul className="divide-y divide-gray-800/60">
            {planned.map(p => (
              <PreviewExerciseRow
                key={p.exercise.id}
                planned={p}
                logged={loggedByPlannedId.get(p.exercise.id) ?? null}
                readOnly={readOnly}
              />
            ))}
            {offPlan.length > 0 && (
              <li>
                <div className="px-3 py-1.5 bg-amber-950/40 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  Added by you
                </div>
                <ul className="divide-y divide-gray-800/60">
                  {offPlan.map(le => (
                    <PreviewOffPlanRow key={le.log.id} logged={le} />
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </div>
      )}

      {(() => {
        if (readOnly) return null;
        const sessionMessages = (log?.messages ?? []).filter(m => !m.exercise_id);
        const coachMessages = sessionMessages.filter(m => m.sender_type === 'coach');
        if (coachMessages.length === 0) return null;
        const latest = coachMessages[coachMessages.length - 1];
        return (
          <button
            onClick={onStart}
            className="w-full rounded-xl bg-blue-950/50 border border-blue-800/40 px-4 py-3 text-left hover:bg-blue-950/80 transition-colors"
            title="Tap to reply"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <MessageSquare size={11} className="text-blue-400 flex-shrink-0" />
              <span className="text-[10px] text-blue-300 font-semibold uppercase tracking-wide">
                Coach left {coachMessages.length} message{coachMessages.length > 1 ? 's' : ''}
              </span>
              <span className="text-[9px] text-blue-400 ml-auto">Tap to reply</span>
            </div>
            <p className="text-xs text-blue-200 italic whitespace-pre-wrap leading-snug line-clamp-2">
              {latest.message}
            </p>
          </button>
        );
      })()}

      {!readOnly && (
        <button
          onClick={onStart}
          className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
        >
          <PlayCircle size={18} />
          {status === 'completed'
            ? 'View in log'
            : log?.session
            ? 'Continue logging'
            : 'Start logging'}
        </button>
      )}
    </div>
  );
}

function PreviewExerciseRow({
  planned,
  logged,
  readOnly = false,
}: {
  planned: PlannedExerciseFull;
  logged: LoggedExerciseFull | null;
  readOnly?: boolean;
}) {
  const sentinel = getSentinelType(planned.exerciseDef?.exercise_code ?? null);
  if (sentinel === 'text' || sentinel === 'image' || sentinel === 'video' || sentinel === 'gpp') {
    return (
      <li className="px-4 py-3">
        <SentinelDisplay
          exerciseCode={planned.exerciseDef?.exercise_code}
          notes={planned.exercise.notes}
          metadata={planned.exercise.metadata as Record<string, unknown> | undefined}
          athleteGpp={sentinel === 'gpp' ? (logged?.log.metadata?.gpp ?? null) : undefined}
          theme="dark"
        />
      </li>
    );
  }
  const accent = planned.exerciseDef?.color ?? '#6b7280';
  const performedReps = logged ? sumPerformedReps(logged.sets) : 0;
  // Compliance divides by the planned reps. Fall back to a live parse of the
  // prescription when the cached summary is stale-zero, so the percentage is
  // not wrongly 0% for an exercise whose cache never got recomputed.
  const cachedPlannedReps = planned.exercise.summary_total_reps ?? 0;
  const plannedReps = cachedPlannedReps > 0
    ? cachedPlannedReps
    : computePrescriptionSummary(
        planned.exercise.prescription_raw ?? '',
        planned.exercise.unit,
        planned.exercise.is_combo,
      ).total_reps;
  const delta = computeDelta(plannedReps || null, performedReps, !!logged);
  const allCompleted =
    logged != null && logged.sets.length > 0 && logged.sets.every(s => s.status === 'completed');

  return (
    <li className="flex gap-3 px-4 py-3">
      <div
        className="w-1 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-white">
            {planned.exercise.is_combo
              ? planned.exercise.combo_notation ??
                (planned.comboMembers.length > 0
                  ? planned.comboMembers
                      .map(m => m.exercise?.name)
                      .filter((n): n is string => !!n)
                      .join(' + ')
                  : planned.exerciseDef?.name) ??
                '(unknown exercise)'
              : planned.exerciseDef?.name ?? '(unknown exercise)'}
          </h3>
          {planned.exercise.variation_note && (
            <span className="text-[11px] text-gray-400 italic">
              {planned.exercise.variation_note}
            </span>
          )}
          {/* Redundant with the member-dot list below; keep only as a fallback
              when there are no members to list. */}
          {planned.exercise.is_combo && planned.comboMembers.length === 0 && (
            <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
              Combo
            </span>
          )}
          {allCompleted && <DoneChip variant="dark" iconOnly size={13} />}
        </div>

        {planned.exercise.is_combo && planned.comboMembers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
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

        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold w-7 flex-shrink-0">
            Plan
          </span>
          <StackedNotation
            raw={planned.exercise.prescription_raw}
            unit={planned.exercise.unit}
            isCombo={planned.exercise.is_combo}
          />
        </div>

        {!readOnly && (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold w-7 flex-shrink-0">
              Did
            </span>
            {logged ? (
              <>
                <LoggedStackedNotation sets={logged.sets} />
                {delta.state !== 'pending' && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      delta.state === 'matched'
                        ? 'bg-emerald-900/40 text-emerald-300'
                        : delta.state === 'amber'
                        ? 'bg-amber-900/40 text-amber-300'
                        : 'bg-red-900/40 text-red-300'
                    }`}
                  >
                    {Math.round(delta.ratio * 100)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-gray-500 italic">Not logged</span>
            )}
          </div>
        )}

        {planned.exercise.notes?.trim() && (
          <p className="text-[11px] text-gray-400 italic whitespace-pre-wrap leading-snug">
            {planned.exercise.notes}
          </p>
        )}
        {logged?.log.performed_notes?.trim() && (
          <p className="text-[11px] text-gray-300 italic whitespace-pre-wrap leading-snug">
            <span className="text-gray-500 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">
              You
            </span>
            {logged.log.performed_notes}
          </p>
        )}
      </div>
    </li>
  );
}

function PreviewOffPlanRow({ logged }: { logged: LoggedExerciseFull }) {
  // logged.exercise can be a full Exercise or an ExerciseStub (id/name/color
  // only) right after an off-plan insert. The downstream display fields read
  // name + color, both of which are on the stub, so widen the receiver.
  const ex: Exercise | ExerciseStub | null = logged.exercise;

  // Athlete-authored note / GPP block: render read-only via SentinelDisplay,
  // sourcing the body from the log row's metadata (no planned row exists).
  const sentinel = getSentinelType(ex?.exercise_code ?? null);
  if (sentinel === 'text' || sentinel === 'gpp') {
    return (
      <li className="px-4 py-3">
        <SentinelDisplay
          exerciseCode={ex?.exercise_code}
          notes={logged.log.metadata?.text ?? null}
          metadata={logged.log.metadata as Record<string, unknown> | undefined}
          athleteGpp={sentinel === 'gpp' ? (logged.log.metadata?.gpp ?? null) : undefined}
          theme="dark"
        />
      </li>
    );
  }

  // Athlete-authored combination: name + member dots from metadata.combo.
  const combo = logged.log.metadata?.combo ?? null;
  const accent = combo?.color ?? ex?.color ?? '#6b7280';
  const name = combo
    ? combo.name?.trim() ||
      combo.members.map(m => m.name).filter(Boolean).join(' + ') ||
      '(combination)'
    : ex?.name ?? '(unknown exercise)';
  const completedSets = logged.sets.filter((s: TrainingLogSet) => s.status === 'completed');
  return (
    <li className="flex gap-3 px-4 py-3">
      <div
        className="w-1 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-white">{name}</h3>
          {combo && (
            <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
              Combo
            </span>
          )}
        </div>
        {combo && combo.members.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {combo.members.map((m, idx) => (
              <span key={m.exerciseId + idx} className="inline-flex items-center gap-1 text-[10px] text-gray-300">
                {idx > 0 && <span className="text-gray-600">+</span>}
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: m.color ?? '#6b7280' }}
                  aria-hidden
                />
                <span>{m.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold w-7 flex-shrink-0">
            Did
          </span>
          {logged.sets.length === 0 ? (
            <span className="text-[11px] text-gray-500 italic">No sets yet</span>
          ) : (
            <LoggedStackedNotation sets={logged.sets} />
          )}
          {completedSets.length > 0 && (
            <span className="text-[10px] text-gray-500">
              {completedSets.length}/{logged.sets.length} done
            </span>
          )}
        </div>
        {logged.log.performed_notes?.trim() && (
          <p className="text-[11px] text-gray-300 italic whitespace-pre-wrap leading-snug">
            {logged.log.performed_notes}
          </p>
        )}
      </div>
    </li>
  );
}

// PlannedExercise type re-export keeps callers' imports tidy.
export type { PlannedExercise };
