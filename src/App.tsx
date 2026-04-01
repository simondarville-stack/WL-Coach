import { useEffect, useState } from 'react';
import { ExerciseFormModal } from './components/ExerciseFormModal';
import { ExerciseList } from './components/ExerciseList';
import { WeeklyPlanner } from './components/WeeklyPlanner';
import { Athletes } from './components/Athletes';
import { MacroCycles } from './components/MacroCycles';
import { Settings } from './components/Settings';
import { AthleteProgramme } from './components/AthleteProgramme';
import { AthleteLog } from './components/AthleteLog';
import { GeneralSettings } from './components/GeneralSettings';
import { CoachDashboard } from './components/CoachDashboard';
import { AthleteSelector } from './components/AthleteSelector';
import { Events } from './components/Events';
import { TrainingGroups } from './components/TrainingGroups';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Plus, Settings as SettingsIcon, X } from 'lucide-react';
import { useExercises } from './hooks/useExercises';
import { useAthletes } from './hooks/useAthletes';
import { useAthleteStore } from './store/athleteStore';
import type { Athlete } from './lib/database.types';

type Page = 'athletes' | 'library' | 'planner' | 'macrocycles' | 'athlete_programme' | 'athlete_log' | 'general_settings' | 'coach_dashboard' | 'events' | 'training_groups';

const pageTitles: Record<Page, string> = {
  coach_dashboard: 'Dashboard',
  planner: 'Weekly planner',
  macrocycles: 'Macro cycles',
  events: 'Events',
  athletes: 'Roster',
  training_groups: 'Training groups',
  athlete_programme: 'Programme',
  athlete_log: 'Training log',
  library: 'Exercise library',
  general_settings: 'Settings',
};

function App() {
  const {
    exercises, loading, error, setError,
    fetchExercises, createExercise, updateExercise, deleteExercise,
  } = useExercises();

  const { fetchAllAthletes } = useAthletes();
  const { setSelectedAthlete } = useAthleteStore();

  const [currentPage, setCurrentPage] = useState<Page>('coach_dashboard');
  const [plannerWeekStart, setPlannerWeekStart] = useState<string | null>(null);
  const [editingExercise, setEditingExercise] = useState<import('./lib/database.types').Exercise | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    fetchExercises();
    fetchAllAthletes();
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
    setPlannerWeekStart(weekStart);
    setCurrentPage('planner');
  };

  const handleCancelEdit = () => {
    setEditingExercise(null);
    setShowFormModal(false);
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
          <h1 className="font-medium text-gray-900">
            {pageTitles[currentPage]}
          </h1>
          <AthleteSelector />
        </header>

        <main className="flex-1 overflow-y-auto">
          {error && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          <ErrorBoundary>
          {currentPage === 'coach_dashboard' ? (
            <CoachDashboard key="coach_dashboard" onNavigateToPlanner={handleNavigateToPlanner} />
          ) : currentPage === 'athletes' ? (
            <Athletes key="athletes" />
          ) : currentPage === 'library' ? (
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
          ) : currentPage === 'athlete_programme' ? (
            <AthleteProgramme key="athlete_programme" />
          ) : currentPage === 'athlete_log' ? (
            <AthleteLog key="athlete_log" />
          ) : currentPage === 'general_settings' ? (
            <GeneralSettings key="general_settings" />
          ) : currentPage === 'macrocycles' ? (
            <MacroCycles key="macrocycles" />
          ) : currentPage === 'events' ? (
            <Events key="events" />
          ) : currentPage === 'training_groups' ? (
            <TrainingGroups key="training_groups" />
          ) : (
            <WeeklyPlanner key={`planner-${plannerWeekStart ?? 'default'}`} initialWeekStart={plannerWeekStart} />
          )}
          </ErrorBoundary>

          <ExerciseFormModal
            isOpen={showFormModal}
            onClose={handleCancelEdit}
            editingExercise={editingExercise}
            onSave={handleSave}
          />

          {showSettingsModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">Exercise Categories</h2>
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
    </div>
  );
}

export default App;
