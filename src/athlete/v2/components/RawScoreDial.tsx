/**
 * RawScoreDial — Eleiko-style readiness assessment.
 *
 * Four axes (sleep / energy / soreness / stress), each scored 1–5.
 * Total 4–20, mapped to a guidance band that suggests a training
 * adjustment for the day.
 *
 * Behaviour:
 * - Pending: full input grid for all four axes
 * - Filled (all four axes set): collapses to a compact summary chip
 *   showing total + band label + advice; tap to expand and edit
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  ELEIKO_RAW_AXES,
  getRawGuidance,
  rawAxisRange,
  type RawAxis,
  type RawBand,
} from '../../../lib/trainingLogModel';

const SCALE = [1, 2, 3, 4, 5] as const;

const SCALE_COLOR: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-orange-500',
  3: 'bg-amber-500',
  4: 'bg-lime-500',
  5: 'bg-emerald-500',
};

const SCALE_RING: Record<number, string> = {
  1: 'ring-red-500/50',
  2: 'ring-orange-500/50',
  3: 'ring-amber-500/50',
  4: 'ring-lime-500/50',
  5: 'ring-emerald-500/50',
};

const BAND_CLASS: Record<RawBand, string> = {
  green: 'bg-emerald-900/40 border-emerald-700/60 text-emerald-200',
  lime: 'bg-lime-900/40 border-lime-700/60 text-lime-200',
  amber: 'bg-amber-900/40 border-amber-700/60 text-amber-200',
  red: 'bg-red-900/40 border-red-700/60 text-red-200',
};

const BAND_DOT: Record<RawBand, string> = {
  green: 'bg-emerald-400',
  lime: 'bg-lime-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
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
  const [local, setLocal] = useState<RawScores>(value);
  useEffect(() => setLocal(value), [value]);

  const total = computeTotal(local);
  const allFilled = total != null;
  const guidance = getRawGuidance(total);
  const range = rawAxisRange();

  const [expanded, setExpanded] = useState<boolean>(!allFilled);

  // Auto-collapse once filled, auto-expand if cleared.
  useEffect(() => {
    setExpanded(!allFilled);
  }, [allFilled]);

  const setAxis = (key: RawAxis['key'], score: number) => {
    if (disabled) return;
    const next = { ...local, [key]: score };
    setLocal(next);
    onChange(next, computeTotal(next));
  };

  // ─── Collapsed summary ─────────────────────────────────────────────────
  if (!expanded && allFilled && guidance) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`w-full rounded-xl border px-3 py-2.5 flex items-start gap-3 text-left transition-colors ${BAND_CLASS[guidance.band]}`}
        aria-expanded={false}
      >
        <span className={`w-2.5 h-2.5 rounded-full ${BAND_DOT[guidance.band]} mt-1.5 flex-shrink-0`} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
              Readiness
            </span>
            <span className="text-base font-bold text-white">
              {total}
              <span className="text-[10px] opacity-60 font-normal ml-1">/ {range.max}</span>
            </span>
            <span className="text-xs font-semibold">{guidance.label}</span>
          </div>
          <p className="text-[11px] mt-1 opacity-90 leading-snug">{guidance.advice}</p>
        </div>
        <ChevronDown size={14} className="flex-shrink-0 mt-1 opacity-60" />
      </button>
    );
  }

  // ─── Expanded grid ─────────────────────────────────────────────────────
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
          Readiness (RAW)
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-white">
            {total ?? '—'}
            <span className="text-xs text-gray-500 font-normal ml-1">/ {range.max}</span>
          </div>
          {allFilled && (
            <button
              onClick={() => setExpanded(false)}
              className="text-gray-500 hover:text-white"
              title="Collapse"
              aria-label="Collapse readiness"
            >
              <ChevronUp size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {ELEIKO_RAW_AXES.map(axis => (
          <div key={axis.key}>
            <div className="flex items-baseline justify-between mb-0.5">
              <span className="text-xs text-gray-300 font-medium">{axis.label}</span>
              <span className="text-[9px] text-gray-500">{axis.description}</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
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
                    aria-label={`${axis.label}: ${score}`}
                    aria-pressed={selected}
                  >
                    {score}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {guidance && (
        <div className={`rounded-md border px-2.5 py-2 flex items-start gap-2 ${BAND_CLASS[guidance.band]}`}>
          <span className={`w-2 h-2 rounded-full ${BAND_DOT[guidance.band]} mt-1.5 flex-shrink-0`} aria-hidden />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold">{guidance.label}</span>
              {guidance.intensityAdjustment !== 1.0 && (
                <span className="text-[10px] opacity-70">
                  · suggest {Math.round(guidance.intensityAdjustment * 100)}% of planned load
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5 opacity-95 leading-snug">{guidance.advice}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function computeTotal(s: RawScores): number | null {
  const vals = [s.sleep, s.physical, s.mood, s.nutrition];
  if (vals.some(v => v == null)) return null;
  return (vals as number[]).reduce((a, b) => a + b, 0);
}
