import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { resolveFormulaCell } from '../../lib/formulaEval';
import {
  parsePrescription, formatPrescription,
  parseFreeTextPrescription, formatFreeTextPrescription,
  parseComboPrescription, formatComboPrescription,
  detectIntendedUnit, splitLoadCmp, LOAD_CMP_GLYPH,
  parseNotationLine, looksLikeNotationLine, splitQuotedLiteral,
} from '../../lib/prescriptionParser';
import type { ParsedSetLine, LoadCmp } from '../../lib/prescriptionParser';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { useRepeatOnHold } from '../../hooks/useRepeatOnHold';
import { getUnitLabel } from '../../lib/constants';
import { AutoGrowTextarea } from '../ui';
import type { CoachPreset } from '../../lib/database.types';
import { StackedNotation } from './StackedNotation';
import { formatSeconds } from '../../lib/exerciseFeatures';

interface GridColumn {
  id: string;
  load: number;
  loadMax: number | null;
  loadText: string;
  /** Soft-load comparator (≥ ≈ ≤). null = exact load. */
  loadCmp: LoadCmp | null;
  reps: number;
  /** Rep-range upper bound ("3-5"). null = fixed reps. Non-combo only. */
  repsMax: number | null;
  repsText: string;
  sets: number;
  /** Set-range upper bound ("4-6"). null = fixed set count. */
  setsMax: number | null;
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
  /** When provided, typing "#<name>" into any cell (case-insensitive; a
   *  unique prefix works too) applies that prescription preset instead of
   *  committing the text as a value. */
  presets?: CoachPreset[];
  onApplyPreset?: (preset: CoachPreset) => void;
}

let colIdCounter = 0;
function nextId() { return `col-${++colIdCounter}`; }

/**
 * The units Alt+click cycles through, in order. Deliberately the same three
 * MacroTableV2 already cycles, and the same three the coach can pick in the
 * exercise detail: `free_text` renders prose instead of a grid, so cycling
 * into it would remove the very cell the gesture lives on, and `rpe` / `other`
 * are storage-only — no picker offers them, so landing a row on one by
 * accident would strand it.
 */
const UNIT_CYCLE = ['absolute_kg', 'percentage', 'free_text_reps'] as const;

/** A load text that is really just a number, and so survives a unit change. */
const NUMERIC_TEXT = /^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?$/;

/** "3-5" → {min:3, max:5}, "5" → {min:5, max:null}; invalid → null (edit discarded). */
function parseBoundedIntRange(s: string, floor: number): { min: number; max: number | null } | null {
  const m = s.replace(/–/g, '-').match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const min = Math.max(floor, parseInt(m[1], 10));
  const max = m[2] != null ? Math.max(min, parseInt(m[2], 10)) : null;
  return { min, max };
}

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
      loadCmp: line.loadCmp ?? null,
      reps: line.totalReps, repsMax: null, repsText: line.repsText,
      sets: line.sets, setsMax: line.setsMax ?? null, multiplier: line.multiplier ?? null,
    }));
  }
  if (unit === 'free_text_reps') {
    const lines = parseFreeTextPrescription(raw);
    return lines.map(line => ({
      id: nextId(), load: parseFloat(line.loadText) || 0, loadMax: null,
      loadText: line.loadText, loadCmp: null,
      reps: line.reps, repsMax: null, repsText: String(line.reps),
      sets: line.sets, setsMax: null, multiplier: null,
    }));
  }
  const lines = parsePrescription(raw);
  return lines.map(line => ({
    id: nextId(), load: line.load, loadMax: line.loadMax ?? null,
    loadText: line.loadMax != null ? `${line.load}-${line.loadMax}` : String(line.load),
    loadCmp: line.loadCmp ?? null,
    reps: line.reps, repsMax: line.repsMax ?? null, repsText: String(line.reps),
    sets: line.sets, setsMax: line.setsMax ?? null, multiplier: null,
  }));
}

