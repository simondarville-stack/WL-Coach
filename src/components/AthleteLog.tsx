import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Check, CreditCard as Edit3, Save, X, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Athlete,
  WeekPlan,
  PlannedExerciseWithExercise,
  TrainingLogSession,
  TrainingLogExerciseWithExercise,
  Exercise,
  GeneralSettings as GeneralSettingsType,
} from '../lib/database.types';
import { formatDateToDDMMYYYY, getMondayOfWeek } from '../lib/dateUtils';
import { RAWScoring } from './RAWScoring';
import { PrescriptionDisplay } from './PrescriptionDisplay';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function AthleteLog() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAthleteDropdown, setShowAthleteDropdown] = useState(false);

  const [weekStart, setWeekStart] = useState<Date>(getMondayOfWeek(new Date()));
  const [selectedDayIndex, setSelectedDayIndex] = useState(1);

  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExerciseWithExercise[]>([]);

  const [session, setSession] = useState<TrainingLogSession | null>(null);
  const [loggedExercises, setLoggedExercises] = useState<TrainingLogExerciseWithExercise[]>([]);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [settings, setSettings] = useState<GeneralSettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingExercise, setEditingExercise] = useState<{
    plannedExercise: PlannedExerciseWithExercise;
    loggedExercise: TrainingLogExerciseWithExercise | null;
  } | null>(null);
  const [showSessionNotesModal, setShowSessionNotesModal] = useState(false);
  const [prUpdatePrompt, setPrUpdatePrompt] = useState<{
    exerciseId: string;
    exerciseName: string;
    newValue: number;
    currentPR: number | null;
  } | null>(null);

  useEffect(() => {
    loadAthletes();
    loadExercises();
    loadSettings();
  }, []);

  useEffect(() => {
    if (selectedAthlete) {
      loadWeekData();
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

  async function loadSettings() {
    const { data } = await supabase
      .from('general_settings')
      .select('*')
      .maybeSingle();
    setSettings(data);
  }

  async function loadAthletes() {
    const { data } = await supabase
      .from('athletes')
      .select('*')
      .eq('is_active', true)
      .order('name');
    setAthletes(data || []);
  }

  async function loadExercises() {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .order('name');
    setExercises(data || []);
  }

  async function loadWeekData() {
    if (!selectedAthlete) return;

    const weekStartISO = weekStart.toISOString().split('T')[0];

    const { data: weekData } = await supabase
      .from('week_plans')
      .select('*')
      .eq('athlete_id', selectedAthlete.id)
      .eq('week_start', weekStartISO)
      .maybeSingle();

    setWeekPlan(weekData);

    if (weekData) {
      const { data: plannedData } = await supabase
        .from('planned_exercises')
        .select('*, exercise:exercises(*)')
        .eq('weekplan_id', weekData.id)
        .eq('day_index', selectedDayIndex)
        .order('position');

      setPlannedExercises(plannedData || []);
    } else {
      setPlannedExercises([]);
    }

    const selectedDate = new Date(weekStart);
    selectedDate.setDate(selectedDate.getDate() + selectedDayIndex - 1);
    const dateISO = selectedDate.toISOString().split('T')[0];

    const { data: sessionData } = await supabase
      .from('training_log_sessions')
      .select('*')
      .eq('athlete_id', selectedAthlete.id)
      .eq('date', dateISO)
      .maybeSingle();

    if (sessionData) {
      setSession(sessionData);

      const { data: logData } = await supabase
        .from('training_log_exercises')
        .select('*, exercise:exercises(*)')
        .eq('session_id', sessionData.id)
        .order('position');

      setLoggedExercises(logData || []);
    } else {
      const weekStartISO = weekStart.toISOString().split('T')[0];
      setSession({
        id: '',
        athlete_id: selectedAthlete.id,
        date: dateISO,
        week_start: weekStartISO,
        day_index: selectedDayIndex,
        session_notes: '',
        status: 'planned',
        raw_sleep: null,
        raw_physical: null,
        raw_mood: null,
        raw_nutrition: null,
        raw_total: null,
        raw_guidance: null,
        created_at: '',
        updated_at: '',
      });
      setLoggedExercises([]);
    }
  }

  async function saveSession(sessionToSave?: TrainingLogSession) {
    const currentSession = sessionToSave || session;
    if (!currentSession || !selectedAthlete) return;

    try {
      setSaving(true);

      const hasRawScores = currentSession.raw_sleep || currentSession.raw_physical ||
                           currentSession.raw_mood || currentSession.raw_nutrition;
      const rawTotal = hasRawScores
        ? (currentSession.raw_sleep || 0) + (currentSession.raw_physical || 0) +
          (currentSession.raw_mood || 0) + (currentSession.raw_nutrition || 0)
        : null;

      let rawGuidance = null;
      if (rawTotal !== null) {
        if (rawTotal >= 4 && rawTotal <= 6) {
          rawGuidance = "Reduce total volume by 25-30%:\n• Reduce session RPE by 2\n• Reduce sets by 1-2 per lift\n• Reduce reps by 2-4 per lift\n• Reduce session length by 25-30%\n• Increase rest by ~30 sec depending on session goal";
        } else if (rawTotal >= 7 && rawTotal <= 9) {
          rawGuidance = "Reduce total volume by 15-20%:\n• Reduce session RPE by 1\n• Reduce sets by 1 per lift\n• Reduce reps by 1-2 per lift\n• Reduce session length by 15-20%\n• Increase rest by ~30 sec depending on session goal";
        } else if (rawTotal >= 10 && rawTotal <= 12) {
          rawGuidance = "Good to train as hard as you desire within your ability level.";
        }
      }

      let sessionId = currentSession.id;

      if (currentSession.id) {
        const { error } = await supabase
          .from('training_log_sessions')
          .update({
            session_notes: currentSession.session_notes,
            status: currentSession.status,
            raw_sleep: currentSession.raw_sleep,
            raw_physical: currentSession.raw_physical,
            raw_mood: currentSession.raw_mood,
            raw_nutrition: currentSession.raw_nutrition,
            raw_total: rawTotal,
            raw_guidance: rawGuidance,
          })
          .eq('id', currentSession.id);

        if (error) throw error;
      } else {
        const { data: newSession, error } = await supabase
          .from('training_log_sessions')
          .insert({
            athlete_id: selectedAthlete.id,
            date: currentSession.date,
            week_start: currentSession.week_start,
            day_index: currentSession.day_index,
            session_notes: currentSession.session_notes,
            status: currentSession.status,
            raw_sleep: currentSession.raw_sleep,
            raw_physical: currentSession.raw_physical,
            raw_mood: currentSession.raw_mood,
            raw_nutrition: currentSession.raw_nutrition,
            raw_total: rawTotal,
            raw_guidance: rawGuidance,
          })
          .select()
          .single();

        if (error) throw error;
        setSession(newSession);
        sessionId = newSession.id;
      }

      const existingIds = new Set(loggedExercises.filter(e => e.id).map(e => e.id));
      const { data: currentLogged } = await supabase
        .from('training_log_exercises')
        .select('id')
        .eq('session_id', sessionId);

      const toDelete = (currentLogged || []).filter(e => !existingIds.has(e.id));
      for (const ex of toDelete) {
        await supabase.from('training_log_exercises').delete().eq('id', ex.id);
      }

      for (const logEx of loggedExercises) {
        if (logEx.id) {
          await supabase
            .from('training_log_exercises')
            .update({
              performed_raw: logEx.performed_raw,
              performed_notes: logEx.performed_notes,
              position: logEx.position,
            })
            .eq('id', logEx.id);
        } else {
          await supabase
            .from('training_log_exercises')
            .insert({
              session_id: sessionId,
              exercise_id: logEx.exercise_id,
              planned_exercise_id: logEx.planned_exercise_id,
              performed_raw: logEx.performed_raw,
              performed_notes: logEx.performed_notes,
              position: logEx.position,
            });
        }
      }

      await loadWeekData();
    } catch (error) {
      console.error('Error saving session:', error);
    } finally {
      setSaving(false);
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

    try {
      setSaving(true);
      const sessionId = session?.id || '';

      for (const logEx of updatedExercises) {
        if (logEx.id) {
          await supabase
            .from('training_log_exercises')
            .update({
              performed_raw: logEx.performed_raw,
              performed_notes: logEx.performed_notes,
              position: logEx.position,
            })
            .eq('id', logEx.id);
        } else {
          await supabase
            .from('training_log_exercises')
            .insert({
              session_id: sessionId,
              exercise_id: logEx.exercise_id,
              planned_exercise_id: logEx.planned_exercise_id,
              performed_raw: logEx.performed_raw,
              performed_notes: logEx.performed_notes,
              position: logEx.position,
            });
        }
      }

      await loadWeekData();

      if (selectedAthlete && pe.exercise.default_unit === 'absolute_kg') {
        await checkForPRUpdate(pe.exercise.id, pe.exercise.name, performedRaw);
      }
    } catch (error) {
      console.error('Error saving exercise:', error);
    } finally {
      setSaving(false);
    }
  }

  async function checkForPRUpdate(exerciseId: string, exerciseName: string, performedRaw: string) {
    if (!selectedAthlete) return;

    const maxLoad = extractMaxLoad(performedRaw);
    if (maxLoad === null) return;

    const { data: pr } = await supabase
      .from('athlete_prs')
      .select('*')
      .eq('athlete_id', selectedAthlete.id)
      .eq('exercise_id', exerciseId)
      .maybeSingle();

    const currentPR = pr?.pr_value_kg || null;

    if (currentPR === null || maxLoad > currentPR) {
      setPrUpdatePrompt({
        exerciseId,
        exerciseName,
        newValue: maxLoad,
        currentPR,
      });
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
      const { data: existingPR } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('athlete_id', selectedAthlete.id)
        .eq('exercise_id', prUpdatePrompt.exerciseId)
        .maybeSingle();

      if (existingPR) {
        await supabase
          .from('athlete_prs')
          .update({
            pr_value_kg: prUpdatePrompt.newValue,
            pr_date: selectedDate.toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPR.id);
      } else {
        await supabase
          .from('athlete_prs')
          .insert({
            athlete_id: selectedAthlete.id,
            exercise_id: prUpdatePrompt.exerciseId,
            pr_value_kg: prUpdatePrompt.newValue,
            pr_date: selectedDate.toISOString().split('T')[0],
            notes: null,
          });
      }

      setPrUpdatePrompt(null);
    } catch (error) {
      console.error('Error updating PR:', error);
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
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Athlete Training Log</h1>

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
              <h2 className="text-lg font-semibold text-gray-900">
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
                          <div className="font-semibold text-gray-900">{pe.exercise.name}</div>
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
            <h3 className="text-lg font-bold text-gray-900 mb-4">New Personal Record!</h3>
            <div className="mb-6">
              <p className="text-sm text-gray-700 mb-2">
                You've logged <span className="font-semibold">{prUpdatePrompt.newValue} kg</span> for{' '}
                <span className="font-semibold">{prUpdatePrompt.exerciseName}</span>.
              </p>
              {prUpdatePrompt.currentPR !== null ? (
                <p className="text-sm text-gray-600">
                  Your current PR is <span className="font-semibold">{prUpdatePrompt.currentPR} kg</span>.
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
            <h2 className="text-xl font-bold text-gray-900">Edit Exercise</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="mb-4">
            <div className="text-lg font-semibold text-gray-900 mb-2">
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
            <h2 className="text-xl font-bold text-gray-900">Session Notes</h2>
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
