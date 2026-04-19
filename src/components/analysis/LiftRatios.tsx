import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchLiftRatios, type LiftRatio } from '../../hooks/useAnalysis';
import { supabase } from '../../lib/supabase';
import { useExerciseStore } from '../../store/exerciseStore';

interface Props {
  athleteId: string;
  startDate: string;
  endDate: string;
}

function generateInsights(ratios: LiftRatio[]): string[] {
  const insights: string[] = [];
  const find = (name: string) => ratios.find(r => r.name === name);

  const snCj = find('Snatch / C&J');
  const snBsq = find('Snatch / Back squat');
  const fsBsq = find('Front squat / Back squat');
  const cjBsq = find('C&J / Back squat');

  if (snBsq && snBsq.value < snBsq.targetMin) {
    insights.push('Snatch efficiency is below target — consider more overhead strength and receiving position work.');
  }
  if (fsBsq && fsBsq.value > fsBsq.targetMax) {
    insights.push('Front squat is close to back squat strength — posterior chain may be underdeveloped.');
  }
  if (snCj && snCj.value > snCj.targetMax) {
    insights.push('Snatch-to-C&J ratio is high — there is potential for more C&J gains.');
  }
  if (cjBsq && cjBsq.value < cjBsq.targetMin) {
    insights.push('C&J-to-back-squat ratio is low — strength base may need development to support competition lifts.');
  }

  return insights;
}

export function LiftRatios({ athleteId }: Props) {
  const { exercises: storeExercises, fetchExercises } = useExerciseStore();
  const [ratios, setRatios] = useState<LiftRatio[]>([]);
  const [loading, setLoading] = useState(true);
  const [prHistory, setPrHistory] = useState<Array<{ date: string; snCj: number | null }>>([]);

  useEffect(() => { fetchExercises(); }, [fetchExercises]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [ratioData, prsRes] = await Promise.all([
          fetchLiftRatios(athleteId),
          supabase
            .from('athlete_prs')
            .select('exercise_id, pr_value_kg, pr_date')
            .eq('athlete_id', athleteId)
            .order('pr_date'),
        ]);

        setRatios(ratioData);

        // Build Sn/CJ ratio history — primary: lift_slot, fallback: name heuristic
        const exList = storeExercises;
        const snEx = exList.find(e => e.lift_slot === 'snatch')
          ?? exList.find(e => e.name.toLowerCase().includes('snatch') && !e.name.toLowerCase().includes('pull') && !e.name.toLowerCase().includes('press'));
        const cjEx = exList.find(e => e.lift_slot === 'clean_and_jerk')
          ?? exList.find(e => e.name.toLowerCase().includes('clean') && e.name.toLowerCase().includes('jerk'));

        if (snEx && cjEx) {
          const prs = prsRes.data ?? [];
          // Build cumulative best by date
          type DateVal = { sn?: number; cj?: number };
          const byDate = new Map<string, DateVal>();
          for (const pr of prs) {
            if (!pr.pr_date || !pr.pr_value_kg) continue;
            const existing = byDate.get(pr.pr_date) ?? {};
            if (pr.exercise_id === snEx.id) existing.sn = Math.max(existing.sn ?? 0, pr.pr_value_kg);
            if (pr.exercise_id === cjEx.id) existing.cj = Math.max(existing.cj ?? 0, pr.pr_value_kg);
            byDate.set(pr.pr_date, existing);
          }

          let bestSn = 0, bestCj = 0;
          const history: Array<{ date: string; snCj: number | null }> = [];
          for (const [date, vals] of Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
            if (vals.sn) bestSn = Math.max(bestSn, vals.sn);
            if (vals.cj) bestCj = Math.max(bestCj, vals.cj);
            if (bestSn > 0 && bestCj > 0) {
              history.push({ date: date.slice(5), snCj: Math.round((bestSn / bestCj) * 1000) / 10 });
            }
          }
          setPrHistory(history);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [athleteId, storeExercises]);

  if (loading) return <div className="h-64 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>;

  if (!ratios.length) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
        No personal records found. PRs are tracked from training log entries.
      </div>
    );
  }

  const insights = generateInsights(ratios);

  return (
    <div className="space-y-4">
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

      {/* Ratio bars */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <h3 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-2">Lift ratios</h3>
        {ratios.map(ratio => {
          const barWidth = `${Math.min((ratio.value / 130) * 100, 100)}%`;
          const targetStart = `${(ratio.targetMin / 130) * 100}%`;
          const targetWidth = `${((ratio.targetMax - ratio.targetMin) / 130) * 100}%`;

          return (
            <div key={ratio.name} className="flex items-center gap-3">
              <div className="w-[160px] flex-shrink-0 text-[12px] text-gray-600 font-medium">{ratio.name}</div>
              <div className="flex-1 relative h-5 bg-gray-100 rounded overflow-hidden">
                {/* Target range band */}
                <div
                  className="absolute top-0 bottom-0 opacity-20 rounded"
                  style={{
                    left: targetStart,
                    width: targetWidth,
                    backgroundColor: '#1D9E75',
                  }}
                />
                {/* Actual bar */}
                <div
                  className="absolute top-0 bottom-0 left-0 rounded transition-all"
                  style={{ width: barWidth, backgroundColor: ratio.color, opacity: 0.85 }}
                />
              </div>
              <div className="w-12 text-right text-[13px] font-medium" style={{ color: ratio.color }}>
                {ratio.value}%
              </div>
              <div className="w-20 text-right text-[11px] text-gray-400">{ratio.target}</div>
            </div>
          );
        })}
      </div>

      {/* Sn/CJ trend chart */}
      {prHistory.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-3">Snatch / C&J ratio over time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={prHistory} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit="%" width={40} domain={[70, 95]} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e5e7eb' }} formatter={(v: number) => [`${v}%`, 'Sn/CJ']} />
              <Line type="monotone" dataKey="snCj" name="Sn/CJ" stroke="#378ADD" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
