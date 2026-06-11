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
