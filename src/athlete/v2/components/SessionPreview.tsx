/**
 * SessionPreview — print-view-style read-only preview of a session.
 *
 * No inputs, no editing. Each planned exercise shows: name + variation
 * note + stacked prescription notation + planned notes. Sentinel
 * text-blocks render their notes verbatim. Mirrors the coach's print
 * weekly programme look so the athlete sees the same shape before
 * stepping into edit mode to log.
 */
import { PlayCircle } from 'lucide-react';
import type { PlannedExerciseFull } from '../../../lib/trainingLogService';
import { StackedNotation } from '../../../components/planner/StackedNotation';
import { getSentinelType } from '../../../components/planner/plannerUtils';

interface SessionPreviewProps {
  slotLabel: string;
  weekdayLabel: string | null;
  date: string;
  planned: PlannedExerciseFull[];
  onStart: () => void;
  /** Optional bonus-mode hint when there is no plan at all. */
  isBonus?: boolean;
}

export function SessionPreview({
  slotLabel,
  weekdayLabel,
  date,
  planned,
  onStart,
  isBonus,
}: SessionPreviewProps) {
  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
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

      {planned.length === 0 ? (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
          <p className="text-sm text-gray-300 font-semibold">
            {isBonus ? 'Nothing planned' : 'No exercises in this slot'}
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
            {planned.map(p => {
              const sentinel = getSentinelType(p.exerciseDef?.exercise_code ?? null);
              if (sentinel === 'text') {
                return (
                  <li key={p.exercise.id} className="px-4 py-3">
                    <p className="text-sm text-gray-200 italic whitespace-pre-wrap leading-relaxed">
                      {p.exercise.notes || '(empty note)'}
                    </p>
                  </li>
                );
              }
              const accent = p.exerciseDef?.color ?? '#6b7280';
              return (
                <li key={p.exercise.id} className="flex gap-3 px-4 py-3">
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-white">
                        {p.exerciseDef?.name ?? '(unknown exercise)'}
                      </h3>
                      {p.exercise.variation_note && (
                        <span className="text-[11px] text-gray-400 italic">
                          {p.exercise.variation_note}
                        </span>
                      )}
                      {p.exercise.is_combo && (
                        <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
                          Combo
                        </span>
                      )}
                    </div>
                    <StackedNotation
                      raw={p.exercise.prescription_raw}
                      unit={p.exercise.unit}
                      isCombo={p.exercise.is_combo}
                    />
                    {p.exercise.notes?.trim() && (
                      <p className="text-[11px] text-gray-400 italic whitespace-pre-wrap leading-snug pt-0.5">
                        {p.exercise.notes}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        onClick={onStart}
        className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
      >
        <PlayCircle size={18} />
        Start logging
      </button>
    </div>
  );
}
