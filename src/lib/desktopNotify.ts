/**
 * Desktop notifications for the coach app — the Notifications API only.
 *
 * Deliberately NOT Web Push: no service worker, no VAPID keys, no backend, no
 * PWA install step. The cost of that is the honest limit — a notification can
 * only fire while an EMOS tab is still open somewhere. That covers the case the
 * inbox was already built around (a coach leaving it in a background tab while
 * waiting for athletes to log) and nothing more. Reaching a closed browser, or
 * a phone, needs the full Web Push project.
 *
 * Permission is one-shot per origin: a denied prompt cannot be re-asked from
 * script, only undone by the user in browser settings. So it is never requested
 * on load — only from an explicit click on the inbox's bell.
 */

/** Device-local, like every other per-device preference in the app. A DB
 *  setting would be wrong: permission is granted per browser, so a stored
 *  "on" would lie on every other device the coach opens EMOS in. */
const PREF_KEY = 'emos.notify.inbox';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function notifyPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as 'default' | 'granted' | 'denied';
}

/** True when the coach asked for notifications AND the browser still allows
 *  them. Both halves matter — permission can be revoked in settings long after
 *  the preference was stored. */
export function isNotifyEnabled(): boolean {
  if (notifyPermission() !== 'granted') return false;
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotifyEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // Private mode — the toggle still applies for this session.
  }
}

/** Ask, from a user gesture. Returns the resulting permission. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (notifyPermission() === 'unsupported') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    // Older Safari used a callback signature and can reject the promise form.
    return notifyPermission();
  }
}

interface ShowArgs {
  title: string;
  body: string;
  /** Same tag replaces an earlier notification instead of stacking a second
   *  one — three messages arriving should read as one growing alert. */
  tag: string;
  onClick?: () => void;
}

export function showNotification({ title, body, tag, onClick }: ShowArgs): void {
  if (!isNotifyEnabled()) return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: '/favicon.svg',
      // The coach may be in another app entirely; let it sit until dismissed.
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      onClick?.();
    };
  } catch {
    // Some browsers throw when constructing a Notification outside a service
    // worker (notably Android Chrome). Nothing to recover — the badge still
    // updates, which is the pre-existing behaviour.
  }
}
