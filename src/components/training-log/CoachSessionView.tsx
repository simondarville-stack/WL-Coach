import { useEffect, useState, useCallback } from 'react';
import { X, Send, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  TrainingLogSession,
  TrainingLogExerciseWithExercise,
  TrainingLogSet,
  TrainingLogMessage,
  Athlete,
} from '../../lib/database.types';
import { useTrainingLog } from '../../hooks/useTrainingLog';

interface CoachSessionViewProps {
  sessionId: string;
  onClose?: () => void;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planned: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    skipped: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status === 'in_progress' && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
      )}
      {status === 'in_progress' ? 'LIVE' : status.replace('_', ' ')}
    </span>
  );
}

function SetComparisonRow({ set }: { set: TrainingLogSet }) {
  const plannedText = set.planned_load != null || set.planned_reps != null
    ? `${set.planned_load ?? '—'}kg × ${set.planned_reps ?? '—'}`
    : '—';
  const performedText = set.status === 'completed'
    ? `${set.performed_load ?? '—'}kg × ${set.performed_reps ?? '—'}`
    : set.status === 'skipped' ? 'Skipped'
    : '—';

  const isUnderPerformed = set.status === 'completed' &&
    set.planned_load != null && set.performed_load != null &&
    set.performed_load < set.planned_load;

  const rowColor = set.status === 'completed' && !isUnderPerformed
    ? 'bg-green-50'
    : set.status === 'completed' && isUnderPerformed
    ? 'bg-yellow-50'
    : set.status === 'skipped' || set.status === 'failed'
    ? 'bg-red-50'
    : '';

  return (
    <tr className={`text-sm ${rowColor}`}>
      <td className="px-3 py-1.5 text-xs text-gray-500">{set.set_number}</td>
      <td className="px-3 py-1.5 text-gray-700">{plannedText}</td>
      <td className="px-3 py-1.5 text-gray-700">{performedText}</td>
      <td className="px-3 py-1.5 text-gray-500">{set.rpe ?? '—'}</td>
      <td className="px-3 py-1.5">
        {set.status === 'completed' && !isUnderPerformed && <span className="text-green-600 text-xs">✓</span>}
        {set.status === 'completed' && isUnderPerformed && <span className="text-yellow-600 text-xs">↓</span>}
        {(set.status === 'skipped' || set.status === 'failed') && <span className="text-red-500 text-xs">✗</span>}
        {set.status === 'pending' && <span className="text-gray-400 text-xs">—</span>}
      </td>
    </tr>
  );
}

interface ExerciseCardProps {
  logExercise: TrainingLogExerciseWithExercise;
  sets: TrainingLogSet[];
  exerciseMessages: TrainingLogMessage[];
  sessionId: string;
  onSendMessage: (exerciseId: string, msg: string) => void;
}

