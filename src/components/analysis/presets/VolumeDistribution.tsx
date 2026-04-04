import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { fetchWeeklyAggregates, type WeeklyAggregate } from '../../../hooks/useAnalysis';

interface Props { athleteId: string; startDate: string; endDate: string; }

const CATEGORY_COLORS: Record<string, string> = {
  Classical: '#378ADD',
  Squats: '#1D9E75',
  Pulls: '#EF9F27',
  Accessories: '#9b5de5',
};

function formatWeek(ws: string) {
  const d = new Date(ws);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function VolumeDistribution({ athleteId, startDate, endDate }: Props) {
  const [aggregates, setAggregates] = useState<WeeklyAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWeeklyAggregates({ athleteId, startDate, endDate })
      .then(setAggregates)
      .finally(() => setLoading(false));
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;

  const chartData = aggregates.map(agg => {
    const byCat: Record<string, number> = {};
    for (const bd of agg.exerciseBreakdowns) {
      byCat[bd.category] = (byCat[bd.category] ?? 0) + bd.performedTonnage;
    }
    return { week: formatWeek(agg.weekStart), ...byCat };
  });

  const categories = Array.from(new Set(aggregates.flatMap(a => a.exerciseBreakdowns.map(b => b.category))));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Volume distribution by category</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit=" kg" width={52} />
          <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {categories.map(cat => (
            <Bar key={cat} dataKey={cat} stackId="a" fill={CATEGORY_COLORS[cat] ?? '#94a3b8'} name={cat} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
