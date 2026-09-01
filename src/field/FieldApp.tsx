/**
 * FieldApp — the coach mobile app (/coach).
 *
 * "What are my athletes going to train today?" on the gym floor: the
 * Upcoming screen shows each athlete's next open session as a compact
 * highlight table; drill-ins reuse the athlete app's read-only
 * SessionPreview. Shares the athlete app's dark visual language
 * (data-theme="dark") and the coach app's environment (coachStore) —
 * mounted behind the same CoachGate as the desktop coach app.
 */
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Calculator, ListChecks, Mail, PlaySquare, Users } from 'lucide-react';
import { useCoachStore } from '../store/coachStore';
import { useCoachProfiles } from '../hooks/useCoachProfiles';
import { useInboxUnreadCount } from '../hooks/useInboxUnreadCount';
import { useReviewFeedCount } from '../hooks/useReviewFeedCount';
import { SelectEnvironmentPage } from '../components/SelectEnvironmentPage';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { setActorResolver } from '../lib/errorLogger';
import { UpcomingScreen } from './screens/UpcomingScreen';
import { AthletesScreen } from './screens/AthletesScreen';
import { AthleteWeekScreen } from './screens/AthleteWeekScreen';
import { AthleteDayScreen } from './screens/AthleteDayScreen';
import { GroupWeekScreen } from './screens/GroupWeekScreen';
import { GroupDayScreen } from './screens/GroupDayScreen';
import { FieldMacroScreen } from './screens/FieldMacroScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { FieldInboxScreen } from './screens/FieldInboxScreen';
import { FieldConversationScreen } from './screens/FieldConversationScreen';
import { Spinner } from '../components/ui';
import { TabBadge } from './components/TabBadge';
import { FieldReviewScreen } from './screens/FieldReviewScreen';

const TABS = [
  { to: '/coach', icon: ListChecks, label: 'Upcoming', end: true },
  { to: '/coach/athletes', icon: Users, label: 'Athletes', end: false },
  { to: '/coach/review', icon: PlaySquare, label: 'Review', end: false },
  { to: '/coach/inbox', icon: Mail, label: 'Inbox', end: false },
  { to: '/coach/tools', icon: Calculator, label: 'Tools', end: false },
] as const;

function FieldLayout() {
  // Same unread-thread badge as the desktop sidebar (60 s cadence).
  const unread = useInboxUnreadCount();
  // Per-coach review queue count — a co-coach's reviewing never clears it.
  const reviewCount = useReviewFeedCount();
  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] text-white pb-20">
      <Outlet />
      <nav
        className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-primary)] border-t border-[color:var(--color-border-tertiary)]"
        aria-label="Field navigation"
      >
        <div className="max-w-2xl mx-auto px-2 py-1.5 flex justify-around">
          {TABS.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                // flex-1 + min-w-0, not fixed px-4: five tabs must divide
                // whatever width the phone has instead of dictating their own
                // (px-4 made the bar wider than a 375px screen).
                `flex-1 min-w-0 flex flex-col items-center gap-0.5 px-1 py-1.5 rounded text-[length:var(--text-caption)] uppercase tracking-wide font-semibold transition-colors ${
                  isActive ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]'
                }`
              }
            >
              <span className="relative">
                <tab.icon size={20} strokeWidth={1.8} />
                {tab.label === 'Inbox' && (
                  <TabBadge
                    count={unread}
                    label={`unread ${unread === 1 ? 'thread' : 'threads'}`}
                  />
                )}
                {tab.label === 'Review' && (
                  <TabBadge count={reviewCount} label="to review" />
                )}
              </span>
              <span className="max-w-full truncate">{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

// Any legacy prefix (/field, then /Coach-overview, then /fieldcoach) → /coach,
// keeping the sub-path and query string intact so a bookmarked group/athlete
// deep link still lands.
//
// Two things here are load-bearing:
//  - 'fieldcoach' must precede 'field' in the alternation. JS alternation is
//    first-match, and '/fieldcoach/x' tried against 'field' leaves 'coach/x',
//    where the `(?=\/|$)` lookahead fails — with no later alternative able to
//    match, the whole rewrite would silently no-op.
//  - the `(?=\/|$)` boundary itself, which stops '/field' matching the '/field'
//    inside a longer segment.
// The target '/coach' matches none of the alternatives, so this cannot loop.
function LegacyPrefixRedirect() {
  const { pathname, search } = useLocation();
  const target = pathname.replace(/^\/(?:fieldcoach|field|coach-overview)(?=\/|$)/i, '/coach') + search;
  return <Navigate to={target} replace />;
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
      <div className="min-h-screen bg-[var(--color-bg-page)] flex items-center justify-center">
        <Spinner size={40} />
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
        <Route path="/coach" element={<UpcomingScreen />} />
        <Route path="/coach/athletes" element={<AthletesScreen />} />
        <Route path="/coach/review" element={<FieldReviewScreen />} />
        <Route path="/coach/inbox" element={<FieldInboxScreen />} />
        <Route path="/coach/tools" element={<ToolsScreen />} />
      </Route>
      <Route path="/coach/inbox/:athleteId" element={<FieldConversationScreen />} />
      <Route path="/coach/a/:athleteId" element={<AthleteWeekScreen />} />
      <Route path="/coach/a/:athleteId/d/:dayIndex" element={<AthleteDayScreen />} />
      <Route path="/coach/g/:groupId" element={<GroupWeekScreen />} />
      <Route path="/coach/g/:groupId/d/:dayIndex" element={<GroupDayScreen />} />
      <Route path="/coach/a/:athleteId/macro" element={<FieldMacroScreen />} />
      <Route path="/coach/g/:groupId/macro" element={<FieldMacroScreen />} />
      {/* Legacy bookmarks — preserve deep links by remapping the prefix.
          Both patterns also match the bare prefix, and React Router ranks by
          specificity, so they outrank the catch-all whatever the order. */}
      <Route path="/fieldcoach/*" element={<LegacyPrefixRedirect />} />
      <Route path="/field/*" element={<LegacyPrefixRedirect />} />
      <Route path="/coach-overview/*" element={<LegacyPrefixRedirect />} />
      <Route path="*" element={<Navigate to="/coach" replace />} />
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
