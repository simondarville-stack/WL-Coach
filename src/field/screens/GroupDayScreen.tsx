/**
 * GroupDayScreen — Field View drill-in: one training group's full programme
 * for one slot of its group-level week plan. Planned side only (a group has
 * no log), rendered with the read-only SessionPreview in coach voice.
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
  defaultSlotLabel,
  type PlannedExerciseFull,
  type WeekOverview,
} from '../../lib/trainingLogService';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, toLocalISO } from '../../lib/dateUtils';
import { SessionPreview } from '../../athlete/v2/components/SessionPreview';

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function GroupDayScreen() {
  const navigate = useNavigate();
  const { groupId, dayIndex: dayIndexParam } = useParams<{ groupId: string; dayIndex: string }>();
  const [params] = useSearchParams();
  const weekStart = params.get('w') ?? getMondayOfWeekISO(new Date());
  const dayIndex = Number(dayIndexParam);

  const [groupName, setGroupName] = useState('');
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [planned, setPlanned] = useState<PlannedExerciseFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        )}
      </div>
    </div>
  );
}
