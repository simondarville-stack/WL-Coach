import { useState, useEffect, useRef } from 'react';
import { parsePrescription, formatPrescription, type ParsedSetLine } from '../lib/prescriptionParser';
import type { DefaultUnit } from '../lib/database.types';

interface GridPrescriptionEditorProps {
  prescriptionRaw: string | null;
  unit: DefaultUnit;
  gridLoadIncrement: number;
  gridClickIncrement: number;
  onSave: (prescriptionRaw: string) => void;
  macroTarget?: {
    target_reps: number | null;
    target_ave: number | null;
    target_hi: number | null;
    target_rhi: number | null;
    target_shi: number | null;
  } | null;
}

interface GridColumn {
  id: string;
  load: number;
  reps: number;
  sets: number;
}

export function GridPrescriptionEditor({
  prescriptionRaw,
  unit,
  gridLoadIncrement,
  gridClickIncrement,
  onSave,
  macroTarget,
}: GridPrescriptionEditorProps) {
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [editingCell, setEditingCell] = useState<{ columnId: string; field: 'load' | 'reps' | 'sets' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [shiftHeld, setShiftHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const parsed = parsePrescription(prescriptionRaw || '');
    const newColumns: GridColumn[] = parsed.map((line, index) => ({
      id: `col-${Date.now()}-${index}`,
      load: line.load,
      reps: line.reps,
      sets: line.sets,
    }));
    setColumns(newColumns);
  }, [prescriptionRaw]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const serializeAndSave = (cols: GridColumn[]) => {
    const setLines: ParsedSetLine[] = cols.map(col => ({
      load: col.load,
      reps: col.reps,
      sets: col.sets,
    }));
    const prescriptionText = formatPrescription(setLines, unit);
    onSave(prescriptionText);
  };

  const handleCellClick = (e: React.MouseEvent, columnId: string, field: 'load' | 'reps' | 'sets', isRightClick: boolean) => {
    if (e.ctrlKey || e.metaKey) {
      const col = columns.find(c => c.id === columnId);
      if (!col) return;
      setEditValue(String(col[field]));
      setEditingCell({ columnId, field });
      return;
    }

    setColumns(prev => {
      const newCols = prev.map(col => {
        if (col.id === columnId) {
          const delta = isRightClick ? -gridClickIncrement : gridClickIncrement;
          let newValue = col[field] + delta;

          if (field === 'load') {
            newValue = Math.max(0, newValue);
          } else {
            newValue = Math.max(1, newValue);
          }

          return { ...col, [field]: newValue };
        }
        return col;
      });
      serializeAndSave(newCols);
      return newCols;
    });
  };

  const commitEdit = () => {
    if (!editingCell) return;

    const numValue = parseFloat(editValue);
    if (isNaN(numValue)) {
      setEditingCell(null);
      return;
    }

    setColumns(prev => {
      const newCols = prev.map(col => {
        if (col.id === editingCell.columnId) {
          let finalValue = numValue;
          if (editingCell.field === 'load') {
            finalValue = Math.max(0, numValue);
          } else {
            finalValue = Math.max(1, Math.floor(numValue));
          }
          return { ...col, [editingCell.field]: finalValue };
        }
        return col;
      });
      serializeAndSave(newCols);
      return newCols;
    });

    setEditingCell(null);
  };

  const handleAddColumn = () => {
    const lastCol = columns[columns.length - 1];
    let newLoad = 0;
    let newReps = 3;

    if (lastCol) {
      newReps = lastCol.reps;
      if (unit === 'absolute_kg') {
        newLoad = lastCol.load + gridLoadIncrement;
      } else {
        newLoad = 0;
      }
    }

    const newCol: GridColumn = {
      id: `col-${Date.now()}`,
      load: newLoad,
      reps: newReps,
      sets: 1,
    };

    const newCols = [...columns, newCol];
    setColumns(newCols);
    serializeAndSave(newCols);

    setTimeout(() => {
      setEditValue(String(newLoad));
      setEditingCell({ columnId: newCol.id, field: 'load' });
    }, 0);
  };

  const handleDeleteColumn = (columnId: string) => {
    const newCols = columns.filter(col => col.id !== columnId);
    setColumns(newCols);
    serializeAndSave(newCols);
  };

  const handleKeyDown = (e: React.KeyboardEvent, columnId: string) => {
    if (editingCell) {
      if (e.key === 'Enter') {
        commitEdit();
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handleDeleteColumn(columnId);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const calculateSummary = () => {
    let totalReps = 0;
    let totalSets = 0;
    let highestLoad = 0;
    let weightedLoadSum = 0;

    columns.forEach(col => {
      const repsInCol = col.reps * col.sets;
      totalReps += repsInCol;
      totalSets += col.sets;
      if (col.load > highestLoad) {
        highestLoad = col.load;
      }
      weightedLoadSum += col.load * repsInCol;
    });

    const avgLoad = totalReps > 0 ? weightedLoadSum / totalReps : 0;

    return {
      totalReps,
      totalSets,
      highestLoad,
      avgLoad: Math.round(avgLoad * 10) / 10,
    };
  };

  const summary = calculateSummary();
  const unitLabel = unit === 'absolute_kg' ? 'KG' : unit === 'percentage' ? '%' : unit === 'rpe' ? 'RPE' : '';

  const getMacroComparison = (field: 'S' | 'R' | 'Hi' | 'Avg', value: number) => {
    if (!macroTarget) return null;

    let target: number | null = null;
    if (field === 'R' && macroTarget.target_reps !== null) target = macroTarget.target_reps;
    if (field === 'Hi' && macroTarget.target_hi !== null) target = macroTarget.target_hi;
    if (field === 'Avg' && macroTarget.target_ave !== null) target = macroTarget.target_ave;

    if (target === null) return null;

    const diff = value - target;
    const pct = target > 0 ? (diff / target) * 100 : 0;
    let color = 'text-gray-500';
    if (Math.abs(pct) < 5) color = 'text-green-600';
    else if (diff > 0) color = 'text-amber-600';
    else color = 'text-red-600';

    return { target, diff, color };
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="overflow-x-auto"
        onContextMenu={handleContextMenu}
        onMouseMove={(e) => { if (shiftHeld !== e.shiftKey) setShiftHeld(e.shiftKey); }}
        onMouseLeave={() => setShiftHeld(false)}
      >
        <div className="inline-flex items-stretch gap-2.5 min-w-full">
          <div className="flex flex-col gap-0.5 w-12 flex-shrink-0">
            <div className="h-8 text-[10px] font-medium text-gray-600 flex items-center justify-end pr-1">
              {unitLabel}:
            </div>
            <div className="h-8 text-[10px] font-medium text-gray-600 flex items-center justify-end pr-1">
              R / S:
            </div>
          </div>

          {columns.map(col => (
            <div
              key={col.id}
              className="flex flex-col gap-0.5"
              onKeyDown={(e) => handleKeyDown(e, col.id)}
              onMouseDown={(e) => { if (e.shiftKey) { e.preventDefault(); handleDeleteColumn(col.id); } }}
              tabIndex={0}
            >
              <div
                className={`w-14 h-8 border flex items-center justify-center cursor-pointer transition-colors ${shiftHeld ? 'border-red-400 bg-red-50 hover:bg-red-100' : 'border-gray-300 bg-white hover:bg-blue-50'}`}
                onClick={(e) => handleCellClick(e, col.id, 'load', false)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleCellClick(e, col.id, 'load', true);
                }}
              >
                {editingCell?.columnId === col.id && editingCell.field === 'load' ? (
                  <input
                    ref={inputRef}
                    type="number"
                    step="any"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit();
                      if (e.key === 'Escape') setEditingCell(null);
                    }}
                    className="w-full h-full text-center text-xs border-0 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <span className="text-xs font-medium">{col.load}</span>
                )}
              </div>

              <div className="w-14 h-8 flex gap-0.5">
                <div
                  className={`flex-1 border flex items-center justify-center cursor-pointer transition-colors ${shiftHeld ? 'border-red-400 bg-red-50 hover:bg-red-100' : 'border-gray-300 bg-white hover:bg-blue-50'}`}
                  onClick={(e) => handleCellClick(e, col.id, 'reps', false)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleCellClick(e, col.id, 'reps', true);
                  }}
                >
                  {editingCell?.columnId === col.id && editingCell.field === 'reps' ? (
                    <input
                      ref={inputRef}
                      type="number"
                      min="1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') setEditingCell(null);
                      }}
                      className="w-full h-full text-center text-xs border-0 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <span className="text-xs font-medium">{col.reps}</span>
                  )}
                </div>
                <div
                  className={`flex-1 border flex items-center justify-center cursor-pointer transition-colors ${shiftHeld ? 'border-red-400 bg-red-50 hover:bg-red-100' : 'border-gray-300 bg-white hover:bg-blue-50'}`}
                  onClick={(e) => handleCellClick(e, col.id, 'sets', false)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleCellClick(e, col.id, 'sets', true);
                  }}
                >
                  {editingCell?.columnId === col.id && editingCell.field === 'sets' ? (
                    <input
                      ref={inputRef}
                      type="number"
                      min="1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') setEditingCell(null);
                      }}
                      className="w-full h-full text-center text-xs border-0 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <span className="text-xs font-medium">{col.sets}</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          <div
            className="w-10 border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors rounded-sm self-stretch"
            onClick={handleAddColumn}
          >
            <span className="text-gray-400 text-lg">+</span>
          </div>
        </div>
      </div>

      {columns.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-200">
          <div className="flex items-center gap-4 text-[10px] text-gray-600">
            <div>
              <span className="font-medium">S:</span> {summary.totalSets}
            </div>
            <div>
              <span className="font-medium">R:</span> {summary.totalReps}
            </div>
            <div>
              <span className="font-medium">Hi:</span> {summary.highestLoad}
            </div>
            <div>
              <span className="font-medium">Avg:</span> {summary.avgLoad}
            </div>
          </div>

          {macroTarget && (
            <div className="flex items-center gap-4 text-[10px]">
              {macroTarget.target_reps !== null && (() => {
                const cmp = getMacroComparison('R', summary.totalReps);
                return cmp ? (
                  <div className={cmp.color}>
                    <span className="font-medium">R:</span> {cmp.target}
                  </div>
                ) : null;
              })()}
              {macroTarget.target_hi !== null && (() => {
                const cmp = getMacroComparison('Hi', summary.highestLoad);
                return cmp ? (
                  <div className={cmp.color}>
                    <span className="font-medium">Hi:</span> {cmp.target}
                  </div>
                ) : null;
              })()}
              {macroTarget.target_ave !== null && (() => {
                const cmp = getMacroComparison('Avg', summary.avgLoad);
                return cmp ? (
                  <div className={cmp.color}>
                    <span className="font-medium">Avg:</span> {cmp.target}
                  </div>
                ) : null;
              })()}
              {macroTarget.target_rhi !== null && (
                <div className="text-gray-500">
                  <span className="font-medium">R@Hi:</span> {macroTarget.target_rhi}
                </div>
              )}
              {macroTarget.target_shi !== null && (
                <div className="text-gray-500">
                  <span className="font-medium">S@Hi:</span> {macroTarget.target_shi}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
