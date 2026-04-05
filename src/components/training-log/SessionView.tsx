import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Check, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { RestTimer } from './RestTimer';
import type { Athlete, PlannedExerciseWithExercise, TrainingLogExerciseWithExercise, TrainingLogSet } from '../../lib/database.types';
import { useTrainingLog } from '../../hooks/useTrainingLog';
import { RAWScoring } from '../RAWScoring';
import { PrescriptionDisplay } from '../PrescriptionDisplay';
import { supabase } from '../../lib/supabase';

interface SessionViewProps {
  athlete: Athlete;
  weekStart: string; // ISO date of Monday e.g. "2026-03-31"
  dayIndex: number;  // 1–7 matching the week plan's day_index
  onBack: () => void;
}

type SessionPhase = 'pre-session' | 'active' | 'post-session';

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getDefaultRestSeconds(exerciseName: string): number {
  const lower = exerciseName.toLowerCase();
  if (lower.includes('snatch') || lower.includes('clean') || lower.includes('jerk')) return 180;
  if (lower.includes('squat') || lower.includes('deadlift') || lower.includes('pull')) return 120;
  return 90;
}

interface SetRowProps {
  set: TrainingLogSet;
  index: number;
  onComplete: (setId: string, load: number | null, reps: number | null, rpe: number | null) => void;
  onSkip: (setId: string) => void;
  prSetId?: string;
}

