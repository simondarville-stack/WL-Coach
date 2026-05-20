/**
 * VasField — Visual Analog Scale (0–10) pain rating.
 *
 * Only rendered when the coach has toggled VAS tracking on for the week.
 * 0 = no pain, 10 = worst pain imaginable. Stored as numeric so a coach
 * who treats it as 0.5-step can do so, but the slider snaps to integers
 * since that's what athletes report in practice.
 */
import { useEffect, useRef, useState } from 'react';

interface VasFieldProps {
  value: number | null;
  onChange: (next: number | null) => void | Promise<void>;
}

export function VasField({ value, onChange }: VasFieldProps) {
  const [local, setLocal] = useState<number | null>(value);
  useEffect(() => { setLocal(value); }, [value]);
  /** Debounce timer for commit-on-change (covers navigate-away before pointer-up). */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (next: number | null) => {
    if (debounceRef.current != null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setLocal(next);
    void onChange(next);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseInt(e.target.value, 10);
    setLocal(next);
    // Debounced commit: fires 300 ms after last drag tick if pointer-up
    // hasn't already committed. Prevents silent data loss on navigation.
    if (debounceRef.current != null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void onChange(next);
    }, 300);
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
          VAS pain
        </label>
        <span className="text-[10px] text-gray-500">0 none · 10 worst</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={local ?? 0}
          onChange={handleSliderChange}
          onMouseUp={() => commit(local)}
          onTouchEnd={() => commit(local)}
          onKeyUp={() => commit(local)}
          className="flex-1"
        />
        <span className={`text-lg font-bold tabular-nums w-7 text-center ${
          local == null ? 'text-gray-600' : local <= 3 ? 'text-emerald-300' : local <= 6 ? 'text-amber-300' : 'text-red-300'
        }`}>
          {local ?? '–'}
        </span>
        {local != null && (
          <button
            onClick={() => commit(null)}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5"
            title="Clear"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}
