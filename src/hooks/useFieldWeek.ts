/**
 * useFieldWeek — data load for the coach Field View's Upcoming screen.
 *
 * For one owner and one week: every active athlete, their resolved week
 * overview (individual plan falling back to group plan), their next open
 * training slot, and the compact per-exercise summary rows for that slot
 * with percentage loads resolved through the athlete_prs reference-max
 * cache. Refreshes on demand and on window focus (field usage: the coach
 * pockets the phone between lifts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import {
  fetchPlannedDay,
  fetchSessionForSlot,
  fetchWeekOverview,
  type WeekOverview,
} from '../lib/trainingLogService';
import {
  countSessionProgress,
  isSessionLive,
  resolveNextSession,
  sessionRawTotal,
  summarizeSession,
  DEFAULT_FIELD_BOLD_PCT,
  type FieldExerciseRow,
  type NextSessionResolution,
  type SessionProgress,
} from '../lib/fieldView';
import type { DayLog } from '../lib/trainingLogModel';
import type { Athlete, Exercise } from '../lib/database.types';

export interface FieldAthleteCard {
  athlete: Athlete;
  overview: WeekOverview | null;
  next: NextSessionResolution;
  /** Compact rows for the resolved next slot; empty when there is none. */
  rows: FieldExerciseRow[];
  /** Log session for the resolved slot; only fetched when the slot hasLog. */
  log: DayLog | null;
  /** n/m exercise progress when the slot is live (in progress / has work). */
  progress: SessionProgress | null;
  /** RAW readiness total (4–12) once the athlete logged it; null when
   *  unlogged or when the coach disabled RAW in general_settings. */
  rawTotal: number | null;
}

/** Monday-first weekday index for a local Date, matching day_schedule. */
export function mondayWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const KIND_ORDER: Record<NextSessionResolution['kind'], number> = {
  today: 0,
  next_up: 1,
  overdue: 2,
  scheduled: 3,
  week_complete: 4,
  no_plan: 5,
};

export function useFieldWeek(weekStart: string) {
  const [cards, setCards] = useState<FieldAthleteCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const ownerId = getOwnerId();
      const todayWd = mondayWeekday(new Date());

      const [{ data: athleteRows, error: aErr }, { data: settingsRow }] = await Promise.all([
        supabase
          .from('athletes')
          .select('*')
          .eq('owner_id', ownerId)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('general_settings')
          .select('field_bold_intensity_pct, percent_to_kg_round_enabled, percent_to_kg_round_increment, raw_enabled')
          .eq('owner_id', ownerId)
          .maybeSingle(),
      ]);
      if (aErr) throw aErr;
      const athletes = (athleteRows ?? []) as Athlete[];

      const settings = settingsRow as {
        field_bold_intensity_pct: number | null;
        percent_to_kg_round_enabled: boolean | null;
        percent_to_kg_round_increment: number | null;
        raw_enabled: boolean | null;
      } | null;
      const boldPct = settings?.field_bold_intensity_pct ?? DEFAULT_FIELD_BOLD_PCT;
      const roundEnabled = settings?.percent_to_kg_round_enabled ?? false;
      const roundIncrement = settings?.percent_to_kg_round_increment ?? 2.5;
      // Product default is RAW on (mirrors useSettings' seed row).
      const rawEnabled = settings?.raw_enabled ?? true;

      const overviews = await Promise.all(
        athletes.map(a =>
          fetchWeekOverview(a.id, weekStart).catch(() => null),
        ),
      );

      const nexts = overviews.map(o => resolveNextSession(o, todayWd));

      // One bulk read of the reference-max cache for the whole squad.
      const prByKey = new Map<string, number>();
      if (athletes.length > 0) {
        const { data: prRows } = await supabase
          .from('athlete_prs')
          .select('athlete_id, exercise_id, pr_value_kg')
          .in('athlete_id', athletes.map(a => a.id));
        for (const r of (prRows ?? []) as Array<{
          athlete_id: string; exercise_id: string; pr_value_kg: number | null;
        }>) {
          if (r.pr_value_kg != null) prByKey.set(`${r.athlete_id}:${r.exercise_id}`, r.pr_value_kg);
        }
      }

      const plannedPerAthlete = await Promise.all(
        athletes.map((_, i) => {
          const o = overviews[i];
          const d = nexts[i].day;
          return o?.weekPlanId && d
            ? fetchPlannedDay(o.weekPlanId, d.dayIndex).catch(() => [])
            : Promise.resolve([]);
        }),
      );

      // Live layer: fetch the log session only for athletes whose resolved
      // slot already has one — one lean query per logging athlete.
      const logs = await Promise.all(
        athletes.map((a, i) => {
          const d = nexts[i].day;
          return d?.hasLog
            ? fetchSessionForSlot(a.id, weekStart, d.dayIndex).catch(() => null)
            : Promise.resolve(null);
        }),
      );

      const built: FieldAthleteCard[] = athletes.map((athlete, i) => ({
        athlete,
        overview: overviews[i],
        next: nexts[i],
        log: logs[i],
        progress: isSessionLive(logs[i])
          ? countSessionProgress(plannedPerAthlete[i], logs[i])
          : null,
        rawTotal: rawEnabled ? sessionRawTotal(logs[i]?.session ?? null) : null,
        rows: summarizeSession(plannedPerAthlete[i], {
          boldPct,
          roundEnabled,
          roundIncrement,
          oneRmFor: (ex: Exercise) =>
            prByKey.get(`${athlete.id}:${ex.pr_reference_exercise_id ?? ex.id}`) ?? null,
        }),
      }));

      built.sort(
        (a, b) =>
          KIND_ORDER[a.next.kind] - KIND_ORDER[b.next.kind]
          || a.athlete.name.localeCompare(b.athlete.name),
      );

      if (aliveRef.current) setCards(built);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    void refresh();
    const onFocus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  return { cards, loading, error, refresh };
}
