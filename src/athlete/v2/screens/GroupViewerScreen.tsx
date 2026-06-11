/**
 * GroupViewerScreen — read-only group plan viewer for the athlete app.
 *
 * Renders the same SessionPreview block the athlete sees for each day,
 * one per active training unit in the chosen week. The "View in log" /
 * "Start logging" CTA at the bottom of each preview is suppressed via
 * SessionPreview's readOnly prop.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogOut, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../../lib/supabase';
import { WeekNavigator, getMondayOf } from '../components/WeekNavigator';
import { SessionPreview } from '../components/SessionPreview';
import { fetchPlannedDay, defaultSlotLabel } from '../../../lib/trainingLogService';
import type { PlannedExerciseFull } from '../../../lib/trainingLogService';
import type { WeekPlan } from '../../../lib/database.types';

const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Monday',
  1: 'Tuesday',
  2: 'Wednesday',
  3: 'Thursday',
  4: 'Friday',
  5: 'Saturday',
  6: 'Sunday',
};

async function loadGroupWeekPlan(groupId: string, weekStart: string): Promise<WeekPlan | null> {
  const { data, error } = await supabase
    .from('week_plans')
    .select('*')
    .eq('group_id', groupId)
    .is('athlete_id', null)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) throw error;
  return (data as WeekPlan | null) ?? null;
}

interface DayBlock {
  dayIndex: number;
  label: string;
  weekdayLabel: string | null;
  planned: PlannedExerciseFull[];
}

export function GroupViewerScreen() {
  const { group, signOut } = useAuth();

  const [weekStart, setWeekStart] = useState<string>(() => getMondayOf(new Date()));
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [days, setDays] = useState<DayBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!group) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const plan = await loadGroupWeekPlan(group!.id, weekStart);
        if (cancelled) return;
        setWeekPlan(plan);
        if (!plan) {
          setDays([]);
          return;
        }
        const active = (plan.active_days ?? []).slice().sort((a, b) => a - b);
        const labels = (plan.day_labels ?? {}) as Record<number, string>;
        const schedule = (plan.day_schedule ?? {}) as Record<number, { weekday: number; time: string | null }>;
        // Fetch all days in parallel — small N, cheap.
        const perDay = await Promise.all(
          active.map(idx => fetchPlannedDay(plan.id, idx)),
        );
        if (cancelled) return;
        const blocks: DayBlock[] = active.map((idx, i) => ({
          dayIndex: idx,
          label: labels[idx] || defaultSlotLabel(idx),
          weekdayLabel: schedule[idx]?.weekday != null ? WEEKDAY_SHORT[schedule[idx].weekday] ?? null : null,
          planned: perDay[i],
        }));
        setDays(blocks);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [group?.id, weekStart]);

  const dateForDay = useMemo(() => {
    return (dayIndex: number, weekday: number | null): string => {
      // Best-effort calendar date: if the coach mapped a weekday for the
      // training unit, advance from the week's Monday to that weekday;
      // otherwise just reuse weekStart. SessionPreview only formats this
      // for the read-only header line — exact mapping not critical.
      const [y, m, d] = weekStart.split('-').map(Number);
      const base = new Date(Date.UTC(y, m - 1, d));
      const offset = weekday != null ? weekday : Math.max(0, Math.min(6, dayIndex - 1));
      base.setUTCDate(base.getUTCDate() + offset);
      return base.toISOString().slice(0, 10);
    };
  }, [weekStart]);

  if (!group) return null;

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
          <Users size={16} className="text-gray-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white truncate">{group.name}</h1>
          <p className="text-[10px] text-gray-500">Group plan · view only</p>
        </div>
        <button
          onClick={signOut}
          className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-gray-800"
          title="Switch profile"
        >
          <LogOut size={12} />
          Switch
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading week…</span>
          </div>
        ) : !weekPlan ? (
          <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-8 text-center">
            <p className="text-sm text-gray-400">No plan for this week.</p>
            <p className="text-[11px] text-gray-600 mt-1">Try navigating to another week.</p>
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-8 text-center">
            <p className="text-sm text-gray-400">No active training units this week.</p>
          </div>
        ) : (
          days.map(day => (
            <SessionPreview
              key={day.dayIndex}
              slotLabel={day.label}
              weekdayLabel={day.weekdayLabel}
              date={dateForDay(day.dayIndex, null)}
              planned={day.planned}
              log={null}
              onStart={() => { /* read-only: no log to enter */ }}
              readOnly
            />
          ))
        )}
      </div>
    </div>
  );
}
