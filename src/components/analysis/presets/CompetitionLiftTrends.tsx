import { useState, useEffect } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceArea,
} from 'recharts';
import { fetchExerciseTimeSeries, fetchWeeklyAggregates } from '../../../hooks/useAnalysis';
import { supabase } from '../../../lib/supabase';
import { getOwnerId } from '../../../lib/ownerContext';

interface Props { athleteId: string; startDate: string; endDate: string; }

export function CompetitionLiftTrends({ athleteId, startDate, endDate }: Props) {
  const [data, setData] = useState<Array<{ date: string; snatch?: number; cj?: number }>>([]);
  const [phases, setPhases] = useState<Array<{ start: string; end: string; name: string; color: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [exRes, aggRes] = await Promise.all([
          supabase.from('exercises').select('id, name, lift_slot').eq('owner_id', getOwnerId()),
          fetchWeeklyAggregates({ athleteId, startDate, endDate }),
        ]);

        const exercises = (exRes.data ?? []) as Array<{ id: string; name: string; lift_slot: string | null }>;
        // Primary: lift_slot; fallback: name heuristic
        const snatchEx = exercises.find(e => e.lift_slot === 'snatch')
          ?? exercises.find(e => e.name.toLowerCase().includes('snatch') && !e.name.toLowerCase().includes('pull') && !e.name.toLowerCase().includes('press'));
        const cjEx = exercises.find(e => e.lift_slot === 'clean_and_jerk')
          ?? exercises.find(e => e.name.toLowerCase().includes('clean') && e.name.toLowerCase().includes('jerk'));

        const [snatchSeries, cjSeries] = await Promise.all([
          snatchEx ? fetchExerciseTimeSeries(athleteId, snatchEx.id, startDate, endDate) : Promise.resolve([]),
          cjEx ? fetchExerciseTimeSeries(athleteId, cjEx.id, startDate, endDate) : Promise.resolve([]),
        ]);

        // Merge by date
        const dateMap = new Map<string, { snatch?: number; cj?: number }>();
        for (const s of snatchSeries) {
          dateMap.set(s.date, { ...dateMap.get(s.date), snatch: s.maxLoad });
        }
        for (const c of cjSeries) {
          dateMap.set(c.date, { ...dateMap.get(c.date), cj: c.maxLoad });
        }

        setData(
          Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, v]) => ({ date: date.slice(5), ...v }))
        );

        // Extract phases from aggregates
        const phaseMap = new Map<string, { start: string; end: string; color: string }>();
        for (const agg of aggRes) {
          if (!agg.phaseName) continue;
          const existing = phaseMap.get(agg.phaseName);
          if (!existing) {
            phaseMap.set(agg.phaseName, { start: agg.weekStart.slice(5), end: agg.weekStart.slice(5), color: agg.phaseColor ?? '#94a3b8' });
          } else {
            existing.end = agg.weekStart.slice(5);
          }
        }
        setPhases(Array.from(phaseMap.entries()).map(([name, v]) => ({ name, ...v })));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;
  if (!data.length) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No competition lift data found for this period.</div>;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Competition lift trends</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          {phases.map(p => (
            <ReferenceArea key={p.name} x1={p.start} x2={p.end} fill={p.color} fillOpacity={0.1} label={{ value: p.name, fontSize: 10, fill: '#6b7280' }} />
          ))}
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} unit=" kg" width={52} />
          <Tooltip contentStyle={{ fontSize: 12, border: '0.5px solid var(--color-border-secondary)' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="snatch" name="Snatch max" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="cj" name="C&J max" stroke="#1D9E75" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
