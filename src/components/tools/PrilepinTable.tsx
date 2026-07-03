/**
 * PrilepinTable — coach-side reference helper for intensity / volume
 * planning. Renders the canonical Prilepin zones (light / medium /
 * heavy / maximum) with reps-per-set and number-of-lifts (NL) ranges,
 * and lets the coach:
 *
 *   - enter a 1RM to see the kg boundary of each zone
 *   - enter a planned intensity (%) to highlight the matching zone
 *   - enter sets × reps to compute planned NL and get a visual cue
 *     for under-dosed / on-target / over-dosed against the zone
 *
 * The zone table lives as data in src/lib/prilepin.ts (shared with the
 * Field View Tools screen) so a coach who prefers a modified Prilepin
 * variant can override it in a single place later if we surface that
 * as a setting.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';
import {
  PRILEPIN_ZONES as ZONES,
  classifyNL,
  formatRange,
  kgRange,
  zoneForPercent,
  type PrilepinVerdict as Verdict,
} from '../../lib/prilepin';

const VERDICT_STYLES: Record<Verdict, { bg: string; text: string; label: string }> = {
  optimal: { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-700',  label: 'Optimal dose' },
  inRange: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', label: 'Within range' },
  under:   { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-700', label: 'Under range' },
  over:    { bg: 'bg-red-50 border-red-200',      text: 'text-red-700',   label: 'Over range' },
};

interface PrilepinTableProps {
  onClose: () => void;
  positionClass?: string;
}

export function PrilepinTable({ onClose, positionClass = 'bottom-4 right-4' }: PrilepinTableProps) {
  const [oneRMText, setOneRMText] = useState('');
  const [pctText, setPctText] = useState('');
  const [setsText, setSetsText] = useState('');
  const [repsText, setRepsText] = useState('');
  const oneRMRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { containerStyle, handleProps } = useDraggable(containerRef);

  useEffect(() => {
    oneRMRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const oneRM = parseFloat(oneRMText);
  const hasOneRM = !isNaN(oneRM) && oneRM > 0;

  const pct = parseFloat(pctText);
  const activeZone = !isNaN(pct) && pct > 0 ? zoneForPercent(pct) : null;

  const sets = parseInt(setsText, 10);
  const reps = parseInt(repsText, 10);
  const hasPlan =
    !isNaN(sets) && sets > 0 && !isNaN(reps) && reps > 0 && activeZone !== null;
  const nl = hasPlan ? sets * reps : null;
  const verdict = nl != null && activeZone ? classifyNL(nl, activeZone) : null;

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden flex flex-col w-[440px] ${positionClass}`}
      style={containerStyle}
      role="dialog"
      aria-label="Prilepin's table"
    >
      {/* Header */}
      <div
        {...handleProps}
        className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50"
      >
        <span className="text-sm font-medium text-gray-900">Prilepin's table</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Inputs */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <div className="flex items-center gap-1.5 flex-1">
          <label className="text-xs text-gray-500 whitespace-nowrap">1RM</label>
          <input
            ref={oneRMRef}
            type="number"
            step="0.5"
            min="0"
            value={oneRMText}
            onChange={e => setOneRMText(e.target.value)}
            placeholder="—"
            className="w-full font-mono text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
          />
          <span className="text-xs text-gray-400">kg</span>
        </div>
        <div className="flex items-center gap-1.5 flex-1">
          <label className="text-xs text-gray-500 whitespace-nowrap">Intensity</label>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            value={pctText}
            onChange={e => setPctText(e.target.value)}
            placeholder="—"
            className="w-full font-mono text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>

      {/* Plan check — reps × sets (OWL convention). */}
      <div className="px-4 pt-1 pb-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-gray-600">Check plan</span>
          {activeZone && (
            <span className="text-[10px] text-gray-400">
              against <span className="font-medium text-gray-600">{activeZone.label}</span> zone
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <input
            type="number"
            step="1"
            min="1"
            value={repsText}
            onChange={e => setRepsText(e.target.value)}
            placeholder="reps"
            className="w-16 font-mono text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
          />
          <span className="text-gray-400">×</span>
          <input
            type="number"
            step="1"
            min="1"
            value={setsText}
            onChange={e => setSetsText(e.target.value)}
            placeholder="sets"
            className="w-16 font-mono text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
          />
          {nl != null && (
            <span className="text-xs text-gray-500 ml-1">
              = <span className="font-mono font-medium text-gray-800">{nl}</span> NL
            </span>
          )}
          {!activeZone && (setsText || repsText) && (
            <span className="text-[10px] text-gray-400 italic ml-2">
              enter intensity to compare
            </span>
          )}
        </div>
        {verdict && activeZone && nl != null && (
          <div
            className={`mt-2 px-2.5 py-1.5 border rounded text-[11px] flex items-center justify-between ${VERDICT_STYLES[verdict].bg}`}
          >
            <span className={`font-medium ${VERDICT_STYLES[verdict].text}`}>
              {VERDICT_STYLES[verdict].label}
            </span>
            <span className={`font-mono text-[10px] ${VERDICT_STYLES[verdict].text}`}>
              {nl} vs {activeZone.optimal} (opt.) · range {activeZone.rangeMin}-{activeZone.rangeMax}
            </span>
          </div>
        )}
      </div>

      {/* Zones table */}
      <div className="px-4 pb-3 pt-1 border-t border-gray-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left font-medium text-gray-400 pb-1 pt-2">Zone</th>
              <th className="text-right font-medium text-gray-400 pb-1 pt-2">%1RM</th>
              {hasOneRM && (
                <th className="text-right font-medium text-gray-400 pb-1 pt-2">kg</th>
              )}
              <th className="text-right font-medium text-gray-400 pb-1 pt-2">Reps</th>
              <th className="text-right font-medium text-gray-400 pb-1 pt-2">Opt.</th>
              <th className="text-right font-medium text-gray-400 pb-1 pt-2 pr-1">Range</th>
            </tr>
          </thead>
          <tbody>
            {ZONES.map((z, idx) => {
              const isActive = activeZone?.key === z.key;
              const altRow = idx % 2 === 1 && !isActive ? 'bg-gray-50/50' : '';
              const activeRow = isActive ? 'bg-blue-50 border-l-[3px] border-blue-500' : '';
              const textCls = isActive ? 'font-medium text-gray-900' : 'text-gray-700';
              return (
                <tr key={z.key} className={`${activeRow} ${altRow}`}>
                  <td className={`py-[3px] pl-1 ${textCls}`}>{z.label}</td>
                  <td className={`py-[3px] text-right font-mono ${textCls}`}>{z.displayPct}</td>
                  {hasOneRM && (
                    <td className={`py-[3px] text-right font-mono ${textCls}`}>
                      {kgRange(z, oneRM)}
                    </td>
                  )}
                  <td className={`py-[3px] text-right font-mono ${textCls}`}>
                    {formatRange(z.repsMin, z.repsMax)}
                  </td>
                  <td className={`py-[3px] text-right font-mono ${textCls}`}>{z.optimal}</td>
                  <td className={`py-[3px] text-right font-mono ${textCls} pr-1`}>
                    {formatRange(z.rangeMin, z.rangeMax)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pctText && !activeZone && (
          <p className="text-[10px] text-amber-600 mt-1 italic">
            Intensity outside 0–100% — no zone match.
          </p>
        )}
      </div>
    </div>
  );
}
