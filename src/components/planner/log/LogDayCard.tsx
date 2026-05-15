/**
 * LogDayCard — one day in coach Log mode.
 *
 * Header shows session status, BW, RAW total, session RPE, and a comment
 * count. Body pairs each planned exercise with its logged counterpart;
 * off-plan exercises (athlete added them) appear at the bottom under a
 * label.
 */
import type { PlannedExercise, Exercise } from '../../../lib/database.types';
import type { DayLog, LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { LogExerciseRow } from './LogExerciseRow';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-red-100 text-red-800',
};

interface LogDayCardProps {
  dayName: string;
  plannedExercises: (PlannedExercise & { exercise: Exercise })[];
  dayLog: DayLog | null;
}

export function LogDayCard({ dayName, plannedExercises, dayLog }: LogDayCardProps) {
  const session = dayLog?.session ?? null;
  const status = session?.status ?? 'pending';

  const loggedByPlannedId = new Map<string, LoggedExerciseFull>();
  const offPlan: LoggedExerciseFull[] = [];
  (dayLog?.exercises ?? []).forEach(le => {
    if (le.log.planned_exercise_id) {
      loggedByPlannedId.set(le.log.planned_exercise_id, le);
    } else {
      offPlan.push(le);
    }
  });

  const sortedPlanned = plannedExercises
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const sessionCommentCount = dayLog?.messages.filter(m => !m.exercise_id).length ?? 0;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-3">
      <div className="flex items-center justify-between bg-gray-50 border-b border-gray-200 px-3 py-2 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{dayName}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_CLASS[status] ?? STATUS_CLASS.pending}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>
        {session && (
          <div className="flex items-center gap-3 text-[11px] text-gray-600 flex-wrap">
            {session.bodyweight_kg != null && (
              <span><span className="text-gray-400">BW</span> {session.bodyweight_kg.toFixed(1)} kg</span>
            )}
            {session.raw_total != null && (
              <span><span className="text-gray-400">RAW</span> {session.raw_total}/12</span>
            )}
            {session.session_rpe != null && (
              <span><span className="text-gray-400">sRPE</span> {session.session_rpe}</span>
            )}
            {session.duration_minutes != null && (
              <span><span className="text-gray-400">⏱</span> {session.duration_minutes}m</span>
            )}
            {sessionCommentCount > 0 && (
              <span>💬 {sessionCommentCount}</span>
            )}
          </div>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {sortedPlanned.length === 0 && offPlan.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 italic text-center">
            No exercises planned or logged
          </div>
        )}

        {sortedPlanned.map(ex => (
          <LogExerciseRow
            key={ex.id}
            planned={ex}
            logged={loggedByPlannedId.get(ex.id) ?? null}
            sessionMessages={dayLog?.messages ?? []}
          />
        ))}

        {offPlan.length > 0 && (
          <>
            <div className="px-3 py-1.5 bg-amber-50 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Added by athlete
            </div>
            {offPlan.map(le => (
              <LogExerciseRow
                key={le.log.id}
                planned={null}
                logged={le}
                sessionMessages={dayLog?.messages ?? []}
              />
            ))}
          </>
        )}
      </div>

      {session?.session_notes?.trim() && (
        <div className="border-t border-gray-100 px-3 py-2 bg-amber-50/50">
          <p className="text-[11px] text-gray-700 italic whitespace-pre-wrap leading-relaxed">
            <span className="text-gray-400 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">Notes</span>
            {session.session_notes}
          </p>
        </div>
      )}
    </div>
  );
}
