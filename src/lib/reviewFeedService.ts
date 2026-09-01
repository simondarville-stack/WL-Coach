/**
 * reviewFeedService — data layer for the coach Review feed (reel scroller).
 *
 * The feed is a snapshot of "everything new since I caught up", per coach:
 *   1. Athlete-uploaded videos in the lookback window
 *   2. Athlete messages/questions in the window (grouped per thread)
 *   3. Completed sessions in the window
 * minus what THIS coach has already seen (`review_feed_seen`). Seen state
 * is per coach on purpose: coaches sharing an athlete each get the full
 * feed — one coach reviewing never hides an item from the other, and the
 * cards surface every coach's comments/reactions so they see each other's
 * work.
 *
 * A thread's seen key is its latest athlete message id, so a newer
 * question makes the thread reappear for every coach.
 *
 * Items are sorted oldest-first so scrolling to the bottom means "fully
 * caught up". Marking seen ALSO stamps the legacy global markers
 * (coach_reviewed_at / coach_read_at) so the surfaces that read those
 * (log-mode "new footage" rings, inbox badge) stay consistent.
 */
import { supabase } from './supabase';
import { emitInboxChanged } from './inboxEvents';
import { fetchByIds } from './queryPaging';
import { METRIC_TRACKING_DEFAULTS } from './trainingLogModel';
import { plannedRowLabel } from './plannedRowLabel';
import type {
  AthleteMetricDefinition,
  AthleteWeekMetricsConfig,
  GppSection,
  TrainingLogExercise,
  TrainingLogMessage,
  TrainingLogSession,
  TrainingLogSet,
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
  /** Stable identity for React keys / in-feed tracking, e.g. `video:<id>`. */
  key: string;
  /** review_feed_seen item_key (the video id). */
  seenKey: string;
  /** ISO timestamp used for feed ordering (oldest first). */
  timestamp: string;
  athleteId: string;
  sessionId: string | null;
  /** Training date of the session the clip belongs to (YYYY-MM-DD). */
  sessionDate: string | null;
  exerciseName: string;
  video: TrainingLogVideo;
  /** Log exercise the clip hangs off — the technique rating writes here. */
  logExerciseId: string;
  /** Current 1–5 technique rating on that log exercise. */
  techniqueRating: number | null;
}

/** One message rendered on a thread card — athlete question or any
 *  coach's reply, so co-coaches see each other's answers. */
export interface ThreadMessage {
  id: string;
  senderType: 'athlete' | 'coach';
  /** Resolved coach name for coach messages; null for athlete messages
   *  (and for legacy coach rows without sender_coach_id). */
  coachName: string | null;
  message: string;
  createdAt: string;
  /** Coach messages only: the athlete has read it. One-way receipt — this
   *  feed is coach-facing; the athlete app never shows coach read state. */
  seenByAthlete: boolean;
}

export interface ReviewThreadItem {
  kind: 'thread';
  key: string;
  /** review_feed_seen item_key — the latest athlete message id, so a
   *  newer question makes the thread reappear for every coach. */
  seenKey: string;
  timestamp: string;
  athleteId: string;
  /** Null for the general (no-session) athlete↔coach thread. */
  sessionId: string | null;
  sessionDate: string | null;
  /** Recent thread context, oldest first — both parties, all coaches. */
  messages: ThreadMessage[];
  /** Athlete messages inside the window behind this card. */
  newCount: number;
}

/** A coach comment shown on a session card — from any coach with access,
 *  so shared-athlete coaches see each other's feedback. */
export interface CoachComment {
  id: string;
  coachName: string | null;
  message: string;
  createdAt: string;
}

export interface SessionReviewExercise {
  id: string;
  /** Display name resolved the same way log mode resolves it: coach
   *  display_name override > combo notation/members > GPP title >
   *  catalogue name (substituted exercise's name when the athlete logged
   *  a different lift than planned). */
  name: string;
  status: TrainingLogExercise['status'];
  /** Actually performed sets (what the athlete entered), by set_number.
   *  Preferred display source — LoggedStackedNotation. */
  sets: TrainingLogSet[];
  /** Fallback display when no set rows exist (StackedNotation). */
  performedRaw: string;
  performedNotes: string;
  /** Prescription unit from the planned row (kg / percentage / …) so a
   *  %-based performedRaw renders with the % sign. Null = unplanned. */
  unit: string | null;
  /** Combination exercise (coach-planned or athlete off-plan). */
  isCombo: boolean;
  /** Combo member names in position order; empty for non-combos. */
  comboMembers: string[];
  /** GPP container — athlete's live copy (done flags) with the planned
   *  section as fallback. */
  gpp: GppSection | null;
  /** Athlete-authored off-plan note body (TEXT sentinel row). */
  noteText: string | null;
  /** Athlete added this outside the plan. */
  offPlan: boolean;
  /** Coach's 1–5 technique rating for this exercise (null = unrated). */
  techniqueRating: number | null;
}

