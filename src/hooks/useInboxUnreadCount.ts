import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInboxUnreadSummary } from '../lib/trainingLogService';
import { onInboxChanged } from '../lib/inboxEvents';
import { getOwnerId } from '../lib/ownerContext';
import { useAthleteStore } from '../store/athleteStore';
import { isNotifyEnabled, showNotification } from '../lib/desktopNotify';

interface Options {
  /** Where a clicked notification should take the coach. */
  onOpenInbox?: () => void;
}

/**
 * Lightweight unread-thread count for the sidebar badge. Refreshes on
 * mount, on tab focus, on a 60 s interval, and immediately whenever the
 * service layer reports a read-state change — without that last channel the
 * badge would keep showing a stale count for up to a minute after the coach
 * read the thread, since in-app navigation fires no `focus` event.
 *
 * It also raises the desktop notification when the count GROWS, which is the
 * only place that can be decided: it needs the previous count, and this is the
 * one thing that holds it.
 */
export function useInboxUnreadCount({ onOpenInbox }: Options = {}): number {
  const [count, setCount] = useState(0);
  const athletes = useAthleteStore(s => s.athletes);

  // Refs, not deps: re-running the poll effect because a name resolved or a
  // callback identity changed would reset the baseline and re-notify.
  const athletesRef = useRef(athletes);
  athletesRef.current = athletes;
  const onOpenRef = useRef(onOpenInbox);
  onOpenRef.current = onOpenInbox;
  /** Last observed count. null until the first load, which must NOT notify —
   *  otherwise every page load announces mail the coach already knew about. */
  const prevRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { threads, athleteIds } = await fetchInboxUnreadSummary(getOwnerId());
      setCount(threads);

      const prev = prevRef.current;
      prevRef.current = threads;
      // Only a genuine increase, and only when the coach is not already looking
      // at EMOS — on a visible tab the badge itself is the notification.
      if (prev === null || threads <= prev) return;
      if (!document.hidden || !isNotifyEnabled()) return;

      const names = athleteIds
        .map(id => athletesRef.current.find(a => a.id === id)?.name)
        .filter((n): n is string => !!n);
      const title = names.length === 1
        ? `${names[0]} sent a message`
        : `${threads} unread conversations`;
      const body = names.length === 0
        ? 'Open the inbox to read them.'
        : names.length <= 3
          ? names.join(', ')
          : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
      showNotification({
        title,
        body,
        // One rolling alert per inbox rather than a stack of them.
        tag: 'emos-inbox-unread',
        onClick: () => onOpenRef.current?.(),
      });
    } catch {
      // Silent: a transient query failure shouldn't take down the sidebar.
      // The next refresh round will resync.
    }
  }, []);

  useEffect(() => {
    void load();
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const id = window.setInterval(() => {
      // Polling a hidden tab is the whole point of the notification, and the
      // only reason worth spending a query on a tab nobody is looking at — so
      // it happens only while notifications are actually switched on.
      if (!document.hidden || isNotifyEnabled()) void load();
    }, 60_000);
    const unsubscribe = onInboxChanged(() => void load());
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(id);
      unsubscribe();
    };
  }, [load]);

  return count;
}
