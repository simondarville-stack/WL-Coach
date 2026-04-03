import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import type { MacroContext } from './WeeklyPlanner';

interface ChartPoint {
  weekNumber: number;
  label: string;
  soll_hi: number | null;
  soll_avg: number | null;
  ist_hi: number | null;
  ist_avg: number | null;
}

interface SollIstChartProps {
  exerciseId: string;
  athleteId: string;
  macroContext: MacroContext;
}

export function SollIstChart({ exerciseId, athleteId, macroContext }: SollIstChartProps) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hi' | 'avg'>('hi');

  useEffect(() => { void loadData(); }, [exerciseId, macroContext.macroId]);

  async function loadData() {
    setLoading(true);
    try {
      // 1. Find tracked exercise for this macrocycle
      const { data: te } = await supabase
        .from('macro_tracked_exercises')
        .select('id')
        .eq('macrocycle_id', macroContext.macroId)
        .eq('exercise_id', exerciseId)
        .limit(1)
        .maybeSingle();
      if (!te) { setData([]); return; }

      // 2. Load all macro weeks for this macrocycle
      const { data: macroWeeks } = await supabase
        .from('macro_weeks')
        .select('id, week_number, week_start')
        .eq('macrocycle_id', macroContext.macroId)
        .order('week_number');
      if (!macroWeeks?.length) { setData([]); return; }

      // 3. Load SOLL targets
      const { data: targets } = await supabase
        .from('macro_targets')
        .select('macro_week_id, target_hi, target_ave')
        .eq('tracked_exercise_id', te.id)
        .in('macro_week_id', macroWeeks.map(w => w.id));
      const targetMap = new Map((targets || []).map(t => [t.macro_week_id, t]));

      // 4. Load IST: find week_plans for this athlete matching week_starts
      const weekStarts = macroWeeks.map(w => w.week_start);
      const { data: weekPlans } = await supabase
        .from('week_plans')
        .select('id, week_start')
        .eq('athlete_id', athleteId)
        .in('week_start', weekStarts);
      const wpMap = new Map((weekPlans || []).map(wp => [wp.week_start, wp.id]));

      // 5. Load planned exercises for all those week plans
      const planIds = Array.from(wpMap.values());
      let istByWpId = new Map<string, { hi: number; totalLoad: number; totalReps: number }>();
      if (planIds.length > 0) {
        const { data: pes } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, summary_highest_load, summary_avg_load, summary_total_reps')
          .eq('exercise_id', exerciseId)
          .in('weekplan_id', planIds);
        for (const pe of pes || []) {
          const prev = istByWpId.get(pe.weekplan_id) || { hi: 0, totalLoad: 0, totalReps: 0 };
          istByWpId.set(pe.weekplan_id, {
            hi: Math.max(prev.hi, pe.summary_highest_load || 0),
            totalLoad: prev.totalLoad + (pe.summary_avg_load || 0) * (pe.summary_total_reps || 0),
            totalReps: prev.totalReps + (pe.summary_total_reps || 0),
          });
        }
      }

      const chartData: ChartPoint[] = macroWeeks.map(week => {
        const soll = targetMap.get(week.id);
        const planId = wpMap.get(week.week_start);
        const ist = planId ? istByWpId.get(planId) : undefined;
        return {
          weekNumber: week.week_number,
          label: `W${week.week_number}`,
          soll_hi: soll?.target_hi ?? null,
          soll_avg: soll?.target_ave ?? null,
          ist_hi: (ist && ist.hi > 0) ? ist.hi : null,
          ist_avg: (ist && ist.totalReps > 0) ? Math.round(ist.totalLoad / ist.totalReps) : null,
        };
      });
      setData(chartData);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="h-44 flex items-center justify-center text-xs text-gray-400">Loading chart…</div>;
  }
  if (!data.length) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-gray-400 italic">
        This exercise is not tracked in the macrocycle
      </div>
    );
  }

  const sollKey = view === 'hi' ? 'soll_hi' : 'soll_avg';
  const istKey  = view === 'hi' ? 'ist_hi'  : 'ist_avg';
  const allVals = data.flatMap(d => [d[sollKey as keyof ChartPoint], d[istKey as keyof ChartPoint]])
    .filter((v): v is number => typeof v === 'number');
  const minY = allVals.length > 0 ? Math.max(0, Math.min(...allVals) - 5) : 0;
  const maxY = allVals.length > 0 ? Math.max(...allVals) + 5 : 100;
  const nowLabel = `W${macroContext.weekNumber}`;

  return (
    <div className="space-y-2">
      {/* Toggle + legend */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('hi')}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${view === 'hi' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          Hi
        </button>
        <button
          onClick={() => setView('avg')}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${view === 'avg' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          Avg
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-px bg-blue-500 inline-block" style={{ height: 2 }} />
            SOLL
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-px bg-green-500 inline-block" style={{ height: 2 }} />
            IST
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
          <YAxis domain={[minY, maxY]} tick={{ fontSize: 10 }} stroke="#9ca3af" width={32} />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(value: number, name: string) => [
              `${value} kg`,
              name.includes('soll') ? 'SOLL' : 'IST',
            ]}
          />
          <ReferenceLine
            x={nowLabel}
            stroke="#f97316"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            label={{ value: 'Now', position: 'top', fontSize: 9, fill: '#f97316' }}
          />
          <Line
            type="monotone"
            dataKey={sollKey}
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, fill: '#3b82f6' }}
            connectNulls
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey={istKey}
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3, fill: '#10b981' }}
            connectNulls
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
