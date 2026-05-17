/**
 * AthleteLayout — shell for the v2 athlete app.
 *
 * Bottom-tab navigation: Today / Week / Profile. Renders the active
 * screen via <Outlet>. Pads the bottom of the page so content isn't
 * hidden behind the fixed nav.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { Calendar, CalendarDays, User } from 'lucide-react';

const TABS = [
  { to: '/athlete/today', icon: Calendar, label: 'Today' },
  { to: '/athlete/week', icon: CalendarDays, label: 'Week' },
  { to: '/athlete/profile', icon: User, label: 'Profile' },
] as const;

export function AthleteLayout() {
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
                `flex flex-col items-center gap-0.5 px-4 py-1.5 rounded text-[10px] uppercase tracking-wide font-semibold transition-colors ${
                  isActive
                    ? 'text-blue-400'
                    : 'text-gray-500 hover:text-gray-300'
                }`
              }
            >
              <tab.icon size={20} strokeWidth={1.8} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
