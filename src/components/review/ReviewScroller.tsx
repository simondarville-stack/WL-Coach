/**
 * ReviewScroller — the coach "reel" review feed (/review).
 *
 * A phone-width, snap-scrolling column on a dark stage. Each card is one
 * piece of new material from an athlete: an unreviewed video, an unread
 * question/message thread, or a completed-but-unreviewed session. Items
 * are ordered oldest-first, so reaching the bottom means the coach is
 * fully caught up.
 *
 * "Done" semantics:
 *   - Every card auto-clears once it has been in view for a moment —
 *     recorded PER COACH in review_feed_seen, so coaches sharing an
 *     athlete each review the full feed; the legacy global markers are
 *     still stamped for the surfaces that read them (inbox badge,
 *     log-mode "new footage" rings).
 *   - Comments/quick reactions post into the athlete-visible thread,
 *     labelled with the sending coach so co-coaches see whose they are.
 *
 * Mounted on desktop at /review and inside the coach mobile app at
 * /coach/review. The right-edge segmented rail is the queue itself: one
 * segment per card — filled = reviewed, bright = where you are.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getOwnerId } from '../../lib/ownerContext';
import { useAthleteStore } from '../../store/athleteStore';
import { useCoachStore } from '../../store/coachStore';
import {
  DEMO_KEY_PREFIX,
  fetchExampleCards,
  fetchReviewFeed,
  historyPageWindow,
  markReviewItemSeen,
  markSessionReviewed,
  REVIEW_SESSION_LOOKBACK_DAYS,
  type ReviewFeedItem,
} from '../../lib/reviewFeedService';
import {
  addComment,
  markLogVideoReviewed,
  markMessagesRead,
  markGeneralThreadRead,
  sendGeneralMessage,
  updateLogExercise,
} from '../../lib/trainingLogService';
import { emitInboxChanged } from '../../lib/inboxEvents';
import { useSettings } from '../../hooks/useSettings';
import { quickReactionsFrom, techniqueRatingEnabledFrom } from '../../lib/reviewSettings';
import { EndCard, SessionCard, ThreadCard, VideoCard } from './ReviewCards';
import { Spinner } from '../ui';

/** How long a card must stay in view before it counts as reviewed. */
const SEEN_DWELL_MS = 700;
/** Session cards look this far back. COACH-CONFIG candidate. */
const LOOKBACK_OPTIONS = [7, 14, 30] as const;
/** Backstop on scrollback depth: 12 chunks ≈ a year of history. */
const MAX_HISTORY_PAGES = 12;
/** Load the next chunk once the coach is this close to the last card. */
const HISTORY_PREFETCH_MARGIN = 3;

