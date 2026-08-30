/**
 * GroupWeekScreen — Field View: a training group's entire group-level week
 * plan, every slot rendered read-only, navigable across weeks. The plan is
 * group-level (no log of its own); each slot carries a member-roster
 * miniature — one status dot per member — that opens the group day's full
 * live roster.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, TrendingUp, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  buildGroupWeekOverview,
  type GroupWeekPlanRow,
} from '../../lib/fieldView';
import {
  fetchGroupWeekRoster,
  type GroupWeekRosterDot,
} from '../../lib/groupDayRoster';
import {
  fetchGroupWeekPlan,
  fetchPlannedCountsByDay,
  fetchPlannedDay,
  type PlannedExerciseFull,
  type WeekOverview,
} from '../../lib/trainingLogService';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, toLocalISO } from '../../lib/dateUtils';
import { WeekNavigator } from '../../athlete/v2/components/WeekNavigator';
import { SessionPreview } from '../../athlete/v2/components/SessionPreview';

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DOT_CLASS: Record<GroupWeekRosterDot['status'], string> = {
  completed: 'bg-emerald-400',
  in_progress: 'bg-amber-400 animate-pulse',
  skipped: 'bg-red-400',
  pending: 'bg-gray-600',
  not_started: 'bg-gray-700',
};

const DOT_STATUS_LABEL: Record<GroupWeekRosterDot['status'], string> = {
  completed: 'done',
  in_progress: 'in progress',
  skipped: 'skipped',
  pending: 'started, nothing logged',
  not_started: 'not started',
};

/** Dots-only member roster for one slot — position N is the same athlete
 *  on every day (A–Z). Tapping opens the group day's full live roster. */
function GroupDayDots({
  dots,
  onOpen,
}: {
  dots: GroupWeekRosterDot[];
  onOpen: () => void;
}) {
  const done = dots.filter(d => d.status === 'completed').length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-1.5 px-1 pb-1 text-left"
      title="Open this day's member roster"
    >
      <span className="flex items-center gap-1 flex-wrap">
        {dots.map(d => (
          <span
            key={d.athleteId}
            className={`w-2 h-2 rounded-full ${DOT_CLASS[d.status]}`}
            title={`${d.name} — ${DOT_STATUS_LABEL[d.status]}`}
          />
        ))}
      </span>
      <span className="text-[10px] text-gray-500 tabular-nums">
        {done}/{dots.length} done
      </span>
    </button>
  );
}

export function GroupWeekScreen() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const [params] = useSearchParams();

  const [weekStart, setWeekStart] = useState<string>(
    () => params.get('w') ?? getMondayOfWeekISO(new Date()),
  );
  const [groupName, setGroupName] = useState('');
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [days, setDays] = useState<PlannedExerciseFull[][]>([]);
  const [roster, setRoster] = useState<Map<number, GroupWeekRosterDot[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Roster dots load independently of the plan — a hiccup here never
  // blocks the programme itself.
  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setRoster(null);
    fetchGroupWeekRoster(groupId, weekStart)
      .then(r => { if (alive) setRoster(r); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [groupId, weekStart]);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [{ data: groupRow }, plan] = await Promise.all([
          supabase.from('training_groups').select('name').eq('id', groupId).maybeSingle(),
          fetchGroupWeekPlan(groupId, weekStart),
        ]);
        if (!plan) {
          if (alive) {
            setGroupName((groupRow as { name: string } | null)?.name ?? '');
            setOverview(null);
            setDays([]);
          }
          return;
        }
        const counts = await fetchPlannedCountsByDay(plan.id);
        const ov = buildGroupWeekOverview(weekStart, plan as GroupWeekPlanRow, counts);
        const dayPlanned = await Promise.all(
          ov.days.map(d => fetchPlannedDay(plan.id, d.dayIndex)),
        );
        if (!alive) return;
        setGroupName((groupRow as { name: string } | null)?.name ?? '');
        setOverview(ov);
        setDays(dayPlanned);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [groupId, weekStart]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] text-white">
      <div className="max-w-2xl mx-auto px-3 pt-4 pb-8">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-[color:var(--color-text-secondary)] hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <Users size={15} className="text-[color:var(--color-text-secondary)] shrink-0" />
          <h1 className="text-base font-bold truncate flex-1">{groupName || 'Group'}</h1>
          {groupId && (
            <button
              onClick={() => navigate(`/coach/g/${groupId}/macro`)}
              className="p-2 -mr-2 text-[color:var(--color-text-secondary)] hover:text-white"
              aria-label="Macro cycle"
              title="Macro cycle"
            >
              <TrendingUp size={17} />
            </button>
          )}
        </div>

        <div className="mb-4">
          <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
        </div>

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[color:var(--color-text-tertiary)]" />
          </div>
        ) : !overview || overview.days.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-secondary)]">No group plan for this week.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {overview.days.map((d, i) => {
              // -1 is the all-not-started fallback row for slots nobody
              // has a session for yet (see fetchGroupWeekRoster).
              const dots = roster?.get(d.dayIndex) ?? roster?.get(-1) ?? null;
              return (
                <div key={d.dayIndex}>
                  {dots != null && dots.length > 0 && groupId && (
                    <GroupDayDots
                      dots={dots}
                      onOpen={() =>
                        navigate(`/coach/g/${groupId}/d/${d.dayIndex}?w=${weekStart}`)
                      }
                    />
                  )}
                  <SessionPreview
                    slotLabel={d.label}
                    weekdayLabel={d.weekday != null ? WEEKDAY_LONG[d.weekday] : null}
                    date={d.weekday != null ? addDaysToISO(weekStart, d.weekday) : toLocalISO(new Date())}
                    planned={days[i] ?? []}
                    log={null}
                    onStart={() => {}}
                    readOnly
                    viewerRole="coach"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