/** One display-ready metric chip on a session card. Value is formatted
 *  (comma decimals, unit); null = metric activated but not entered. */
export interface SessionMetricChip {
  key: string;
  label: string;
  value: string | null;
}

export interface ReviewSessionItem {
  kind: 'session';
  key: string;
  /** review_feed_seen item_key (the session id). */
  seenKey: string;
  timestamp: string;
  athleteId: string;
  session: TrainingLogSession;
  /** Metrics activated for this athlete/week (RAW, BW, VAS, customs). */
  metrics: SessionMetricChip[];
  exercises: SessionReviewExercise[];
  /** Existing coach comments on this session (every coach), oldest first. */
  coachComments: CoachComment[];
}

export type ReviewFeedItem = ReviewVideoItem | ReviewThreadItem | ReviewSessionItem;

// ─── Fetch ─────────────────────────────────────────────────────────────────

export interface FetchReviewFeedArgs {
  ownerId: string;
  /** Athletes visible to this coach — scopes every query. */
  athleteIds: string[];
  /** The window all three sources look back over. Ignored when an explicit
   *  windowFromIso is given (history paging). */
  lookbackDays: number;
  /** 'queue' (default): what THIS coach has not reviewed, oldest first.
   *  'history': what they HAVE reviewed, newest first — the feed's
   *  keep-scrolling-past-"all caught up" mode. */
  mode?: 'queue' | 'history';
  /** Explicit window start, overriding lookbackDays. History paging walks
   *  backwards in fixed chunks with these. */
  windowFromIso?: string;
  /** Exclusive window end. Omit for "up to now". */
  windowToIso?: string;
}

/** How far back one history page reaches, in days. Deeper scrollback pages
 *  in these chunks rather than fetching everything at once. */
export const REVIEW_HISTORY_PAGE_DAYS = 30;

/**
 * The window for one history page. Page 0 is the current lookback window
 * (up to now); each later page reaches another REVIEW_HISTORY_PAGE_DAYS
 * further back and ends exactly where the previous one started, so pages
 * tile the timeline without gaps or overlap.
 */
export function historyPageWindow(
  lookbackDays: number,
  pageIndex: number,
  nowMs: number = Date.now(),
): { windowFromIso: string; windowToIso?: string } {
  const fromDays = lookbackDays + pageIndex * REVIEW_HISTORY_PAGE_DAYS;
  const toDays =
    pageIndex === 0 ? 0 : lookbackDays + (pageIndex - 1) * REVIEW_HISTORY_PAGE_DAYS;
  return {
    windowFromIso: new Date(nowMs - fromDays * 86_400_000).toISOString(),
    ...(toDays === 0
      ? {}
      : { windowToIso: new Date(nowMs - toDays * 86_400_000).toISOString() }),
  };
}

interface SessionStub {
  id: string;
  date: string;
  athlete_id: string;
}

/** Keys this coach has already reviewed, as `${item_type}:${item_key}`.
 *  seen_at >= since is a safe bound: an item can't be seen before it exists,
 *  so rows older than the window can only belong to out-of-window items. */
async function fetchSeenKeySet(ownerId: string, sinceIso: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('review_feed_seen')
    .select('item_type, item_key')
    .eq('owner_id', ownerId)
    .gte('seen_at', sinceIso);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data ?? []) as { item_type: string; item_key: string }[]) {
    set.add(`${r.item_type}:${r.item_key}`);
  }
  return set;
}

