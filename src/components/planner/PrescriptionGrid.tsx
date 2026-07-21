import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import {
  parsePrescription, formatPrescription,
  parseFreeTextPrescription, formatFreeTextPrescription,
  parseComboPrescription, formatComboPrescription,
  detectIntendedUnit,
} from '../../lib/prescriptionParser';
import type { ParsedSetLine } from '../../lib/prescriptionParser';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { AutoGrowTextarea } from '../ui';

interface GridColumn {
  id: string;
  load: number;
  loadMax: number | null;
  loadText: string;
  reps: number;
  repsText: string;
  sets: number;
  /** Combo round-grouping multiplier ("m(a+b)"). null = ungrouped. */
  multiplier: number | null;
}

interface EditingCell {
  colId: string;
  field: 'load' | 'reps' | 'sets' | 'multiplier';
  value: string;
}

interface PrescriptionGridProps {
  prescriptionRaw: string | null;
  unit: string | null;
  loadIncrement: number;
  /** Seed value for the first column when the prescription is empty.
   *  Falls back to loadIncrement so coaches who haven't configured it
   *  still get a sensible starting number. */
  defaultLoad?: number;
  isCombo?: boolean;
  comboPartCount?: number;
  /** Persists the prescription. When the coach types a "%" or letters
   *  into a load cell, the grid infers a new unit and passes it as
   *  `unitOverride` so the caller can update the planned_exercise.unit
   *  in the same write — no manual dropdown toggle needed. */
  onSave: (raw: string, unitOverride?: string) => void;
  disabled?: boolean;
  /** Compact density variant used inside week-overview day cards. */
  compact?: boolean;
}

let colIdCounter = 0;
function nextId() { return `col-${++colIdCounter}`; }

function defaultRepsTextForCombo(comboPartCount: number): string {
  return Array(comboPartCount).fill('1').join('+');
}

function parseToColumns(raw: string | null, isCombo: boolean, unit: string | null): GridColumn[] {
  if (!raw || raw.trim() === '') return [];
  // Combo must beat the free-text-reps branch: parseComboPrescription
  // already handles free-text loads ("Heavy×2+1×3") AND preserves the
  // tuple reps_text ("2+1"). Falling into parseFreeTextPrescription
  // here would split on the comma/× separators and silently destroy
  // the combo rep notation.
  if (isCombo) {
    const lines = parseComboPrescription(raw);
    return lines.map(line => ({
      id: nextId(), load: line.load, loadMax: line.loadMax ?? null,
      loadText: line.loadMax != null ? `${line.load}-${line.loadMax}` : (line.loadText ?? String(line.load)),
      reps: line.totalReps, repsText: line.repsText, sets: line.sets, multiplier: line.multiplier ?? null,
    }));
  }
  if (unit === 'free_text_reps') {
    const lines = parseFreeTextPrescription(raw);
    return lines.map(line => ({
      id: nextId(), load: parseFloat(line.loadText) || 0, loadMax: null,
      loadText: line.loadText, reps: line.reps, repsText: String(line.reps), sets: line.sets, multiplier: null,
    }));
  }
  const lines = parsePrescription(raw);
  return lines.map(line => ({
    id: nextId(), load: line.load, loadMax: line.loadMax ?? null,
    loadText: line.loadMax != null ? `${line.load}-${line.loadMax}` : String(line.load),
    reps: line.reps, repsText: String(line.reps), sets: line.sets, multiplier: null,
  }));
}

function columnsToSetLines(cols: GridColumn[]): ParsedSetLine[] {
  return cols.map(col => ({ load: col.load, loadMax: col.loadMax ?? null, reps: col.reps, sets: col.sets }));
}

