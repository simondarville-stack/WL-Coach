/**
 * groupDayRoster — who in a training group has logged what for one group
 * training slot. Feeds the roster strip on the field app's GroupDayScreen,
 * so a coach running a group session sees everyone's live status without
 * drilling into each athlete.
 *
 * A member's session for the slot is matched on (athlete, week_start,
 * day_index) — group planning writes each member's plan under the same day
 * indices, so this is the same resolution the athlete app itself uses.
 */
import { supabase } from './supabase';

export interface GroupDayAthleteStatus {
  athleteId: string;
  name: string;
  photoUrl: string | null;
  sessionId: string | null;
  /** Session status; 'not_started' = no session row exists yet. */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'not_started';
  /** Logged exercises with status 'completed'. A lower bound: exercises
   *  whose sets are all ticked but never explicitly completed count via
   *  the auto-promotion rule only where a status was stored. */
  doneExercises: number;
  /** Logged exercise rows for the session (exercises the athlete touched). */
  touchedExercises: number;
  sessionRpe: number | null;
  durationMinutes: number | null;
}

/** Sort: live sessions first, then done, then everything else; A–Z within. */
const STATUS_RANK: Record<GroupDayAthleteStatus['status'], number> = {
  in_progress: 0,
  completed: 1,
  skipped: 2,
  pending: 3,
  not_started: 4,
};

export async function fetchGroupDayRoster(
  groupId: string,
  weekStart: string,
  dayIndex: number,
): Promise<GroupDayAthleteStatus[]> {
  const { data: memberRows, error: mErr } = await supabase
    .from('group_members')
    .select('athlete_id')
    .eq('group_id', groupId)
    .is('left_at', null);
  if (mErr) throw mErr;
  const athleteIds = ((memberRows ?? []) as { athlete_id: string }[]).map(m => m.athlete_id);
  if (athleteIds.length === 0) return [];

  const [athletesRes, sessionsRes] = await Promise.all([
    supabase
      .from('athletes')
      .select('id, name, photo_url, is_active')
      .in('id', athleteIds),
    supabase
      .from('training_log_sessions')
      .select('id, athlete_id, status, session_rpe, duration_minutes')
      .in('athlete_id', athleteIds)
      .eq('week_start', weekStart)
      .eq('day_index', dayIndex),
  ]);
  if (athletesRes.error) throw athletesRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  const athletes = ((athletesRes.data ?? []) as {
    id: string; name: string; photo_url: string | null; is_active: boolean;
  }[]).filter(a => a.is_active);
  const sessions = (sessionsRes.data ?? []) as {
    id: string; athlete_id: string; status: string;
    session_rpe: number | null; duration_minutes: number | null;
  }[];
  const sessionByAthlete = new Map(sessions.map(s => [s.athlete_id, s]));

  // Exercise progress behind the sessions that exist.
  const exCounts = new Map<string, { done: number; touched: number }>();
  if (sessions.length > 0) {
    const { data, error } = await supabase
      .from('training_log_exercises')
      .select('session_id, status')
      .in('session_id', sessions.map(s => s.id));
    if (error) throw error;
    for (const ex of (data ?? []) as { session_id: string; status: string }[]) {
      const c = exCounts.get(ex.session_id) ?? { done: 0, touched: 0 };
      c.touched += 1;
      if (ex.status === 'completed') c.done += 1;
      exCounts.set(ex.session_id, c);
    }
  }

  return athletes
    .map<GroupDayAthleteStatus>(a => {
      const s = sessionByAthlete.get(a.id) ?? null;
      const counts = s ? exCounts.get(s.id) ?? { done: 0, touched: 0 } : { done: 0, touched: 0 };
      return {
        athleteId: a.id,
        name: a.name,
        photoUrl: a.photo_url,
        sessionId: s?.id ?? null,
        status: s
          ? ((s.status as GroupDayAthleteStatus['status']) ?? 'pending')
          : 'not_started',
        doneExercises: counts.done,
        touchedExercises: counts.touched,
        sessionRpe: s?.session_rpe ?? null,
        durationMinutes: s?.duration_minutes ?? null,
      };
    })
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name),
    );
}
