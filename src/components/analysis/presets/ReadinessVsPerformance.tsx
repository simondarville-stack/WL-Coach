import { useState, useEffect } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchWeeklyAggregates, type WeeklyAggregate } from '../../../hooks/useAnalysis';

interface Props { athleteId: string; startDate: string; endDate: string; }

export function ReadinessVsPerformance({ athleteId, startDate, endDate }: Props) {
  const [aggregates, setAggregates] = useState<WeeklyAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWeeklyAggregates({ athleteId, startDate, endDate })
      .then(setAggregates)
      .finally(() => setLoading(false));
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;

  const scatterData = aggregates
    .filter(a => a.rawTotal != null && a.complianceReps > 0)
    .map(a => ({
      raw: a.rawTotal,
      compliance: a.complianceReps,
      rpe: a.sessionRpe ?? 0,
      week: a.weekStart,
    }));

  if (!scatterData.length) {
    return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No readiness + performance data found for this period.</div>;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Readiness vs performance (compliance %)</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="raw" name="RAW readiness" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} label={{ value: 'RAW total', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
          <YAxis dataKey="compliance" name="Compliance %" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} unit="%" width={40} />
          <Tooltip contentStyle={{ fontSize: 12, border: '0.5px solid var(--color-border-secondary)' }} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={scatterData} fill="#378ADD" fillOpacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
