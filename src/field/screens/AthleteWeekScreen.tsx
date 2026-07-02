/**
 * AthleteWeekScreen — Field View: one athlete's entire week, every training
 * slot rendered read-only with plan beside log (SessionPreview shows both),
 * navigable across weeks. Opened by tapping an athlete's header on the
 * Upcoming screen.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  fetchAthleteDay,
  fetchWeekOverview,
  type AthleteDayData,
  type WeekOverview,
} from '../../lib/trainingLogService';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, toLocalISO } from '../../lib/dateUtils';
import { WeekNavigator } from '../../athlete/v2/components/WeekNavigator';
import { SessionPreview } from '../../athlete/v2/components/SessionPreview';

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function AthleteWeekScreen() {
  const navigate = useNavigate();
  const { athleteId } = useParams<{ athleteId: string }>();
  const [params] = useSearchParams();

  const [weekStart, setWeekStart] = useState<string>(
    () => params.get('w') ?? getMondayOfWeekISO(new Date()),
  );
  const [athleteName, setAthleteName] = useState('');
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [days, setDays] = useState<AthleteDayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!athleteId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [{ data: athleteRow }, ov] = await Promise.all([
          supabase.from('athletes').select('name').eq('id', athleteId).maybeSingle(),
          fetchWeekOverview(athleteId, weekStart),
        ]);
        const dayData = await Promise.all(
          ov.days.map(d => fetchAthleteDay(athleteId, weekStart, d.dayIndex, ov.weekPlanId)),
        );
        if (!alive) return;
        setAthleteName((athleteRow as { name: string } | null)?.name ?? '');
        setOverview(ov);
        setDays(dayData);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [athleteId, weekStart]);

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
          <h1 className="text-base font-bold truncate">{athleteName || 'Athlete'}</h1>
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
          <p className="text-sm text-gray-500">No plan for this week.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {overview.days.map((d, i) => {
              const dd = days[i];
              if (!dd) return null;
              const date =
                dd.log?.date
                ?? (d.weekday != null ? addDaysToISO(weekStart, d.weekday) : toLocalISO(new Date()));
              return (
                <SessionPreview
                  key={d.dayIndex}
                  slotLabel={d.label}
                  weekdayLabel={d.weekday != null ? WEEKDAY_LONG[d.weekday] : null}
                  date={date}
                  planned={dd.planned}
                  log={dd.log}
                  onStart={() => {}}
                  isBonus={d.isBonus}
                  readOnly
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
