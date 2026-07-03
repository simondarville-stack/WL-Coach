/**
 * ToolsScreen — Field View pocket calculators for the gym floor.
 *
 * Two tools, both pure client-side math over existing domain modules:
 *
 *  - xRM estimator: weight × reps → estimated 1RM (shared 11-formula
 *    average from xrmUtils) plus the projected loads at 1–10 reps.
 *  - Prilepin zones: canonical zone data from src/lib/prilepin.ts with
 *    an optional 1RM for kg boundaries, intensity highlighting and a
 *    reps × sets number-of-lifts check.
 *
 * Comma-decimal input and output per the app's numeric convention.
 */
import { useState } from 'react';
import { parseNumericInput } from '../../lib/trainingLogModel';
import { estimate1RM, estimateWeightAtReps, roundToHalf } from '../../lib/xrmUtils';
import {
  PRILEPIN_ZONES,
  classifyNL,
  formatRange,
  kgRange,
  zoneForPercent,
  type PrilepinVerdict,
} from '../../lib/prilepin';

/** Comma-decimal display per the app's numeric convention. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

const REP_RANGE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const VERDICT_STYLES: Record<PrilepinVerdict, { cls: string; label: string }> = {
  optimal: { cls: 'bg-blue-950/60 border-blue-800/60 text-blue-300', label: 'Optimal dose' },
  inRange: { cls: 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300', label: 'Within range' },
  under:   { cls: 'bg-amber-950/60 border-amber-800/60 text-amber-300', label: 'Under range' },
  over:    { cls: 'bg-red-950/60 border-red-800/60 text-red-300', label: 'Over range' },
};

function NumField({
  label,
  value,
  onChange,
  suffix,
  placeholder = '—',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className="text-[11px] text-gray-500 whitespace-nowrap">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 font-mono text-sm bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-right text-white focus:outline-none focus:border-gray-600"
      />
      {suffix && <span className="text-[11px] text-gray-500">{suffix}</span>}
    </label>
  );
}

export function ToolsScreen() {
  return (
    <div className="max-w-2xl mx-auto px-3 pt-4 pb-4 space-y-3">
      <div className="px-1">
        <h1 className="text-lg font-bold text-white">Tools</h1>
        <p className="text-xs text-gray-500">Rep-max estimator · Prilepin zones</p>
      </div>
      <XrmCard />
      <PrilepinCard />
    </div>
  );
}

// ─── xRM estimator ──────────────────────────────────────────────────────────

function XrmCard() {
  const [weightText, setWeightText] = useState('');
  const [repsText, setRepsText] = useState('');

  const weight = parseNumericInput(weightText);
  const reps = parseNumericInput(repsText);
  const validReps = reps != null && Number.isInteger(reps) && reps >= 1 && reps <= 15;
  const oneRm = weight != null && weight > 0 && validReps ? estimate1RM(weight, reps) : null;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
        Rep-max estimator
      </h2>
      <div className="flex items-center gap-3">
        <NumField label="Weight" value={weightText} onChange={setWeightText} suffix="kg" />
        <span className="text-gray-600 text-xs">×</span>
        <NumField label="Reps" value={repsText} onChange={setRepsText} />
      </div>

      {reps != null && !validReps && (
        <p className="text-[10px] text-amber-400 italic mt-2">Reps must be a whole number 1–15.</p>
      )}

      {oneRm != null && (
        <>
          <p className="text-sm text-gray-300 mt-3">
            Estimated 1RM{' '}
            <span className="font-mono font-semibold text-white">{fmt(roundToHalf(oneRm))} kg</span>
            <span className="text-[10px] text-gray-500 ml-1.5">(11-formula average)</span>
          </p>
          <table className="w-full text-xs mt-2">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                {REP_RANGE.map(r => (
                  <th key={r} className="font-normal text-center py-1">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-800/80 text-gray-300">
                {REP_RANGE.map(r => (
                  <td key={r} className="text-center font-mono py-1.5 tabular-nums">
                    {fmt(roundToHalf(estimateWeightAtReps(oneRm, r)))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-[10px] text-gray-600 mt-1">Projected load (kg) at each rep count.</p>
        </>
      )}
    </section>
  );
}

// ─── Prilepin zones ─────────────────────────────────────────────────────────

function PrilepinCard() {
  const [oneRmText, setOneRmText] = useState('');
  const [pctText, setPctText] = useState('');
  const [repsText, setRepsText] = useState('');
  const [setsText, setSetsText] = useState('');

  const oneRm = parseNumericInput(oneRmText);
  const hasOneRm = oneRm != null && oneRm > 0;

  const pct = parseNumericInput(pctText);
  const activeZone = pct != null && pct > 0 ? zoneForPercent(pct) : null;

  const reps = parseNumericInput(repsText);
  const sets = parseNumericInput(setsText);
  const nl =
    reps != null && reps > 0 && sets != null && sets > 0 ? Math.round(reps * sets) : null;
  const verdict = nl != null && activeZone ? classifyNL(nl, activeZone) : null;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
        Prilepin's table
      </h2>
      <div className="flex items-center gap-3">
        <NumField label="1RM" value={oneRmText} onChange={setOneRmText} suffix="kg" />
        <NumField label="Intensity" value={pctText} onChange={setPctText} suffix="%" />
      </div>

      {/* Plan check — reps × sets (OWL convention). */}
      <div className="flex items-center gap-1.5 text-xs mt-2.5">
        <input
          type="text"
          inputMode="numeric"
          value={repsText}
          onChange={e => setRepsText(e.target.value)}
          placeholder="reps"
          className="w-14 font-mono text-xs bg-gray-950 border border-gray-800 rounded-lg px-2 py-1 text-right text-white focus:outline-none focus:border-gray-600"
        />
        <span className="text-gray-600">×</span>
        <input
          type="text"
          inputMode="numeric"
          value={setsText}
          onChange={e => setSetsText(e.target.value)}
          placeholder="sets"
          className="w-14 font-mono text-xs bg-gray-950 border border-gray-800 rounded-lg px-2 py-1 text-right text-white focus:outline-none focus:border-gray-600"
        />
        {nl != null && (
          <span className="text-gray-400 ml-1">
            = <span className="font-mono font-medium text-white">{nl}</span> NL
          </span>
        )}
        {!activeZone && (repsText || setsText) && (
          <span className="text-[10px] text-gray-500 italic ml-1">enter intensity to compare</span>
        )}
      </div>
      {verdict && activeZone && nl != null && (
        <div
          className={`mt-2 px-2.5 py-1.5 border rounded text-[11px] flex items-center justify-between ${VERDICT_STYLES[verdict].cls}`}
        >
          <span className="font-medium">{VERDICT_STYLES[verdict].label}</span>
          <span className="font-mono text-[10px]">
            {nl} vs {activeZone.optimal} (opt.) · range {activeZone.rangeMin}-{activeZone.rangeMax}
          </span>
        </div>
      )}

      <table className="w-full text-xs mt-3">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-500">
            <th className="text-left font-normal py-1">Zone</th>
            <th className="text-right font-normal py-1">%1RM</th>
            {hasOneRm && <th className="text-right font-normal py-1">kg</th>}
            <th className="text-right font-normal py-1">Reps</th>
            <th className="text-right font-normal py-1">Opt.</th>
            <th className="text-right font-normal py-1 pr-1">Range</th>
          </tr>
        </thead>
        <tbody>
          {PRILEPIN_ZONES.map(z => {
            const isActive = activeZone?.key === z.key;
            const rowCls = isActive
              ? 'bg-blue-950/50 border-l-2 border-l-blue-500 text-white font-medium'
              : 'text-gray-300';
            return (
              <tr key={z.key} className={`border-t border-gray-800/80 ${rowCls}`}>
                <td className="py-1.5 pl-1">{z.label}</td>
                <td className="py-1.5 text-right font-mono">{z.displayPct}</td>
                {hasOneRm && (
                  <td className="py-1.5 text-right font-mono">{kgRange(z, oneRm)}</td>
                )}
                <td className="py-1.5 text-right font-mono">{formatRange(z.repsMin, z.repsMax)}</td>
                <td className="py-1.5 text-right font-mono">{z.optimal}</td>
                <td className="py-1.5 text-right font-mono pr-1">
                  {formatRange(z.rangeMin, z.rangeMax)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pctText !== '' && !activeZone && (
        <p className="text-[10px] text-amber-400 mt-1 italic">
          Intensity outside 0–100% — no zone match.
        </p>
      )}
    </section>
  );
}
