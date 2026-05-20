/**
 * WeekScreen — week-at-a-glance for the athlete.
 *
 * Renders one card per active day with the weekday, label, status pill,
 * planned exercise count and (if logged) the calendar date the session
 * was performed on. Tapping a card EXPANDS it inline: a read-only
 * SessionPreview drops in showing what was planned and what was logged
 * for that day. "Start logging" inside the expanded panel is the only
 * affordance that navigates to TodayScreen for actual editing.
 *
 * Below the list, "Add Training Day" lets the athlete log an extra
 * session this week. The button used to live on TodayScreen — moved
 * here so Week stays purely an overview and Today is just the editor
 * for one chosen day.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import {
  fetchWeekOverview,
  fetchAthleteDay,
  createBonusSession,
  setAthleteDayLabel,
  type WeekOverview,
  type AthleteDayData,
} from '../../../lib/trainingLogService';
import { WeekNavigator, Weekday } from '../components/WeekNavigator';
import { SessionPreview } from '../components/SessionPreview';
import { BonusDayNameModal } from '../components/BonusDayNameModal';
import { getMondayOfWeekISO } from '../../../lib/weekUtils';
import { Loader2, ChevronDown, ChevronRight, Plus } from 'lucide-react';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WeekScreen() {
  const { athlete } = useAuth();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState<string>(() => getMondayOfWeekISO(new Date()));
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Day-expansion state. dayCache is keyed by dayIndex and survives
  // collapse so re-opening doesn't refetch. dayLoading marks in-flight
  // fetches so the panel can show a spinner.
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [dayCache, setDayCache] = useState<Record<number, AthleteDayData>>({});
  const [dayLoading, setDayLoading] = useState<Set<number>>(new Set());

  const [showBonusName, setShowBonusName] = useState(false);
  const [bonusSaving, setBonusSaving] = useState(false);

  const load = useCallback(async () => {
    if (!athlete) return;
    setLoading(true);
    setError(null);
    try {
      const w = await fetchWeekOverview(athlete.id, weekStart);
      setOverview(w);
      // Drop any cached day data — overview reload usually means the
      // user moved to a different week or the data shape changed.
      setDayCache({});
      setExpandedDays(new Set());
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

  const nextBonusDayIndex = useMemo(() => {
    if (!overview) return null;
    const all = [...overview.days.map(d => d.dayIndex), ...overview.activeDays];
    return all.length > 0 ? Math.max(...all) + 1 : 1;
  }, [overview]);

  const defaultBonusName = useMemo(() => {
    if (!overview) return 'Extra 1';
    const bonusCount = overview.days.filter(d => d.isBonus).length + 1;
    return `Extra ${bonusCount}`;
  }, [overview]);

  const toggleDay = async (dayIndex: number) => {
    if (!athlete) return;
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dayIndex)) next.delete(dayIndex);
      else next.add(dayIndex);
      return next;
    });
    if (!expandedDays.has(dayIndex) && !(dayIndex in dayCache)) {
      setDayLoading(prev => new Set(prev).add(dayIndex));
      try {
        const data = await fetchAthleteDay(athlete.id, weekStart, dayIndex);
        setDayCache(prev => ({ ...prev, [dayIndex]: data }));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[WeekScreen] failed to load day', dayIndex, e);
      } finally {
        setDayLoading(prev => {
          const n = new Set(prev);
          n.delete(dayIndex);
          return n;
        });
      }
    }
  };

  const handleConfirmBonusDay = async (name: string) => {
    if (!athlete || nextBonusDayIndex == null) return;
    const dayIdx = nextBonusDayIndex;
    setBonusSaving(true);
    setError(null);
    try {
      await createBonusSession({
        athleteId: athlete.id,
        ownerId: athlete.owner_id,
        weekStart,
        dayIndex: dayIdx,
        date: todayISO(),
      });
      try {
        await setAthleteDayLabel({ athleteId: athlete.id, weekStart, dayIndex: dayIdx, label: name });
      } catch (e) {
        // Non-fatal: session was created; show the error but continue.
        setError(`Session created, but label could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      }
      setShowBonusName(false);
      // Reload the overview, then jump into the new day in Today so the
      // athlete can start logging immediately.
      await load();
      navigate(`/athlete/today?week=${weekStart}&slot=${dayIdx}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBonusSaving(false);
    }
  };

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
            Your coach hasn't written a plan yet. Try the previous or next week,
            or add an extra training day below.
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
            const isExpanded = expandedDays.has(day.dayIndex);
            const dayData = dayCache[day.dayIndex];
            const isLoadingDay = dayLoading.has(day.dayIndex);
            return (
              <li key={day.dayIndex} className="space-y-2">
                <button
                  onClick={() => void toggleDay(day.dayIndex)}
                  className={`w-full flex items-center gap-3 px-3 py-3 bg-gray-900 border rounded-xl transition-colors text-left ${
                    isExpanded ? 'border-gray-600' : 'border-gray-800 hover:border-gray-600'
                  }`}
                  aria-expanded={isExpanded}
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
                      {day.status === 'completed' && (
                        <span className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
                          Done
                        </span>
                      )}
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
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-600 flex-shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="rounded-xl bg-gray-950 border border-gray-800 overflow-hidden">
                    {isLoadingDay && (
                      <div className="flex items-center justify-center py-6 text-gray-500">
                        <Loader2 size={14} className="animate-spin mr-2" />
                        <span className="text-xs">Loading…</span>
                      </div>
                    )}
                    {!isLoadingDay && dayData && (
                      <SessionPreview
                        slotLabel={day.label}
                        weekdayLabel={weekdayLabel}
                        date={day.sessionDate ?? weekStart}
                        planned={dayData.planned}
                        log={dayData.log}
                        onStart={() =>
                          navigate(`/athlete/today?week=${weekStart}&slot=${day.dayIndex}`)
                        }
                        isBonus={day.isBonus}
                      />
                    )}
                    {!isLoadingDay && !dayData && (
                      <p className="px-4 py-4 text-xs text-gray-500 italic">
                        Couldn't load this day.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && overview && (
        <div className="pt-2">
          <button
            onClick={() => setShowBonusName(true)}
            disabled={bonusSaving || nextBonusDayIndex == null}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-white py-2.5 border border-dashed border-gray-700 hover:border-gray-500 rounded-xl disabled:opacity-50 transition-colors"
            title="Log an extra training day this week"
          >
            <Plus size={13} />
            Add Training Day
          </button>
        </div>
      )}

      <BonusDayNameModal
        open={showBonusName}
        defaultName={defaultBonusName}
        onClose={() => setShowBonusName(false)}
        onConfirm={handleConfirmBonusDay}
      />
    </div>
  );
}
