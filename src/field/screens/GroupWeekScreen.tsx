/**
 * GroupWeekScreen — Field View: a training group's entire group-level week
 * plan, every slot rendered read-only, navigable across weeks. Planned side
 * only (a group has no log).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  buildGroupWeekOverview,
  type GroupWeekPlanRow,
} from '../../lib/fieldView';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-3 pt-4 pb-8">
        <div className="flex items-center gap-2 mb-3">
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

        <div className="mb-4">
          <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
        </div>

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-600" />
          </div>
        ) : !overview || overview.days.length === 0 ? (
          <p className="text-sm text-gray-500">No group plan for this week.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {overview.days.map((d, i) => (
              <SessionPreview
                key={d.dayIndex}
                slotLabel={d.label}
                weekdayLabel={d.weekday != null ? WEEKDAY_LONG[d.weekday] : null}
                date={d.weekday != null ? addDaysToISO(weekStart, d.weekday) : toLocalISO(new Date())}
                planned={days[i] ?? []}
                log={null}
                onStart={() => {}}
                readOnly
                viewerRole="coach"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