export async function fetchReviewFeed(args: FetchReviewFeedArgs): Promise<ReviewFeedItem[]> {
  const { ownerId, athleteIds, lookbackDays, mode = 'queue' } = args;
  if (athleteIds.length === 0) return [];
  // An item cannot be seen before it exists, so bounding the seen lookup by
  // the window start is safe for every page — including deep history pages.
  const sinceIso =
    args.windowFromIso ?? new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const sinceDate = sinceIso.slice(0, 10);
  const untilIso = args.windowToIso ?? null;
  const untilDate = untilIso?.slice(0, 10) ?? null;

  // The three sources + this coach's seen set are independent — concurrent.
  const [videoRowsAll, messageRows, sessionRowsAll, seen] = await Promise.all([
    (async () => {
      let q = supabase
        .from('training_log_videos')
        .select('*')
        .eq('uploaded_by', 'athlete')
        .in('athlete_id', athleteIds)
        .gte('created_at', sinceIso);
      if (untilIso) q = q.lt('created_at', untilIso);
      const { data, error } = await q.order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingLogVideo[];
    })(),
    (async () => {
      let q = supabase
        .from('training_log_messages')
        .select('*')
        .eq('sender_type', 'athlete')
        .in('athlete_id', athleteIds)
        .gte('created_at', sinceIso);
      if (untilIso) q = q.lt('created_at', untilIso);
      const { data, error } = await q.order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingLogMessage[];
    })(),
    (async () => {
      let q = supabase
        .from('training_log_sessions')
        .select('*')
        .eq('status', 'completed')
        .in('athlete_id', athleteIds)
        .gte('date', sinceDate);
      if (untilDate) q = q.lt('date', untilDate);
      const { data, error } = await q.order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TrainingLogSession[];
    })(),
    fetchSeenKeySet(ownerId, sinceIso),
  ]);

  // Per-coach filtering: the queue drops what THIS coach has reviewed
  // (another coach's review never removes an item — that is the whole
  // point); history inverts the filter to show exactly those items.
  const keep = (isSeen: boolean) => (mode === 'history' ? isSeen : !isSeen);
  const videoRows = videoRowsAll.filter(v => keep(seen.has(`video:${v.id}`)));
  const sessionRows = sessionRowsAll.filter(s => keep(seen.has(`session:${s.id}`)));

  // ── Secondary lookups ────────────────────────────────────────────────────

  // Videos hang off log exercises; resolve exercise name + session.
  const videoLogExIds = [...new Set(videoRows.map(v => v.log_exercise_id))];
  const videoLogExs: Pick<TrainingLogExercise, 'id' | 'session_id' | 'exercise_id' | 'technique_rating'>[] =
    videoLogExIds.length === 0
      ? []
      : await (async () => {
          const { data, error } = await supabase
            .from('training_log_exercises')
            .select('id, session_id, exercise_id, technique_rating')
            .in('id', videoLogExIds);
          if (error) throw error;
          return (data ?? []) as Pick<TrainingLogExercise, 'id' | 'session_id' | 'exercise_id' | 'technique_rating'>[];
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

  // The performed sets behind those exercises (paged: 40 sessions of set
  // rows can exceed the 1000-row PostgREST cap), plus the metric config
  // and custom-metric definitions that decide which metrics to surface.
  const sessionAthleteIds = [...new Set(sessionRows.map(s => s.athlete_id))];
  const [setRows, metricConfigs, metricDefs] = await Promise.all([
    fetchByIds<TrainingLogSet>(sessionExs.map(ex => ex.id), (chunk, from, to) =>
      supabase
        .from('training_log_sets')
        .select('*')
        .in('log_exercise_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    (async () => {
      if (sessionAthleteIds.length === 0) return [] as AthleteWeekMetricsConfig[];
      const { data, error } = await supabase
        .from('athlete_week_metrics_config')
        .select('*')
        .in('athlete_id', sessionAthleteIds)
        .in('week_start', [...new Set(sessionRows.map(s => s.week_start))]);
      if (error) throw error;
      return (data ?? []) as AthleteWeekMetricsConfig[];
    })(),
    (async () => {
      if (sessionAthleteIds.length === 0) return [] as AthleteMetricDefinition[];
      const { data, error } = await supabase
        .from('athlete_metric_definitions')
        .select('*')
        .in('athlete_id', sessionAthleteIds);
      if (error) throw error;
      return (data ?? []) as AthleteMetricDefinition[];
    })(),
  ]);
  const setsByLogEx = new Map<string, TrainingLogSet[]>();
  for (const s of setRows) {
    const list = setsByLogEx.get(s.log_exercise_id) ?? [];
    list.push(s);
    setsByLogEx.set(s.log_exercise_id, list);
  }
  for (const list of setsByLogEx.values()) list.sort((a, b) => a.set_number - b.set_number);
  const configByAthleteWeek = new Map(
    metricConfigs.map(c => [`${c.athlete_id}|${c.week_start}`, c]),
  );
  const defById = new Map(metricDefs.map(d => [d.id, d]));

  // Planned rows behind the logged exercises: naming (coach display_name
  // override, combo notation), prescription unit, combo members, planned
  // GPP section. Thin columns only.
  const plannedIds = [
    ...new Set(
      sessionExs.map(ex => ex.planned_exercise_id).filter((id): id is string => id != null),
    ),
  ];
  const plannedRows = await fetchByIds<PlannedStub>(plannedIds, (chunk, from, to) =>
    supabase
      .from('planned_exercises')
      .select('id, exercise_id, unit, display_name, is_combo, combo_notation, metadata')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const plannedById = new Map(plannedRows.map(p => [p.id, p]));

  const comboPlannedIds = plannedRows.filter(p => p.is_combo).map(p => p.id);
  const comboMemberRows = await fetchByIds<ComboMemberRow>(comboPlannedIds, (chunk, from, to) =>
    supabase
      .from('planned_exercise_combo_members')
      .select('planned_exercise_id, exercise_id, position')
      .in('planned_exercise_id', chunk)
      .order('planned_exercise_id', { ascending: true })
      .order('position', { ascending: true })
      .range(from, to),
  );
  const comboMembersByPlanned = new Map<string, ComboMemberRow[]>();
  for (const m of comboMemberRows) {
    const list = comboMembersByPlanned.get(m.planned_exercise_id) ?? [];
    list.push(m);
    comboMembersByPlanned.set(m.planned_exercise_id, list);
  }

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

  // Exercise names (catalogue), for video cards and session summaries —
  // covers logged, planned and combo-member exercise ids in one lookup.
  const exerciseIds = new Set<string>();
  for (const le of videoLogExs) if (le.exercise_id) exerciseIds.add(le.exercise_id);
  for (const ex of sessionExs) if (ex.exercise_id) exerciseIds.add(ex.exercise_id);
  for (const p of plannedRows) if (p.exercise_id) exerciseIds.add(p.exercise_id);
  for (const m of comboMemberRows) exerciseIds.add(m.exercise_id);
  const exerciseNameById = new Map<string, string>();
  if (exerciseIds.size > 0) {
    const rows = await fetchByIds<{ id: string; name: string }>(
      [...exerciseIds],
      (chunk, from, to) =>
        supabase
          .from('exercises')
          .select('id, name')
          .in('id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
    );
    for (const row of rows) exerciseNameById.set(row.id, row.name);
  }

  // ── Threads: candidates, per-coach filtering, context ────────────────────

  // Group the window's athlete messages per thread; the latest message id is
  // the seen key, so a thread reappears the moment the athlete writes again.
  interface ThreadCandidate {
    threadKey: string;
    athleteId: string;
    sessionId: string | null;
    latestId: string;
    firstAt: string;
    newCount: number;
  }
  const candidateByThread = new Map<string, ThreadCandidate>();
  for (const m of messageRows) {
    if (!m.athlete_id) continue;
    const threadKey = m.session_id ? `session:${m.session_id}` : `general:${m.athlete_id}`;
    let c = candidateByThread.get(threadKey);
    if (!c) {
      c = {
        threadKey,
        athleteId: m.athlete_id,
        sessionId: m.session_id,
        latestId: m.id,
        firstAt: m.created_at,
        newCount: 0,
      };
      candidateByThread.set(threadKey, c);
    }
    c.latestId = m.id; // messageRows are ordered ascending
    c.newCount += 1;
  }
  const threadCandidates = [...candidateByThread.values()].filter(c =>
    keep(seen.has(`thread:${c.latestId}`)),
  );

  // Thread context (both parties, every coach) for the surviving threads,
  // and existing coach comments for the surviving session cards.
  const contextSessionIds = threadCandidates
    .map(c => c.sessionId)
    .filter((id): id is string => id != null);
  const contextGeneralAthleteIds = threadCandidates
    .filter(c => c.sessionId == null)
    .map(c => c.athleteId);
  const [sessionThreadMsgs, generalThreadMsgs, sessionCoachMsgs] = await Promise.all([
    contextSessionIds.length === 0
      ? Promise.resolve([] as TrainingLogMessage[])
      : (async () => {
          const { data, error } = await supabase
            .from('training_log_messages')
            .select('*')
            .in('session_id', contextSessionIds)
            .order('created_at', { ascending: true });
          if (error) throw error;
          return (data ?? []) as TrainingLogMessage[];
        })(),
    contextGeneralAthleteIds.length === 0
      ? Promise.resolve([] as TrainingLogMessage[])
      : (async () => {
          const { data, error } = await supabase
            .from('training_log_messages')
            .select('*')
            .is('session_id', null)
            .in('athlete_id', contextGeneralAthleteIds)
            .order('created_at', { ascending: true });
          if (error) throw error;
          return (data ?? []) as TrainingLogMessage[];
        })(),
    sessionRows.length === 0
      ? Promise.resolve([] as TrainingLogMessage[])
      : (async () => {
          const { data, error } = await supabase
            .from('training_log_messages')
            .select('*')
            .eq('sender_type', 'coach')
            .in('session_id', sessionRows.map(s => s.id))
            .order('created_at', { ascending: true });
          if (error) throw error;
          return (data ?? []) as TrainingLogMessage[];
        })(),
  ]);

  // Names for every coach appearing in threads or comments.
  const coachIds = new Set<string>();
  for (const m of [...sessionThreadMsgs, ...generalThreadMsgs, ...sessionCoachMsgs]) {
    if (m.sender_coach_id) coachIds.add(m.sender_coach_id);
  }
  const coachNameById = new Map<string, string>();
  if (coachIds.size > 0) {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select('id, name')
      .in('id', [...coachIds]);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; name: string }[]) {
      coachNameById.set(row.id, row.name);
    }
  }
  const toThreadMessage = (m: TrainingLogMessage): ThreadMessage => ({
    id: m.id,
    senderType: m.sender_type,
    coachName:
      m.sender_type === 'coach'
        ? (m.sender_coach_id && coachNameById.get(m.sender_coach_id)) || 'Coach'
        : null,
    message: m.message,
    createdAt: m.created_at,
    seenByAthlete: m.sender_type === 'coach' && m.athlete_read_at != null,
  });
  const contextByThread = new Map<string, TrainingLogMessage[]>();
  for (const m of [...sessionThreadMsgs, ...generalThreadMsgs]) {
    const threadKey = m.session_id ? `session:${m.session_id}` : `general:${m.athlete_id}`;
    const list = contextByThread.get(threadKey) ?? [];
    list.push(m);
    contextByThread.set(threadKey, list);
  }
  const coachCommentsBySession = new Map<string, CoachComment[]>();
  for (const m of sessionCoachMsgs) {
    if (!m.session_id) continue;
    const list = coachCommentsBySession.get(m.session_id) ?? [];
    list.push({
      id: m.id,
      coachName: (m.sender_coach_id && coachNameById.get(m.sender_coach_id)) || 'Coach',
      message: m.message,
      createdAt: m.created_at,
    });
    coachCommentsBySession.set(m.session_id, list);
  }

  // ── Assemble ─────────────────────────────────────────────────────────────

  const items: ReviewFeedItem[] = [];

  for (const v of videoRows) {
    const le = logExById.get(v.log_exercise_id);
    const session = le ? sessionStubById.get(le.session_id) : undefined;
    items.push({
      kind: 'video',
      key: `video:${v.id}`,
      seenKey: v.id,
      timestamp: v.created_at,
      athleteId: v.athlete_id,
      sessionId: le?.session_id ?? null,
      sessionDate: session?.date ?? null,
      exerciseName:
        (le?.exercise_id && exerciseNameById.get(le.exercise_id)) || 'Exercise',
      video: v,
      logExerciseId: v.log_exercise_id,
      techniqueRating: le?.technique_rating ?? null,
    });
  }

  const THREAD_CONTEXT_LIMIT = 8;
  for (const c of threadCandidates) {
    const context = (contextByThread.get(c.threadKey) ?? []).slice(-THREAD_CONTEXT_LIMIT);
    items.push({
      kind: 'thread',
      key: `thread:${c.threadKey}`,
      seenKey: c.latestId,
      timestamp: c.firstAt,
      athleteId: c.athleteId,
      sessionId: c.sessionId,
      sessionDate: c.sessionId ? sessionStubById.get(c.sessionId)?.date ?? null : null,
      messages: context.map(toThreadMessage),
      newCount: c.newCount,
    });
  }

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
      seenKey: s.id,
      timestamp: s.completed_at ?? `${s.date}T23:59:59Z`,
      athleteId: s.athlete_id,
      session: s,
      metrics: buildSessionMetricChips(
        s,
        configByAthleteWeek.get(`${s.athlete_id}|${s.week_start}`) ?? null,
        defById,
      ),
      exercises: (exsBySession.get(s.id) ?? []).map(ex =>
        buildSessionReviewExercise(ex, {
          planned: ex.planned_exercise_id
            ? plannedById.get(ex.planned_exercise_id) ?? null
            : null,
          comboMembersByPlanned,
          exerciseNameById,
          sets: setsByLogEx.get(ex.id) ?? [],
        }),
      ),
      coachComments: coachCommentsBySession.get(s.id) ?? [],
    });
  }

  // Queue reads oldest→newest so the bottom means caught up; history reads
  // newest→oldest — diving back in time from the "all caught up" card.
  items.sort((a, b) =>
    mode === 'history'
      ? b.timestamp.localeCompare(a.timestamp)
      : a.timestamp.localeCompare(b.timestamp),
  );
  return items;
}

