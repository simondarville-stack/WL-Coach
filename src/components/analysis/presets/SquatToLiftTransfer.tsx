import { useState, useEffect } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchExerciseTimeSeries } from '../../../hooks/useAnalysis';
import { supabase } from '../../../lib/supabase';
import { getOwnerId } from '../../../lib/ownerContext';

interface Props { athleteId: string; startDate: string; endDate: string; }

export function SquatToLiftTransfer({ athleteId, startDate, endDate }: Props) {
  const [data, setData] = useState<Array<{ date: string; squat?: number; snatch?: number; cj?: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: exercises } = await supabase.from('exercises').select('id, name, lift_slot').eq('owner_id', getOwnerId());
        const exList = (exercises ?? []) as Array<{ id: string; name: string; lift_slot: string | null }>;

        // Primary: lift_slot; fallback: name heuristic
        const bsqEx = exList.find(e => e.lift_slot === 'back_squat')
          ?? exList.find(e => e.name.toLowerCase().includes('back squat'));
        const snEx = exList.find(e => e.lift_slot === 'snatch')
          ?? exList.find(e => e.name.toLowerCase().includes('snatch') && !e.name.toLowerCase().includes('pull'));
        const cjEx = exList.find(e => e.lift_slot === 'clean_and_jerk')
          ?? exList.find(e => e.name.toLowerCase().includes('clean') && e.name.toLowerCase().includes('jerk'));

        const [bsqSeries, snSeries, cjSeries] = await Promise.all([
          bsqEx ? fetchExerciseTimeSeries(athleteId, bsqEx.id, startDate, endDate) : Promise.resolve([]),
          snEx ? fetchExerciseTimeSeries(athleteId, snEx.id, startDate, endDate) : Promise.resolve([]),
          cjEx ? fetchExerciseTimeSeries(athleteId, cjEx.id, startDate, endDate) : Promise.resolve([]),
        ]);

        const dateMap = new Map<string, { squat?: number; snatch?: number; cj?: number }>();
        for (const s of bsqSeries) dateMap.set(s.date, { ...dateMap.get(s.date), squat: s.maxLoad });
        for (const s of snSeries) dateMap.set(s.date, { ...dateMap.get(s.date), snatch: s.maxLoad });
        for (const s of cjSeries) dateMap.set(s.date, { ...dateMap.get(s.date), cj: s.maxLoad });

        setData(
          Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, v]) => ({ date: date.slice(5), ...v }))
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;
  if (!data.length) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No squat or competition lift data found.</div>;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Squat-to-lift transfer</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit=" kg" width={48} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit=" kg" width={40} />
          <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line yAxisId="left" type="monotone" dataKey="squat" name="Back squat" stroke="#9b5de5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="right" type="monotone" dataKey="snatch" name="Snatch" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line yAxisId="right" type="monotone" dataKey="cj" name="C&J" stroke="#1D9E75" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
