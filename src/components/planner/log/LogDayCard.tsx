/**
 * LogDayCard — one day in coach Log mode.
 *
 * Header shows session status, BW, RAW total, session RPE, and a comment
 * count. Body pairs each planned exercise with its logged counterpart;
 * off-plan exercises (athlete added them) appear at the bottom under a
 * label. Coach comments live in a collapsible session-level thread at
 * the bottom.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare, Trash2 } from 'lucide-react';
import type { PlannedExercise, Exercise } from '../../../lib/database.types';
import type { DayLog, LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { LogExerciseRow } from './LogExerciseRow';
import { LogCommentsThread } from './LogCommentsThread';
import { computeDaySummary, computeExerciseSummary } from './logSummary';
import { PlanActual } from './PlanActual';

interface LogDayCardProps {
  dayName: string;
  plannedExercises: (PlannedExercise & { exercise: Exercise })[];
  dayLog: DayLog | null;
  /** Returns true when the post succeeded so callers can refresh data. */
  onPostSessionComment?: (sessionId: string, body: string) => Promise<void>;
  /** Coach actions: delete a logged exercise or the whole session. */
  onDeleteLogExercise?: (logExerciseId: string) => Promise<void>;
  onDeleteSession?: (sessionId: string) => Promise<void>;
  /** Coach action: open the inline set editor for one logged exercise. */
  onEditLoggedExercise?: (logged: LoggedExerciseFull) => void;
  /** Coach action: open the GPP editor for one planned-GPP slot. Routed
   *  up to LogModeView, which renders GppBlockEditor in log-fix mode and
   *  saves via ensureLogExercise + setLogExerciseGppSection. */
  onEditGppExercise?: (args: {
    planned: PlannedExercise & { exercise: Exercise };
    logged: LoggedExerciseFull | null;
  }) => void;
}

export function LogDayCard({
  dayName,
  plannedExercises,
  dayLog,
  onPostSessionComment,
  onDeleteLogExercise,
  onDeleteSession,
  onEditLoggedExercise,
  onEditGppExercise,
}: LogDayCardProps) {
  const session = dayLog?.session ?? null;
  const [threadOpen, setThreadOpen] = useState(false);
  // Default collapsed so the week list scans easily for a roster. The
  // coach clicks any header to drill into a day.
  const [collapsed, setCollapsed] = useState(true);

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

  const sessionMessages = (dayLog?.messages ?? []).filter(m => !m.exercise_id);
  const sessionCommentCount = sessionMessages.length;

  const performedDate = session?.date ?? null;
  const performedLabel = performedDate
    ? new Date(performedDate + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : null;

  const canComment = !!session && !!onPostSessionComment;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-3">
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center justify-between bg-gray-50 ${collapsed ? '' : 'border-b border-gray-200'} px-3 py-2 flex-wrap gap-2 text-left hover:bg-gray-100 transition-colors`}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {collapsed ? (
            <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          )}
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{dayName}</h3>
          {performedLabel && (
            <span className="text-[10px] text-gray-500">
              logged <span className="text-gray-700">{performedLabel}</span>
            </span>
          )}
          {collapsed && sortedPlanned.length + offPlan.length > 0 && (
            <span className="text-[10px] text-gray-500">
              {sortedPlanned.length + offPlan.length} ex.
            </span>
          )}
        </div>
        {session && (
          <div className="flex items-center gap-3 text-[11px] text-gray-600 flex-wrap">
            {session.bodyweight_kg != null && (
              <span><span className="text-gray-400">BW</span> {session.bodyweight_kg.toFixed(1)} kg</span>
            )}
            {session.raw_total != null && (
              <span><span className="text-gray-400">RAW</span> {session.raw_total}/12</span>
            )}
            {/* sRPE hidden until athlete input is added (Q-10 / UF-20) */}
            {session.duration_minutes != null && (
              <span><span className="text-gray-400">⏱</span> {session.duration_minutes}m</span>
            )}
            {sessionCommentCount > 0 && (
              <span><MessageSquare size={10} className="inline-block mr-0.5" />{sessionCommentCount}</span>
            )}
          </div>
        )}
      </button>

      {!collapsed && (
      <>
      {(() => {
        const exerciseSummaries = [
          ...sortedPlanned.map(ex => computeExerciseSummary(ex, loggedByPlannedId.get(ex.id) ?? null)),
          ...offPlan.map(le => computeExerciseSummary(null, le)),
        ];
        if (exerciseSummaries.length === 0) return null;
        const day = computeDaySummary(exerciseSummaries);
        return (
          <div className="px-3 py-1.5 border-b border-gray-100 flex items-baseline gap-x-4 gap-y-1 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mr-1">
              Day total
            </span>
            <PlanActual label="Sets" metric={day.sets} />
            <PlanActual label="Reps" metric={day.reps} />
            <PlanActual label="Avg" metric={day.avgLoad} unit="kg" decimals={0} />
            <PlanActual label="Max" metric={day.maxLoad} unit="kg" decimals={0} />
          </div>
        );
      })()}
      <div className="divide-y divide-gray-100">
        {sortedPlanned.length === 0 && offPlan.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 italic text-center">
            No exercises planned or logged
          </div>
        )}

        {sortedPlanned.map(ex => {
          const ledg = loggedByPlannedId.get(ex.id) ?? null;
          return (
            <LogExerciseRow
              key={ex.id}
              planned={ex}
              logged={ledg}
              messages={dayLog?.messages}
              onEdit={ledg && onEditLoggedExercise ? () => onEditLoggedExercise(ledg) : undefined}
              onDelete={
                ledg && onDeleteLogExercise
                  ? () => onDeleteLogExercise(ledg.log.id)
                  : undefined
              }
              onEditGpp={
                onEditGppExercise
                  ? () => onEditGppExercise({ planned: ex, logged: ledg })
                  : undefined
              }
            />
          );
        })}

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
                messages={dayLog?.messages}
                onDelete={
                  onDeleteLogExercise ? () => onDeleteLogExercise(le.log.id) : undefined
                }
                onEdit={onEditLoggedExercise ? () => onEditLoggedExercise(le) : undefined}
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

      {canComment && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setThreadOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-gray-600 hover:bg-gray-50"
            aria-expanded={threadOpen}
          >
            <span className="flex items-center gap-1.5">
              <MessageSquare size={11} />
              Session comments{sessionCommentCount > 0 ? ` (${sessionCommentCount})` : ''}
            </span>
            {threadOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {threadOpen && session && onPostSessionComment && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50">
              <LogCommentsThread
                messages={sessionMessages}
                onPost={body => onPostSessionComment(session.id, body)}
              />
            </div>
          )}
        </div>
      )}

      {session && onDeleteSession && (
        <div className="border-t border-gray-100 px-3 py-1.5 bg-gray-50/50 text-right">
          <button
            onClick={() => onDeleteSession(session.id)}
            className="inline-flex items-center gap-1 text-[10px] text-red-600 hover:text-red-800"
            title="Delete this athlete's entire session for the day"
          >
            <Trash2 size={10} />
            Delete session
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
}