function columnsToSetLines(cols: GridColumn[]): ParsedSetLine[] {
  return cols.map(col => ({
    load: col.load, loadMax: col.loadMax ?? null, loadCmp: col.loadCmp,
    reps: col.reps, repsMax: col.repsMax, sets: col.sets, setsMax: col.setsMax,
  }));
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
  presets,
  onApplyPreset,
}: PrescriptionGridProps) {
  const isFreeTextReps = unit === 'free_text_reps';
  const isFreeText = unit === 'free_text';
  const deleteHeld = useDeleteHeld();
  const hold = useRepeatOnHold();

  const [columns, setColumns] = useState<GridColumn[]>(() => parseToColumns(prescriptionRaw, isCombo, unit));
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [focusedColId, setFocusedColId] = useState<string | null>(null);
  /** Highlighted row of the "#" preset dropdown while editing a cell. */
  const [presetIndex, setPresetIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Transient one-liner under the grid: what the unit cycle just did, or why
   *  it refused. The gesture has no visible control of its own, so without
   *  this a refusal is indistinguishable from a dead click. */
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);

  function showNote(message: string) {
    setNote(message);
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 2600);
  }

  useEffect(() => () => {
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
  }, []);

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

  /** Live "= 40" bubble above the cell being edited, so a coach sees what the
   *  formula resolves to before committing it. '!' means it doesn't evaluate
   *  (yet) — the edit will be discarded rather than written as 0. */
  const formulaPreview = useMemo(() => {
    if (!editing || !editing.value.trim().startsWith('=')) return null;
    const r = resolveFormulaCell(editing.value, editing.field === 'load' ? 'decimal' : 'integer');
    return r.error ? '!' : r.text;
  }, [editing]);

  /** Presets matching a "#…" cell edit — drives the in-cell dropdown. A bare
   *  "#" lists everything; further characters filter by name prefix. */
  const presetMatches = useMemo(() => {
    if (!editing || !presets?.length || !onApplyPreset) return [];
    const typed = editing.value.trim();
    if (!typed.startsWith('#')) return [];
    const q = typed.slice(1).toLowerCase();
    return presets.filter(p => p.name.toLowerCase().startsWith(q));
  }, [editing, presets, onApplyPreset]);

  function applyPresetFromDropdown(p: CoachPreset) {
    setEditing(null);
    onApplyPreset?.(p);
  }

  /** The one editing input all cells share — plus the formula bubble and the
   *  "#" preset dropdown (ArrowUp/Down + Enter, or click). The wrapper keeps
   *  the cell's width (block + 100%) and grows with the typed text via a
   *  ch-based min-width, so the box mimics how wide the committed value will
   *  render instead of collapsing to the input's intrinsic width. */
  function renderEditingInput() {
    return (
      <span
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          minWidth: `${Math.max(3, editing!.value.length + 1)}ch`,
        }}
      >
        <input
          ref={inputRef}
          value={editing!.value}
          size={1}
          onChange={e => { setEditing(prev => prev ? { ...prev, value: e.target.value } : null); setPresetIndex(0); }}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (presetMatches.length > 0) {
              if (e.key === 'ArrowDown') { e.stopPropagation(); e.preventDefault(); setPresetIndex(i => Math.min(i + 1, presetMatches.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.stopPropagation(); e.preventDefault(); setPresetIndex(i => Math.max(i - 1, 0)); return; }
              if (e.key === 'Enter') {
                e.stopPropagation(); e.preventDefault();
                applyPresetFromDropdown(presetMatches[Math.min(presetIndex, presetMatches.length - 1)]);
                return;
              }
            }
            if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancelEdit(); }
          }}
          className="pgrid-editing"
        />
        {formulaPreview != null && (
          <span className="pgrid-formula-preview" aria-hidden>{formulaPreview}</span>
        )}
        {presetMatches.length > 0 && (
          <div
            style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2,
              minWidth: 210, maxHeight: 200, overflowY: 'auto',
              background: 'var(--color-bg-primary)',
              border: '0.5px solid var(--color-border-primary)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 4px 14px rgba(20,30,45,0.13)',
            }}
          >
            {presetMatches.map((p, i) => (
              <button
                key={p.id}
                onMouseDown={e => { e.preventDefault(); applyPresetFromDropdown(p); }}
                onMouseEnter={() => setPresetIndex(i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 9px', textAlign: 'left', border: 'none', cursor: 'pointer',
                  background: i === presetIndex ? 'var(--color-accent-muted)' : 'transparent',
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0,
                  background: `${p.color}1c`, color: p.color, borderRadius: 8, padding: '1px 6px',
                }}>
                  #{p.name.toUpperCase()}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {p.prescription_raw && <StackedNotation raw={p.prescription_raw} unit={p.unit} />}
                  {p.features?.totalTime != null && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>⏱ {formatSeconds(p.features.totalTime)}</span>
                  )}
                  {p.features?.restTime != null && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>⏸ {formatSeconds(p.features.restTime)}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </span>
    );
  }

  /**
   * The single place that decides which of the three formatters a set of
   * columns goes through. Taking the unit as an argument rather than reading
   * the prop is what lets a unit change and a value edit share one code path —
   * previously the unit-switch branch had its own copy that quietly dropped
   * `setsMax` and `loadCmp`, so a `×2-4` or a `≥` was lost on every switch.
   */
  const formatFor = useCallback((cols: GridColumn[], targetUnit: string | null): string => {
    const asText = targetUnit === 'free_text_reps';
    if (isCombo) {
      return formatComboPrescription(
        cols.map(col => ({
          sets: col.sets, setsMax: col.setsMax, repsText: col.repsText, totalReps: col.reps,
          load: col.load, loadMax: col.loadMax ?? null, loadCmp: col.loadCmp,
          ...(col.multiplier != null ? { multiplier: col.multiplier } : {}),
          ...(asText ? { loadText: col.loadText } : {}),
        })),
        targetUnit,
      );
    }
    if (asText) {
      return formatFreeTextPrescription(cols.map(col => ({
        loadText: col.loadText || (col.loadMax != null ? `${col.load}-${col.loadMax}` : String(col.load)),
        reps: col.reps,
        sets: col.sets,
      })));
    }
    return formatPrescription(columnsToSetLines(cols), targetUnit);
  }, [isCombo]);

  const save = useCallback((cols: GridColumn[]) => {
    const raw = formatFor(cols, unit);
    sentRawsRef.current.add(raw);
    onSave(raw);
  }, [formatFor, unit, onSave]);

  // save() must stay OUTSIDE the setColumns updater: updaters run during the
  // render phase, and save() sets parent state (React's "cannot update a
  // component while rendering a different component" warning).
  function updateColumn(id: string, patch: Partial<GridColumn>) {
    const next = columns.map(c => c.id === id ? { ...c, ...patch } : c);
    setColumns(next);
    save(next);
  }

  function removeColumn(id: string) {
    const next = columns.filter(c => c.id !== id);
    setColumns(next);
    save(next);
  }

  /**
   * Alt+click a load cell to cycle the row's unit; Alt+right-click to go back.
   * The load is the only cell it answers to, because the unit is a statement
   * about the load and nothing else.
   *
   * Returns true when it consumed the event, so every load-cell handler can
   * call it first and bail. A refusal still returns true — the gesture was
   * understood and declined, which is not the same as not being a gesture.
   */
  function cycleUnit(e: React.MouseEvent): boolean {
    if (!e.altKey || (e.button !== 0 && e.button !== 2)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return true;

    const at = UNIT_CYCLE.indexOf(unit as typeof UNIT_CYCLE[number]);
    if (at === -1) {
      // rpe / other / free_text: reachable in storage, offered by no picker.
      // Cycling would be the only way in and no way back, so it is refused.
      showNote(`${getUnitLabel(unit)} is not one of the cycled units`);
      return true;
    }
    const step = e.button === 2 ? -1 : 1;
    const next = UNIT_CYCLE[(at + step + UNIT_CYCLE.length) % UNIT_CYCLE.length];

    // Refuse the transitions that cannot be undone by cycling back. A coach
    // mid-plan has no undo, and the write replaces the stored set lines, so a
    // lossy cycle is permanent the moment it lands.
    if (unit === 'free_text_reps' && columns.some(c => c.loadText.trim() && !NUMERIC_TEXT.test(c.loadText.trim()))) {
      showNote('Text loads would be lost — retype them as numbers first');
      return true;
    }
    // free_text_reps stores only `loadText × reps × sets`. Everything else a
    // column can carry — an interval top, a soft-load sign, a rep or set range
    // — has nowhere to go, and parseToColumns hard-nulls them on the way back,
    // so cycling out again does NOT restore them. Refuse rather than shed them.
    if (next === 'free_text_reps'
        && columns.some(c => c.repsMax != null || c.setsMax != null || c.loadMax != null || c.loadCmp != null)) {
      showNote('Free text has no ranges or signs — they would be lost');
      return true;
    }

    const raw = formatFor(columns, next);
    const back = parseToColumns(raw, isCombo, next);
    if (back.length !== columns.length) {
      showNote(`${getUnitLabel(next)} cannot hold this prescription`);
      return true;
    }

    // Any half-typed cell is abandoned: its blur would commit against the
    // unit this cycle just replaced, quietly undoing the change.
    setEditing(null);
    sentRawsRef.current.add(raw);
    // Keep the column ids so the cells do not remount under the cursor.
    setColumns(back.map((c, i) => (columns[i] ? { ...c, id: columns[i].id } : c)));
    onSave(raw, next);
    showNote(getUnitLabel(next));
    return true;
  }

  /**
   * A cell's mousedown. Returns true only when it performed a plain ±1 step —
   * the one gesture worth repeating on a held button. Everything else this
   * mousedown also serves (Del-held removes the column, Alt cycles the unit,
   * Ctrl opens the edit) returns false, because holding those down would
   * delete a row, spin the unit, or fight the input that just opened.
   */
  function handleCellClick(e: React.MouseEvent, colId: string, field: 'load' | 'reps' | 'sets'): boolean {
    e.preventDefault();
    if (disabled) return false;
    // Del-held stays the outermost mode: an armed delete is never hijacked.
    if (deleteHeld) { removeColumn(colId); return false; }
    if (field === 'load' && cycleUnit(e)) return false;
    const col = columns.find(c => c.id === colId);
    if (!col) return false;

    if (e.ctrlKey || e.metaKey) {
      let currentValue: string;
      if (field === 'reps') currentValue = col.repsMax != null ? `${col.reps}-${col.repsMax}` : col.repsText;
      else if (field === 'load' && isFreeTextReps) currentValue = col.loadText;
      else if (field === 'load') {
        const base = col.loadMax !== null ? `${col.load}-${col.loadMax}` : String(col.load);
        // Sticky "%" suffix: when the prescription unit is percentage, the
        // edit pre-populates with "80%" so the coach can keep typing
        // numbers without re-adding the symbol. The focus effect selects
        // only the numeric portion, and the existing detectIntendedUnit
        // path converts to kg if the coach deliberately deletes the "%".
        // The soft-load sign is NOT pre-populated: typing ">=", "<=" or "~"
        // in front sets it, and the glyph's own Del-held gesture removes it —
        // so a plain retype of the number never silently drops the sign.
        // ("==" can't work here: a leading "=" opens the formula path.)
        currentValue = unit === 'percentage' ? `${base}%` : base;
      }
      else currentValue = col.setsMax != null ? `${col.sets}-${col.setsMax}` : String(col.sets);
      setEditing({ colId, field, value: currentValue });
      return false;
    }

    const isRight = e.button === 2;
    const delta = isRight ? -1 : 1;

    if (field === 'load') {
      if (isFreeTextReps) { setEditing({ colId, field: 'load', value: col.loadText }); return false; }
      if (col.loadMax !== null) {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const isRightHalf = e.clientX - rect.left > rect.width / 2;
        if (isRightHalf) {
          const nextMax = Math.max(col.load, (col.loadMax || 0) + delta);
          if (nextMax === col.loadMax) return false;
          updateColumn(colId, { loadMax: nextMax, loadText: `${col.load}-${nextMax}` });
        } else {
          const nextMin = Math.max(0, col.load + delta);
          if (nextMin === col.load) return false;
          const adjustedMax = Math.max(nextMin, col.loadMax || nextMin);
          updateColumn(colId, { load: nextMin, loadMax: adjustedMax, loadText: `${nextMin}-${adjustedMax}` });
        }
      } else {
        const next = Math.max(0, col.load + delta);
        if (next === col.load) return false;
        updateColumn(colId, { load: next, loadMax: null, loadText: String(next) });
      }
    } else if (field === 'reps') {
      if (isCombo) {
        const parts = col.repsText.split('+');
        const first = Math.max(0, (parseInt(parts[0], 10) || 0) + delta);
        if (first === (parseInt(parts[0], 10) || 0)) return false;
        parts[0] = String(first);
        const newRepsText = parts.join('+');
        const newTotalReps = parts.reduce((s, p) => s + (parseInt(p, 10) || 0), 0);
        updateColumn(colId, { repsText: newRepsText, reps: newTotalReps });
      } else {
        const next = Math.max(0, col.reps + delta);
        if (next === col.reps) return false;
        updateColumn(colId, { reps: next, repsText: String(next) });
      }
    } else {
      const next = Math.max(1, col.sets + delta);
      if (next === col.sets) return false;
      updateColumn(colId, { sets: next });
    }
    return true;
  }

  // ─── Repeatable step bodies ────────────────────────────────────────────────
  // Hoisted out of the render helpers so a held button can call them again on a
  // timer. Each re-finds its column, and each returns false at its floor so a
  // hold stops rather than spinning writes at a number that cannot move.

  function stepMultiplier(colId: string, delta: number): boolean {
    const col = columns.find(c => c.id === colId);
    if (!col) return false;
    const next = Math.max(1, (col.multiplier ?? 1) + delta);
    if (next === (col.multiplier ?? 1)) return false;
    updateColumn(colId, { multiplier: next });
    return true;
  }

  function stepComboPart(colId: string, partIdx: number, delta: number): boolean {
    const col = columns.find(c => c.id === colId);
    if (!col) return false;
    const parts = col.repsText.split('+').map(p => parseInt(p, 10) || 0);
    if (partIdx >= parts.length) return false;
    const next = Math.max(0, parts[partIdx] + delta);
    if (next === parts[partIdx]) return false;
    parts[partIdx] = next;
    updateColumn(colId, { repsText: parts.join('+'), reps: parts.reduce((s, p) => s + p, 0) });
    return true;
  }

  function stepLoadBound(colId: string, bound: 'min' | 'max', delta: number): boolean {
    const col = columns.find(c => c.id === colId);
    if (!col) return false;
    if (bound === 'min') {
      const nextMin = Math.max(0, col.load + delta);
      if (nextMin === col.load) return false;
      const adjustedMax = Math.max(nextMin, col.loadMax ?? nextMin);
      updateColumn(colId, { load: nextMin, loadMax: adjustedMax, loadText: `${nextMin}-${adjustedMax}` });
    } else {
      const nextMax = Math.max(col.load, (col.loadMax ?? 0) + delta);
      if (nextMax === col.loadMax) return false;
      updateColumn(colId, { loadMax: nextMax, loadText: `${col.load}-${nextMax}` });
    }
    return true;
  }

  function stepRangeBound(colId: string, field: 'reps' | 'sets', bound: 'min' | 'max', delta: number): boolean {
    const col = columns.find(c => c.id === colId);
    if (!col) return false;
    const floor = field === 'sets' ? 1 : 0;
    const minVal = field === 'reps' ? col.reps : col.sets;
    const rangeMax = (field === 'reps' ? col.repsMax : col.setsMax) ?? minVal;
    const patch = (min: number, max: number) => {
      if (field === 'reps') updateColumn(colId, { reps: min, repsMax: max, repsText: `${min}-${max}` });
      else updateColumn(colId, { sets: min, setsMax: max });
    };
    if (bound === 'min') {
      const nextMin = Math.max(floor, minVal + delta);
      if (nextMin === minVal) return false;
      patch(nextMin, Math.max(nextMin, rangeMax));
    } else {
      const nextMax = Math.max(minVal, rangeMax + delta);
      if (nextMax === rangeMax) return false;
      patch(minVal, nextMax);
    }
    return true;
  }

  /**
   * The step bodies as of THIS render, for the hold-to-repeat timer to call.
   * Every one of them reads `columns`, so a repeat that kept calling the
   * closure captured at mousedown would add 1 to the same number forever.
   * Dereferencing the ref per tick picks up the state the last tick wrote.
   */
  const stepsRef = useRef({ handleCellClick, stepMultiplier, stepComboPart, stepLoadBound, stepRangeBound });
  stepsRef.current = { handleCellClick, stepMultiplier, stepComboPart, stepLoadBound, stepRangeBound };

  function commitEdit() {
    if (!editing) return;
    const col = columns.find(c => c.id === editing.colId);
    if (!col) { setEditing(null); return; }

    // "#<name>" in any cell invokes a prescription preset (case-insensitive;
    // a unique prefix is enough). Checked FIRST — before formula resolution
    // and unit detection, both of which would misread the tag as text.
    const typed = editing.value.trim();
    if (typed.startsWith('#') && presets?.length && onApplyPreset) {
      const q = typed.slice(1).toLowerCase();
      const exact = presets.find(p => p.name.toLowerCase() === q);
      const prefixMatches = q.length > 0 ? presets.filter(p => p.name.toLowerCase().startsWith(q)) : [];
      const match = exact ?? (prefixMatches.length === 1 ? prefixMatches[0] : undefined);
      setEditing(null);
      // No match → discard the edit (never write "#skil" into a cell).
      if (match) onApplyPreset(match);
      return;
    }

    // A double-quoted value is a label, never notation — the escape hatch for
    // a load that contains the separator itself ("30x2" as a name, not as
    // thirty for two). Checked before the formula and before unit detection:
    // ignore the quotes and `"80x5"` is all digits, so both would claim it.
    // The percentage cell pre-populates "80%" and selects only the number, so
    // a coach who types a literal over it ends up with `"Heavy"%`. That is not
    // meaningful notation and the sticky suffix is the only way to produce it,
    // so it is dropped rather than turned into a refusal.
    const unstuck = typed.startsWith('"') && typed.endsWith('%') ? typed.slice(0, -1).trim() : typed;
    const literal = splitQuotedLiteral(unstuck);
    if (literal !== null) {
      setEditing(null);
      // Reps and sets have no textual form; writing one would store NaN.
      if (editing.field !== 'load') return;
      const text = literal.replace(/"/g, '').trim();
      if (text === '') return;
      if (isFreeTextReps) {
        updateColumn(editing.colId, { loadText: text, load: parseFloat(text) || 0, loadMax: null, loadCmp: null });
        return;
      }
      // A text load exists only under free_text_reps, so a literal in a
      // numeric row IS a unit change — carried in the same single write, or
      // the row would store the label as a load of 0.
      const switched: GridColumn[] = columns.map(c => c.id === editing.colId
        ? { ...c, loadText: text, load: parseFloat(text) || 0, loadMax: null, loadCmp: null }
        : { ...c, loadText: c.loadText || (c.loadMax != null ? `${c.load}-${c.loadMax}` : String(c.load)), loadMax: null });
      const literalRaw = formatFor(switched, 'free_text_reps');
      sentRawsRef.current.add(literalRaw);
      setColumns(switched);
      onSave(literalRaw, 'free_text_reps');
      return;
    }

    // Checked BEFORE the single-cell formula branch, which resolves the whole
    // value as one expression and discards it on failure — "=160*0.5x3" is not
    // one expression, so that branch would throw the line away. Each segment
    // resolves its own formula inside parseNotationLine instead.
    // A comma or a multiplier means the coach typed a whole prescription into
    // one cell. Expand it into columns, spliced in place of the one being
    // edited — so editing column 3 of 5 rewrites column 3, not the row.
    // Load cell only: a reps cell legitimately holds "3-5" and combo tuples,
    // where an "x" would be a typo rather than a request for more columns.
    const notationSegments = editing.field === 'load' && looksLikeNotationLine(typed)
      ? parseNotationLine(typed, { isCombo })
      : null;
    // A comma is an unambiguous multi-segment attempt, so a line that fails to
    // parse is refused rather than stored as prose. Without one, the value is
    // far more likely an ordinary text load whose spelling happens to contain
    // an "x" — "Max", "Box squat", "Complex" — so it falls through to the
    // single-value paths that have always handled those.
    if (editing.field === 'load' && !notationSegments && looksLikeNotationLine(typed) && typed.includes(',')) {
      setEditing(null);
      showNote('Could not read that line');
      return;
    }
    if (notationSegments) {
      const segments = notationSegments;
      setEditing(null);

      const idx = columns.findIndex(c => c.id === editing.colId);
      const expanded: GridColumn[] = segments.map(seg => ({
        id: nextId(),
        load: seg.load,
        loadMax: seg.loadMax,
        loadText: seg.loadText,
        // A sign typed on a segment applies to that segment; the rest inherit
        // the edited column's, so one typed ≥ never silently signs the line.
        loadCmp: seg.isText ? null : (seg.loadCmp ?? col.loadCmp),
        reps: seg.reps,
        repsMax: seg.repsMax,
        repsText: seg.repsText,
        sets: seg.sets,
        setsMax: seg.setsMax,
        multiplier: seg.multiplier ?? col.multiplier,
      }));
      const spliced = idx === -1
        ? expanded
        : [...columns.slice(0, idx), ...expanded, ...columns.slice(idx + 1)];

      // A text segment can only live under free_text_reps, whatever the rest
      // of the line looks like.
      const detected = segments.some(seg => seg.isText) ? 'free_text_reps' : detectIntendedUnit(typed);
      const effective = detected ?? unit;
      const expandedRaw = formatFor(spliced, effective);
      sentRawsRef.current.add(expandedRaw);
      setColumns(spliced);
      // One write carries both the raw and the unit — two would race inside
      // the per-exercise write chain and the loser would win the database.
      onSave(expandedRaw, detected && detected !== unit ? detected : undefined);
      return;
    }

    // Excel-style "=": resolve the arithmetic BEFORE anything else reads the
    // cell, so every downstream branch (unit detection, interval parsing, the
    // combo tuple test) sees a plain number and needs no formula awareness.
    // A load resolves with decimals, a rep / set / multiplier to a whole number.
    // A broken formula discards the edit rather than committing 0 or NaN —
    // commit also fires on blur, and clicking away from a half-typed "=80/"
    // must not silently zero the load.
    const resolved = resolveFormulaCell(
      editing.value,
      editing.field === 'load' ? 'decimal' : 'integer',
    );
    if (resolved.error) { setEditing(null); return; }
    const value = resolved.text;


    // Auto-switch unit when the coach signals one via the load cell.
    // "80%" → percentage, "Heavy" → free_text_reps, "80x5" → absolute_kg.
    // Combos use the same detection but format through formatComboPrescription
    // so the tuple reps_text ("2+1") survives the switch.
    if (editing.field === 'load') {
      // Typed soft-load sign (">=", "<=", "~" or the glyphs) activates
      // the comparator; typing without a sign KEEPS the existing one — the
      // glyph's Del-held gesture is the removal path.
      const { cmp: typedCmp, rest: unsignedText } = splitLoadCmp(value.trim());
      const text = unsignedText.trim();
      const nextCmp = typedCmp ?? col.loadCmp;
      const detected = detectIntendedUnit(text);
      if (detected && detected !== unit) {
        const switchedCols: GridColumn[] = columns.map(c => {
          if (c.id === editing.colId) {
            if (detected === 'free_text_reps') {
              return { ...c, loadText: text, load: parseFloat(text) || 0, loadMax: null, loadCmp: null };
            }
            // percentage: keep numeric storage, strip the % for parsing
            const numText = text.replace(/%/g, '');
            const dashIdx = numText.indexOf('-', 1);
            if (dashIdx !== -1) {
              const minVal = parseFloat(numText.slice(0, dashIdx));
              const maxVal = parseFloat(numText.slice(dashIdx + 1));
              if (!isNaN(minVal) && !isNaN(maxVal) && maxVal >= minVal) {
                return { ...c, load: minVal, loadMax: maxVal, loadText: `${minVal}-${maxVal}`, loadCmp: nextCmp };
              }
            }
            const val = Math.max(0, parseFloat(numText) || 0);
            return { ...c, load: val, loadMax: null, loadText: String(val), loadCmp: nextCmp };
          }
          // Other columns: when switching to free_text_reps, seed loadText
          // from the existing numeric load so format has something to print.
          if (detected === 'free_text_reps') {
            const seed = c.loadMax != null ? `${c.load}-${c.loadMax}` : String(c.load);
            return { ...c, loadText: c.loadText || seed, loadMax: null };
          }
          return c;
        });

        const raw = formatFor(switchedCols, detected);

        sentRawsRef.current.add(raw);
        setColumns(switchedCols);
        onSave(raw, detected);
        setEditing(null);
        return;
      }
    }

    if (editing.field === 'reps') {
      if (isCombo) {
        const raw = value.trim();
        const isTuple = /^\d+(\+\d+)*$/.test(raw);
        if (isTuple && raw.includes('+')) {
          const parts = raw.split('+').map(p => parseInt(p, 10) || 1);
          updateColumn(editing.colId, { repsText: raw, reps: parts.reduce((s, n) => s + n, 0) });
        } else {
          const val = Math.max(0, parseInt(raw, 10));
          updateColumn(editing.colId, { repsText: String(val), reps: val });
        }
      } else {
        // "3-5" creates a rep range (min-max), a plain number clears it —
        // same typing grammar interval loads use.
        const range = parseBoundedIntRange(value.trim(), 0);
        if (range) {
          updateColumn(editing.colId, {
            reps: range.min, repsMax: range.max,
            repsText: range.max != null ? `${range.min}-${range.max}` : String(range.min),
          });
        }
      }
    } else if (editing.field === 'load') {
      if (isFreeTextReps) {
        const text = value.trim();
        updateColumn(editing.colId, { loadText: text, load: parseFloat(text) || 0 });
      } else {
        const { cmp: typedCmp, rest } = splitLoadCmp(value.trim());
        const text = rest.trim();
        const nextCmp = typedCmp ?? col.loadCmp;
        const dashIdx = text.indexOf('-', 1);
        if (dashIdx !== -1) {
          const minVal = parseFloat(text.slice(0, dashIdx));
          const maxVal = parseFloat(text.slice(dashIdx + 1));
          if (!isNaN(minVal) && !isNaN(maxVal) && maxVal >= minVal) {
            updateColumn(editing.colId, { load: minVal, loadMax: maxVal, loadText: `${minVal}-${maxVal}`, loadCmp: nextCmp });
          }
        } else {
          const val = Math.max(0, parseFloat(text) || 0);
          updateColumn(editing.colId, { load: val, loadMax: null, loadText: String(val), loadCmp: nextCmp });
        }
      }
    } else if (editing.field === 'multiplier') {
      const val = Math.max(1, parseInt(value, 10) || (col.multiplier ?? 1));
      updateColumn(editing.colId, { multiplier: val });
    } else {
      // Sets accept a range too ("4-6").
      const range = parseBoundedIntRange(value.trim(), 1);
      if (range) {
        updateColumn(editing.colId, { sets: range.min, setsMax: range.max });
      }
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
      loadCmp: last?.loadCmp ?? null,
      reps: last ? last.reps : 1, repsMax: last?.repsMax ?? null, repsText: defaultRepsText,
      sets: 1, setsMax: null,
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
      return renderEditingInput();
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
                hold.start(() => stepsRef.current.stepMultiplier(col.id, delta));
              }}
              onContextMenu={e => e.preventDefault()}
              tabIndex={-1}
              disabled={disabled}
              title="Rounds of the combo · Left/right-click: ±1 · hold to repeat · Ctrl+click: type"
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
                const delta = e.button === 2 ? -1 : 1;
                hold.start(() => stepsRef.current.stepComboPart(col.id, partIdx, delta));
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

  /** Soft-load comparator glyph (≥ ≈ ≤) in front of the load. Click cycles
   *  forward, right-click backward, Del-held+click removes the sign (not the
   *  column). Rendered only when a sign is active — it is added by typing
   *  ">=" / "<=" / "==" into the load cell or via the row's feature menu. */
  function renderCmpButton(col: GridColumn) {
    if (!col.loadCmp) return null;
    const isDeleting = deleteHeld;
    return (
      <button
        onMouseDown={e => {
          if (e.button !== 0 && e.button !== 2) return;
          e.preventDefault();
          if (disabled) return;
          if (isDeleting) { updateColumn(col.id, { loadCmp: null }); return; }
          // The glyph sits inside the load cell, so it answers to the unit
          // cycle too — a gesture that works on some pixels of a cell and not
          // others reads as a bug.
          if (cycleUnit(e)) return;
          const order: LoadCmp[] = ['>=', '~', '<='];
          const delta = e.button === 2 ? -1 : 1;
          const idx = (order.indexOf(col.loadCmp as LoadCmp) + delta + order.length) % order.length;
          updateColumn(col.id, { loadCmp: order[idx] });
        }}
        onContextMenu={e => e.preventDefault()}
        tabIndex={-1}
        disabled={disabled}
        title={isDeleting
          ? 'Click to remove the sign'
          : 'Soft load — ≥ work up to · ≈ around · ≤ stay below · click cycles · Alt+click: unit · hold Del + click removes'}
        className="pgrid-btn"
        style={{
          minWidth: '0.8rem', padding: '0 1px', fontWeight: 700,
          color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-accent)',
        }}
      >
        {LOAD_CMP_GLYPH[col.loadCmp]}
      </button>
    );
  }

  /** What a load cell tells you on hover. The unit cycle has no visible
   *  control, so the tooltip is where it is advertised. */
  const loadCellTitle = deleteHeld
    ? 'Click to delete column'
    : `Click ±1 · Right-click −1 · hold to repeat · Ctrl+click: type a value or a whole line (30,40,50) · Alt+click: unit (now ${getUnitLabel(unit)})`;

  function renderLoadCell(col: GridColumn) {
    const isEditingThis = editing?.colId === col.id && editing.field === 'load';
    const isInterval = col.loadMax !== null;
    const isDeleting = deleteHeld;

    if (isEditingThis) {
      return renderEditingInput();
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
        if (cycleUnit(e)) return;
        if (e.ctrlKey || e.metaKey) {
          const base = `${col.load}-${col.loadMax}`;
          setEditing({ colId: col.id, field: 'load', value: unit === 'percentage' ? `${base}%` : base });
          return;
        }
        const delta = e.button === 2 ? -1 : 1;
        hold.start(() => stepsRef.current.stepLoadBound(col.id, bound, delta));
      };
      const boxTitle = (which: string) =>
        isDeleting
          ? 'Click to delete column'
          : `Adjust ${which} · Right-click: −1 · hold to repeat · Ctrl+click: edit · Alt+click: unit (now ${getUnitLabel(unit)})`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: '1.25rem' }}>
          {renderCmpButton(col)}
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

    if (!col.loadCmp) {
      return (
        <button
          onMouseDown={e => { if (e.button === 0 || e.button === 2) hold.start(() => stepsRef.current.handleCellClick(e, col.id, 'load')); }}
          onContextMenu={e => e.preventDefault()}
          tabIndex={-1}
          disabled={disabled}
          title={loadCellTitle}
          className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
        >
          <span>{loadDisplay}</span>
        </button>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: '1.25rem' }}>
        {renderCmpButton(col)}
        <button
          onMouseDown={e => { if (e.button === 0 || e.button === 2) hold.start(() => stepsRef.current.handleCellClick(e, col.id, 'load')); }}
          onContextMenu={e => e.preventDefault()}
          tabIndex={-1}
          disabled={disabled}
          title={loadCellTitle}
          className={`pgrid-btn${isDeleting ? ' pgrid-btn-del' : ''}`}
        >
          <span>{loadDisplay}</span>
        </button>
      </div>
    );
  }

  /** Two-bound cell for a rep range ("3-5") or set range ("4-6") — mirrors
   *  the interval-load cell: left box = lower bound, right box = upper,
   *  click ±1 per bound, Ctrl+click to type, Del-held+click deletes column.
   *  Created by typing "a-b" into the cell; typing a plain number collapses
   *  the range back to a fixed value. */
  function renderRangeCell(col: GridColumn, field: 'reps' | 'sets', rangeMax: number) {
    const isDeleting = deleteHeld;
    const minVal = field === 'reps' ? col.reps : col.sets;
    const adjustBound = (bound: 'min' | 'max', e: React.MouseEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      if (disabled) return;
      if (isDeleting) { removeColumn(col.id); return; }
      if (e.ctrlKey || e.metaKey) {
        setEditing({ colId: col.id, field, value: `${minVal}-${rangeMax}` });
        return;
      }
      const delta = e.button === 2 ? -1 : 1;
      hold.start(() => stepsRef.current.stepRangeBound(col.id, field, bound, delta));
    };
    const boxTitle = (which: string) =>
      isDeleting ? 'Click to delete column' : `Adjust ${which} · Right-click: −1 · hold to repeat · Ctrl+click: edit`;
    const setsCls = field === 'sets' ? ' pgrid-btn-sets' : '';
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: '1.25rem' }}>
        <button
          onMouseDown={e => adjustBound('min', e)}
          onContextMenu={e => e.preventDefault()}
          tabIndex={-1}
          disabled={disabled}
          title={boxTitle('min')}
          className={`pgrid-btn${setsCls}${isDeleting ? ' pgrid-btn-del' : ''}`}
          style={{ minWidth: '1rem', padding: '0 2px' }}
        >
          {minVal}
        </button>
        <span style={{ fontSize: 10, lineHeight: 1, userSelect: 'none', color: isDeleting ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)' }}>-</span>
        <button
          onMouseDown={e => adjustBound('max', e)}
          onContextMenu={e => e.preventDefault()}
          tabIndex={-1}
          disabled={disabled}
          title={boxTitle('max')}
          className={`pgrid-btn${setsCls}${isDeleting ? ' pgrid-btn-del' : ''}`}
          style={{ minWidth: '1rem', padding: '0 2px' }}
        >
          {rangeMax}
        </button>
      </div>
    );
  }

  function renderCell(col: GridColumn, field: 'reps' | 'sets', displayValue: string) {
    const isEditingThis = editing?.colId === col.id && editing.field === field;

    if (isEditingThis) {
      return renderEditingInput();
    }

    const rangeMax = field === 'reps' ? col.repsMax : col.setsMax;
    if (rangeMax != null) return renderRangeCell(col, field, rangeMax);

    const isSetCell = field === 'sets';
    const isSetsOne = col.sets === 1;
    const isDeleting = deleteHeld;

    return (
      <button
        onMouseDown={e => { if (e.button === 0 || e.button === 2) hold.start(() => stepsRef.current.handleCellClick(e, col.id, field)); }}
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

      {note && <span className="pgrid-note">{note}</span>}
    </div>
  );
}
