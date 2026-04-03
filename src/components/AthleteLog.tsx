import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, CreditCard as Edit3, Save, X, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Athlete,
  PlannedExerciseWithExercise,
  TrainingLogSession,
  TrainingLogExerciseWithExercise,
} from '../lib/database.types';
import { formatDateToDDMMYYYY, getMondayOfWeek } from '../lib/dateUtils';
import { RAWScoring } from './RAWScoring';
import { PrescriptionDisplay } from './PrescriptionDisplay';
import { useTrainingLog } from '../hooks/useTrainingLog';
import { useAthletes } from '../hooks/useAthletes';
import { useExercises } from '../hooks/useExercises';
import { useSettings } from '../hooks/useSettings';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function AthleteLog() {
  const {
    athletes,
    fetchActiveAthletes,
    fetchPRs,
    upsertPR,
  } = useAthletes();

  const {
    exercises,
    fetchExercisesByName,
  } = useExercises();

  const {
    settings,
    fetchSettingsSilent,
  } = useSettings();

  const {
    weekPlan,
    plannedExercises,
    session,
    setSession,
    loggedExercises,
    setLoggedExercises,
    saving,
    fetchWeekData,
    saveSession: hookSaveSession,
  } = useTrainingLog();

  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAthleteDropdown, setShowAthleteDropdown] = useState(false);

  const [weekStart, setWeekStart] = useState<Date>(getMondayOfWeek(new Date()));
  const [selectedDayIndex, setSelectedDayIndex] = useState(1);

  const [editingExercise, setEditingExercise] = useState<{
    plannedExercise: PlannedExerciseWithExercise;
    loggedExercise: TrainingLogExerciseWithExercise | null;
  } | null>(null);
  const [showSessionNotesModal, setShowSessionNotesModal] = useState(false);
  const [todayBodyweight, setTodayBodyweight] = useState('');
  const [prUpdatePrompt, setPrUpdatePrompt] = useState<{
    exerciseId: string;
    exerciseName: string;
    newValue: number;
    currentPR: number | null;
  } | null>(null);

  useEffect(() => {
    fetchActiveAthletes();
    fetchExercisesByName();
    fetchSettingsSilent();
  }, []);

  useEffect(() => {
    if (selectedAthlete) {
      fetchWeekData(selectedAthlete.id, weekStart, selectedDayIndex);
    }
  }, [selectedAthlete, weekStart, selectedDayIndex]);

  useEffect(() => {
    if (weekPlan) {
      const activeDays = weekPlan.active_days || [1, 2, 3, 4, 5, 6, 7];
      if (!activeDays.includes(selectedDayIndex)) {
        const displayOrder = weekPlan.day_display_order || activeDays;
        const firstActiveDay = displayOrder.find(idx => activeDays.includes(idx)) || activeDays[0];
        setSelectedDayIndex(firstActiveDay);
      }
    }
  }, [weekPlan]);

  const selectedDateISO = (() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + selectedDayIndex - 1);
    return d.toISOString().split('T')[0];
  })();

  useEffect(() => {
    if (!selectedAthlete?.track_bodyweight) { setTodayBodyweight(''); return; }
    supabase
      .from('bodyweight_entries')
      .select('weight_kg')
      .eq('athlete_id', selectedAthlete.id)
      .eq('date', selectedDateISO)
      .maybeSingle()
      .then(({ data }) => {
        setTodayBodyweight(data ? String(data.weight_kg) : '');
      });
  }, [selectedAthlete, selectedDateISO]);

  const saveBodyweight = useCallback(async () => {
    if (!selectedAthlete || !todayBodyweight) return;
    const val = parseFloat(todayBodyweight);
    if (isNaN(val)) return;
    await supabase.from('bodyweight_entries').upsert(
      { athlete_id: selectedAthlete.id, date: selectedDateISO, weight_kg: val },
      { onConflict: 'athlete_id,date' }
    );
  }, [selectedAthlete, selectedDateISO, todayBodyweight]);

  async function saveSession(sessionToSave?: TrainingLogSession) {
    const currentSession = sessionToSave || session;
    if (!currentSession || !selectedAthlete) return;
    try {
      await hookSaveSession(currentSession, selectedAthlete.id, loggedExercises);
      await fetchWeekData(selectedAthlete.id, weekStart, selectedDayIndex);
    } catch (error) {
    }
  }

  async function logAllAsPlanned() {
    if (!session?.id && session) {
      await saveSession();
    }

    const newLogs: TrainingLogExerciseWithExercise[] = plannedExercises.map((pe, index) => ({
      id: '',
      session_id: session?.id || '',
      exercise_id: pe.exercise.id,
      planned_exercise_id: pe.id,
      performed_raw: pe.prescription_raw || '',
      performed_notes: '',
      position: index,
      exercise: pe.exercise,
      created_at: '',
      updated_at: '',
    }));

    setLoggedExercises(newLogs);
    await saveSession();
  }

  async function logExerciseAsPlanned(pe: PlannedExerciseWithExercise) {
    const existingLog = loggedExercises.find(le => le.planned_exercise_id === pe.id);
    if (existingLog) return;

    if (!session?.id && session) {
      await saveSession();
    }

    const newLog: TrainingLogExerciseWithExercise = {
      id: '',
      session_id: session?.id || '',
      exercise_id: pe.exercise.id,
      planned_exercise_id: pe.id,
      performed_raw: pe.prescription_raw || '',
      performed_notes: '',
      position: loggedExercises.length,
      exercise: pe.exercise,
      created_at: '',
      updated_at: '',
    };

    setLoggedExercises([...loggedExercises, newLog]);
    await saveSession();
  }

  function openExerciseEditModal(pe: PlannedExerciseWithExercise) {
    const existingLog = loggedExercises.find(le => le.planned_exercise_id === pe.id);
    setEditingExercise({
      plannedExercise: pe,
      loggedExercise: existingLog || null,
    });
  }

  async function saveExerciseEdit(performedRaw: string, performedNotes: string) {
    if (!editingExercise) return;

    if (!session?.id && session) {
      await saveSession();
    }

    const pe = editingExercise.plannedExercise;
    const existingLog = loggedExercises.find(le => le.planned_exercise_id === pe.id);

    let updatedExercises: TrainingLogExerciseWithExercise[];

    if (existingLog) {
      updatedExercises = loggedExercises.map(le =>
        le.planned_exercise_id === pe.id
          ? { ...le, performed_raw: performedRaw, performed_notes: performedNotes }
          : le
      );
    } else {
      const newLog: TrainingLogExerciseWithExercise = {
        id: '',
        session_id: session?.id || '',
        exercise_id: pe.exercise.id,
        planned_exercise_id: pe.id,
        performed_raw: performedRaw,
        performed_notes: performedNotes,
        position: loggedExercises.length,
        exercise: pe.exercise,
        created_at: '',
        updated_at: '',
      };
      updatedExercises = [...loggedExercises, newLog];
    }

    setLoggedExercises(updatedExercises);
    setEditingExercise(null);

    if (!session || !selectedAthlete) return;
    try {
      await hookSaveSession(session, selectedAthlete.id, updatedExercises);
      await fetchWeekData(selectedAthlete.id, weekStart, selectedDayIndex);
      if (pe.exercise.default_unit === 'absolute_kg') {
        await checkForPRUpdate(pe.exercise.id, pe.exercise.name, performedRaw);
      }
    } catch (error) {
    }
  }

  async function checkForPRUpdate(exerciseId: string, exerciseName: string, performedRaw: string) {
    if (!selectedAthlete) return;

    const maxLoad = extractMaxLoad(performedRaw);
    if (maxLoad === null) return;

    const prs = await fetchPRs(selectedAthlete.id);
    const pr = prs.find(p => p.exercise_id === exerciseId);
    const currentPR = pr?.pr_value_kg || null;

    if (currentPR === null || maxLoad > currentPR) {
      setPrUpdatePrompt({ exerciseId, exerciseName, newValue: maxLoad, currentPR });
    }
  }

  function extractMaxLoad(performedRaw: string): number | null {
    const segments = performedRaw.split(',').map(s => s.trim());
    let maxLoad = 0;

    for (const segment of segments) {
      const parts = segment.split('x').map(p => p.trim());
      if (parts.length > 0) {
        const load = parseFloat(parts[0]);
        if (!isNaN(load) && load > maxLoad) {
          maxLoad = load;
        }
      }
    }

    return maxLoad > 0 ? maxLoad : null;
  }

  async function updatePR() {
    if (!prUpdatePrompt || !selectedAthlete) return;
    try {
      const prs = await fetchPRs(selectedAthlete.id);
      const existingPR = prs.find(p => p.exercise_id === prUpdatePrompt.exerciseId);
      await upsertPR(
        selectedAthlete.id,
        prUpdatePrompt.exerciseId,
        prUpdatePrompt.newValue,
        selectedDate.toISOString().split('T')[0],
        existingPR?.id,
      );
      setPrUpdatePrompt(null);
    } catch (error) {
    }
  }

  async function saveSessionNotes() {
    await saveSession();
    setShowSessionNotesModal(false);
  }

  const changeWeek = (delta: number) => {
    const newWeek = new Date(weekStart);
    newWeek.setDate(newWeek.getDate() + delta * 7);
    setWeekStart(newWeek);
  };

  const filteredAthletes = athletes.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeDayIndices = weekPlan?.active_days || [1, 2, 3, 4, 5, 6, 7];
  const displayOrder = weekPlan?.day_display_order || activeDayIndices;
  const customDayLabels = weekPlan?.day_labels || {};

  const getDayName = (dayIdx: number) => {
    return customDayLabels[dayIdx] || DAYS[dayIdx - 1];
  };

  const availableDays = displayOrder
    .filter(dayIdx => activeDayIndices.includes(dayIdx))
    .map(dayIdx => ({
      index: dayIdx,
      name: getDayName(dayIdx)
    }));

  const selectedDate = new Date(weekStart);
  selectedDate.setDate(selectedDate.getDate() + selectedDayIndex - 1);

  const isExerciseLogged = (plannedExerciseId: string) => {
    return loggedExercises.some(le => le.planned_exercise_id === plannedExerciseId);
  };

  const hasChanges = (plannedExerciseId: string, plannedRaw: string | null) => {
    const logged = loggedExercises.find(le => le.planned_exercise_id === plannedExerciseId);
    if (!logged) return false;
    return logged.performed_raw !== (plannedRaw || '');
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-6 text-gray-900">Athlete Training Log</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Athlete
            </label>
            <input
              type="text"
              value={selectedAthlete?.name || searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setShowAthleteDropdown(true);
              }}
              onFocus={() => setShowAthleteDropdown(true)}
              placeholder="Search athlete..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {showAthleteDropdown && filteredAthletes.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredAthletes.map((athlete) => (
                  <button
                    key={athlete.id}
                    onClick={() => {
                      setSelectedAthlete(athlete);
                      setSearchTerm('');
                      setShowAthleteDropdown(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-blue-50"
                  >
                    {athlete.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Week
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => changeWeek(-1)}
                className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 text-center font-medium">
                {formatDateToDDMMYYYY(weekStart.toISOString())}
              </div>
              <button
                onClick={() => changeWeek(1)}
                className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Day
            </label>
            <select
              value={selectedDayIndex}
              onChange={(e) => setSelectedDayIndex(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {availableDays.map((day) => (
                <option key={day.index} value={day.index}>
                  {day.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selectedAthlete && (
        <>
          {selectedAthlete.track_bodyweight && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border border-gray-200 rounded-lg mb-3 text-sm">
              <span className="text-xs text-gray-500 font-medium">Bodyweight</span>
              <input
                type="number"
                step={0.1}
                value={todayBodyweight}
                onChange={e => setTodayBodyweight(e.target.value)}
                onBlur={saveBodyweight}
                placeholder="—"
                className="w-20 px-2 py-0.5 text-xs border border-gray-200 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-400">kg</span>
            </div>
          )}

          {settings?.raw_enabled && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <RAWScoring
                sleep={session?.raw_sleep || null}
                physical={session?.raw_physical || null}
                mood={session?.raw_mood || null}
                nutrition={session?.raw_nutrition || null}
                onChange={(field, value) => {
                  if (session) {
                    const updatedSession = { ...session, [`raw_${field}`]: value };
                    setSession(updatedSession);
                    saveSession(updatedSession);
                  }
                }}
              />
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900">
                {getDayName(selectedDayIndex)} - {formatDateToDDMMYYYY(selectedDate.toISOString())}
              </h2>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSessionNotesModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  <FileText className="w-5 h-5" />
                  Session Notes
                </button>
                {plannedExercises.length > 0 && (
                  <button
                    onClick={logAllAsPlanned}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <Check className="w-5 h-5" />
                    Log All as Planned
                  </button>
                )}
              </div>
            </div>

            {plannedExercises.length === 0 ? (
              <p className="text-gray-500 italic">No planned exercises for this day</p>
            ) : (
              <div className="space-y-3">
                {plannedExercises.map((pe) => {
                  const isLogged = isExerciseLogged(pe.id);
                  const hasChange = hasChanges(pe.id, pe.prescription_raw);
                  const loggedEx = loggedExercises.find(le => le.planned_exercise_id === pe.id);

                  return (
                    <div
                      key={pe.id}
                      className={`flex items-start justify-between p-4 rounded-lg border-2 ${
                        hasChange
                          ? 'bg-yellow-50 border-yellow-400'
                          : isLogged
                          ? 'bg-green-50 border-green-300'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="font-medium text-gray-900">{pe.exercise.name}</div>
                          {hasChange && (
                            <span className="text-xs px-2 py-1 bg-yellow-600 text-white rounded-full font-medium">
                              Modified
                            </span>
                          )}
                          {isLogged && !hasChange && (
                            <span className="text-xs px-2 py-1 bg-green-600 text-white rounded-full font-medium">
                              Logged
                            </span>
                          )}
                        </div>
                        <div className="mb-1">
                          <span className="text-sm text-gray-600 font-medium">Planned: </span>
                          <PrescriptionDisplay
                            prescription={pe.prescription_raw}
                            unit={pe.unit}
                            useStackedNotation={pe.exercise.use_stacked_notation}
                          />
                        </div>
                        {isLogged && loggedEx && (
                          <div className="mb-1">
                            <span className="text-sm text-gray-600 font-medium">Performed: </span>
                            <PrescriptionDisplay
                              prescription={loggedEx.performed_raw}
                              unit={pe.unit}
                              useStackedNotation={pe.exercise.use_stacked_notation}
                            />
                          </div>
                        )}
                        {loggedEx?.performed_notes && (
                          <div className="text-sm text-gray-600 mt-1 italic">
                            Note: {loggedEx.performed_notes}
                          </div>
                        )}
                        {pe.notes && (
                          <div className="text-sm text-gray-500 mt-1">{pe.notes}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        {!isLogged && (
                          <button
                            onClick={() => logExerciseAsPlanned(pe)}
                            disabled={saving}
                            className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                            title="Log as planned"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={() => openExerciseEditModal(pe)}
                          className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                          title="Edit exercise"
                        >
                          <Edit3 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {editingExercise && (
        <ExerciseEditModal
          plannedExercise={editingExercise.plannedExercise}
          loggedExercise={editingExercise.loggedExercise}
          onSave={saveExerciseEdit}
          onClose={() => setEditingExercise(null)}
          saving={saving}
        />
      )}

      {showSessionNotesModal && (
        <SessionNotesModal
          session={session}
          onSessionChange={setSession}
          onSave={saveSessionNotes}
          onClose={() => setShowSessionNotesModal(false)}
          saving={saving}
        />
      )}

      {prUpdatePrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-4">New Personal Record!</h3>
            <div className="mb-6">
              <p className="text-sm text-gray-700 mb-2">
                You've logged <span className="font-medium">{prUpdatePrompt.newValue} kg</span> for{' '}
                <span className="font-medium">{prUpdatePrompt.exerciseName}</span>.
              </p>
              {prUpdatePrompt.currentPR !== null ? (
                <p className="text-sm text-gray-600">
                  Your current PR is <span className="font-medium">{prUpdatePrompt.currentPR} kg</span>.
                  Would you like to update it?
                </p>
              ) : (
                <p className="text-sm text-gray-600">
                  You don't have a PR recorded for this exercise yet. Would you like to set this as your PR?
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPrUpdatePrompt(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
              >
                No, thanks
              </button>
              <button
                onClick={updatePR}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
              >
                Update PR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ExerciseEditModalProps {
  plannedExercise: PlannedExerciseWithExercise;
  loggedExercise: TrainingLogExerciseWithExercise | null;
  onSave: (performedRaw: string, performedNotes: string) => void;
  onClose: () => void;
  saving: boolean;
}

function ExerciseEditModal({ plannedExercise, loggedExercise, onSave, onClose, saving }: ExerciseEditModalProps) {
  const [performedRaw, setPerformedRaw] = useState(
    loggedExercise?.performed_raw || plannedExercise.prescription_raw || ''
  );
  const [performedNotes, setPerformedNotes] = useState(
    loggedExercise?.performed_notes || ''
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-medium text-gray-900">Edit Exercise</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-4">
            <div className="text-lg font-medium text-gray-900 mb-2">
              {plannedExercise.exercise.name}
            </div>
            <div className="text-sm text-gray-600 mb-1">
              <span className="font-medium">Planned: </span>
              <PrescriptionDisplay
                prescription={plannedExercise.prescription_raw}
                unit={plannedExercise.unit}
                useStackedNotation={plannedExercise.exercise.use_stacked_notation}
              />
            </div>
            {plannedExercise.notes && (
              <div className="text-sm text-gray-500 italic">{plannedExercise.notes}</div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Performed (e.g., 100x5x3)
              </label>
              <input
                type="text"
                value={performedRaw}
                onChange={(e) => setPerformedRaw(e.target.value)}
                placeholder="Enter what was performed"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes
              </label>
              <textarea
                value={performedNotes}
                onChange={(e) => setPerformedNotes(e.target.value)}
                rows={3}
                placeholder="Add any notes about this exercise..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => onSave(performedRaw, performedNotes)}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SessionNotesModalProps {
  session: TrainingLogSession | null;
  onSessionChange: (session: TrainingLogSession) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

function SessionNotesModal({ session, onSessionChange, onSave, onClose, saving }: SessionNotesModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-medium text-gray-900">Session Notes</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                value={session?.status || 'planned'}
                onChange={(e) => session && onSessionChange({ ...session, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="skipped">Skipped</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes
              </label>
              <textarea
                value={session?.session_notes || ''}
                onChange={(e) => session && onSessionChange({ ...session, session_notes: e.target.value })}
                rows={6}
                placeholder="Add notes about this training session..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