export function PrescriptionGrid({
  prescriptionRaw,
  unit,
  loadIncrement,
  defaultLoad,
  isCombo = false,
  comboPartCount = 2,
  onSave,
  disabled = false,
  compact = false,
}: PrescriptionGridProps) {
  const isFreeTextReps = unit === 'free_text_reps';
  const isFreeText = unit === 'free_text';
  const deleteHeld = useDeleteHeld();

  const [columns, setColumns] = useState<GridColumn[]>(() => parseToColumns(prescriptionRaw, isCombo, unit));
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [focusedColId, setFocusedColId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Every raw this grid has emitted. The parent echoes saves back into
  // `prescriptionRaw` (to keep summaries live); under rapid clicks an older or
  // out-of-order echo would otherwise re-parse the grid to a stale value
  // mid-edit. Suppress any incoming value we ourselves produced — only a value
  // the grid never emitted is a genuine external change worth re-parsing.
  const sentRawsRef = useRef<Set<string>>(new Set());
  const prevRawRef = useRef(prescriptionRaw);
  const prevUnitRef = useRef(unit);

  useEffect(() => {
    const unitChanged = unit !== prevUnitRef.current;
    prevUnitRef.current = unit;
    if (prescriptionRaw === prevRawRef.current && !unitChanged) return;
    prevRawRef.current = prescriptionRaw;
    if (!unitChanged && prescriptionRaw != null && sentRawsRef.current.has(prescriptionRaw)) return;
    setColumns(prev => {
      const parsed = parseToColumns(prescriptionRaw, isCombo, unit);
      // Preserve column ids by position so a legitimate external re-sync reuses
      // the existing inputs instead of remounting them (focus loss / jump).
      return parsed.map((col, i) => (prev[i] ? { ...col, id: prev[i].id } : col));
    });
  }, [prescriptionRaw, isCombo, unit]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // For "80%" pre-populated loads, select only the numeric prefix so
      // typing replaces the number while the "%" survives. Same goes for
      // anything else that ends in a non-numeric tail (currently just %).
      const v = editing.value;
      const sticky = v.endsWith('%') ? 1 : 0;
      if (sticky > 0 && v.length > sticky) {
        inputRef.current.setSelectionRange(0, v.length - sticky);
      } else {
        inputRef.current.select();
      }
    }
  }, [editing?.colId, editing?.field]);

  const save = useCallback((cols: GridColumn[]) => {
    let raw: string;
    if (isCombo) {
      raw = formatComboPrescription(
        cols.map(col => ({
          sets: col.sets, repsText: col.repsText, totalReps: col.reps,
          load: col.load, loadMax: col.loadMax ?? null,
          ...(col.multiplier != null ? { multiplier: col.multiplier } : {}),
          ...(isFreeTextReps ? { loadText: col.loadText } : {}),
        })),
        unit,
      );
    } else if (isFreeTextReps) {
      raw = formatFreeTextPrescription(cols.map(col => ({ loadText: col.loadText, reps: col.reps, sets: col.sets })));
    } else {
      raw = formatPrescription(columnsToSetLines(cols), unit);
    }
    sentRawsRef.current.add(raw);
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
    if (deleteHeld) { removeColumn(colId); return; }
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    if (e.ctrlKey || e.metaKey) {
      let currentValue: string;
      if (field === 'reps') currentValue = col.repsText;
      else if (field === 'load' && isFreeTextReps) currentValue = col.loadText;
      else if (field === 'load') {
        const base = col.loadMax !== null ? `${col.load}-${col.loadMax}` : String(col.load);
        // Sticky "%" suffix: when the prescription unit is percentage, the
        // edit pre-populates with "80%" so the coach can keep typing
        // numbers without re-adding the symbol. The focus effect selects
        // only the numeric portion, and the existing detectIntendedUnit
        // path converts to kg if the coach deliberately deletes the "%".
        currentValue = unit === 'percentage' ? `${base}%` : base;
      }
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

    // Auto-switch unit when the coach signals one via the load cell.
    // "80%" → percentage, "Heavy" → free_text_reps, "80x5" → absolute_kg.
    // Combos use the same detection but format through formatComboPrescription
    // so the tuple reps_text ("2+1") survives the switch.
    if (editing.field === 'load') {
      const text = editing.value.trim();
      const detected = detectIntendedUnit(text);
      if (detected && detected !== unit) {
        const switchedCols: GridColumn[] = columns.map(c => {
          if (c.id === editing.colId) {
            if (detected === 'free_text_reps') {
              return { ...c, loadText: text, load: parseFloat(text) || 0, loadMax: null };
            }
            // percentage: keep numeric storage, strip the % for parsing
            const numText = text.replace(/%/g, '');
            const dashIdx = numText.indexOf('-', 1);
            if (dashIdx !== -1) {
              const minVal = parseFloat(numText.slice(0, dashIdx));
              const maxVal = parseFloat(numText.slice(dashIdx + 1));
              if (!isNaN(minVal) && !isNaN(maxVal) && maxVal >= minVal) {
                return { ...c, load: minVal, loadMax: maxVal, loadText: `${minVal}-${maxVal}` };
              }
            }
            const val = Math.max(0, parseFloat(numText) || 0);
            return { ...c, load: val, loadMax: null, loadText: String(val) };
          }
          // Other columns: when switching to free_text_reps, seed loadText
          // from the existing numeric load so format has something to print.
          if (detected === 'free_text_reps') {
            const seed = c.loadMax != null ? `${c.load}-${c.loadMax}` : String(c.load);
            return { ...c, loadText: c.loadText || seed, loadMax: null };
          }
          return c;
        });

        const isFreeTextRepsDetected = detected === 'free_text_reps';
        const raw = isCombo
          ? formatComboPrescription(
              switchedCols.map(col => ({
                sets: col.sets,
                repsText: col.repsText,
                totalReps: col.reps,
                load: col.load,
                loadMax: col.loadMax ?? null,
                ...(col.multiplier != null ? { multiplier: col.multiplier } : {}),
                ...(isFreeTextRepsDetected ? { loadText: col.loadText } : {}),
              })),
              detected,
            )
          : isFreeTextRepsDetected
          ? formatFreeTextPrescription(switchedCols.map(c => ({ loadText: c.loadText, reps: c.reps, sets: c.sets })))
          : formatPrescription(columnsToSetLines(switchedCols), detected);

        sentRawsRef.current.add(raw);
        setColumns(switchedCols);
        onSave(raw, detected);
        setEditing(null);
        return;
      }
    }

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
    } else if (editing.field === 'multiplier') {
      const val = Math.max(1, parseInt(editing.value, 10) || (col.multiplier ?? 1));
      updateColumn(editing.colId, { multiplier: val });
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
      const seed = defaultLoad ?? loadIncrement;
      newLoad = last ? last.load + loadIncrement : seed;
      newLoadMax = null;
      newLoadText = String(newLoad);
    }

    const defaultRepsText = isCombo
      ? (last?.repsText ?? defaultRepsTextForCombo(comboPartCount))
      : String(last?.reps ?? 1);

    const newCol: GridColumn = {
      id: nextId(), load: newLoad, loadMax: newLoadMax, loadText: newLoadText,
      reps: last ? last.reps : 1, repsText: defaultRepsText, sets: 1,
      multiplier: last?.multiplier ?? null,
    };
    const next = [...columns, newCol];
    setColumns(next);
    save(next);
  }

  if (isFreeText) {
    return (
      <AutoGrowTextarea
        defaultValue={prescriptionRaw ?? ''}
        onBlur={e => onSave(e.target.value)}
        placeholder="Free text…"
        rows={2}
        style={{
          width: '100%', fontSize: 11, color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
          padding: '4px 8px', outline: 'none',
          background: 'var(--color-bg-primary)', boxSizing: 'border-box',
        }}
      />
    );
  }

  function renderComboRepsCell(col: GridColumn) {
    // The reps tuple and the round-multiplier "m" share the same inline editor.
    const isEditingThis =
      editing?.colId === col.id && (editing.field === 'reps' || editing.field === 'multiplier');
    const isDeleting = deleteHeld;
    const grouped = col.multiplier != null;

    if (isEditingThis) {
      return (
        <input
          ref={inputRef}
          value={editing!.value}
          size={1}
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

    const glyph = (ch: string) => (
      <span style={{ fontSize: 11, lineHeight: 1, userSelect: 'none', color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)' }}>{ch}</span>
    );

    const parts = col.repsText.split('+');
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: '1.25rem' }}>
        {/* Round multiplier "m": m(a+b) = m rounds of the tuple. Same
            click grammar as the rep cells — left +1, right −1 (min 1),
            ctrl+click to type a value. */}
        {grouped && (
          <>
            <button
              onMouseDown={e => {
                if (e.button !== 0 && e.button !== 2) return;
                e.preventDefault();
                if (isDeleting) { removeColumn(col.id); return; }
                if (e.ctrlKey || e.metaKey) { setEditing({ colId: col.id, field: 'multiplier', value: String(col.multiplier ?? 1) }); return; }
                const delta = e.button === 2 ? -1 : 1;
                updateColumn(col.id, { multiplier: Math.max(1, (col.multiplier ?? 1) + delta) });
              }}
              onContextMenu={e => e.preventDefault()}
              tabIndex={-1}
              disabled={disabled}
              title="Rounds of the combo · Left/right-click: ±1 · Ctrl+click: type"
              className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
              style={{ minWidth: '1rem', padding: '0 2px' }}
            >
              {col.multiplier}
            </button>
            {glyph('(')}
          </>
        )}
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
        {grouped && glyph(')')}
        {/* Group/ungroup toggle: wrap the tuple as rounds "m(a+b)" or unwrap. */}
        {!disabled && !isDeleting && (
          <button
            onMouseDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              updateColumn(col.id, { multiplier: grouped ? null : 1 });
            }}
            onContextMenu={e => e.preventDefault()}
            tabIndex={-1}
            title={grouped ? 'Ungroup rounds' : 'Group into rounds — m(a+b)'}
            className="pgrid-btn"
            style={{
              minWidth: '0.85rem', padding: '0 1px', fontSize: 9, lineHeight: 1, alignSelf: 'flex-start',
              color: grouped ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              opacity: grouped ? 0.9 : 0.45,
            }}
          >
            ()
          </button>
        )}
      </div>
    );
  }

  function renderLoadCell(col: GridColumn) {
    const isEditingThis = editing?.colId === col.id && editing.field === 'load';
    const isInterval = col.loadMax !== null;
    const isDeleting = deleteHeld;

    if (isEditingThis) {
      return (
        <input
          ref={inputRef}
          value={editing!.value}
          size={1}
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

    // Intervals render as two independent boxes (min · max), mirroring the
    // combo reps cell — not one wide box with a tinted background.
    if (isInterval) {
      const adjustBound = (bound: 'min' | 'max', e: React.MouseEvent) => {
        if (e.button !== 0 && e.button !== 2) return;
        e.preventDefault();
        if (isDeleting) { removeColumn(col.id); return; }
        if (e.ctrlKey || e.metaKey) {
          const base = `${col.load}-${col.loadMax}`;
          setEditing({ colId: col.id, field: 'load', value: unit === 'percentage' ? `${base}%` : base });
          return;
        }
        const delta = e.button === 2 ? -1 : 1;
        if (bound === 'min') {
          const nextMin = Math.max(0, col.load + delta);
          const adjustedMax = Math.max(nextMin, col.loadMax ?? nextMin);
          updateColumn(col.id, { load: nextMin, loadMax: adjustedMax, loadText: `${nextMin}-${adjustedMax}` });
        } else {
          const nextMax = Math.max(col.load, (col.loadMax ?? 0) + delta);
          updateColumn(col.id, { loadMax: nextMax, loadText: `${col.load}-${nextMax}` });
        }
      };
      const boxTitle = (which: string) =>
        isDeleting ? 'Click to delete column' : `Adjust ${which} · Right-click: −1 · Ctrl+click: edit`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: '1.25rem' }}>
          <button
            onMouseDown={e => adjustBound('min', e)}
            onContextMenu={e => e.preventDefault()}
            tabIndex={-1}
            disabled={disabled}
            title={boxTitle('min')}
            className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
            style={{ minWidth: '1.25rem', padding: '0 2px' }}
          >
            {col.load}
          </button>
          <span style={{ fontSize: 10, lineHeight: 1, userSelect: 'none', color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)' }}>-</span>
          <button
            onMouseDown={e => adjustBound('max', e)}
            onContextMenu={e => e.preventDefault()}
            tabIndex={-1}
            disabled={disabled}
            title={boxTitle('max')}
            className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
            style={{ minWidth: '1.25rem', padding: '0 2px' }}
          >
            {col.loadMax}{unit === 'percentage' ? '%' : ''}
          </button>
        </div>
      );
    }

    return (
      <button
        onMouseDown={e => { if (e.button === 0 || e.button === 2) handleCellClick(e, col.id, 'load'); }}
        onContextMenu={e => e.preventDefault()}
        tabIndex={-1}
        disabled={disabled}
        title={isDeleting ? 'Click to delete column' : undefined}
        className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
      >
        <span>{loadDisplay}</span>
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
          size={1}
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
    const isDeleting = deleteHeld;

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
      className={`pgrid-wrap${compact ? ' pgrid-compact' : ''}`}
      style={{ display: 'flex', alignItems: 'flex-start', gap: compact ? 4 : 6, flexWrap: 'wrap' }}
      onKeyDown={e => { if (focusedColId) handleKeyDown(e, focusedColId); }}
    >
      {columns.map(col => {
        const isDeleting = deleteHeld;

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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: isCombo || col.loadMax !== null ? 'auto' : (compact ? '1.75rem' : '2.5rem') }}>
              <div style={{ width: '100%' }}>{renderLoadCell(col)}</div>
              <div style={{ width: '100%', margin: compact ? 0 : '1px 0', borderTop: `1px solid ${isDeleting ? 'var(--color-danger-text)' : 'var(--color-border-primary)'}` }} />
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
          style={compact ? { width: 18, height: 26 } : { width: 24, height: 36 }}
          title="Add column"
        >
          <Plus size={compact ? 10 : 12} />
        </button>
      )}
    </div>
  );
}
