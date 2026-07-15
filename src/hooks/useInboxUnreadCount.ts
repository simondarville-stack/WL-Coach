import { useCallback, useEffect, useState } from 'react';
import { fetchInboxUnreadCount } from '../lib/trainingLogService';
import { onInboxChanged } from '../lib/inboxEvents';
import { getOwnerId } from '../lib/ownerContext';

/**
 * Lightweight unread-thread count for the sidebar badge. Refreshes on
 * mount, on tab focus, on a 60 s interval while the tab is visible, and
 * immediately whenever the service layer reports a read-state change —
 * without that last channel the badge would keep showing a stale count
 * for up to a minute after the coach read the thread, since in-app
 * navigation fires no `focus` event.
 */
export function useInboxUnreadCount(): number {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const n = await fetchInboxUnreadCount(getOwnerId());
      setCount(n);
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
      if (!document.hidden) void load();
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
