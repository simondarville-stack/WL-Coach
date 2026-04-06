import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getMondayOfWeek } from '../../lib/dateUtils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ComplianceChartProps {
  athleteId: string;
  weeks?: number;
}

interface WeekCompliance {
  label: string;
  compliance: number;
  completed: number;
  planned: number;
}


export function ComplianceChart({ athleteId, weeks = 4 }: ComplianceChartProps) {
  const [data, setData] = useState<WeekCompliance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Build week buckets for the last N weeks
      const today = new Date();
      const weekBuckets: { start: Date; end: Date; label: string }[] = [];

      for (let i = weeks - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i * 7);
        const ws = getMondayOfWeek(d);
        const we = new Date(ws);
        we.setDate(we.getDate() + 7);
        const weekNum = weeks - i;
        weekBuckets.push({
          start: ws,
          end: we,
          label: `W${weekNum}`,
        });
      }

      const since = weekBuckets[0].start.toISOString().split('T')[0];

      // Fetch sessions in range
      const { data: sessions } = await supabase
        .from('training_log_sessions')
        .select('id, date, status')
        .eq('athlete_id', athleteId)
        .neq('status', 'planned')
        .gte('date', since);

      const sessionIds = (sessions || []).map(s => s.id);

      let allSets: Array<{ session_id?: string; status: string; log_exercise_id: string }> = [];

      if (sessionIds.length > 0) {
        const { data: exercises } = await supabase
          .from('training_log_exercises')
          .select('id, session_id')
          .in('session_id', sessionIds);

        const exerciseIds = (exercises || []).map(e => e.id);

        if (exerciseIds.length > 0) {
          const { data: sets } = await supabase
            .from('training_log_sets')
            .select('log_exercise_id, status')
            .in('log_exercise_id', exerciseIds);

          // Map sets back to session_id via exercises
          const exMap = new Map((exercises || []).map(e => [e.id, e.session_id]));
          allSets = (sets || []).map(s => ({
            ...s,
            session_id: exMap.get(s.log_exercise_id),
          }));
        }
      }

      const weekData: WeekCompliance[] = weekBuckets.map(bucket => {
        const wsISO = bucket.start.toISOString().split('T')[0];
        const weISO = bucket.end.toISOString().split('T')[0];

        const weekSessionIds = (sessions || [])
          .filter(s => s.date >= wsISO && s.date < weISO)
          .map(s => s.id);

        const weekSets = allSets.filter(s => weekSessionIds.includes(s.session_id ?? ''));
        const planned = weekSets.length;
        const completed = weekSets.filter(s => s.status === 'completed').length;
        const compliance = planned > 0 ? Math.round((completed / planned) * 100) : 0;

        return { label: bucket.label, compliance, completed, planned };
      });

      setData(weekData);
      setLoading(false);
    };
    load();
  }, [athleteId, weeks]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">Compliance (last {weeks} weeks)</div>
        <div className="h-32 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-medium text-gray-700 mb-3">Compliance (last {weeks} weeks)</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit="%" />
          <Tooltip
            formatter={(value: number) => [`${value}%`, 'Compliance']}
            contentStyle={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
          <Bar dataKey="compliance" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
