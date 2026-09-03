/**
 * videoLibrary — the KinEMOS library read.
 *
 * The library is a UNION of the three places an EMOS video already lives, not
 * a fourth copy of them:
 *
 *   1. `training_log_videos` — athlete/coach clips against a logged exercise.
 *      These arrive with the most context in the app: athlete, exercise,
 *      training date, and the load that was actually lifted.
 *   2. `event_videos` — competition attempt footage.
 *   3. `kinemos_videos` — direct imports, the only rows KinEMOS itself writes
 *      (see the migration's header for why the other two are not mirrored).
 *
 * Mirroring rows into one table would have been less code here and a
 * synchronisation problem forever: a clip deleted from the log would linger in
 * the library, and a re-upload would double it. Reading three sources costs
 * three queries and cannot drift.
 *
 * Load resolution deserves a note. A log clip is rarely tagged with a set
 * number — in practice athletes film the exercise, not set 3 of it — so an
 * exact set match would leave the column empty on almost every row. When the
 * clip names a set, that set's load is shown; otherwise the exercise's
 * heaviest completed set is, flagged via `loadIsTopSet` so the UI can mark it
 * rather than quietly implying the clip shows that lift. P2 needs an exact
 * mass for power and will ask; this is the display-time best guess.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllRows, fetchByIds } from '../../lib/queryPaging';
import { isStreamPlaybackUrl } from '../../lib/streamUploads';
import { kinemosObjectUrl } from './kinemosStorage';

export type LibrarySource = 'log' | 'event' | 'direct';

export interface LibraryVideo {
  /** Stable React key and cross-surface identity, e.g. `log:<uuid>`. */
  key: string;
  source: LibrarySource;
  /** Row id within the source table. */
  sourceId: string;

  athleteId: string | null;
  athleteName: string | null;
  exerciseName: string | null;

  /** Training/competition date (YYYY-MM-DD) where one exists, else the day
   *  the clip was recorded or imported. Drives the library's sort. */
  date: string | null;
  /** Exact ISO timestamp behind `date`, used as the sort tiebreaker. */
  sortedAt: string;

  loadKg: number | null;
  /** The load shown is the exercise's top set, not a set this clip names. */
  loadIsTopSet: boolean;

  durationS: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;

  /** The phone, where the container kept it. Only direct imports carry it —
   *  a log clip has been through Stream and arrives stripped — and it is
   *  what a lens profile is looked up by (design §6.1's model tier). */
  deviceMake: string | null;
  deviceModel: string | null;

  /** What a player should load. For Stream-hosted log clips this is an
   *  iframe embed URL, not a media file — see `isEmbed`. */
  playbackUrl: string;
  /** Playback goes through an <iframe> rather than a <video>. Also means the
   *  original file is not directly reachable, which P1 has to solve before
   *  such a clip can be analysed (docs/KINEMOS_P0_PLAN.md §4). */
  isEmbed: boolean;
  thumbnailUrl: string | null;

  note: string | null;

  /** Where the clip lives, for surfaces that navigate back to it. Routing is
   *  left to the component: opening a logged session means selecting its
   *  athlete first (App's handleNavigateToPlanner does both), which is store
   *  work this data layer has no business doing. Null on direct imports —
   *  they live in the library and nowhere else. */
  sessionId: string | null;
  eventId: string | null;
}

export interface LibraryFilters {
  athleteId?: string | null;
  exerciseName?: string | null;
  source?: LibrarySource | null;
  /** Only clips with no athlete attached — the seminar/other-club footage. */
  unattachedOnly?: boolean;
  /** Inclusive YYYY-MM-DD bounds on `date`. */
  from?: string | null;
  to?: string | null;
}

// ─── Row shapes (only the columns this module reads) ────────────────────────

interface LogVideoRow {
  id: string;
  log_exercise_id: string;
  athlete_id: string;
  set_number: number | null;
  video_url: string;
  thumbnail_url: string | null;
  description: string | null;
  created_at: string;
}

interface LogExerciseRow {
  id: string;
  session_id: string;
  exercise_id: string | null;
}

interface LogSetRow {
  log_exercise_id: string;
  set_number: number;
  performed_load: number | null;
  status: string | null;
}

interface EventVideoRow {
  id: string;
  event_id: string;
  athlete_id: string;
  lift_type: 'snatch' | 'clean_jerk';
  attempt_number: number;
  video_url: string;
  description: string | null;
  created_at: string;
}

interface KinemosVideoRow {
  id: string;
  athlete_id: string | null;
  exercise_id: string | null;
  r2_key: string;
  thumb_key: string | null;
  original_name: string | null;
  duration_s: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  device_make: string | null;
  device_model: string | null;
  recorded_at: string | null;
  note: string | null;
  created_at: string;
}

const dayOf = (iso: string): string => iso.slice(0, 10);

/** Competition lifts are the two contested ones; the library shows that
 *  rather than an empty exercise cell. */
const LIFT_LABEL: Record<'snatch' | 'clean_jerk', string> = {
  snatch: 'Snatch',
  clean_jerk: 'Clean & Jerk',
};

