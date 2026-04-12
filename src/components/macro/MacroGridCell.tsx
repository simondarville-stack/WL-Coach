import { useState, useRef, useEffect } from 'react';

interface MacroGridCellProps {
  load: number | null;
  reps: number | null;
  sets: number | null;
  prevLoad?: number | null;
  prevReps?: number | null;
  prevSets?: number | null;
  onUpdate: (values: { load?: number; reps?: number; sets?: number }) => void;
  disabled?: boolean;
  deleteMode?: boolean;
  onDelete?: () => void;
  compact?: boolean; // summary rows: load only, no reps/sets, reduced height
}

export function MacroGridCell({
  load, reps, sets,
  prevLoad, prevReps, prevSets,
  onUpdate, disabled,
  deleteMode, onDelete,
  compact,
}: MacroGridCellProps) {
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

  const isEmpty = load === null && reps === null && sets === null;
  const hasPrev = prevLoad !== null && prevLoad !== undefined;
  const isDeleteMode = deleteMode && !isEmpty && !disabled;

  function fillFromPrev(delta: number = 0) {
    const newLoad = (prevLoad ?? 0) + delta;
    const newReps = prevReps ?? 1;
    const newSets = prevSets ?? 1;
    onUpdate({ load: Math.max(0, newLoad), reps: newReps, sets: newSets });
  }

  function handleLoadClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    if (isDeleteMode) {
      onDelete?.();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      setEditing('load');
      return;
    }

    if (isEmpty) {
      fillFromPrev(0);
      return;
    }

    const delta = e.button === 2 ? -1 : 1;
    onUpdate({ load: Math.max(0, (load ?? 0) + delta) });
  }

  function handleRepsClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    if (isDeleteMode) {
      onDelete?.();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      setEditing('reps');
      return;
    }

    if (isEmpty) {
      fillFromPrev(0);
      return;
    }

    const delta = e.button === 2 ? -1 : 1;

    if (e.shiftKey) {
      onUpdate({ sets: Math.max(1, (sets ?? 1) + delta) });
    } else {
      onUpdate({ reps: Math.max(1, (reps ?? 1) + delta) });
    }
  }

  function commitLoad(val: string) {
    const v = Math.max(0, parseInt(val) || 0);
    onUpdate({ load: v });
    setEditing(null);
  }

  function commitReps(repsVal: string, setsVal: string) {
    onUpdate({
      reps: Math.max(1, parseInt(repsVal) || 1),
      sets: Math.max(1, parseInt(setsVal) || 1),
    });
    setEditing(null);
  }

  const setsIsOne = (sets ?? 1) <= 1;

  // Empty cell — show ghost of previous week
  if (isEmpty) {
    return (
      <div
        className="group flex items-center justify-center cursor-pointer select-none rounded transition-colors hover:bg-blue-50"
        style={{ minWidth: 52, height: 38 }}
        onClick={handleLoadClick}
        onContextMenu={handleLoadClick}
      >
        {hasPrev ? (
          <span className="text-[9px] text-gray-300 italic font-mono">{prevLoad}</span>
        ) : (
          <span className="text-[9px] text-gray-300">-</span>
        )}
      </div>
    );
  }

  // Editing load
  if (editing === 'load') {
    return (
      <div className="group flex items-center" style={{ minWidth: 52, height: 38 }}>
        <div className="flex flex-col items-center flex-1">
          <input
            ref={loadRef}
            type="number"
            defaultValue={load ?? 0}
            className="w-[40px] text-center font-mono text-[11px] font-medium border-none outline-none bg-blue-50 rounded px-1 py-0.5"
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
          <div className="w-[80%] border-t border-gray-200 my-0.5" />
          <div className="text-[9px] font-mono text-gray-400">{reps ?? 1}</div>
        </div>
        {!setsIsOne && (
          <div className="text-[9px] font-mono text-gray-400 self-center pl-0.5">{sets}</div>
        )}
      </div>
    );
  }

  // Editing reps + sets
  if (editing === 'reps') {
    return (
      <div className="group flex items-center" style={{ minWidth: 52, height: 38 }}>
        <div className="flex flex-col items-center flex-1">
          <div className="text-[11px] font-mono font-medium text-gray-900">{load ?? 0}</div>
          <div className="w-[80%] border-t border-gray-200 my-0.5" />
          <div className="flex items-center gap-0.5">
            <input
              ref={repsRef}
              type="number"
              defaultValue={reps ?? 1}
              min={1}
              className="w-[22px] text-center font-mono text-[9px] border-none outline-none bg-blue-50 rounded px-0.5 py-0.5"
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
          className="w-[18px] text-center font-mono text-[9px] border-none outline-none bg-blue-50 rounded px-0.5 py-0.5 self-center"
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
        {load ? (
          <span className="text-[8px] font-mono text-gray-400 italic">{load}</span>
        ) : (
          <span className="text-[8px] text-gray-200">—</span>
        )}
      </div>
    );
  }

  // Normal display
  return (
    <div
      className={`group flex items-center select-none rounded border transition-colors ${
        isDeleteMode
          ? 'border-red-300 bg-red-50 cursor-pointer'
          : 'border-transparent hover:bg-blue-50 hover:border-blue-100'
      }`}
      style={{ minWidth: 52, height: 38 }}
    >
      {/* Load / divider / reps stack */}
      <div className="flex flex-col items-center flex-1">
        <div
          className={`text-[11px] font-mono font-medium cursor-pointer px-2 leading-tight ${
            isDeleteMode ? 'text-red-500' : 'text-gray-900'
          }`}
          onClick={handleLoadClick}
          onContextMenu={handleLoadClick}
        >
          {load ?? 0}
        </div>
        <div className={`w-[80%] border-t ${isDeleteMode ? 'border-red-200' : 'border-gray-200'}`} />
        <div
          className={`text-[9px] font-mono cursor-pointer px-2 leading-tight ${
            isDeleteMode ? 'text-red-400' : 'text-gray-500'
          }`}
          onClick={handleRepsClick}
          onContextMenu={handleRepsClick}
        >
          {reps ?? 1}
        </div>
      </div>

      {/* Sets count — right side; hidden when 1 (hover to reveal), always visible when >1 */}
      <div
        className={`text-[9px] font-mono self-center pr-1.5 pl-1 py-2 cursor-pointer transition-opacity ${
          setsIsOne
            ? 'opacity-0 group-hover:opacity-40'
            : (isDeleteMode ? 'opacity-80 text-red-400' : 'opacity-80 text-gray-400')
        } ${isDeleteMode && !setsIsOne ? '' : 'text-gray-400'}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isDeleteMode) { onDelete?.(); return; }
          if (!disabled) onUpdate({ sets: Math.max(1, (sets ?? 1) + (e.button === 2 ? -1 : 1)) });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isDeleteMode) { onDelete?.(); return; }
          if (!disabled) onUpdate({ sets: Math.max(1, (sets ?? 1) - 1) });
        }}
      >
        {sets ?? 1}
      </div>
    </div>
  );
}
