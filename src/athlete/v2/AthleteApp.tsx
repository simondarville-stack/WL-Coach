/**
 * AthleteApp — athlete-facing entry point.
 *
 * Shell: AuthProvider → ProfilePicker (if no athlete) → AthleteLayout
 * with bottom-tab nav between Today / Week / Profile.
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ProfilePicker } from './components/ProfilePicker';
import { AthleteLayout } from './components/AthleteLayout';
import { TodayScreen } from './screens/TodayScreen';
import { WeekScreen } from './screens/WeekScreen';
import { ProfileScreen } from './screens/ProfileScreen';

function AthleteRoutes() {
  const { loading, athlete } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!athlete) return <ProfilePicker />;

  return (
    <Routes>
      <Route element={<AthleteLayout />}>
        <Route path="today" element={<TodayScreen />} />
        <Route path="week" element={<WeekScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
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
        <AthleteRoutes />
      </AuthProvider>
    </div>
  );
}
