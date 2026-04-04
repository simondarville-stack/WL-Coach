import { useState, useEffect } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { fetchBodyweightSeries } from '../../../hooks/useAnalysis';
import { supabase } from '../../../lib/supabase';

interface Props { athleteId: string; startDate: string; endDate: string; }

// Standard OWL weight classes (kg)
const WEIGHT_CLASSES = [49, 55, 59, 64, 71, 76, 81, 87, 96, 102, 109];

function movingAvg(arr: Array<{ date: string; weight: number }>, window: number) {
  return arr.map((item, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((s, x) => s + x.weight, 0) / slice.length;
    return { ...item, ma: Math.round(avg * 10) / 10 };
  });
}

export function BodyweightTrend({ athleteId, startDate, endDate }: Props) {
  const [series, setSeries] = useState<Array<{ date: string; weight: number; ma: number }>>([]);
  const [weightClass, setWeightClass] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [bwData, athleteRes] = await Promise.all([
          fetchBodyweightSeries(athleteId, startDate, endDate),
          supabase.from('athletes').select('weight_class').eq('id', athleteId).single(),
        ]);
        setWeightClass(athleteRes.data?.weight_class ?? null);
        setSeries(movingAvg(bwData, 7));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading...</div>;
  if (!series.length) return (
    <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
      No bodyweight data found. Bodyweight tracking must be enabled for this athlete.
    </div>
  );

  // Determine relevant weight classes to show
  const allWeights = series.map(s => s.weight);
  const minW = Math.min(...allWeights) - 3;
  const maxW = Math.max(...allWeights) + 3;
  const relevantClasses = WEIGHT_CLASSES.filter(wc => wc >= minW && wc <= maxW);

  const chartData = series.map(s => ({ ...s, date: s.date.slice(5) }));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-1">Bodyweight trend</h3>
      {weightClass && <p className="text-[11px] text-gray-400 mb-3">Weight class: {weightClass}</p>}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit=" kg" width={52} domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb' }} />
          {relevantClasses.map(wc => (
            <ReferenceLine key={wc} y={wc} stroke="#e5e7eb" strokeDasharray="4 2" label={{ value: `${wc}kg`, fontSize: 9, fill: '#9ca3af' }} />
          ))}
          <Line type="monotone" dataKey="weight" name="Bodyweight" stroke="#9b5de5" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
          <Line type="monotone" dataKey="ma" name="7-day MA" stroke="#378ADD" strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
