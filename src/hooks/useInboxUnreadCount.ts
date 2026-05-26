import { useCallback, useEffect, useState } from 'react';
import { fetchInboxUnreadCount } from '../lib/trainingLogService';
import { getOwnerId } from '../lib/ownerContext';

/**
 * Lightweight unread-thread count for the sidebar badge. Refreshes on
 * mount, on tab focus, and on a 60 s interval while the tab is visible
 * — keeps the badge live without spamming Supabase. The actual inbox
 * page does its own fetch so opening it reflects fresh data immediately.
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
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(id);
    };
  }, [load]);

  return count;
}