/** Thin naming/unit slice of a planned_exercises row. */
interface PlannedStub {
  id: string;
  exercise_id: string;
  unit: string | null;
  display_name: string | null;
  is_combo: boolean;
  combo_notation: string | null;
  metadata: { gpp?: GppSection } | null;
}

interface ComboMemberRow {
  planned_exercise_id: string;
  exercise_id: string;
  position: number;
}

/**
 * Resolve one logged exercise into its display shape, mirroring the rules
 * LogExerciseRow applies: athlete off-plan combos name themselves from
 * metadata.combo; planned rows resolve through plannedRowLabel (coach
 * display_name override > combo notation > members joined > catalogue
 * name); a substituted lift shows the logged exercise's name; GPP rows
 * take the section title (planned copy first) and merge the athlete's
 * done-flagged rows over the planned section.
 */
function buildSessionReviewExercise(
  ex: TrainingLogExercise,
  ctx: {
    planned: PlannedStub | null;
    comboMembersByPlanned: Map<string, ComboMemberRow[]>;
    exerciseNameById: Map<string, string>;
    sets: TrainingLogSet[];
  },
): SessionReviewExercise {
  const { planned, comboMembersByPlanned, exerciseNameById, sets } = ctx;
  const catalogueName = (id: string | null) => (id ? exerciseNameById.get(id) ?? null : null);

  const athleteGpp = (ex.metadata?.gpp as GppSection | undefined) ?? null;
  const plannedGpp = planned?.metadata?.gpp ?? null;
  // Athlete copy carries the done flags/edits; planned copy is the fallback
  // for rows, but the header (title/description) prefers the coach's section.
  const headerGpp = plannedGpp ?? athleteGpp;
  const gpp: GppSection | null =
    athleteGpp || plannedGpp
      ? {
          title: headerGpp?.title ?? 'GPP',
          description: headerGpp?.description ?? '',
          rows: (athleteGpp ?? plannedGpp)?.rows ?? [],
        }
      : null;

  const offPlanCombo = !planned ? ex.metadata?.combo ?? null : null;
  const plannedMembers = planned?.is_combo
    ? (comboMembersByPlanned.get(planned.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
    : [];
  const comboMembers: string[] = offPlanCombo
    ? offPlanCombo.members
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(m => m.name)
        .filter(Boolean)
    : plannedMembers
        .map(m => catalogueName(m.exercise_id))
        .filter((n): n is string => !!n);
  const isCombo = offPlanCombo != null || (planned?.is_combo ?? false);

  const substituted =
    planned != null && ex.exercise_id != null && ex.exercise_id !== planned.exercise_id;

  let name: string;
  if (gpp) {
    name = gpp.title.trim() || 'GPP';
  } else if (offPlanCombo) {
    name = offPlanCombo.name?.trim() || comboMembers.join(' + ') || '(combination)';
  } else if (substituted) {
    name = catalogueName(ex.exercise_id) ?? '(unknown exercise)';
  } else if (planned) {
    name = plannedRowLabel(planned, {
      memberNames: comboMembers,
      exerciseName: catalogueName(planned.exercise_id),
      fallback: catalogueName(ex.exercise_id) ?? 'Exercise',
    });
  } else {
    name = catalogueName(ex.exercise_id) ?? (ex.metadata?.text ? 'Note' : 'Exercise');
  }

  return {
    id: ex.id,
    name,
    status: ex.status,
    sets,
    performedRaw: ex.performed_raw,
    performedNotes: ex.performed_notes,
    unit: planned?.unit ?? null,
    isCombo,
    comboMembers,
    gpp,
    noteText: ex.metadata?.text ?? null,
    offPlan: ex.planned_exercise_id == null,
    techniqueRating: ex.technique_rating,
  };
}

/** German-locale comma decimals for metric values. */
function fmtNum(n: number): string {
  return String(n).replace('.', ',');
}

/**
 * Resolve which metrics are activated for this athlete/week and pair them
 * with the values the athlete entered on this session. No config row falls
 * back to the product default (RAW + bodyweight on, VAS off) — the same
 * rule SessionHeader / LogWeekOverview apply.
 */
function buildSessionMetricChips(
  s: TrainingLogSession,
  config: AthleteWeekMetricsConfig | null,
  defById: Map<string, AthleteMetricDefinition>,
): SessionMetricChip[] {
  const track = config ?? METRIC_TRACKING_DEFAULTS;
  const chips: SessionMetricChip[] = [];

  if (track.track_raw) {
    const pillars: [string, number | null][] = [
      ['Sleep', s.raw_sleep],
      ['Phys', s.raw_physical],
      ['Mood', s.raw_mood],
      ['Nutr', s.raw_nutrition],
    ];
    if (pillars.every(([, v]) => v == null)) {
      // Activated but nothing entered — one quiet chip, not four empty ones.
      chips.push({ key: 'raw', label: 'RAW', value: null });
    } else {
      for (const [label, v] of pillars) {
        chips.push({ key: `raw:${label}`, label, value: v == null ? null : fmtNum(v) });
      }
      const total =
        s.raw_total ??
        (pillars.every(([, v]) => v != null)
          ? pillars.reduce((sum, [, v]) => sum + (v as number), 0)
          : null);
      chips.push({ key: 'raw', label: 'RAW', value: total == null ? null : fmtNum(total) });
    }
  }
  if (track.track_bodyweight) {
    chips.push({
      key: 'bw',
      label: 'BW',
      value: s.bodyweight_kg == null ? null : `${fmtNum(s.bodyweight_kg)} kg`,
    });
  }
  if (track.track_vas) {
    chips.push({ key: 'vas', label: 'VAS', value: s.vas_score == null ? null : fmtNum(s.vas_score) });
  }

  for (const id of config?.enabled_custom_metric_ids ?? []) {
    const def = defById.get(id);
    if (!def || def.archived_at != null) continue;
    const entry = s.custom_metrics?.[id];
    const value =
      entry == null
        ? null
        : entry.value_number != null
          ? `${fmtNum(entry.value_number)}${def.unit ? ` ${def.unit}` : ''}`
          : entry.value_text ?? null;
    chips.push({ key: `custom:${id}`, label: def.label, value });
  }

  return chips;
}

// ─── Example cards (demo mode) ─────────────────────────────────────────────

/** Marks a feed item as a non-persisting example card. */
export const DEMO_KEY_PREFIX = 'demo:';

/**
 * Example video + question cards for the scroller's "Show examples" mode,
 * so a coach can see those card types before athletes have produced any.
 * The question card reuses the athlete's most recent real message thread
 * (read-only — demo cards never mark or send); the video card plays a CC0
 * sample clip because no athlete clip exists yet.
 */
export async function fetchExampleCards(athleteIds: string[]): Promise<ReviewFeedItem[]> {
  const items: ReviewFeedItem[] = [];
  const now = new Date().toISOString();

  // Question card: latest real athlete message, plus up to two more from
  // the same thread for context.
  let threadAthleteId: string | null = null;
  if (athleteIds.length > 0) {
    const { data } = await supabase
      .from('training_log_messages')
      .select('*')
      .eq('sender_type', 'athlete')
      .in('athlete_id', athleteIds)
      .order('created_at', { ascending: false })
      .limit(1);
    const latest = ((data ?? []) as TrainingLogMessage[])[0];
    if (latest?.athlete_id) {
      threadAthleteId = latest.athlete_id;
      let q = supabase
        .from('training_log_messages')
        .select('*')
        .eq('sender_type', 'athlete')
        .eq('athlete_id', latest.athlete_id)
        .order('created_at', { ascending: false })
        .limit(3);
      q = latest.session_id ? q.eq('session_id', latest.session_id) : q.is('session_id', null);
      const { data: threadData } = await q;
      const messages = ((threadData ?? []) as TrainingLogMessage[]).reverse();
      let sessionDate: string | null = null;
      if (latest.session_id) {
        const { data: sess } = await supabase
          .from('training_log_sessions')
          .select('date')
          .eq('id', latest.session_id)
          .maybeSingle();
        sessionDate = (sess as { date: string } | null)?.date ?? null;
      }
      items.push({
        kind: 'thread',
        key: `${DEMO_KEY_PREFIX}thread`,
        seenKey: `${DEMO_KEY_PREFIX}thread`,
        timestamp: latest.created_at,
        athleteId: latest.athlete_id,
        sessionId: latest.session_id,
        sessionDate,
        messages: messages.map(m => ({
          id: m.id,
          senderType: m.sender_type,
          coachName: m.sender_type === 'coach' ? 'Coach' : null,
          message: m.message,
          createdAt: m.created_at,
          seenByAthlete: m.sender_type === 'coach' && m.athlete_read_at != null,
        })),
        newCount: messages.filter(m => m.sender_type === 'athlete').length,
      });
    }
  }

  // Video card: synthetic row around a CC0 sample clip (MDN media library).
  items.push({
    kind: 'video',
    key: `${DEMO_KEY_PREFIX}video`,
    seenKey: `${DEMO_KEY_PREFIX}video`,
    timestamp: now,
    athleteId: threadAthleteId ?? athleteIds[0] ?? '',
    sessionId: null,
    sessionDate: now.slice(0, 10),
    exerciseName: 'Snatch',
    video: {
      id: 'demo-video',
      log_exercise_id: 'demo',
      athlete_id: threadAthleteId ?? athleteIds[0] ?? '',
      set_number: 3,
      // Tagged to a set, so the load and reps come from that set row.
      performed_load: null,
      performed_reps: null,
      video_url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      storage_path: null,
      thumbnail_url: null,
      description: 'Example clip — a real card plays the video the athlete attached to a set.',
      uploaded_by: 'athlete',
      coach_reviewed_at: null,
      owner_id: null,
      created_at: now,
    },
    logExerciseId: 'demo',
    techniqueRating: null,
  });

  return items;
}

// ─── Seen markers ──────────────────────────────────────────────────────────

export type ReviewItemType = 'video' | 'thread' | 'session';

/**
 * Record that THIS coach has reviewed one feed item. Per-coach on purpose:
 * it never hides the item from other coaches. Idempotent (unique on
 * owner/type/key, duplicates ignored).
 */
export async function markReviewItemSeen(
  ownerId: string,
  itemType: ReviewItemType,
  itemKey: string,
): Promise<void> {
  const { error } = await supabase
    .from('review_feed_seen')
    .upsert(
      { owner_id: ownerId, item_type: itemType, item_key: itemKey },
      { onConflict: 'owner_id,item_type,item_key', ignoreDuplicates: true },
    );
  if (error) throw error;
  emitInboxChanged();
}

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
 * Cheap card count for the badges — same window + per-coach seen filtering
 * as fetchReviewFeed, over thin id-only selects.
 */
export async function fetchReviewFeedCounts(
  ownerId: string,
  athleteIds: string[],
  lookbackDays: number = REVIEW_SESSION_LOOKBACK_DAYS,
): Promise<ReviewFeedCounts> {
  if (athleteIds.length === 0) return { videos: 0, threads: 0, sessions: 0, total: 0 };
  const sinceDate = lookbackSinceDate(lookbackDays);
  const sinceIso = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  const [videoIds, threadRows, sessionIds, seen] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from('training_log_videos')
        .select('id')
        .eq('uploaded_by', 'athlete')
        .in('athlete_id', athleteIds)
        .gte('created_at', sinceIso);
      if (error) throw error;
      return ((data ?? []) as { id: string }[]).map(r => r.id);
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('training_log_messages')
        .select('id, session_id, athlete_id, created_at')
        .eq('sender_type', 'athlete')
        .in('athlete_id', athleteIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; session_id: string | null; athlete_id: string | null }[];
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('training_log_sessions')
        .select('id')
        .eq('status', 'completed')
        .in('athlete_id', athleteIds)
        .gte('date', sinceDate);
      if (error) throw error;
      return ((data ?? []) as { id: string }[]).map(r => r.id);
    })(),
    fetchSeenKeySet(ownerId, sinceIso),
  ]);

  // Threads count by their latest athlete message id — same rule as the feed.
  const latestByThread = new Map<string, string>();
  for (const r of threadRows) {
    if (!r.athlete_id) continue;
    const key = r.session_id ? `session:${r.session_id}` : `general:${r.athlete_id}`;
    latestByThread.set(key, r.id); // ascending order → last write wins
  }

  const videos = videoIds.filter(id => !seen.has(`video:${id}`)).length;
  const sessions = sessionIds.filter(id => !seen.has(`session:${id}`)).length;
  const threads = [...latestByThread.values()].filter(id => !seen.has(`thread:${id}`)).length;
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
 * Reviewed-vs-completed per athlete over the lookback window, from THIS
 * coach's perspective (review_feed_seen) — a co-coach's reviews do not
 * count as yours. Athletes with no completed sessions are omitted.
 */
