import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AthleteApp } from './athlete/AthleteApp';
import { SelectEnvironmentPage } from './components/SelectEnvironmentPage';
import { CoachProfileModal } from './components/CoachProfileModal';
import { useCoachStore } from './store/coachStore';
import { useCoachProfiles } from './hooks/useCoachProfiles';
import { ExerciseLibrary } from './components/exercise-library/ExerciseLibrary';
import { WeeklyPlanner } from './components/planner/WeeklyPlanner';
import { Athletes } from './components/Athletes';
import { MacroCycles } from './components/macro/MacroCycles';
import { TrainingLogPage } from './components/training-log/TrainingLogPage';
import { GeneralSettings } from './components/GeneralSettings';
import { CoachDashboard } from './components/CoachDashboard';
import { DashboardV2 } from './components/dashboard-v2/DashboardV2';
import { AnalysisPage } from './components/analysis/AnalysisPage';
import { AthleteSelector } from './components/AthleteSelector';
import { CompetitionCalendar } from './components/calendar/CompetitionCalendar';
import { TrainingGroups } from './components/TrainingGroups';
import { Sidebar } from './components/Sidebar';
import { RepMaxCalculator } from './components/tools/RepMaxCalculator';
import { Calculator } from './components/tools/Calculator';
import { CalendarTool } from './components/tools/CalendarTool';
import { PRPage } from './components/PRPage';
import { SystemGuide } from './components/system/SystemGuide';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAthletes } from './hooks/useAthletes';
import { useTrainingGroups } from './hooks/useTrainingGroups';
import { useAthleteStore } from './store/athleteStore';
import type { Athlete, TrainingGroup } from './lib/database.types';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard-v2': 'Dashboard V2',
  '/planner': 'Weekly planner',
  '/macrocycles': 'Macro cycles',
  '/events': 'Calendar',
  '/athletes': 'Athletes',
  '/training-groups': 'Training groups',
  '/training-log': 'Training log',
  '/athlete-log': 'Training log',
  '/library': 'Exercise library',
  '/settings': 'Settings',
  '/analysis': 'Analysis',
  '/prs': 'Personal Records',
};

function PageTitle() {
  const location = useLocation();
  return <h1 className="font-medium text-gray-900">{pageTitles[location.pathname] ?? ''}</h1>;
}

function AppRouter() {
  const location = useLocation();
  if (location.pathname === '/athlete' || location.pathname.startsWith('/athlete/')) {
    return (
      <Routes>
        <Route path="/athlete/*" element={<AthleteApp />} />
      </Routes>
    );
  }
  return <CoachApp />;
}

function CoachApp() {
  const { fetchAllAthletes } = useAthletes();
  const { fetchGroups } = useTrainingGroups();
  const { setSelectedAthlete } = useAthleteStore();
  const { activeCoach, setActiveCoach, setCoaches } = useCoachStore();
  const { fetchCoaches } = useCoachProfiles();
  const navigate = useNavigate();

  const [showNewCoachModal, setShowNewCoachModal] = useState(false);
  const [showRepMaxCalc, setShowRepMaxCalc] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showCalendarTool, setShowCalendarTool] = useState(false);
  const [coachesLoaded, setCoachesLoaded] = useState(false);

  useEffect(() => {
    const init = async () => {
      const coaches = await fetchCoaches();
      setCoaches(coaches);
      setCoachesLoaded(true);
    };
    init();
  }, []);

  useEffect(() => {
    fetchAllAthletes();
    fetchGroups();
  }, []);

  const handleNavigateToPlanner = (athlete: Athlete, weekStart: string) => {
    setSelectedAthlete(athlete);
    navigate('/planner', { state: { weekStart } });
  };

  const handleNavigateToGroupPlanner = (group: TrainingGroup, weekStart: string) => {
    navigate('/planner', { state: { weekStart, groupId: group.id } });
  };

  // Show spinner while fetching coach profiles on first load
  if (!coachesLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-6 h-6" />
      </div>
    );
  }

  // No active environment — show the selection start page
  if (!activeCoach) {
    return (
      <>
        <SelectEnvironmentPage
          coaches={useCoachStore.getState().coaches}
          onNewEnvironment={() => setShowNewCoachModal(true)}
        />
        {showNewCoachModal && (
          <CoachProfileModal
            onClose={() => setShowNewCoachModal(false)}
            onCreated={(coach) => {
              setCoaches([...useCoachStore.getState().coaches, coach]);
              setActiveCoach(coach);
              setShowNewCoachModal(false);
              window.location.reload();
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar
        onNewCoach={() => setShowNewCoachModal(true)}
        onOpenCalc={() => setShowRepMaxCalc(true)}
        onOpenCalculator={() => setShowCalculator(true)}
        onOpenCalendarTool={() => setShowCalendarTool(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <PageTitle />
          <AthleteSelector />
        </header>

        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<CoachDashboard onNavigateToPlanner={handleNavigateToPlanner} onNavigateToGroupPlanner={handleNavigateToGroupPlanner} />} />
              <Route path="/dashboard-v2" element={<DashboardV2 onNavigateToPlanner={handleNavigateToPlanner} onNavigateToGroupPlanner={handleNavigateToGroupPlanner} />} />
              <Route path="/planner" element={<WeeklyPlanner />} />
              <Route path="/macrocycles" element={<MacroCycles />} />
              <Route path="/events" element={<CompetitionCalendar />} />
              <Route path="/athletes" element={<Athletes />} />
              <Route path="/training-groups" element={<TrainingGroups />} />
              {/* hidden: out of scope — keep imports and files, redirect to dashboard */}
              <Route path="/training-log" element={<Navigate to="/dashboard" replace />} />
              <Route path="/analysis" element={<Navigate to="/dashboard" replace />} />
              <Route path="/prs" element={<PRPage />} />
              <Route path="/athlete-log" element={<Navigate to="/training-log" replace />} />
              <Route path="/settings" element={<GeneralSettings />} />
              <Route path="/library" element={<ExerciseLibrary />} />
              <Route path="/system" element={<SystemGuide />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </ErrorBoundary>

          {showNewCoachModal && (
            <CoachProfileModal
              onClose={() => setShowNewCoachModal(false)}
              onCreated={(coach) => {
                setCoaches([...useCoachStore.getState().coaches, coach]);
                setActiveCoach(coach);
                setShowNewCoachModal(false);
                window.location.reload();
              }}
            />
          )}

        </main>
      </div>
      {showCalendarTool && (
        <CalendarTool
          onClose={() => setShowCalendarTool(false)}
          positionClass="bottom-4 right-4"
        />
      )}
      {showRepMaxCalc && (
        <RepMaxCalculator
          onClose={() => setShowRepMaxCalc(false)}
          positionClass={showCalendarTool ? 'bottom-4 right-[340px]' : 'bottom-4 right-4'}
        />
      )}
      {showCalculator && (
        <Calculator
          onClose={() => setShowCalculator(false)}
          positionClass={
            showCalendarTool && showRepMaxCalc ? 'bottom-4 right-[740px]'
            : showCalendarTool ? 'bottom-4 right-[340px]'
            : showRepMaxCalc ? 'bottom-4 right-[400px]'
            : 'bottom-4 right-4'
          }
        />
      )}
    </div>
  );
}

export default AppRouter;
