import { useState, useRef, useEffect } from 'react';
import {
  fmtNumber, inferUnitFromInput, parseTargetNumber, unitSuffix,
  type MacroTargetUnit,
} from '../../lib/macroTargetUnit';
import { useRepeatOnHold } from '../../hooks/useRepeatOnHold';

interface MacroGridCellProps {
  load: number | null;
  reps: number | null;
  sets: number | null;
  /** The COLUMN's unit — every cell in an exercise column shares it. */
  unit?: MacroTargetUnit;
  /** Prose load, for a free-text column. */
  loadText?: string | null;
  prevLoad?: number | null;
  prevReps?: number | null;
  prevSets?: number | null;
  onUpdate: (values: {
    load?: number | null;
    reps?: number;
    sets?: number;
    /** Set when the typed value implies a different unit for the column. */
    unit?: MacroTargetUnit;
    loadText?: string | null;
  }) => void;
  disabled?: boolean;
  deleteMode?: boolean;
  onDelete?: () => void;
  compact?: boolean; // summary rows: load only, no reps/sets, reduced height
}

export function MacroGridCell({
  load, reps, sets,
  unit = 'absolute_kg',
  loadText = null,
  prevLoad, prevReps, prevSets,
  onUpdate, disabled,
  deleteMode, onDelete,
  compact,
}: MacroGridCellProps) {
  const isText = unit === 'free_text_reps';
  const [editing, setEditing] = useState<'load' | 'reps' | null>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const setsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing === 'load' && loadRef.current) {
      loadRef.current.focus();
      loadRef.current.select();
    }
    if (editing === 'reps' && repsRef.current) {
      repsRef.current.focus();
      repsRef.current.select();
    }
  }, [editing]);

  const isEmpty = load === null && reps === null && sets === null && !loadText?.trim();
  const hasPrev = prevLoad !== null && prevLoad !== undefined;
  const isDeleteMode = deleteMode && !isEmpty && !disabled;
  const hold = useRepeatOnHold();

  function fillFromPrev(delta: number = 0) {
    const newLoad = (prevLoad ?? 0) + delta;
    const newReps = prevReps ?? 1;
    const newSets = prevSets ?? 1;
    onUpdate({ load: Math.max(0, newLoad), reps: newReps, sets: newSets });
  }

  // Each handler returns true only for a plain ±1 step — the one gesture worth
  // repeating while the button is held. Clearing a cell, opening the editor and
  // seeding an empty cell from last week are all one-shot, so they return false
  // and the hold never arms.

  function handleLoadClick(e: React.MouseEvent): boolean {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return false;

    if (isDeleteMode) {
      onDelete?.();
      return false;
    }

    // "Heavy" + 1 is meaningless, so a free-text cell always opens the editor
    // instead of stepping.
    if (e.ctrlKey || e.metaKey || isText) {
      setEditing('load');
      return false;
    }

    if (isEmpty) {
      fillFromPrev(0);
      return false;
    }

    const delta = e.button === 2 ? -1 : 1;
    const next = Math.max(0, (load ?? 0) + delta);
    if (next === (load ?? 0)) return false;
    onUpdate({ load: next });
    return true;
  }

  function handleRepsClick(e: React.MouseEvent): boolean {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return false;

    if (isDeleteMode) {
      onDelete?.();
      return false;
    }

    if (e.ctrlKey || e.metaKey) {
      setEditing('reps');
      return false;
    }

    if (isEmpty) {
      fillFromPrev(0);
      return false;
    }

    const delta = e.button === 2 ? -1 : 1;

    if (e.shiftKey) return stepSets(delta);
    const next = Math.max(1, (reps ?? 1) + delta);
    if (next === (reps ?? 1)) return false;
    onUpdate({ reps: next });
    return true;
  }

  function stepSets(delta: number): boolean {
    if (disabled) return false;
    const next = Math.max(1, (sets ?? 1) + delta);
    if (next === (sets ?? 1)) return false;
    onUpdate({ sets: next });
    return true;
  }

  // The repeat re-runs a step on a timer, and every one of them reads this
  // render's load/reps/sets props — so it must call the LATEST handler, not the
  // closure captured at mousedown, or a hold would step the same number once.
  const stepsRef = useRef({ handleLoadClick, handleRepsClick, stepSets });
  stepsRef.current = { handleLoadClick, handleRepsClick, stepSets };

  /**
   * Commit a typed load. What the coach types decides the COLUMN's unit, using
   * the prescription grid's own rule — "88%" makes it a percentage column,
   * letters make it free text, a plain number makes it kilograms. parseFloat
   * with comma decimals, not the old parseInt, so 117,5 is finally typable.
   */
  function commitLoad(val: string) {
    const inferred = inferUnitFromInput(val);
    const nextUnit = inferred ?? unit;
    setEditing(null);
    if (nextUnit === 'free_text_reps') {
      const text = val.trim();
      onUpdate({ unit: nextUnit, loadText: text || null, load: null });
      return;
    }
    const n = parseTargetNumber(val);
    onUpdate({ unit: nextUnit, loadText: null, load: n == null ? 0 : Math.max(0, n) });
  }

  function commitReps(repsVal: string, setsVal: string) {
    onUpdate({
      reps: Math.max(1, parseInt(repsVal) || 1),
      sets: Math.max(1, parseInt(setsVal) || 1),
    });
    setEditing(null);
  }

  const setsIsOne = (sets ?? 1) <= 1;

  // Empty (unactivated) cell.
  //
  // It used to *render* the previous week's load as a faint italic ghost. The
  // behaviour is right — clicking seeds the cell from last week — but drawing
  // the number made a mostly-empty cycle read as if it were full of values, so
  // the actual plan drowned in ghosts. Now the cell is a neutral placeholder
  // and the previous value lives in the tooltip instead, where it explains
  // what the click will do without competing with real data.
  if (isEmpty) {
    return (
      <div
        className="group flex items-center justify-center cursor-pointer select-none rounded transition-colors hover:bg-[var(--color-accent-muted)]"
        style={{ minWidth: 52, height: 38 }}
        title={
          hasPrev
            ? `Click to start from last week's value (${fmtNumber(prevLoad!)}) · Ctrl+click to type`
            : 'Click to start a max set · Ctrl+click to type. A % makes the column percentages; words make it free text.'
        }
        onMouseDown={e => { if (e.button === 0 || e.button === 2) hold.start(() => stepsRef.current.handleLoadClick(e)); }}
        onContextMenu={e => e.preventDefault()}
      >
        <span className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>-</span>
      </div>
    );
  }

  // Editing load
  if (editing === 'load') {
    return (
      <div className="group flex items-center" style={{ minWidth: 52, height: 38 }}>
        <div className="flex flex-col items-center flex-1">
          {/* type="text": a number input cannot accept '%' or letters, which is
              what makes a percentage or free-text column typable at all. */}
          <input
            ref={loadRef}
            type="text"
            inputMode={isText ? 'text' : 'decimal'}
            defaultValue={isText ? (loadText ?? '') : load != null ? fmtNumber(load) : ''}
            className="no-spin w-[52px] text-center font-mono text-[11px] font-medium border-none outline-none rounded px-1 py-0.5"
            style={{ backgroundColor: 'var(--color-accent-muted)' }}
            onBlur={(e) => commitLoad(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(null);
              if (e.key === 'Tab') {
                e.preventDefault();
                commitLoad((e.target as HTMLInputElement).value);
                setEditing('reps');
              }
            }}
          />
          <div className="w-[80%] border-t my-0.5" style={{ borderColor: 'var(--color-border-tertiary)' }} />
          <div className="text-[9px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{reps ?? 1}</div>
        </div>
        {!setsIsOne && (
          <div className="text-[9px] font-mono self-center pl-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{sets}</div>
        )}
      </div>
    );
  }

  // Editing reps + sets
  if (editing === 'reps') {
    return (
      <div className="group flex items-center" style={{ minWidth: 52, height: 38 }}>
        <div className="flex flex-col items-center flex-1">
          <div className="text-[11px] font-mono font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {isText ? (loadText ?? '') : `${fmtNumber(load ?? 0)}${unitSuffix(unit)}`}
          </div>
          <div className="w-[80%] border-t my-0.5" style={{ borderColor: 'var(--color-border-tertiary)' }} />
          <div className="flex items-center gap-0.5">
            <input
              ref={repsRef}
              type="number"
              defaultValue={reps ?? 1}
              min={1}
              className="no-spin w-[22px] text-center font-mono text-[9px] border-none outline-none rounded px-0.5 py-0.5"
              style={{ backgroundColor: 'var(--color-accent-muted)' }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  setsRef.current?.focus();
                  setsRef.current?.select();
                }
                if (e.key === 'Enter') {
                  commitReps(
                    (e.target as HTMLInputElement).value,
                    setsRef.current?.value ?? String(sets ?? 1),
                  );
                }
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          </div>
        </div>
        <input
          ref={setsRef}
          type="number"
          defaultValue={sets ?? 1}
          min={1}
          className="no-spin w-[18px] text-center font-mono text-[9px] border-none outline-none rounded px-0.5 py-0.5 self-center"
          style={{ backgroundColor: 'var(--color-accent-muted)' }}
          onBlur={(e) => {
            commitReps(
              repsRef.current?.value ?? String(reps ?? 1),
              e.target.value,
            );
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(null);
          }}
        />
      </div>
    );
  }

  // Compact display — summary rows: load only, no reps/sets
  if (compact) {
    return (
      <div className="flex items-center justify-center" style={{ minWidth: 52, height: 20 }}>
        {load != null && !isText ? (
          <span className="text-[8px] font-mono italic" style={{ color: 'var(--color-text-tertiary)' }}>
            {fmtNumber(load)}{unitSuffix(unit)}
          </span>
        ) : (
          <span className="text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </div>
    );
  }

  // Normal display
  return (
    <div
      className={`group flex items-center select-none rounded border transition-colors ${
        isDeleteMode
          ? 'border-[color:var(--color-danger-border)] bg-[var(--color-danger-bg)] cursor-pointer'
          : 'border-transparent hover:bg-[var(--color-accent-muted)] hover:border-[color:var(--color-accent-border)]'
      }`}
      style={{ minWidth: 52, height: 38 }}
    >
      {/* Load / divider / reps stack */}
      <div className="flex flex-col items-center flex-1">
        <div
          className={`text-[11px] font-mono font-medium cursor-pointer px-2 leading-tight ${
            isDeleteMode ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-primary)]'
          }`}
          title={isDeleteMode
            ? 'Click to clear'
            : isText
            ? 'Click to type. Type a number for kg, or add % for percentages.'
            : `Load: click +1 · right-click −1 · hold to repeat · Ctrl+click to type${unit === 'percentage' ? ' · this column is in %' : ''}`}
          onMouseDown={e => { if (e.button === 0 || e.button === 2) hold.start(() => stepsRef.current.handleLoadClick(e)); }}
          onContextMenu={e => e.preventDefault()}
        >
          {isText ? (loadText ?? '—') : `${fmtNumber(load ?? 0)}${unitSuffix(unit)}`}
        </div>
        <div className={`w-[80%] border-t ${isDeleteMode ? 'border-[color:var(--color-danger-border)]' : 'border-[color:var(--color-border-tertiary)]'}`} />
        <div
          className={`text-[9px] font-mono cursor-pointer px-2 leading-tight ${
            isDeleteMode ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text-secondary)]'
          }`}
          title={isDeleteMode ? 'Click to clear' : 'Reps: click +1 · right-click −1 · hold to repeat · Shift for sets · Ctrl+click to type'}
          onMouseDown={e => { if (e.button === 0 || e.button === 2) hold.start(() => stepsRef.current.handleRepsClick(e)); }}
          onContextMenu={e => e.preventDefault()}
        >
          {reps ?? 1}
        </div>
      </div>

      {/* Sets count — right side; hidden when 1 (hover to reveal), always visible when >1 */}
      <div
        className={`text-[9px] font-mono self-center pr-1.5 pl-1 py-2 cursor-pointer transition-opacity ${
          setsIsOne
            ? 'opacity-0 group-hover:opacity-40'
            : (isDeleteMode ? 'opacity-80 text-[color:var(--color-danger-text)]' : 'opacity-80 text-[color:var(--color-text-tertiary)]')
        } ${isDeleteMode && !setsIsOne ? '' : 'text-[color:var(--color-text-tertiary)]'}`}
        title={isDeleteMode ? 'Click to clear' : 'Sets: click +1 · right-click −1 · hold to repeat'}
        onMouseDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          if (isDeleteMode) { onDelete?.(); return; }
          const delta = e.button === 2 ? -1 : 1;
          hold.start(() => stepsRef.current.stepSets(delta));
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {sets ?? 1}
      </div>
    </div>
  );
}
