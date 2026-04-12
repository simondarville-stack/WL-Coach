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
  const { loading, user, athlete, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!athlete) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <Dumbbell size={40} className="text-gray-600 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">Account Not Linked</h2>
          <p className="text-sm text-gray-400 mb-6 max-w-xs">
            Your login is not linked to an athlete profile. Ask your coach to connect your account.
          </p>
          <button
            onClick={signOut}
            className="px-6 py-2.5 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
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
