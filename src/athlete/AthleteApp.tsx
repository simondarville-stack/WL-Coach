import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ProfilePicker } from './components/ProfilePicker';
import { AthleteLayout } from './components/AthleteLayout';
import { TodayScreen } from './components/TodayScreen';
import { WeekScreen } from './components/WeekScreen';
import { ProgressScreen } from './components/ProgressScreen';
import { CycleScreen } from './components/CycleScreen';
import { ProfileScreen } from './components/ProfileScreen';

function AthleteRoutes() {
  const { loading, athlete } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!athlete) {
    return <ProfilePicker />;
  }

  return (
    <Routes>
      <Route element={<AthleteLayout />}>
        <Route path="today" element={<TodayScreen />} />
        <Route path="week" element={<WeekScreen />} />
        <Route path="progress" element={<ProgressScreen />} />
        <Route path="cycle" element={<CycleScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route index element={<Navigate to="today" replace />} />
        <Route path="*" element={<Navigate to="today" replace />} />
      </Route>
    </Routes>
  );
}

export function AthleteApp() {
  return (
    <AuthProvider>
      <AthleteRoutes />
    </AuthProvider>
  );
}
