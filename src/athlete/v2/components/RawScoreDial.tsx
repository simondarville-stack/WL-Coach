/**
 * RawScoreDial — four-axis readiness score (1–3 each, 4–12 total).
 *
 * Axes are currently fixed in the schema. Coach-configurable axes are
 * scheduled for P7; this component stays read-friendly to a future
 * settings shape by accepting an axes prop.
 */
import { useEffect, useState } from 'react';

interface Axis {
  key: 'sleep' | 'physical' | 'mood' | 'nutrition';
  label: string;
}

const AXES: Axis[] = [
  { key: 'sleep', label: 'Sleep' },
  { key: 'physical', label: 'Physical' },
  { key: 'mood', label: 'Mood' },
  { key: 'nutrition', label: 'Nutrition' },
];

const SCALE = [1, 2, 3] as const;

const SCALE_COLOR: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-emerald-500',
};

const SCALE_RING: Record<number, string> = {
  1: 'ring-red-500/50',
  2: 'ring-amber-500/50',
  3: 'ring-emerald-500/50',
};

export interface RawScores {
  sleep: number | null;
  physical: number | null;
  mood: number | null;
  nutrition: number | null;
}

interface RawScoreDialProps {
  value: RawScores;
  onChange: (next: RawScores, total: number | null) => void;
  disabled?: boolean;
}

export function RawScoreDial({ value, onChange, disabled }: RawScoreDialProps) {
  // Local mirror so the UI feels snappy if parent state lags
  const [local, setLocal] = useState<RawScores>(value);
  useEffect(() => setLocal(value), [value]);

  const total = computeTotal(local);

  const setAxis = (key: Axis['key'], score: number) => {
    if (disabled) return;
    const next = { ...local, [key]: score };
    setLocal(next);
    onChange(next, computeTotal(next));
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
          Readiness
        </div>
        <div className="text-sm font-bold text-white">
          {total ?? '—'}
          <span className="text-xs text-gray-500 font-normal ml-1">/12</span>
        </div>
      </div>

      <div className="space-y-2">
        {AXES.map(axis => (
          <div key={axis.key} className="flex items-center gap-3">
            <div className="text-xs text-gray-400 w-16 flex-shrink-0">{axis.label}</div>
            <div className="flex-1 grid grid-cols-3 gap-1">
              {SCALE.map(score => {
                const selected = local[axis.key] === score;
                return (
                  <button
                    key={score}
                    onClick={() => setAxis(axis.key, score)}
                    disabled={disabled}
                    className={`
                      h-8 rounded-md text-xs font-semibold transition-all
                      ${selected
                        ? `${SCALE_COLOR[score]} text-white shadow ring-2 ${SCALE_RING[score]}`
                        : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'}
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    {score}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function computeTotal(s: RawScores): number | null {
  const vals = [s.sleep, s.physical, s.mood, s.nutrition];
  if (vals.some(v => v == null)) return null;
  return (vals as number[]).reduce((a, b) => a + b, 0);
}
