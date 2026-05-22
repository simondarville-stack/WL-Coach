/**
 * GroupViewerScreen — read-only week viewer for a TrainingGroup.
 *
 * Used when a viewer picks a group at the ProfilePicker instead of an
 * athlete profile. No logging UI, no per-athlete data fetches — just
 * the planned exercises for the chosen week, rendered with the same
 * StackedNotation the planner uses so the coach's notation survives.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogOut, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useWeekPlans } from '../../../hooks/useWeekPlans';
import { useCombos } from '../../../hooks/useCombos';
import { supabase } from '../../../lib/supabase';
import { WeekNavigator, getMondayOf } from '../components/WeekNavigator';
import { StackedNotation } from '../../../components/planner/StackedNotation';
import { getSentinelType } from '../../../components/planner/sentinelUtils';
import { SentinelDisplay } from '../../../components/planner/SentinelDisplay';
import type { PlannedExercise, Exercise, WeekPlan, ComboMemberEntry } from '../../../lib/database.types';

type PlannedRow = PlannedExercise & { exercise: Exercise };

/** Group-plan lookup that does NOT filter by owner_id — the athlete app
 *  doesn't populate the coach store, so the helper in useWeekPlans
 *  (which scopes by getOwnerId()) would always return null here. The
 *  (group_id, week_start, athlete_id IS NULL) tuple is unique per plan
 *  in practice. */
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

export function GroupViewerScreen() {
  const { group, signOut } = useAuth();
  const { fetchPlannedExercisesFlat } = useWeekPlans();
  const { fetchProgrammeData } = useCombos();

  const [weekStart, setWeekStart] = useState<string>(() => getMondayOf(new Date()));
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [planned, setPlanned] = useState<Record<number, PlannedRow[]>>({});
  const [comboMembers, setComboMembers] = useState<Record<string, ComboMemberEntry[]>>({});
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
          setPlanned({});
          setComboMembers({});
          return;
        }
        const [exercises, { comboMembers: members }] = await Promise.all([
          fetchPlannedExercisesFlat(plan.id),
          fetchProgrammeData(plan.id),
        ]);
        if (cancelled) return;
        const grouped: Record<number, PlannedRow[]> = {};
        exercises.forEach(ex => {
          if (!grouped[ex.day_index]) grouped[ex.day_index] = [];
          grouped[ex.day_index].push(ex);
        });
        Object.keys(grouped).forEach(k => {
          grouped[Number(k)].sort((a, b) => a.position - b.position);
        });
        setPlanned(grouped);
        setComboMembers(members);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [group?.id, weekStart]);

  const visibleDays = useMemo(() => {
    if (!weekPlan) return [];
    const active = (weekPlan.active_days ?? []).slice().sort((a, b) => a - b);
    const labels = (weekPlan.day_labels ?? {}) as Record<number, string>;
    return active.map(idx => ({
      index: idx,
      name: labels[idx] || `Day ${idx + 1}`,
    }));
  }, [weekPlan]);

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

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading plan…</span>
          </div>
        ) : error ? (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        ) : !weekPlan ? (
          <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-8 text-center">
            <p className="text-sm text-gray-400">No plan for this week.</p>
            <p className="text-[11px] text-gray-600 mt-1">Try navigating to another week.</p>
          </div>
        ) : visibleDays.length === 0 ? (
          <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-8 text-center">
            <p className="text-sm text-gray-400">No active training units this week.</p>
          </div>
        ) : (
          visibleDays.map(day => (
            <DayBlock
              key={day.index}
              dayName={day.name}
              exercises={planned[day.index] ?? []}
              comboMembers={comboMembers}
            />
          ))
        )}

        <p className="text-[10px] text-gray-600 text-center pt-2">
          Logging is only available from an athlete profile.
        </p>
      </div>
    </div>
  );
}

function DayBlock({
  dayName,
  exercises,
  comboMembers,
}: {
  dayName: string;
  exercises: PlannedRow[];
  comboMembers: Record<string, ComboMemberEntry[]>;
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-800 bg-gray-900/80">
        <h2 className="text-sm font-bold text-white">{dayName}</h2>
      </div>
      <div className="divide-y divide-gray-800/60">
        {exercises.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-gray-500 italic">No exercises</div>
        ) : (
          exercises.map(ex => <ExerciseRow key={ex.id} ex={ex} comboMembers={comboMembers} />)
        )}
      </div>
    </div>
  );
}

function ExerciseRow({
  ex,
  comboMembers,
}: {
  ex: PlannedRow;
  comboMembers: Record<string, ComboMemberEntry[]>;
}) {
  const sentinel = getSentinelType(ex.exercise.exercise_code);
  if (sentinel === 'text' || sentinel === 'image' || sentinel === 'video') {
    return (
      <div className="px-3 py-3">
        <SentinelDisplay
          exerciseCode={ex.exercise.exercise_code}
          notes={ex.notes}
          metadata={ex.metadata}
          theme="dark"
        />
      </div>
    );
  }

  const accent = ex.is_combo
    ? (ex.combo_color || comboMembers[ex.id]?.[0]?.exercise?.color || '#3B82F6')
    : (ex.exercise.color || '#3B82F6');

  const displayName = ex.is_combo
    ? ex.combo_notation ??
      (comboMembers[ex.id]?.length
        ? comboMembers[ex.id]
            .map(m => m.exercise?.name)
            .filter((n): n is string => !!n)
            .join(' + ')
        : ex.exercise.name)
    : ex.exercise.name;

  return (
    <div className="px-3 py-3 flex items-start gap-3">
      <div
        className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-white truncate">{displayName}</h3>
          {ex.is_combo && (
            <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
              Combo
            </span>
          )}
        </div>
        <div className="mt-1">
          <StackedNotation
            raw={ex.prescription_raw}
            unit={ex.unit}
            isCombo={ex.is_combo}
          />
        </div>
        {ex.notes && (
          <p className="text-[10px] text-gray-500 italic mt-1 whitespace-pre-wrap">{ex.notes}</p>
        )}
        {ex.variation_note && (
          <p className="text-[10px] text-gray-500 italic mt-0.5">{ex.variation_note}</p>
        )}
      </div>
    </div>
  );
}
