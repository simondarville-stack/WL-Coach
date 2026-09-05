import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── In-memory PostgREST stand-in ──────────────────────────────────────────
//
// Enough of the supabase-js query builder for reviewFeedService's reads:
// eq / in / is / gte / lt filters, order, range, limit, maybeSingle, and
// thenable resolution to `{ data, error }`. Writes are not modelled — the
// feed only reads here.

type Row = Record<string, unknown>;
const tables = new Map<string, Row[]>();

class FakeQuery implements PromiseLike<{ data: Row[] | Row | null; error: null }> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private from: number | null = null;
  private to: number | null = null;
  private max: number | null = null;
  private single = false;
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push(r => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    const set = new Set(vs);
    this.filters.push(r => set.has(r[col]));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push(r => (v === null ? r[col] == null : r[col] === v));
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push(r => String(r[col]) >= v);
    return this;
  }
  lt(col: string, v: string) {
    this.filters.push(r => String(r[col]) < v);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private run(): Row[] {
    let rows = (tables.get(this.table) ?? []).filter(r => this.filters.every(f => f(r)));
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.col] as string | number;
        const y = b[o.col] as string | number;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return o.asc ? c : -c;
      });
    }
    if (this.from != null && this.to != null) rows = rows.slice(this.from, this.to + 1);
    if (this.max != null) rows = rows.slice(0, this.max);
    return rows;
  }
  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: { data: Row[] | Row | null; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const rows = this.run();
    const data = this.single ? rows[0] ?? null : rows;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

vi.mock('../supabase', () => ({
  supabase: { from: (table: string) => new FakeQuery(table) },
}));
vi.mock('../inboxEvents', () => ({ emitInboxChanged: () => undefined }));

import {
  fetchReviewFeed,
  fetchReviewFeedCounts,
  fetchReviewStatusByAthlete,
  groupThreadCandidates,
  historyPageWindow,
  localDateOf,
  REVIEW_HISTORY_PAGE_DAYS,
} from '../reviewFeedService';

/** Fixed clock so the assertions are about the arithmetic, not the day. */
const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const daysBack = (iso: string) => Math.round((NOW - Date.parse(iso)) / DAY);

describe('historyPageWindow', () => {
  it('page 0 covers the current lookback window, open-ended at now', () => {
    const w = historyPageWindow(7, 0, NOW);
    expect(daysBack(w.windowFromIso)).toBe(7);
    // No upper bound: page 0 runs up to the present moment.
    expect(w.windowToIso).toBeUndefined();
  });

  it('each later page reaches one chunk further back', () => {
    const p1 = historyPageWindow(7, 1, NOW);
    expect(daysBack(p1.windowFromIso)).toBe(7 + REVIEW_HISTORY_PAGE_DAYS);
    expect(daysBack(p1.windowToIso!)).toBe(7);

    const p2 = historyPageWindow(7, 2, NOW);
    expect(daysBack(p2.windowFromIso)).toBe(7 + 2 * REVIEW_HISTORY_PAGE_DAYS);
    expect(daysBack(p2.windowToIso!)).toBe(7 + REVIEW_HISTORY_PAGE_DAYS);
  });

  it('pages tile the timeline with no gap or overlap', () => {
    // Each page must end exactly where the previous one began, or an item
    // falling on the boundary would be shown twice or not at all.
    for (const lookback of [7, 14, 30]) {
      for (let page = 1; page < 6; page++) {
        const prev = historyPageWindow(lookback, page - 1, NOW);
        const cur = historyPageWindow(lookback, page, NOW);
        expect(cur.windowToIso).toBe(prev.windowFromIso);
      }
    }
  });

  it('respects the caller lookback as the history starting edge', () => {
    // With a 30-day queue window, history starts at 30 days back, not 7.
    expect(daysBack(historyPageWindow(30, 0, NOW).windowFromIso)).toBe(30);
    expect(daysBack(historyPageWindow(30, 1, NOW).windowToIso!)).toBe(30);
  });
});

describe('groupThreadCandidates', () => {
  it('keys a thread by its latest athlete message and counts the new ones', () => {
    const rows = [
      { id: 'm1', athlete_id: 'a1', session_id: 's1', created_at: '2026-08-25T10:00:00Z' },
      { id: 'm2', athlete_id: 'a1', session_id: null, created_at: '2026-08-25T11:00:00Z' },
      { id: 'm3', athlete_id: 'a1', session_id: 's1', created_at: '2026-08-26T10:00:00Z' },
      { id: 'm4', athlete_id: null, session_id: 's9', created_at: '2026-08-26T11:00:00Z' },
    ];
    const out = groupThreadCandidates(rows);
    expect(out.map(c => [c.threadKey, c.latestId, c.newCount, c.firstAt])).toEqual([
      ['session:s1', 'm3', 2, '2026-08-25T10:00:00Z'],
      ['general:a1', 'm2', 1, '2026-08-25T11:00:00Z'],
    ]);
  });
});

// ─── Seen filtering against the window edges ───────────────────────────────

describe('per-coach seen filtering', () => {
  const owner = 'coach-1';
  const athlete = 'ath-1';
  /** A session on the first day of a 7-day window, completed and reviewed
   *  earlier in that day than the current clock time. */
  const boundaryDay = localDateOf(NOW - 7 * DAY);
  const session = {
    id: 'sess-boundary',
    athlete_id: athlete,
    status: 'completed',
    date: boundaryDay,
    week_start: boundaryDay,
    day_index: 0,
    completed_at: new Date(NOW - 7 * DAY - 4 * HOUR).toISOString(),
    raw_sleep: null,
    raw_physical: null,
    raw_mood: null,
    raw_nutrition: null,
    raw_total: null,
    bodyweight_kg: null,
    vas_score: null,
    custom_metrics: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    tables.clear();
    tables.set('training_log_sessions', [session]);
    tables.set('training_log_videos', []);
    tables.set('training_log_messages', []);
    tables.set('training_log_exercises', []);
    tables.set('athlete_week_metrics_config', []);
    tables.set('athlete_metric_definitions', []);
    tables.set('review_feed_seen', [
      {
        id: 'seen-1',
        owner_id: owner,
        item_type: 'session',
        item_key: session.id,
        // Three hours before "now minus the window" — inside the session's
        // day, but before the instant a seen_at bound would have started at.
        seen_at: new Date(NOW - 7 * DAY - 3 * HOUR).toISOString(),
      },
    ]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a boundary-day session reviewed earlier that day stays out of the queue', async () => {
    const queue = await fetchReviewFeed({ ownerId: owner, athleteIds: [athlete], lookbackDays: 7 });
    expect(queue).toEqual([]);
  });

  it('…and shows up in history instead', async () => {
    const history = await fetchReviewFeed({
      ownerId: owner,
      athleteIds: [athlete],
      lookbackDays: 7,
      mode: 'history',
      ...historyPageWindow(7, 0, NOW),
    });
    expect(history.map(i => i.key)).toEqual([`session:${session.id}`]);
  });

  it('the badge count and dashboard status agree with the feed', async () => {
    expect((await fetchReviewFeedCounts(owner, [athlete], 7)).total).toBe(0);
    expect(await fetchReviewStatusByAthlete(owner, [athlete], 7)).toEqual([
      { athleteId: athlete, completed: 1, reviewed: 1 },
    ]);
  });

  it('another coach still sees the session as unreviewed', async () => {
    const queue = await fetchReviewFeed({ ownerId: 'coach-2', athleteIds: [athlete], lookbackDays: 7 });
    expect(queue.map(i => i.key)).toEqual([`session:${session.id}`]);
    expect((await fetchReviewFeedCounts('coach-2', [athlete], 7)).total).toBe(1);
  });

  it('a thread whose latest message was reviewed stays out until the athlete writes again', async () => {
    tables.set('training_log_messages', [
      {
        id: 'm1',
        athlete_id: athlete,
        session_id: null,
        sender_type: 'athlete',
        sender_coach_id: null,
        message: 'Question?',
        created_at: new Date(NOW - 2 * DAY).toISOString(),
        athlete_read_at: null,
      },
    ]);
    tables.get('review_feed_seen')!.push({
      id: 'seen-2',
      owner_id: owner,
      item_type: 'thread',
      item_key: 'm1',
      seen_at: new Date(NOW - 2 * DAY + HOUR).toISOString(),
    });
    expect(await fetchReviewFeed({ ownerId: owner, athleteIds: [athlete], lookbackDays: 7 })).toEqual([]);

    tables.get('training_log_messages')!.push({
      id: 'm2',
      athlete_id: athlete,
      session_id: null,
      sender_type: 'athlete',
      sender_coach_id: null,
      message: 'Follow-up',
      created_at: new Date(NOW - DAY).toISOString(),
      athlete_read_at: null,
    });
    const queue = await fetchReviewFeed({ ownerId: owner, athleteIds: [athlete], lookbackDays: 7 });
    expect(queue.map(i => [i.kind, i.seenKey])).toEqual([['thread', 'm2']]);
  });
});
