import React, { useState, useRef, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Dot } from 'recharts';
import type { MacroWeek } from '../lib/database.types';

interface TotalRepsGraphProps {
  macroWeeks: MacroWeek[];
  onRepsUpdate: (weekId: string, value: number) => void;
}

interface ChartDataPoint {
  weekNumber: number;
  weekId: string;
  weekType: string;
  totalReps: number | null;
}

export function TotalRepsGraph({ macroWeeks, onRepsUpdate }: TotalRepsGraphProps) {
  const [dragState, setDragState] = useState<{
    active: boolean;
    weekId: string | null;
    startY: number;
    startValue: number;
  } | null>(null);

  const [tempValue, setTempValue] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef(dragState);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const chartData: ChartDataPoint[] = macroWeeks.map(week => {
    let totalReps = week.total_reps_target || null;

    if (dragState?.active && dragState.weekId === week.id && tempValue !== null) {
      totalReps = tempValue;
    }

    return {
      weekNumber: week.week_number,
      weekId: week.id,
      weekType: week.week_type_text || '',
      totalReps,
    };
  });

  const maxValue = Math.max(
    ...chartData.map(d => d.totalReps || 0),
    100
  );

  const yAxisDomain = [0, Math.ceil(maxValue * 1.1 / 50) * 50];

  const handleMouseDown = (weekId: string, value: number, event: any) => {
    event.stopPropagation();
    event.preventDefault();
    setDragState({
      active: true,
      weekId,
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
      if (currentDragState?.weekId && tempValue !== null) {
        onRepsUpdate(currentDragState.weekId, tempValue);
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
  }, [dragState?.active, yAxisDomain, onRepsUpdate, tempValue]);

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.totalReps === null) return null;

    const isDragging = dragState?.active && dragState.weekId === payload.weekId;

    const handleDotMouseDown = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      handleMouseDown(payload.weekId, payload.totalReps, e);
    };

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
          fill="#10B981"
          stroke="white"
          strokeWidth={2}
          pointerEvents="none"
          style={{ outline: 'none' }}
        />
      </g>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Total Reps per Week</h3>
      <p className="text-sm text-gray-600 mb-4">
        Drag points vertically to adjust total reps target for each week. Changes sync with the table below.
      </p>
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
            label={{ value: 'Total Reps', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            formatter={(value: any) => value !== null ? `${value} reps` : 'No target'}
            labelFormatter={(label) => `Week ${label}`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="totalReps"
            stroke="#10B981"
            strokeWidth={2}
            name="Total Reps Target"
            dot={<CustomDot />}
            connectNulls={false}
          />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex items-center gap-6 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-600"></div>
          <span>Total Reps Target</span>
        </div>
        <div className="ml-auto text-xs text-gray-500">
          Tip: Drag any point up or down to change the total reps target
        </div>
      </div>
    </div>
  );
}
