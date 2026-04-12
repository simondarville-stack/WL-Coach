// @ts-nocheck
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../lib/dateHelpers';
import { Trophy, TrendingUp, Calendar } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { AthletePR, Exercise, TrainingLogSession } from '../../lib/database.types';

interface PRWithExercise extends AthletePR {
  exercise: Exercise;
}

interface TrendPoint {
  date: string;
  label: string;
  value: number;
}

export function ProgressScreen() {
  const { athlete } = useAuth();
  const [prs, setPrs] = useState<PRWithExercise[]>([]);
  const [sessions, setSessions] = useState<TrainingLogSession[]>([]);
  const [selectedPR, setSelectedPR] = useState<PRWithExercise | null>(null);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (athlete) loadData();
  }, [athlete]);

  async function loadData() {
    if (!athlete) return;
    setLoading(true);

    const { data: prData } = await supabase
      .from('athlete_prs')
      .select('*, exercise:exercise_id(*)')
      .eq('athlete_id', athlete.id)
      .not('pr_value_kg', 'is', null)
      .order('pr_value_kg', { ascending: false });

    const validPrs = (prData || []).filter(p => p.exercise && p.pr_value_kg);
    setPrs(validPrs);

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = threeMonthsAgo.toISOString().split('T')[0];

    const { data: sessionData } = await supabase
      .from('training_log_sessions')
      .select('*')
      .eq('athlete_id', athlete.id)
      .gte('date', cutoff)
      .order('date', { ascending: false })
      .limit(30);

    setSessions(sessionData || []);

    if (validPrs.length > 0) {
      setSelectedPR(validPrs[0]);
      loadTrend(validPrs[0]);
    }

    setLoading(false);
  }

  async function loadTrend(pr: PRWithExercise) {
    if (!athlete) return;
    setSelectedPR(pr);

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = threeMonthsAgo.toISOString().split('T')[0];

    const { data: logExercises } = await supabase
      .from('training_log_exercises')
      .select(`
        id,
        session_id,
        exercise_id,
        training_log_sessions!inner(date, athlete_id)
      `)
      .eq('exercise_id', pr.exercise_id)
      .eq('training_log_sessions.athlete_id', athlete.id)
      .gte('training_log_sessions.date', cutoff);

    if (!logExercises || logExercises.length === 0) {
      setTrendData([]);
      return;
    }

    const logExIds = logExercises.map(le => le.id);
    const { data: logSets } = await supabase
      .from('training_log_sets')
      .select('log_exercise_id, performed_load')
      .in('log_exercise_id', logExIds)
      .eq('status', 'completed')
      .not('performed_load', 'is', null);

    const maxByLogEx = new Map<string, number>();
    (logSets || []).forEach(s => {
      const current = maxByLogEx.get(s.log_exercise_id) || 0;
      if ((s.performed_load || 0) > current) {
        maxByLogEx.set(s.log_exercise_id, s.performed_load!);
      }
    });

    const points: TrendPoint[] = logExercises
      .filter(le => maxByLogEx.has(le.id))
      .map(le => {
        const session = le.training_log_sessions as any;
        return {
          date: session.date,
          label: formatDate(session.date),
          value: maxByLogEx.get(le.id)!,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    setTrendData(points);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="text-xl font-bold text-white mb-5">My Progress</h1>

      {prs.length === 0 ? (
        <div className="text-center py-16">
          <Trophy size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No personal records yet</p>
          <p className="text-gray-600 text-sm mt-1">Your coach will add your PRs</p>
        </div>
      ) : (
        <>
          <div className="space-y-2 mb-6">
            {prs.map(pr => (
              <button
                key={pr.id}
                onClick={() => loadTrend(pr)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                  selectedPR?.id === pr.id
                    ? 'bg-blue-950/30 border-blue-700/50'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <div
                  className="w-1 h-8 rounded-full flex-shrink-0"
                  style={{ backgroundColor: pr.exercise?.color || '#3B82F6' }}
                />
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-gray-200">{pr.exercise?.name}</p>
                  {pr.pr_date && (
                    <p className="text-[11px] text-gray-500">{formatDate(pr.pr_date)}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">{pr.pr_value_kg}kg</p>
                </div>
              </button>
            ))}
          </div>

          {selectedPR && trendData.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-blue-400" />
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {selectedPR.exercise?.name} - 3 Month Trend
                </p>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    stroke="#374151"
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    stroke="#374151"
                    domain={['auto', 'auto']}
                    width={35}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(value: number) => [`${value}kg`, 'Max Load']}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3b82f6' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={14} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Recent Sessions</h2>
        </div>

        {sessions.length === 0 ? (
          <p className="text-sm text-gray-600">No sessions logged yet</p>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-gray-900 rounded-xl border border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-200">{formatDate(s.date)}</p>
                  {s.session_notes && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]">{s.session_notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {s.duration_minutes && <span>{s.duration_minutes}min</span>}
                  {s.session_rpe && <span>RPE {s.session_rpe}</span>}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    s.status === 'completed' ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'
                  }`}>
                    {s.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
