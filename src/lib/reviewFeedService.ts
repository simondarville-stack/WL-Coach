/**
 * reviewFeedService — data layer for the coach Review feed (reel scroller).
 *
 * The feed is a snapshot of "everything new since the coach last caught up":
 *   1. Athlete-uploaded videos not yet reviewed   (training_log_videos.coach_reviewed_at IS NULL)
 *   2. Athlete messages/questions not yet read    (training_log_messages.coach_read_at IS NULL)
 *   3. Completed sessions not yet reviewed        (training_log_sessions.coach_reviewed_at IS NULL,
 *                                                  within a lookback window)
 *
 * Items are sorted oldest-first so scrolling to the bottom means
 * "fully caught up". Marking items seen reuses the existing read/review
 * markers so the rest of the app (Inbox badge, log-mode "new footage"
 * rings) stays consistent with the feed for free.
 */
import { supabase } from './supabase';
import { emitInboxChanged } from './inboxEvents';
import type {
  TrainingLogExercise,
  TrainingLogMessage,
  TrainingLogSession,
  TrainingLogVideo,
} from './database.types';

/** Default lookback for session cards — single source shared by the feed,
 *  the sidebar badge and the dashboard panel so their numbers can never
 *  disagree. COACH-CONFIG candidate. */
export const REVIEW_SESSION_LOOKBACK_DAYS = 7;

function lookbackSinceDate(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
}

// ─── Feed item types ───────────────────────────────────────────────────────

export interface ReviewVideoItem {
  kind: 'video';
  /** Stable identity for seen-tracking, e.g. `video:<id>`. */
  key: string;
  /** ISO timestamp used for feed ordering (oldest first). */
  timestamp: string;
  athleteId: string;
  sessionId: string | null;
  /** Training date of the session the clip belongs to (YYYY-MM-DD). */
  sessionDate: string | null;
  exerciseName: string;
  video: TrainingLogVideo;
}

export interface ReviewThreadItem {
  kind: 'thread';
  key: string;
  timestamp: string;
  athleteId: string;
  /** Null for the general (no-session) athlete↔coach thread. */
  sessionId: string | null;
  sessionDate: string | null;
  /** Unread athlete messages in this thread, oldest first. */
  messages: TrainingLogMessage[];
}

export interface SessionReviewExercise {
  id: string;
  name: string;
  status: TrainingLogExercise['status'];
  performedRaw: string;
  performedNotes: string;
  /** Athlete added this outside the plan. */
  offPlan: boolean;
}

export interface ReviewSessionItem {
  kind: 'session';
  key: string;
  timestamp: string;
  athleteId: string;
  session: TrainingLogSession;
  exercises: SessionReviewExercise[];
}

export type ReviewFeedItem = ReviewVideoItem | ReviewThreadItem | ReviewSessionItem;

// ─── Fetch ─────────────────────────────────────────────────────────────────

export interface FetchReviewFeedArgs {
  ownerId: string;
  /** Athletes visible to this coach — scopes every query. */
  athleteIds: string[];
  /** Session cards only look this far back; videos and questions never age out. */
  lookbackDays: number;
}

interface SessionStub {
  id: string;
  date: string;
  athlete_id: string;
}

