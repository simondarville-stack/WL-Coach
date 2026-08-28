import { lazy, Suspense, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button, Input } from './components/ui';
import { SelectEnvironmentPage } from './components/SelectEnvironmentPage';
import { CoachProfileModal } from './components/CoachProfileModal';
import { useCoachStore } from './store/coachStore';
import { useCoachProfiles } from './hooks/useCoachProfiles';
import { AthleteSelector } from './components/AthleteSelector';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';

// Route-level code splitting: every module surface is its own chunk, loaded
// on first visit. Before this, the whole app (planner + macro + analysis +
// athlete app + both chart libraries + xlsx + mathjs) shipped as one 3.9 MB
// bundle that every visitor — athletes on phones included — parsed up front.
const AthleteApp = lazy(() => import('./athlete/v2/AthleteApp').then(m => ({ default: m.AthleteApp })));
const FieldApp = lazy(() => import('./field/FieldApp').then(m => ({ default: m.FieldApp })));
const ExerciseLibrary = lazy(() => import('./components/exercise-library/ExerciseLibrary').then(m => ({ default: m.ExerciseLibrary })));
const AnalysisModule = lazy(() => import('./components/analysis/builder/AnalysisModule').then(m => ({ default: m.AnalysisModule })));
const WeeklyPlanner = lazy(() => import('./components/planner/WeeklyPlanner').then(m => ({ default: m.WeeklyPlanner })));
const TemplatesPage = lazy(() => import('./components/templates/TemplatesPage').then(m => ({ default: m.TemplatesPage })));
const TemplateEditor = lazy(() => import('./components/templates/TemplateEditor').then(m => ({ default: m.TemplateEditor })));
const Athletes = lazy(() => import('./components/Athletes').then(m => ({ default: m.Athletes })));
const MacroCycles = lazy(() => import('./components/macro/MacroCycles').then(m => ({ default: m.MacroCycles })));
const GeneralSettings = lazy(() => import('./components/GeneralSettings').then(m => ({ default: m.GeneralSettings })));
const CoachDashboardV2 = lazy(() => import('./components/dashboard-v2/CoachDashboardV2').then(m => ({ default: m.CoachDashboardV2 })));
const CompetitionCalendar = lazy(() => import('./components/calendar/CompetitionCalendar').then(m => ({ default: m.CompetitionCalendar })));
const TrainingGroups = lazy(() => import('./components/TrainingGroups').then(m => ({ default: m.TrainingGroups })));
const RepMaxCalculator = lazy(() => import('./components/tools/RepMaxCalculator').then(m => ({ default: m.RepMaxCalculator })));
const Calculator = lazy(() => import('./components/tools/Calculator').then(m => ({ default: m.Calculator })));
const CalendarTool = lazy(() => import('./components/tools/CalendarTool').then(m => ({ default: m.CalendarTool })));
const PrilepinTable = lazy(() => import('./components/tools/PrilepinTable').then(m => ({ default: m.PrilepinTable })));
const PRPage = lazy(() => import('./components/PRPage').then(m => ({ default: m.PRPage })));
const CoachInbox = lazy(() => import('./components/CoachInbox').then(m => ({ default: m.CoachInbox })));
const SystemGuide = lazy(() => import('./components/system/SystemGuide').then(m => ({ default: m.SystemGuide })));
const ErrorLogViewer = lazy(() => import('./components/system/ErrorLogViewer').then(m => ({ default: m.ErrorLogViewer })));
const InvitationsPage = lazy(() => import('./components/system/InvitationsPage').then(m => ({ default: m.InvitationsPage })));
const ClubAdminPage = lazy(() => import('./components/club/ClubAdminPage').then(m => ({ default: m.ClubAdminPage })));

/** Route-chunk loading state — same minimal spinner the app boot uses. */
function RouteFallback() {
  return (
    <div className="min-h-full flex items-center justify-center py-24">
      <div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-6 h-6" />
    </div>
  );
}
import { logError, setActorResolver } from './lib/errorLogger';
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
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/athlete/*" element={<AthleteApp />} />
        </Routes>
      </Suspense>
    );
  }
  // The coach mobile app (/coach — formerly /field, /Coach-overview, then
  // /fieldcoach) — coach-facing, so it sits behind the same gate as the desktop
  // coach app rather than the athlete-side access codes. Every legacy prefix
  // still routes here and is redirected to /coach inside FieldApp, so existing
  // bookmarks work. (The module keeps its `field` name internally.)
  //
  // The `=== prefix || startsWith(prefix + '/')` boundary is load-bearing:
  // '/coach-overview' must not be swallowed by the '/coach' entry (it is a
  // legacy prefix in its own right, and a bare prefix test would match it).
  const lowerPath = location.pathname.toLowerCase();
  const isCoachMobilePath = ['/coach', '/fieldcoach', '/coach-overview', '/field'].some(
    prefix => lowerPath === prefix || lowerPath.startsWith(prefix + '/'),
  );
  if (isCoachMobilePath) {
    return (
      <CoachGate>
        <Suspense fallback={<RouteFallback />}>
          <FieldApp />
        </Suspense>
      </CoachGate>
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

  // The app renders a full-screen spinner until coachesLoaded flips, so a
  // rejected fetch here (an offline first load, a transient Supabase blip)
  // used to leave the coach staring at that spinner forever. Fail open:
  // log it and let the app boot with no coach profiles, which the rest of
  // the shell already tolerates.
  useEffect(() => {
    const init = async () => {
      try {
        const coaches = await fetchCoaches();
        setCoaches(coaches);
      } catch (err) {
        void logError(err, { source: 'manual', context: { at: 'App.init/fetchCoaches' } });
      } finally {
        setCoachesLoaded(true);
      }
    };
    void init();
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
            <Suspense fallback={<RouteFallback />}>
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
              <Route path="/club" element={<ClubAdminPage />} />
              <Route path="/system" element={<SystemGuide />} />
              <Route path="/system/errors" element={<ErrorLogViewer />} />
              <Route path="/system/invitations" element={<InvitationsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            </Suspense>
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
      <Suspense fallback={null}>
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
      </Suspense>
    </div>
  );
}

export default AppRouter;
