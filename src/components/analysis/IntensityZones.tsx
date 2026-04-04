import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchWeeklyAggregates, fetchIntensityZones, type WeeklyAggregate, type IntensityZone } from '../../hooks/useAnalysis';
import { supabase } from '../../lib/supabase';

interface Props {
  athleteId: string;
  startDate: string;
  endDate: string;
}

const ZONES = ['<70%', '70-80%', '80-90%', '90%+'] as const;
const ZONE_COLORS = ['#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'];

const OWL_TARGETS: Record<string, Record<string, number>> = {
  Volume: { '<70%': 35, '70-80%': 30, '80-90%': 25, '90%+': 10 },
  Intensity: { '<70%': 20, '70-80%': 25, '80-90%': 35, '90%+': 20 },
  Competition: { '<70%': 15, '70-80%': 15, '80-90%': 30, '90%+': 40 },
};

function formatWeek(ws: string) {
  const d = new Date(ws);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function IntensityZones({ athleteId, startDate, endDate }: Props) {
  const [aggregates, setAggregates] = useState<WeeklyAggregate[]>([]);
  const [zones, setZones] = useState<IntensityZone[]>([]);
  const [exercises, setExercises] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('all');
  const [oneRepMax, setOneRepMax] = useState(100);
  const [loading, setLoading] = useState(true);
  const [weeklyZones, setWeeklyZones] = useState<Array<Record<string, number | string>>>([]);

  useEffect(() => {
    supabase.from('exercises').select('id, name').order('name')
      .then(({ data }) => {
        setExercises((data ?? []) as Array<{ id: string; name: string }>);
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aggs] = await Promise.all([
        fetchWeeklyAggregates({ athleteId, startDate, endDate }),
      ]);
      setAggregates(aggs);

      if (selectedExerciseId !== 'all') {
        // Fetch overall zones
        const zoneData = await fetchIntensityZones(athleteId, selectedExerciseId, startDate, endDate, oneRepMax);
        setZones(zoneData);

        // Fetch week-by-week zones
        const wkZones = await Promise.all(
          aggs.map(async agg => {
            const endOfWeek = new Date(agg.weekStart);
            endOfWeek.setDate(endOfWeek.getDate() + 6);
            const weekZones = await fetchIntensityZones(
              athleteId,
              selectedExerciseId,
              agg.weekStart,
              endOfWeek.toISOString().slice(0, 10),
              oneRepMax
            );
            const row: Record<string, number | string> = { week: formatWeek(agg.weekStart) };
            for (const z of weekZones) row[z.zone] = z.reps;
            return row;
          })
        );
        setWeeklyZones(wkZones);
      } else {
        setZones([]);
        setWeeklyZones([]);
      }
    } finally {
      setLoading(false);
    }
  }, [athleteId, startDate, endDate, selectedExerciseId, oneRepMax]);

  useEffect(() => { load(); }, [load]);

  // Determine current phase type for comparison
  const latestAgg = aggregates[aggregates.length - 1];
  const phaseType = latestAgg?.weekType?.toLowerCase().includes('comp')
    ? 'Competition'
    : latestAgg?.weekType?.toLowerCase().includes('deload') || latestAgg?.weekType?.toLowerCase().includes('taper')
    ? 'Intensity'
    : 'Volume';

  const targets = OWL_TARGETS[phaseType];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium">Exercise</span>
          <select
            value={selectedExerciseId}
            onChange={e => setSelectedExerciseId(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
          >
            <option value="all">All competition lifts</option>
            {exercises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {selectedExerciseId !== 'all' && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium">1RM (kg)</span>
            <input
              type="number"
              value={oneRepMax}
              onChange={e => setOneRepMax(Number(e.target.value))}
              className="border border-gray-200 rounded px-2 py-1 text-xs w-20"
              min={1}
            />
          </div>
        )}
      </div>

      {selectedExerciseId === 'all' ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
          Select a specific exercise to see intensity zone distribution.
        </div>
      ) : loading ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
      ) : (
        <>
          {/* Summary zone cards */}
          <div className="grid grid-cols-4 gap-3">
            {ZONES.map((zone, i) => {
              const z = zones.find(z => z.zone === zone);
              return (
                <div key={zone} className="bg-gray-50 rounded-lg py-2 px-4 border border-gray-100">
                  <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: ZONE_COLORS[i] }}>{zone}</div>
                  <div className="text-xl font-medium text-gray-900">{z?.percentage ?? 0}%</div>
                  <div className="text-[11px] text-gray-400">{z?.reps ?? 0} reps</div>
                </div>
              );
            })}
          </div>

          {/* Weekly stacked bar chart */}
          {weeklyZones.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-3">Weekly zone distribution</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={weeklyZones} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                  <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {ZONES.map((zone, i) => (
                    <Bar key={zone} dataKey={zone} stackId="z" fill={ZONE_COLORS[i]} name={zone} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Comparison table */}
          {zones.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-3">
                Your distribution vs target ({phaseType} phase)
              </h3>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-1 text-gray-400 font-medium">Zone</th>
                    <th className="text-right py-1 text-gray-400 font-medium">Your %</th>
                    <th className="text-right py-1 text-gray-400 font-medium">Target</th>
                    <th className="text-right py-1 text-gray-400 font-medium">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {ZONES.map((zone, i) => {
                    const actual = zones.find(z => z.zone === zone)?.percentage ?? 0;
                    const target = targets[zone];
                    const delta = actual - target;
                    return (
                      <tr key={zone} className="border-b border-gray-50">
                        <td className="py-1.5 font-medium" style={{ color: ZONE_COLORS[i] }}>{zone}</td>
                        <td className="py-1.5 text-right text-gray-700">{actual}%</td>
                        <td className="py-1.5 text-right text-gray-400">~{target}%</td>
                        <td className={`py-1.5 text-right font-medium ${delta > 5 ? 'text-amber-500' : delta < -5 ? 'text-red-500' : 'text-green-600'}`}>
                          {delta >= 0 ? '+' : ''}{delta}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
