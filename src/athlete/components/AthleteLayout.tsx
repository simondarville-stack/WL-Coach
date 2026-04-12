import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Calendar, CalendarDays, TrendingUp, User } from 'lucide-react';

const tabs = [
  { to: '/athlete/today', icon: Calendar, label: 'Today' },
  { to: '/athlete/week', icon: CalendarDays, label: 'Week' },
  { to: '/athlete/progress', icon: TrendingUp, label: 'Progress' },
  { to: '/athlete/profile', icon: User, label: 'Profile' },
];

export function AthleteLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-gray-900 border-t border-gray-800 z-50 safe-area-bottom">
        <div className="flex items-stretch max-w-lg mx-auto">
          {tabs.map(tab => {
            const isActive = location.pathname.startsWith(tab.to);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors"
              >
                <tab.icon
                  size={22}
                  className={isActive ? 'text-blue-400' : 'text-gray-500'}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
                <span className={`text-[10px] font-medium ${isActive ? 'text-blue-400' : 'text-gray-500'}`}>
                  {tab.label}
                </span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
