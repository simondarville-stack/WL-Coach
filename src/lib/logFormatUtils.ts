/**
 * logFormatUtils — shared formatting helpers for the Training Log.
 *
 * Pure functions only. No React, no Supabase.
 * Extracted from AthleteCommentsThread and LogCommentsThread (E-09 / UF-27).
 */
import { formatDateTimeShort } from './dateUtils';

/**
 * Format an ISO timestamp for display in comment threads.
 * Example output: "20/05 14:30" (European day-first, 24h — see CLAUDE.md).
 */
export function formatTimestamp(iso: string): string {
  return formatDateTimeShort(iso);
}

/**
 * Format a number with the European comma decimal separator (CLAUDE.md).
 * Whole numbers render without a fraction; otherwise the value is fixed to
 * `decimals` places and the trailing period is swapped for a comma.
 * e.g. 82.5 → "82,5", 80 → "80".
 */
export function formatDecimalComma(n: number, decimals = 1): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(decimals).replace('.', ',');
}
