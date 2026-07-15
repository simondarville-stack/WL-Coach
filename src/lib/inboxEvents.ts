/**
 * Inbox read-state change channel.
 *
 * The unread badges (coach sidebar, athlete bottom nav) are independent
 * pollers on a 60 s interval. Without a notification channel a badge
 * keeps showing a stale count for up to a minute after the user has
 * actually read the thread — client-side navigation fires no `focus`
 * event, so nothing else wakes them.
 *
 * The service layer emits here whenever read state changes; badge hooks
 * subscribe and refetch. Deliberately tiny: no payload, no ordering
 * guarantees — the signal just means "your count may be wrong, go look".
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to read-state changes. Returns an unsubscribe function. */
export function onInboxChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Notify every badge that its unread count may be stale. */
export function emitInboxChanged(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A misbehaving listener must not stop the others from resyncing.
    }
  }
}
