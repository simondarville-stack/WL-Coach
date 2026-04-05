import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { parsePrescription } from '../../lib/prescriptionParser';

interface SollTarget {
  reps: number | null;
  hi: number | null;
  hiReps: number | null;
  hiSets: number | null;
  avg: number | null;
}

interface PrescriptionChartProps {
  prescriptionRaw: string | null | undefined;
  unit: string | null | undefined;
  sollTarget?: SollTarget | null;
}

interface SetPoint {
  label: string;
  load: number;
  reps: number;
}

export function PrescriptionChart({ prescriptionRaw, unit, sollTarget }: PrescriptionChartProps) {
  if (!prescriptionRaw || unit === 'free_text' || unit === 'free_text_reps' || unit === 'percentage') {
    return null;
  }

  const lines = parsePrescription(prescriptionRaw);
  if (lines.length === 0) return null;

  // Expand each set line into individual set points
  const points: SetPoint[] = [];
  for (const line of lines) {
    for (let s = 0; s < line.sets; s++) {
      points.push({
        label: `S${points.length + 1}`,
        load: line.load,
        reps: line.reps,
      });
    }
  }
  if (points.length === 0) return null;

  // Y axis domain: give headroom above highest load and show macro targets
  const allLoads = points.map(p => p.load);
  if (sollTarget?.hi) allLoads.push(sollTarget.hi);
  if (sollTarget?.avg) allLoads.push(sollTarget.avg);
  const minLoad = Math.max(0, Math.min(...allLoads) - 5);
  const maxLoad = Math.max(...allLoads) + 10;

  // Color bars by position: lightest = first set, darkest = last
  const baseColor = '#3b82f6';

  return (
    <div className="mb-3">
      {/* Legend for macro lines */}
      {sollTarget && (sollTarget.hi || sollTarget.avg) && (
        <div className="flex items-center gap-3 mb-1.5 text-[10px] text-gray-500">
          {sollTarget.hi && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 border-t-2 border-dashed border-orange-400" />
              SOLL Hi {sollTarget.hi} kg
            </span>
          )}
          {sollTarget.avg && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 border-t-2 border-dashed border-gray-400" />
              SOLL Avg {sollTarget.avg} kg
            </span>
          )}
        </div>
      )}

      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#e5e7eb"
            tickLine={false}
          />
          <YAxis
            domain={[minLoad, maxLoad]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            stroke="#e5e7eb"
            tickLine={false}
            width={34}
            tickFormatter={v => `${v}`}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, padding: '4px 8px' }}
            cursor={{ fill: 'rgba(59,130,246,0.06)' }}
            formatter={(value: number, _name: string, entry: { payload?: SetPoint }) => [
              `${value} kg × ${entry.payload?.reps ?? '?'} reps`,
              'Load',
            ]}
          />

          {/* SOLL reference lines */}
          {sollTarget?.hi != null && (
            <ReferenceLine
              y={sollTarget.hi}
              stroke="#fb923c"
              strokeDasharray="5 3"
              strokeWidth={1.5}
            />
          )}
          {sollTarget?.avg != null && (
            <ReferenceLine
              y={sollTarget.avg}
              stroke="#9ca3af"
              strokeDasharray="5 3"
              strokeWidth={1.5}
            />
          )}

          <Bar dataKey="load" radius={[3, 3, 0, 0]} maxBarSize={32}>
            {points.map((_, i) => (
              <Cell
                key={i}
                fill={baseColor}
                fillOpacity={0.55 + (i / Math.max(points.length - 1, 1)) * 0.45}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
