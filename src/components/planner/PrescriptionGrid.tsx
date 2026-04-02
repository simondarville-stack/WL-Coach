import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import {
  parsePrescription, formatPrescription,
  parseFreeTextPrescription, formatFreeTextPrescription,
  parseComboPrescription, formatComboPrescription,
} from '../../lib/prescriptionParser';
import type { ParsedSetLine } from '../../lib/prescriptionParser';
import { useShiftHeld } from '../../hooks/useShiftHeld';

interface GridColumn {
  id: string;
  load: number;
  loadText: string;
  reps: number;
  repsText: string;  // display: "3" for regular, "2+1" for combo
  sets: number;
}

interface EditingCell {
  colId: string;
  field: 'load' | 'reps' | 'sets';
  value: string;
}

interface PrescriptionGridProps {
  prescriptionRaw: string | null;
  unit: string | null;
  loadIncrement: number;
  isCombo?: boolean;
  comboPartCount?: number;
  onSave: (raw: string) => void;
  disabled?: boolean;
}

let colIdCounter = 0;
function nextId() { return `col-${++colIdCounter}`; }

function defaultRepsTextForCombo(comboPartCount: number): string {
  return Array(comboPartCount).fill('1').join('+');
}

function parseToColumns(raw: string | null, isCombo: boolean, unit: string | null): GridColumn[] {
  if (!raw || raw.trim() === '') return [];
  if (unit === 'free_text_reps') {
    const lines = parseFreeTextPrescription(raw);
    return lines.map(line => ({
      id: nextId(),
      load: parseFloat(line.loadText) || 0,
      loadText: line.loadText,
      reps: line.reps,
      repsText: String(line.reps),
      sets: line.sets,
    }));
  }
  if (isCombo) {
    const lines = parseComboPrescription(raw);
    return lines.map(line => ({
      id: nextId(),
      load: line.load,
      loadText: String(line.load),
      reps: line.totalReps,
      repsText: line.repsText,
      sets: line.sets,
    }));
  }
  const lines = parsePrescription(raw);
  return lines.map(line => ({
    id: nextId(),
    load: line.load,
    loadText: String(line.load),
    reps: line.reps,
    repsText: String(line.reps),
    sets: line.sets,
  }));
}

function columnsToSetLines(cols: GridColumn[]): ParsedSetLine[] {
  return cols.map(col => ({ load: col.load, reps: col.reps, sets: col.sets }));
}

