import React, { useState, useRef, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Dot } from 'recharts';
import type { MacroWeek, MacroTarget } from '../lib/database.types';

interface MacroGraphProps {
  macroWeeks: MacroWeek[];
  targets: MacroTarget[];
  trackedExerciseId: string;
  onTargetUpdate: (weekId: string, field: 'target_ave' | 'target_hi', value: number) => void;
}

interface ChartDataPoint {
  weekNumber: number;
  weekId: string;
  weekType: string;
  ave: number | null;
  hi: number | null;
  repsHi: number | null;
  setsHi: number | null;
}

export function MacroGraph({ macroWeeks, targets, trackedExerciseId, onTargetUpdate }: MacroGraphProps) {
  const [dragState, setDragState] = useState<{
    active: boolean;
    weekId: string | null;
    field: 'target_ave' | 'target_hi' | null;
    startY: number;
    startValue: number;
  } | null>(null);

  const [tempValue, setTempValue] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<'target_ave' | 'target_hi' | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef(dragState);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const chartData: ChartDataPoint[] = macroWeeks.map(week => {
    const target = targets.find(t => t.macro_week_id === week.id && t.tracked_exercise_id === trackedExerciseId);
    let ave = target?.target_ave || null;
    let hi = target?.target_hi || null;
    const repsHi = target?.target_rhi || null;
    const setsHi = target?.target_shi || null;

    if (dragState?.active && dragState.weekId === week.id && tempValue !== null) {
      if (dragState.field === 'target_ave') {
        ave = tempValue;
      } else if (dragState.field === 'target_hi') {
        hi = tempValue;
      }
    }

    return {
      weekNumber: week.week_number,
      weekId: week.id,
      weekType: week.week_type_text || '',
      ave,
      hi,
      repsHi,
      setsHi,
    };
  });

  const hasInvalidWeeks = chartData.some(d => d.ave !== null && d.hi !== null && d.ave > d.hi);

  const maxValue = Math.max(
    ...chartData.map(d => Math.max(d.ave || 0, d.hi || 0)),
    100
  );

  const yAxisDomain = [0, Math.ceil(maxValue * 1.1 / 10) * 10];

  const handleMouseDown = (field: 'target_ave' | 'target_hi', weekId: string, value: number, event: any) => {
    event.stopPropagation();
    event.preventDefault();
    setDragState({
      active: true,
      weekId,
      field,
      startY: event.clientY,
      startValue: value,
    });
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const currentDragState = dragStateRef.current;
      if (!currentDragState?.active || !containerRef.current) return;

      event.preventDefault();

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const chartHeight = containerRef.current!.clientHeight;
        const yAxisRange = yAxisDomain[1] - yAxisDomain[0];
        const deltaY = currentDragState.startY - event.clientY;
        const valueChange = (deltaY / chartHeight) * yAxisRange;
        const newValue = Math.max(0, Math.round(currentDragState.startValue + valueChange));

        setTempValue(newValue);
      });
    };

    const handleMouseUp = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      const currentDragState = dragStateRef.current;
      if (currentDragState?.field && currentDragState.weekId && tempValue !== null) {
        onTargetUpdate(currentDragState.weekId, currentDragState.field, tempValue);
      }

      setDragState(null);
      setTempValue(null);
    };

    if (dragState?.active) {
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState?.active, yAxisDomain, onTargetUpdate, tempValue]);

  const CustomDot = (props: any) => {
    const { cx, cy, payload, dataKey } = props;
    const field = dataKey === 'ave' ? 'target_ave' : 'target_hi';
    const hasValue = payload[dataKey] !== null;

    const isDragging = dragState?.active &&
                      dragState.weekId === payload.weekId &&
                      dragState.field === field;

    const isInvalid = payload.ave !== null && payload.hi !== null && payload.ave > payload.hi;
    const isSelected = selectedLine === field;

    const handleDotMouseDown = (e: React.MouseEvent) => {
      if (!hasValue) return;
      e.stopPropagation();
      e.preventDefault();
      handleMouseDown(field, payload.weekId, payload[dataKey], e);
    };

    const handleEmptyClick = (e: React.MouseEvent) => {
      if (hasValue || !selectedLine) return;
      e.stopPropagation();
      e.preventDefault();

      const lastWeekWithValue = chartData
        .filter(d => d.weekNumber < payload.weekNumber && d[selectedLine === 'target_ave' ? 'ave' : 'hi'] !== null)
        .sort((a, b) => b.weekNumber - a.weekNumber)[0];

      const defaultValue = lastWeekWithValue
        ? (selectedLine === 'target_ave' ? lastWeekWithValue.ave : lastWeekWithValue.hi) || 50
        : 50;

      onTargetUpdate(payload.weekId, selectedLine, defaultValue);
    };

    if (!hasValue && selectedLine === field) {
      return (
        <g style={{ cursor: 'pointer', outline: 'none' }}>
          <circle
            cx={cx}
            cy={cy}
            r={30}
            fill="transparent"
            onClick={handleEmptyClick}
            style={{ outline: 'none' }}
          />
          <circle
            cx={cx}
            cy={cy}
            r={6}
            fill={dataKey === 'hi' ? '#EF4444' : '#3B82F6'}
            opacity={0.3}
            stroke={dataKey === 'hi' ? '#EF4444' : '#3B82F6'}
            strokeWidth={1}
            strokeDasharray="2,2"
            pointerEvents="none"
            style={{ outline: 'none' }}
          />
        </g>
      );
    }

    if (!hasValue) return null;

    return (
      <g style={{ cursor: 'ns-resize', outline: 'none' }}>
        <circle
          cx={cx}
          cy={cy}
          r={30}
          fill="transparent"
          onMouseDown={handleDotMouseDown}
          style={{ outline: 'none' }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={isDragging ? 12 : 10}
          fill={dataKey === 'hi' ? '#EF4444' : '#3B82F6'}
          stroke={isInvalid ? '#FBBF24' : isSelected ? '#000000' : 'white'}
          strokeWidth={isInvalid ? 3 : isSelected ? 3 : 2}
          pointerEvents="none"
          style={{ outline: 'none' }}
        />
        {dataKey === 'hi' && (payload.repsHi || payload.setsHi) && (
          <text
            x={cx}
            y={cy - 18}
            textAnchor="middle"
            fill="#374151"
            fontSize="11"
            fontWeight="500"
            pointerEvents="none"
          >
            {payload.setsHi && payload.repsHi ? `${payload.setsHi}×${payload.repsHi}` : payload.setsHi ? `${payload.setsHi} sets` : `${payload.repsHi} reps`}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Progression Graph</h3>
      <p className="text-sm text-gray-600 mb-2">
        Drag points vertically to adjust target weights. Changes sync with the table below.
      </p>

      <div className="mb-4 flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700">Select line to create values:</span>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedLine(selectedLine === 'target_ave' ? null : 'target_ave')}
            className={`px-3 py-1.5 text-sm rounded-md border-2 transition-colors ${
              selectedLine === 'target_ave'
                ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Average Weight
          </button>
          <button
            onClick={() => setSelectedLine(selectedLine === 'target_hi' ? null : 'target_hi')}
            className={`px-3 py-1.5 text-sm rounded-md border-2 transition-colors ${
              selectedLine === 'target_hi'
                ? 'border-red-500 bg-red-50 text-red-700 font-medium'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Highest Weight
          </button>
        </div>
        {selectedLine && (
          <span className="text-xs text-gray-500">Click on empty weeks to create values</span>
        )}
      </div>

      {hasInvalidWeeks && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
          <p className="text-sm text-yellow-800">
            <strong>Warning:</strong> Some weeks have Average weight higher than Highest weight.
            Points with invalid values are highlighted with a yellow border.
          </p>
        </div>
      )}
      <div ref={containerRef} style={{ userSelect: 'none', WebkitUserSelect: 'none' }} className="select-none">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="weekNumber"
            label={{ value: 'Week', position: 'insideBottom', offset: -25 }}
            tick={(props: any) => {
              const { x, y, payload } = props;
              const dataPoint = chartData.find(d => d.weekNumber === payload.value);
              return (
                <g transform={`translate(${x},${y})`}>
                  <text x={0} y={0} dy={4} textAnchor="middle" fill="#666" fontSize={11}>
                    {payload.value}
                  </text>
                  {dataPoint?.weekType && (
                    <text x={0} y={0} dy={18} textAnchor="middle" fill="#999" fontSize={9}>
                      {dataPoint.weekType}
                    </text>
                  )}
                </g>
              );
            }}
          />
          <YAxis
            domain={yAxisDomain}
            label={{ value: 'Weight (kg)', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            formatter={(value: any) => value !== null ? `${value} kg` : 'No target'}
            labelFormatter={(label) => `Week ${label}`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="ave"
            stroke="#3B82F6"
            strokeWidth={2}
            name="Average Weight"
            dot={<CustomDot />}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="hi"
            stroke="#EF4444"
            strokeWidth={2}
            name="Highest Weight"
            dot={<CustomDot />}
            connectNulls={false}
          />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex items-center gap-6 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-blue-600"></div>
          <span>Average Weight (Ave)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-red-500"></div>
          <span>Highest Weight (Hi)</span>
        </div>
        <div className="ml-auto text-xs text-gray-500">
          Tip: Drag any point up or down to change the target weight
        </div>
      </div>
    </div>
  );
}
