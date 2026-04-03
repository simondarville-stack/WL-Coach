import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// recharts is in package.json as a dependency (^3.7.0)
let BarChart: React.ComponentType<any> | null = null;
let Bar: React.ComponentType<any> | null = null;
let XAxis: React.ComponentType<any> | null = null;
let YAxis: React.ComponentType<any> | null = null;
let CartesianGrid: React.ComponentType<any> | null = null;
let Tooltip: React.ComponentType<any> | null = null;
let ResponsiveContainer: React.ComponentType<any> | null = null;

try {
  const recharts = await import('recharts').catch(() => null);
  if (recharts) {
    BarChart = recharts.BarChart;
    Bar = recharts.Bar;
    XAxis = recharts.XAxis;
    YAxis = recharts.YAxis;
    CartesianGrid = recharts.CartesianGrid;
    Tooltip = recharts.Tooltip;
    ResponsiveContainer = recharts.ResponsiveContainer;
  }
} catch {
  // recharts not available
}

interface ComplianceChartProps {
  athleteId: string;
  weeks?: number;
}

interface WeekCompliance {
  label: string;
  compliance: number;
  completed: number;
  planned: number;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function ComplianceChart({ athleteId, weeks = 4 }: ComplianceChartProps) {
  const [data, setData] = useState<WeekCompliance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Build week buckets for the last N weeks
      const today = new Date();
      const weekBuckets: { start: Date; end: Date; label: string }[] = [];

      for (let i = weeks - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i * 7);
        const ws = getMondayOfWeek(d);
        const we = new Date(ws);
        we.setDate(we.getDate() + 7);
        const weekNum = weeks - i;
        weekBuckets.push({
          start: ws,
          end: we,
          label: `W${weekNum}`,
        });
      }

      const since = weekBuckets[0].start.toISOString().split('T')[0];

      // Fetch sessions in range
      const { data: sessions } = await supabase
        .from('training_log_sessions')
        .select('id, date, status')
        .eq('athlete_id', athleteId)
        .gte('date', since);

      const sessionIds = (sessions || []).map(s => s.id);

      // Fetch sets for all sessions
      let allSets: Array<{ session_id?: string; status: string; log_exercise_id: string }> = [];
      if (sessionIds.length > 0) {
        const { data: exercises } = await supabase
          .from('training_log_exercises')
          .select('id, session_id')
          .in('session_id', sessionIds);

        const exerciseIds = (exercises || []).map(e => e.id);

        if (exerciseIds.length > 0) {
          const { data: sets } = await supabase
            .from('training_log_sets')
            .select('log_exercise_id, status')
            .in('log_exercise_id', exerciseIds);

          // Map sets back to session_id via exercises
          const exMap = new Map((exercises || []).map(e => [e.id, e.session_id]));
          allSets = (sets || []).map(s => ({
            ...s,
            session_id: exMap.get(s.log_exercise_id),
          }));
        }
      }

      const sessMap = new Map((sessions || []).map(s => [s.id, s.date]));

      const weekData: WeekCompliance[] = weekBuckets.map(bucket => {
        const wsISO = bucket.start.toISOString().split('T')[0];
        const weISO = bucket.end.toISOString().split('T')[0];

        const weekSessionIds = (sessions || [])
          .filter(s => s.date >= wsISO && s.date < weISO)
          .map(s => s.id);

        const weekSets = allSets.filter(s => weekSessionIds.includes(s.session_id ?? ''));
        const planned = weekSets.length;
        const completed = weekSets.filter(s => s.status === 'completed').length;
        const compliance = planned > 0 ? Math.round((completed / planned) * 100) : 0;

        return { label: bucket.label, compliance, completed, planned };
      });

      setData(weekData);
      setLoading(false);
    };
    load();
  }, [athleteId, weeks]);

  if (loading) {
    return <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />;
  }

  // Fallback if recharts not available
  if (!BarChart || !Bar || !XAxis || !YAxis || !CartesianGrid || !Tooltip || !ResponsiveContainer) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-700 mb-3">Compliance (last {weeks} weeks)</div>
        <div className="flex items-end gap-2 h-24">
          {data.map(d => (
            <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-blue-500 rounded-t"
                style={{ height: `${Math.max(4, d.compliance)}%` }}
              />
              <div className="text-[10px] text-gray-500">{d.label}</div>
              <div className="text-[10px] text-gray-400">{d.compliance}%</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const RC = ResponsiveContainer as React.ComponentType<any>;
  const BC = BarChart as React.ComponentType<any>;
  const B = Bar as React.ComponentType<any>;
  const XA = XAxis as React.ComponentType<any>;
  const YA = YAxis as React.ComponentType<any>;
  const CG = CartesianGrid as React.ComponentType<any>;
  const TT = Tooltip as React.ComponentType<any>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-medium text-gray-700 mb-3">Compliance (last {weeks} weeks)</div>
      <RC width="100%" height={160}>
        <BC data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CG strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XA dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YA domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit="%" />
          <TT
            formatter={(value: number, name: string) => [`${value}%`, 'Compliance']}
            contentStyle={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
          <B dataKey="compliance" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BC>
      </RC>
    </div>
  );
}