export async function fetchReviewFeed(args: FetchReviewFeedArgs): Promise<ReviewFeedItem[]> {
  const { athleteIds, lookbackDays } = args;
  if (athleteIds.length === 0) return [];
  const sinceDate = lookbackSinceDate(lookbackDays);

  // The three sources are independent — fetch them concurrently.
  const [videoRows, messageRows, sessionRows] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from('training_log_videos')
        .select('*')
        .is('coach_reviewed_at', null)
        .eq('uploaded_by', 'athlete')
        .in('athlete_id', athleteIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingLogVideo[];
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('training_log_messages')
        .select('*')
        .eq('sender_type', 'athlete')
        .is('coach_read_at', null)
        .in('athlete_id', athleteIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingLogMessage[];
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('training_log_sessions')
        .select('*')
        .eq('status', 'completed')
        .is('coach_reviewed_at', null)
        .in('athlete_id', athleteIds)
        .gte('date', sinceDate)
        .order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingLogSession[];
    })(),
  ]);

  // ── Secondary lookups ────────────────────────────────────────────────────

  // Videos hang off log exercises; resolve exercise name + session.
  const videoLogExIds = [...new Set(videoRows.map(v => v.log_exercise_id))];
  const videoLogExs: Pick<TrainingLogExercise, 'id' | 'session_id' | 'exercise_id'>[] =
    videoLogExIds.length === 0
      ? []
      : await (async () => {
          const { data, error } = await supabase
            .from('training_log_exercises')
            .select('id, session_id, exercise_id')
            .in('id', videoLogExIds);
          if (error) throw error;
          return (data ?? []) as Pick<TrainingLogExercise, 'id' | 'session_id' | 'exercise_id'>[];
        })();
  const logExById = new Map(videoLogExs.map(le => [le.id, le]));

  // Session cards need their exercises for the summary.
  const reviewSessionIds = sessionRows.map(s => s.id);
  const sessionExs: TrainingLogExercise[] =
    reviewSessionIds.length === 0
      ? []
      : await (async () => {
          const { data, error } = await supabase
            .from('training_log_exercises')
            .select('*')
            .in('session_id', reviewSessionIds)
            .order('position', { ascending: true });
          if (error) throw error;
          return (data ?? []) as TrainingLogExercise[];
        })();

  // Dates for sessions referenced by videos/messages but not in the review set.
  const extraSessionIds = new Set<string>();
  for (const le of videoLogExs) extraSessionIds.add(le.session_id);
  for (const m of messageRows) if (m.session_id) extraSessionIds.add(m.session_id);
  for (const id of reviewSessionIds) extraSessionIds.delete(id);
  const extraSessions: SessionStub[] =
    extraSessionIds.size === 0
      ? []
      : await (async () => {
          const { data, error } = await supabase
            .from('training_log_sessions')
            .select('id, date, athlete_id')
            .in('id', [...extraSessionIds]);
          if (error) throw error;
          return (data ?? []) as SessionStub[];
        })();
  const sessionStubById = new Map<string, SessionStub>();
  for (const s of sessionRows) sessionStubById.set(s.id, s);
  for (const s of extraSessions) sessionStubById.set(s.id, s);

  // Exercise names (catalogue), for video cards and session summaries.
  const exerciseIds = new Set<string>();
  for (const le of videoLogExs) if (le.exercise_id) exerciseIds.add(le.exercise_id);
  for (const ex of sessionExs) if (ex.exercise_id) exerciseIds.add(ex.exercise_id);
  const exerciseNameById = new Map<string, string>();
  if (exerciseIds.size > 0) {
    const { data, error } = await supabase
      .from('exercises')
      .select('id, name')
      .in('id', [...exerciseIds]);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; name: string }[]) {
      exerciseNameById.set(row.id, row.name);
    }
  }

  // ── Assemble ─────────────────────────────────────────────────────────────

  const items: ReviewFeedItem[] = [];

  for (const v of videoRows) {
    const le = logExById.get(v.log_exercise_id);
    const session = le ? sessionStubById.get(le.session_id) : undefined;
    items.push({
      kind: 'video',
      key: `video:${v.id}`,
      timestamp: v.created_at,
      athleteId: v.athlete_id,
      sessionId: le?.session_id ?? null,
      sessionDate: session?.date ?? null,
      exerciseName:
        (le?.exercise_id && exerciseNameById.get(le.exercise_id)) || 'Exercise',
      video: v,
    });
  }

  // Group unread messages into one card per thread (session, or general per athlete).
  const threads = new Map<string, ReviewThreadItem>();
  for (const m of messageRows) {
    if (!m.athlete_id) continue;
    const key = m.session_id ? `thread:${m.session_id}` : `thread:general:${m.athlete_id}`;
    let t = threads.get(key);
    if (!t) {
      t = {
        kind: 'thread',
        key,
        timestamp: m.created_at,
        athleteId: m.athlete_id,
        sessionId: m.session_id,
        sessionDate: m.session_id ? sessionStubById.get(m.session_id)?.date ?? null : null,
        messages: [],
      };
      threads.set(key, t);
    }
    t.messages.push(m);
  }
  items.push(...threads.values());

  const exsBySession = new Map<string, TrainingLogExercise[]>();
  for (const ex of sessionExs) {
    const list = exsBySession.get(ex.session_id) ?? [];
    list.push(ex);
    exsBySession.set(ex.session_id, list);
  }
  for (const s of sessionRows) {
    items.push({
      kind: 'session',
      key: `session:${s.id}`,
      timestamp: s.completed_at ?? `${s.date}T23:59:59Z`,
      athleteId: s.athlete_id,
      session: s,
      exercises: (exsBySession.get(s.id) ?? []).map(ex => ({
        id: ex.id,
        name:
          (ex.exercise_id && exerciseNameById.get(ex.exercise_id)) ||
          (ex.metadata?.text ? 'Note' : 'Exercise'),
        status: ex.status,
        performedRaw: ex.performed_raw,
        performedNotes: ex.performed_notes,
        offPlan: ex.planned_exercise_id == null,
      })),
    });
  }

  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return items;
}

