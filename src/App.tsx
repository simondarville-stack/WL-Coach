import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import type { Exercise, Athlete } from './lib/database.types';
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
import { Plus, Settings as SettingsIcon, X } from 'lucide-react';

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
  const [currentPage, setCurrentPage] = useState<Page>('coach_dashboard');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);

  useEffect(() => {
    loadExercises();
    loadAthletes();
  }, []);

  const loadAthletes = async () => {
    try {
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .order('name');

      if (error) throw error;
      setAthletes(data || []);
    } catch (err) {
      console.error('Failed to load athletes:', err);
    }
  };

  const loadExercises = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExercises(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercises');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (exerciseData: Partial<Exercise>) => {
    try {
      if (editingExercise) {
        const { error } = await supabase
          .from('exercises')
          .update(exerciseData)
          .eq('id', editingExercise.id);

        if (error) throw error;
        setEditingExercise(null);
      } else {
        const { error } = await supabase
          .from('exercises')
          .insert([exerciseData]);

        if (error) throw error;
      }
      await loadExercises();
      setShowFormModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exercise');
    }
  };

  const handleEdit = (exercise: Exercise) => {
    setEditingExercise(exercise);
    setShowFormModal(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('exercises')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await loadExercises();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
    }
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
          <AthleteSelector
            athletes={athletes}
            selectedAthlete={selectedAthlete}
            onSelectAthlete={setSelectedAthlete}
          />
        </header>

        <main className="flex-1 overflow-y-auto">
          {error && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {currentPage === 'coach_dashboard' ? (
            <CoachDashboard key="coach_dashboard" />
          ) : currentPage === 'athletes' ? (
            <Athletes key="athletes" />
          ) : currentPage === 'library' ? (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="mb-6 flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditingExercise(null);
                    setShowFormModal(true);
                  }}
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
            <MacroCycles key="macrocycles" selectedAthlete={selectedAthlete} onAthleteChange={setSelectedAthlete} />
          ) : currentPage === 'events' ? (
            <Events key="events" />
          ) : currentPage === 'training_groups' ? (
            <TrainingGroups key="training_groups" />
          ) : (
            <WeeklyPlanner key={`planner-${currentPage}`} selectedAthlete={selectedAthlete} onAthleteChange={setSelectedAthlete} />
          )}

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
