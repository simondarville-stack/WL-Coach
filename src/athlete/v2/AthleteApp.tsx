/**
 * AthleteApp — athlete-facing entry point.
 *
 * Shell: AuthProvider → ProfilePicker (if no athlete) → AthleteLayout
 * with bottom-tab nav between Today / Week / Profile.
 */
import { useEffect } from 'react';
import { Dumbbell } from 'lucide-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ProfilePicker } from './components/ProfilePicker';
import { ProgrammeGate } from './components/ProgrammeGate';
import { AthleteLayout } from './components/AthleteLayout';
import { TodayScreen } from './screens/TodayScreen';
import { WeekScreen } from './screens/WeekScreen';
import { MacroScreen } from './screens/MacroScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { GroupViewerScreen } from './screens/GroupViewerScreen';
import { CoachThreadScreen } from './screens/CoachThreadScreen';
import { PRsScreen } from './screens/PRsScreen';
import { PRDetailScreen } from './screens/PRDetailScreen';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { setActorResolver } from '../../lib/errorLogger';
import { useRouteBreadcrumbs } from '../../hooks/useRouteBreadcrumbs';
import { Spinner } from '../../components/ui';

function ShareLinkError({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex flex-col items-center justify-center px-6 text-center">
      <Dumbbell size={32} className="text-[color:var(--color-text-tertiary)] mb-4" />
      <h1 className="text-base font-bold text-white">Group link unavailable</h1>
      <p className="text-sm text-[color:var(--color-text-secondary)] mt-2 max-w-xs">{message}</p>
      <p className="text-[11px] text-[color:var(--color-text-tertiary)] mt-4 max-w-xs">
        Ask your coach for an up-to-date link.
      </p>
    </div>
  );
}

function AthleteRoutes() {
  const { loading, mode, athlete, group, tokenError, pending } = useAuth();
  useRouteBreadcrumbs();
  useEffect(() => {
    setActorResolver(() => {
      if (athlete) return { role: 'athlete', id: athlete.id, label: athlete.name };
      if (group) return { role: 'athlete', id: group.id, label: `Group: ${group.name}` };
      return { role: 'athlete', id: null, label: null };
    });
  }, [athlete?.id, athlete?.name, group?.id, group?.name]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-page)] flex items-center justify-center">
        <Spinner size={40} />
      </div>
    );
  }

  if (tokenError) return <ShareLinkError message={tokenError} />;
  if (pending) return <ProgrammeGate />;
  if (mode === null) return <ProfilePicker />;
  if (mode === 'group') return <GroupViewerScreen />;

  return (
    <Routes>
      <Route element={<AthleteLayout />}>
        <Route path="today" element={<TodayScreen />} />
        <Route path="week" element={<WeekScreen />} />
        <Route path="macro" element={<MacroScreen />} />
        <Route path="coach" element={<CoachThreadScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="prs" element={<PRsScreen />} />
        <Route path="prs/:exerciseId" element={<PRDetailScreen />} />
        {/* Absolute redirects — NOT relative `to="today"`. A personal link
         *  (/athlete/a/<id>) leaves the `a/<id>` segment in the path, which the
         *  inner routes don't match, so the catch-all fires. A relative "today"
         *  resolves against the splat and APPENDS, producing
         *  /athlete/a/<id>/today/today/today/… on every render until
         *  history.replaceState() rate-limits (SecurityError #18). The athlete
         *  is already committed to state + localStorage by AuthContext, so an
         *  absolute /athlete/today keeps the session and lands on a real route. */}
        <Route index element={<Navigate to="/athlete/today" replace />} />
        <Route path="*" element={<Navigate to="/athlete/today" replace />} />
      </Route>
    </Routes>
  );
}

export function AthleteApp() {
  // data-theme="dark" scopes the CSS-variable token set in tokens.css
  // to the athlete subtree, so components that consume those tokens
  // (StackedNotation, etc.) render legibly against the dark background.
  return (
    <div data-theme="dark">
      <AuthProvider>
        <ErrorBoundary>
          <AthleteRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </div>
  );
}
