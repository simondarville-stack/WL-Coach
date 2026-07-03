/**
 * prilepin — canonical Prilepin zone data and classification helpers.
 *
 * Single source of truth for the Prilepin table (CLAUDE.md principle 3),
 * consumed by the desktop planner helper (PrilepinTable) and the Field
 * View Tools screen. Held as data rather than JSX so a coach-configurable
 * variant can replace it in one place later.
 * // COACH-CONFIG candidate: zone boundaries / NL ranges.
 */

export interface PrilepinZone {
  key: 'light' | 'medium' | 'heavy' | 'maximum';
  label: string;
  /** Inclusive lower bound, percent of 1RM. */
  min: number;
  /** Exclusive upper bound. Use a large value to mean "and above". */
  max: number;
  displayPct: string;
  repsMin: number;
  repsMax: number;
  /** Prilepin's optimal number-of-lifts for the zone. */
  optimal: number;
  rangeMin: number;
  rangeMax: number;
}

export const PRILEPIN_ZONES: PrilepinZone[] = [
  { key: 'light',   label: 'Light',   min: 0,  max: 70,  displayPct: '<70%',   repsMin: 3, repsMax: 6, optimal: 24, rangeMin: 18, rangeMax: 30 },
  { key: 'medium',  label: 'Medium',  min: 70, max: 80,  displayPct: '70-80%', repsMin: 3, repsMax: 6, optimal: 18, rangeMin: 12, rangeMax: 24 },
  { key: 'heavy',   label: 'Heavy',   min: 80, max: 90,  displayPct: '80-90%', repsMin: 2, repsMax: 4, optimal: 15, rangeMin: 10, rangeMax: 20 },
  { key: 'maximum', label: 'Maximum', min: 90, max: 200, displayPct: '≥90%',   repsMin: 1, repsMax: 2, optimal: 7,  rangeMin: 4,  rangeMax: 10 },
];

export function zoneForPercent(pct: number): PrilepinZone | null {
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return PRILEPIN_ZONES.find(z => pct >= z.min && pct < z.max) ?? null;
}

export type PrilepinVerdict = 'optimal' | 'inRange' | 'under' | 'over';

export function classifyNL(nl: number, zone: PrilepinZone): PrilepinVerdict {
  if (nl < zone.rangeMin) return 'under';
  if (nl > zone.rangeMax) return 'over';
  // "Optimal" is a small band around Prilepin's optimal count: within ±15%
  // of the optimal counts as on target, so a coach planning 15 NL in the
  // 80-90% zone (optimal 15) and someone planning 17 both feel correct.
  const tolerance = Math.max(1, Math.round(zone.optimal * 0.15));
  if (Math.abs(nl - zone.optimal) <= tolerance) return 'optimal';
  return 'inRange';
}

export function formatRange(min: number, max: number, suffix = ''): string {
  return min === max ? `${min}${suffix}` : `${min}-${max}${suffix}`;
}

export function kgRange(zone: PrilepinZone, oneRM: number): string {
  const lo = Math.round((zone.min / 100) * oneRM);
  // For the open-ended "Maximum" zone show kg from 90% up.
  if (zone.max >= 200) return `≥${lo}`;
  const hi = Math.round((zone.max / 100) * oneRM);
  if (zone.min === 0) return `<${hi}`;
  return `${lo}-${hi}`;
}
