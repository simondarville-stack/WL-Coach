import { useState, useRef, useCallback, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import type { MacroWeek, MacroPhase, MacroCompetition, MacroTrackedExerciseWithExercise, MacroTarget } from '../../lib/database.types';
import type { MacroActuals, MacroActualsMap } from '../../hooks/useMacroCycles';
import { getExerciseCategoryShade } from '../../lib/colorUtils';

export type ChartMetric = 'reps' | 'max' | 'avg';

type ChartMode = 'load' | 'reps';

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
  metric: ChartMetric;
  startClientY: number;
  startValue: number;
  linkedMetric: ChartMetric | null;
  linkedStartValue: number;
  currentValue: number;
  currentLinkedValue: number;
  clientX: number;
  clientY: number;
  yMax: number;
  heightPx: number;
  yAxisId: 'kg' | 'reps';
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

const CHART_HEIGHT = 480;
const MARGIN = { top: 10, right: 44, bottom: 52, left: 0 };

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
  const [chartMode, setChartMode] = useState<ChartMode>('load');
  const [visibleSeries, setVisibleSeries] = useState<Set<string>>(() => new Set(['max', 'avg', 'reps']));
  const chartRef = useRef<HTMLDivElement>(null);

  const isLoadMode = chartMode === 'load';
  const isRepsMode = chartMode === 'reps';

  const toggleSeries = (key: string) => setVisibleSeries(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const getColor = useCallback((te: MacroTrackedExerciseWithExercise) =>
    getExerciseCategoryShade(te.exercise.id, te.exercise.color, te.exercise.category, trackedExercises),
    [trackedExercises]);

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
    metric: ChartMetric,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startValue = getTargetValue(weekId, trackedExId, metric);
    const isKgMetric = metric === 'max' || metric === 'avg';

    const linkedMetric: ChartMetric | null =
      isKgMetric && (e.ctrlKey || e.metaKey) ? (metric === 'max' ? 'avg' : 'max') : null;
    const linkedStartValue = linkedMetric ? getTargetValue(weekId, trackedExId, linkedMetric) : 0;

    const relevantValues = isKgMetric
      ? trackedExercises.flatMap(te =>
          (['max', 'avg'] as const).flatMap(m => macroWeeks.map(w => getTargetValue(w.id, te.id, m)))
        ).filter(v => v > 0)
      : trackedExercises.flatMap(te =>
          macroWeeks.map(w => getTargetValue(w.id, te.id, 'reps'))
        ).filter(v => v > 0);

    const yMax = relevantValues.length > 0
      ? Math.ceil(Math.max(...relevantValues) * 1.3 / 10) * 10
      : (isKgMetric ? 200 : 50);
    const heightPx = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const drag: DragState = {
      weekId, trackedExId, metric,
      startClientY: e.clientY,
      startValue, linkedMetric, linkedStartValue,
      currentValue: startValue, currentLinkedValue: linkedStartValue,
      clientX: e.clientX, clientY: e.clientY,
      yMax, heightPx,
      yAxisId: isKgMetric ? 'kg' : 'reps',
    };
    setActiveDrag(drag);

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - drag.startClientY;
      const delta = -(dy / drag.heightPx) * drag.yMax;
      const newVal = Math.max(0, Math.round(drag.startValue + delta));
      const newLinked = linkedMetric ? Math.max(0, Math.round(drag.linkedStartValue + delta)) : 0;

      setDragOverrides(prev => ({
        ...prev,
        [getKey(weekId, trackedExId, metric)]: newVal,
        ...(linkedMetric ? { [getKey(weekId, trackedExId, linkedMetric)]: newLinked } : {}),
      }));
      setActiveDrag(prev => prev ? {
        ...prev, currentValue: newVal, currentLinkedValue: newLinked,
        clientX: ev.clientX, clientY: ev.clientY,
      } : null);
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

  const allKgValues = chartData.flatMap(p =>
    trackedExercises.flatMap(te => (['max', 'avg'] as const).map(m => p[`t_${m}_${te.id}`] as number | null))
  ).filter((v): v is number => v !== null && v > 0);
  const yMinKg = allKgValues.length > 0 ? Math.max(0, Math.floor(Math.min(...allKgValues) * 0.7 / 10) * 10) : 0;
  const yMaxKg = activeDrag?.yAxisId === 'kg'
    ? activeDrag.yMax
    : (allKgValues.length > 0 ? Math.ceil(Math.max(...allKgValues) * 1.15 / 10) * 10 : 100);

  // Side-by-side bars: use max individual value per week, not sum
  const maxRepsPerWeek = chartData.map(p =>
    Math.max(0, ...trackedExercises.map(te => (p[`t_reps_${te.id}`] as number | null) ?? 0))
  );
  const yMaxReps = activeDrag?.yAxisId === 'reps'
    ? activeDrag.yMax
    : (maxRepsPerWeek.length > 0 ? Math.ceil(Math.max(...maxRepsPerWeek) * 1.3 / 10) * 10 : 50);

  const compMarkers = competitions.map(comp => {
    const week = macroWeeks.find(w => {
      const wStart = new Date(w.week_start).getTime();
      const cd = new Date(comp.competition_date).getTime();
      return cd >= wStart && cd <= wStart + 6 * 86400000;
    });
    return week ? { weekNum: week.week_number, name: comp.competition_name, isPrimary: comp.is_primary } : null;
  }).filter(Boolean) as { weekNum: number; name: string; isPrimary: boolean }[];

  const renderTick = ({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: number } }) => {
    const wn = payload?.value ?? 0;
    const week = macroWeeks.find(w => w.week_number === wn);
    const abbr = week ? (WEEK_TYPE_ABBR[week.week_type || ''] ?? week.week_type?.slice(0, 1)?.toUpperCase() ?? '') : '';
    const notes = week?.notes ? (week.notes.length > 10 ? week.notes.slice(0, 10) + '…' : week.notes) : '';
    return (
      <g transform={`translate(${x},${y})`}>
        <text textAnchor="middle" fill="#4b5563" fontSize={10} dy={13}>{wn}</text>
        {abbr && <text textAnchor="middle" fill="#6b7280" fontSize={9} dy={24}>{abbr}</text>}
        {notes && <text textAnchor="middle" fill="#9ca3af" fontSize={7} dy={34}>{notes}</text>}
      </g>
    );
  };

  // Custom bar shape: renders the bar rect + a drag handle circle at the bar top
  const makeBarShape = (te: MacroTrackedExerciseWithExercise) =>
    (props: any) => {
      const { x, y, width, height, value } = props;
      const weekId = props.weekId as string;
      const color = getColor(te);
      if (value == null || value === 0 || !width || width <= 0) return <g />;

      const barFillOp = isRepsMode ? 0.5 : 0.12;
      const barStrokeOp = isRepsMode ? 0.7 : 0.25;

      return (
        <g>
          <rect
            x={x} y={y} width={width} height={Math.max(0, height)}
            fill={withOpacity(color, barFillOp)}
            stroke={withOpacity(color, barStrokeOp)}
            strokeWidth={isRepsMode ? 1 : 0.5}
            rx={2} ry={2}
          />
          {isRepsMode && (
            <circle
              cx={x + width / 2}
              cy={y}
              r={5}
              fill={color}
              stroke="white"
              strokeWidth={1.5}
              style={{ cursor: 'ns-resize', userSelect: 'none', outline: 'none' }}
              onMouseDown={e => startDrag(e as unknown as React.MouseEvent, weekId, te.id, 'reps')}
            />
          )}
        </g>
      );
    };

  const makeDot = (trackedExId: string, metric: ChartMetric, color: string, isPrimary: boolean) =>
    (props: { cx?: number; cy?: number; index?: number }) => {
      const { cx = 0, cy = 0, index = 0 } = props;
      const week = macroWeeks[index];
      if (!week) return <g />;
      const isActive = activeDrag?.weekId === week.id
        && activeDrag?.trackedExId === trackedExId
        && activeDrag?.metric === metric;
      const isLinked = linkedExerciseIds.has(trackedExId);
      const r = isActive ? 7 : isPrimary ? 5 : 3;
      const isDraggable = metric === 'reps' ? isRepsMode : isLoadMode;
      return (
        <circle
          key={`d_${trackedExId}_${metric}_${week.id}`}
          cx={cx} cy={cy} r={r}
          fill={color}
          stroke={isLinked ? '#1d4ed8' : (isPrimary ? 'white' : 'transparent')}
          strokeWidth={isLinked || isActive ? 2 : (isPrimary ? 1.5 : 0)}
          style={{ cursor: isDraggable ? 'ns-resize' : 'default', userSelect: 'none', outline: 'none' }}
          onMouseDown={isDraggable ? e => startDrag(e as unknown as React.MouseEvent, week.id, trackedExId, metric) : undefined}
        />
      );
    };

  const lineOpacity = isLoadMode ? 1 : 0.2;
  const avgLineOpacity = isLoadMode ? 0.6 : 0.12;
  const actualLineOpacity = isLoadMode ? 0.2 : 0.08;
  const maxLineWidth = isLoadMode ? 2.5 : 1;
  const avgLineWidth = isLoadMode ? 1.5 : 0.8;
  const barSize = isRepsMode ? 14 : 10;

  const showMaxSeries = visibleSeries.has('max');
  const showAvgSeries = visibleSeries.has('avg');
  const showRepsSeries = visibleSeries.has('reps') && showReps;

  const SERIES_LABELS: Record<string, string> = { max: 'Max', avg: 'Avg', reps: 'Reps' };

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          {trackedExercises.map(te => {
            const color = getColor(te);
            return (
              <span key={te.id} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="font-medium" style={{ color }}>
                  {te.exercise.exercise_code || te.exercise.name}
                </span>
              </span>
            );
          })}
          <span className="text-gray-300 mx-0.5">|</span>
          <span className="flex items-center gap-1">
            <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke="#888" strokeWidth="2.5" /></svg>
            Max
          </span>
          <span className="flex items-center gap-1">
            <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke="#888" strokeWidth="1.5" strokeDasharray="5 2" /></svg>
            Avg
          </span>
          <span className="text-gray-400 text-[9px]">faded = actual</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Series visibility toggles */}
          <div className="flex gap-1">
            {(['max', 'avg', 'reps'] as const).map(key => {
              const on = visibleSeries.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleSeries(key)}
                  className={`px-2 py-0.5 text-[9px] rounded border transition-colors ${
                    on
                      ? 'bg-white border-gray-300 text-gray-700 font-medium shadow-sm'
                      : 'bg-transparent border-gray-200 text-gray-400 line-through'
                  }`}
                >
                  {SERIES_LABELS[key]}
                </button>
              );
            })}
          </div>

          <span className="text-gray-200">|</span>

          {/* Load / Reps mode */}
          <div className="flex gap-px bg-gray-200 rounded-md p-0.5">
            <button
              onClick={() => setChartMode('load')}
              className={`px-2.5 py-0.5 text-[9px] rounded transition-colors ${
                isLoadMode ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'
              }`}
            >
              Load
            </button>
            <button
              onClick={() => setChartMode('reps')}
              className={`px-2.5 py-0.5 text-[9px] rounded transition-colors ${
                isRepsMode ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'
              }`}
            >
              Reps
            </button>
          </div>

          {/* Link toggles */}
          {trackedExercises.map(te => {
            const isLinked = linkedExerciseIds.has(te.id);
            return (
              <button
                key={te.id}
                onClick={() => onToggleLink(te.id)}
                className={`px-1.5 py-0.5 rounded-full text-[9px] border transition-colors ${
                  isLinked
                    ? 'border-blue-300 bg-blue-50 text-blue-600'
                    : 'border-gray-200 text-gray-400 hover:border-gray-300'
                }`}
                title="Link for synchronized dragging"
              >
                {te.exercise.exercise_code || te.exercise.name.slice(0, 4)}
              </button>
            );
          })}
          <span className="text-[8px] text-gray-400">Ctrl+drag = Hi+Avg</span>
        </div>
      </div>

      <div ref={chartRef} className="relative select-none [&_svg_*]:outline-none [&_svg]:outline-none" style={{ userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={chartData} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />

            <XAxis
              dataKey="weekNum"
              tick={renderTick}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              height={52}
              interval={0}
            />

            <YAxis
              yAxisId="kg"
              domain={[isLoadMode ? yMinKg : 0, yMaxKg]}
              tick={{ fontSize: 11, fill: '#4b5563' }}
              tickLine={false}
              axisLine={false}
              width={36}
            />

            <YAxis
              yAxisId="reps"
              orientation="right"
              domain={[0, yMaxReps]}
              tick={{ fontSize: 11, fill: '#4b5563' }}
              tickLine={false}
              axisLine={false}
              width={28}
            />

            <Tooltip
              cursor={false}
              contentStyle={{
                fontSize: 10, padding: '6px 10px',
                border: '1px solid #e5e7eb', borderRadius: 6,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
              labelFormatter={(wn: number) => {
                const week = macroWeeks.find(w => w.week_number === wn);
                const wt = week?.week_type_text || week?.week_type || '';
                return `Week ${wn}${wt ? ' \u2014 ' + wt : ''}`;
              }}
              formatter={(value: number | null, name: string) => {
                if (value === null || value === 0) return [null, null];
                if (name.includes('actual') || name.includes('drag')) return [null, null];
                const isReps = name.toLowerCase().includes('reps');
                return [`${value}${isReps ? '' : ' kg'}`, name];
              }}
            />

            {phases.map(phase => (
              <ReferenceArea
                key={`ph_${phase.id}`}
                yAxisId="kg"
                x1={phase.start_week_number}
                x2={phase.end_week_number}
                fill={phase.color || '#d1d5db'}
                fillOpacity={0.35}
                stroke="none"
                label={{
                  value: phase.name,
                  position: 'insideTopLeft',
                  fontSize: 8,
                  fill: withOpacity(phase.color || '#888', 0.9),
                  fontWeight: 500,
                }}
              />
            ))}

            {compMarkers.map((cw, i) => (
              <ReferenceLine
                key={`comp_${i}`}
                yAxisId="kg"
                x={cw.weekNum}
                stroke={cw.isPrimary ? '#dc2626' : '#f59e0b'}
                strokeDasharray="3 2"
                strokeWidth={1.5}
                label={{
                  value: cw.name, position: 'insideTopRight', fontSize: 8,
                  fill: cw.isPrimary ? '#dc2626' : '#f59e0b',
                }}
              />
            ))}

            {/* Reps bars — custom shape handles the drag dot at bar top */}
            {showRepsSeries && trackedExercises.map(te => (
              <Bar
                key={`bar_t_reps_${te.id}`}
                yAxisId="reps"
                dataKey={`t_reps_${te.id}`}
                name={`${te.exercise.exercise_code || te.exercise.name} Reps`}
                barSize={barSize}
                shape={makeBarShape(te)}
                activeBar={false}
                isAnimationActive={false}
              />
            ))}

            {/* Actual lines */}
            {trackedExercises.flatMap(te => {
              const color = getColor(te);
              return (['max', 'avg'] as const).filter(m =>
                m === 'max' ? showMaxSeries : showAvgSeries
              ).map(metric => (
                <Line
                  key={`act_${metric}_${te.id}`}
                  yAxisId="kg"
                  type="monotone"
                  dataKey={`a_${metric}_${te.id}`}
                  name={`${te.exercise.exercise_code || te.exercise.name} ${metric === 'max' ? 'Max' : 'Avg'} actual`}
                  stroke={withOpacity(color, actualLineOpacity)}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  dot={{ r: 1.5, fill: withOpacity(color, actualLineOpacity), strokeWidth: 0 }}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ));
            })}

            {/* Target max lines */}
            {showMaxSeries && trackedExercises.map(te => {
              const color = getColor(te);
              return (
                <Line
                  key={`tgt_max_${te.id}`}
                  yAxisId="kg"
                  type="monotone"
                  dataKey={`t_max_${te.id}`}
                  name={`${te.exercise.exercise_code || te.exercise.name} Max`}
                  stroke={withOpacity(color, lineOpacity)}
                  strokeWidth={maxLineWidth}
                  dot={makeDot(te.id, 'max', color, isLoadMode)}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}

            {/* Target avg lines */}
            {showAvgSeries && trackedExercises.map(te => {
              const color = getColor(te);
              return (
                <Line
                  key={`tgt_avg_${te.id}`}
                  yAxisId="kg"
                  type="monotone"
                  dataKey={`t_avg_${te.id}`}
                  name={`${te.exercise.exercise_code || te.exercise.name} Avg`}
                  stroke={withOpacity(color, avgLineOpacity)}
                  strokeWidth={avgLineWidth}
                  strokeDasharray="6 3"
                  dot={makeDot(te.id, 'avg', withOpacity(color, avgLineOpacity), false)}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>

        {activeDrag && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg"
            style={{ left: activeDrag.clientX + 12, top: activeDrag.clientY - 8 }}
          >
            <div>
              {activeDrag.metric === 'reps' ? 'Reps' : activeDrag.metric === 'max' ? 'Max' : 'Avg'}:{' '}
              <strong>{activeDrag.currentValue}{activeDrag.metric !== 'reps' ? ' kg' : ''}</strong>
            </div>
            {activeDrag.linkedMetric && (
              <div>
                {activeDrag.linkedMetric === 'max' ? 'Max' : 'Avg'}:{' '}
                <strong>{activeDrag.currentLinkedValue} kg</strong>
              </div>
            )}
          </div>
        )}
        {activeDrag && <div className="absolute inset-0 cursor-ns-resize" style={{ userSelect: 'none' }} />}
      </div>

      <div className="text-[9px] text-gray-400 text-center py-1.5 border-t border-gray-100">
        {isLoadMode
          ? 'Drag dots to adjust intensity \u2014 hold Ctrl to move Max and Avg together'
          : 'Drag dots at bar tops to adjust reps per exercise'}
      </div>
    </div>
  );
}
