import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../../../lib/supabase';

interface Props { athleteId: string; startDate: string; endDate: string; }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function TrainingPatterns({ athleteId, startDate, endDate }: Props) {
  const [data, setData] = useState<Array<{ day: string; sessions: number; reps: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: sessions } = await supabase
          .from('training_log_sessions')
          .select('date, status')
          .eq('athlete_id', athleteId)
          .gte('date', startDate)
          .lte('date', endDate);

        const byday: Record<number, { sessions: number; reps: number }> = {};
        for (let i = 0; i < 7; i++) byday[i] = { sessions: 0, reps: 0 };

        for (const s of (sessions ?? [])) {
          if (s.status === 'skipped') continue;
          const d = new Date(s.date);
          const dow = (d.getDay() + 6) % 7; // 0=Mon
          byday[dow].sessions++;
        }

        setData(DAYS.map((day, i) => ({ day, ...byday[i] })));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Training patterns — sessions by day of week</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
          <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb' }} />
          <Bar dataKey="sessions" name="Sessions" fill="#378ADD" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
