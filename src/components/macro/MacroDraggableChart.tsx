import { useState, useRef, useCallback, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import type { MacroWeek, MacroPhase, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget } from '../../lib/database.types';
import type { MacroActuals, MacroActualsMap } from '../../hooks/useMacroCycles';
import { formatDateShort } from '../../lib/dateUtils';

type ChartMetric = 'reps' | 'hi' | 'ave';

interface ChartPoint {
  weekNum: number;
  weekLabel: string;
  weekId: string;
  [key: string]: number | string | null;
}

interface MacroDraggableChartProps {
  metric: ChartMetric;
  label: string;
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  competitions: MacroCompetition[];
  actuals: MacroActualsMap;
  onDragTarget: (weekId: string, trackedExId: string, field: keyof MacroTarget, value: number) => Promise<void>;
  linkedExerciseIds: Set<string>;
  onToggleLink: (trackedExId: string) => void;
}

const METRIC_FIELD: Record<ChartMetric, keyof MacroTarget> = {
  reps: 'target_reps',
  hi: 'target_hi',
  ave: 'target_ave',
};

const ACTUAL_KEY: Record<ChartMetric, keyof MacroActuals> = {
  reps: 'totalReps',
  hi: 'hiWeight',
  ave: 'avgWeight',
};

const CHART_INNER_HEIGHT = 160;

interface DraggableDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ChartPoint;
  dataKey: string;
  trackedExId: string;
  weekId: string;
  field: keyof MacroTarget;
  color: string;
  isLinked: boolean;
  yMin: number;
  yMax: number;
  containerRef: React.RefObject<SVGElement | null>;
  onDrag: (weekId: string, trackedExId: string, value: number) => void;
  onDragEnd: (weekId: string, trackedExId: string, value: number) => void;
}

function DraggableDot({
  cx = 0, cy = 0, payload, dataKey, trackedExId, weekId, field,
  color, isLinked, yMin, yMax, containerRef, onDrag, onDragEnd,
}: DraggableDotProps) {
  const dragging = useRef(false);
  const startClientY = useRef(0);
  const startValue = useRef(0);
  const rafId = useRef<number | null>(null);

  const getChartHeight = () => {
    if (!containerRef.current) return CHART_INNER_HEIGHT;
    return containerRef.current.getBoundingClientRect().height - 30; // subtract axes
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    startClientY.current = e.clientY;
    startValue.current = (payload?.[dataKey] as number) ?? 0;

    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dy = ev.clientY - startClientY.current;
      const range = yMax - yMin;
      const height = getChartHeight();
      const valueDelta = -(dy / height) * range;
      const newValue = Math.max(0, Math.round(startValue.current + valueDelta));

      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => onDrag(weekId, trackedExId, newValue));
    };

    const up = (ev: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
      const dy = ev.clientY - startClientY.current;
      const range = yMax - yMin;
      const height = getChartHeight();
      const valueDelta = -(dy / height) * range;
      const finalValue = Math.max(0, Math.round(startValue.current + valueDelta));
      onDragEnd(weekId, trackedExId, finalValue);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cy, yMin, yMax, weekId, trackedExId, payload, dataKey, onDrag, onDragEnd]);

  return (
    <circle
      cx={cx}
      cy={cy}
      r={isLinked ? 6 : 4}
      fill={color}
      stroke={isLinked ? '#1d4ed8' : 'white'}
      strokeWidth={isLinked ? 2 : 1}
      style={{ cursor: 'ns-resize', userSelect: 'none' }}
      onMouseDown={handleMouseDown}
    />
  );
}