// ─── Source reads ──────────────────────────────────────────────────────────

async function loadLogVideos(): Promise<LogVideoRow[]> {
  return fetchAllRows<LogVideoRow>((from, to) =>
    supabase
      .from('training_log_videos')
      .select('id, log_exercise_id, athlete_id, set_number, video_url, thumbnail_url, description, created_at')
      // Unique tiebreaker: created_at alone can repeat across a batch upload,
      // and queryPaging requires a total order or pages can skip rows.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
}

async function loadEventVideos(): Promise<EventVideoRow[]> {
  return fetchAllRows<EventVideoRow>((from, to) =>
    supabase
      .from('event_videos')
      .select('id, event_id, athlete_id, lift_type, attempt_number, video_url, description, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
}

async function loadDirectVideos(): Promise<KinemosVideoRow[]> {
  return fetchAllRows<KinemosVideoRow>((from, to) =>
    supabase
      .from('kinemos_videos')
      .select(
        'id, athlete_id, exercise_id, r2_key, thumb_key, original_name, duration_s, fps, width, height, device_make, device_model, recorded_at, note, created_at',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
}

// ─── Assembly ──────────────────────────────────────────────────────────────

/**
 * Read the whole library, newest first.
 *
 * Filters are applied after assembly rather than pushed into each query: the
 * three sources filter on different columns (a log clip's date lives on its
 * session, an event clip's on its event), and at the scale this table is read
 * at — a season of footage — one pass in memory is simpler and cheaper than
 * three parameterised queries plus their edge cases.
 */
export async function loadLibrary(filters: LibraryFilters = {}): Promise<LibraryVideo[]> {
  const [logVideos, eventVideos, directVideos] = await Promise.all([
    loadLogVideos(),
    loadEventVideos(),
    loadDirectVideos(),
  ]);

  // Context lookups, one round trip each rather than one per row.
  const logExerciseIds = [...new Set(logVideos.map(v => v.log_exercise_id))];
  const logExercises = await fetchByIds<LogExerciseRow>(logExerciseIds, (chunk, from, to) =>
    supabase
      .from('training_log_exercises')
      .select('id, session_id, exercise_id')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const logExerciseById = new Map(logExercises.map(le => [le.id, le]));

  const sessionIds = [...new Set(logExercises.map(le => le.session_id))];
  const sessions = await fetchByIds<{ id: string; date: string; athlete_id: string }>(
    sessionIds,
    (chunk, from, to) =>
      supabase
        .from('training_log_sessions')
        .select('id, date, athlete_id')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
  );
  const sessionById = new Map(sessions.map(s => [s.id, s]));

  const sets = await fetchByIds<LogSetRow>(logExerciseIds, (chunk, from, to) =>
    supabase
      .from('training_log_sets')
      .select('log_exercise_id, set_number, performed_load, status')
      .in('log_exercise_id', chunk)
      .order('log_exercise_id', { ascending: true })
      .order('set_number', { ascending: true })
      .range(from, to),
  );
  const setsByExercise = new Map<string, LogSetRow[]>();
  for (const s of sets) {
    const list = setsByExercise.get(s.log_exercise_id);
    if (list) list.push(s);
    else setsByExercise.set(s.log_exercise_id, [s]);
  }

  const eventIds = [...new Set(eventVideos.map(v => v.event_id))];
  const events = await fetchByIds<{ id: string; name: string; event_date: string | null }>(
    eventIds,
    (chunk, from, to) =>
      supabase
        .from('events')
        .select('id, name, event_date')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
  );
  const eventById = new Map(events.map(e => [e.id, e]));

  const exerciseIds = [
    ...new Set([
      ...logExercises.map(le => le.exercise_id).filter((id): id is string => !!id),
      ...directVideos.map(v => v.exercise_id).filter((id): id is string => !!id),
    ]),
  ];
  const exercises = await fetchByIds<{ id: string; name: string }>(exerciseIds, (chunk, from, to) =>
    supabase
      .from('exercises')
      .select('id, name')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const exerciseNameById = new Map(exercises.map(e => [e.id, e.name]));

  const athleteIds = [
    ...new Set(
      [
        ...logVideos.map(v => v.athlete_id),
        ...eventVideos.map(v => v.athlete_id),
        ...directVideos.map(v => v.athlete_id),
      ].filter((id): id is string => !!id),
    ),
  ];
  const athletes = await fetchByIds<{ id: string; name: string }>(athleteIds, (chunk, from, to) =>
    supabase
      .from('athletes')
      .select('id, name')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const athleteNameById = new Map(athletes.map(a => [a.id, a.name]));

  const items: LibraryVideo[] = [];

  for (const v of logVideos) {
    const le = logExerciseById.get(v.log_exercise_id);
    const session = le ? sessionById.get(le.session_id) : undefined;
    const exerciseSets = setsByExercise.get(v.log_exercise_id) ?? [];

    // Tagged set wins; otherwise the heaviest completed set stands in, marked.
    const tagged =
      v.set_number != null ? exerciseSets.find(s => s.set_number === v.set_number) : undefined;
    const topSet = exerciseSets
      .filter(s => s.status === 'completed' && s.performed_load != null)
      .reduce<LogSetRow | null>(
        (best, s) => (best == null || (s.performed_load ?? 0) > (best.performed_load ?? 0) ? s : best),
        null,
      );
    const loadSource = tagged ?? topSet;

    items.push({
      key: `log:${v.id}`,
      source: 'log',
      sourceId: v.id,
      athleteId: v.athlete_id,
      athleteName: athleteNameById.get(v.athlete_id) ?? null,
      // Catalogue name, matching how the Review feed labels the same clips.
      // Log mode's fuller resolution (coach overrides, combo notation, GPP
      // titles) lives in `buildSessionReviewExercise` and needs the planned
      // row; the library does not load planned data, and a catalogue name is
      // the right altitude for a filterable list.
      exerciseName: le?.exercise_id ? exerciseNameById.get(le.exercise_id) ?? null : null,
      date: session?.date ?? dayOf(v.created_at),
      sortedAt: v.created_at,
      loadKg: loadSource?.performed_load ?? null,
      loadIsTopSet: tagged == null && topSet != null,
      durationS: null,
      fps: null,
      width: null,
      height: null,
      deviceMake: null,
      deviceModel: null,
      playbackUrl: v.video_url,
      isEmbed: isStreamPlaybackUrl(v.video_url),
      thumbnailUrl: v.thumbnail_url,
      note: v.description,
      sessionId: le?.session_id ?? null,
      eventId: null,
    });
  }

  for (const v of eventVideos) {
    const event = eventById.get(v.event_id);
    items.push({
      key: `event:${v.id}`,
      source: 'event',
      sourceId: v.id,
      athleteId: v.athlete_id,
      athleteName: athleteNameById.get(v.athlete_id) ?? null,
      exerciseName: `${LIFT_LABEL[v.lift_type]} ${v.attempt_number}`,
      date: event?.event_date ?? dayOf(v.created_at),
      sortedAt: v.created_at,
      loadKg: null,
      loadIsTopSet: false,
      durationS: null,
      fps: null,
      width: null,
      height: null,
      deviceMake: null,
      deviceModel: null,
      playbackUrl: v.video_url,
      isEmbed: isStreamPlaybackUrl(v.video_url),
      thumbnailUrl: null,
      note: v.description ?? event?.name ?? null,
      sessionId: null,
      eventId: v.event_id,
    });
  }

  for (const v of directVideos) {
    items.push({
      key: `direct:${v.id}`,
      source: 'direct',
      sourceId: v.id,
      athleteId: v.athlete_id,
      athleteName: v.athlete_id ? athleteNameById.get(v.athlete_id) ?? null : null,
      exerciseName: v.exercise_id ? exerciseNameById.get(v.exercise_id) ?? null : null,
      date: dayOf(v.recorded_at ?? v.created_at),
      sortedAt: v.created_at,
      loadKg: null,
      loadIsTopSet: false,
      durationS: v.duration_s,
      fps: v.fps,
      width: v.width,
      height: v.height,
      deviceMake: v.device_make,
      deviceModel: v.device_model,
      playbackUrl: kinemosObjectUrl(v.r2_key),
      isEmbed: false,
      thumbnailUrl: v.thumb_key ? kinemosObjectUrl(v.thumb_key) : null,
      note: v.note ?? v.original_name,
      sessionId: null,
      eventId: null,
    });
  }

  return applyFilters(items, filters).sort((a, b) => {
    const byDate = (b.date ?? '').localeCompare(a.date ?? '');
    return byDate !== 0 ? byDate : b.sortedAt.localeCompare(a.sortedAt);
  });
}

export function applyFilters(items: LibraryVideo[], filters: LibraryFilters): LibraryVideo[] {
  return items.filter(item => {
    if (filters.source && item.source !== filters.source) return false;
    if (filters.unattachedOnly && item.athleteId) return false;
    if (filters.athleteId && item.athleteId !== filters.athleteId) return false;
    if (
      filters.exerciseName &&
      (item.exerciseName ?? '').toLowerCase() !== filters.exerciseName.toLowerCase()
    ) {
      return false;
    }
    if (filters.from && (item.date ?? '') < filters.from) return false;
    if (filters.to && (item.date ?? '') > filters.to) return false;
    return true;
  });
}

/**
 * One library row by its `key`. The viewer opens on a key from the URL, and
 * needs the same context the table shows: athlete, exercise, date, load,
 * playback URL.
 *
 * Implemented as a filtered full read rather than a targeted query, because
 * "one row" means a different table per source and the join that resolves an
 * athlete name and a logged load already lives in `loadLibrary`. That is a
 * deliberate reuse-over-speed trade at a season of footage, and it moves to
 * keyset paging together with the library's own read when that read outgrows
 * a single pass (docs/KINEMOS_P0_PLAN.md W3).
 */
export async function loadClipByKey(key: string): Promise<LibraryVideo | null> {
  const all = await loadLibrary();
  return all.find(item => item.key === key) ?? null;
}
