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
import { Dumbbell, Calendar, Plus, Users, Settings as SettingsIcon, X, TrendingUp, BookOpen, Eye, ClipboardList, BarChart3, CalendarDays, UsersRound, ChevronDown } from 'lucide-react';

type Page = 'athletes' | 'library' | 'planner' | 'macrocycles' | 'athlete_programme' | 'athlete_log' | 'general_settings' | 'coach_dashboard' | 'events' | 'training_groups';

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
  const [showPlanningMenu, setShowPlanningMenu] = useState(false);
  const [showAthleteMenu, setShowAthleteMenu] = useState(false);
  const [plannerWeekStart, setPlannerWeekStart] = useState<string | null>(null);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Dumbbell className="text-blue-600" size={32} />
              <h1 className="text-3xl font-bold text-gray-900">WinWota 2.0</h1>
            </div>
            <div className="flex items-center gap-4">
              <nav className="flex gap-2">
              <button
                onClick={() => setCurrentPage('coach_dashboard')}
                className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 ${
                  currentPage === 'coach_dashboard'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                <BarChart3 size={18} />
                Dashboard
              </button>

              <div className="relative">
                <button
                  onClick={() => { setShowPlanningMenu(!showPlanningMenu); setShowAthleteMenu(false); }}
                  className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 ${
                    ['planner', 'macrocycles', 'events', 'training_groups'].includes(currentPage)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  <Calendar size={18} />
                  Planning
                  <ChevronDown size={16} />
                </button>
                {showPlanningMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-md shadow-lg border border-gray-200 py-1 min-w-[180px] z-50">
                    <button
                      onClick={() => { setCurrentPage('planner'); setShowPlanningMenu(false); setPlannerWeekStart(null); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <Calendar size={16} />
                      Weekly Planner
                    </button>
                    <button
                      onClick={() => { setCurrentPage('macrocycles'); setShowPlanningMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <TrendingUp size={16} />
                      Macro Cycles
                    </button>
                    <button
                      onClick={() => { setCurrentPage('events'); setShowPlanningMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <CalendarDays size={16} />
                      Events
                    </button>
                    <button
                      onClick={() => { setCurrentPage('training_groups'); setShowPlanningMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <UsersRound size={16} />
                      Training Groups
                    </button>
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => { setShowAthleteMenu(!showAthleteMenu); setShowPlanningMenu(false); }}
                  className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 ${
                    ['athlete_programme', 'athlete_log'].includes(currentPage)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  <Eye size={18} />
                  Athlete View
                  <ChevronDown size={16} />
                </button>
                {showAthleteMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-md shadow-lg border border-gray-200 py-1 min-w-[180px] z-50">
                    <button
                      onClick={() => { setCurrentPage('athlete_programme'); setShowAthleteMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <Eye size={16} />
                      My Programme
                    </button>
                    <button
                      onClick={() => { setCurrentPage('athlete_log'); setShowAthleteMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <ClipboardList size={16} />
                      Training Log
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => setCurrentPage('athletes')}
                className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 ${
                  currentPage === 'athletes'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                <Users size={18} />
                Athletes
              </button>

              <button
                onClick={() => setCurrentPage('library')}
                className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 ${
                  currentPage === 'library'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                <BookOpen size={18} />
                Library
              </button>

              <button
                onClick={() => setCurrentPage('general_settings')}
                className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 ${
                  currentPage === 'general_settings'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                <SettingsIcon size={18} />
                Settings
              </button>
              </nav>
              <AthleteSelector
                athletes={athletes}
                selectedAthlete={selectedAthlete}
                onSelectAthlete={setSelectedAthlete}
              />
            </div>
          </div>
        </div>
      </header>

      <main>
        {error && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {currentPage === 'coach_dashboard' ? (
          <CoachDashboard
            key="coach_dashboard"
            onNavigateToPlanner={(athlete: Athlete, weekStart: string) => {
              setSelectedAthlete(athlete);
              setPlannerWeekStart(weekStart);
              setCurrentPage('planner');
            }}
          />
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
          <WeeklyPlanner key={`planner-${selectedAthlete?.id}-${plannerWeekStart}`} selectedAthlete={selectedAthlete} onAthleteChange={setSelectedAthlete} initialWeekStart={plannerWeekStart} />
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
  );
}

export default App;
