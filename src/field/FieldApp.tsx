/**
 * FieldApp — coach-facing mobile field view (/field).
 *
 * "What are my athletes going to train today?" on the gym floor: the
 * Upcoming screen shows each athlete's next open session as a compact
 * highlight table; drill-ins reuse the athlete app's read-only
 * SessionPreview. Shares the athlete app's dark visual language
 * (data-theme="dark") and the coach app's environment (coachStore) —
 * mounted behind the same CoachGate as the desktop coach app.
 */
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Calculator, ListChecks, Mail, Users } from 'lucide-react';
import { useCoachStore } from '../store/coachStore';
import { useCoachProfiles } from '../hooks/useCoachProfiles';
import { useInboxUnreadCount } from '../hooks/useInboxUnreadCount';
import { SelectEnvironmentPage } from '../components/SelectEnvironmentPage';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { setActorResolver } from '../lib/errorLogger';
import { UpcomingScreen } from './screens/UpcomingScreen';
import { AthletesScreen } from './screens/AthletesScreen';
import { AthleteWeekScreen } from './screens/AthleteWeekScreen';
import { AthleteDayScreen } from './screens/AthleteDayScreen';
import { GroupWeekScreen } from './screens/GroupWeekScreen';
import { GroupDayScreen } from './screens/GroupDayScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { FieldInboxScreen } from './screens/FieldInboxScreen';
import { FieldConversationScreen } from './screens/FieldConversationScreen';

const TABS = [
  { to: '/field', icon: ListChecks, label: 'Upcoming', end: true },
  { to: '/field/athletes', icon: Users, label: 'Athletes', end: false },
  { to: '/field/inbox', icon: Mail, label: 'Inbox', end: false },
  { to: '/field/tools', icon: Calculator, label: 'Tools', end: false },
] as const;

function FieldLayout() {
  // Same unread-thread badge as the desktop sidebar (60 s cadence).
  const unread = useInboxUnreadCount();
  return (
    <div className="min-h-screen bg-gray-950 text-white pb-20">
      <Outlet />
      <nav
        className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800"
        aria-label="Field navigation"
      >
        <div className="max-w-2xl mx-auto px-2 py-1.5 flex justify-around">
          {TABS.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-4 py-1.5 rounded text-[10px] uppercase tracking-wide font-semibold transition-colors ${
                  isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
                }`
              }
            >
              <span className="relative">
                <tab.icon size={20} strokeWidth={1.8} />
                {tab.label === 'Inbox' && unread > 0 && (
                  <span
                    className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full bg-blue-500 text-white text-[8px] font-bold flex items-center justify-center"
                    aria-label={`${unread} unread ${unread === 1 ? 'thread' : 'threads'}`}
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function FieldRoutes() {
  const { activeCoach, setCoaches } = useCoachStore();
  const { fetchCoaches } = useCoachProfiles();
  const [coachesLoaded, setCoachesLoaded] = useState(false);

  useEffect(() => {
    setActorResolver(() => ({
      role: 'coach',
      id: activeCoach?.id ?? null,
      label: activeCoach ? `Field: ${activeCoach.name}` : null,
    }));
  }, [activeCoach?.id, activeCoach?.name]);

  useEffect(() => {
    (async () => {
      const coaches = await fetchCoaches();
      setCoaches(coaches);
      setCoachesLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!coachesLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!activeCoach) {
    return (
      <SelectEnvironmentPage
        coaches={useCoachStore.getState().coaches}
        onNewEnvironment={() => { window.location.href = '/'; }}
      />
    );
  }

  return (
    <Routes>
      <Route element={<FieldLayout />}>
        <Route path="/field" element={<UpcomingScreen />} />
        <Route path="/field/athletes" element={<AthletesScreen />} />
        <Route path="/field/inbox" element={<FieldInboxScreen />} />
        <Route path="/field/tools" element={<ToolsScreen />} />
      </Route>
      <Route path="/field/inbox/:athleteId" element={<FieldConversationScreen />} />
      <Route path="/field/a/:athleteId" element={<AthleteWeekScreen />} />
      <Route path="/field/a/:athleteId/d/:dayIndex" element={<AthleteDayScreen />} />
      <Route path="/field/g/:groupId" element={<GroupWeekScreen />} />
      <Route path="/field/g/:groupId/d/:dayIndex" element={<GroupDayScreen />} />
      <Route path="*" element={<Navigate to="/field" replace />} />
    </Routes>
  );
}

export function FieldApp() {
  // data-theme="dark" scopes the token set exactly like the athlete app,
  // so StackedNotation and SessionPreview render legibly on the dark bg.
  return (
    <div data-theme="dark">
      <ErrorBoundary>
        <FieldRoutes />
      </ErrorBoundary>
    </div>
  );
}
