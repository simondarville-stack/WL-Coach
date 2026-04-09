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
}

export function MacroGridCell({
  load, reps, sets,
  prevLoad, prevReps, prevSets,
  onUpdate, disabled,
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

  // Empty cell — show ghost of previous week
  if (isEmpty) {
    return (
      <div
        className="flex items-center justify-center cursor-pointer select-none rounded transition-colors hover:bg-blue-50"
        style={{ minWidth: 48, height: 34 }}
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
      <div className="flex items-center" style={{ minWidth: 48, height: 34 }}>
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
        {(sets ?? 1) > 1 && (
          <div className="text-[9px] font-mono text-gray-400 self-center pl-0.5">{sets}</div>
        )}
      </div>
    );
  }

  // Editing reps + sets
  if (editing === 'reps') {
    return (
      <div className="flex items-center" style={{ minWidth: 48, height: 34 }}>
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

  // Normal display
  return (
    <div
      className="flex items-center select-none rounded border border-transparent hover:border-gray-200 transition-colors"
      style={{ minWidth: 48, height: 34 }}
    >
      {/* Load / divider / reps stack */}
      <div className="flex flex-col items-center flex-1">
        <div
          className="text-[11px] font-mono font-medium text-gray-900 cursor-pointer px-2 leading-tight"
          onClick={handleLoadClick}
          onContextMenu={handleLoadClick}
        >
          {load ?? 0}
        </div>
        <div className="w-[80%] border-t border-gray-200" />
        <div
          className="text-[9px] font-mono text-gray-500 cursor-pointer px-2 leading-tight"
          onClick={handleRepsClick}
          onContextMenu={handleRepsClick}
        >
          {reps ?? 1}
        </div>
      </div>

      {/* Sets count — right side, aligned with divider */}
      {(sets ?? 1) > 1 && (
        <div
          className="text-[9px] font-mono text-gray-400 self-center pr-1 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) onUpdate({ sets: Math.max(1, (sets ?? 1) + (e.button === 2 ? -1 : 1)) });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) onUpdate({ sets: Math.max(1, (sets ?? 1) - 1) });
          }}
        >
          {sets}
        </div>
      )}
    </div>
  );
}
