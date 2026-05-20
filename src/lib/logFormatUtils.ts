/**
 * logFormatUtils — shared formatting helpers for the Training Log.
 *
 * Pure functions only. No React, no Supabase.
 * Extracted from AthleteCommentsThread and LogCommentsThread (E-09 / UF-27).
 */

/**
 * Format an ISO timestamp for display in comment threads.
 * Example output: "May 20, 2:30 PM"
 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
