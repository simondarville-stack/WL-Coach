import { useState, useRef, useCallback, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import type { MacroWeek, MacroPhase, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget } from '../../lib/database.types';
import type { MacroActuals, MacroActualsMap } from '../../hooks/useMacroCycles';

export type ChartMetric = 'reps' | 'max' | 'avg';

const METRIC_FIELD: Record<ChartMetric, keyof MacroTarget> = {
  reps: 'target_reps',
  max: 'target_max',
  avg: 'target_avg',
};

const ACTUAL_KEY: Record<ChartMetric, keyof MacroActuals> = {
  reps: 'totalReps',
  max: 'maxWeight',
  avg: 'avgWeight',
};

const WEEK_TYPE_ABBR: Record<string, string> = {
  High: 'H', Medium: 'M', Low: 'L', Deload: 'DL',
  Competition: 'C', Taper: 'TP', Vacation: 'V',
  Testing: 'TE', Transition: 'TR',
};

function withOpacity(color: string, opacity: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

interface DragState {
  weekId: string;
  trackedExId: string;
  metric: 'max' | 'avg';
  startClientY: number;
  startValue: number;
  linkedMetric: 'max' | 'avg' | null;
  linkedStartValue: number;
  currentValue: number;
  currentLinkedValue: number;
  clientX: number;
  clientY: number;
  yMax: number;
  heightPx: number;
}

interface MacroDraggableChartProps {
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
  showReps: boolean;
}

const CHART_HEIGHT = 300;
const MARGIN = { top: 10, right: 44, bottom: 36, left: 0 };

export function MacroDraggableChart({
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
  showReps,
}: MacroDraggableChartProps) {
  const [dragOverrides, setDragOverrides] = useState<Record<string, number>>({});
  const [activeDrag, setActiveDrag] = useState<DragState | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const getKey = (weekId: string, teId: string, metric: ChartMetric) => `${weekId}:${teId}:${metric}`;

  const getTargetValue = useCallback((weekId: string, teId: string, metric: ChartMetric): number => {
    const k = getKey(weekId, teId, metric);
    if (k in dragOverrides) return dragOverrides[k];
    const t = targets.find(t => t.macro_week_id === weekId && t.tracked_exercise_id === teId);
    return (t?.[METRIC_FIELD[metric]] as number | null) ?? 0;
  }, [dragOverrides, targets]);

  const startDrag = useCallback((
    e: React.MouseEvent,
    weekId: string,
    trackedExId: string,
    metric: 'max' | 'avg',
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startValue = getTargetValue(weekId, trackedExId, metric);
    const linkedMetric: 'max' | 'avg' | null = (e.ctrlKey || e.metaKey) ? (metric === 'max' ? 'avg' : 'max') : null;
    const linkedStartValue = linkedMetric ? getTargetValue(weekId, trackedExId, linkedMetric) : 0;

    // Capture scale at drag start so it stays stable throughout the drag
    const allKgValues = trackedExercises.flatMap(te =>
      (['max', 'avg'] as const).flatMap(m => macroWeeks.map(w => getTargetValue(w.id, te.id, m)))
    ).filter(v => v > 0);
    const yMax = allKgValues.length > 0 ? Math.ceil(Math.max(...allKgValues) * 1.3 / 10) * 10 : 200;
    const heightPx = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const drag: DragState = {
      weekId, trackedExId, metric,
      startClientY: e.clientY,
      startValue, linkedMetric, linkedStartValue,
      currentValue: startValue, currentLinkedValue: linkedStartValue,
      clientX: e.clientX, clientY: e.clientY,
      yMax, heightPx,
    };
    setActiveDrag(drag);

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - drag.startClientY;
      const delta = -(dy / drag.heightPx) * drag.yMax;
      const newVal = Math.max(0, Math.round(drag.startValue + delta));
      const newLinked = linkedMetric ? Math.max(0, Math.round(drag.linkedStartValue + delta)) : 0;

      // Direct setState — no RAF batching, maximally responsive
      setDragOverrides(prev => ({
        ...prev,
        [getKey(weekId, trackedExId, metric)]: newVal,
        ...(linkedMetric ? { [getKey(weekId, trackedExId, linkedMetric)]: newLinked } : {}),
      }));
      setActiveDrag(prev => prev ? { ...prev, currentValue: newVal, currentLinkedValue: newLinked, clientX: ev.clientX, clientY: ev.clientY } : null);
    };

    const onUp = async (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const dy = ev.clientY - drag.startClientY;
      const delta = -(dy / drag.heightPx) * drag.yMax;
      const finalVal = Math.max(0, Math.round(drag.startValue + delta));
      const finalLinked = linkedMetric ? Math.max(0, Math.round(drag.linkedStartValue + delta)) : 0;

      const toUpdate = linkedExerciseIds.has(trackedExId) && linkedExerciseIds.size > 1
        ? trackedExercises.filter(te => linkedExerciseIds.has(te.id))
        : [trackedExercises.find(te => te.id === trackedExId)!];

      await Promise.all(toUpdate.flatMap(te => {
        const updates: Promise<void>[] = [onDragTarget(weekId, te.id, METRIC_FIELD[metric], finalVal)];
        if (linkedMetric) updates.push(onDragTarget(weekId, te.id, METRIC_FIELD[linkedMetric], finalLinked));
        return updates;
      }));

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
  }, [getTargetValue, macroWeeks, trackedExercises, onDragTarget, linkedExerciseIds]);

  const chartData = useMemo(() => macroWeeks.map(week => {
    const point: Record<string, number | string | null> = {
      weekNum: week.week_number,
      weekId: week.id,
    };
    trackedExercises.forEach(te => {
      (['max', 'avg', 'reps'] as ChartMetric[]).forEach(metric => {
        const k = getKey(week.id, te.id, metric);
        const t = targets.find(t => t.macro_week_id === week.id && t.tracked_exercise_id === te.id);
        const override = k in dragOverrides ? dragOverrides[k] : undefined;
        point[`t_${metric}_${te.id}`] = override !== undefined ? override : ((t?.[METRIC_FIELD[metric]] as number | null) ?? null);
        const exActuals = actuals[week.id]?.[te.exercise_id];
        point[`a_${metric}_${te.id}`] = exActuals ? (exActuals[ACTUAL_KEY[metric]] as number) : null;
      });
    });
    return point;
  }), [macroWeeks, trackedExercises, targets, actuals, dragOverrides]);

  // Y-axis domains — use drag-start yMax during drag for stability
  const allKgValues = chartData.flatMap(p =>
    trackedExercises.flatMap(te => (['max', 'avg'] as const).map(m => p[`t_${m}_${te.id}`] as number | null))
  ).filter((v): v is number => v !== null && v > 0);
  const yMaxKg = activeDrag?.yMax ?? (allKgValues.length > 0 ? Math.ceil(Math.max(...allKgValues) * 1.2 / 10) * 10 : 100);

  const allRepsValues = chartData.flatMap(p =>
    trackedExercises.map(te => p[`t_reps_${te.id}`] as number | null)
  ).filter((v): v is number => v !== null && v > 0);
  const yMaxReps = allRepsValues.length > 0 ? Math.ceil(Math.max(...allRepsValues) * 1.3 / 10) * 10 : 50;

  const compMarkers = competitions.map(comp => {
    const week = macroWeeks.find(w => {
      const wStart = new Date(w.week_start).getTime();
      const cd = new Date(comp.competition_date).getTime();
      return cd >= wStart && cd <= wStart + 6 * 86400000;
    });
    return week ? { weekNum: week.week_number, name: comp.competition_name, isPrimary: comp.is_primary } : null;
  }).filter(Boolean) as { weekNum: number; name: string; isPrimary: boolean }[];

  // Custom tick: week number + type abbreviation on second line
  const renderTick = ({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: number } }) => {
    const wn = payload?.value ?? 0;
    const week = macroWeeks.find(w => w.week_number === wn);
    const abbr = week ? (WEEK_TYPE_ABBR[week.week_type || ''] ?? week.week_type?.slice(0, 1)?.toUpperCase() ?? '') : '';
    return (
      <g transform={`translate(${x},${y})`}>
        <text textAnchor="middle" fill="#9ca3af" fontSize={9} dy={12}>{wn}</text>
        {abbr && <text textAnchor="middle" fill="#6b7280" fontSize={8} dy={22}>{abbr}</text>}
      </g>
    );
  };

  const makeDot = (trackedExId: string, metric: 'max' | 'avg', color: string) =>
    (props: { cx?: number; cy?: number; index?: number }) => {
      const { cx = 0, cy = 0, index = 0 } = props;
      const week = macroWeeks[index];
      if (!week) return <g />;
      const isActive = activeDrag?.weekId === week.id && activeDrag?.trackedExId === trackedExId && activeDrag?.metric === metric;
      const isLinked = linkedExerciseIds.has(trackedExId);
      const isFocused = focusedExerciseId === trackedExId;
      const r = isActive ? 7 : isFocused ? 6 : 4;
      return (
        <circle
          key={`d_${trackedExId}_${metric}_${week.id}`}
          cx={cx} cy={cy} r={r}
          fill={color}
          stroke={isLinked ? '#1d4ed8' : 'white'}
          strokeWidth={isLinked || isActive ? 2 : 1}
          style={{ cursor: 'ns-resize', userSelect: 'none' }}
          onMouseDown={e => startDrag(e as unknown as React.MouseEvent, week.id, trackedExId, metric)}
        />
      );
    };

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header: legend + link badges */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
          {trackedExercises.map(te => (
            <span key={te.id} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: te.exercise.color }} />
              <span className="font-medium" style={{ color: te.exercise.color }}>
                {te.exercise.exercise_code || te.exercise.name}
              </span>
              <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke={te.exercise.color} strokeWidth="2" /></svg>
              <span>Max</span>
              <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke={withOpacity(te.exercise.color, 0.6)} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>Avg</span>
              {showReps && (
                <>
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: withOpacity(te.exercise.color, 0.25), border: `1px solid ${withOpacity(te.exercise.color, 0.4)}` }} />
                  <span>Reps</span>
                </>
              )}
            </span>
          ))}
          <span className="text-gray-400 border-l border-gray-200 pl-2">dashed = actual</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {trackedExercises.map(te => {
            const isLinked = linkedExerciseIds.has(te.id);
            const isFocused = focusedExerciseId === te.id;
            return (
              <button
                key={te.id}
                onClick={() => onToggleLink(te.id)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                  isFocused ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : isLinked ? 'border-blue-300 bg-blue-50 text-blue-600'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
                title="Click to link across exercises"
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: te.exercise.color }} />
                {te.exercise.exercise_code || te.exercise.name}
              </button>
            );
          })}
          <span className="text-[9px] text-gray-400 border border-dashed border-gray-300 px-1.5 py-0.5 rounded ml-1">
            Ctrl+drag = Hi+Avg
          </span>
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} className="relative select-none" style={{ userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={chartData} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />

            <XAxis
              dataKey="weekNum"
              tick={renderTick}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              height={36}
              interval={0}
            />

            {/* Left Y-axis: kg */}
            <YAxis
              yAxisId="kg"
              domain={[0, yMaxKg]}
              tick={{ fontSize: 9, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              width={36}
            />

            {/* Right Y-axis: reps */}
            {showReps && (
              <YAxis
                yAxisId="reps"
                orientation="right"
                domain={[0, yMaxReps]}
                tick={{ fontSize: 9, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                width={28}
                label={{ value: 'reps', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 8, fill: '#9ca3af' } }}
              />
            )}

            <Tooltip
              contentStyle={{ fontSize: 10, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4 }}
              labelFormatter={wn => `Week ${wn}`}
              formatter={(value: number, name: string) => [value ?? '—', name]}
            />

            {/* Phase bands — subtle background over their week range */}
            {phases.map(phase => (
              <ReferenceArea
                key={`ph_${phase.id}`}
                yAxisId="kg"
                x1={phase.start_week_number}
                x2={phase.end_week_number}
                fill={phase.color || '#d1d5db'}
                fillOpacity={0.08}
                stroke="none"
              />
            ))}

            {/* Competition lines */}
            {compMarkers.map((cw, i) => (
              <ReferenceLine
                key={`comp_${i}`}
                yAxisId="kg"
                x={cw.weekNum}
                stroke={cw.isPrimary ? '#dc2626' : '#f59e0b'}
                strokeDasharray="3 2"
                strokeWidth={1.5}
                label={{ value: cw.name, position: 'insideTopRight', fontSize: 8, fill: cw.isPrimary ? '#dc2626' : '#f59e0b' }}
              />
            ))}

            {/* Reps bars — target (thin, centered at week point) */}
            {showReps && trackedExercises.map(te => (
              <Bar
                key={`bar_t_reps_${te.id}`}
                yAxisId="reps"
                dataKey={`t_reps_${te.id}`}
                name={`${te.exercise.exercise_code || te.exercise.name} Reps`}
                fill={withOpacity(te.exercise.color, 0.18)}
                stroke={withOpacity(te.exercise.color, 0.35)}
                strokeWidth={1}
                barSize={16}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            ))}

            {/* Reps bars — actual (overlay, slightly more opaque) */}
            {showReps && trackedExercises.map(te => (
              <Bar
                key={`bar_a_reps_${te.id}`}
                yAxisId="reps"
                dataKey={`a_reps_${te.id}`}
                name={`${te.exercise.exercise_code || te.exercise.name} Reps actual`}
                fill={withOpacity(te.exercise.color, 0.32)}
                stroke={withOpacity(te.exercise.color, 0.5)}
                strokeWidth={1}
                barSize={16}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            ))}

            {/* Actual kg lines (dashed, non-draggable) */}
            {trackedExercises.flatMap(te =>
              (['max', 'avg'] as const).map(metric => (
                <Line
                  key={`act_${metric}_${te.id}`}
                  yAxisId="kg"
                  type="monotone"
                  dataKey={`a_${metric}_${te.id}`}
                  name={`${te.exercise.exercise_code || te.exercise.name} ${metric === 'max' ? 'Max' : 'Avg'} actual`}
                  stroke={withOpacity(te.exercise.color, metric === 'avg' ? 0.35 : 0.5)}
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  dot={{ r: 2, fill: te.exercise.color, strokeWidth: 0 }}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}

            {/* Target kg lines (draggable) */}
            {trackedExercises.flatMap(te =>
              (['max', 'avg'] as const).map(metric => (
                <Line
                  key={`tgt_${metric}_${te.id}`}
                  yAxisId="kg"
                  type="monotone"
                  dataKey={`t_${metric}_${te.id}`}
                  name={`${te.exercise.exercise_code || te.exercise.name} ${metric === 'max' ? 'Max' : 'Avg'}`}
                  stroke={te.exercise.color}
                  strokeWidth={metric === 'avg' ? 1.5 : 2.5}
                  strokeDasharray={metric === 'avg' ? '6 3' : undefined}
                  strokeOpacity={metric === 'avg' ? 0.65 : 1}
                  dot={makeDot(te.id, metric, te.exercise.color)}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Floating drag tooltip */}
        {activeDrag && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg"
            style={{ left: activeDrag.clientX + 12, top: activeDrag.clientY - 8 }}
          >
            <div>{activeDrag.metric === 'max' ? 'Max' : 'Avg'}: <strong>{activeDrag.currentValue}</strong></div>
            {activeDrag.linkedMetric && (
              <div>{activeDrag.linkedMetric === 'max' ? 'Max' : 'Avg'}: <strong>{activeDrag.currentLinkedValue}</strong></div>
            )}
          </div>
        )}
        {activeDrag && <div className="absolute inset-0 cursor-ns-resize" style={{ userSelect: 'none' }} />}
      </div>
    </div>
  );
}
