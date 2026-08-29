/**
 * GroupDayScreen — Field View drill-in: one training group's full programme
 * for one slot of its group-level week plan, plus a live roster of every
 * member's logging status for the slot (the shared plan has no log of its
 * own — the members do). Tapping a roster row opens that athlete's day.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  buildGroupWeekOverview,
  type GroupWeekPlanRow,
} from '../../lib/fieldView';
import {
  fetchGroupDayRoster,
  type GroupDayAthleteStatus,
} from '../../lib/groupDayRoster';
import {
  fetchGroupWeekPlan,
  fetchPlannedCountsByDay,
  fetchPlannedDay,
  defaultSlotLabel,
  type PlannedExerciseFull,
  type WeekOverview,
} from '../../lib/trainingLogService';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, toLocalISO } from '../../lib/dateUtils';
import { SessionPreview } from '../../athlete/v2/components/SessionPreview';

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Compact per-member status: live sessions glow, done ticks, rest stays quiet. */
function RosterStatusChip({ status }: { status: GroupDayAthleteStatus['status'] }) {
  if (status === 'in_progress') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Live
      </span>
    );
  }
  if (status === 'completed') {
    return <span className="text-[11px] text-emerald-400 shrink-0">✓ done</span>;
  }
  if (status === 'skipped') {
    return <span className="text-[11px] text-red-400 shrink-0">✗ skipped</span>;
  }
  return <span className="text-[11px] text-gray-600 shrink-0">not started</span>;
}

export function GroupDayScreen() {
  const navigate = useNavigate();
  const { groupId, dayIndex: dayIndexParam } = useParams<{ groupId: string; dayIndex: string }>();
  const [params] = useSearchParams();
  const weekStart = params.get('w') ?? getMondayOfWeekISO(new Date());
  const dayIndex = Number(dayIndexParam);

  const [groupName, setGroupName] = useState('');
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [planned, setPlanned] = useState<PlannedExerciseFull[] | null>(null);
  const [roster, setRoster] = useState<GroupDayAthleteStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The roster is the live part of this screen — same 30 s cadence the
  // athlete day screen uses, skipped while the phone is backgrounded.
  const loadRoster = useCallback(async () => {
    if (!groupId || Number.isNaN(dayIndex)) return;
    try {
      setRoster(await fetchGroupDayRoster(groupId, weekStart, dayIndex));
    } catch {
      // The plan is the primary content; a roster hiccup self-heals on
      // the next refresh tick.
    }
  }, [groupId, weekStart, dayIndex]);

  useEffect(() => {
    void loadRoster();
    const refreshIfVisible = () => { if (!document.hidden) void loadRoster(); };
    const id = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadRoster]);

  useEffect(() => {
    if (!groupId || Number.isNaN(dayIndex)) return;
    let alive = true;
    (async () => {
      try {
        const [{ data: groupRow }, plan] = await Promise.all([
          supabase.from('training_groups').select('name').eq('id', groupId).maybeSingle(),
          fetchGroupWeekPlan(groupId, weekStart),
        ]);
        if (!plan) {
          if (alive) {
            setGroupName((groupRow as { name: string } | null)?.name ?? '');
            setPlanned([]);
          }
          return;
        }
        const [counts, dayPlanned] = await Promise.all([
          fetchPlannedCountsByDay(plan.id),
          fetchPlannedDay(plan.id, dayIndex),
        ]);
        if (!alive) return;
        setGroupName((groupRow as { name: string } | null)?.name ?? '');
        setOverview(buildGroupWeekOverview(weekStart, plan as GroupWeekPlanRow, counts));
        setPlanned(dayPlanned);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [groupId, weekStart, dayIndex]);

  const dayOverview = overview?.days.find(d => d.dayIndex === dayIndex) ?? null;
  const weekday = dayOverview?.weekday ?? null;
  const date = weekday != null ? addDaysToISO(weekStart, weekday) : toLocalISO(new Date());

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-3 pt-4 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-gray-400 hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <Users size={15} className="text-gray-500 shrink-0" />
          <h1 className="text-base font-bold truncate">{groupName || 'Group'}</h1>
        </div>

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : planned === null ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-600" />
          </div>
        ) : (
          <>
            {/* Live member roster — who is training this slot right now. */}
            {roster != null && roster.length > 0 && (
              <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 divide-y divide-gray-800/70">
                {roster.map(r => (
                  <button
                    key={r.athleteId}
                    type="button"
                    onClick={() =>
                      navigate(`/coach/a/${r.athleteId}/d/${dayIndex}?w=${weekStart}`)
                    }
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-800/50"
                  >
                    {r.photoUrl ? (
                      <img src={r.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-gray-800 text-gray-300 text-[10px] font-semibold flex items-center justify-center">
                        {r.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="text-[13px] text-gray-100 truncate flex-1 min-w-0">
                      {r.name}
                    </span>
                    {r.touchedExercises > 0 && r.status !== 'completed' && (
                      <span className="text-[11px] text-gray-500 tabular-nums">
                        {r.doneExercises}/{r.touchedExercises}
                      </span>
                    )}
                    {r.sessionRpe != null && (
                      <span className="text-[11px] text-gray-500 tabular-nums">
                        RPE {String(r.sessionRpe).replace('.', ',')}
                      </span>
                    )}
                    <RosterStatusChip status={r.status} />
                    <ChevronRight size={13} className="text-gray-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            <SessionPreview
              slotLabel={dayOverview?.label ?? defaultSlotLabel(dayIndex)}
              weekdayLabel={weekday != null ? WEEKDAY_LONG[weekday] : null}
              date={date}
              planned={planned}
              log={null}
              onStart={() => {}}
              readOnly
              viewerRole="coach"
            />
          </>
        )}
      </div>
    </div>
  );
}
