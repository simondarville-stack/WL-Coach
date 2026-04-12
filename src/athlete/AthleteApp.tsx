import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { LoginPage } from './components/LoginPage';
import { AthleteLayout } from './components/AthleteLayout';
import { TodayScreen } from './components/TodayScreen';
import { WeekScreen } from './components/WeekScreen';
import { ProgressScreen } from './components/ProgressScreen';
import { CycleScreen } from './components/CycleScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { Dumbbell } from 'lucide-react';

function AthleteRoutes() {
  // TODO: Re-enable auth gates when login is ready
  // const { loading, user, athlete, signOut } = useAuth();

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