export async function fetchReviewStatusByAthlete(
  ownerId: string,
  athleteIds: string[],
  lookbackDays: number = REVIEW_SESSION_LOOKBACK_DAYS,
): Promise<AthleteReviewStatus[]> {
  if (athleteIds.length === 0) return [];
  const sinceIso = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const [rows, seen] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from('training_log_sessions')
        .select('id, athlete_id')
        .eq('status', 'completed')
        .in('athlete_id', athleteIds)
        .gte('date', lookbackSinceDate(lookbackDays));
      if (error) throw error;
      return (data ?? []) as { id: string; athlete_id: string }[];
    })(),
    fetchSeenKeySet(ownerId, sinceIso),
  ]);

  const byAthlete = new Map<string, AthleteReviewStatus>();
  for (const r of rows) {
    let s = byAthlete.get(r.athlete_id);
    if (!s) {
      s = { athleteId: r.athlete_id, completed: 0, reviewed: 0 };
      byAthlete.set(r.athlete_id, s);
    }
    s.completed += 1;
    if (seen.has(`session:${r.id}`)) s.reviewed += 1;
  }
  // Most outstanding work first; fully-reviewed athletes sink to the bottom.
  return [...byAthlete.values()].sort(
    (a, b) => (b.completed - b.reviewed) - (a.completed - a.reviewed),
  );
}
