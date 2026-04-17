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
  soll_max: number | null;
  soll_avg: number | null;
  ist_max: number | null;
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
  const [view, setView] = useState<'max' | 'avg'>('max');

  useEffect(() => { void loadData(); }, [exerciseId, macroContext.macroId]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: te } = await supabase
        .from('macro_tracked_exercises')
        .select('id')
        .eq('macrocycle_id', macroContext.macroId)
        .eq('exercise_id', exerciseId)
        .limit(1)
        .maybeSingle();
      if (!te) { setData([]); return; }

      const { data: macroWeeks } = await supabase
        .from('macro_weeks')
        .select('id, week_number, week_start')
        .eq('macrocycle_id', macroContext.macroId)
        .order('week_number');
      if (!macroWeeks?.length) { setData([]); return; }

      const { data: targets } = await supabase
        .from('macro_targets')
        .select('macro_week_id, target_max, target_avg')
        .eq('tracked_exercise_id', te.id)
        .in('macro_week_id', macroWeeks.map(w => w.id));
      const targetMap = new Map((targets || []).map(t => [t.macro_week_id, t]));

      const weekStarts = macroWeeks.map(w => w.week_start);
      const { data: weekPlans } = await supabase
        .from('week_plans')
        .select('id, week_start')
        .eq('athlete_id', athleteId)
        .in('week_start', weekStarts);
      const wpMap = new Map((weekPlans || []).map(wp => [wp.week_start, wp.id]));

      const planIds = Array.from(wpMap.values());
      let istByWpId = new Map<string, { max: number; totalLoad: number; totalReps: number }>();
      if (planIds.length > 0) {
        const { data: pes } = await supabase
          .from('planned_exercises')
          .select('weekplan_id, summary_highest_load, summary_avg_load, summary_total_reps')
          .eq('exercise_id', exerciseId)
          .in('weekplan_id', planIds);
        for (const pe of pes || []) {
          const prev = istByWpId.get(pe.weekplan_id) || { max: 0, totalLoad: 0, totalReps: 0 };
          istByWpId.set(pe.weekplan_id, {
            max: Math.max(prev.max, pe.summary_highest_load || 0),
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
          soll_max: soll?.target_max ?? null,
          soll_avg: soll?.target_avg ?? null,
          ist_max: (ist && ist.max > 0) ? ist.max : null,
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
    return (
      <div style={{ height: 176, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
        Loading chart…
      </div>
    );
  }
  if (!data.length) {
    return (
      <div style={{ height: 176, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
        This exercise is not tracked in the macrocycle
      </div>
    );
  }

  const sollKey = view === 'max' ? 'soll_max' : 'soll_avg';
  const istKey  = view === 'max' ? 'ist_max'  : 'ist_avg';
  const allVals = data.flatMap(d => [d[sollKey as keyof ChartPoint], d[istKey as keyof ChartPoint]])
    .filter((v): v is number => typeof v === 'number');
  const minY = allVals.length > 0 ? Math.max(0, Math.min(...allVals) - 5) : 0;
  const maxY = allVals.length > 0 ? Math.max(...allVals) + 5 : 100;
  const nowLabel = `W${macroContext.weekNumber}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Toggle + legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {(['max', 'avg'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              fontSize: 12, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              border: 'none', cursor: 'pointer',
              background: view === v ? 'var(--color-accent-muted)' : 'transparent',
              color: view === v ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              fontWeight: view === v ? 500 : 400,
            }}
          >
            {v === 'max' ? 'Hi' : 'Avg'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 12, height: 2, backgroundColor: '#3b82f6' }} />
            SOLL
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 12, height: 2, backgroundColor: '#10b981' }} />
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
          <Line type="monotone" dataKey={sollKey} stroke="#3b82f6" strokeWidth={2}
            dot={{ r: 3, fill: '#3b82f6' }} connectNulls activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey={istKey} stroke="#10b981" strokeWidth={2}
            dot={{ r: 3, fill: '#10b981' }} connectNulls activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