function ExerciseCard({ logExercise, sets, exerciseMessages, sessionId, onSendMessage }: ExerciseCardProps) {
  const [msgText, setMsgText] = useState('');

  const completedSets = sets.filter(s => s.status === 'completed').length;
  const totalSets = sets.length;
  const compliance = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : null;

  const complianceColor = compliance == null ? '' : compliance >= 80 ? 'text-green-600' : compliance >= 60 ? 'text-yellow-600' : 'text-red-500';

  const starRating = logExercise.technique_rating;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">{logExercise.exercise.name}</div>
          <div className="flex items-center gap-3 mt-0.5">
            <StatusBadge status={logExercise.status} />
            {compliance != null && (
              <span className={`text-xs font-medium ${complianceColor}`}>{compliance}% compliance</span>
            )}
          </div>
        </div>
        {starRating && (
          <div className="flex gap-0.5 flex-shrink-0">
            {[1,2,3,4,5].map(s => (
              <span key={s} className={`text-sm ${s <= starRating ? 'text-yellow-400' : 'text-gray-200'}`}>★</span>
            ))}
          </div>
        )}
      </div>

      {sets.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-400">
                <th className="px-3 py-1.5 text-left">#</th>
                <th className="px-3 py-1.5 text-left">Planned</th>
                <th className="px-3 py-1.5 text-left">Performed</th>
                <th className="px-3 py-1.5 text-left">RPE</th>
                <th className="px-3 py-1.5 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sets.map(set => (
                <SetComparisonRow key={set.id} set={set} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logExercise.performed_notes && (
        <div className="px-4 py-2 text-xs text-gray-600 italic border-t border-gray-100">
          Athlete note: {logExercise.performed_notes}
        </div>
      )}

      {/* Coach messages */}
      {exerciseMessages.length > 0 && (
        <div className="px-4 py-2 space-y-1 border-t border-gray-100">
          {exerciseMessages.map(m => (
            <div key={m.id} className={`text-xs flex gap-2 ${m.sender_type === 'coach' ? 'justify-end' : ''}`}>
              <span className={`px-2 py-1 rounded-lg ${m.sender_type === 'coach' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                {m.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Coach message input */}
      <div className="px-4 py-2 border-t border-gray-100 flex gap-2">
        <input
          type="text"
          value={msgText}
          onChange={e => setMsgText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && msgText.trim()) {
              onSendMessage(logExercise.id, msgText.trim());
              setMsgText('');
            }
          }}
          placeholder="Message athlete..."
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-400 focus:outline-none"
        />
        <button
          onClick={() => {
            if (msgText.trim()) {
              onSendMessage(logExercise.id, msgText.trim());
              setMsgText('');
            }
          }}
          className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function CoachSessionView({ sessionId, onClose }: CoachSessionViewProps) {
  const { setsMap, messages, fetchSetsForExercise, fetchMessages, sendMessage } = useTrainingLog();

  const [sessionData, setSessionData] = useState<TrainingLogSession | null>(null);
  const [exercises, setExercises] = useState<TrainingLogExerciseWithExercise[]>([]);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSessionData = useCallback(async () => {
    const { data: sess } = await supabase
      .from('training_log_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (!sess) return;
    setSessionData(sess);

    const { data: exs } = await supabase
      .from('training_log_exercises')
      .select('*, exercise:exercises(*)')
      .eq('session_id', sessionId)
      .order('position');
    const exerciseList = (exs || []) as TrainingLogExerciseWithExercise[];
    setExercises(exerciseList);

    // Fetch sets for all exercises
    for (const ex of exerciseList) {
      await fetchSetsForExercise(ex.id);
    }

    // Fetch athlete
    if (sess.athlete_id) {
      const { data: ath } = await supabase
        .from('athletes')
        .select('*')
        .eq('id', sess.athlete_id)
        .single();
      setAthlete(ath);
    }

    await fetchMessages(sessionId);
    setLoading(false);
  }, [sessionId, fetchSetsForExercise, fetchMessages]);

  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Poll every 15s when in_progress
  useEffect(() => {
    if (sessionData?.status !== 'in_progress') return;
    const timer = setInterval(loadSessionData, 15000);
    return () => clearInterval(timer);
  }, [sessionData?.status, loadSessionData]);

  const handleSendMessage = async (exerciseId: string, msg: string) => {
    await sendMessage(sessionId, exerciseId, msg, 'coach');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading session...</div>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Session not found</div>
      </div>
    );
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const rawTotal = sessionData.raw_total;
  const rawScores = [
    { label: 'Sleep', value: sessionData.raw_sleep },
    { label: 'Physical', value: sessionData.raw_physical },
    { label: 'Mood', value: sessionData.raw_mood },
    { label: 'Nutrition', value: sessionData.raw_nutrition },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">{athlete?.name ?? 'Athlete'}</span>
            <StatusBadge status={sessionData.status} />
            {sessionData.duration_minutes && (
              <span className="text-xs text-gray-500">{sessionData.duration_minutes} min</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{formatDate(sessionData.date)}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {sessionData.status === 'in_progress' && (
            <button
              onClick={loadSessionData}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* RAW Scores */}
        {rawTotal != null && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-4 flex-wrap">
              {rawScores.map(({ label, value }) => (
                <div key={label} className="text-center">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="font-medium text-gray-900">{value ?? '—'}/3</div>
                </div>
              ))}
              <div className="ml-auto text-center">
                <div className="text-xs text-gray-500">Total RAW</div>
                <div className="text-lg font-medium text-gray-900">{rawTotal}/12</div>
              </div>
            </div>
            {sessionData.raw_guidance && (
              <div className="mt-3 text-xs text-gray-600 whitespace-pre-line bg-gray-50 rounded p-2">
                {sessionData.raw_guidance}
              </div>
            )}
          </div>
        )}

        {/* Exercises */}
        {exercises.map(ex => (
          <ExerciseCard
            key={ex.id}
            logExercise={ex}
            sets={setsMap[ex.id] || []}
            exerciseMessages={messages.filter(m => m.exercise_id === ex.id)}
            sessionId={sessionId}
            onSendMessage={handleSendMessage}
          />
        ))}

        {/* Session summary */}
        {(sessionData.session_rpe || sessionData.session_notes || sessionData.bodyweight_kg) && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
            <div className="text-sm font-medium text-gray-700 mb-2">Session Summary</div>
            {sessionData.bodyweight_kg && (
              <div className="text-sm text-gray-600">Bodyweight: <span className="text-gray-900">{sessionData.bodyweight_kg}kg</span></div>
            )}
            {sessionData.session_rpe && (
              <div className="text-sm text-gray-600">Session RPE: <span className="text-gray-900">{sessionData.session_rpe}/10</span></div>
            )}
            {sessionData.session_notes && (
              <div className="text-sm text-gray-600 italic">{sessionData.session_notes}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
