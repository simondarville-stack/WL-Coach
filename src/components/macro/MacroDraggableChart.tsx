import { useState, useRef, useCallback, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import type { MacroWeek, MacroPhase, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget } from '../../lib/database.types';
import type { MacroActuals, MacroActualsMap } from '../../hooks/useMacroCycles';
import { formatDateShort } from '../../lib/dateUtils';

export type ChartMetric = 'reps' | 'hi' | 'ave';

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

const METRIC_LABEL: Record<ChartMetric, string> = {
  reps: 'Reps',
  hi: 'Hi (kg)',
  ave: 'Ave (kg)',
};

interface DragState {
  weekId: string;
  trackedExId: string;
  metric: ChartMetric;
  startClientY: number;
  startValue: number;
  linkedMetric: ChartMetric | null; // only set when Ctrl is held
  linkedStartValue: number;
  currentValue: number;
  currentLinkedValue: number;
  // screen position for tooltip
  clientX: number;
  clientY: number;
}

interface MacroDraggableChartProps {
  metrics: ChartMetric[]; // ['reps'] or ['hi', 'ave']
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
  focusedExerciseId?: string | null;
}

const CHART_HEIGHT = 200;

// Darken a hex color slightly for the secondary metric (ave)
function withOpacity(color: string, opacity: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function MacroDraggableChart({
  metrics,
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
  focusedExerciseId,
}: MacroDraggableChartProps) {
  const [dragOverrides, setDragOverrides] = useState<Record<string, number>>({});
  const [activeDrag, setActiveDrag] = useState<DragState | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const getKey = (weekId: string, teId: string, metric: ChartMetric) => `${weekId}:${teId}:${metric}`;

  const getTargetValue = useCallback((weekId: string, teId: string, metric: ChartMetric): number => {
    const k = getKey(weekId, teId, metric);
    if (k in dragOverrides) return dragOverrides[k];
    const field = METRIC_FIELD[metric];
    const t = targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === teId);
    return (t?.[field] as number | null) ?? 0;
  }, [dragOverrides, targets]);

  const getChartHeightPx = () => {
    return chartRef.current ? chartRef.current.getBoundingClientRect().height - 40 : CHART_HEIGHT - 40;
  };

  const startDrag = useCallback((
    e: React.MouseEvent,
    weekId: string,
    trackedExId: string,
    metric: ChartMetric,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startValue = getTargetValue(weekId, trackedExId, metric);
    const ctrlHeld = e.ctrlKey || e.metaKey;
    const linkedMetric = ctrlHeld && metrics.length > 1
      ? metrics.find(m => m !== metric) ?? null
      : null;
    const linkedStartValue = linkedMetric ? getTargetValue(weekId, trackedExId, linkedMetric) : 0;

    const drag: DragState = {
      weekId, trackedExId, metric,
      startClientY: e.clientY,
      startValue,
      linkedMetric,
      linkedStartValue,
      currentValue: startValue,
      currentLinkedValue: linkedStartValue,
      clientX: e.clientX,
      clientY: e.clientY,
    };
    setActiveDrag(drag);

    const allValues = metrics.flatMap(m => macroWeeks.map(w => getTargetValue(w.id, trackedExId, m))).filter(v => v > 0);
    const yMax = allValues.length > 0 ? Math.ceil(Math.max(...allValues) * 1.3 / 10) * 10 : 200;
    const heightPx = getChartHeightPx();

    const rafId = { current: 0 };

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - drag.startClientY;
      const delta = -(dy / heightPx) * yMax;
      const newVal = Math.max(0, Math.round(drag.startValue + delta));
      const newLinked = linkedMetric ? Math.max(0, Math.round(drag.linkedStartValue + delta)) : 0;

      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        setDragOverrides(prev => {
          const next = { ...prev };
          next[getKey(weekId, trackedExId, metric)] = newVal;
          if (linkedMetric) next[getKey(weekId, trackedExId, linkedMetric)] = newLinked;
          return next;
        });
        setActiveDrag(prev => prev ? {
          ...prev,
          currentValue: newVal,
          currentLinkedValue: newLinked,
          clientX: ev.clientX,
          clientY: ev.clientY,
        } : null);
      });
    };

    const onUp = async (ev: MouseEvent) => {
      cancelAnimationFrame(rafId.current);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const dy = ev.clientY - drag.startClientY;
      const delta = -(dy / heightPx) * yMax;
      const finalVal = Math.max(0, Math.round(drag.startValue + delta));
      const finalLinked = linkedMetric ? Math.max(0, Math.round(drag.linkedStartValue + delta)) : 0;

      // If cross-exercise linked, apply to all linked exercises
      const exercisesToUpdate = linkedExerciseIds.has(trackedExId) && linkedExerciseIds.size > 1
        ? trackedExercises.filter(te => linkedExerciseIds.has(te.id))
        : [trackedExercises.find(te => te.id === trackedExId)!];

      await Promise.all(
        exercisesToUpdate.flatMap(te => {
          const updates: Promise<void>[] = [onDragTarget(weekId, te.id, METRIC_FIELD[metric], finalVal)];
          if (linkedMetric) updates.push(onDragTarget(weekId, te.id, METRIC_FIELD[linkedMetric], finalLinked));
          return updates;
        })
      );

      setDragOverrides(prev => {
        const next = { ...prev };
        delete next[getKey(weekId, trackedExId, metric)];
        if (linkedMetric) delete next[getKey(weekId, trackedExId, linkedMetric)];
        return next;
      });
      setActiveDrag(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [getTargetValue, metrics, macroWeeks, onDragTarget, linkedExerciseIds, trackedExercises]);

  const chartData = useMemo(() => macroWeeks.map(week => {
    const point: Record<string, number | string | null> = {
      weekNum: week.week_number,
      weekLabel: formatDateShort(week.week_start),
      weekId: week.id,
    };
    trackedExercises.forEach(te => {
      metrics.forEach(metric => {
        const k = getKey(week.id, te.id, metric);
        const field = METRIC_FIELD[metric];
        const t = targets.find(t => t.macro_week_id === week.id && t.tracked_exercise_id === te.id);
        const overrideVal = k in dragOverrides ? dragOverrides[k] : undefined;
        point[`t_${metric}_${te.id}`] = overrideVal !== undefined ? overrideVal : ((t?.[field] as number | null) ?? null);

        const exActuals = actuals[week.id]?.[te.exercise_id];
        const actualKey = ACTUAL_KEY[metric];
        point[`a_${metric}_${te.id}`] = exActuals ? (exActuals[actualKey] as number) : null;
      });
    });
    return point;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [macroWeeks, trackedExercises, targets, actuals, metrics, dragOverrides]);

  const allTargetValues = chartData.flatMap(p =>
    trackedExercises.flatMap(te => metrics.map(m => p[`t_${m}_${te.id}`] as number | null))
  ).filter((v): v is number => v !== null && v > 0);
  const yMax = allTargetValues.length > 0 ? Math.ceil(Math.max(...allTargetValues) * 1.2 / 10) * 10 : 100;

  const compMarkers = competitions.map(comp => {
    const week = macroWeeks.find(w => {
      const wStart = new Date(w.week_start).getTime();
      const cd = new Date(comp.competition_date).getTime();
      return cd >= wStart && cd <= wStart + 6 * 86400000;
    });
    return week ? { weekNum: week.week_number, name: comp.competition_name, isPrimary: comp.is_primary } : null;
  }).filter(Boolean) as { weekNum: number; name: string; isPrimary: boolean }[];

  // Custom dot renderer — returns a draggable dot for target lines
  const makeDot = (trackedExId: string, metric: ChartMetric, color: string) =>
    (props: { cx?: number; cy?: number; index?: number; payload?: Record<string, unknown> }) => {
      const { cx = 0, cy = 0, index = 0 } = props;
      const week = macroWeeks[index];
      if (!week) return <g key={`d_${trackedExId}_${metric}_${index}`} />;
      const isActive = activeDrag?.weekId === week.id && activeDrag?.trackedExId === trackedExId && activeDrag?.metric === metric;
      const isLinked = linkedExerciseIds.has(trackedExId);
      const isFocused = focusedExerciseId === trackedExId;
      const r = isActive ? 7 : isFocused ? 6 : 4;
      return (
        <circle
          key={`d_${trackedExId}_${metric}_${week.id}`}
          cx={cx}
          cy={cy}
          r={r}
          fill={color}
          stroke={isLinked ? '#1d4ed8' : isActive ? 'white' : 'white'}
          strokeWidth={isLinked || isActive ? 2 : 1}
          style={{ cursor: 'ns-resize', userSelect: 'none' }}
          onMouseDown={e => startDrag(e as unknown as React.MouseEvent, week.id, trackedExId, metric)}
        />
      );
    };

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <div className="flex items-center gap-1 flex-wrap">
          {trackedExercises.map(te => {
            const isLinked = linkedExerciseIds.has(te.id);
            const isFocused = focusedExerciseId === te.id;
            return (
              <button
                key={te.id}
                onClick={() => onToggleLink(te.id)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                  isFocused
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : isLinked
                    ? 'border-blue-300 bg-blue-50 text-blue-600'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
                title="Click to link (cross-exercise drag)"
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: te.exercise.color }} />
                {te.exercise.exercise_code || te.exercise.name}
              </button>
            );
          })}
          {metrics.length > 1 && (
            <span className="text-[9px] text-gray-400 ml-1 border border-dashed border-gray-300 px-1.5 py-0.5 rounded">
              Hold Ctrl while dragging to move Hi+Ave together
            </span>
          )}
        </div>
      </div>

      {/* Legend for combined chart */}
      {metrics.length > 1 && (
        <div className="flex items-center gap-4 px-3 py-1 border-b border-gray-100 bg-gray-50/50">
          {trackedExercises.map(te => (
            <div key={te.id} className="flex items-center gap-2 text-[10px] text-gray-600">
              <span className="font-medium" style={{ color: te.exercise.color }}>
                {te.exercise.exercise_code || te.exercise.name}:
              </span>
              <span className="flex items-center gap-1">
                <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke={te.exercise.color} strokeWidth="2"/></svg>
                Hi
              </span>
              <span className="flex items-center gap-1">
                <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke={withOpacity(te.exercise.color, 0.55)} strokeWidth="2" strokeDasharray="4 2"/></svg>
                Ave
              </span>
            </div>
          ))}
          <span className="text-[9px] text-gray-400 ml-auto">dashed = actual</span>
        </div>
      )}

      {/* Chart */}
      <div ref={chartRef} className="relative select-none" style={{ userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={chartData} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
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

            {/* Phase bands */}
            {phases.map(phase => (
              <ReferenceLine
                key={`ph_${phase.id}`}
                x={phase.start_week_number}
                stroke={phase.color || '#d1d5db'}
                strokeWidth={6}
                strokeOpacity={0.45}
                label={{ value: phase.name, position: 'insideTopLeft', fontSize: 8, fill: '#6b7280' }}
              />
            ))}

            {/* Competition lines */}
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

            {/* Actual lines (non-draggable, dashed/faint) */}
            {trackedExercises.map(te =>
              metrics.map(metric => (
                <Line
                  key={`act_${metric}_${te.id}`}
                  type="monotone"
                  dataKey={`a_${metric}_${te.id}`}
                  name={`${te.exercise.exercise_code || te.exercise.name} ${METRIC_LABEL[metric]} actual`}
                  stroke={withOpacity(te.exercise.color, metrics.length > 1 && metric === 'ave' ? 0.4 : 0.55)}
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  dot={{ r: 2, fill: te.exercise.color, strokeWidth: 0 }}
                  activeDot={false}
                  connectNulls
                />
              ))
            )}

            {/* Target lines (draggable) */}
            {trackedExercises.map(te =>
              metrics.map(metric => {
                const isAve = metric === 'ave';
                const color = isAve ? withOpacity(te.exercise.color, 0.65) : te.exercise.color;
                return (
                  <Line
                    key={`tgt_${metric}_${te.id}`}
                    type="monotone"
                    dataKey={`t_${metric}_${te.id}`}
                    name={`${te.exercise.exercise_code || te.exercise.name} ${METRIC_LABEL[metric]}`}
                    stroke={isAve ? te.exercise.color : te.exercise.color}
                    strokeWidth={isAve ? 1.5 : 2.5}
                    strokeDasharray={isAve ? '6 3' : undefined}
                    strokeOpacity={isAve ? 0.65 : 1}
                    dot={makeDot(te.id, metric, te.exercise.color)}
                    activeDot={false}
                    connectNulls
                  />
                );
              })
            )}
          </LineChart>
        </ResponsiveContainer>

        {/* Floating drag tooltip */}
        {activeDrag && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg"
            style={{ left: activeDrag.clientX + 12, top: activeDrag.clientY - 8 }}
          >
            <div>{METRIC_LABEL[activeDrag.metric]}: <strong>{activeDrag.currentValue}</strong></div>
            {activeDrag.linkedMetric && (
              <div>{METRIC_LABEL[activeDrag.linkedMetric]}: <strong>{activeDrag.currentLinkedValue}</strong></div>
            )}
          </div>
        )}

        {/* Dim overlay during drag to prevent accidental interactions */}
        {activeDrag && (
          <div className="absolute inset-0 cursor-ns-resize" style={{ userSelect: 'none' }} />
        )}
      </div>
    </div>
  );
}
