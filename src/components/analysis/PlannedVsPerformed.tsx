import { useState, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts';
import { fetchWeeklyAggregates, fetchLiftRatios, type WeeklyAggregate } from '../../hooks/useAnalysis';
import { generateInsights } from '../../lib/analysisInsights';

interface Props {
  athleteId: string;
  startDate: string;
  endDate: string;
}

function complianceColor(pct: number): string {
  if (pct >= 95) return '#1D9E75';
  if (pct >= 85) return '#378ADD';
  if (pct >= 75) return '#EF9F27';
  return '#E24B4A';
}

function formatWeek(ws: string) {
  const d = new Date(ws);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-md text-[12px]">
      <div className="font-medium text-gray-700 mb-1">{label}</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ color: p.color }} className="flex gap-2 justify-between">
          <span>{p.name}:</span>
          <span className="font-medium">{typeof p.value === 'number' ? p.value.toFixed(0) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PlannedVsPerformed({ athleteId, startDate, endDate }: Props) {
  const [aggregates, setAggregates] = useState<WeeklyAggregate[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [aggs, ratios] = await Promise.all([
          fetchWeeklyAggregates({ athleteId, startDate, endDate }),
          fetchLiftRatios(athleteId),
        ]);
        setAggregates(aggs);
        setInsights(generateInsights(aggs, ratios, []));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [athleteId, startDate, endDate]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;
  if (!aggregates.length) return (
    <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
      No training data found for this period. Try selecting a longer date range.
    </div>
  );

  // Summary metrics
  const totalPlannedReps = aggregates.reduce((s, a) => s + a.plannedReps, 0);
  const totalPerformedReps = aggregates.reduce((s, a) => s + a.performedReps, 0);
  const totalPlannedTonnage = aggregates.reduce((s, a) => s + a.plannedTonnage, 0);
  const totalPerformedTonnage = aggregates.reduce((s, a) => s + a.performedTonnage, 0);
  const avgCompliance = aggregates.filter(a => a.plannedReps > 0).reduce((s, a) => s + a.complianceReps, 0) /
    (aggregates.filter(a => a.plannedReps > 0).length || 1);

  // Macro phase bar data
  const phases: Array<{ name: string; color: string; start: string; end: string }> = [];
  for (const agg of aggregates) {
    if (!agg.phaseName) continue;
    const last = phases[phases.length - 1];
    if (last && last.name === agg.phaseName) {
      last.end = agg.weekStart;
    } else {
      phases.push({ name: agg.phaseName, color: agg.phaseColor ?? '#94a3b8', start: agg.weekStart, end: agg.weekStart });
    }
  }

  const chartData = aggregates.map(agg => ({
    week: formatWeek(agg.weekStart),
    planned: agg.plannedReps,
    performed: agg.performedReps,
    compliance: agg.complianceReps,
    plannedTonnage: agg.plannedTonnage,
    performedTonnage: agg.performedTonnage,
  }));

  return (
    <div className="space-y-4">
      {/* Macro phase bar */}
      {phases.length > 0 && (
        <div className="flex h-6 rounded overflow-hidden gap-px">
          {phases.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-center text-[10px] text-white font-medium overflow-hidden"
              style={{ backgroundColor: p.color, flex: 1 }}
            >
              {p.name}
            </div>
          ))}
        </div>
      )}

      {/* Summary metrics */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Planned reps', value: totalPlannedReps.toLocaleString() },
          { label: 'Performed reps', value: totalPerformedReps.toLocaleString() },
          { label: 'Planned tonnage', value: `${Math.round(totalPlannedTonnage).toLocaleString()} kg` },
          { label: 'Performed tonnage', value: `${Math.round(totalPerformedTonnage).toLocaleString()} kg` },
          { label: 'Avg compliance', value: `${Math.round(avgCompliance)}%`, color: complianceColor(avgCompliance) },
        ].map((m, i) => (
          <div key={i} className="bg-gray-50 rounded-lg py-2 px-4 border border-gray-100">
            <div className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-1">{m.label}</div>
            <div className="text-lg font-medium" style={{ color: m.color ?? '#111827' }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <div key={i} className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-[13px] text-blue-700">
              {insight}
            </div>
          ))}
        </div>
      )}

      {/* Reps chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-3">Reps: planned vs performed</h3>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} unit="%" />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="planned" name="Planned reps" fill="#e5e7eb" radius={[4, 4, 0, 0]} maxBarSize={30} />
            <Bar yAxisId="left" dataKey="performed" name="Performed reps" fill="#378ADD" radius={[4, 4, 0, 0]} maxBarSize={30} />
            <Line yAxisId="right" type="monotone" dataKey="compliance" name="Compliance %" stroke="#EF9F27" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Tonnage chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-3">Tonnage: planned vs performed</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit=" kg" width={56} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="plannedTonnage" name="Planned tonnage" stroke="#e5e7eb" fill="#f3f4f6" strokeDasharray="4 2" strokeWidth={2} />
            <Area type="monotone" dataKey="performedTonnage" name="Performed tonnage" stroke="#378ADD" fill="#eff6ff" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly breakdown table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-2 px-3 text-gray-400 font-medium">Week</th>
              <th className="text-left py-2 px-3 text-gray-400 font-medium">Phase</th>
              <th className="text-right py-2 px-3 text-gray-400 font-medium">Planned reps</th>
              <th className="text-right py-2 px-3 text-gray-400 font-medium">Performed</th>
              <th className="text-right py-2 px-3 text-gray-400 font-medium min-w-[100px]">Compliance</th>
              <th className="text-right py-2 px-3 text-gray-400 font-medium">Tonnage gap</th>
              <th className="text-right py-2 px-3 text-gray-400 font-medium">Skipped</th>
            </tr>
          </thead>
          <tbody>
            {aggregates.map((agg, i) => {
              const compliance = agg.complianceReps;
              const tonnageGap = agg.performedTonnage - agg.plannedTonnage;
              const color = complianceColor(compliance);
              return (
                <tr key={agg.weekStart} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-2 px-3 text-gray-700 font-medium">{formatWeek(agg.weekStart)}</td>
                  <td className="py-2 px-3">
                    {agg.phaseName ? (
                      <span
                        className="px-2 py-0.5 rounded-full text-[11px] font-medium text-white"
                        style={{ backgroundColor: agg.phaseColor ?? '#94a3b8' }}
                      >
                        {agg.phaseName}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-600">{agg.plannedReps}</td>
                  <td className="py-2 px-3 text-right text-gray-700 font-medium">{agg.performedReps}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${Math.min(compliance, 100)}%`, backgroundColor: color }} />
                      </div>
                      <span className="font-medium" style={{ color }}>{compliance}%</span>
                    </div>
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${tonnageGap >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {tonnageGap >= 0 ? '+' : ''}{Math.round(tonnageGap)} kg
                  </td>
                  <td className="py-2 px-3 text-right text-gray-400">{agg.skippedExercises || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
