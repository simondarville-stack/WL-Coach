/**
 * AthleteApp — athlete-facing entry point.
 *
 * Shell: AuthProvider → ProfilePicker (if no athlete) → AthleteLayout
 * with bottom-tab nav between Today / Week / Profile.
 */
import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ProfilePicker } from './components/ProfilePicker';
import { AthleteLayout } from './components/AthleteLayout';
import { TodayScreen } from './screens/TodayScreen';
import { WeekScreen } from './screens/WeekScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { GroupViewerScreen } from './screens/GroupViewerScreen';
import { CoachThreadScreen } from './screens/CoachThreadScreen';
import { PRsScreen } from './screens/PRsScreen';
import { PRDetailScreen } from './screens/PRDetailScreen';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { setActorResolver } from '../../lib/errorLogger';
import { useRouteBreadcrumbs } from '../../hooks/useRouteBreadcrumbs';

function AthleteRoutes() {
  const { loading, mode, athlete, group } = useAuth();
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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (mode === null) return <ProfilePicker />;
  if (mode === 'group') return <GroupViewerScreen />;

  return (
    <Routes>
      <Route element={<AthleteLayout />}>
        <Route path="today" element={<TodayScreen />} />
        <Route path="week" element={<WeekScreen />} />
        <Route path="coach" element={<CoachThreadScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="prs" element={<PRsScreen />} />
        <Route path="prs/:exerciseId" element={<PRDetailScreen />} />
        <Route index element={<Navigate to="today" replace />} />
        <Route path="*" element={<Navigate to="today" replace />} />
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
