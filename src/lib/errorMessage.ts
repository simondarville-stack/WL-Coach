/**
 * Extract a human-readable message from anything thrown.
 *
 * Supabase / PostgREST errors are plain objects shaped like
 * `{ message, code, details, hint }` and are NOT instances of Error, so
 * `String(err)` on them produces the useless string "[object Object]".
 * This helper pulls the best available field and, when present, appends
 * the PostgreSQL detail/hint so a coach reading the inbox actually sees
 * what went wrong (e.g. "column training_log_messages.owner_id does not
 * exist") instead of a generic placeholder.
 */
export function describeError(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
    if (typeof e.details === 'string' && e.details.trim()) parts.push(e.details.trim());
    if (typeof e.hint === 'string' && e.hint.trim()) parts.push(`hint: ${e.hint.trim()}`);
    if (parts.length === 0 && typeof e.code === 'string') parts.push(`Error ${e.code}`);
    if (parts.length === 0) {
      try {
        const json = JSON.stringify(err);
        if (json && json !== '{}') return json;
      } catch {
        // fall through
      }
      return 'Unknown error';
    }
    return parts.join(' — ');
  }
  return String(err);
}
