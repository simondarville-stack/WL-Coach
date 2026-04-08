import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { SelectEnvironmentPage } from './components/SelectEnvironmentPage';
import { CoachProfileModal } from './components/CoachProfileModal';
import { useCoachStore } from './store/coachStore';
import { useCoachProfiles } from './hooks/useCoachProfiles';
import { ExerciseFormModal } from './components/ExerciseFormModal';
import { ExerciseBulkImportModal } from './components/ExerciseBulkImportModal';
import { ExerciseList } from './components/ExerciseList';
import { WeeklyPlanner } from './components/planner/WeeklyPlanner';
import { Athletes } from './components/Athletes';
import { MacroCycles } from './components/macro/MacroCycles';
import { Settings } from './components/Settings';
import { TrainingLogPage } from './components/training-log/TrainingLogPage';
import { GeneralSettings } from './components/GeneralSettings';
import { CoachDashboard } from './components/CoachDashboard';
import { AnalysisPage } from './components/analysis/AnalysisPage';
import { AthleteSelector } from './components/AthleteSelector';
import { CompetitionCalendar } from './components/calendar/CompetitionCalendar';
import { TrainingGroups } from './components/TrainingGroups';
import { Sidebar } from './components/Sidebar';
import { RepMaxCalculator } from './components/tools/RepMaxCalculator';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Plus, Settings as SettingsIcon, X, Upload } from 'lucide-react';
import { useExercises } from './hooks/useExercises';
import { useAthletes } from './hooks/useAthletes';
import { useTrainingGroups } from './hooks/useTrainingGroups';
import { useAthleteStore } from './store/athleteStore';
import type { Athlete, TrainingGroup } from './lib/database.types';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/planner': 'Weekly planner',
  '/macrocycles': 'Macro cycles',
  '/events': 'Calendar',
  '/athletes': 'Roster',
  '/training-groups': 'Training groups',
  '/training-log': 'Training log',
  '/athlete-log': 'Training log',
  '/library': 'Exercise library',
  '/settings': 'Settings',
  '/analysis': 'Analysis',
};

function PageTitle() {
  const location = useLocation();
  return <h1 className="font-medium text-gray-900">{pageTitles[location.pathname] ?? ''}</h1>;
}

function App() {
  const {
    exercises, loading,
    fetchExercises, createExercise, updateExercise, deleteExercise,
  } = useExercises();

  const { fetchAllAthletes } = useAthletes();
  const { fetchGroups } = useTrainingGroups();
  const { setSelectedAthlete } = useAthleteStore();
  const { activeCoach, setActiveCoach, setCoaches } = useCoachStore();
  const { fetchCoaches } = useCoachProfiles();
  const navigate = useNavigate();

  const [editingExercise, setEditingExercise] = useState<import('./lib/database.types').Exercise | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [showNewCoachModal, setShowNewCoachModal] = useState(false);
  const [showRepMaxCalc, setShowRepMaxCalc] = useState(false);
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
    fetchExercises();
    fetchAllAthletes();
    fetchGroups();
  }, []);

  const handleSave = async (exerciseData: Partial<import('./lib/database.types').Exercise>) => {
    try {
      if (editingExercise) {
        await updateExercise(editingExercise.id, exerciseData);
        setEditingExercise(null);
      } else {
        await createExercise(exerciseData);
      }
      await fetchExercises();
      setShowFormModal(false);
    } catch {
      // error already set in hook
    }
  };

  const handleEdit = (exercise: import('./lib/database.types').Exercise) => {
    setEditingExercise(exercise);
    setShowFormModal(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExercise(id);
      await fetchExercises();
    } catch {
      // error already set in hook
    }
  };

  const handleNavigateToPlanner = (athlete: Athlete, weekStart: string) => {
    setSelectedAthlete(athlete);
    navigate('/planner', { state: { weekStart } });
  };

  const handleNavigateToGroupPlanner = (group: TrainingGroup, weekStart: string) => {
    navigate('/planner', { state: { weekStart, groupId: group.id } });
  };

  const handleCancelEdit = () => {
    setEditingExercise(null);
    setShowFormModal(false);
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
      <Sidebar onNewCoach={() => setShowNewCoachModal(true)} onOpenCalc={() => setShowRepMaxCalc(true)} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
          <PageTitle />
          <AthleteSelector />
        </header>

        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<CoachDashboard onNavigateToPlanner={handleNavigateToPlanner} onNavigateToGroupPlanner={handleNavigateToGroupPlanner} />} />
              <Route path="/planner" element={<WeeklyPlanner />} />
              <Route path="/macrocycles" element={<MacroCycles />} />
              <Route path="/events" element={<CompetitionCalendar />} />
              <Route path="/athletes" element={<Athletes />} />
              <Route path="/training-groups" element={<TrainingGroups />} />
              <Route path="/training-log" element={<TrainingLogPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/athlete-log" element={<Navigate to="/training-log" replace />} />
              <Route path="/settings" element={<GeneralSettings />} />
              <Route path="/library" element={
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                  <div className="mb-6 flex items-center gap-3">
                    <button
                      onClick={() => { setEditingExercise(null); setShowFormModal(true); }}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium shadow-md"
                    >
                      <Plus size={20} />
                      Add New Exercise
                    </button>
                    <button
                      onClick={() => setShowSettingsModal(true)}
                      className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2 font-medium shadow-md"
                    >
                      <SettingsIcon size={20} />
                      Manage Categories
                    </button>
                    <button
                      onClick={() => setShowBulkImportModal(true)}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium shadow-md"
                    >
                      <Upload size={20} />
                      Import from Excel
                    </button>
                  </div>
                  <div className="bg-white rounded-lg shadow-md p-6">
                    {loading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-gray-500">Loading exercises...</div>
                      </div>
                    ) : (
                      <ExerciseList
                        exercises={exercises}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                      />
                    )}
                  </div>
                </div>
              } />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </ErrorBoundary>

          <ExerciseFormModal
            isOpen={showFormModal}
            onClose={handleCancelEdit}
            editingExercise={editingExercise}
            onSave={handleSave}
            allExercises={exercises}
          />

          {showBulkImportModal && (
            <ExerciseBulkImportModal
              onClose={() => setShowBulkImportModal(false)}
              onComplete={async () => { await fetchExercises(); setShowBulkImportModal(false); }}
            />
          )}

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

          {showSettingsModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                  <h2 className="text-xl font-medium text-gray-900">Exercise Categories</h2>
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6">
                  <Settings embedded />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      {showRepMaxCalc && (
        <RepMaxCalculator onClose={() => setShowRepMaxCalc(false)} />
      )}
    </div>
  );
}

export default App;
