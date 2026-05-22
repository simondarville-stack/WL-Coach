/**
 * GroupViewerScreen — read-only group plan viewer for the athlete app.
 *
 * Composes the same primitives the athlete TodayScreen uses
 * (WeekNavigator, DayChipRow, ExerciseLogCard) with readOnly=true so
 * group viewers see the exact same layout an athlete would, minus the
 * interactive bits (Log-as-prescribed, Add-set, Mark-complete, notes
 * editor, set inputs, comment thread).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogOut, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../../lib/supabase';
import { WeekNavigator, getMondayOf } from '../components/WeekNavigator';
import { DayChipRow } from '../components/DayChipRow';
import { ExerciseLogCard } from '../components/ExerciseLogCard';
import { fetchPlannedDay } from '../../../lib/trainingLogService';
import type {
  PlannedExerciseFull,
  WeekDayOverview,
} from '../../../lib/trainingLogService';
import type { WeekPlan } from '../../../lib/database.types';

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

/** Synthesise WeekDayOverview rows from the group week plan + planned
 *  exercise counts. The athlete fetcher returns the same shape; this
 *  builds it without any athlete-side log lookups. */
async function loadGroupWeekDays(weekPlan: WeekPlan): Promise<WeekDayOverview[]> {
  const active = (weekPlan.active_days ?? []).slice().sort((a, b) => a - b);
  if (active.length === 0) return [];

  const { data: peRows } = await supabase
    .from('planned_exercises')
    .select('day_index')
    .eq('weekplan_id', weekPlan.id);
  const counts = new Map<number, number>();
  ((peRows ?? []) as Array<{ day_index: number }>).forEach(r => {
    counts.set(r.day_index, (counts.get(r.day_index) ?? 0) + 1);
  });

  const labels = (weekPlan.day_labels ?? {}) as Record<number, string>;
  const schedule = (weekPlan.day_schedule ?? {}) as Record<number, { weekday: number; time: string | null }>;

  return active.map(idx => ({
    dayIndex: idx,
    label: labels[idx] || `Day ${idx + 1}`,
    weekday: schedule[idx]?.weekday ?? null,
    plannedCount: counts.get(idx) ?? 0,
    status: 'pending' as const,
    sessionDate: null,
    hasLog: false,
  }));
}

const NOOP = async () => { /* read-only viewer */ };

export function GroupViewerScreen() {
  const { group, signOut } = useAuth();

  const [weekStart, setWeekStart] = useState<string>(() => getMondayOf(new Date()));
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [days, setDays] = useState<WeekDayOverview[]>([]);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [planned, setPlanned] = useState<PlannedExerciseFull[]>([]);
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load the week (plan + day picker) on group / weekStart change ──
  useEffect(() => {
    let cancelled = false;
    if (!group) return;
    async function load() {
      setLoadingWeek(true);
      setError(null);
      try {
        const plan = await loadGroupWeekPlan(group!.id, weekStart);
        if (cancelled) return;
        setWeekPlan(plan);
        if (!plan) {
          setDays([]);
          setSelectedDayIndex(null);
          return;
        }
        const overview = await loadGroupWeekDays(plan);
        if (cancelled) return;
        setDays(overview);
        setSelectedDayIndex(prev => {
          if (prev != null && overview.some(d => d.dayIndex === prev)) return prev;
          return overview[0]?.dayIndex ?? null;
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingWeek(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [group?.id, weekStart]);

  // ── Load the selected day's planned exercises ──
  useEffect(() => {
    let cancelled = false;
    if (!weekPlan || selectedDayIndex == null) {
      setPlanned([]);
      return;
    }
    async function load() {
      setLoadingDay(true);
      try {
        const list = await fetchPlannedDay(weekPlan!.id, selectedDayIndex!);
        if (cancelled) return;
        setPlanned(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingDay(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [weekPlan?.id, selectedDayIndex]);

  const selectedDay = useMemo(
    () => days.find(d => d.dayIndex === selectedDayIndex) ?? null,
    [days, selectedDayIndex],
  );

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

        {loadingWeek ? (
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
          <>
            <DayChipRow
              days={days}
              selectedDayIndex={selectedDayIndex}
              onSelect={setSelectedDayIndex}
            />

            {selectedDay && (
              <div className="rounded-xl bg-gray-900 border border-gray-800 px-3 py-2.5">
                <h2 className="text-sm font-bold text-white">{selectedDay.label}</h2>
                <p className="text-[10px] text-gray-500 mt-0.5">{planned.length} exercise{planned.length === 1 ? '' : 's'}</p>
              </div>
            )}

            {loadingDay ? (
              <div className="flex items-center justify-center py-6 text-gray-500">
                <Loader2 size={16} className="animate-spin mr-2" />
                <span className="text-xs">Loading exercises…</span>
              </div>
            ) : planned.length === 0 ? (
              <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-6 text-center">
                <p className="text-sm text-gray-400">No exercises in this training unit.</p>
              </div>
            ) : (
              planned.map(p => (
                <ExerciseLogCard
                  key={p.exercise.id}
                  planned={p}
                  loggedExercise={null}
                  loggedSets={[]}
                  onSaveSet={NOOP}
                  onLogAsPrescribed={NOOP}
                  onUpdateNotes={NOOP}
                  onMarkComplete={NOOP}
                  readOnly
                />
              ))
            )}

            <p className="text-[10px] text-gray-600 text-center pt-2">
              Logging is only available from an athlete profile.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
