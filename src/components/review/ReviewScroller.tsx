/**
 * ReviewScroller — the coach "reel" review feed (/review).
 *
 * A phone-width, snap-scrolling column on a dark stage. Each card is one
 * piece of new material from an athlete: an unreviewed video, an unread
 * question/message thread, or a completed-but-unreviewed session. Items
 * are ordered oldest-first, so reaching the bottom means the coach is
 * fully caught up.
 *
 * "Done" semantics (aligned with the user's choices):
 *   - Every card auto-clears once it has been in view for a moment; the
 *     existing markers (video coach_reviewed_at, message coach_read_at,
 *     session coach_reviewed_at) are stamped so the Inbox badge and the
 *     log-mode "new footage" rings stay consistent with this feed.
 *   - Comments/quick reactions post into the athlete-visible thread.
 *
 * Prototype status: session cards use a fixed lookback window and default
 * the StackedNotation unit to kg. // COACH-CONFIG candidate (lookback,
 * quick reactions).
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
} from '../../lib/trainingLogService';
import { emitInboxChanged } from '../../lib/inboxEvents';
import { EndCard, QUICK_REACTIONS, SessionCard, ThreadCard, VideoCard } from './ReviewCards';

/** How long a card must stay in view before it counts as reviewed. */
const SEEN_DWELL_MS = 700;
/** Session cards look this far back. COACH-CONFIG candidate. */
const LOOKBACK_OPTIONS = [7, 14, 30] as const;

export function ReviewScroller() {
  const ownerId = getOwnerId();
  const athletes = useAthleteStore(s => s.athletes);
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const athleteById = useMemo(() => new Map(athletes.map(a => [a.id, a])), [athletes]);

  const [lookbackDays, setLookbackDays] = useState<number>(REVIEW_SESSION_LOOKBACK_DAYS);
  const [items, setItems] = useState<ReviewFeedItem[] | null>(null);
  /** Example video/question cards ("Show examples") — non-persisting: they
   *  never mark anything and their composers don't hit the database. */
  const [demoItems, setDemoItems] = useState<ReviewFeedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const itemsRef = useRef<ReviewFeedItem[] | null>(null);
  itemsRef.current = displayItems;
  const activeKeyRef = useRef<string | null>(null);
  activeKeyRef.current = activeKey;

  // ── Load (snapshot — reviewing a card does not reshuffle the feed) ───────
  const load = useCallback(async () => {
    setItems(null);
    setSeen(new Set());
    setLoadError(null);
    try {
      const feed = await fetchReviewFeed({
        ownerId,
        athleteIds: athletes.map(a => a.id),
        lookbackDays,
      });
      setItems(feed);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the review feed.');
    }
  }, [ownerId, athletes, lookbackDays]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Seen marking ─────────────────────────────────────────────────────────
  const markSeen = useCallback(
    (item: ReviewFeedItem) => {
      if (item.key.startsWith(DEMO_KEY_PREFIX)) return;
      setSeen(prev => {
        if (prev.has(item.key)) return prev;
        const next = new Set(prev);
        next.add(item.key);
        return next;
      });
      // Fire-and-forget: an optimistic UI over idempotent markers.
      const persist = async () => {
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
                const item = itemsRef.current?.find(i => i.key === key);
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
  }, [displayItems, markSeen]);

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
      const keys = [...feed.map(i => i.key), 'end'];

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

      if (e.key >= '1' && e.key <= String(QUICK_REACTIONS.length)) {
        const item = feed.find(i => i.key === activeKeyRef.current);
        if (!item || item.kind === 'thread') return;
        e.preventDefault();
        void quickReact(item, QUICK_REACTIONS[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickReact]);

  // ── Render ───────────────────────────────────────────────────────────────
  const total = items?.length ?? 0;
  const seenCount = items ? items.filter(i => seen.has(i.key)).length : 0;

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
            <span className="hidden md:inline text-white/30"> · ↑↓ navigate · 1–4 react</span>
          </span>
          <span className="flex items-center gap-1.5">
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
        <div className="mt-1.5 h-0.5 rounded bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: total > 0 ? `${(seenCount / total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Snap scroller */}
      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory"
      >
        <div className="max-w-md mx-auto h-full">
          {items == null && !loadError && (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin rounded-full border-2 border-white/20 border-t-white/70 w-6 h-6" />
            </div>
          )}
          {loadError && (
            <div className="h-full flex items-center justify-center px-6 text-center text-sm text-red-300">
              {loadError}
            </div>
          )}
          {displayItems?.map(item => (
            <section
              key={item.key}
              ref={registerCard(item.key)}
              className="relative h-full snap-start snap-always"
            >
              {item.key.startsWith(DEMO_KEY_PREFIX) && (
                <div className="absolute top-11 right-3 z-10 text-[10px] uppercase tracking-wider font-medium bg-amber-400/90 text-black px-1.5 py-0.5 rounded pointer-events-none">
                  Example
                </div>
              )}
              {item.kind === 'video' && (
                <VideoCard
                  item={item}
                  athlete={athleteById.get(item.athleteId)}
                  seen={seen.has(item.key)}
                  active={activeKey === item.key}
                  onComment={text =>
                    commentOnSession(item, item.sessionId, `📹 ${item.exerciseName}: ${text}`)
                  }
                  externalSent={keyboardSent[item.key]}
                />
              )}
              {item.kind === 'thread' && (
                <ThreadCard
                  item={item}
                  athlete={athleteById.get(item.athleteId)}
                  seen={seen.has(item.key)}
                  onReply={text => replyToThread(item, text)}
                />
              )}
              {item.kind === 'session' && (
                <SessionCard
                  item={item}
                  athlete={athleteById.get(item.athleteId)}
                  seen={seen.has(item.key)}
                  onComment={text => commentOnSession(item, item.session.id, text)}
                  externalSent={keyboardSent[item.key]}
                />
              )}
            </section>
          ))}
          {items != null && !loadError && (
            <section ref={registerCard('end')} className="h-full snap-start snap-always">
              <EndCard
                total={total}
                onBackToTop={() =>
                  scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                }
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
