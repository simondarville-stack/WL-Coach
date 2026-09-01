import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchReviewFeedCounts } from '../lib/reviewFeedService';
import { onInboxChanged } from '../lib/inboxEvents';
import { getOwnerId } from '../lib/ownerContext';
import { useAthleteStore } from '../store/athleteStore';

/**
 * Card count for the sidebar "Review feed" badge — how many unreviewed
 * videos, unread question threads and unreviewed sessions are waiting.
 *
 * Same refresh strategy as useInboxUnreadCount: on mount, on tab focus,
 * on a 60 s interval while visible, and immediately on the shared
 * read-state channel (which the review markers also emit on) so clearing
 * cards in the scroller updates the badge without a page change. No
 * desktop notification: sessions to review are routine, not urgent.
 *
 * The count is per-athlete, and `fetchReviewFeedCounts` returns a flat zero
 * for an empty athlete list — so this hook loads the athlete store itself
 * rather than assuming someone else already has. The desktop shell fills it on
 * boot, but the coach mobile app only fills it when the Review *screen*
 * mounts, which is far too late for a badge whose entire job is to be right
 * BEFORE the tab is entered.
 */
export function useReviewFeedCount(): number {
  const [count, setCount] = useState(0);
  const athletes = useAthleteStore(s => s.athletes);
  const athleteIdsRef = useRef<string[]>([]);
  athleteIdsRef.current = athletes.map(a => a.id);

  const load = useCallback(async () => {
    try {
      const counts = await fetchReviewFeedCounts(getOwnerId(), athleteIdsRef.current);
      setCount(counts.total);
    } catch {
      // Silent: a transient query failure shouldn't take down the sidebar.
    }
  }, []);

  // Idempotent — the store no-ops once loaded, so the desktop shell, the
  // review scroller and this badge can all ask without racing or refetching.
  useEffect(() => {
    void useAthleteStore.getState().fetchAthletes();
  }, []);

  useEffect(() => {
    void load();
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    // Debounced: fast scrolling through the review feed emits one change
    // per cleared card — coalesce those into a single recount.
    let debounce: number | null = null;
    const unsubscribe = onInboxChanged(() => {
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), 600);
    });
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(id);
      if (debounce != null) window.clearTimeout(debounce);
      unsubscribe();
    };
  }, [load]);

  // Reload once the athlete list resolves (it starts empty on boot).
  useEffect(() => {
    if (athletes.length > 0) void load();
  }, [athletes.length, load]);

  return count;
}
