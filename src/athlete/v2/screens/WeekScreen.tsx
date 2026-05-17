/**
 * WeekScreen — week-at-a-glance for the athlete.
 *
 * Reuses fetchWeekOverview, renders one card per active day with the
 * weekday, label, status pill, planned exercise count, and (if logged)
 * the calendar date the session was performed on. Tapping a card
 * navigates to /athlete/today with ?week=…&slot=… so TodayScreen
 * opens directly on that planned slot.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import {
  fetchWeekOverview,
  type WeekOverview,
} from '../../../lib/trainingLogService';
import { WeekNavigator, Weekday } from '../components/WeekNavigator';
import { getMondayOfWeekISO } from '../../../lib/weekUtils';
import { Loader2, ChevronRight } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-gray-800 text-gray-400',
  in_progress: 'bg-amber-900/50 text-amber-300',
  completed: 'bg-emerald-900/50 text-emerald-300',
  skipped: 'bg-red-900/50 text-red-300',
};

export function WeekScreen() {
  const { athlete } = useAuth();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState<string>(() => getMondayOfWeekISO(new Date()));
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!athlete) return;
    setLoading(true);
    setError(null);
    try {
      const w = await fetchWeekOverview(athlete.id, weekStart);
      setOverview(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [athlete, weekStart]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    if (!overview) return { done: 0, total: 0 };
    return {
      done: overview.days.filter(d => d.status === 'completed').length,
      total: overview.days.length,
    };
  }, [overview]);

  if (!athlete) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
      <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />

      {!loading && !error && overview && overview.days.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-[11px] text-gray-500">
            {totals.done}/{totals.total} sessions done
          </p>
          {overview.planSource === 'group' && (
            <p className="text-[10px] text-gray-500 italic">Group plan</p>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 size={18} className="animate-spin mr-2" />
          <span className="text-sm">Loading week…</span>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
          <div className="font-semibold">Failed to load</div>
          <div className="mt-1 break-all">{error}</div>
        </div>
      )}

      {!loading && !error && overview && overview.days.length === 0 && (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
          <p className="text-sm text-gray-300 font-semibold">No plan for this week</p>
          <p className="text-xs text-gray-500 mt-1">
            Your coach hasn't written a plan yet. Try the previous or next week.
          </p>
        </div>
      )}

      {!loading && !error && overview && overview.days.length > 0 && (
        <ul className="space-y-2">
          {overview.days.map(day => {
            const weekdayLabel = day.weekday != null ? Weekday[day.weekday] : null;
            const performed = day.sessionDate
              ? new Date(day.sessionDate + 'T00:00:00').toLocaleDateString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric',
                })
              : null;
            return (
              <li key={day.dayIndex}>
                <button
                  onClick={() =>
                    navigate(`/athlete/today?week=${weekStart}&slot=${day.dayIndex}`)
                  }
                  className="w-full flex items-center gap-3 px-3 py-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-600 transition-colors text-left"
                >
                  <div className="flex flex-col items-center flex-shrink-0 w-12">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                      {weekdayLabel ?? '—'}
                    </span>
                    <span className="text-lg font-bold text-white leading-none mt-0.5">
                      {day.dayIndex}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{day.label}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span
                        className={`text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${
                          STATUS_CLASS[day.status] ?? STATUS_CLASS.pending
                        }`}
                      >
                        {STATUS_LABEL[day.status] ?? day.status}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {day.plannedCount > 0
                          ? `${day.plannedCount} exercise${day.plannedCount > 1 ? 's' : ''}`
                          : 'no plan'}
                      </span>
                      {performed && (
                        <span className="text-[10px] text-gray-500">
                          · logged {performed}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-gray-600 flex-shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
