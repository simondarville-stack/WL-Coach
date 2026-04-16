import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  loadMax: number | null;
  loadText: string;
  reps: number;
  repsText: string;
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
      id: nextId(), load: parseFloat(line.loadText) || 0, loadMax: null,
      loadText: line.loadText, reps: line.reps, repsText: String(line.reps), sets: line.sets,
    }));
  }
  if (isCombo) {
    const lines = parseComboPrescription(raw);
    return lines.map(line => ({
      id: nextId(), load: line.load, loadMax: line.loadMax ?? null,
      loadText: line.loadMax != null ? `${line.load}-${line.loadMax}` : (line.loadText ?? String(line.load)),
      reps: line.totalReps, repsText: line.repsText, sets: line.sets,
    }));
  }
  const lines = parsePrescription(raw);
  return lines.map(line => ({
    id: nextId(), load: line.load, loadMax: line.loadMax ?? null,
    loadText: line.loadMax != null ? `${line.load}-${line.loadMax}` : String(line.load),
    reps: line.reps, repsText: String(line.reps), sets: line.sets,
  }));
}

function columnsToSetLines(cols: GridColumn[]): ParsedSetLine[] {
  return cols.map(col => ({ load: col.load, loadMax: col.loadMax ?? null, reps: col.reps, sets: col.sets }));
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

  const [columns, setColumns] = useState<GridColumn[]>(() => parseToColumns(prescriptionRaw, isCombo, unit));
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [focusedColId, setFocusedColId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lastSentRef = useRef<string | null>(null);
  const prevRawRef = useRef(prescriptionRaw);
  const prevUnitRef = useRef(unit);

  useEffect(() => {
    const unitChanged = unit !== prevUnitRef.current;
    prevUnitRef.current = unit;
    if (prescriptionRaw === prevRawRef.current && !unitChanged) return;
    prevRawRef.current = prescriptionRaw;
    if (!unitChanged && prescriptionRaw === lastSentRef.current) return;
    setColumns(parseToColumns(prescriptionRaw, isCombo, unit));
  }, [prescriptionRaw, isCombo, unit]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing?.colId, editing?.field]);

  const save = useCallback((cols: GridColumn[]) => {
    let raw: string;
    if (isCombo) {
      raw = formatComboPrescription(
        cols.map(col => ({
          sets: col.sets, repsText: col.repsText, totalReps: col.reps,
          load: col.load, loadMax: col.loadMax ?? null,
          ...(isFreeTextReps ? { loadText: col.loadText } : {}),
        })),
        unit,
      );
    } else if (isFreeTextReps) {
      raw = formatFreeTextPrescription(cols.map(col => ({ loadText: col.loadText, reps: col.reps, sets: col.sets })));
    } else {
      raw = formatPrescription(columnsToSetLines(cols), unit);
    }
    lastSentRef.current = raw;
    onSave(raw);
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
    if (shiftHeld) { removeColumn(colId); return; }
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    if (e.ctrlKey || e.metaKey) {
      let currentValue: string;
      if (field === 'reps') currentValue = col.repsText;
      else if (field === 'load' && isFreeTextReps) currentValue = col.loadText;
      else if (field === 'load') currentValue = col.loadMax !== null ? `${col.load}-${col.loadMax}` : String(col.load);
      else currentValue = String(col.sets);
      setEditing({ colId, field, value: currentValue });
      return;
    }

    const isRight = e.button === 2;
    const delta = isRight ? -1 : 1;

    if (field === 'load') {
      if (isFreeTextReps) { setEditing({ colId, field: 'load', value: col.loadText }); return; }
      if (col.loadMax !== null) {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const isRightHalf = e.clientX - rect.left > rect.width / 2;
        if (isRightHalf) {
          const nextMax = Math.max(col.load, (col.loadMax || 0) + delta);
          updateColumn(colId, { loadMax: nextMax, loadText: `${col.load}-${nextMax}` });
        } else {
          const nextMin = Math.max(0, col.load + delta);
          const adjustedMax = Math.max(nextMin, col.loadMax || nextMin);
          updateColumn(colId, { load: nextMin, loadMax: adjustedMax, loadText: `${nextMin}-${adjustedMax}` });
        }
      } else {
        const next = Math.max(0, col.load + delta);
        updateColumn(colId, { load: next, loadMax: null, loadText: String(next) });
      }
    } else if (field === 'reps') {
      if (isCombo) {
        const parts = col.repsText.split('+');
        const first = Math.max(0, (parseInt(parts[0], 10) || 0) + delta);
        parts[0] = String(first);
        const newRepsText = parts.join('+');
        const newTotalReps = parts.reduce((s, p) => s + (parseInt(p, 10) || 0), 0);
        updateColumn(colId, { repsText: newRepsText, reps: newTotalReps });
      } else {
        const next = Math.max(0, col.reps + delta);
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
          updateColumn(editing.colId, { repsText: raw, reps: parts.reduce((s, n) => s + n, 0) });
        } else {
          const val = Math.max(0, parseInt(raw, 10));
          updateColumn(editing.colId, { repsText: String(val), reps: val });
        }
      } else {
        const val = Math.max(0, parseInt(editing.value, 10));
        updateColumn(editing.colId, { reps: val, repsText: String(val) });
      }
    } else if (editing.field === 'load') {
      if (isFreeTextReps) {
        const text = editing.value.trim();
        updateColumn(editing.colId, { loadText: text, load: parseFloat(text) || 0 });
      } else {
        const text = editing.value.trim();
        const dashIdx = text.indexOf('-', 1);
        if (dashIdx !== -1) {
          const minVal = parseFloat(text.slice(0, dashIdx));
          const maxVal = parseFloat(text.slice(dashIdx + 1));
          if (!isNaN(minVal) && !isNaN(maxVal) && maxVal >= minVal) {
            updateColumn(editing.colId, { load: minVal, loadMax: maxVal, loadText: `${minVal}-${maxVal}` });
          }
        } else {
          const val = Math.max(0, parseFloat(text) || 0);
          updateColumn(editing.colId, { load: val, loadMax: null, loadText: String(val) });
        }
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
    let newLoad: number, newLoadMax: number | null = null, newLoadText: string;

    if (last?.loadMax !== null && last?.loadMax !== undefined) {
      newLoad = last.load + loadIncrement;
      newLoadMax = last.loadMax + loadIncrement;
      newLoadText = `${newLoad}-${newLoadMax}`;
    } else if (isFreeTextReps) {
      newLoad = last?.load ?? 0;
      newLoadMax = null;
      newLoadText = last?.loadText ?? '';
    } else {
      newLoad = last ? last.load + loadIncrement : loadIncrement;
      newLoadMax = null;
      newLoadText = String(newLoad);
    }

    const defaultRepsText = isCombo
      ? (last?.repsText ?? defaultRepsTextForCombo(comboPartCount))
      : String(last?.reps ?? 1);

    const newCol: GridColumn = {
      id: nextId(), load: newLoad, loadMax: newLoadMax, loadText: newLoadText,
      reps: last ? last.reps : 1, repsText: defaultRepsText, sets: 1,
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
        style={{
          width: '100%', fontSize: 11, color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
          padding: '4px 8px', resize: 'none', outline: 'none',
          background: 'var(--color-bg-primary)', boxSizing: 'border-box',
        }}
      />
    );
  }

  function renderComboRepsCell(col: GridColumn) {
    const isEditingThis = editing?.colId === col.id && editing.field === 'reps';
    const isDeleting = shiftHeld;

    if (isEditingThis) {
      return (
        <input
          ref={inputRef}
          value={editing!.value}
          onChange={e => setEditing(prev => prev ? { ...prev, value: e.target.value } : null)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancelEdit(); }
          }}
          className="pgrid-editing"
        />
      );
    }

    const parts = col.repsText.split('+');
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: '1.25rem' }}>
        {parts.map((part, partIdx) => (
          <React.Fragment key={partIdx}>
            {partIdx > 0 && (
              <span style={{ fontSize: 10, lineHeight: 1, userSelect: 'none', color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)' }}>+</span>
            )}
            <button
              onMouseDown={e => {
                if (e.button !== 0 && e.button !== 2) return;
                e.preventDefault();
                if (isDeleting) { removeColumn(col.id); return; }
                if (e.ctrlKey || e.metaKey) { setEditing({ colId: col.id, field: 'reps', value: col.repsText }); return; }
                const isRight = e.button === 2;
                const delta = isRight ? -1 : 1;
                const newParts = col.repsText.split('+').map(p => parseInt(p, 10) || 0);
                newParts[partIdx] = Math.max(0, newParts[partIdx] + delta);
                const newRepsText = newParts.join('+');
                updateColumn(col.id, { repsText: newRepsText, reps: newParts.reduce((s, p) => s + p, 0) });
              }}
              onContextMenu={e => e.preventDefault()}
              tabIndex={-1}
              disabled={disabled}
              className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
              style={{ minWidth: '1rem', padding: '0 2px' }}
            >
              {part}
            </button>
          </React.Fragment>
        ))}
      </div>
    );
  }

  function renderLoadCell(col: GridColumn) {
    const isEditingThis = editing?.colId === col.id && editing.field === 'load';
    const isInterval = col.loadMax !== null;
    const isDeleting = shiftHeld;

    if (isEditingThis) {
      return (
        <input
          ref={inputRef}
          value={editing!.value}
          onChange={e => setEditing(prev => prev ? { ...prev, value: e.target.value } : null)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancelEdit(); }
          }}
          className="pgrid-editing"
        />
      );
    }

    const loadDisplay = isFreeTextReps
      ? col.loadText
      : isInterval ? undefined
      : unit === 'percentage' ? `${col.load}%`
      : String(col.load);

    return (
      <button
        onMouseDown={e => { if (e.button === 0 || e.button === 2) handleCellClick(e, col.id, 'load'); }}
        onContextMenu={e => e.preventDefault()}
        tabIndex={-1}
        disabled={disabled}
        title={isDeleting ? 'Click to delete column' : isInterval ? 'Left half: adjust min · Right half: adjust max · Ctrl+click: edit' : undefined}
        className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}${isInterval ? ' pgrid-interval' : ''}`}
      >
        {isInterval ? (
          <span style={{ userSelect: 'none' }}>
            <span style={{ color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-secondary)' }}>{col.load}</span>
            <span style={{ color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)', margin: '0 2px' }}>-</span>
            <span style={{ color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-secondary)' }}>{col.loadMax}</span>
          </span>
        ) : (
          <span>{loadDisplay}</span>
        )}
      </button>
    );
  }

  function renderCell(col: GridColumn, field: 'reps' | 'sets', displayValue: string) {
    const isEditingThis = editing?.colId === col.id && editing.field === field;

    if (isEditingThis) {
      return (
        <input
          ref={inputRef}
          value={editing!.value}
          onChange={e => setEditing(prev => prev ? { ...prev, value: e.target.value } : null)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancelEdit(); }
          }}
          className="pgrid-editing"
        />
      );
    }

    const isSetCell = field === 'sets';
    const isSetsOne = col.sets === 1;
    const isDeleting = shiftHeld;

    return (
      <button
        onMouseDown={e => { if (e.button === 0 || e.button === 2) handleCellClick(e, col.id, field); }}
        onContextMenu={e => e.preventDefault()}
        tabIndex={-1}
        disabled={disabled}
        title={isDeleting ? 'Click to delete column' : undefined}
        className={[
          'pgrid-btn',
          isSetCell ? 'pgrid-btn-sets' : '',
          isSetCell && isSetsOne ? 'pgrid-sets-1' : '',
          isDeleting ? 'pgrid-btn-del' : '',
        ].filter(Boolean).join(' ')}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}
      onKeyDown={e => { if (focusedColId) handleKeyDown(e, focusedColId); }}
    >
      {columns.map(col => {
        const isDeleting = shiftHeld;

        return (
          <div
            key={col.id}
            className="pgrid-col"
            style={{
              display: 'flex', alignItems: 'center', gap: 2, borderRadius: 'var(--radius-sm)',
              background: isDeleting ? 'var(--color-danger-bg)' : 'transparent',
              transition: 'background 0.1s',
            }}
            tabIndex={0}
            onFocus={() => setFocusedColId(col.id)}
            onBlur={() => setFocusedColId(prev => prev === col.id ? null : prev)}
          >
            {/* Stacked fraction: load / reps */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: isCombo ? 'auto' : col.loadMax !== null ? '3.5rem' : '2.5rem' }}>
              <div style={{ width: '100%' }}>{renderLoadCell(col)}</div>
              <div style={{ width: '100%', margin: '1px 0', borderTop: `1px solid ${isDeleting ? 'var(--color-danger-text)' : 'var(--color-border-primary)'}` }} />
              <div style={{ width: '100%' }}>
                {isCombo ? renderComboRepsCell(col) : renderCell(col, 'reps', col.repsText)}
              </div>
            </div>
            {/* Sets */}
            <div style={{ minWidth: '1rem', alignSelf: 'center' }}>
              {renderCell(col, 'sets', String(col.sets))}
            </div>
          </div>
        );
      })}

      {!disabled && (
        <button
          onClick={handleAddColumn}
          className="pgrid-add-btn"
          style={{ width: 24, height: 36 }}
          title="Add column"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}