export function PrescriptionGrid({
  prescriptionRaw,
  unit,
  loadIncrement,
  isCombo = false,
  comboPartCount = 2,
  onSave,
  disabled = false,
}: PrescriptionGridProps) {
  const isFreeTextReps = unit === 'free_text_reps';
  const isFreeText = unit === 'free_text';
  const shiftHeld = useShiftHeld();

  const [columns, setColumns] = useState<GridColumn[]>(() =>
    parseToColumns(prescriptionRaw, isCombo, unit)
  );
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [focusedColId, setFocusedColId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when external data changes
  const prevRawRef = useRef(prescriptionRaw);
  useEffect(() => {
    if (prescriptionRaw !== prevRawRef.current) {
      prevRawRef.current = prescriptionRaw;
      setColumns(parseToColumns(prescriptionRaw, isCombo, unit));
    }
  }, [prescriptionRaw, isCombo, unit]);

  // Focus+select only when a new cell enters edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing?.colId, editing?.field]);

  const save = useCallback((cols: GridColumn[]) => {
    if (isCombo) {
      onSave(formatComboPrescription(
        cols.map(col => ({ sets: col.sets, repsText: col.repsText, totalReps: col.reps, load: col.load })),
        unit,
      ));
    } else if (isFreeTextReps) {
      onSave(formatFreeTextPrescription(cols.map(col => ({
        loadText: col.loadText,
        reps: col.reps,
        sets: col.sets,
      }))));
    } else {
      onSave(formatPrescription(columnsToSetLines(cols), unit));
    }
  }, [isCombo, isFreeTextReps, unit, onSave]);

  function updateColumn(id: string, patch: Partial<GridColumn>) {
    setColumns(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...patch } : c);
      save(next);
      return next;
    });
  }

  function removeColumn(id: string) {
    setColumns(prev => {
      const next = prev.filter(c => c.id !== id);
      save(next);
      return next;
    });
  }

  function handleCellClick(e: React.MouseEvent, colId: string, field: 'load' | 'reps' | 'sets') {
    e.preventDefault();
    if (disabled) return;

    if (e.shiftKey || shiftHeld) {
      removeColumn(colId);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const col = columns.find(c => c.id === colId);
      if (!col) return;
      let currentValue: string;
      if (field === 'reps') {
        currentValue = col.repsText;
      } else if (field === 'load' && isFreeTextReps) {
        currentValue = col.loadText;
      } else {
        currentValue = String(field === 'load' ? col.load : col.sets);
      }
      setEditing({ colId, field, value: currentValue });
      return;
    }

    const col = columns.find(c => c.id === colId);
    if (!col) return;

    const isRight = e.button === 2;
    const delta = isRight ? -1 : 1;

    if (field === 'load') {
      if (isFreeTextReps) return;
      const next = Math.max(0, col.load + delta * loadIncrement);
      updateColumn(colId, { load: next, loadText: String(next) });
    } else if (field === 'reps') {
      if (isCombo) {
        // Increment first part of the tuple
        const parts = col.repsText.split('+');
        const first = Math.max(1, (parseInt(parts[0], 10) || 1) + delta);
        parts[0] = String(first);
        const newRepsText = parts.join('+');
        const newTotalReps = parts.reduce((s, p) => s + (parseInt(p, 10) || 0), 0);
        updateColumn(colId, { repsText: newRepsText, reps: newTotalReps });
      } else {
        const next = Math.max(1, col.reps + delta);
        updateColumn(colId, { reps: next, repsText: String(next) });
      }
    } else {
      const next = Math.max(1, col.sets + delta);
      updateColumn(colId, { sets: next });
    }
  }

  function commitEdit() {
    if (!editing) return;
    const col = columns.find(c => c.id === editing.colId);
    if (!col) { setEditing(null); return; }

    if (editing.field === 'reps') {
      if (isCombo) {
        const raw = editing.value.trim();
        const isTuple = /^\d+(\+\d+)*$/.test(raw);
        if (isTuple && raw.includes('+')) {
          const parts = raw.split('+').map(p => parseInt(p, 10) || 1);
          const totalReps = parts.reduce((s, n) => s + n, 0);
          updateColumn(editing.colId, { repsText: raw, reps: totalReps });
        } else {
          const val = Math.max(1, parseInt(raw, 10) || col.reps);
          updateColumn(editing.colId, { repsText: String(val), reps: val });
        }
      } else {
        const val = Math.max(1, parseInt(editing.value, 10) || col.reps);
        updateColumn(editing.colId, { reps: val, repsText: String(val) });
      }
    } else if (editing.field === 'load') {
      if (isFreeTextReps) {
        const text = editing.value.trim();
        updateColumn(editing.colId, { loadText: text, load: parseFloat(text) || 0 });
      } else {
        const val = Math.max(0, parseFloat(editing.value) || 0);
        updateColumn(editing.colId, { load: val, loadText: String(val) });
      }
    } else {
      const val = Math.max(1, parseInt(editing.value, 10) || col.sets);
      updateColumn(editing.colId, { sets: val });
    }
    setEditing(null);
  }

  function cancelEdit() { setEditing(null); }

  function handleKeyDown(e: React.KeyboardEvent, colId: string) {
    if (editing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && focusedColId === colId) {
      e.preventDefault();
      removeColumn(colId);
    }
  }

  function handleAddColumn() {
    if (disabled) return;
    const last = columns[columns.length - 1];
    const defaultRepsText = isCombo
      ? (last?.repsText ?? defaultRepsTextForCombo(comboPartCount))
      : String(last?.reps ?? 1);
    const newCol: GridColumn = {
      id: nextId(),
      load: last ? last.load + loadIncrement : loadIncrement,
      loadText: last ? String(last.load + loadIncrement) : String(loadIncrement),
      reps: last ? last.reps : 1,
      repsText: defaultRepsText,
      sets: 1,
    };
    const next = [...columns, newCol];
    setColumns(next);
    save(next);
  }

  if (isFreeText) {
    return (
      <textarea
        defaultValue={prescriptionRaw ?? ''}
        onBlur={e => onSave(e.target.value)}
        placeholder="Free text…"
        rows={2}
        className="w-full text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
    );
  }

  function renderCell(col: GridColumn, field: 'load' | 'reps' | 'sets', displayValue: string) {
    const isEditingThis = editing?.colId === col.id && editing.field === field;

    if (isEditingThis) {
      return (
        <input
          ref={inputRef}
          value={editing!.value}
          onChange={e => setEditing(prev => prev ? { ...prev, value: e.target.value } : null)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          className="w-full text-center text-xs font-mono bg-blue-50 border border-blue-400 rounded outline-none"
          style={{ minWidth: 0 }}
        />
      );
    }

    const isSetCell = field === 'sets';
    const isSetsOne = col.sets === 1;
    const isDeleting = shiftHeld;

    return (
      <button
        onMouseDown={e => {
          if (e.button === 0 || e.button === 2) handleCellClick(e, col.id, field);
        }}
        onContextMenu={e => e.preventDefault()}
        tabIndex={-1}
        disabled={disabled}
        title={
          field === 'load' && isFreeTextReps ? 'Ctrl+click to edit'
          : isDeleting ? 'Click to delete column'
          : undefined
        }
        className={[
          'w-full text-center text-xs font-mono select-none transition-colors',
          isSetCell
            ? `font-medium ${isSetsOne ? 'opacity-0 group-hover:opacity-40' : 'opacity-80'} ${isDeleting ? 'text-red-600' : 'text-gray-700'}`
            : `font-medium ${isDeleting ? 'text-red-600' : 'text-gray-900'}`,
          !disabled && !(field === 'load' && isFreeTextReps)
            ? (isDeleting
                ? 'hover:bg-red-100 active:bg-red-200 cursor-pointer rounded'
                : 'hover:bg-blue-50 hover:ring-1 hover:ring-blue-300 active:bg-blue-100 cursor-pointer rounded')
            : '',
          field === 'load' && isFreeTextReps ? 'cursor-default text-gray-600' : '',
        ].filter(Boolean).join(' ')}
        style={{ minHeight: '1.25rem', lineHeight: '1.25rem' }}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <div
      className="flex items-start gap-1.5 flex-wrap"
      onKeyDown={e => { if (focusedColId) handleKeyDown(e, focusedColId); }}
    >
      {columns.map(col => {
        const loadDisplay = isFreeTextReps
          ? col.loadText
          : unit === 'percentage'
          ? `${col.load}%`
          : String(col.load);

        const isDeleting = shiftHeld;

        return (
          <div
            key={col.id}
            className={[
              'group relative flex items-center gap-0.5 rounded transition-colors',
              isDeleting ? 'bg-red-50' : '',
            ].join(' ')}
            tabIndex={0}
            onFocus={() => setFocusedColId(col.id)}
            onBlur={() => setFocusedColId(prev => prev === col.id ? null : prev)}
          >
            {/* Stacked fraction: load / reps */}
            <div className="flex flex-col items-center" style={{ minWidth: '2.5rem' }}>
              <div className="w-full">{renderCell(col, 'load', loadDisplay)}</div>
              <div className={`w-full my-px border-t ${isDeleting ? 'border-red-300' : 'border-gray-400'}`} />
              <div className="w-full">{renderCell(col, 'reps', col.repsText)}</div>
            </div>
            {/* Sets — right of fraction */}
            <div style={{ minWidth: '1rem', alignSelf: 'center' }}>
              {renderCell(col, 'sets', String(col.sets))}
            </div>
          </div>
        );
      })}

      {!disabled && (
        <button
          onClick={handleAddColumn}
          className="flex items-center justify-center rounded border border-dashed border-gray-300 text-gray-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors self-center"
          style={{ width: 24, height: 36 }}
          title="Add column"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}
