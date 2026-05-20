import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AthleteApp } from './athlete/v2/AthleteApp';
import { SelectEnvironmentPage } from './components/SelectEnvironmentPage';
import { CoachProfileModal } from './components/CoachProfileModal';
import { useCoachStore } from './store/coachStore';
import { useCoachProfiles } from './hooks/useCoachProfiles';
import { ExerciseLibrary } from './components/exercise-library/ExerciseLibrary';
import { WeeklyPlanner } from './components/planner/WeeklyPlanner';
import { TemplatesPage } from './components/templates/TemplatesPage';
import { TemplateEditor } from './components/templates/TemplateEditor';
import { Athletes } from './components/Athletes';
import { MacroCycles } from './components/macro/MacroCycles';
import { GeneralSettings } from './components/GeneralSettings';
import { CoachDashboardV2 } from './components/dashboard-v2/CoachDashboardV2';
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
  '/planner': 'Weekly planner',
  '/templates': 'Programme templates',
  '/macrocycles': 'Macro cycles',
  '/events': 'Calendar',
  '/athletes': 'Athletes',
  '/training-groups': 'Training groups',
  '/training-log': 'Training log',
  '/athlete-log': 'Training log',
  '/library': 'Exercise library',
  '/settings': 'Settings',
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
  const { setSelectedAthlete, setSelectedGroup } = useAthleteStore();
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
    navigate(`/planner/${weekStart}`);
  };

  const handleNavigateToGroupPlanner = (group: TrainingGroup, weekStart: string) => {
    setSelectedGroup(group);
    navigate(`/planner/${weekStart}`);
  };

  const handleNavigateToMacro = (athlete: Athlete, macrocycleId: string) => {
    setSelectedAthlete(athlete);
    navigate(`/macrocycles/${macrocycleId}`);
  };

  // Show spinner while fetching coach profiles on first load
  if (!coachesLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-page)' }}>
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
    <div className="flex h-screen" style={{ backgroundColor: 'var(--color-bg-page)' }}>
      <Sidebar
        onNewCoach={() => setShowNewCoachModal(true)}
        onOpenCalc={() => setShowRepMaxCalc(true)}
        onOpenCalculator={() => setShowCalculator(true)}
        onOpenCalendarTool={() => setShowCalendarTool(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 flex-shrink-0 min-h-[49px]" style={{ backgroundColor: 'var(--color-bg-primary)', borderBottom: '0.5px solid var(--color-border-primary)' }}>
          <PageTitle />
          <AthleteSelector />
        </header>

        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<CoachDashboardV2 onNavigateToPlanner={handleNavigateToPlanner} onNavigateToGroupPlanner={handleNavigateToGroupPlanner} onNavigateToMacro={handleNavigateToMacro} />} />
              {/* /dashboard-v2 was the staging route while v2 lived alongside v1; redirect any old bookmark to the now-primary dashboard */}
              <Route path="/dashboard-v2" element={<Navigate to="/dashboard" replace />} />
              <Route path="/planner" element={<WeeklyPlanner />} />
              <Route path="/planner/:weekStart" element={<WeeklyPlanner />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/templates/:templateId" element={<TemplateEditor />} />
              <Route path="/macrocycles" element={<MacroCycles />} />
              <Route path="/macrocycles/:cycleId" element={<MacroCycles />} />
              <Route path="/events" element={<CompetitionCalendar />} />
              <Route path="/athletes" element={<Athletes />} />
              <Route path="/training-groups" element={<TrainingGroups />} />
              {/* hidden: out of scope — keep imports and files, redirect to dashboard */}
              <Route path="/training-log" element={<Navigate to="/dashboard" replace />} />
              <Route path="/analysis" element={<Navigate to="/dashboard" replace />} />
              <Route path="/prs" element={<PRPage />} />
              {/* SD-04: remove intermediate hop; both routes redirect to dashboard */}
              <Route path="/athlete-log" element={<Navigate to="/dashboard" replace />} />
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
