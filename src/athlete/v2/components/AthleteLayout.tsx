/**
 * AthleteLayout — shell for the v2 athlete app.
 *
 * Bottom-tab navigation: Today / Week / Coach / Profile. Renders the
 * active screen via <Outlet>. Pads the bottom of the page so content
 * isn't hidden behind the fixed nav. The Coach tab shows an unread
 * badge that polls every 60 s while the tab is visible.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { Calendar, CalendarDays, MessageCircle, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { fetchAthleteGeneralUnreadCount } from '../../../lib/trainingLogService';

const TABS = [
  { to: '/athlete/today', icon: Calendar, label: 'Today' },
  { to: '/athlete/week', icon: CalendarDays, label: 'Week' },
  { to: '/athlete/coach', icon: MessageCircle, label: 'Coach', badge: 'coach' as const },
  { to: '/athlete/profile', icon: User, label: 'Profile' },
] as const;

export function AthleteLayout() {
  const { athlete } = useAuth();
  const unread = useCoachThreadUnread(athlete?.id ?? null);

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-20">
      <Outlet />
      <nav
        className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800"
        aria-label="Athlete navigation"
      >
        <div className="max-w-2xl mx-auto px-2 py-1.5 flex justify-around">
          {TABS.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 px-4 py-1.5 rounded text-[10px] uppercase tracking-wide font-semibold transition-colors ${
                  isActive
                    ? 'text-blue-400'
                    : 'text-gray-500 hover:text-gray-300'
                }`
              }
            >
              <tab.icon size={20} strokeWidth={1.8} />
              {tab.label}
              {'badge' in tab && tab.badge === 'coach' && unread > 0 && (
                <span
                  aria-label={`${unread} unread message${unread === 1 ? '' : 's'}`}
                  className="absolute top-0.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center"
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
 * Lightweight unread-count poller for the Coach tab badge. Refreshes
 * on mount, on tab focus, and every 60 s while the tab is visible.
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
        const n = await fetchAthleteGeneralUnreadCount(athleteId);
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
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(id);
    };
  }, [athleteId]);

  return count;
}
