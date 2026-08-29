/**
 * AthleteLayout — shell for the v2 athlete app.
 *
 * Bottom-tab navigation: Today / Week / Macro / Coach / Profile. Renders
 * the active screen via <Outlet>. Pads the bottom of the page so content
 * isn't hidden behind the fixed nav. The Coach tab shows an unread
 * badge that polls every 60 s while the tab is visible.
 *
 * The bar hides itself while the software keyboard is up. iOS Safari does not
 * reflow the page for the keyboard, so a `position: fixed` bar ends up pinned
 * under it and skates around as the page scrolls — very visible while writing
 * a session note. The bar is fixed, so hiding it reflows nothing; the page
 * keeps its `pb-20` and gains the screen space instead.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { Calendar, CalendarDays, CalendarRange, MessageCircle, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useKeyboardOpen } from '../lib/useKeyboardOpen';
import { fetchAthleteInboxUnreadCount } from '../../../lib/trainingLogService';
import { onInboxChanged } from '../../../lib/inboxEvents';

const TABS = [
  { to: '/athlete/today', icon: Calendar, label: 'Today' },
  { to: '/athlete/week', icon: CalendarDays, label: 'Week' },
  { to: '/athlete/macro', icon: CalendarRange, label: 'Macro' },
  { to: '/athlete/coach', icon: MessageCircle, label: 'Coach', badge: 'coach' as const },
  { to: '/athlete/profile', icon: User, label: 'Profile' },
] as const;

export function AthleteLayout() {
  const { athlete } = useAuth();
  const unread = useCoachThreadUnread(athlete?.id ?? null);
  const keyboardOpen = useKeyboardOpen();

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] text-white pb-20">
      <Outlet />
      <nav
        className={`fixed bottom-0 left-0 right-0 bg-[var(--color-bg-primary)] border-t border-[color:var(--color-border-tertiary)]${
          keyboardOpen ? ' hidden' : ''
        }`}
        aria-label="Athlete navigation"
      >
        <div className="max-w-2xl mx-auto px-2 py-1.5 flex justify-around">
          {TABS.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                // px-2, not px-4: five tabs have to fit a 320 px phone.
                `relative flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[length:var(--text-caption)] uppercase tracking-wide font-semibold transition-colors ${
                  isActive
                    ? 'text-[color:var(--color-accent)]'
                    : 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]'
                }`
              }
            >
              <tab.icon size={20} strokeWidth={1.8} />
              {tab.label}
              {'badge' in tab && tab.badge === 'coach' && unread > 0 && (
                <span
                  aria-label={`${unread} unread message${unread === 1 ? '' : 's'}`}
                  className="absolute top-0.5 right-0 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-accent)] text-white text-[length:var(--text-micro)] font-bold flex items-center justify-center"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

/**
 * Lightweight unread-count poller for the Coach tab badge. Refreshes on
 * mount, on tab focus, every 60 s while the tab is visible, and
 * immediately when the service layer reports a read-state change — the
 * last one is what clears the badge the moment the athlete reads the
 * thread, since navigating within the app fires no `focus` event.
 */
function useCoachThreadUnread(athleteId: string | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!athleteId) {
      setCount(0);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const n = await fetchAthleteInboxUnreadCount(athleteId);
        if (alive) setCount(n);
      } catch {
        // Silent — a transient failure shouldn't take down the nav.
      }
    };
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
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(id);
      unsubscribe();
    };
  }, [athleteId]);

  return count;
}