export function MacroDraggableChart({
  metric,
  label,
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  competitions,
  actuals,
  onDragTarget,
  linkedExerciseIds,
  onToggleLink,
}: MacroDraggableChartProps) {
  // weekId+teId → optimistic override value during drag
  const [dragOverrides, setDragOverrides] = useState<Record<string, number>>({});
  const svgRef = useRef<SVGElement | null>(null);

  const field = METRIC_FIELD[metric];
  const actualKey = ACTUAL_KEY[metric];

  const getDragKey = (weekId: string, teId: string) => `${weekId}:${teId}`;

  const handleDrag = useCallback((weekId: string, trackedExId: string, value: number) => {
    setDragOverrides(prev => ({ ...prev, [getDragKey(weekId, trackedExId)]: value }));
  }, []);

  const handleDragEnd = useCallback(async (weekId: string, trackedExId: string, value: number) => {
    const targets = linkedExerciseIds.has(trackedExId)
      ? trackedExercises.filter(te => linkedExerciseIds.has(te.id))
      : trackedExercises.filter(te => te.id === trackedExId);

    await Promise.all(targets.map(te => onDragTarget(weekId, te.id, field, value)));

    setDragOverrides(prev => {
      const next = { ...prev };
      targets.forEach(te => delete next[getDragKey(weekId, te.id)]);
      return next;
    });
  }, [onDragTarget, field, linkedExerciseIds, trackedExercises]);

  const chartData: ChartPoint[] = useMemo(() => macroWeeks.map(week => {
    const point: ChartPoint = {
      weekNum: week.week_number,
      weekLabel: formatDateShort(week.week_start),
      weekId: week.id,
    };
    trackedExercises.forEach(te => {
      const target = targets.find(t => t.macro_week_id === week.id && t.tracked_exercise_id === te.id);
      const dragKey = getDragKey(week.id, te.id);
      const targetVal = dragKey in dragOverrides
        ? dragOverrides[dragKey]
        : (target?.[field] as number | null ?? null);
      point[`target_${te.id}`] = targetVal;

      const exActuals = actuals[week.id]?.[te.exercise_id];
      point[`actual_${te.id}`] = exActuals ? (exActuals[actualKey] as number) : null;
    });
    return point;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [macroWeeks, trackedExercises, targets, actuals, field, actualKey, dragOverrides]);

  const allValues = chartData.flatMap(p =>
    trackedExercises.flatMap(te => [
      p[`target_${te.id}`] as number | null,
      p[`actual_${te.id}`] as number | null,
    ])
  ).filter((v): v is number => v !== null && v > 0);

  const yMax = allValues.length > 0 ? Math.ceil(Math.max(...allValues) * 1.2 / 10) * 10 : 100;

  // Map competition date → week number
  const compMarkers = competitions.map(comp => {
    const week = macroWeeks.find(w => {
      const wStart = new Date(w.week_start).getTime();
      const compDate = new Date(comp.competition_date).getTime();
      return compDate >= wStart && compDate <= wStart + 6 * 86400000;
    });
    return week ? { weekNum: week.week_number, name: comp.name, isPrimary: comp.is_primary } : null;
  }).filter(Boolean) as { weekNum: number; name: string; isPrimary: boolean }[];

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <div className="flex items-center gap-1 flex-wrap">
          {trackedExercises.map(te => (
            <button
              key={te.id}
              onClick={() => onToggleLink(te.id)}
              title={linkedExerciseIds.has(te.id) ? 'Click to unlink' : 'Click to link (move together)'}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                linkedExerciseIds.has(te.id)
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: te.exercise.color }} />
              {te.exercise.exercise_code || te.exercise.name}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={CHART_INNER_HEIGHT + 30}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
          ref={(r: { container?: SVGElement } | null) => {
            if (r?.container) svgRef.current = r.container as unknown as SVGElement;
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="weekNum"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{ fontSize: 10, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4 }}
            labelFormatter={wk => `Week ${wk}`}
            formatter={(value: number, name: string) => [value || '—', name]}
          />

          {/* Competition reference lines */}
          {compMarkers.map((cw, i) => (
            <ReferenceLine
              key={`comp_${i}`}
              x={cw.weekNum}
              stroke={cw.isPrimary ? '#dc2626' : '#f59e0b'}
              strokeDasharray="3 2"
              strokeWidth={1.5}
              label={{ value: cw.name, position: 'insideTopRight', fontSize: 8, fill: cw.isPrimary ? '#dc2626' : '#f59e0b' }}
            />
          ))}

          {/* Phase start markers */}
          {phases.map(phase => (
            <ReferenceLine
              key={`phase_${phase.id}`}
              x={phase.start_week_number}
              stroke={phase.color || '#d1d5db'}
              strokeWidth={6}
              strokeOpacity={0.5}
              label={{ value: phase.name, position: 'insideTopLeft', fontSize: 8, fill: '#6b7280', offset: 2 }}
            />
          ))}

          {/* Actual lines (dashed, non-draggable) */}
          {trackedExercises.map(te => (
            <Line
              key={`actual_${te.id}`}
              type="monotone"
              dataKey={`actual_${te.id}`}
              name={`${te.exercise.exercise_code || te.exercise.name} actual`}
              stroke={te.exercise.color}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              strokeOpacity={0.7}
              dot={{ r: 2, fill: te.exercise.color, strokeWidth: 0 }}
              activeDot={false}
              connectNulls
            />
          ))}

          {/* Target lines with draggable dots */}
          {trackedExercises.map(te => (
            <Line
              key={`target_${te.id}`}
              type="monotone"
              dataKey={`target_${te.id}`}
              name={`${te.exercise.exercise_code || te.exercise.name} target`}
              stroke={te.exercise.color}
              strokeWidth={2}
              dot={(dotProps) => {
                const week = macroWeeks[dotProps.index ?? 0];
                if (!week) return <g key={`dot_${te.id}_${dotProps.index}`} />;
                return (
                  <DraggableDot
                    key={`dot_${te.id}_${week.id}`}
                    cx={dotProps.cx}
                    cy={dotProps.cy}
                    payload={dotProps.payload}
                    dataKey={`target_${te.id}`}
                    trackedExId={te.id}
                    weekId={week.id}
                    field={field}
                    color={te.exercise.color}
                    isLinked={linkedExerciseIds.has(te.id)}
                    yMin={0}
                    yMax={yMax}
                    containerRef={svgRef}
                    onDrag={handleDrag}
                    onDragEnd={handleDragEnd}
                  />
                );
              }}
              activeDot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
