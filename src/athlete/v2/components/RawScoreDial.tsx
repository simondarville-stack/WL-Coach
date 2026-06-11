/**
 * RawScoreDial — Eleiko Readiness and Wellbeing assessment.
 *
 * Four pillars (Sleep, Physical, Mood, Nutrition), each 1–3, total 4–12.
 * Three guidance bands match the official "Interpreting Your RAW Score"
 * card (4–6, 7–9, 10–12).
 *
 * Behaviour:
 * - Pending: full input grid for all four pillars
 * - Filled (all four set): collapses to a coloured chip showing the
 *   band's headline and bullets; tap to re-expand
 * - Primitive-dep effect sync so a parent re-render with a fresh
 *   `value` reference doesn't reset the local state mid-tap.
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

const SCORE_COLOR: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-emerald-500',
};

const SCORE_RING: Record<number, string> = {
  1: 'ring-red-500/50',
  2: 'ring-amber-500/50',
  3: 'ring-emerald-500/50',
};

const BAND_CLASS: Record<RawBand, string> = {
  green: 'bg-emerald-900/40 border-emerald-700/60 text-emerald-200',
  amber: 'bg-amber-900/40 border-amber-700/60 text-amber-200',
  red: 'bg-red-900/40 border-red-700/60 text-red-200',
};

const BAND_DOT: Record<RawBand, string> = {
  green: 'bg-emerald-400',
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
  // Mirror server state locally; sync on primitive deps so a parent
  // re-render with a fresh `value` object literal does not stomp a
  // half-finished tap sequence.
  const [local, setLocal] = useState<RawScores>(value);
  useEffect(() => {
    setLocal({
      sleep: value.sleep,
      physical: value.physical,
      mood: value.mood,
      nutrition: value.nutrition,
    });
  }, [value.sleep, value.physical, value.mood, value.nutrition]);

  const total = computeTotal(local);
  const allFilled = total != null;
  const guidance = getRawGuidance(total);
  const range = rawAxisRange();

  const [expanded, setExpanded] = useState<boolean>(!allFilled);
  useEffect(() => { setExpanded(!allFilled); }, [allFilled]);

  const setAxis = (key: RawAxis['key'], score: number) => {
    if (disabled) return;
    const next = { ...local, [key]: score };
    setLocal(next);
    onChange(next, computeTotal(next));
  };

  const activeRating = (axis: RawAxis): string | null => {
    const v = local[axis.key];
    if (v == null) return null;
    return axis.ratings.find(r => r.score === v)?.description ?? null;
  };

  // ─── Collapsed summary ─────────────────────────────────────────────────
  if (!expanded && allFilled && guidance) {
    return (
      <div className={`rounded-xl border px-3 py-2.5 ${BAND_CLASS[guidance.band]}`}>
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-start gap-3 text-left"
          aria-expanded={false}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${BAND_DOT[guidance.band]} mt-1.5 flex-shrink-0`} aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
                RAW
              </span>
              <span className="text-base font-bold text-white">
                {total}
                <span className="text-[10px] opacity-60 font-normal ml-1">/ {range.max}</span>
              </span>
              <span className="text-xs font-semibold">{guidance.label}</span>
            </div>
            <p className="text-[11px] mt-1 opacity-90 leading-snug">{guidance.headline}</p>
            {guidance.bullets.length > 0 && (
              <ul className="text-[11px] mt-1 space-y-0.5 opacity-90">
                {guidance.bullets.map((b, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="opacity-60">·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ChevronDown size={14} className="flex-shrink-0 mt-1 opacity-60" />
        </button>
      </div>
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
        {ELEIKO_RAW_AXES.map(axis => {
          const desc = activeRating(axis);
          return (
            <div key={axis.key}>
              <div className="flex items-baseline justify-between mb-0.5 gap-2">
                <span className="text-xs text-gray-300 font-medium flex-shrink-0">{axis.label}</span>
                <span className="text-[9px] text-gray-500 text-right truncate" title={desc ?? ''}>
                  {desc ?? 'rate yourself'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {axis.ratings.map(rating => {
                  const selected = local[axis.key] === rating.score;
                  return (
                    <button
                      key={rating.score}
                      onClick={() => setAxis(axis.key, rating.score)}
                      disabled={disabled}
                      className={`
                        h-10 rounded-md text-xs font-semibold transition-all
                        ${selected
                          ? `${SCORE_COLOR[rating.score]} text-white shadow ring-2 ${SCORE_RING[rating.score]}`
                          : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                      aria-label={`${axis.label}: ${rating.score} — ${rating.description}`}
                      aria-pressed={selected}
                      title={rating.description}
                    >
                      {rating.score}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {guidance && (
        <div className={`rounded-md border px-2.5 py-2 ${BAND_CLASS[guidance.band]}`}>
          <div className="flex items-baseline gap-2">
            <span className={`w-2 h-2 rounded-full ${BAND_DOT[guidance.band]} flex-shrink-0`} aria-hidden />
            <span className="text-xs font-bold">{guidance.label}</span>
          </div>
          <p className="text-[11px] mt-1 opacity-95 leading-snug">{guidance.headline}</p>
          {guidance.bullets.length > 0 && (
            <ul className="text-[11px] mt-1.5 space-y-0.5 opacity-90">
              {guidance.bullets.map((b, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="opacity-60">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
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