// ─── Seen markers ──────────────────────────────────────────────────────────

/** Stamp a completed session as reviewed by the coach (idempotent). */
export async function markSessionReviewed(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('training_log_sessions')
    .update({ coach_reviewed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('coach_reviewed_at', null);
  if (error) throw error;
  // Same "your count may be stale" channel the inbox badge uses — the
  // review badge and dashboard panel subscribe to it too.
  emitInboxChanged();
}

// ─── Lightweight counts (sidebar badge) ────────────────────────────────────

export interface ReviewFeedCounts {
  videos: number;
  threads: number;
  sessions: number;
  /** Cards in the feed = videos + threads + sessions. */
  total: number;
}

/**
 * Cheap card count for the sidebar badge — same filters as fetchReviewFeed
 * but head-only counts (plus one thin select to count distinct message
 * threads), no joins.
 */
export async function fetchReviewFeedCounts(
  athleteIds: string[],
  lookbackDays: number = REVIEW_SESSION_LOOKBACK_DAYS,
): Promise<ReviewFeedCounts> {
  if (athleteIds.length === 0) return { videos: 0, threads: 0, sessions: 0, total: 0 };
  const sinceDate = lookbackSinceDate(lookbackDays);

  const [videos, threadRows, sessions] = await Promise.all([
    (async () => {
      const { count, error } = await supabase
        .from('training_log_videos')
        .select('id', { count: 'exact', head: true })
        .is('coach_reviewed_at', null)
        .eq('uploaded_by', 'athlete')
        .in('athlete_id', athleteIds);
      if (error) throw error;
      return count ?? 0;
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('training_log_messages')
        .select('session_id, athlete_id')
        .eq('sender_type', 'athlete')
        .is('coach_read_at', null)
        .in('athlete_id', athleteIds);
      if (error) throw error;
      return (data ?? []) as { session_id: string | null; athlete_id: string | null }[];
    })(),
    (async () => {
      const { count, error } = await supabase
        .from('training_log_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .is('coach_reviewed_at', null)
        .in('athlete_id', athleteIds)
        .gte('date', sinceDate);
      if (error) throw error;
      return count ?? 0;
    })(),
  ]);

  const threadKeys = new Set<string>();
  for (const r of threadRows) {
    if (r.session_id) threadKeys.add(r.session_id);
    else if (r.athlete_id) threadKeys.add(`general:${r.athlete_id}`);
  }
  const threads = threadKeys.size;
  return { videos, threads, sessions, total: videos + threads + sessions };
}

// ─── Per-athlete review status (dashboard panel) ───────────────────────────

export interface AthleteReviewStatus {
  athleteId: string;
  /** Completed sessions inside the lookback window. */
  completed: number;
  /** Of those, how many the coach has reviewed. */
  reviewed: number;
}

/**
 * Reviewed-vs-completed per athlete over the lookback window. One thin
 * query, aggregated client-side; athletes with no completed sessions in
 * the window are omitted.
 */
export async function fetchReviewStatusByAthlete(
  athleteIds: string[],
  lookbackDays: number = REVIEW_SESSION_LOOKBACK_DAYS,
): Promise<AthleteReviewStatus[]> {
  if (athleteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('training_log_sessions')
    .select('athlete_id, coach_reviewed_at')
    .eq('status', 'completed')
    .in('athlete_id', athleteIds)
    .gte('date', lookbackSinceDate(lookbackDays));
  if (error) throw error;
  const rows = (data ?? []) as { athlete_id: string; coach_reviewed_at: string | null }[];

  const byAthlete = new Map<string, AthleteReviewStatus>();
  for (const r of rows) {
    let s = byAthlete.get(r.athlete_id);
    if (!s) {
      s = { athleteId: r.athlete_id, completed: 0, reviewed: 0 };
      byAthlete.set(r.athlete_id, s);
    }
    s.completed += 1;
    if (r.coach_reviewed_at != null) s.reviewed += 1;
  }
  // Most outstanding work first; fully-reviewed athletes sink to the bottom.
  return [...byAthlete.values()].sort(
    (a, b) => (b.completed - b.reviewed) - (a.completed - a.reviewed),
  );
}
