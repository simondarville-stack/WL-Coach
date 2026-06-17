import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { AthleteApp } from './athlete/v2/AthleteApp';
import { Button, Input } from './components/ui';
import { SelectEnvironmentPage } from './components/SelectEnvironmentPage';
import { CoachProfileModal } from './components/CoachProfileModal';
import { useCoachStore } from './store/coachStore';
import { useCoachProfiles } from './hooks/useCoachProfiles';
import { ExerciseLibrary } from './components/exercise-library/ExerciseLibrary';
import { AnalysisModule } from './components/analysis/builder/AnalysisModule';
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
import { PrilepinTable } from './components/tools/PrilepinTable';
import { PRPage } from './components/PRPage';
import { CoachInbox } from './components/CoachInbox';
import { SystemGuide } from './components/system/SystemGuide';
import { ErrorLogViewer } from './components/system/ErrorLogViewer';
import { InvitationsPage } from './components/system/InvitationsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { setActorResolver } from './lib/errorLogger';
import { useRouteBreadcrumbs } from './hooks/useRouteBreadcrumbs';
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
  '/analysis': 'Analysis',
  '/library': 'Exercise library',
  '/settings': 'Settings',
  '/prs': 'Personal Records',
  '/inbox': 'Inbox',
  '/system/errors': 'Error log',
  '/system/invitations': 'Invitations',
};

function PageTitle() {
  const location = useLocation();
  return <h1 className="font-medium text-gray-900">{pageTitles[location.pathname] ?? ''}</h1>;
}

// Soft access gate for the coach app (the root, non-/athlete area). Inert
// unless VITE_COACH_GATE is set at build time, so local dev never prompts.
// Deterrence only — see the note in src/vite-env.d.ts.
const COACH_GATE = String(import.meta.env.VITE_COACH_GATE ?? '').trim();
const COACH_UNLOCK_KEY = 'emos_coach_unlocked';

function CoachGate({ children }: { children: ReactNode }) {
  // Unlocked by default when no passphrase is configured; otherwise honour a
  // previously-stored unlock so a coach enters the code once per browser.
  const [unlocked, setUnlocked] = useState(
    () => !COACH_GATE || localStorage.getItem(COACH_UNLOCK_KEY) === '1',
  );
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (entry === COACH_GATE) {
      localStorage.setItem(COACH_UNLOCK_KEY, '1');
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'var(--color-bg-page)' }}>
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="text-center mb-6">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: 'var(--color-accent-muted)' }}
          >
            <Lock size={20} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>EMOS</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Enter the access code to continue.
          </p>
        </div>
        <Input
          type="password"
          size="lg"
          value={entry}
          onChange={(e) => { setEntry(e.target.value); setError(false); }}
          placeholder="Access code"
          autoFocus
          autoComplete="off"
          aria-label="Access code"
        />
        {error && (
          <p className="mt-2 text-xs" style={{ color: 'var(--color-danger-text)' }}>
            Incorrect code. Try again.
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full mt-4">
          Unlock
        </Button>
      </form>
    </div>
  );
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
  return (
    <CoachGate>
      <CoachApp />
    </CoachGate>
  );
}

function CoachApp() {
  const { fetchAllAthletes } = useAthletes();
  const { fetchGroups } = useTrainingGroups();
  const { setSelectedAthlete, setSelectedGroup } = useAthleteStore();
  const { activeCoach, setActiveCoach, setCoaches } = useCoachStore();
  const { fetchCoaches } = useCoachProfiles();
  const navigate = useNavigate();
  useRouteBreadcrumbs();
  useEffect(() => {
    setActorResolver(() => ({
      role: 'coach',
      id: activeCoach?.id ?? null,
      label: activeCoach?.name ?? null,
    }));
  }, [activeCoach?.id, activeCoach?.name]);

  const [showNewCoachModal, setShowNewCoachModal] = useState(false);
  const [showRepMaxCalc, setShowRepMaxCalc] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showCalendarTool, setShowCalendarTool] = useState(false);
  const [showPrilepin, setShowPrilepin] = useState(false);
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

  const handleNavigateToPlanner = (athlete: Athlete, weekStart: string, mode?: 'plan' | 'log', dayIndex?: number | null) => {
    setSelectedAthlete(athlete);
    const query = mode === 'log'
      ? `?mode=log${dayIndex != null ? `&day=${dayIndex}` : ''}`
      : '';
    navigate(`/planner/${weekStart}${query}`);
  };

  const handleNavigateToGroupPlanner = (group: TrainingGroup, weekStart: string) => {
    setSelectedGroup(group);
    navigate(`/planner/${weekStart}`);
  };

  const handleNavigateToMacro = (athlete: Athlete, macrocycleId: string) => {
    setSelectedAthlete(athlete);
    navigate(`/macrocycles/${macrocycleId}`);
  };

  const handleNavigateToPRs = (athlete: Athlete, exerciseId: string, repCount: number) => {
    setSelectedAthlete(athlete);
    navigate(`/prs?ex=${encodeURIComponent(exerciseId)}&rep=${repCount}`);
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
        onOpenPrilepin={() => setShowPrilepin(true)}
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
              <Route path="/dashboard" element={<CoachDashboardV2 onNavigateToPlanner={handleNavigateToPlanner} onNavigateToGroupPlanner={handleNavigateToGroupPlanner} onNavigateToMacro={handleNavigateToMacro} onNavigateToPRs={handleNavigateToPRs} />} />
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
              {/* Analysis module rebuild (backlog #4) — route live; nav re-enabled separately */}
              <Route path="/analysis" element={<AnalysisModule />} />
              <Route path="/prs" element={<PRPage />} />
              <Route path="/inbox" element={<CoachInbox />} />
              {/* SD-04: remove intermediate hop; both routes redirect to dashboard */}
              <Route path="/athlete-log" element={<Navigate to="/dashboard" replace />} />
              <Route path="/settings" element={<GeneralSettings />} />
              <Route path="/library" element={<ExerciseLibrary />} />
              <Route path="/system" element={<SystemGuide />} />
              <Route path="/system/errors" element={<ErrorLogViewer />} />
              <Route path="/system/invitations" element={<InvitationsPage />} />
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
      {showPrilepin && (
        <PrilepinTable
          onClose={() => setShowPrilepin(false)}
          // Stacks left of any other open tool. Each slot is the cumulative
          // width-plus-gap of the panels already occupying space to its
          // right (Calendar 320, xRM 380, Calculator 280; 4px gap each).
          positionClass={
            showCalendarTool && showRepMaxCalc && showCalculator ? 'bottom-4 right-[1008px]'
            : showCalendarTool && showRepMaxCalc ? 'bottom-4 right-[724px]'
            : showCalendarTool && showCalculator ? 'bottom-4 right-[624px]'
            : showRepMaxCalc && showCalculator ? 'bottom-4 right-[684px]'
            : showCalendarTool ? 'bottom-4 right-[340px]'
            : showRepMaxCalc ? 'bottom-4 right-[400px]'
            : showCalculator ? 'bottom-4 right-[300px]'
            : 'bottom-4 right-4'
          }
        />
      )}
    </div>
  );
}

export default AppRouter;