export function ReviewScroller() {
  const ownerId = getOwnerId();
  const athletes = useAthleteStore(s => s.athletes);
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const athleteById = useMemo(() => new Map(athletes.map(a => [a.id, a])), [athletes]);

  // Coach review preferences (Settings → Review): quick-reaction chips and
  // the technique-rating toggle. Self-loaded (cached) — the mobile coach app
  // mounts this screen without the desktop shell having fetched anything.
  const { settings, fetchSettingsSilent } = useSettings();
  useEffect(() => {
    void fetchSettingsSilent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);
  const quickReactions = useMemo(() => quickReactionsFrom(settings), [settings]);
  const techniqueEnabled = techniqueRatingEnabledFrom(settings);
  const quickReactionsRef = useRef(quickReactions);
  quickReactionsRef.current = quickReactions;

  const [lookbackDays, setLookbackDays] = useState<number>(REVIEW_SESSION_LOOKBACK_DAYS);
  /** Scope the feed to one athlete (deep link ?athlete=<id> from the
   *  athlete screens / dashboard panel). Null = everyone. */
  const [athleteFilter, setAthleteFilter] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('athlete'),
  );
  const [items, setItems] = useState<ReviewFeedItem[] | null>(null);
  /** Example video/question cards ("Show examples") — non-persisting: they
   *  never mark anything and their composers don't hit the database. */
  const [demoItems, setDemoItems] = useState<ReviewFeedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Already-reviewed items past the end card, newest first, in pages that
   *  walk backwards in REVIEW_HISTORY_PAGE_DAYS chunks. Empty array = not
   *  loaded yet; each entry is one page. */
  const [historyPages, setHistoryPages] = useState<ReviewFeedItem[][]>([]);
  const [historyStarted, setHistoryStarted] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** Quick reactions sent via the keyboard, per card key — the cards render
   *  these in their "Sent:" confirmation list. */
  const [keyboardSent, setKeyboardSent] = useState<Record<string, string[]>>({});

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const dwellTimers = useRef(new Map<string, number>());
  // Demo cards render above the real feed and take part in snap/keyboard
  // navigation, but stay out of the progress math.
  const displayItems = useMemo(
    () => (items == null ? null : [...(demoItems ?? []), ...items]),
    [items, demoItems],
  );
  const historyItems = useMemo(() => historyPages.flat(), [historyPages]);
  const itemsRef = useRef<ReviewFeedItem[] | null>(null);
  itemsRef.current = displayItems;
  const historyRef = useRef<ReviewFeedItem[] | null>(null);
  historyRef.current = historyItems;
  const historyKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    historyKeysRef.current = new Set((historyItems ?? []).map(i => i.key));
  }, [historyItems]);
  const activeKeyRef = useRef<string | null>(null);
  activeKeyRef.current = activeKey;

  /** Key → item across queue, demo AND history cards. */
  const findItemByKey = useCallback((key: string): ReviewFeedItem | undefined => {
    return (
      itemsRef.current?.find(i => i.key === key) ??
      historyRef.current?.find(i => i.key === key)
    );
  }, []);

  // Self-sufficient athlete loading: the desktop shell fills the store on
  // boot, but the mobile coach app mounts this screen directly. Idempotent.
  useEffect(() => {
    void useAthleteStore.getState().fetchAthletes();
  }, []);

  // ── Load (snapshot — reviewing a card does not reshuffle the feed) ───────
  const load = useCallback(async () => {
    setItems(null);
    historyBusyRef.current = false;
    emptyPageStreakRef.current = 0;
    pageCountRef.current = 0;
    setHistoryPages([]);
    setHistoryStarted(false);
    setHistoryExhausted(false);
    setSeen(new Set());
    setLoadError(null);
    try {
      const scoped = athleteFilter
        ? athletes.filter(a => a.id === athleteFilter)
        : athletes;
      const feed = await fetchReviewFeed({
        ownerId,
        athleteIds: scoped.map(a => a.id),
        lookbackDays,
      });
      setItems(feed);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Couldn’t load the review feed. Check your connection and try again.');
    }
  }, [ownerId, athletes, lookbackDays, athleteFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── History (keep scrolling past "all caught up") ────────────────────────
  //
  // Pages walk backwards in fixed chunks: page 0 is the current window, each
  // later page another REVIEW_HISTORY_PAGE_DAYS older. Loading is lazy in
  // both directions — the first page waits until the coach reaches the end
  // card, deeper pages until they near the bottom of what is rendered.
  const historyBusyRef = useRef(false);
  const emptyPageStreakRef = useRef(0);
  const pageCountRef = useRef(0);

  const loadMoreHistory = useCallback(async () => {
    if (historyBusyRef.current) return;
    if (pageCountRef.current >= MAX_HISTORY_PAGES) return;
    historyBusyRef.current = true;
    setHistoryStarted(true);
    setHistoryLoading(true);
    try {
      const pageIndex = pageCountRef.current;
      const scoped = athleteFilter ? athletes.filter(a => a.id === athleteFilter) : athletes;
      const page = await fetchReviewFeed({
        ownerId,
        athleteIds: scoped.map(a => a.id),
        lookbackDays,
        mode: 'history',
        ...historyPageWindow(lookbackDays, pageIndex),
      });
      pageCountRef.current = pageIndex + 1;
      if (page.length === 0) {
        emptyPageStreakRef.current += 1;
        // Two consecutive empty chunks = past the end of this coach's
        // material; stop rather than paging into empty months forever.
        if (emptyPageStreakRef.current >= 2) setHistoryExhausted(true);
      } else {
        emptyPageStreakRef.current = 0;
        setHistoryPages(prev => [...prev, page]);
      }
      if (pageCountRef.current >= MAX_HISTORY_PAGES) setHistoryExhausted(true);
    } catch {
      setHistoryExhausted(true); // quiet — the queue is the primary content
    } finally {
      setHistoryLoading(false);
      historyBusyRef.current = false;
    }
  }, [ownerId, athletes, athleteFilter, lookbackDays]);

  // Reset paging whenever the feed itself is reloaded or rescoped.
  useEffect(() => {
    historyBusyRef.current = false;
    emptyPageStreakRef.current = 0;
    pageCountRef.current = 0;
    setHistoryPages([]);
    setHistoryStarted(false);
    setHistoryExhausted(false);
  }, [ownerId, athleteFilter, lookbackDays]);

  // First page: the moment the coach reaches the end card, so the queue
  // load itself stays fast. An empty queue starts it immediately — the end
  // card is then the whole screen and there is nothing to scroll past.
  useEffect(() => {
    if (items == null || historyStarted) return;
    if (activeKey === 'end' || items.length === 0) void loadMoreHistory();
  }, [activeKey, items, historyStarted, loadMoreHistory]);

  // Deeper pages: when the card in view is within a few of the last one.
  useEffect(() => {
    if (!historyStarted || historyExhausted || historyLoading) return;
    if (!activeKey || historyItems.length === 0) return;
    const idx = historyItems.findIndex(i => i.key === activeKey);
    if (idx >= 0 && idx >= historyItems.length - HISTORY_PREFETCH_MARGIN) {
      void loadMoreHistory();
    }
  }, [activeKey, historyItems, historyStarted, historyExhausted, historyLoading, loadMoreHistory]);

  // ── Seen marking ─────────────────────────────────────────────────────────
  const markSeen = useCallback(
    (item: ReviewFeedItem) => {
      if (item.key.startsWith(DEMO_KEY_PREFIX)) return;
      // History cards are already reviewed — nothing to mark, and dwelling
      // on them must not touch state.
      if (historyKeysRef.current.has(item.key)) return;
      setSeen(prev => {
        if (prev.has(item.key)) return prev;
        const next = new Set(prev);
        next.add(item.key);
        return next;
      });
      // Fire-and-forget: an optimistic UI over idempotent markers.
      const persist = async () => {
        // The per-coach record is what the feed itself reads.
        await markReviewItemSeen(ownerId, item.kind, item.seenKey);
        // Legacy global markers for the other surfaces (inbox badge,
        // log-mode rings). These are shared across coaches by design.
        if (item.kind === 'video') {
          await markLogVideoReviewed(item.video.id);
        } else if (item.kind === 'thread') {
          if (item.sessionId) {
            await markMessagesRead(item.sessionId, null, 'coach');
          } else {
            const athlete = athleteById.get(item.athleteId);
            await markGeneralThreadRead(item.athleteId, athlete?.owner_id ?? ownerId, 'coach');
          }
        } else {
          await markSessionReviewed(item.session.id);
        }
      };
      // On success, poke the shared read-state channel so the sidebar badge
      // and the dashboard panel resync. (The message markers emit on their
      // own; videos and sessions need this nudge.)
      persist()
        .then(() => emitInboxChanged())
        .catch(() => undefined);
    },
    [athleteById, ownerId],
  );

  // ── In-view tracking (autoplay + dwell-to-seen) ──────────────────────────
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !displayItems) return;
    const timers = dwellTimers.current;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.reviewKey;
          if (!key) continue;
          if (entry.intersectionRatio >= 0.6) {
            setActiveKey(key);
            if (!timers.has(key)) {
              const t = window.setTimeout(() => {
                timers.delete(key);
                const item = findItemByKey(key);
                if (item) markSeen(item);
              }, SEEN_DWELL_MS);
              timers.set(key, t);
            }
          } else {
            const t = timers.get(key);
            if (t != null) {
              window.clearTimeout(t);
              timers.delete(key);
            }
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const el of cardRefs.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, [displayItems, historyItems, markSeen, findItemByKey]);

  const registerCard = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      if (el) {
        el.dataset.reviewKey = key;
        cardRefs.current.set(key, el);
      } else {
        cardRefs.current.delete(key);
      }
    };
  }, []);

  // ── Comment plumbing ─────────────────────────────────────────────────────
  const commentOnSession = useCallback(
    async (item: ReviewFeedItem, sessionId: string | null, text: string) => {
      if (item.key.startsWith(DEMO_KEY_PREFIX)) {
        // Example card: show the send feedback, write nothing.
        await new Promise(r => setTimeout(r, 250));
        return;
      }
      if (!sessionId) throw new Error('No session to attach this comment to.');
      await addComment({
        sessionId,
        exerciseId: null,
        message: text,
        senderType: 'coach',
        senderCoachId: activeCoachId,
      });
      markSeen(item); // replying implies reviewed
    },
    [activeCoachId, markSeen],
  );

  const replyToThread = useCallback(
    async (item: Extract<ReviewFeedItem, { kind: 'thread' }>, text: string) => {
      if (item.key.startsWith(DEMO_KEY_PREFIX)) {
        await new Promise(r => setTimeout(r, 250));
        return;
      }
      if (item.sessionId) {
        await commentOnSession(item, item.sessionId, text);
        return;
      }
      const athlete = athleteById.get(item.athleteId);
      await sendGeneralMessage({
        athleteId: item.athleteId,
        ownerId: athlete?.owner_id ?? ownerId,
        message: text,
        senderType: 'coach',
        senderCoachId: activeCoachId,
      });
      markSeen(item);
    },
    [athleteById, ownerId, activeCoachId, commentOnSession, markSeen],
  );

  // ── Technique rating ─────────────────────────────────────────────────────
  const rateTechnique = useCallback(
    async (item: ReviewFeedItem, logExerciseId: string, rating: number | null) => {
      if (item.key.startsWith(DEMO_KEY_PREFIX)) {
        await new Promise(r => setTimeout(r, 250));
        return;
      }
      await updateLogExercise(logExerciseId, { technique_rating: rating });
      markSeen(item); // rating implies reviewed
    },
    [markSeen],
  );

  // ── Example cards ("Show examples") ──────────────────────────────────────
  const toggleExamples = useCallback(async () => {
    if (demoItems != null) {
      setDemoItems(null);
      return;
    }
    try {
      setDemoItems(await fetchExampleCards(athletes.map(a => a.id)));
      scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // Non-essential — quietly stay off.
    }
  }, [demoItems, athletes]);

  // ?demo=1 deep-link opens the examples straight away.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('demo')) return;
    if (athletes.length === 0 || demoItems != null) return;
    void toggleExamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when athletes resolve
  }, [athletes.length]);

  // ── Keyboard flow: ↑/↓ snap between cards, 1–4 quick reactions ──────────
  const quickReact = useCallback(
    async (item: ReviewFeedItem, text: string) => {
      if (item.kind === 'thread') return; // a bare reaction is a non-answer
      try {
        if (item.kind === 'video') {
          await commentOnSession(item, item.sessionId, `📹 ${item.exerciseName}: ${text}`);
        } else {
          await commentOnSession(item, item.session.id, text);
        }
        setKeyboardSent(prev => ({
          ...prev,
          [item.key]: [...(prev[item.key] ?? []), text],
        }));
      } catch {
        // Silent — the on-card buttons remain the reliable path.
      }
    },
    [commentOnSession],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      ) {
        return;
      }
      const feed = itemsRef.current;
      if (!feed) return;
      const keys = [
        ...feed.map(i => i.key),
        'end',
        ...(historyRef.current ?? []).map(i => i.key),
      ];

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = activeKeyRef.current;
        const curIdx = cur ? keys.indexOf(cur) : -1;
        const nextIdx = Math.min(
          keys.length - 1,
          Math.max(0, (curIdx === -1 ? 0 : curIdx) + (e.key === 'ArrowDown' ? 1 : -1)),
        );
        cardRefs.current.get(keys[nextIdx])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // Keys 1–9 fire the coach's own reactions (the list is capped at 9,
      // so every configured reaction has a shortcut).
      const n = Number(e.key);
      const reactions = quickReactionsRef.current;
      if (Number.isInteger(n) && n >= 1 && n <= reactions.length) {
        const item = activeKeyRef.current ? findItemByKey(activeKeyRef.current) : undefined;
        if (!item || item.kind === 'thread') return;
        e.preventDefault();
        void quickReact(item, reactions[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickReact, findItemByKey]);

  // ── Render ───────────────────────────────────────────────────────────────
  const total = items?.length ?? 0;
  const seenCount = items ? items.filter(i => seen.has(i.key)).length : 0;

  /** One full-height snap section. History cards render as already-seen and
   *  carry a corner tag; their composers still post for real. */
  const renderCard = (item: ReviewFeedItem, tag: 'demo' | 'history' | null) => (
    <section
      key={item.key}
      ref={registerCard(item.key)}
      className="relative h-full snap-start snap-always"
    >
      {tag === 'demo' && (
        <div className="absolute top-11 right-3 z-10 text-[10px] uppercase tracking-wider font-medium bg-amber-400/90 text-black px-1.5 py-0.5 rounded pointer-events-none">
          Example
        </div>
      )}
      {tag === 'history' && (
        <div className="absolute top-11 right-3 z-10 text-[10px] uppercase tracking-wider font-medium bg-white/10 text-white/60 px-1.5 py-0.5 rounded pointer-events-none">
          History
        </div>
      )}
      {item.kind === 'video' && (
        <VideoCard
          item={item}
          athlete={athleteById.get(item.athleteId)}
          seen={tag === 'history' || seen.has(item.key)}
          active={activeKey === item.key}
          onComment={text =>
            commentOnSession(item, item.sessionId, `📹 ${item.exerciseName}: ${text}`)
          }
          reactions={quickReactions}
          onRateTechnique={
            techniqueEnabled
              ? rating => rateTechnique(item, item.logExerciseId, rating)
              : null
          }
          externalSent={keyboardSent[item.key]}
        />
      )}
      {item.kind === 'thread' && (
        <ThreadCard
          item={item}
          athlete={athleteById.get(item.athleteId)}
          seen={tag === 'history' || seen.has(item.key)}
          onReply={text => replyToThread(item, text)}
        />
      )}
      {item.kind === 'session' && (
        <SessionCard
          item={item}
          athlete={athleteById.get(item.athleteId)}
          seen={tag === 'history' || seen.has(item.key)}
          onComment={text => commentOnSession(item, item.session.id, text)}
          reactions={quickReactions}
          onRateTechnique={
            techniqueEnabled
              ? (logExerciseId, rating) => rateTechnique(item, logExerciseId, rating)
              : null
          }
          externalSent={keyboardSent[item.key]}
        />
      )}
    </section>
  );

  return (
    <div className="h-full bg-neutral-950 flex flex-col">
      {/* Progress header */}
      <div className="shrink-0 max-w-md w-full mx-auto px-3 pt-2.5 pb-1.5">
        <div className="flex items-center justify-between gap-2 text-white/70 text-xs">
          <span>
            {items == null
              ? 'Loading…'
              : total === 0
                ? 'Nothing to review'
                : `${seenCount} of ${total} reviewed`}
            <span className="hidden md:inline text-white/30">
              {' '}· ↑↓ navigate
              {quickReactions.length > 1 && ` · 1–${quickReactions.length} react`}
              {quickReactions.length === 1 && ' · 1 react'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {athleteFilter && (
              <button
                type="button"
                onClick={() => setAthleteFilter(null)}
                title="Showing one athlete — tap to show everyone"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--color-accent)] text-white"
              >
                {athleteById.get(athleteFilter)?.name ?? 'Athlete'}
                <span aria-hidden>×</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleExamples()}
              title="Example video and question cards — nothing is sent or marked from them"
              className={`px-1.5 py-0.5 rounded ${demoItems != null ? 'bg-amber-400/20 text-amber-300' : 'hover:bg-white/10 text-white/50'}`}
            >
              {demoItems != null ? 'Hide examples' : 'Examples'}
            </button>
            <label className="text-white/40">
              Sessions from last{' '}
              <select
                value={lookbackDays}
                onChange={e => setLookbackDays(Number(e.target.value))}
                className="bg-white/10 text-white/80 rounded px-1 py-0.5 outline-none"
              >
                {LOOKBACK_OPTIONS.map(d => (
                  <option key={d} value={d} className="text-gray-900">
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              title="Reload feed"
              onClick={() => void load()}
              className="p-1 rounded hover:bg-white/10"
            >
              <RefreshCw size={13} />
            </button>
          </span>
        </div>
      </div>

      {/* Snap scroller + queue rail */}
      <div className="relative flex-1 min-h-0">
        {/* The queue itself, drawn on the edge: one segment per card,
            emerald = reviewed, bright = the card in view. Falls back to a
            continuous bar when the queue is too long to read as segments. */}
        {items != null && (total > 0 || historyItems.length > 0) && (
          <div
            aria-hidden
            className="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-[3px] pointer-events-none"
            style={{ maxHeight: '76%' }}
          >
            {/* The queue: one segment per card, emerald once reviewed. */}
            {total > 0 &&
              (total <= 40 ? (
                items!.map(i => (
                  <div
                    key={i.key}
                    className={`w-[3px] rounded-full transition-colors duration-300 ${
                      seen.has(i.key)
                        ? 'bg-emerald-500/80'
                        : activeKey === i.key
                          ? 'bg-white'
                          : 'bg-white/20'
                    }`}
                    style={{ height: `${Math.max(6, Math.min(22, 260 / total))}px` }}
                  />
                ))
              ) : (
                <div className="w-[3px] h-32 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="w-full bg-emerald-500/80 transition-all duration-300"
                    style={{ height: `${(seenCount / total) * 100}%` }}
                  />
                </div>
              ))}
            {/* The caught-up line: everything below it is the past. */}
            {historyItems.length > 0 && (
              <div
                className={`w-2 h-px my-0.5 transition-colors ${
                  activeKey === 'end' ? 'bg-white' : 'bg-white/40'
                }`}
              />
            )}
            {/* History: same grammar, dimmed — you are scrolling back in time. */}
            {historyItems.length > 0 &&
              (historyItems.length <= 40 ? (
                historyItems.map(i => (
                  <div
                    key={i.key}
                    className={`w-[3px] rounded-full transition-colors duration-300 ${
                      activeKey === i.key ? 'bg-white' : 'bg-white/12'
                    }`}
                    style={{
                      height: `${Math.max(4, Math.min(14, 200 / historyItems.length))}px`,
                    }}
                  />
                ))
              ) : (
                <div className="w-[3px] h-24 rounded-full bg-white/12 overflow-hidden">
                  <div
                    className="w-full bg-white/40 transition-all duration-300"
                    style={{
                      height: `${
                        ((historyItems.findIndex(i => i.key === activeKey) + 1) /
                          historyItems.length) *
                        100
                      }%`,
                    }}
                  />
                </div>
              ))}
          </div>
        )}
        <div
          ref={scrollerRef}
          className="h-full overflow-y-auto snap-y snap-mandatory"
          // Fallback trigger for the lazy history load: nearing the bottom
          // counts as reaching the end card.
          onScroll={e => {
            const el = e.currentTarget;
            if (
              itemsRef.current != null &&
              el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight
            ) {
              void loadMoreHistory();
            }
          }}
        >
        <div className="max-w-md mx-auto h-full">
          {items == null && !loadError && (
            <div className="h-full flex items-center justify-center">
              <Spinner size={24} />
            </div>
          )}
          {loadError && (
            <div className="h-full flex items-center justify-center px-6 text-center text-sm text-red-300">
              {loadError}
            </div>
          )}
          {displayItems?.map(item =>
            renderCard(item, item.key.startsWith(DEMO_KEY_PREFIX) ? 'demo' : null),
          )}
          {items != null && !loadError && (
            <section ref={registerCard('end')} className="h-full snap-start snap-always">
              <EndCard
                total={total}
                historyStatus={
                  !historyStarted || historyLoading
                    ? 'loading'
                    : historyItems.length > 0
                      ? 'ready'
                      : 'empty'
                }
                historyCount={historyItems.length}
                historyComplete={historyExhausted}
                onBackToTop={() =>
                  scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                }
              />
            </section>
          )}
          {historyItems.map(item => renderCard(item, 'history'))}
          {historyStarted && historyLoading && historyItems.length > 0 && (
            <div className="h-16 flex items-center justify-center gap-2 text-white/40 text-xs">
              <div className="animate-spin rounded-full border-2 border-white/20 border-t-white/60 w-4 h-4" />
              Loading older…
            </div>
          )}
          {historyExhausted && historyItems.length > 0 && (
            <div className="h-16 flex items-center justify-center text-white/30 text-xs">
              That's the whole history.
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