function SetRow({ set, index, onComplete, onSkip, prSetId }: SetRowProps) {
  const [load, setLoad] = useState<string>(set.performed_load != null ? String(set.performed_load) : set.planned_load != null ? String(set.planned_load) : '');
  const [reps, setReps] = useState<string>(set.performed_reps != null ? String(set.performed_reps) : set.planned_reps != null ? String(set.planned_reps) : '');
  const [rpe, setRpe] = useState<string>(set.rpe != null ? String(set.rpe) : '');

  const isCompleted = set.status === 'completed';
  const isSkipped = set.status === 'skipped';
  const isPR = prSetId === set.id;

  return (
    <tr
      className={`text-sm transition-all duration-300 ${
        isPR ? 'ring-2 ring-yellow-400' :
        isCompleted ? 'bg-green-50' :
        isSkipped ? 'bg-gray-50 opacity-60' : 'bg-white'
      }`}
    >
      <td className="px-3 py-2 text-gray-500 text-xs w-8">{index + 1}</td>
      <td className="px-3 py-2 text-gray-500 text-xs">
        {set.planned_load != null || set.planned_reps != null
          ? `${set.planned_load ?? '—'}kg × ${set.planned_reps ?? '—'}`
          : '—'}
      </td>
      <td className="px-3 py-2">
        {isCompleted || isSkipped ? (
          <span className="text-gray-700 text-sm">
            {isSkipped ? 'Skipped' : `${set.performed_load ?? '—'}kg × ${set.performed_reps ?? '—'}`}
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={load}
              onChange={e => setLoad(e.target.value)}
              placeholder="kg"
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:ring-1 focus:ring-blue-400 focus:outline-none"
              min="0"
            />
            <span className="text-gray-400 text-xs">×</span>
            <input
              type="number"
              value={reps}
              onChange={e => setReps(e.target.value)}
              placeholder="reps"
              className="w-14 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:ring-1 focus:ring-blue-400 focus:outline-none"
              min="0"
            />
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {isCompleted ? (
          <span className="text-gray-500 text-sm">{set.rpe ?? '—'}</span>
        ) : isSkipped ? null : (
          <input
            type="number"
            value={rpe}
            onChange={e => setRpe(e.target.value)}
            placeholder="RPE"
            className="w-14 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:ring-1 focus:ring-blue-400 focus:outline-none"
            min="1"
            max="10"
          />
        )}
      </td>
      <td className="px-3 py-2 w-20">
        {isCompleted ? (
          <div className="flex items-center gap-1">
            <Check className="w-4 h-4 text-green-600" />
            {isPR && <span className="text-xs text-yellow-600">PR</span>}
          </div>
        ) : isSkipped ? (
          <X className="w-4 h-4 text-gray-400" />
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const l = load !== '' ? parseFloat(load) : null;
                const r = reps !== '' ? parseInt(reps, 10) : null;
                const rpeVal = rpe !== '' ? parseFloat(rpe) : null;
                onComplete(set.id, l, r, rpeVal);
              }}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center bg-green-600 text-white rounded-lg hover:bg-green-700"
              title="Complete set"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => onSkip(set.id)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50"
              title="Skip set"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function SessionView({ athlete, weekStart, dayIndex, onBack }: SessionViewProps) {
  const {
    session, setSession,
    plannedExercises, loggedExercises, setLoggedExercises,
    saving,
    setsMap, setSetsMap,
    fetchWeekData, saveSession: hookSaveSession,
    fetchSetsForExercise, initSetsFromPlan,
    startSession, completeSession,
    startExercise, completeExercise, skipExercise,
    completeSet, skipSet, saveSet,
    checkAndRecordPR,
  } = useTrainingLog();

  const [phase, setPhase] = useState<SessionPhase>('pre-session');
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [bodyweight, setBodyweight] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [techniqueRating, setTechniqueRating] = useState<number>(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [exerciseNotes, setExerciseNotes] = useState('');
  const [sessionRpe, setSessionRpe] = useState<number>(0);
  const [sessionNotes, setSessionNotes] = useState('');
  const [prBadge, setPrBadge] = useState<{ load: number; reps: number } | null>(null);
  const [prSetId, setPrSetId] = useState<string | undefined>(undefined);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [restSeconds, setRestSeconds] = useState(120);
  const [dataLoading, setDataLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedExercises = useRef<Set<string>>(new Set());

  // Use the session's actual logged date; fall back to today for new sessions
  const displayDate = session?.date ?? (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Load data on mount
  useEffect(() => {
    const weekStartDate = new Date(weekStart + 'T00:00:00');
    setDataLoading(true);
    fetchWeekData(athlete.id, weekStartDate, dayIndex).finally(() => setDataLoading(false));
  }, [athlete.id, weekStart, dayIndex]);

  // Detect resume
  useEffect(() => {
    if (session?.status === 'in_progress') {
      setPhase('active');
    } else if (session?.status === 'completed') {
      setPhase('post-session');
    }
  }, [session?.status]);

  // Timer
  useEffect(() => {
    if (phase === 'active' && session?.started_at) {
      const start = new Date(session.started_at).getTime();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, session?.started_at]);

  // Ensure loggedExercises mirror plannedExercises when entering session
  const ensureLoggedExercises = useCallback(async (sessionId: string): Promise<TrainingLogExerciseWithExercise[]> => {
    const existing = loggedExercises.filter(e => e.session_id === sessionId);
    if (existing.length >= plannedExercises.length) return existing;

    const toCreate: TrainingLogExerciseWithExercise[] = [];
    for (let i = 0; i < plannedExercises.length; i++) {
      const pe = plannedExercises[i];
      const found = existing.find(e => e.planned_exercise_id === pe.id);
      if (!found) {
        toCreate.push({
          id: '',
          session_id: sessionId,
          exercise_id: pe.exercise.id,
          planned_exercise_id: pe.id,
          performed_raw: '',
          performed_notes: '',
          position: i,
          status: 'pending',
          technique_rating: null,
          started_at: null,
          completed_at: null,
          exercise: pe.exercise,
          created_at: '',
          updated_at: '',
        });
      }
    }

    if (toCreate.length > 0) {
      const inserts = toCreate.map(e => ({
        session_id: e.session_id,
        exercise_id: e.exercise_id,
        planned_exercise_id: e.planned_exercise_id,
        performed_raw: e.performed_raw,
        performed_notes: e.performed_notes,
        position: e.position,
        status: e.status,
      }));
      const { data } = await supabase
        .from('training_log_exercises')
        .insert(inserts)
        .select('*, exercise:exercises(*)');
      const created = data || [];
      const all = [...existing, ...created];
      setLoggedExercises(all as TrainingLogExerciseWithExercise[]);
      return all as TrainingLogExerciseWithExercise[];
    }
    return existing;
  }, [loggedExercises, plannedExercises, setLoggedExercises]);

  // Auto-init sets when exercise is first viewed
  const initExerciseSets = useCallback(async (logEx: TrainingLogExerciseWithExercise, planned: PlannedExerciseWithExercise) => {
    if (initializedExercises.current.has(logEx.id)) return;
    const existing = setsMap[logEx.id];
    if (existing && existing.length > 0) {
      initializedExercises.current.add(logEx.id);
      return;
    }
    initializedExercises.current.add(logEx.id);
    await initSetsFromPlan(logEx.id, planned.prescription_raw, planned.unit, planned.is_combo);
  }, [setsMap, initSetsFromPlan]);

  const currentPlanned = plannedExercises[currentExerciseIndex];
  const currentLogged = loggedExercises.find(e => e.planned_exercise_id === currentPlanned?.id);

  useEffect(() => {
    if (phase === 'active' && currentLogged && currentPlanned) {
      initExerciseSets(currentLogged, currentPlanned);
    }
  }, [phase, currentExerciseIndex, currentLogged?.id]);

  const handleStartSession = async () => {
    if (!session) return;
    let sessionId = session.id;

    if (!sessionId) {
      const { data, error } = await supabase
        .from('training_log_sessions')
        .insert({
          athlete_id: athlete.id,
          date: session.date,
          week_start: session.week_start,
          day_index: session.day_index,
          session_notes: '',
          status: 'planned',
          raw_sleep: session.raw_sleep,
          raw_physical: session.raw_physical,
          raw_mood: session.raw_mood,
          raw_nutrition: session.raw_nutrition,
          raw_total: session.raw_total,
          raw_guidance: session.raw_guidance,
        })
        .select()
        .single();
      if (error) return;
      setSession(data);
      sessionId = data.id;
    }

    await ensureLoggedExercises(sessionId);
    await startSession(sessionId);
    setPhase('active');
    setCurrentExerciseIndex(0);
  };

  const handleCompleteSet = async (setId: string, load: number | null, repCount: number | null, rpe: number | null) => {
    await completeSet(setId, { load, reps: repCount, rpe });

    // Show rest timer
    if (currentPlanned) {
      const secs = getDefaultRestSeconds(currentPlanned.exercise.name);
      setRestSeconds(secs);
      setShowRestTimer(true);
    }

    // PR check
    if (load && repCount && currentLogged && session) {
      const { isPR } = await checkAndRecordPR(athlete.id, currentLogged.exercise_id, load, repCount);
      if (isPR) {
        setPrBadge({ load, reps: repCount });
        setPrSetId(setId);
        setTimeout(() => {
          setPrBadge(null);
          setPrSetId(undefined);
        }, 3000);
      }
    }
  };

  const handleAddSet = async () => {
    if (!currentLogged) return;
    const existing = setsMap[currentLogged.id] || [];
    const nextNum = existing.length + 1;
    await saveSet({
      log_exercise_id: currentLogged.id,
      set_number: nextNum,
      planned_load: null,
      planned_reps: null,
      status: 'pending',
    });
  };

  const handleNextExercise = async () => {
    if (!currentLogged) return;
    if (currentLogged.status !== 'completed' && currentLogged.status !== 'skipped') {
      await completeExercise(currentLogged.id, techniqueRating || undefined);
    }
    if (currentExerciseIndex < plannedExercises.length - 1) {
      setCurrentExerciseIndex(prev => prev + 1);
      setTechniqueRating(0);
      setNotesOpen(false);
      setExerciseNotes('');
    } else {
      setPhase('post-session');
    }
  };

  const handleSkipExercise = async () => {
    if (!currentLogged) return;
    await skipExercise(currentLogged.id);
    if (currentExerciseIndex < plannedExercises.length - 1) {
      setCurrentExerciseIndex(prev => prev + 1);
    } else {
      setPhase('post-session');
    }
  };

  const handleCompleteSession = async () => {
    if (!session?.id) return;
    await completeSession(session.id, {
      rpe: sessionRpe || undefined,
      notes: sessionNotes || undefined,
      bodyweight_kg: bodyweight ? parseFloat(bodyweight) : undefined,
    });
    onBack();
  };

  const completedExercisesCount = loggedExercises.filter(e => e.status === 'completed' || e.status === 'skipped').length;
  const totalExercises = plannedExercises.length;

  const allSets = currentLogged ? (setsMap[currentLogged.id] || []) : [];
  const allSetsDone = allSets.length > 0 && allSets.every(s => s.status === 'completed' || s.status === 'skipped');

  // Compute post-session stats
  const computeStats = () => {
    let totalReps = 0;
    let totalTonnage = 0;
    let completedSets = 0;
    let plannedSets = 0;
    Object.values(setsMap).forEach(sets => {
      sets.forEach(s => {
        plannedSets++;
        if (s.status === 'completed') {
          completedSets++;
          totalReps += s.performed_reps || 0;
          totalTonnage += (s.performed_load || 0) * (s.performed_reps || 0);
        }
      });
    });
    const compliance = plannedSets > 0 ? Math.round((completedSets / plannedSets) * 100) : 0;
    return { totalReps, totalTonnage, completedSets, plannedSets, compliance };
  };

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 rounded-lg hover:bg-gray-100">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="max-w-lg mx-auto p-4 space-y-4">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-20 bg-white rounded-lg border border-gray-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ── PRE-SESSION ────────────────────────────────────────────────────────────
  if (phase === 'pre-session') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="font-medium text-gray-900">{formatDateLong(displayDate)}</div>
            <div className="text-xs text-gray-500">{athlete.name}</div>
          </div>
        </div>

        <div className="max-w-lg mx-auto p-4 pb-28 space-y-4">
          {/* RAW Scoring */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <RAWScoring
              sleep={session?.raw_sleep ?? null}
              physical={session?.raw_physical ?? null}
              mood={session?.raw_mood ?? null}
              nutrition={session?.raw_nutrition ?? null}
              onChange={(field, value) => {
                if (session) setSession({ ...session, [`raw_${field}`]: value });
              }}
            />
          </div>

          {/* Bodyweight */}
          {athlete.track_bodyweight && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Bodyweight</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.1}
                  value={bodyweight}
                  onChange={e => setBodyweight(e.target.value)}
                  placeholder="0.0"
                  className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <span className="text-gray-500 text-sm">kg</span>
              </div>
            </div>
          )}

          {/* Planned exercises */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-3">Today's Plan</h3>
            {plannedExercises.length === 0 ? (
              <p className="text-gray-500 italic text-sm">No exercises planned for today</p>
            ) : (
              <div className="space-y-3">
                {plannedExercises.map((pe, i) => (
                  <div key={pe.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 text-sm">{pe.exercise.name}</div>
                      {pe.variation_note && <div className="text-xs text-gray-500">{pe.variation_note}</div>}
                      <div className="text-xs text-gray-500 mt-0.5">
                        <PrescriptionDisplay
                          prescription={pe.prescription_raw}
                          unit={pe.unit}
                          useStackedNotation={false}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom action */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200">
          <button
            onClick={handleStartSession}
            disabled={saving}
            className="w-full min-h-[52px] bg-blue-600 text-white rounded-lg font-medium text-base hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {session?.status === 'in_progress' ? 'Resume Training' : 'Start Training'}
          </button>
        </div>
      </div>
    );
  }

  // ── ACTIVE SESSION ─────────────────────────────────────────────────────────
  if (phase === 'active') {
    const progressPct = totalExercises > 0 ? (completedExercisesCount / totalExercises) * 100 : 0;

    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">{formatDateLong(displayDate)}</div>
            <div className="font-medium text-gray-900 tabular-nums">{formatElapsed(elapsed)}</div>
            <div className="text-sm text-gray-500">
              {completedExercisesCount + 1} of {totalExercises}
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Exercise dots */}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {plannedExercises.map((pe, i) => {
              const logEx = loggedExercises.find(e => e.planned_exercise_id === pe.id);
              const isActive = i === currentExerciseIndex;
              const isDone = logEx?.status === 'completed' || logEx?.status === 'skipped';
              return (
                <button
                  key={pe.id}
                  onClick={() => setCurrentExerciseIndex(i)}
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center transition-colors ${
                    isActive ? 'bg-blue-600 text-white' :
                    isDone ? 'bg-green-500 text-white' :
                    'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* PR badge */}
        {prBadge && (
          <div className="mx-4 mt-3 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-800 flex items-center gap-2">
            <span>New PR!</span>
            <span className="font-medium">{prBadge.load}kg × {prBadge.reps}</span>
          </div>
        )}

        {/* Exercise card */}
        {currentPlanned && (
          <div className="mx-4 mt-3 bg-white rounded-lg border border-gray-200">
            <div className="p-4 border-b border-gray-100">
              <div className="text-lg font-medium text-gray-900">{currentPlanned.exercise.name}</div>
              {currentPlanned.variation_note && (
                <div className="text-[13px] text-gray-500 mt-0.5">{currentPlanned.variation_note}</div>
              )}
              {currentPlanned.notes && (
                <div className="text-[13px] text-blue-800 bg-blue-50 rounded px-2 py-1 mt-1 italic">
                  {currentPlanned.notes}
                </div>
              )}
              <div className="text-sm text-gray-500 mt-1">
                Planned: <PrescriptionDisplay
                  prescription={currentPlanned.prescription_raw}
                  unit={currentPlanned.unit}
                  useStackedNotation={false}
                />
              </div>
            </div>

            {/* Sets table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="px-3 py-2 text-left w-8">#</th>
                    <th className="px-3 py-2 text-left">Planned</th>
                    <th className="px-3 py-2 text-left">Performed</th>
                    <th className="px-3 py-2 text-left">RPE</th>
                    <th className="px-3 py-2 text-left w-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allSets.map((set, i) => (
                    <SetRow
                      key={set.id}
                      set={set}
                      index={i}
                      onComplete={handleCompleteSet}
                      onSkip={skipSet}
                      prSetId={prSetId}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add set */}
            <div className="px-4 py-2 border-t border-gray-100">
              <button
                onClick={handleAddSet}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 min-h-[36px]"
              >
                <Plus className="w-4 h-4" />
                Add set
              </button>
            </div>

            {/* Technique rating (shows when all sets done) */}
            {allSetsDone && (
              <div className="px-4 py-3 border-t border-gray-100">
                <div className="text-xs text-gray-500 mb-2">Technique rating</div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => setTechniqueRating(star)}
                      className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border transition-colors ${
                        techniqueRating >= star
                          ? 'bg-yellow-400 border-yellow-400 text-white'
                          : 'border-gray-200 text-gray-400 hover:border-yellow-300'
                      }`}
                    >
                      <Star className="w-5 h-5" fill={techniqueRating >= star ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Exercise notes toggle */}
            <div className="border-t border-gray-100">
              <button
                onClick={() => setNotesOpen(prev => !prev)}
                className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
              >
                <span>Exercise notes</span>
                {notesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {notesOpen && (
                <div className="px-4 pb-3">
                  <textarea
                    value={exerciseNotes}
                    onChange={e => setExerciseNotes(e.target.value)}
                    rows={3}
                    placeholder="Notes for this exercise..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mx-4 mt-3 mb-4 flex items-center gap-2">
          <button
            onClick={() => setCurrentExerciseIndex(prev => Math.max(0, prev - 1))}
            disabled={currentExerciseIndex === 0}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleSkipExercise}
            className="px-4 min-h-[44px] text-sm text-gray-400 hover:text-gray-600"
          >
            Skip exercise
          </button>
          <button
            onClick={handleNextExercise}
            disabled={!allSetsDone && allSets.length > 0}
            className="flex-1 min-h-[44px] bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1"
          >
            {currentExerciseIndex === plannedExercises.length - 1 ? 'Finish Session' : 'Next Exercise'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Rest timer overlay */}
        {showRestTimer && (
          <RestTimer
            defaultSeconds={restSeconds}
            onDismiss={() => setShowRestTimer(false)}
            onComplete={() => setShowRestTimer(false)}
          />
        )}
      </div>
    );
  }

  // ── POST-SESSION ───────────────────────────────────────────────────────────
  const stats = computeStats();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="font-medium text-gray-900">Session Complete</div>
      </div>

      <div className="max-w-lg mx-auto p-4 pb-28 space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="text-2xl font-medium text-gray-900 mb-1">Session Complete!</div>
          {session?.duration_minutes && (
            <div className="text-gray-500 text-sm">{session.duration_minutes} minutes</div>
          )}
          {!session?.duration_minutes && elapsed > 0 && (
            <div className="text-gray-500 text-sm">{Math.round(elapsed / 60)} minutes</div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Exercises', value: `${completedExercisesCount}/${totalExercises}` },
            { label: 'Sets done', value: `${stats.completedSets}/${stats.plannedSets}` },
            { label: 'Total reps', value: stats.totalReps },
            { label: 'Tonnage', value: `${stats.totalTonnage.toFixed(0)}kg` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <div className="text-2xl font-medium text-gray-900">{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Compliance */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Compliance</span>
            <span className="text-sm font-medium text-gray-900">{stats.compliance}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${stats.compliance >= 80 ? 'bg-green-500' : stats.compliance >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${stats.compliance}%` }}
            />
          </div>
        </div>

        {/* Session RPE */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-3">Session RPE (1–10)</label>
          <div className="flex gap-1.5 flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <button
                key={n}
                onClick={() => setSessionRpe(n)}
                className={`w-9 h-9 text-sm rounded-lg border transition-colors ${
                  sessionRpe === n
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-700 hover:border-blue-400'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Session notes */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Session notes</label>
          <textarea
            value={sessionNotes}
            onChange={e => setSessionNotes(e.target.value)}
            rows={3}
            placeholder="How did the session go?"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200">
        <button
          onClick={handleCompleteSession}
          disabled={saving}
          className="w-full min-h-[52px] bg-green-600 text-white rounded-lg font-medium text-base hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          Complete Session
        </button>
      </div>
    </div>
  );
}
